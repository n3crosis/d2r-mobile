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

## Supplemental-pack metadata primitives

These standalone synchronous helpers inspect storage specs and patch references.
The separate worker action is documented in the
[asset runtime](../asset-runtime-js/README.md#dedicated-external-reference-casc-action):

- `inspectCascPackStorageSpecs(vfs, entries)` accepts decoded TVFS bytes and ordered
  `{path, oldEkey}` requests. It returns a frozen array of frozen
  `{path, oldEkey, specIndex, spec, encodedSize, decodedSize}` records. Specs are
  exactly `n`, `z` or `b:256K*=z`; old keys are returned as lowercase hex.
- `patchCascPrebuiltReferences(vfs, records)` accepts
  `{path, oldEkey, newEkey, encodedSize, decodedSize}` records and returns a new
  TVFS byte array. It resolves all old references and validates all changes before
  copying TVFS once. Only the selected EKeys and encoded/decoded lengths change;
  every original spec index, path table and unrelated byte stays unchanged.

`CASC_PACK_METADATA_LIMITS` allows 32,768 requests and 8 MiB aggregate UTF-8 path
bytes, with 4,096 bytes per path and the existing 16 MiB table bound. These are
metadata-only budgets, not changes to the overlay's 4,096-job/64 MiB payload caps.
Requests must use canonical lowercase safe paths; duplicate paths or old keys,
missing or ambiguous keys, unaligned CFT hits and any `add` field reject. Replacement
lengths must be unsigned 32-bit integers. Input TVFS bytes are never mutated, and
all lookups use the original table, so swapping two keys cannot redirect a later
lookup to an already changed record.

These helpers validate metadata structure only. The supplied path-to-old-EKey
association must come from the authenticated input workflow; they do not establish
that association, authenticate an external pack, verify its byte extents/checksums,
reserve archive locations, or prove that replacement payload encoding matches its
preserved spec. Those are separate caller obligations. No payload is accepted and
no new path is inserted. Exact unique matching shares the existing CFT search
semantics, including rejection of a second unaligned occurrence. The CFT search
string is constructed once per call, but each requested key still requires a scan;
large requests should run off the UI thread.

Run `node --test web/tests/casc-pack-metadata.test.mjs` for synthetic spec/size,
mutation, key-swap, rejection and 27,000-request checks. The original serializer
parity suite remains an independent regression check.

## Compression is not interchangeable

The bundled CPython uses zlib 1.2.13, while bundled Pillow uses zlib 1.3.1.
`../png-codec-exact` builds both source-pinned versions into one small standalone
WASM codec, prefixing the 1.2.13 compressor symbols. CASC calls only its 1.2.13
level-9/default-parameters stream, without intermediate flushes. PNG continues to
use its distinct 1.3.1 backend. Browser CompressionStream or an arbitrary zlib
version is not substituted. SparkMD5 is used for legacy format checksums, not for
security or user-data authentication.

Production routing, backend assembly and runtime inventory are documented in the
[JavaScript/WASM asset runtime](../asset-runtime-js/README.md). Legacy proof and
developer workers also dispatch CASC without entering Python. The upstream Python
sources remain as build/reference material.

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
Native codec parity is not a WASM/browser result, and neither check establishes
full-game or device compatibility.

## Upstream thin-overlay review

The e3756f8 update to native `casc_overlay.py` only adds `link_source`/`--thin`
filesystem handling. The browser serializer already emits thin config/archive
outputs and never creates source symlinks; none of its pure CASC serialization
functions changed. The source pin was advanced after this semantic review, not
as evidence of a new native/WASM parity run.
