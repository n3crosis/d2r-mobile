# Consuming the pinned AIR WASM release

D2R does not compile LLVM, apply patches or install an AIR compiler SDK. The fork's exact released source contains its build workflow, pinned SDK inputs and build commands. D2R's separate non-AIR runtime builds still use their own Emscripten dependency.

The reviewed `release-pin.json` selects the authenticated v0.1.0 artifact built at `1bd8db2f0fefbd13636e51c209ef09292675dff5`. CI must still run the strict D2R canary before publishing runtime assets. Never substitute an unverified digest, follow a floating branch, or reuse an old receipt as fresh fork provenance.

From the repository root:

```sh
node web/runtime-build/build-air-compiler.mjs
node web/runtime-build/air-compiler-assets.mjs verify
node web/runtime-build/prepare-air-compiler-source.mjs --output /path/to/new-source-mirror
```

The import authenticates official versioned GitHub assets, the complete corresponding source, all runtime members and their exact source/header identity before changing installed compiler assets. Byte caps, fixed ABI/capability checks and the strict 31-call canary are unchanged. A corrupt cache fails instead of rebuilding or silently fetching an alternative compiler.

Optional browser smoke is an explicit developer action, not executed by source tests:

```sh
node web/toolchain/metal-air-compiler/browser-smoke-server.mjs --build /path/to/authenticated/dist --sha256 TRUSTED_RECEIPT_SHA256
```

The server verifies the exact pinned release before serving public authored assets. Do not add game inputs. A smoke result is not full corpus/device/GPU validation. The [old build procedure](history/PRE_FORK_WASM_BUILD.md) remains historical only.
