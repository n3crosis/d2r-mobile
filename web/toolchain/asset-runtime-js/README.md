# Complete JavaScript/WASM asset runtime

This directory supplies the Python-free asset worker and a build-only assembler. The production client, runtime build and packaging now select this closure instead of Pyodide/Pillow. Deployment remains gated on successful same-job builds of the exact WASM backends. Frozen CASC sources and `.NET` remain unchanged.

## Stages and current gates

1. All 12 existing operations have source-pinned callable JS pipelines. Focused recipe parity includes 34 art cases, the full 96-file HUD output, and the full 263-file overlay output plus receipts; independent codec/font WASM proof is a separate artifact gate.
2. In the existing compiler CI job, build `image-kernels-rust`, `png-codec-exact` and `font-rasterizer-exact`. Reuse Rust 1.99.1, emsdk 4.0.20 and Bun 1.4.3. No new job or package dependency is introduced here.
3. Run `bun web/toolchain/asset-runtime-js/build.mjs`. It executes every recipe source guard, compares WASM bytes with their build receipts, checks zero host imports/required exports, and actually initializes each backend to enforce its pinned versions. It then bundles the complete import graph, embeds the three WASM SHA-256/size records, and writes a closed component manifest.
4. The client/build/package switch is wired together. A missing artifact, incomplete operation, failed source guard or failed bundle prevents packaging; there is no Python fallback.

`node web/toolchain/asset-runtime-js/build.mjs --plan` prints the stages, operation list and source/artifact paths without building anything. Local full assembly has not run: the environment has the pixel WASM, but no `bun` command or built PNG/font WASM artifacts. Syntax, repository formatter/linter, a small protocol/transfer check and the existing pixel-WASM ABI check can run independently. They are not full runtime or game-input verification.

## Runtime contract

The output is four component assets: `worker.mjs`, `image-kernels.wasm`, `png-codec.wasm`, and `font-rasterizer.wasm`, plus `manifest.json` and flat `licenses/`. JS recipes, numeric kernels, digest implementation and backend wrappers are bundled into the worker, not loaded through Blob-relative imports. The code never fetches a runtime dependency, imports dynamic code, or installs network/CSP interception. Nonempty legacy loopback proof probes are rejected; production initialization does not send them.

Initialization preserves `{id:0,type:'initialize',assets:[[basename,ArrayBuffer],...]}` and returns `{id:0,ok:true,result:{initialized:true,...}}` only after all three exact artifacts initialize and all 12 operation routes are present exactly once. Runtime inventory is rehashed against the trusted build-embedded records before compilation. The existing verified outer manifest/preload remains necessary and is not replaced by this inner check. The new initialization receipt honestly reports `version:'asset-runtime-js/1'` and `packages:{pillow:false}`; the production client only requires `initialized:true`.

Jobs preserve `{id,type:'run',operation,payload:ArrayBuffer,options}`. The serial queue remains mandatory because PNG, pixel and font backends own fixed reusable memories. Jobs arriving before initialization completes are rejected immediately. Initialization is one-shot, including after failure. Every output file is copied to a standalone transferable `ArrayBuffer`; all other recipe metadata is retained. Private job error details stay sanitized, while bounded startup errors describe only public runtime sources/artifacts.

Existing boundary caps remain: at most 32 initialization assets, each nonempty and at most 32 MiB, aggregate at most 96 MiB; job payloads 20 MiB by default, 64 MiB for HUD/CASC, 128 MiB for overlay; serialized options 4,096 characters except CASC's 1,048,576. The client additionally enforces UTF-8 byte caps. No stale `encode-linear-bc3` fallback is advertised: production already uses the separate Rust BC3 texture runtime.

## Production selection

The coordinated production selection is:

- `sealed-runtime/clients.mjs`: points the asset entry/closure to `toolchain/asset-runtime-js/dist`, keeping verified preload, transfer and session ownership unchanged.
- `runtime-build/build.mjs`: builds pixels/fonts and this assembler after the codec build; removes asset Pyodide installation/vendor generation/preparation from the release path. Build-only parity oracles may keep Python separately.
- `runtime-build/package.mjs`: selects the new exact four-file component and its advertised entry/manifest; omits the Pyodide closure and loader-provenance copy. Proof `bootstrap.mjs` is optional for this component, not shipped as a fake/unused entry. An explicit release policy rejects Python modules, wheels, libpython and Pyodide paths.
- Includes all dependency notices/provenance emitted under `licenses/`. Pillow-derived pixel/PNG/font code still requires its notices even though CPython/Pillow binaries are gone. Keep both zlib versions: PNG 1.3.1, CASC 1.2.13.

No game images, fonts, keys, fixture outputs, browser harnesses, proof HTML, native libraries, caches or source maps enter the component. Full end-to-end/game-font parity and deployed startup remain distinct gates. `.NET` is untouched.
