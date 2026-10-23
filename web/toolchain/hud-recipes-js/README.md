# Complete HUD recipe in JavaScript, pending runtime integration

`generateHud(payload, options, { codec, kernels, font })` ports the actual complete Switch-upscaled HUD recipe. This is not a stub or a Pillow compatibility facade. It returns `{ files, mode, backend }` with a plain name-to-`Uint8Array` file object matching the current worker receipt. It is deliberately **not imported by the production dispatcher**.

The injected interfaces are the frozen modules in `png-codec-exact`, `image-kernels-rust`, and `font-rasterizer-exact`. The established `art-kernels` numeric operations remain unchanged. No game fonts, game images, original game layout, Canvas or browser image decoding are included.

## Implemented output and semantics

- Original 2868×1320 design geometry, six slots, alternating stone tile/edges, inclusive three-pixel border, level-button fitting and statue layers.
- Strict orb-circle alpha cutouts, native glass layer, belt/button alpha holes, cropped and resized game base, full-resolution native base.
- Native layout structural patch, component positions/scales/anchors, hidden native values/experience bar, preserved binding widgets and precise child order.
- Badge, level and multilingual vital glyph families with shadow, outline, baseline offsets, fractional advances and null whitespace images.
- Both original/default level-button frames, all eight metal difficulty digits, nine skill silhouettes and nine skill labels.
- Every fixed/glyph-declared output is checked against the exact output inventory.

Pillow-compatible image kernels supply crop, Lanczos, alpha composition, mask bounds and MaxFilter. The small rectangle border and alpha-hole operations use explicit integer pixels. The original numeric `defaultState`, `clearCircles`, `silhouette` and `metal` kernels are reused. All image/PNG dependency calls use owned buffers.

`python-values.mjs` preserves Python float-vs-int JSON spelling, arbitrary integer tokens, Unicode, object insertion order (including digit glyph keys), and indent=1 formatting. It rounds the exact binary64 rational to ties-to-even for integer/one-decimal geometry instead of multiplying first and accidentally double-rounding. `support.mjs` retains layout patch semantics and all source TSV validators, including localized placeholders, line counts, character limits and duplicate-key rejection. Invalid/nonfinite JSON and excessive nesting fail rather than silently coercing values.

## Guards and integration contract

The existing guards remain mandatory:

- `options.mode === "switch-upscaled"`; no silent PC-art or font fallback.
- 64 MiB JSON payload; 2 MiB per metadata item/layout; exact metadata/image/font/atlas key sets.
- All three metadata SHA-256 checks against caller-provided trusted pins. Those pins must still come from the source-pinned packaging boundary, not the untrusted game input.
- Exactly nine skill atlas PNGs; **whole encoded PNG SHA-256** and declared dimensions rechecked before use. For the verified 3.3.94012 atlases, explicitly pinned browser PNG digests are paired with their frozen digests. Hashes are not replaced with pixel digests.
- 16 MiB per archive font; combined source/atlas pixel budget 4,194,304; bounded image dimensions; 512 files and 32 MiB total output.
- Source and metadata pins checked by `verify-sources.mjs`. The pins remain identical to `asset-generation-spike/hud-provenance.json`.

The dependency instances must be private to a serial dedicated worker. Terminating that worker is the cancellation boundary for synchronous raster work. Large intermediate JS buffers remain necessary; per-image and output limits are not a total JS-heap guarantee. `finally` closes the font instance and clears this recipe's font byte arrays; this is not a secure-erasure claim for input JSON, oracle or other heap copies.

## Focused evidence

    node web/toolchain/hud-recipes-js/verify-sources.mjs
    node web/toolchain/hud-recipes-js/test/helpers.mjs
    node web/toolchain/hud-recipes-js/test/orchestration.mjs /path/to/test.ttf /path/to/test.otf

The whole-recipe check uses the real image-kernel WASM and the source-vendor-hash-verified bundled Pillow 10.2.0 / FreeType 2.6.0 / BASIC runtime under Node. It supplies synthetic sprites/layout/atlases and locally installed DejaVuSans TTF and NimbusSans CFF/OTF test fonts. No browser, network or game data is involved. The historical pre-v2 run matched **all 96 output files byte-for-byte**, including both JSON documents and every PNG.

For that focused check, font measurement/drawing and PNG I/O intentionally use adapters to the bundled Pillow oracle. The test therefore verifies **HUD orchestration plus image-kernel WASM**, not the unbuilt standalone font/PNG artifacts. The separate font kernel has its own narrow semantic evidence. Test fonts are not bundled and do not prove authentic game-font rendering.

Historical checks also covered 44 geometry-rounding cases against Python, float/order JSON examples, pinned TSV parsing, patch behavior and early validation rejections, plus repo-config lint/format and module syntax. This migration reran source/data and syntax checks, not those runtime comparisons or lint/format.

## Remaining release gates

1. Build and verify the actual standalone font/PNG WASM artifacts in the existing pinned compiler step; run their own equivalence suites. Do not substitute Canvas or native libraries with different versions.
2. Connect the recipe to the sealed runtime/worker and packaging/source-provenance gates, retaining the existing metadata trust and encoded-byte guards.
3. Compare the complete output inventory with authenticated real game fonts/images/layout. The current synthetic test does not establish production game revision compatibility, iOS output, old RAQM equivalence, or a working IPA.
4. Include legacy FreeType's required security/license review before parsing real-user fonts in release. Only after all remaining operations are migrated can Python/Pillow payloads be removed.

No production payload savings or Python removal are claimed by this isolated module.

## Upstream v2 migration

The normal HUD computation AST is unchanged after excluding CLI-only tuning and selecting the full iOS (not overlay-only) branch. The shared i18n table now includes Korean, which adds vital glyphs and changes the complete output inventory. The parser validates that extra language, but the default keeps the exact pre-v2 vital-character sequence. Only the explicit internal `RELEASE_ART_REVISION` (b811) or `UPSTREAM_ART_REVISION` (e375) includes Korean glyphs. Production never selects that revision, and there is no user setting. A matching future shell profile is required before activation. The AST packager removes the new CLI-only `args` dependencies. The 96-file result above is historical and is not a v2 parity claim. The new inert checks do not run image/font backends; fresh rendered-output verification remains required. See [UPSTREAM_V2_ART_REVIEW.md](../../UPSTREAM_V2_ART_REVIEW.md).
