# JavaScript CASC overlay serializer

`overlay.mjs` ports the original bounded `casc-overlay` operation, including native
TVFS/CFT layout, compressed path tries, insertion ordering, BLTE block headers,
MD5 checksums/EKeys, config aliases and archive naming. Input remains the exact
concatenated config + decoded TVFS tables + ordered replacements and trusted
`parts`, `jobs`, `location` options. No synthetic production fallback is present.

- `createCascOverlayTransform({md5, compress})` provides the pure byte serializer.
- `createPinnedCascOverlayTransform({codec, SparkMD5})` binds the production
  implementations and requires the codec's generic zlib version to be `1.2.13`.
- Input/output limits remain 64 MiB; tables/replacements remain 16 MiB; at most
  4,096 jobs. Path depth, encoding specs, extents, unique CFT matches and unchanged
  old path offsets are checked. Output file names and receipt fields are preserved.
- The original functions and bounded adapter, plus vendored SparkMD5, are source
  pinned by `scripts/verify-source.mjs`; runtime bytes use the existing SHA inventory.

## Compression is not interchangeable

The bundled CPython uses zlib 1.2.13, while bundled Pillow uses zlib 1.3.1.
`../png-codec-exact` builds both source-pinned versions into one small standalone
WASM codec, prefixing the 1.2.13 compressor symbols. CASC calls only its 1.2.13
level-9/default-parameters stream, without intermediate flushes. PNG continues to
use its distinct 1.3.1 backend. Browser CompressionStream or an arbitrary zlib
version is not substituted. SparkMD5 is used for legacy format checksums, not for
security or user-data authentication.

The existing runtime build adds this codec stage before sealed asset preparation.
The production and developer workers dispatch CASC before entering Python.
`casc_overlay.py` and `casc_overlay_original.py` are no longer in the prepared
runtime inventory. The upstream sources remain as build/reference material.

## Focused checks

From the repository root:

    node web/toolchain/casc-overlay-js/scripts/verify-source.mjs
    node web/toolchain/casc-overlay-js/test/parity.mjs
    node web/toolchain/casc-overlay-js/test/worker-routing.mjs

The default parity run uses the actual packaged CPython 1.2.13 compressor as an
injected dependency, isolating the JavaScript serializer and comparing complete
archive/config bytes and inventory against the original bounded adapter.
Fixtures exercise raw/zlib/BLTE modes, empty and multi-block content, trie additions,
common prefixes, same-position insertion, job ordering and malformed inputs.

After the existing emsdk 4.0.20 build produces the codec, verify the independent
WASM implementation end-to-end with:

    node web/toolchain/casc-overlay-js/test/parity.mjs --wasm

The WASM recipe fails on source or version drift and nonempty host imports.
It was not possible to execute that build locally because emcc is absent; the
same existing CI build must prove this artifact before deployment. Native codec
parity is not relabeled as a WASM/browser result. No full-game/device evidence is
claimed, and no .NET code changes are made.

Seven Python asset operations remain: image-default-frame, native-art, hud-v4,
map-goal, mercenary-art, remaining-art and overlay-recipe.
