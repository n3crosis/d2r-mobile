# Bounded Pillow pixel kernels, not yet a production replacement

This isolated crate directly ports the narrow pixel semantics needed by the browser asset generator. It has not been wired into the dispatcher or release bundle. Python/Pillow must remain until the remaining image orchestration, PNG, fonts and overlay work is migrated.

## Implemented contract

The API accepts tightly packed `L` (one byte), `RGB` (three bytes) or `RGBA` (four bytes) buffers. Coordinates must already be integer pixels; callers porting Python must retain Python's ties-to-even rounding, not JavaScript `Math.round`.

- Crop with zero padding outside the source. RGBA padding is `(0,0,0,0)`.
- Horizontal/vertical flips.
- Unmasked paste and L/source-alpha masked paste, including clipping. Masked paste interpolates **all** channels, including alpha. It is not source-over.
- RGBA source-over with Pillow's integer seven-bit coefficients and rounding.
- L/RGB/RGBA conversions, alpha extraction/replacement, L lookup tables, and nonzero/alpha-only bounding boxes.
- L `MaxFilter(3)` and `MaxFilter(5)` with edge extension.
- Full-image L/RGB/RGBA Lanczos resize: Pillow's premultiplication/unpremultiplication, coefficient normalization to signed 22-bit integers, horizontal-before-vertical passes and byte clipping after each pass. Same-size resize copies hidden RGB unchanged.

Not implemented: PNG codecs, font measurement/rasterization, `ImageDraw` shapes, zero-size images, arbitrary resize boxes/reducing gaps, unsupported image modes or general Pillow APIs. Simple new/copy image buffers can be created directly in JS. The wrapper returns owned copies, never transient WASM views.

Bounds are 4,194,304 pixels per source/destination/intermediate, 8,192 pixels per side, and a 64 MiB WASM memory maximum. Fixed buffers make the module single-owner/non-reentrant. They are BSS and do not inflate the download by their memory size. Lanczos also validates the horizontal intermediate (`outputWidth * sourceHeight`).

## Build and narrow equivalence

Requires the same build-only Rust 1.99.1 toolchain as the BC3 encoder. No Cargo dependencies, WASM host imports, browser image decoder or Canvas.

    node web/toolchain/image-kernels-rust/build.mjs
    # Use a build-only Python environment containing Pillow==10.2.0.
    python web/toolchain/image-kernels-rust/test/make-fixtures.py
    node web/toolchain/image-kernels-rust/test/equivalence.mjs

Evidence from this change:

- `cargo fmt --check` and `cargo clippy --release --target wasm32-unknown-unknown -- -D warnings` pass.
- WASM: **31,787 bytes**, **13,674 bytes gzip-9**, zero Cargo dependencies/imports.
- 189 synthetic operation fixtures match native Pillow **10.2.0** exactly, including all 65,536 source/destination alpha pairs, transparent RGB, clipped placement, out-of-bounds crop, integer color conversion, filters, and Lanczos across up/down/one-axis sizes. This is narrow kernel evidence, not full game-art or font parity.
- The existing bundled Pyodide runtime was inspected separately: Pillow 10.2.0; FreeType 2.6.0; RAQM false; Pillow-linked zlib **1.3.1**. Python's own zlib is **1.2.13**, a different library and not the PNG encoder target.

`dist/`, build outputs and generated fixtures are ignored. `evidence.json` records this bounded result. The image pipeline is still pending; no release-payload saving is claimed yet.

## Provenance and license

Algorithm source is Pillow 10.2.0 (`AlphaComposite.c`, `Paste.c`, `ImagingUtils.h`, `Crop.c`, `Convert.c`, `GetBBox.c`, `RankFilter.c`, `Resample.c`, and the RGBA resize wrapper in `Image.py`). `reference/sources.json` records exact official source URLs and SHA-256 digests; downloaded source snapshots are build/review-only and ignored. The Pillow HPND copyright/license is preserved in `reference/LICENSE` and must accompany redistribution of the kernel. The Rust implementation intentionally does not compile or ship CPython/Pillow.

See `MIGRATION.md` for the production operation inventory and the byte-compatible PNG/font migration order.
