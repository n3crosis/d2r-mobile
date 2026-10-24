# Pillow-compatible pixel kernels

This crate supplies the bounded pixel operations used by the production JavaScript/WASM asset runtime.

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

Generated artifacts and fixtures are ignored. The equivalence suite compares synthetic operations against Pillow 10.2.0; it is not full game-art or font coverage.

## Provenance and license

Algorithm source is Pillow 10.2.0 (`AlphaComposite.c`, `Paste.c`, `ImagingUtils.h`, `Crop.c`, `Convert.c`, `GetBBox.c`, `RankFilter.c`, `Resample.c`, and the RGBA resize wrapper in `Image.py`). `reference/sources.json` records exact official source URLs and SHA-256 digests; downloaded source snapshots are build/review-only and ignored. The Pillow HPND copyright/license is preserved in `reference/LICENSE` and must accompany redistribution of the kernel. The Rust implementation intentionally does not compile or ship CPython/Pillow.
