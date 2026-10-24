# Browser shader pipeline adapter

`shader-pipeline.mjs` connects the existing .NET browser translator's real
`{requestId, job, code: Uint8Array}` protocol to the compiled SPIRV-Cross module
worker's `{id, type: "convert", spirv: ArrayBuffer, replayContext}` protocol.
It passes the translator resource sidecar through unchanged, checks input/output
SHA-256 and compiler options, and independently checks the derived replay fields.
This is an explicit adapter, not an enabled packager or a substitute compiler.

## API and trust boundary

`createShaderPipeline({trustedShell, translatorWorkerUrl, crossWorkerUrl,
baseUrl?, timeoutMs?})` creates a single-operation pipeline. Assets must be
self-hosted HTTP(S), same-origin `.mjs` URLs. The caller must deploy the .NET
published worker with its `_framework` dependencies and Cross's worker, wrapper,
`.mjs/.wasm` compiler and license notices. No CDN fallback, upload or native
process is used. Dependency-injected `workerFactory` exists for protocol tests.

`trustedShell` uses the existing `validateShellContract` input, including its
application-trusted release recipe, plus `trustedRecipe.shaderKeys`: the full,
unique list of 16-lowercase-hex control keys for the matched shell, and
`trustedRecipe.spirvCrossVersion`. Both that version and shell_info SPIRV_CROSS
must be exactly `1.4.363.0`, the compiler pinned for both builds here. `chain` must
be 12 lowercase hex digits. This catalog is not derived from whatever inputs a
user happened to select. The recipe must be authenticated by the host application;
metadata consistency is not proof of release authenticity or shell file contents.
There is no trusted production catalog or binary-authentication bypass supplied
by this adapter.

- `translate({job, code, signal?})` takes an original native-style compute, vertex or fragment job
  with explicit `debug`/`reduced` flags and returns an MSL candidate, unchanged
  resource facts, MSL-derived replay fields, upstream reflection and hashes.
- `verifyCompleteSourceSet()` requires every trusted key to have successfully
  converted exactly once. It computes the original `d2rm_pack.py src_digest`
  algorithm: sorted `<key>_b.metal` UTF-8 names followed by raw SHA-256 of each
  LF-normalized source, then the first 16 hex digits of the overall SHA-256.
  A mismatch with the trusted shell's `SHADER_SRC` throws, including when the
  source set is otherwise complete. The returned status confirms only those
  generated source bytes, not subsequent caller mutations or written files.
- `dispose()` terminates current workers, rejects pending work and clears the
  private completion hashes. Calls after disposal fail.

Every result has `installable: false` and `metalCompiled: false`. Individual
candidates explicitly have `shaderSourceSetVerified: false`; only the complete
source-set operation can establish source equivalence. It never renames a chain,
creates metallib files, emits full replay JSON or makes an unsigned IPA usable.
Existing native packager label alignment requires source equivalence; this
adapter does not implement that packaging operation.

## Limits and explicit unsupported cases

The bridge now accepts compute, vertex and fragment jobs. Graphics inputs must
contain the complete 0x50-byte SPH plus instructions, and SPH stage bits 10..13
must agree with the declared job (vertex=1, fragment=5). Stage-zero fallback is
rejected. Explicit attr/fout maps require canonical numeric slots (0..31/0..7)
and float/sint/uint component types; these facts pass unchanged to the native
Accessor. The adapter also verifies the emitted SPIR-V entry mode and MSL entry
kind against that stage. Returned metadata includes stage and compute-only
threadgroup_size; reflection uses the correct stage-specific storage offsets.

Geometry/tessellation, readable-tile variants, full per-game shader/facts
extraction, control-key construction, c1 index generation and final replay
metadata remain unintegrated. Unsupported stages and translator query/default
notes fail closed instead of falling back or silently inferring resource types.
Accepting this
validated input layout does not prove all game graphics shaders compatible.

One conversion runs at a time. Code is copied before transfer, so caller bytes
remain intact. Each phase uses a new worker and terminates it after success,
failure, timeout or cancellation. The shared deadline is at most 120 seconds.
Caps: 1 MiB code, 64 KiB job/resource metadata, 16 MiB SPIR-V, 16 MiB MSL per
shader, 256 MiB cumulative generated MSL and 16,384 expected shaders. Only source
hashes are retained by the pipeline after return, not every MSL/SPIR-V buffer.
These resource bounds do not certify all real shaders will fit or translate.

## Local verification

The optional `shader-pipeline` profile in [TESTING.md](TESTING.md) compares authored translator/Cross outputs with native references. Unit tests cover protocol, ownership, source-digest, validation and cancellation contracts; synthetic fixtures do not establish full game or GPU equivalence.

## Explicitly gated tessellation source port

Hull/domain plumbing now exists behind per-job `allowUnverifiedTessellation: true`.
Default calls still reject these stages. The catalog's default unsupported list
retains both records rather than reducing complete-catalog requirements. SPH2/3
must match hs/ds; hs SPH word2 bits24..31 must provide a nonzero OutputVertices.
Existing native accessor semantics and Cross options are unchanged. The adapter
requires tesc/tese reflection, kernel/vertex MSL entry kinds and a triangle patch
attribute for ds. Results label this `source-ported-unverified`, retain
`installable: false`, and report `stageLinkageVerified: false`. Source-derived
hull count/domain facts are not a new native replay schema.

No native/WASM tessellation execution parity or actual game output is claimed.
The known hs/ds storage-buffer base and Cross stage-linkage conditions are
recorded in `SHADER_CATALOG_SCOPE.md`. No compiler options, native labels or full
source digest gates changed. Earlier unsupported-stage statements refer to
verified/default support, not this opt-in implementation.
