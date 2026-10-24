# Public browser-runtime assembly

This is a **build path**, not another test workflow. It joins the existing exact-source
builds into one bounded public runtime directory. No game files, keys,
real shader inputs or private-input fixtures are read or packaged. The public
v2.0.0 iOS 26 and iOS 18 shell archives are downloaded from their exact official release URLs and
verified against the recorded byte count and publisher-pinned SHA-256. Assembling
these assets does not establish browser startup, full-title conversion or device
compatibility for this revision.

```sh
node web/runtime-build/build.mjs --plan
node web/runtime-build/build.mjs
```

## Cached AIR shader compiler input

New runtime builds require an authenticated API-v2 AIR compiler from an exact reviewed fork release. D2R imports it and runs the strict 31-call canary; it never builds LLVM or applies compiler patches. Missing release pins or corresponding source fail before installed compiler bytes are changed. Non-AIR runtime builds retain their existing SDK and source gates.

```sh
node web/runtime-build/build-air-compiler.mjs
node web/runtime-build/air-compiler-assets.mjs verify
node web/runtime-build/prepare-air-compiler-source.mjs --output /path/to/empty-source-mirror
```

The fixed local `d2r_air_wasm.*` names are byte-identical aliases of generic release outputs; raw receipts are never rewritten. Complete release source and installed SDK runtime sources, lock, notices and release identity remain digest-bound. The committed pin selects authenticated v0.1.0 at its actual build commit `1bd8db2f0fefbd13636e51c209ef09292675dff5`; the strict D2R canary must still pass in CI before runtime publication. See [the integration contract](../toolchain/metal-air-compiler/README.md).

## Prerequisites and execution

Install and activate the official Emscripten **4.0.20** SDK, commit
`e4fe26ef59168ff44f4c23c466e497bf60b3411e`, and .NET SDK/workload set **10.0.402**
with `wasm-tools`. Git, CMake, make, Python 3, Node, Bun **1.4.3** and Rust
**1.99.1** must be on PATH.
The script checks compiler versions before changing output. It does not install
SDKs, use sudo, launch a browser or run the proof suites.

The build reuses these implementations, without copying their logic:

1. Existing texture/BC3, production-trust-root extraction and ARM64 rewrite WASM builds.
2. SPIRV-Cross at `f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7`, using the existing Wasm build script.
3. Exact PNG/zlib, image-kernel and font WASM builds, assembled with source-pinned
   JavaScript asset recipes. No Pyodide runtime is prepared for release.
4. The sealed texture packager and closed production worker bundles.
5. The browser shader project, with external boot config,
   pinned SDK/workload set, analyzers and warnings-as-errors, then its sealed packager.

Native Python build/audit tools, hash-gated recipe sources and explicitly invoked
Pyodide parity proofs remain development dependencies, not browser runtime files.

The build packages only after every required component succeeds. The output is
`web/runtime-build/out/`. The logical inventory preserves original `toolchain/...`
relative module URLs; physical downloads use content-addressed payloads.
This directory is generated and ignored by Git. The single GitHub job then
stages it into `web/dist/runtime/`. Its manifest digest is passed as a job output,
not read from the same untrusted artifact directory. The artifact validator
checks every runtime file against that digest-anchored inventory and rejects
additional files, missing files, changed sizes/hashes, or symlinks.

## Inventory and preload trust

`runtime-manifest.json` records each allowlisted file's size, SHA-256, source path,
compiler/source revisions, aggregate size and component entry points.
`runtime-integrity.mjs` embeds the exact manifest SHA-256 for trusted application
wiring. The final application's compiled bootstrap must import that digest rather
than accept a user-supplied manifest or digest. A local build receipt is not a
cryptographic build attestation.

Packaging has a 64 MiB per-file / 512 MiB total / 4,096-file cap, rejects symlinked
files and case-colliding destinations, checks existing sealed component manifests,
and stages the complete inventory before replacing its fixed generated output.
It never recursively copies a toolchain/build tree. Licenses and source notices are
retained; synthetic inputs, test harnesses and proof HTML are excluded.

The manifest retains `productionEnabled: false` as legacy build metadata and an
inventory-validation invariant, not a browser enablement switch. The application
verifies the trusted manifest and preloads both bundled profiles plus optional
capability bytes before private input selection. Core clients initialize then;
optional ASTC/signing workers initialize on demand from retained verified bytes.
Options remain editable until generation, without further asset downloads. Generate
additionally requires supported browser APIs, valid input selection and
customization, an idle session, and an available signing factory when requested.

This implemented wiring and the assembled public bytes do not establish
current-revision browser, real-input/native-parity or signed device/gameplay
acceptance. See [production flow](../PRODUCTION_FLOW.md) and
[packaging guide](../../docs/WEB_IPA_PACKAGER.md).

## Content-addressed public transport

The version-1 logical inventory optionally includes a version-1 `transport` object.
Each logical asset retains its original path, SHA-256, byte count and source.
Identical content is stored once, even when several worker layouts need it.
`transport.entries` maps each unique SHA-256/length pair to a payload and decoded
offset; `transport.files` records each payload’s path, encoded SHA-256/length,
encoding (`identity` or `gzip`) and decoded length. `transport.totalBytes` is the
physical transfer total, not the logical total inflated by shared dependencies.

Unique files up to 256 KiB are grouped into packs of at most 2 MiB decoded. Larger
files remain separate. Gzip is used only when it reduces bytes. Payloads live at
`payloads/<encoded-sha256>.gz` or `.bin`. Staging checks both physical payload
hashes and every logical slice hash, bounded decompression, exact contiguous pack
coverage, and rejects extra files, missing mappings and symlinks. Browser loading
uses the same manifest-bound mapping before reading private inputs; no game inputs
or keys are included. Legacy unpacked manifests remain readable.

## One GitHub browser-build job

The existing single Linux browser-build job installs the pinned .NET SDK and
`wasm-tools` workload, activates the pinned official Emscripten environment, and
runs the command above after the frontend build has cleaned `web/dist/`.
`stage-preview.mjs` independently verifies the runtime build manifest against
the producer step's digest, copies only its exact inventory, and regenerates the
combined `build-manifest.json` before upload. No platform matrix, separate proof
job or browser parity suite is added. The one job retains its bounded 180-minute timeout. AIR artifacts are imported
from the pinned release and checked by D2R’s canary; D2R does not build LLVM.
Other runtimes still compile locally.
Disk availability is logged before and after.

The uploaded `web-preview` includes the frontend and public runtime files only.
No game inputs, keys, toolchain caches or proof fixtures are uploaded. The only
native app content is the exact pinned public shell ZIP required by packaging;
it is never executed by the build. The build does not exercise the production UI
or establish that the bundle satisfies all remaining browser, runtime and
release-validation gates.

## Validation boundary

Final packaging requires the exact current modules, source receipts and complete inventory. Never substitute synthetic binaries, accept stale caches or silently omit a component.

The sealed worker entrypoints are bundled with Bun after native compilation.
Public shader map/facts/conflicts are copied only after matching their source
hashes. The static page's exact runtime-manifest meta placeholder is replaced
with the producer digest during staging, so the application can use a trusted
page-bound anchor before reading any private input.
