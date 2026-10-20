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

Native checks have been run locally. Official Emscripten compilation, Node/WASM
differential checks and actual Chromium dedicated-worker checks passed in
[CI run 39395178181](https://github.com/n3crosis/d2r-mobile/actions/runs/39395178181)
at commit `1db2b64b8a6d8512fb9492369bde823419ab40a3`. This includes the explicit
`HEAPU8`/`HEAPU32` runtime exports required by Emscripten 4.0.20. No game texture
validation or end-to-end asset-generation parity is claimed.

## Notices

Build output preserves the repository license, full bcdec license and embedded
notices, original NVN layout attribution, and deko3d's zlib notice. The latter was
verified against https://raw.githubusercontent.com/devkitPro/deko3d/master/LICENSE.
The native layout file is an altered port, not original deko3d source. Native
sources and their notices are not edited by this spike. SHA256SUMS identifies the
built JS/WASM pair. Release integration must keep `dist/licenses` with that pair.

## Original BC3 encoder and v61 packing (separate API)

`texture-encode-client.mjs` adds `TextureEncodeClient`, separate from the decoder
and its unchanged v61 crop guards. `encodeAndPack({templateHeader, rgba, width,
height}, {signal})` returns `{linearBC3, sprite, width, height}` as owned Uint8Arrays.
`packLinearBC3({templateHeader, linearBC3, width, height}, {signal})` packs an
already encoded tight row-major BC3 image without initializing Python. The
complete `sprite` is the header plus zero-padded native block-linear storage.
Input arrays remain owned by the caller. Only one request may be in flight;
`AbortSignal` or `close()` terminates the worker and both runtimes, rejects with
`AbortError`, and a subsequent request creates a fresh worker. No partially
encoded output is returned. Synchronous codec work cannot process an in-worker
cancellation message, so worker termination is intentional.

The codec is **not a new approximate JavaScript/C BC3 implementation**.
`package-encoder.py` verifies SHA-256
`5c3a4b1985625ba5ba7f727e0fd77afc1b835b1f9b3ca6337dbdc36626bea073` of
`dm/ios/tools/gen_widestash_art.py`, extracts only the unmodified original `bc3`
function and records provenance in `dist/encoder-provenance.json`. It runs under
the existing self-hosted asset-generation Pyodide 0.27.7 NumPy/Pillow runtime.
No native module imports, filesystem entrypoints, subprocesses or compilers from
the source script are shipped. `bounded_encoder.py` invokes that exact function
on independent four-row bands, bounding NumPy's temporary tensors while retaining
original block ordering, edge replication, endpoint selection and tie behavior.
Native full-image versus banded output is compared byte for byte.

`texture_pack_bc3` revalidates geometry and exact buffer lengths, zeros unused GOB
bytes, and calls unchanged `nvn_swizzle`. The JS header update matches original
`pack`: fields at 6, 8, 12, 20 and 32 change; all other original bytes are retained.
Templates must be exactly 40 bytes, SpA1 v61, one frame, valid bounded original
dimensions, and display width within the original one-frame four-pixel-padded
extent. Output is a single frame with display width equal to output width.
Maximum 8192 per dimension and 4 Mi pixels; maximum input RGBA is 16 MiB.
No array/mip-chain encoding, multi-frame template extraction, ASTC encoding or
other BC encoding is implemented. This primitive alone does not reproduce the
wide-stash image composition or authorize replacing arbitrary atlas layouts.

CI additionally generates 24 original full-image NumPy BC3 + original native
`pack` reference cases (solid/gradient/alpha/noise; 1×1 through edge-aligned and
nonaligned 68×65). It compares every linear BC3 byte and full packed sprite byte
against Node/WASM and actual Chromium/Pyodide output, exercises malformed lengths,
geometry/format/frames, and tests cancellation plus clean worker restart. This
new encoder proof is pending CI; previous decoder green runs do not establish
encoder parity. To prepare locally or in CI after installing the pinned runtime:

```sh
python3 web/toolchain/texture-spike/package-encoder.py
python3 web/toolchain/texture-spike/native-encoder-fixtures.py
node --test web/toolchain/texture-spike/encoder.test.mjs
PLAYWRIGHT_ENTRY=/absolute/path/to/playwright/index.mjs \
  node web/toolchain/texture-spike/encoder-browser-smoke.mjs
```

Deployment must include `dist/original_bc3.py`, `bounded_encoder.py`, the encoder
worker/modules, the existing same-origin asset runtime and its license notices,
and the texture WASM/license bundle. No browser CDN fallback is used.
