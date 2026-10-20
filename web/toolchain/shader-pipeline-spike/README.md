# Linked synthetic shader pipeline CI

This harness runs the actual published .NET browser worker through
`web/shader-pipeline.mjs`, then feeds its emitted SPIR-V/resource sidecar to the
actual SPIRV-Cross WASM module worker in Chromium. It does not substitute either
worker or import native output into the browser as compiler output.

The input is the existing authored 16-byte Maxwell EXIT fixture, assigned a
synthetic 16-hex control key for the adapter's native filename contract. The
independent original native translator and pinned native SPIRV-Cross CLI produce
the oracle. Comparison checks:

- SPIR-V SHA-256 and complete translator resource sidecar.
- Exact LF Metal source and upstream SPIRV-Cross reflection.
- Replay fields from the unchanged original Python reflection functions.
- Complete source-set digest against an independently generated synthetic shell
  recipe, including rejection before the catalog is complete.

The recipe is test-only and is explicitly not a production release shell or a
release-authentication claim. Result fields remain non-installable and no chain
is rewritten. Graphics, real-game shader sets, full source/facts extraction,
readable-tile variants and Apple Metal compilation remain unsupported/unverified.

`shader-pipeline-browser-checks.yml` installs the exact previously verified .NET
SDK/workload and official Emscripten SDK on CI only, reuses the unchanged spike
build scripts, and uses SHA-pinned Node24-native GitHub actions. It retains only
small synthetic native/browser outputs and provenance, not .NET/vendor runtime
bundles or game assets. The new linked workflow has not yet run at authoring;
passing standalone stage workflows is not substituted for linked-browser proof.

CLI: `node capture-browser.mjs prepare <fixture-directory>` or
`node capture-browser.mjs capture <published-translator-directory>
<native-output-directory> <output-directory>`.
