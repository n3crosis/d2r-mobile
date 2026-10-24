# Linked synthetic shader pipeline

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

## Local verification

Run the optional `shader-pipeline` profile in [TESTING.md](../../TESTING.md).
It builds the pinned .NET and SPIRV-Cross runtimes and compares synthetic
native/browser outputs. Native and browser Cross builds must use the same pin;
see [the Cross build contract](../spirv-cross-spike/README.md).

From this directory, the fixture/capture commands are:

```sh
node capture-browser.mjs prepare <fixture-directory>
node capture-browser.mjs capture <published-translator-directory> <native-output-directory> <output-directory>
```

Full release-catalog digest and trusted-recipe gates remain mandatory. Synthetic
stage comparisons do not establish production source equivalence, native chain
relabeling, GPU execution, game compatibility or installable output.
