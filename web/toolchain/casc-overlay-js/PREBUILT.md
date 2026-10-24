# External-reference overlay transform

Chinese: [PREBUILT.zh-CN.md](PREBUILT.zh-CN.md)

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

## Reusable storage lookup

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
