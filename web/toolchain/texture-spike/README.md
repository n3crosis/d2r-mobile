# Bounded browser texture dependency

This is an executable native/WASM dependency for the `romfs_art.py` v61
sprite path, **not completion of the full v61 asset pipeline**. No game-derived
textures, keys, fixtures, or generated game assets are included. Tests construct
compressed blocks and headers synthetically.

## Implementation and scope

`boundary.c` links the repository's unchanged `dm/gfx/nvn/nvn_tex.c`,
`dm/gfx/tex/nvn_deswizzle.c`, and `dm/gfx/tex/nvn_bcdec.c`. The latter uses
bundled bcdec 0.985 (upstream commit `80859ed`, see its bundled README).
The descriptor is the same 40-byte structure used by `romfs_art.py` ctypes;
compile-time size/offset assertions guard that ABI. Raw unsafe native entry
points are deliberately **not** exported by WASM.

Supported: single-layer, single-sample, 2D NVN BC formats `0x41` through `0x50`.
This includes BC1/2/3, unsigned/signed BC4/5, BC7, and signed/unsigned BC6H.
Output preserves native `nvn_bc_unpacked` semantics: RGBA8 (including sRGB
metadata), R8, RG8, or RGBA16Float little-endian half-float bytes. Signed R8/RG8
are returned as their byte representation, not coerced to RGBA. The
`pixelFormat` result is the native Metal format enum, **not** an NVN input enum.
No color-space conversion or premultiplication is applied.

Block-linear textures support complete bounded mip chains and explicit packaged
block height. Linear textures support one mip, explicit or auto-aligned stride;
linear arrays/mips are not silently treated as block-linear. Arrays, cubes, 3D,
MSAA, ASTC, raw/unrecognized formats and extra flags fail explicitly. This does
not replace the existing v31 raw-RGBA path.

Dimensions are 1–8192; levels cannot exceed the actual mip chain; packaged height
is 0 (automatic) or 1–6 (native encoded shift + 1). Source storage, decoded output,
and temporary compressed buffers are individually capped at 64 MiB. The WASM
heap is capped at 256 MiB. Source length must exactly match the declared complete
storage, including mip padding. Reject rather than guess at extra trailing data.
The C bridge revalidates input independently of JS and checks lengths before any
read/copy. Callers must still supply actual allocated C buffers of their stated
sizes; the bridge is not a sandbox for malicious arbitrary-pointer C callers.

## Browser integration

Import `createTextureDecoder` from `browser-texture.mjs` and the factory from
`dist/texture.mjs`; await `createTextureDecoder(factory)`. Its synchronous methods:

- `layout(descriptor, {level = 0, layer = 0})`: bounded storage/output geometry.
- `decode(descriptor, sourceUint8Array, options)`: returns owned `pixels`, `width`,
  `height`, `pixelFormat`, `bytesPerPixel`.
- `decodeV61(spriteUint8Array)`: additionally validates SpA1/version61 and horizontal
  frame width, reads dimensions at offsets 8/12, packaged layout at byte 23,
  and decodes DXT5 storage after byte 40. Returns RGBA8 plus `frameWidth`.

Descriptor fields are required, matching native order: `target`, `format`,
`flags`, `samples`, `width`, `height`, `depth`, `levels`, `stride`, `pkg_block_h`.
All are integer values. No unknown fields or silent coercion are accepted.

Alternatively use `texture-worker.mjs` as a module dedicated Worker. Send
`{id, operation: "decodeV61", source}` (or `decode` with `descriptor`/`options`,
or `layout` with `descriptor`/`options`). Transfer the input ArrayBuffer if ownership
can move. Responses are `{id, ok: true, result}` with transferred pixels or
`{id, ok: false, error: {name, code, message}}`. Calls are serialized. A failed
request does not poison later requests. Terminating the worker is the cancellation
boundary; synchronous native decoding cannot handle in-flight cancellation.
There is no image display, DOM access, game-file upload, logging, filesystem,
or telemetry. Normal same-origin module/WASM loading is still necessary.

Errors: -1 invalid geometry/descriptor; -2 unsupported format/header; -3 unsupported
shape/layout; -4 bounded allocation failure; -5 source/destination size mismatch.
Consumers should present errors, not silently fall back to incomplete output.

## Reproduction and evidence

CI `.github/workflows/texture-browser-checks.yml` installs official emsdk 4.0.20
from tag commit `e4fe26ef59168ff44f4c23c466e497bf60b3411e`, asserting the exact hash
before installing/activating 4.0.20. `build-wasm.sh` checks the compiler version.
No SDK is downloaded or executed by the browser. Run:

```sh
bash web/toolchain/texture-spike/build-wasm.sh
python3 web/toolchain/texture-spike/native-fixtures.py
node --test web/toolchain/texture-spike/texture.test.mjs
PLAYWRIGHT_ENTRY=/absolute/path/to/playwright/index.mjs \
  node web/toolchain/texture-spike/browser-smoke.mjs
```

The native fixture producer calls the original layout/swizzle/deswizzle/decode
functions independently, compares bounded C output, and serializes 304 cases
covering all 16 BC enum variants, tiny/non-block-aligned dimensions, crossing GOB
boundaries, automatic/packaged tile heights, multiple mips, aligned linear layouts
and explicit odd stride. Node/WASM and Chromium dedicated Worker tests compare
layout words and every output byte against those native results. Independent
known-red BC1 and zero-BC3 oracles supplement same-source differential tests.
Malformed requests, heap growth, public worker transfer/recovery, and no external
traffic are tested. Generated fixtures are ignored, synthetic and local only.

Native checks have been run locally. WASM/browser checks are **CI gates**, not a
claim that the SDK/browser tests have already passed in this checkout. No game
texture validation or end-to-end asset-generation parity is claimed.

## Notices

Build output preserves the repository license, full bcdec license and embedded
notices, original NVN layout attribution, and deko3d's zlib notice. The latter was
verified against https://raw.githubusercontent.com/devkitPro/deko3d/master/LICENSE.
The native layout file is an altered port, not original deko3d source. Native
sources and their notices are not edited by this spike. SHA256SUMS identifies the
built JS/WASM pair. Release integration must keep `dist/licenses` with that pair.
