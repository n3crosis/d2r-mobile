# SPIRV-Cross browser stage

This is an actual upstream SPIRV-Cross CLI compiled by Emscripten and invoked
inside a dedicated browser worker. It is not a JavaScript compiler substitute.
The native oracle builds the same unmodified official source. No game bytes,
keys, generated proprietary shaders, or vendor source copies are checked in.

## Verified source and build contract

- Khronos `vulkan-sdk-1.4.363.0`, commit
  `f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7`, matching the pinned production shell compiler requirement.
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

## Build and test

`build.sh` builds the native or WASM compiler from the pinned sources. Run `node --test test.mjs` with Node 22+ and Python 3 for the local reflection checks; the optional `spirv-cross` profile in [TESTING.md](../../TESTING.md) runs native/browser comparisons.

Upstream SPIRV-Cross is Apache-2.0. Keep its LICENSE and any NOTICE beside redistributed compiler output.

The packager may align chain labels only after the complete normalized shader-source digest matches the shell. See [shell profiles](../shell-release-evidence/V2_PROFILES.md). This converter does not replace that final check.
