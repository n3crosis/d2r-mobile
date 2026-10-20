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
must be exactly `1.4.357.0`, the compiler actually built here. `chain` must
be 12 lowercase hex digits. This catalog is not derived from whatever inputs a
user happened to select. The recipe must be authenticated by the host application;
metadata consistency is not proof of release authenticity or shell file contents.
There is no trusted production catalog or binary-authentication bypass supplied
by this adapter.

- `translate({job, code, signal?})` takes an original native-style compute job
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

Only compute is currently implemented by the existing translator worker. Vertex,
fragment, geometry and tessellation translation, graphics SPH processing,
readable-tile variants, full per-game shader/facts extraction, control-key
construction, c1 index generation and final replay metadata are not integrated.
Such requests fail rather than falling back. Translator query/default notes
also fail closed instead of silently accepting inferred resource types.

One conversion runs at a time. Code is copied before transfer, so caller bytes
remain intact. Each phase uses a new worker and terminates it after success,
failure, timeout or cancellation. The shared deadline is at most 120 seconds.
Caps: 1 MiB code, 64 KiB job/resource metadata, 16 MiB SPIR-V, 16 MiB MSL per
shader, 256 MiB cumulative generated MSL and 16,384 expected shaders. Only source
hashes are retained by the pipeline after return, not every MSL/SPIR-V buffer.
These resource bounds do not certify all real shaders will fit or translate.

## Evidence

Eight targeted Node tests cover both wire protocols, transfer behavior,
independent native Python source-digest equivalence and ordering, incomplete
catalogs, shell/digest mismatch, unsupported stages, missing query facts,
malformed SPIR-V, compiler provenance/replay mismatch, timeout, cancellation,
crash and disposal. They use simulated workers, not a claim that the linked
browser pipeline passed end-to-end.

The individual actual browser stages have separate native differential CI.
SPIRV-Cross's [verified Chromium run](https://github.com/n3crosis/d2r-mobile/actions/runs/39394114125)
passed compute, fragment and storage synthetic cases. The separate `shader-pipeline-browser-checks.yml` and
`toolchain/shader-pipeline-spike/capture-browser.mjs` now define the linked real
Chromium/native differential gate; its result is pending the next CI run. No game data, real-game shader coverage, Apple Metal compilation or working
IPA output is claimed.

## Observed release mismatch

The independently inspected official v1.0.18 shell ZIP (SHA-256
`a383552871851ddb5923033639358e2a3c205ae411676e6538cd098743bbe37b`)
contains PRODUCT `3.3.94012-r44`, CHAIN `f2bc055e8f1e`, KIND `ios`,
SHADER_SRC `be59c864f087b377` and SPIRV_CROSS `1.4.363.0`.
That release does not match this repository-backed `1.4.357.0` spike. The adapter
rejects its toolchain declaration before starting workers; a regression test
covers this condition. No compiler pin, native chain/header or shell metadata
was changed to make it pass. Compatibility requires a coherently matched
release/source/toolchain and source-digest proof, not a label substitution.
The mismatch alone is not evidence that any particular game shader renders
incorrectly; real-game compatibility remains unestablished.
