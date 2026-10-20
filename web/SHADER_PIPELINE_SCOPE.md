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
Authored graphics cases passed the linked CI run below; accepting this
validated input layout does not prove all game graphics shaders compatible.

One conversion runs at a time. Code is copied before transfer, so caller bytes
remain intact. Each phase uses a new worker and terminates it after success,
failure, timeout or cancellation. The shared deadline is at most 120 seconds.
Caps: 1 MiB code, 64 KiB job/resource metadata, 16 MiB SPIR-V, 16 MiB MSL per
shader, 256 MiB cumulative generated MSL and 16,384 expected shaders. Only source
hashes are retained by the pipeline after return, not every MSL/SPIR-V buffer.
These resource bounds do not certify all real shaders will fit or translate.

## Evidence

Ten targeted Node tests cover both wire protocols, transfer behavior,
independent native Python source-digest equivalence and ordering, incomplete
catalogs, shell/digest mismatch, unsupported stages, missing query facts,
malformed SPIR-V, compiler provenance/replay mismatch, timeout, cancellation,
crash/disposal, truncated or mismatched SPH, invalid graphics type maps and
compiled-stage mismatches. These unit tests use simulated workers; separate actual
browser integration evidence follows.

The individual actual browser stages have separate native differential CI.
SPIRV-Cross's [verified Chromium run](https://github.com/n3crosis/d2r-mobile/actions/runs/39394114125)
passed compute, fragment and storage synthetic cases. The separate `shader-pipeline-browser-checks.yml` and
`toolchain/shader-pipeline-spike/capture-browser.mjs` now define the linked real
Chromium/native differential gate.
[Linked run 39396249823](https://github.com/n3crosis/d2r-mobile/actions/runs/39396249823)
passed on `582d586945db659a89094a0e8a4971196f330600` (2026-10-20): real
translator -> Cross module workers, exact MSL, resource sidecar, SPIR-V hash,
upstream/replay reflection and the complete synthetic SHADER_SRC gate all passed.
Artifact `12251768859` contains bounded synthetic evidence (seven-day retention).
No game data, real-game shader coverage, Apple Metal compilation or working
IPA output is claimed.

## Observed release mismatch

The independently inspected official v1.0.18 shell ZIP (SHA-256
`a383552871851ddb5923033639358e2a3c205ae411676e6538cd098743bbe37b`)
contains PRODUCT `3.3.94012-r44`, CHAIN `f2bc055e8f1e`, KIND `ios`,
SHADER_SRC `be59c864f087b377` and SPIRV_CROSS `1.4.363.0`.
The browser/native compiler is now pinned to that official 1.4.363.0 source,
commit `f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7`, independently reverified
against the official tag and fetched source. Obsolete or unknown compiler
versions and disagreement between shell and trusted recipe still fail before
worker startup. Full catalog equality with SHADER_SRC `be59c864f087b377` and
all trusted release recipe gates remain mandatory. No native chain/header or
shell metadata is rewritten. The observed source chain `c675d3fa7c90` and
header `15cf7ca29eaf` still differ from the release chain; matching the compiler
alone does not resolve this condition. The runs documented below used 1.4.357.0
and are historical evidence; release-aligned compiler parity is recorded last.
The mismatch alone is not evidence that any particular game shader renders
incorrectly; real-game compatibility remains unestablished.

## Verified authored graphics extension

The new vertex fixture loads attribute0's four components with ALD, writes all
four position components with AST, and exits. The fragment fixture writes four
known float constants using MOV32I, enables RGBA output0 in SPH OmapTargets,
and exits. Opcode fields, stage bits and scheduler placement are constructed
from the vendored decoder, not game bytes. Native and browser pipelines must
match exact MSL/resource/reflection outputs and SPIR-V hashes; additional checks
require vertex input0 plus position and fragment color0 with no discard.
Actual C# bridge rejection of invalid headers/type maps is exercised directly
in Chromium, separately from the adapter guards.

[Graphics run 39398141357](https://github.com/n3crosis/d2r-mobile/actions/runs/39398141357)
passed on `44b8e64d550f3575e88ebf83f65bdcfb9673b6c5` (2026-10-20), including
all three real linked stages and negative bridge cases. Artifact `12252583163`
records Chromium `156.0.8078.4` and aggregate synthetic SHADER_SRC
`bb602debeac6ca51`. Inspected vertex output/replay has `pos_attr=0`,
`pos_w=attr`; fragment MSL writes exactly `(1.0, 0.5, 0.0, 1.0)` to color0,
with no discard/sample mask. Existing compute-only native byte/sidecar parity
also remained green in run `39398141113`. These synthetic semantics and parity
results do not establish real-game, GPU-rendering or release-shell compatibility.

## Verified release-aligned compiler regression

[Linked run 39403162064](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162064)
passed on `664790f0b4d3cbe1082f174f0f1196164828d7f4` (2026-10-20).
Both native and actual browser compilers used official SPIRV-Cross 1.4.363.0.
The authored compute/vertex/fragment SPIR-V hashes, unchanged resource sidecars,
exact MSL, upstream/native replay reflection, negative bridge cases and complete
synthetic catalog checks all passed. Artifact `12256012556` retains bounded
synthetic evidence for seven days. The full production digest
`be59c864f087b377`, authenticated release recipe and remaining native asset/
metadata requirements are not established by this regression.

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
