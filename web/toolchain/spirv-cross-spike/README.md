# SPIRV-Cross browser stage (synthetic evidence only)

This is an actual upstream SPIRV-Cross CLI compiled by Emscripten and invoked
inside a dedicated browser worker. It is not a JavaScript compiler substitute.
The native oracle builds the same unmodified official source. No game bytes,
keys, generated proprietary shaders, or vendor source copies are checked in.

## Verified source and build contract

- Khronos `vulkan-sdk-1.4.363.0`, commit
  `f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7`, matching the official
  v1.0.18 shell compiler requirement. The older `docs/NO_XCODE.md` pin is not
  the release requirement. Native repository source/header labels remain untouched.
- Official Emscripten SDK `4.0.20`, commit
  `e4fe26ef59168ff44f4c23c466e497bf60b3411e`.
- Both tag refs were verified against official Git repositories. CI checks the
  fetched commit before executing/building it. No third-party SDK setup action.
- `build.sh` builds either the original native executable or ES-module WASM.
  SDK installation and compiler builds happen on CI, not the user's machine.
- `dmsh_build.py`'s exact flags: `--msl --msl-version 20300
--msl-argument-buffers --msl-texture-buffer-native --msl-pad-fragment-output`.
- Generated source uses LF, matching `nometal_run.py`'s source-copy convention.
  This does **not** imply Apple's Metal compiler accepted the source.

## Callable boundary

Import `wwwroot/convert.mjs`, call `convertSpirv(Uint8Array, options)`.
`options.replayContext` optionally contains `{ stage, resources }`, where
`resources` is the original translator `.res.json` with its `sbufs` array.
Return: `{ schema, msl, reflection, replay?, provenance }`.

`reflection` is upstream SPIRV-Cross JSON; `replay` is only the MSL-derived replay
fields, never a fabricated complete `<key>_b.json`. Provenance includes SHA-256
of input/source/reflection, exact flags and commit; `nativeChainClaimed` and
`metalCompiled` are explicitly false. Every CLI run gets a new isolated WASM
instance and temporary virtual files are removed. Compile errors propagate.
The header/instruction checks are bounds checks, not full SPIR-V validation.

Worker requests: `{ id, type: 'convert', spirv: ArrayBuffer, replayContext? }`.
Transfer the input buffer in `postMessage`'s transfer list. Replies preserve ID:
`{ id, ok: true, result }` or `{ id, ok: false, error }`. Requests are serialized;
terminate the worker to cancel an untrusted/slow compilation. There are no
network uploads or filesystem grants. Self-host generated `.mjs/.wasm` beside
the wrapper; do not load an arbitrary remote compiler.

## Replay fidelity and boundaries

`replay-reflection.mjs` ports `reflect`, `decode_tex`, `drv_reads`, `unfillable`,
`raster_facts`, entry detection and vertex attributes from `dmsh_build.py`.
`native-oracle.py` extracts the original pure functions with Python AST, without
running build-time top-level code or substituting a second handwritten oracle.
Authored parser cases cover argument buffers, uniforms, driver banks, storage
buffers, compute UBO pointers, textures/images/samplers, dynamic reads, fragment
outputs, vertex pass-through and UV affine facts. CI also fails if native flags
or the currently empty rewrite-rule list change.

Not implemented here: original translator job/facts construction, full source
and control-key chain, `dmsh_fetch.py` readable-tile variants, full replay JSON
assembly, final shell shader digest checking, packaging, native Metal compilation
or UI wiring. Do not rename/recompute a version to make a mismatch pass. Existing
`dmsh_chain.lock`, headers and native files are untouched. Production acceptance
must still establish the original full source/hash chain and pass final shell
source-digest checks; these synthetic tests cannot establish game compatibility.

## Tests and CI artifacts

Run `node --test test.mjs` (Node 22 and Python 3; no SDK needed). The dedicated
`spirv-cross-browser-checks.yml` additionally builds native/WASM, assembles and
validates three authored SPIR-V fixtures with official SPIRV-Tools, then runs real
Chromium. It compares exact normalized MSL, upstream reflection and replay fields
against native (empty compute, padded fragment output, storage argument buffer), checks invalid-request recovery, and repeat-call determinism.
The assembly tools come from Ubuntu's signed package repository; their reported
version and the actual fixture hashes are CI evidence, not a pinned assembler
claim. The Emscripten/Cross versions above are exact pins.

Artifacts: deployable `wwwroot` with `spirv-cross.mjs`, `spirv-cross.wasm`,
upstream license, synthetic `.spv`, native/browser source+JSON, browser version,
fixture/output hashes, and source-chain manifest. `provenance.py` records all
original native chain input hashes and compares the existing header without
rewriting it. Initial observed checkout: source chain `c675d3fa7c90` versus
header `15cf7ca29eaf` (unresolved compatibility condition pending a matched
release shell and verified `SHADER_SRC`, not proof generated game output is wrong).
The existing packager may align a chain label only after source-digest equivalence;
this stage never blindly renames it. The Chromium package is reused
from the sibling shader-spike's committed exact dependency lockfile. Upstream
SPIRV-Cross is Apache-2.0; its LICENSE (and NOTICE if present) is copied beside
redistributed compiler output. Preserve those notices when hosting the bundle.

## Historical verified run (1.4.357.0)

[CI run 39394114125](https://github.com/n3crosis/d2r-mobile/actions/runs/39394114125)
passed on commit `212ce3aa756f963e5c3221ba0d2cc250329f178a` (2026-10-20).
Native and WASM compiler builds, validated compute/fragment/storage fixtures,
real Chromium worker MSL/upstream-reflection/native replay-field differential,
invalid-input recovery and repeat-call determinism all passed. The synthetic
bundle and evidence are in artifact `12251830112` (seven-day retention).
Three local Node tests, including the original Python reflection differential,
also pass. No local SDK was installed.

The first run caught upstream CLI parsing behavior: `--reflect` consumes an
optional format argument. Both paths now explicitly use `--reflect json` with a
regression assertion. This successful synthetic check does not resolve the full
production shell/source-chain conditions above or prove real-game compatibility.

## Release compiler migration

The 1.4.363.0 official tag and fetched source were independently reverified on
2026-10-20. Both native and WASM builds now use that same commit. The existing
exact source/reflection differential checks remain mandatory; CI regression
results for the new compiler are recorded below. Historical runs above do not
certify the migrated compiler. Matching this version alone does not establish full
production SHADER_SRC `be59c864f087b377` or resolve native chain/header differences.

[Release-aligned run 39403162096](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162096)
passed on `664790f0b4d3cbe1082f174f0f1196164828d7f4` (2026-10-20).
Native/WASM 1.4.363.0 builds and the real Chromium compute/fragment/storage
MSL/reflection/replay differential all passed without weakening comparisons.
Artifact `12255957529` retains the synthetic outputs and deployable compiler
bundle for seven days. This is compiler parity evidence, not production source
catalog equivalence or Apple Metal validation.
