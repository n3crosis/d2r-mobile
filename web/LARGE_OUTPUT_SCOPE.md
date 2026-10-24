# Opt-in large-output foundation

`zip64-writer.mjs` is a bounded streaming STORE ZIP64 writer, available through
explicit opt-in in the packaging coordinator with a required archive budget. It
is **not wired into the UI or a complete IPA conversion path**. Default ZIP32
limits and APIs are unchanged. This does not establish large-IPA installation
compatibility, game conversion, device memory viability or a full export workflow.

## API and ownership

- `writeZip64(entries, sink, { maxTotalBytes, signal? })` returns
  `{ entries: number, bytesWritten: bigint }` after close succeeds.
- Entries: `{ path, size, mode?, chunks: () => AsyncIterable<Uint8Array> }`.
  Sizes accept unsigned BigInt or exact nonnegative safe integers. Modes are
  regular files, `0o644` or `0o755`. No directories, symlinks, compression,
  encryption, secrets, cache keys or OPFS persistence are added.
- `maxTotalBytes` is mandatory, includes payload **and archive overhead**, and
  must fit unsigned 64-bit. There is no unbounded default. The caller chooses an
  appropriate destination/storage budget before invoking the writer.
- `planZip64(entries, { maxTotalBytes })` computes exact declared-size offsets and
  output size without pulling sources. It does not verify source availability,
  actual byte counts, CRC correctness or free disk space.
- `zip64EndRecords({ entries, centralOffset, centralSize })` encodes metadata,
  not a complete archive. It enables exact BigInt record inspection.
- Sink: asynchronous `write(Uint8Array)`, `close()`, `abort(error)`. An already
  authorized FileSystemWritableFileStream meets that contract directly. No browser
  adapter or permission acquisition is introduced. Never collect large output in
  a buffering sink; sinks own their memory use and rollback guarantees.

All declared budgets and path conflicts are checked before writes/source pulls.
Names use shared safe path validation, UTF-8 bytewise order and fixed 1980-01-01
DOS timestamps. Metadata is bounded to 8 MiB serialized overhead, 20,000 entries,
and 4,096 UTF-8 bytes per name. Additional JS object/string overhead is bounded by
these limits. Chunks are at most 4 MiB; the writer retains one chunk and bounded
per-file metadata, never complete payloads or output. Actual sizes must match.

Writes are awaited before pulling more source data. Producers must keep yielded
buffers unchanged until the next pull; sinks must finish consuming buffers before
resolving. Cancellation checks occur around reads/writes but cannot interrupt
uncooperative promises. Input/write failures and pre-close cancellation trigger
best-effort abort, never close. Starting close is the commit boundary: subsequent
cancellation is ignored. A failed close triggers abort but does not guarantee
rollback. The caller must discard partial output after failure.

## Format reference

Primary source: [PKWARE APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT),
sections 4.3.7, 4.3.9, 4.3.12, 4.3.14–16 and 4.5.3. The writer always uses ZIP64
size/offset extras, signed data descriptors, ZIP64 end record and locator, and a
legacy sentinel end record. Records are single-disk/little-endian. CRC32 is
calculated over every actual input byte.

## Local verification

The optional `zip64` profile in [TESTING.md](TESTING.md) processes a real
4 GiB + 4 MiB synthetic CRC stream with bounded memory and an independent Python
zlib check. It does not save or extract a multi-gigabyte archive, prove browser
quotas or establish app compatibility. Ordinary unit tests include small archives
checked with Python `zipfile`; virtual large-offset tests check arithmetic only.
