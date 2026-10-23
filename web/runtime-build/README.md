# Public browser-runtime assembly

This is a **build path**, not another test workflow. It joins the existing exact-source
builds into one bounded public runtime directory. No game files, keys,
real shader inputs or private-input fixtures are read or packaged. The public
v2.0.0 iOS 26 and iOS 18 shell archives are downloaded from their exact official release URLs and
verified against the recorded byte count and publisher-pinned SHA-256; including
it does not assert production compatibility. It does not enable
the application or claim an end-to-end IPA.

```sh
node web/runtime-build/build.mjs --plan
node web/runtime-build/build.mjs
```

## Cached AIR shader compiler input

New runtime builds require a real API-v2 AIR compiler, not merely translated
Metal source. The existing CI job restores an exact-source cache or explicitly
builds the compiler once. Developers can use that same bounded builder after
activating Emscripten 4.0.20, or build separately with
`web/toolchain/metal-air-compiler/toolchain.mjs`, then record and import its
outputs. These are developer commands, not an end-user native-helper flow:

```sh
# Verify an existing cache, or build pinned public sources when no cache exists.
node web/runtime-build/build-air-compiler.mjs --jobs 4

# Alternatively, record an independently prepared build and import it explicitly.
node web/runtime-build/air-compiler-assets.mjs record \
  --build /path/to/api-build-wasm \
  --source /path/to/prepared-llvm-source \
  --api-source /path/to/compiler-api-source
# Use the receiptSha256 printed above, not a value fetched from an untrusted bundle.
node web/runtime-build/air-compiler-assets.mjs import \
  --input /path/to/api-build-wasm --sha256 RECORDED_RECEIPT_SHA256
node web/runtime-build/air-compiler-assets.mjs verify
```

Recording checks the current source manifest and all patched files, binds the
toolchain build recipe and all authored API files (including compiler policy includes), derives the sorted
header-bundle fingerprint from CMake's header list, and instantiates the actual
worker-targeted module to check API-v2 exports and its embedded header identity.
This is a local build receipt, not a cryptographic build attestation, browser
test, full-game shader test, or Apple GPU compatibility claim.

Import requires an explicitly trusted receipt digest and verifies both generated
files against it. The generated `toolchain/metal-air-compiler/dist/` cache is
ignored by Git. `build.mjs` revalidates the cache against the current compiler
source before other expensive stages; ordinary frontend changes do not rebuild
LLVM. A source/API/header/build-recipe change makes this cache stale and requires a new
compiler build and receipt. Alternatively, provide
`D2R_AIR_COMPILER_ASSET_DIR` and `D2R_AIR_COMPILER_RECEIPT_SHA256` together to import
an existing build asset before assembly. No compiler download URL, experimental
binary hash, implicit LLVM rebuild, or source-only substitute is built in.
The explicit import stores its trusted receipt digest separately under the
generated runtime-build directory. A copied cache cannot authenticate itself:
restoring only `dist/` without that trusted import requires another pinned import.

The single existing CI job caches only these final outputs and the separate
receipt anchor under an exact source/recipe fingerprint and pinned SDK identity,
without fallback cache keys. A cache hit is verified before use and does not
download or rebuild LLVM. On a genuine cache miss, the explicit builder verifies
the pinned public source archive, builds only the native `llvm-tblgen` and
`clang-tblgen` bootstrap tools, then builds and probes the actual WASM compiler.
Its 150-minute deadline bounds all compile stages; at most four compile jobs
(further limited by available CPUs and memory) and one link run concurrently.
An existing stale, incomplete or tampered cache fails rather than being silently
overwritten. Ordinary `build.mjs` still requires a verified compiler input and
never implicitly launches LLVM. No new CI job, release publication, full native
Clang build, proof suite or source-only substitute is introduced.

The same job also produces a separate `air-compiler-source` artifact before
uploading `web-preview`. It contains the complete SHA-256-pinned upstream source
archive, every ordered repository patch, the exact authored API/headers, build
recipe, source manifest, licenses and the matching binary build receipt. Nothing
is added to the browser payload. A per-file source report and its independently
logged digest bind the delivery to the current compiler source identity.

`prepare-air-compiler-source.mjs` reconstructs the patched tree only to verify
the archive contents and every modified source-file digest, then discards that
temporary tree. It never compiles LLVM or packages an existing object directory.
The original public source archive is cached separately under its exact pinned
SHA-256; a corrupt cache fails explicitly. An older compiler-output cache without
this source cache needs one source download/preparation, not a compiler rebuild.
Both artifacts have the same retention period and should be retained together
when distributing the GPL-covered compiler. See its `THIRD_PARTY_NOTICES.md`.

The compiler's generated factory, WASM, receipt, source pin, licenses/notices,
and closed Worker are included in the normal digest-verified runtime inventory
and transport. Shader-enabled preload instantiates it before any private input;
compilation and Worker recycling use only verified in-memory assets. The loader
exposes `createAirCompilerClient()` (`createAirCompiler()` is an alias), and
closing or retiring the shader runtime terminates compiler workers. Legacy
inventories remain readable, but requesting compiled shader output without an
authenticated compiler fails explicitly. Keeping source files is never reported
as successful Metal library compilation.

The a2flo migration uses compiler receipt/component schema version 2 and binds
`sourceLanguage: "floor-metal-3.2"` explicitly. C API version 2 and header-bundle
version 2 are unchanged; they alone cannot identify the frontend language.
Old AIR schema-1 components and missing/old language identities are rejected
rather than relabeled. Pre-AIR inventory parsing remains compatible without
inventing compiler availability.

### Reusing an unchanged pre-AIR runtime locally

The legacy reuse bridge is not supported for the current a2flo migration: its
strict source-equivalence allowlist intentionally rejects the changed transport
and source-delivery code. Use the normal CI build/cache path below; do not widen
the bridge's allowlist to bypass those checks.

当前 a2flo 迁移不支持旧运行时复用桥。严格的源码等价白名单会拒绝已变化的传输和
源码交付代码。请使用正常 CI 构建/缓存路径，不要放宽白名单来绕过检查。

For the original AIR integration only, a narrow developer bridge could retain an existing
CI runtime instead of rebuilding its unchanged .NET, extraction, texture,
program, signer and shell components. Obtain the artifact from the authorized
GitHub run, verify its ZIP digest against GitHub's artifact metadata, and take
the runtime-manifest digest independently from that exact successful job's log.
Extract only the bounded runtime inventory; never treat a digest found inside
the downloaded archive as its own trust anchor.

```sh
bun web/runtime-build/reuse-runtime.mjs \
  --runtime /path/to/verified-prior/runtime \
  --sha256 TRUSTED_RUNTIME_MANIFEST_SHA256 \
  --source-revision EXACT_PRIOR_COMMIT
```

The bridge verifies every old physical/logical asset, requires a clean pinned
prior build and unchanged non-AIR source, and checks that old native-build and
worker-build logic differs only by the known AIR additions. Unknown source
changes are rejected. It retains every prior asset exactly, bundles only the
new AIR worker with pinned Bun 1.4.3, appends authenticated compiler assets,
records the old build origin plus current source-change hashes, repacks the
inventory, and verifies the new output before replacing `runtime-build/out/`.
It neither runs old downloaded JavaScript nor needs local copies of discarded
generated source-only glue. Existing full-build behavior remains available.

Build the current frontend normally, then pass the bridge's printed
`manifestSha256` as `EXPECTED_RUNTIME_MANIFEST_SHA256` to `stage-preview.mjs`.
Use the printed current revision for `GITHUB_SHA` if staging requires one.
This produces a local public preview, not a deployment or a full-game proof.

## Prerequisites and execution

Install and activate the official Emscripten **4.0.20** SDK, commit
`e4fe26ef59168ff44f4c23c466e497bf60b3411e`, and .NET SDK/workload set **10.0.402**
with `wasm-tools`. Git, CMake, make, Python 3, Node and npm must be on PATH.
The script checks compiler versions before changing output. It does not install
SDKs, use sudo, launch a browser or run the proof suites.

The build reuses these implementations, without copying their logic:

1. The pinned nested program lockfile, installed with lifecycle scripts disabled.
2. Existing texture/BC3, production-trust-root extraction and ARM64 rewrite WASM builds.
3. SPIRV-Cross at `f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7`, using the existing Wasm build script.
4. Exact PNG/zlib, image-kernel and font WASM builds, assembled with source-pinned
   JavaScript asset recipes. No Pyodide runtime is prepared for release.
5. The sealed texture packager and closed production worker bundles.
6. The browser shader project, with external boot config,
   pinned SDK/workload set, analyzers and warnings-as-errors, then its sealed packager.

Native Python build/audit tools, hash-gated recipe sources and explicitly invoked
Pyodide parity proofs remain development dependencies, not browser runtime files.
Removing unused browser-only glue is source cleanup, not a new payload or RAM reduction.

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
uses the same manifest-bound mapping before sealing the network; no game inputs
or keys are included. Legacy unpacked manifests remain readable.

## One GitHub browser-build job

The existing single Linux browser-build job installs the pinned .NET SDK and
`wasm-tools` workload, activates the pinned official Emscripten environment, and
runs the command above after the frontend build has cleaned `web/dist/`.
`stage-preview.mjs` independently verifies the runtime build manifest against
the producer step's digest, copies only its exact inventory, and regenerates the
combined `build-manifest.json` before upload. No platform matrix, separate proof
job or browser parity suite is added. The one job has a bounded 180-minute timeout
to permit a cold compiler-cache build. Compiler builds increase its duration;
no successful cold-run timing is claimed before the first completed CI run.
Disk availability is logged before and after.

The uploaded `web-preview` includes the frontend and public runtime files only.
No game inputs, keys, toolchain caches or proof fixtures are uploaded. The only
native app content is the exact pinned public shell ZIP required by packaging;
it is never executed by the build. The build still leaves the production UI disabled and makes no claim
that a bundle alone satisfies all remaining runtime and release gates.

## Validation boundary

Local JavaScript syntax, scoped Oxc checks and non-mutating planning/fingerprint
commands pass. The real WASM receipt probe has run for an earlier source snapshot;
that does not authenticate a later compiler revision. Final packaging requires
the exact current module and source receipt. The same-job cold-build path, binary
reproducibility, browser startup and post-seal full-chain success remain separate
validation boundaries. Missing evidence is never a reason to substitute
synthetic binaries, accept a stale cache or silently omit a component.

The sealed worker entrypoints are bundled with Bun after native compilation.
Public shader map/facts/conflicts are copied only after matching their source
hashes. The static page's exact runtime-manifest meta placeholder is replaced
with the producer digest during staging, so the application can use a trusted
page-bound anchor before reading any private input.
