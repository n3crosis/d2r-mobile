# Complete JavaScript/WASM asset runtime

This directory supplies the Python-free asset worker and a build-only assembler. The production client, runtime build and packaging now select this closure instead of Pyodide/Pillow. Deployment remains gated on successful same-job builds of the exact WASM backends. Frozen CASC sources and `.NET` remain unchanged.

## Stages and current gates

1. All 12 existing operations have source-pinned callable JS pipelines. Build each pinned backend before assembly.
2. In the existing compiler CI job, build `image-kernels-rust`, `png-codec-exact` and `font-rasterizer-exact`. Reuse Rust 1.99.1, emsdk 4.0.20 and Bun 1.4.3. No new job or package dependency is introduced here.
3. Run `bun web/toolchain/asset-runtime-js/build.mjs`. It executes every recipe source guard, compares WASM bytes with their build receipts, checks zero host imports/required exports, and actually initializes each backend to enforce its pinned versions. It then bundles the complete import graph, embeds the three WASM SHA-256/size records, and writes a closed component manifest.
4. The client/build/package switch is wired together. A missing artifact, incomplete operation, failed source guard or failed bundle prevents packaging; there is no Python fallback.

`node web/toolchain/asset-runtime-js/build.mjs --plan` prints the stages, operation list and source/artifact paths without building anything.

## Runtime contract

The output is four component assets: `worker.mjs`, `image-kernels.wasm`, `png-codec.wasm`, and `font-rasterizer.wasm`, plus `manifest.json` and flat `licenses/`. JS recipes, numeric kernels, digest implementation and backend wrappers are bundled into the worker, not loaded through Blob-relative imports. The code never fetches a runtime dependency, imports dynamic code, or installs network/CSP interception. Nonempty legacy loopback proof probes are rejected; production initialization does not send them.

Initialization preserves `{id:0,type:'initialize',assets:[[basename,ArrayBuffer],...]}` and returns `{id:0,ok:true,result:{initialized:true,...}}` only after all three exact artifacts initialize and all 12 existing recipe routes plus the dedicated external-reference CASC route are present exactly once. Runtime inventory is rehashed against the trusted build-embedded records before compilation. The existing verified outer manifest/preload remains necessary and is not replaced by this inner check. The new initialization receipt honestly reports `version:'asset-runtime-js/1'` and `packages:{pillow:false}`; the production client only requires `initialized:true`.

Jobs preserve `{id,type:'run',operation,payload:ArrayBuffer,options}`. The serial queue remains mandatory because PNG, pixel and font backends own fixed reusable memories. Jobs arriving before initialization completes are rejected immediately. Initialization is one-shot, including after failure. Every output file is copied to a standalone transferable `ArrayBuffer`; all other recipe metadata is retained. Private job error details stay sanitized, while bounded startup errors describe only public runtime sources/artifacts.

Existing boundary caps remain: at most 32 initialization assets, each nonempty and at most 32 MiB, aggregate at most 96 MiB; job payloads 20 MiB by default, 64 MiB for HUD/CASC, 128 MiB for overlay; serialized options 4,096 characters except CASC's 1,048,576. The client additionally enforces UTF-8 byte caps. No stale `encode-linear-bc3` fallback is advertised: production already uses the separate Rust BC3 texture runtime.

## Production selection

The coordinated production selection is:

- `sealed-runtime/clients.mjs`: points the asset entry/closure to `toolchain/asset-runtime-js/dist`, keeping verified preload, transfer and session ownership unchanged.
- `runtime-build/build.mjs`: builds pixels/fonts and this assembler after the codec build; removes asset Pyodide installation/vendor generation/preparation from the release path. Build-only parity oracles may keep Python separately.
- `runtime-build/package.mjs`: selects the new exact four-file component and its advertised entry/manifest; omits the Pyodide closure and loader-provenance copy. Proof `bootstrap.mjs` is optional for this component, not shipped as a fake/unused entry. An explicit release policy rejects Python modules, wheels, libpython and Pyodide paths.
- Includes all dependency notices/provenance emitted under `licenses/`. Pillow-derived pixel/PNG/font code still requires its notices even though CPython/Pillow binaries are gone. Keep both zlib versions: PNG 1.3.1, CASC 1.2.13.

No game images, fonts, keys, fixture outputs, browser harnesses, proof HTML, native libraries, caches or source maps enter the component. Full end-to-end/game-font parity and deployed startup remain distinct gates. `.NET` is untouched.

## Dedicated external-reference CASC action

`casc-prebuilt-overlay` is an internal action, distinct from unchanged `casc-overlay`. It is registered in the sealed client allowlist and JS/WASM runtime router but is not called by the UI, production profiles, or asset generator. The existing ordinary-overlay byte-parity tests still pass.

The host API is `writeCascPrebuiltOverlay({romfs,replacements:[],external:{pack,records},worker,signal})` in `web/casc-overlay-writer.mjs`. `pack` is `{name,size,sha256}`; records are `{path,oldEkey,newEkey,encodedSize,decodedSize}` for existing normalized paths. The host checks original manifest path-to-key associations, duplicates, ordinary/external overlap, unsigned 32-bit record sizes, 8/8/40 locations and ranges within the declared positive pack size (at most `2**40`). The worker independently resolves original CFT positions and rejects CFT overlap before mutation. Pack hashes and EKeys here are reference metadata, not authentication of external archive bytes; this action neither reads nor copies the supplemental archive.

Call `reserveCascPackLocations(romfs,{packLocation?})` before generating a supplemental pack. It reserves the ordinary overlay's first free archive from the source inventory first, then selects or validates a distinct unused supplemental location. It returns frozen `{overlayLocation,packLocation,packName}`. This avoids shifting the ordinary overlay location and offsets simply because an external pack was added. The host rechecks against actual inventory and `getFile` when applying references; no caller-provided availability flag is accepted. This is a deterministic snapshot check, not a filesystem lock: callers must preserve the inventory and coordinate other planned outputs.

The worker receives `{parts,jobs,location}` options and payload segments `[config,originalVfs,root,...ordinaryReplacementBytes,externalJson]`. `externalJson` is the UTF-8 JSON `{pack,records}` with its own 16 MiB cap; at most 32,768 references and 8 MiB combined path bytes are supported. It is never placed in the 1 MiB options object. Total payload remains 64 MiB, ordinary jobs remain at most 4096, ordinary replacement bytes remain at most 16 MiB per record, and output remains at most 64 MiB. Metadata uses part of the existing total budget rather than enlarging it. An empty ordinary job list is supported only by this dedicated action when references are present. The response is `{files,inventory,external:{count,pack}}`, with ordinary-only inventory and no echoed full reference list; host checks the receipt and accepts only the changed config and reserved overlay archive.

Run `node --test web/tests/casc-overlay-writer.test.mjs web/tests/casc-prebuilt-routing.test.mjs`. The six original native-overlay regressions and seven dedicated host/contract tests passed. Dedicated tests use synthetic source data and injected Node compression, not browser/WASM execution; they cover collision reservation, external-only jobs, metadata payload routing, declared-location/range/association rejection, independent reference budgets, unchanged transport caps, and receipt mismatch. Actual assembled runtime startup and end-to-end installation remain separate gates.
