# Source-pinned JavaScript art recipes

Callable ports of three existing bounded Python operations, not yet imported by the production worker:

- `image-default-frame`: validate v31, crop the requested frame, apply the existing default-state numeric kernel, emit identical RGBA/PNG/v31 files and receipt.
- `native-art`: verify trusted metadata, original SHA-256/MD5 and complete encoded-PNG SHA-256, then emit the nine class atlases plus any other declared atlases and the exact generated C index. The verified 3.3.94012 atlases also accept explicitly pinned browser PNG digests paired with their frozen digests. No PNG guard is weakened to a pixel digest.
- `map-goal`: crop seven symbols, halve cross alpha with integer flooring, render 155 current-name localized labels, and emit the original 164-file set and JSON layout. Text uses exact FreeType BASIC direct drawing, not Canvas/source-over.

`createArtRecipes({codec,kernels,defaultState,font,md5,sha256})` returns an async `execute(operation,payload,options)` function. `payload` is a `Uint8Array`; options and return receipts retain the existing operation contracts. Files are a plain filename-to-`Uint8Array` object. `isArtRecipeOperation` is available for dispatch. Dependencies are injected so this module neither fetches artifacts nor initializes Python:

- `codec`: `createPngCodec` from `png-codec-exact/codec.mjs`, pinned to Pillow's zlib 1.3.1. `encodeRgba(raw,width,height)` must preserve complete PNG bytes.
- `kernels`: `createImageKernels` from `image-kernels-rust/kernels.mjs`, using `{width,height,channels,data}` images.
- `defaultState`: existing export from `art-kernels/kernels.mjs`.
- `font`: `createFontRasterizer` from `font-rasterizer-exact/font.mjs`, pinned FreeType 2.6.0/Pillow 10.2.0 BASIC semantics. Only map-goal requires it. A call opens size 48, measures and draws anchor `mm`, then closes in `finally`.
- `md5(bytes)`: synchronous or async lowercase hex digest from the existing vendored SparkMD5. Only native-art needs it. The default SHA-256 uses WebCrypto; an equivalent digest function may be injected.

The factory checks the PNG backend version and each operation's required methods. Missing font support does not prevent default-frame/native-art. Dependency factories separately verify WASM versions and zero host imports. Do not substitute browser codecs/fonts or upgrade either zlib/FreeType pin. Legacy `pillow`/`freetype` receipt fields describe the compatibility target, not a Python dependency.

The operation input, output, metadata, dimension and hash guards are retained. The exact backends additionally impose their documented 8,192-side/4,194,304-pixel limits; integration must confirm authenticated layouts fit those bounds. Arbitrary oversized synthetic dimensions accepted by the old wrapper are not claimed compatible. JSON number-token types are preserved for Python integer-only dimensions; TSV quoting/multiline behavior, canonical index integers, and C include universal-newline conversion are explicit.

## Focused verification

Run from the repository root:

    node web/toolchain/art-recipes-js/scripts/verify-source.mjs
    node web/toolchain/art-recipes-js/test/parity.mjs
    # After the actual pinned codec/font WASM artifacts have been built:
    node web/toolchain/art-recipes-js/test/parity.mjs --wasm

Current focused evidence: **34 cases pass** against the bundled runtime, covering three default-frame successes, the complete map-goal output set, three native-art successes, and rejection cases. Factory version/missing-font/unsupported-operation checks also pass. The codec/font standalone WASM mode has not been run locally.

The runner uses synthetic images/tables and an already installed test font (`--font=/local/font.ttf` overrides the DejaVuSans default). No game input is read, stored or distributed. It loads the actual bundled vendor-hash-verified Pillow runtime under Node, not a browser. Default mode uses real Rust pixel WASM but injects the oracle's PNG/font operations to isolate recipe/control-flow equality. It therefore does not establish independent codec/font WASM parity. `--wasm` uses the standalone codec/font artifacts instead. Compare every output byte and receipt, including the complete map-goal manifest; rejection cases cover boundaries/hash enforcement.

No worker/preparer/runtime-build edits belong to this directory. Production Python is not removed by these files alone. Before routing operations, build and prove the codec/font artifacts, include the source verifier in preparation, and bundle or resolve these local ESM imports in the verified runtime closure. Preserve the existing dependency licenses. Authentic game-font/asset and end-to-end device parity remain separate checks, not established by synthetic fixtures.
