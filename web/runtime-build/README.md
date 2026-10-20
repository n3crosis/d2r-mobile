# Public browser-runtime assembly

This is a **build path**, not another test workflow. It joins the existing exact-source
builds into one bounded public runtime directory. No game files, keys,
real shader inputs or private-input fixtures are read or packaged. The public
v1.0.18 shell archive is downloaded from its exact official release URL and
verified against the recorded byte count and publisher-pinned SHA-256; including
it does not assert production compatibility. It does not enable
the application or claim an end-to-end IPA.

```sh
node web/runtime-build/build.mjs --plan
node web/runtime-build/build.mjs
```

## Prerequisites and execution

Install and activate the official Emscripten **4.0.20** SDK, commit
`e4fe26ef59168ff44f4c23c466e497bf60b3411e`, and .NET SDK/workload set **10.0.402**
with `wasm-tools`. Git, CMake, make, Python 3, Node and npm must be on PATH.
The script checks compiler versions before changing output. It does not install
SDKs, use sudo, launch a browser or run the proof suites.

The build reuses these implementations, without copying their logic:

1. Pinned nested asset/program lockfiles, installed with lifecycle scripts disabled.
2. Existing texture/BC3, production-trust-root extraction and ARM64 rewrite WASM builds.
3. SPIRV-Cross at `f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7`, using the existing Wasm build script.
4. Asset runtime vendoring and all registered source-pinned asset module packagers.
5. Existing sealed texture and asset Pyodide packagers.
6. The original source-linked browser shader project, with external boot config,
   pinned SDK/workload set, analyzers and warnings-as-errors, then its sealed packager.

The build packages only after every required component succeeds. The output is
`web/runtime-build/out/`, preserving original `toolchain/...` relative module URLs.
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

The manifest explicitly retains `productionEnabled: false` and
`sealedJobAdapter: false` until real job clients can consume the bundled bytes.
The ordinary NSP, program, Cross, asset and BC3 workers still use module/fetch
loading; including their bytes is **not** proof that they can execute after the
network is sealed. Existing sealed proof bootstraps are preserved as provenance,
not imported into the end-user page or mistaken for complete job clients.

Required next integration remains:

- A trusted application preload phase that verifies all manifest bytes before
  accepting any private file, followed by in-memory/blob module linking and
  sealed job clients. Do not weaken the current preview CSP to hide missing wiring.
- Complete production asset and shader recipes, including the unresolved shader
  stages, compatible shell provenance, and full-title output validation.
- Actual browser startup and full-chain verification of the assembled clients.
  Having public runtime bytes in the artifact is not a usable-game proof.

## One GitHub browser-build job

The existing single Linux browser-build job installs the pinned .NET SDK and
`wasm-tools` workload, activates the pinned official Emscripten environment, and
runs the command above after the frontend build has cleaned `web/dist/`.
`stage-preview.mjs` independently verifies the runtime build manifest against
the producer step's digest, copies only its exact inventory, and regenerates the
combined `build-manifest.json` before upload. No platform matrix, separate proof
job or browser parity suite is added. The one job has a bounded 45-minute timeout.
Compiler builds increase its duration; no actual timing or disk-use result is
claimed before the first CI run. Disk availability is logged before and after.

The uploaded `web-preview` includes the frontend and public runtime files only.
No game inputs, keys, toolchain caches or proof fixtures are uploaded. The only
native app content is the exact pinned public shell ZIP required by packaging;
it is never executed by the build. The build still leaves the production UI disabled and makes no claim
that a bundle alone satisfies all remaining runtime and release gates.

## Validation boundary

Local JavaScript syntax, Oxc checks and the non-mutating `--plan` command pass.
Actual build execution stops before any build stage because `emcc` is not on PATH;
`dotnet` is also unavailable in the current environment. No completed runtime
bundle, binary reproducibility, browser startup or post-seal full-chain success is
claimed. These are missing build/runtime evidence, not reasons to substitute
synthetic binaries or silently omit a component.

The sealed worker entrypoints are bundled with Bun after native compilation.
Public shader map/facts/conflicts are copied only after matching their source
hashes. The static page's exact runtime-manifest meta placeholder is replaced
with the producer digest during staging, so the application can use a trusted
page-bound anchor before reading any private input.
