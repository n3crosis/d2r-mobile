# Bounded RomFS tree index

Status: implemented, with synthetic tests queued for GitHub CI. This is not proof of positive signed-NCA extraction, complete NSP-to-IPA packaging, or game compatibility. No real keys or game data are fixtures.

`romfs-tree.mjs` exports `indexRomfs(source, { signal })` and fixed `ROMFS_LIMITS`. The source is an immutable authenticated final IVFC data level, with `size: bigint` and `readAt(offset: bigint, count: number)` returning bytes synchronously or asynchronously. All offsets are relative to that level, not the NCA. Only the authenticated NCA boundary may supply production input. The JS parser cannot establish authenticity from an arbitrary object or a boolean flag. A boundary-backed adapter must retain its image generation and reject reads after dispose/reopen; it must never silently switch images beneath an existing index.

The result contains frozen `files`, `directories` (including the empty root path), and `getFile(exactPath)`. Each file has `path`, `size: bigint`, and asynchronous `readAt(relativeOffset: bigint, count: number, { signal })`. Reads never span more than 64 KiB and cannot leave that member. Zero-length reads at EOF are allowed. No full-file, full-image, or extraction-to-filesystem operation exists. Returned bytes are copied away from reusable reader buffers. Consumers must impose their own backpressure and aggregate read/concurrency budgets; requesting and retaining many valid chunks is not bounded by this module.

## Parsing and bounds

Layouts follow the pinned official hactool revision `1d64a83450e025622f3468c28fc4164dad2c5ef6`, specifically [ivfc.h](https://github.com/SciresM/hactool/blob/1d64a83450e025622f3468c28fc4164dad2c5ef6/ivfc.h) and [romfs.c](https://github.com/SciresM/hactool/blob/1d64a83450e025622f3468c28fc4164dad2c5ef6/romfs.c). The parser is independent JS, not the upstream recursive walker.

- Exact 0x50-byte header; bounded, aligned, disjoint metadata tables before file data. Aggregate declared metadata including hash tables and header is at most 16 MiB; aggregate bytes read while indexing are independently capped at 16 MiB.
- Metadata is read one fixed record/name at a time. No metadata table or image-sized allocation is used.
- At most 100,000 total entries, including the root; directory depth at most 64; each UTF-8 component at most 255 bytes; paths at most 4,096 UTF-8 bytes and 16 MiB aggregate.
- Explicit traversal stack, visited offsets, expected parents, sentinel checks, complete metadata record coverage, and sorted range checks reject cycles, cross-parent links, overlapping records, unreachable records, duplicate paths and overlapping nonempty file payloads.
- Strict UTF-8/NFC names; no empty non-root names, traversal components, slash/backslash, control characters, Windows-special characters/device names, or trailing dot/space. Case-folded collisions are conservatively rejected. This deliberately accepts a narrower portable subset of RomFS names. It is not a general-purpose host-filesystem sanitizer or a guarantee against every Unicode/filesystem equivalence rule.
- Hash-table extents are checked, but hash buckets and per-record hash-chain links are not traversed or semantically validated. The directory/file tree is the source of paths. Authenticity belongs to the IVFC boundary, not these lookup hashes.
- BigInt is retained for image, data, member offsets and sizes, including positions beyond JavaScript's safe-integer range. Only small metadata offsets and read counts use Numbers.
- Cancellation is checked before and after each source read and between records. The index-lifetime signal also cancels later lazy reads; a per-read signal can cancel one operation. This cannot interrupt an underlying synchronous WASM call; terminate the disposable Worker to interrupt native verification.

## Validation

`tests/romfs-tree.test.mjs` uses only in-memory synthetic metadata and sparse simulated data. Coverage includes >2^53 image offsets, lazy 1 TiB files, nested indexing, root and file cycles, invalid pointers/parents, unreachable tables, malformed table/name/data bounds, traversal/UTF-8/case collisions, payload overlap, path/depth limits, cancellation, short reads, and reusable buffers. Local checks are syntax, formatting, and file-scoped lint only; the full test suite remains for GitHub CI. BKTR merging, authentication, CNMT selection, streaming conversion, UI wiring, and production-key handling are outside this module.
