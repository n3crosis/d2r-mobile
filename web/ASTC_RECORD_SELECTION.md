# Authenticated ASTC record selection

中文: [ASTC_RECORD_SELECTION.zh-CN.md](ASTC_RECORD_SELECTION.zh-CN.md)

This is an isolated source candidate, not UI wiring or device validation.

`enumerateAuthenticatedAstcRecords(extracted, selection, { signal })` starts with
`readAuthenticatedAssets`, checking the private extraction identity, exact selected
build and live session. It returns frozen `{ textures, descriptor }`. Each texture
or descriptor is a frozen `{ path }` capability, not a manifest row. Missing
descriptor is `null`; downstream conversion must require it before publishing a
complete pack. Copies, caller EKeys, fabricated rows and authentication flags
cannot mint capabilities.

`openAuthenticatedAstcRecord(capability, { signal })` returns `{ source, record }`
for trusted decoder wiring. `source` exposes a BigInt archive size and
`readAt(BigInt offset, count, { signal })`; reads are limited to 64 KiB and the
selected encoded extent, with live session checks before and after each read.
`record` contains `{ offset: bigint, encodedSize, decodedSize, encoding, ckey, ekey }`.
Its archive name, chunk, archive number, offset and sizes come only from the bound
manifest. Sizes must fit uint32, and the extent must fit the authenticated archive.
This is metadata provenance, NOT proof of payload integrity: pass this pair directly
to the bounded streaming decoder, which must verify CKey/EKey before publishing
staged bytes. The generic decoder also accepts synthetic low-level inputs; never
use that acceptance as an authentication flag.

The separate ASTC scan reads authenticated `data/build_manifest.psv` in at most
64 KiB slices. Native ASTC semantics remove the first colon prefix, lowercase the
path and retain the first matching normalized path. It enumerates `.texture`
paths plus `data/hd/texture_desc_cache.json`, keeping at most 32,768 unique records
and 8 MiB of retained UTF-8 metadata. Manifest, line, path and row ceilings remain
128 MiB, 16 KiB, 4 KiB and one million respectively. No archive or decoded content
is cached. Generic logical lookup remains LAST-row-wins, unchanged. This extra
scan does not remove the existing generic extraction index or its memory cost.

Enumeration cancellation invalidates its retained capabilities. Opening/read
cancellation is combined with that lifetime signal, and disposal revokes both
unopened and already-opened sources. Low-level `createCascAstcRecords` is exported
for synthetic parser tests and grants no authentication on its own.

Tests: `node --test web/tests/astc-record-selection.test.mjs` covers synthetic
first/last duplicate behavior, descriptor selection, metadata and read bounds,
forged identities, copied tokens, wrong selections, cancellation and revocation.
No game, keys, real archive payload or device was accessed.
