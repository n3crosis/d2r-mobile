# Complete native-art generator boundary

This named stage runs the unchanged `native_art/generate.py:main`, AST-packaged with
its original constants and hash checks. The source, C implementation include,
manifest, geometry and binding documents are SHA-256 pinned in
`native-art-provenance.json`. Build preparation emits the exact release metadata
and its separate hashes; a verified release resource loader must authenticate both.
No game images, game tables or fonts are bundled.

`generateNativeArt` in `web/native-art-generator.mjs` takes `logicalAssets.read`,
an asset worker, an explicit whole-atlas RGBA decoder, trusted metadata and its
trusted hashes. It reads exactly the two declared Skills/Skilldesc tables and all
12 declared production atlases/HUD images. The current production inventory is
2,330,201 pixels. It does not accept arbitrary output paths or generic recipes.
It checks source SHA-256 before decoding. The original Python generator additionally
checks source MD5, encoded PNG SHA-256 and the complete descriptor-index SHA-256.
Any PNG encoder difference is a hard failure, never a relaxed pixel comparison.

The worker operation `native-art` receives explicit raw/decoded input maps and
trusted metadata hashes. It emits every declared PNG and `dm_touch_native_art.c`.
The C file is a generated text intermediate for the existing `derived-tables`
operation, NOT a packaged header/source, a compilation request or executable code.
The implementation include is only written as text and never executed.

Bounds: 64 assets, two tables, 8 MiB aggregate logical bytes, 4,194,304 aggregate
pixels, 20 MiB JSON payload and output, 2 MiB per metadata document. The CASC reader
may enforce stricter record/block limits. Reads propagate cancellation; callbacks
must honor their signal, and the caller owns worker termination on cancellation.
Temporary Python files are removed and JS-owned binary input buffers are wiped.
Python/string copies and runtime heaps are not claimed securely erased.

The synthetic reference runs the original script using ten authored tiny atlas/HUD
images and two authored tables. Only its read/decode boundary is substituted. It
covers all nine class atlases, unknown-class fallback, the original common-action
override, all PNGs and the complete generated C index. Chromium compares EVERY
output byte and rejects missing trust metadata or changed source bytes. This proof
tests native-art generation independently of the existing C/WASM texture decoder;
it does not claim a production dump was tested.

## Remaining gates

Native skill atlases use padded frame pitch (e.g. 4080 atlas width, 65 frame width,
68 pitch, 60 frames). The prior single-frame v61 helper deliberately rejects this;
the new `NativeArtTextureClient` in `web/native-art-texture.mjs` uses the existing
texture worker's explicit descriptor decode operation, not the crop helper. It
validates padded frame extents without changing stored width/height. CI adds an
independent native 136×65, frame-width65/pitch68 two-frame atlas oracle and compares
every RGBA byte. This proof passed at commit `b90743b5b70fdf9ffa895dfd1d54a0201ad270c7` in
[asset CI run 39399152831](https://github.com/n3crosis/d2r-mobile/actions/runs/39399152831),
along with exact native-art PNG/C bytes and corruption rejection. Callers supply
`decodeAtlas: (bytes, options) => client.decodeAtlas(bytes, options)` and close the
client when the stage finishes. No existing texture adapter checks were relaxed.
This stage is not yet an automatic packaging-job stage. Trusted shell table counts,
full HUD/map-goal/font generation, remaining overlay generators and matching release
inventory still block a complete production IPA pipeline.
