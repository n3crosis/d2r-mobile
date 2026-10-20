# Linked synthetic shader pipeline CI

This harness runs the actual published .NET browser worker through
`web/shader-pipeline.mjs`, then feeds its emitted SPIR-V/resource sidecar to the
actual SPIRV-Cross WASM module worker in Chromium. It does not substitute either
worker or import native output into the browser as compiler output.

The inputs are authored Maxwell programs, each assigned a synthetic 16-hex
control key: the original 16-byte compute EXIT, vertex ALD(vec4 attribute0) ->
AST(position) -> EXIT with a 0x50-byte SPH, and fragment MOV32I(RGBA constants)
-> EXIT with SPH OmapTargets=0xf. `graphics-fixtures.mjs` documents exact vendored
decoder field sources and inserts scheduling words every three instructions. The
independent original native translator and pinned native SPIRV-Cross CLI produce
the oracle. Comparison checks:

- SPIR-V SHA-256 and complete translator resource sidecar.
- Exact LF Metal source and upstream SPIRV-Cross reflection.
- Replay fields from the unchanged original Python reflection functions.
- Complete source-set digest against an independently generated synthetic shell
  recipe, including rejection before the catalog is complete.

The recipe is test-only and is explicitly not a production release shell or a
release-authentication claim. Result fields remain non-installable and no chain
is rewritten. Geometry/tessellation, real-game shader sets, full source/facts
extraction, readable-tile variants and Apple Metal compilation remain
unsupported/unverified. The graphics extension also requires vertex input0 and
position output, fragment color0/no discard, and direct real-C# rejection of
truncated/mismatched headers, invalid type maps and unsupported stages.

`shader-pipeline-browser-checks.yml` installs the exact previously verified .NET
SDK/workload and official Emscripten SDK on CI only, reuses the unchanged spike
build scripts, and uses SHA-pinned Node24-native GitHub actions. It retains only
small synthetic native/browser outputs and provenance, not .NET/vendor runtime
bundles or game assets.

## Verified linked run

[Run 39396249823](https://github.com/n3crosis/d2r-mobile/actions/runs/39396249823)
passed on `582d586945db659a89094a0e8a4971196f330600` (2026-10-20), including
both actual browser workers connected through the adapter, original native
oracles and every comparison above. Synthetic evidence artifact `12251768859`
is retained for seven days. This establishes the authored compute EXIT case,
not real-game compatibility or compatibility with the newer v1.0.18 shell.
This historical run used SPIRV-Cross 1.4.357.0, not the new release-aligned pin.

CLI: `node capture-browser.mjs prepare <fixture-directory>` or
`node capture-browser.mjs capture <published-translator-directory>
<native-output-directory> <output-directory>`.

## Graphics extension status

[Graphics run 39398141357](https://github.com/n3crosis/d2r-mobile/actions/runs/39398141357)
passed on `44b8e64d550f3575e88ebf83f65bdcfb9673b6c5` (2026-10-20).
The real linked compute/vertex/fragment pipelines, unchanged native oracles,
Vulkan validation and direct negative C# bridge cases all passed. Artifact
`12252583163` records Chromium `156.0.8078.4` and aggregate source digest
`bb602debeac6ca51`. Inspected MSL confirms unchanged attribute0-to-position;
replay has `pos_attr=0`, `pos_w=attr`. Fragment output is exactly RGBA
`(1.0, 0.5, 0.0, 1.0)` at color0 with no discard or sample mask.

The earlier run above remains compute-only evidence. Both historical runs used
1.4.357.0. The native and browser builds now pin official 1.4.363.0 at
`f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7`; new-compiler CI parity passed below.
The full release catalog digest and trusted recipe gates remain mandatory, and
native chain/header differences remain unresolved. Geometry,
tessellation, broader graphics instructions/resources, both precision modes,
GPU execution and game compatibility need their own evidence.

## Release-aligned compiler regression

[Run 39403162064](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162064)
passed on `664790f0b4d3cbe1082f174f0f1196164828d7f4` (2026-10-20), using
1.4.363.0 for both native and browser Cross builds. All three linked authored
stages, exact independent differential checks, complete synthetic source digest
and negative bridge cases passed unchanged. Evidence artifact `12256012556`
has seven-day retention. No real-game catalog, production source equivalence,
native chain relabeling or installable output is claimed.
