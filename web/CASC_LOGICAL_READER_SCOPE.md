# CASC logical-file reader

`createCascLogicalAssets(indexedRomfs, { signal })` in
`casc-logical-reader.mjs` connects an authenticated `indexRomfs` result to the
asset adapter's `logicalAssets.read(path, { maxBytes, signal })` contract. This is
an implemented read boundary, not evidence that complete NSP-to-IPA conversion
has passed on actual game files.

## Trust and version boundary

- The caller must supply an index of the selected, immutable, authenticated RomFS
  image. The factory does not authenticate an NCA, select base/update versions,
  apply BKTR, or establish the supported game version. There is no `verified`
  boolean, checksum override, remote lookup, or generated substitute content.
- Native `dm/tools/dmx.py` supplies the semantics: skip the first manifest line,
  ignore comments and short rows, index lowercased logical paths with the last
  duplicate winning, and try the requested path, `data:` + path, then
  `data:data/` + path. Backslashes in requests become slashes. These aliases are
  not an OS filesystem traversal mechanism.
- Only key layout 0 is decoded. Its EKey carries the chunk/archive and big-endian
  40-bit offset; manifest chunk/archive must agree. Unknown layouts fail rather
  than silently inheriting layout-0 assumptions. Unsafe logical paths are rejected
  (controls, traversal components, empty components, extra colons).
- This does not implement TVFS traversal, CASC version discovery, manifest
  regeneration, or fallback from a missing update resource into another image.
  Missing manifests, archives and logical assets are errors.

## Bounds and integrity

Only `data/build_manifest.psv` is read eagerly, in at most 64 KiB requests. Its
UTF-8 parsing is streaming, capped at 128 MiB input, one million rows, 16 KiB per
line and 4096 UTF-8 bytes per logical path. Metadata indexing does not read any
archive payload. Entries expose immutable native rows through an iterator, not
a second materialized list.

A requested record is mapped into a bounded local window for the existing
`archive-reader.mjs`. Absolute archive offsets and file sizes stay BigInt; only
record-relative offsets become Numbers. Each underlying RomFS read remains at
most 64 KiB. Files larger than the Number safe-integer range do not lose precision.
No archive-wide buffers or decoded-file caches are created.

The existing decoder's limits remain authoritative: 16 MiB encoded/decoded
records, 4 MiB blocks and 4096 BLTE blocks. A caller's larger `maxBytes` does not
relax these limits. Assets outside them fail explicitly; suitability for every
real game asset has not been established. Raw, zlib and BLTE N/Z records use the
pinned MD5 verifier. BLTE encoded-block digests, decoded length and CKey are checked
before bytes are returned. MD5 is format integrity, not authentication.

A per-read abort signal and the factory's lifetime signal both apply, including
to underlying RomFS reads. Expired native mount-reader errors propagate. Returned
byte arrays are owned by the caller and cannot mutate the manifest or archive.
