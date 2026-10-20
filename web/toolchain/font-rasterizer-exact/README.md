# Exact BASIC font groundwork, not a production replacement

This isolated C/JS module ports the production subset of Pillow 10.2.0's `_imagingft.c` and `ImageDraw.text` onto the exact FreeType **2.6.0** source/configuration inherited from the bundled Pyodide runtime. It has no CPython API, RAQM/HarfBuzz, browser text, Canvas, PNG codec, or production imports. The source is pinned, not upgraded.

The user must supply fonts from their own game archive: `blizzardglobal-v5_81.ttf` and `exocetblizzardot-medium.otf`. No game font or font substitute is bundled/downloaded. Test fonts only establish narrow engine semantics; they do not establish authentic HUD/map parity.

## API and exact behavior

`createFontRasterizer(wasm)` returns a single-owner object:

- `open(fontBytes, size)` replaces the current font, face index 0, nominal pixel size. `close()` releases the face/library and wipes the font/text buffers.
- `measure(text, { anchor, stroke })` returns `bbox`, `offset`, dimensions, length in 1/64 pixels, and `[ascent, descent]`.
- `mask(text, { anchor, stroke, start })` returns an owned raw **L** grayscale mask and its integer placement offset. `start` is the fractional `(x,y)` from truncation toward zero, including negative fractions.
- `draw(pixels, width, height, text, { x, y, fill, strokeFill, stroke, anchor, channels })` returns an owned L or RGBA buffer. RGBA colors are four-byte arrays; L colors are single bytes. Default channels = 4. It never mutates the JS input.

Supported anchors are default `la`, `ls`, `mb`, `mm`; strokes are integer widths 0, 1, 2. All production font sizes (26/30/34/48/220) fit the 1–256 size bound. Unicode scalar values are supported, with BASIC layout only. Multiline, text features, language/direction shaping, embedded-color fonts, non-L antialiasing, arbitrary anchors and bitmap font APIs are deliberately absent.

The port preserves these non-obvious semantics:

- Hinted `horiAdvance` values remain in 26.6 units. Pillow BASIC adds `PIXEL(kerningDelta)` directly to that advance, not the unrounded 26.6 delta. This odd scale is intentional compatibility behavior.
- Pixel rounding is Pillow's signed `((x+32)&-64)>>6`; bounds include the origin/pen line. Middle anchors use the pen advance or face ascender/descender, not the visual ink center.
- Measurement bounds use `FT_LOAD_DEFAULT` even with a stroke. Stroke rendering uses `FT_LOAD_NO_BITMAP`, round caps/joins, and a separate unstroked fill pass. Fractional starts expand mask dimensions by `ceil(start)` and follow Pillow's float conversion/pen placement.
- Overlapping glyph masks use Pillow's rounded coverage-union formula. Direct RGBA text draw follows `Paste.c:fill_mask_L`: RGB is copied fully for nonzero coverage onto destination alpha 0, otherwise coverage-interpolated; alpha is independently interpolated. This is neither ordinary source-over nor generic masked paste. A semi-transparent text ink does not scale the RGB coverage.

Bounds: 16 MiB font, 2,048 Unicode scalar values, 8,192 per output side, 4,194,304 mask/canvas pixels, 16 MiB FreeType allocation budget, 64 MiB fixed WASM memory. No filesystem streams; inputs are copied into private memory. The FreeType module/source list and rasterizer options are unchanged. Only external stream support is disabled, and the normal allocator is replaced with a bounded allocator using the same `FT_New_Library`/`FT_Add_Default_Modules` initialization sequence as 2.6.0's `FT_Init_FreeType`. The wrapper is not reentrant.

These limits do not make legacy FreeType a security-certified parser. The old version is inherited solely for compatibility; release security review remains a separate gate. Keep game-input extraction bounds and provenance checks outside this module.

## Build and focused verification

Use the existing CI **emsdk 4.0.20** toolchain, not a new job:

    node web/toolchain/font-rasterizer-exact/build.mjs

The recipe verifies the official 2,270,210-byte archive's SHA-256 and the original port's SHA-512, verifies the extracted port configuration, and compiles a standalone WASM module. It requires no JS runtime/filesystem, fixes memory to 64 MiB, uses native WASM exception support for FreeType's setjmp/longjmp, and rejects any host imports. `dist/build-report.json` records actual size/hash only after those checks pass. Compilation has **not been run here** because `emcc` is absent, so the WASM artifact, exception configuration and import-free assumption remain unverified. Do not integrate this module into production until that artifact check and the following equivalence runner pass.

A native build is a bounded semantic check, not a substitute for the artifact gate:

    node web/toolchain/font-rasterizer-exact/build.mjs --native
    node web/toolchain/font-rasterizer-exact/test/make-fixtures.mjs /path/font.ttf /path/font.otf
    python web/toolchain/font-rasterizer-exact/test/native-equivalence.py
    # After an actual WASM build:
    node web/toolchain/font-rasterizer-exact/test/wasm-equivalence.mjs

Fixture generation runs the **actual source-vendor-hash-verified bundled WASM** Pillow 10.2.0/FreeType 2.6.0/RAQM=false under Node, without a browser or network. It records input font hashes, not font bytes, and validates the exact backend before rendering. Python appears only in this build/test oracle, never the proposed browser module. Fixtures are ignored.

Current evidence: 94 focused comparisons pass exactly using native C compiled from the pinned FreeType sources against the bundled WASM oracle, with locally installed DejaVuSans.ttf and NimbusSans-Regular.otf. Coverage includes TTF and CFF outlines, all production sizes/anchors, spaces/empty text, bearings, kerning, accented/Cyrillic/CJK strings (including missing glyphs), fractional positions, strokes 0/1/2, L masks, transparent/opaque/partial-alpha RGBA drawing and clipping. Compiler syntax/warnings checks and input-rejection checks pass. This is **not** game-font, end-to-end output, PNG-byte, or production-runtime parity.

Next gates: build/verify actual WASM in the existing compiler step; run the same fixtures against WASM; port HUD/map control flow with exact image/PNG kernels; compare authentic game-font metrics, RGBA output and encoded hashes; only then remove production Python/Pillow payloads.

## Provenance and notices

`freetype-source.json` records the unchanged source list and official source/port hashes from Emscripten 3.1.58's FreeType port. `reference/sources.json` pins Pillow 10.2.0 `_imagingft.c`, `ImageDraw.py`, `ImageFont.py`, `Draw.c`, `Paste.c`, arithmetic helpers and license. Downloaded implementation snapshots are review-only and ignored; the port configuration and redistribution notices are retained.

This software is based in part on the work of the FreeType Team. FreeType is used under the FreeType License (`reference/LICENSE-FreeType`), not the alternative GPL license. Preserve the Pillow HPND notice (`reference/LICENSE`), FreeType notice and applicable BDF/PCF/zlib notices with distributed binaries. The build copies these notices into `dist/`.
