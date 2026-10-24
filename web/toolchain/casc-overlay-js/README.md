# JavaScript CASC overlay serializer

[简体中文](README.zh-CN.md)

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

## External-reference overlay transform

`createCascPrebuiltOverlayTransform({md5,compress})` and its pinned wrapper
`createPinnedCascPrebuiltOverlayTransform({codec,SparkMD5})` expose a separate
internal transform. The existing default transform API, limits and bytes remain
unchanged. No UI, export or source-authentication capability is provided here.

The returned function consumes `(payload,{parts,jobs,location})`. Segments are
`[config, original TVFS, root TVFS, ...ordinary replacement bytes, external JSON]`.
`parts.length === 4 + jobs.length`; ordinary jobs may be empty. External JSON is
UTF-8 `{pack:{name,size,sha256},records:[{path,oldEkey,newEkey,encodedSize,decodedSize}]}`.
It is capped at 16 MiB within the unchanged 64 MiB total payload cap. Ordinary
jobs retain their 4096 limit; external records must number 1–32768 with at most
8 MiB total normalized path bytes. No external additions are accepted.

The pack filename is canonical decimal `<chunk>-<archive>.data` (minimum widths
2 and 8, each component 0–255). It must differ from the overlay archive. Pack
size is a positive safe integer no greater than 2^40; SHA-256 is 64 lowercase
hex digits. Every external EKey must encode that location and a 40-bit offset
whose encoded range fits the pack. Record sizes are unsigned 32-bit; zero-length
records are allowed. Hash text and range checks do not authenticate pack bytes.
The host must bind paths to authenticated original manifest keys, verify the
finalized pack hash, and reserve its location against original/planned archives.

All original CFT slots resolve before mutation. Duplicate external paths/keys
and ordinary/external path or slot overlap fail closed. Unlike native's overwrite
precedence, overlaps are intentionally unsupported. Mutation order is ordinary
replacements, external references, additions, TVFS and root serialization.
Ordinary encoded byte order/offsets remain unchanged; no pack bytes are copied.
The result is `{files,inventory,external:{count,pack}}`, where inventory contains
ordinary jobs only and the receipt does not duplicate external records.

Validation: `node --test web/toolchain/casc-overlay-js/test/prebuilt.mjs` uses
synthetic fixtures and unmodified native `make_overlay` as byte oracle with host
Python zlib on both sides. It covers ordinary/addition/external output, empty
ordinary jobs, overlap/location/range/metadata/count rejection and default-entry
rejection of the new payload shape. Existing default parity remains a separate
check. These tests do not establish pinned WASM streaming, browser performance,
real-game coverage, pack provenance, image quality or device compatibility.

### Reusable storage lookup

`createCascPackStorageLookup(vfs)` returns a frozen `lookup(entries)` function
with the same frozen storage-record result as `inspectCascPackStorageSpecs`.
Construct it once per pipeline, then inspect bounded individual records without
rebuilding the entire CFT search string. It takes one private VFS snapshot of at
most 16 MiB, parses its layout once and constructs one immutable CFT binary
string. Later mutation of the caller's buffer cannot change lookup results.
No mutable snapshot or unbounded cache is exposed. Retained memory is one VFS
copy plus one CFT string and parsed layout metadata, bounded by the existing
16 MiB table limit (string storage is engine-dependent).

Every request retains the count/path-byte, missing-key, unique-byte-occurrence
and aligned 25-byte CFT checks. An unaligned second key occurrence still rejects.
Substring scans remain linear in CFT size per lookup; this removes repeated
whole-table allocation, not all lookup CPU cost. Existing default serializers
and one-shot APIs are unchanged. Metadata tests cover repeated queries,
Buffer mutation isolation and unaligned duplicate rejection.

## Bounded CFT storage lookup

`createCascPackStorageLookup(vfs, { expectedQueries = 0 })` snapshots the bounded
TVFS once. The optional hint must be an integer from 0 through 32,768. Only when
both CFT record count and expected queries are at least 2,048 does it choose the
compact index. Omitted hints and smaller batches retain the substring path.
The ASTC coordinator passes its existing selected-token count, including the
descriptor, without another manifest or early record opens. The hint grants no
trust and changes no metadata limits or output bytes.

The index retains two Uint32 arrays and one Uint8 array: 9 bytes per CFT record,
243,000 bytes for 27,000 records, and under 6 MiB at the existing 16 MiB TVFS cap.
These figures exclude the common immutable snapshot, object overhead and sort
scratch memory. The indexed path retains no duplicate CFT search string or path
manifest. The default path retains a CFT-length string whose actual memory use
is engine-dependent.

Aligned keys are ordered by a 32-bit rolling fingerprint and then the complete
16-byte key. Binary search uses that same ordering, including collisions; no
collision bucket or duplicate-key group is scanned linearly. Every possible
16-byte window in the CFT is checked, including unaligned and cross-record
occurrences. Counts saturate at two. Only an exactly unique aligned key is
accepted. Fingerprints are not integrity or authentication proofs. Existing
path, key, size, range, request-duplicate and snapshot checks remain unchanged.
Index construction takes O(B log N + N log N) bounded work, lookup O(log N),
where B is CFT bytes and N is record count; full-key comparisons are 16 bytes.

### Synthetic Node samples

Outside-repository prototype samples on the development host included build and
query time. At 27,000 records / 675,000 CFT bytes, substring versus indexed totals
were approximately 1 versus 181 ms for one query, 96 versus 161 ms for 512 queries,
377 versus 155 ms for 2,048 queries, and 5,023 versus 166 ms for all 27,000 queries.
At 128 records with all queried, totals were 0.12 versus 0.52 ms. At 2,048 records
with all queried, totals were 20 versus 9 ms. These samples motivate a conservative
2,048/2,048 threshold, not a browser/device performance guarantee or game test.

A separate single synthetic sample used the actual revised factory on Node
24.19.0 with the same 27,000-record fixture and 27,000 individual lookups.
Default construction (snapshot and validation included) took 26.8 ms, followed
by 5,160.9 ms of lookups and receipt work, totaling 5,187.6 ms. Indexed construction
took 195.6 ms, followed by 253.3 ms of lookups and receipt work, totaling 448.9 ms.
Both paths performed identical JSON serialization and receipt hashing, and their
output receipts matched exactly. These are production-factory Node measurements,
not the prototype timings above or a browser/device guarantee. The small-batch
tradeoff and conservative threshold remain unchanged.

Focused differential tests compare both paths for valid and absent keys, aligned,
unaligned and cross-record duplicates, all-identical keys, genuine fingerprint
collisions, source mutation, invalid hints and both threshold boundaries:

    node --test web/tests/casc-pack-metadata.test.mjs
