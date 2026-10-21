# Verified streaming archive staging

[简体中文](ARCHIVE_STREAM_READER.zh-CN.md)

`archive-stream-reader.mjs` adds a separate bounded staging API. It does not modify `decodeArchiveRecord`, its defaults, or its 16 MiB whole-record limits. It does not authenticate a path-to-EKey association or establish first-manifest-row semantics. Those decisions belong to the authenticated extraction layer.

## Public API

`stageArchiveRecord(source, record, { root, maxDecodedBytes, maxEncodedBytes, signal, createStage })`

- Source: `{ size: bigint, readAt(offset: bigint, count: number, {signal}) }` for the same immutable archive throughout the operation. Every archive request is at most 65,536 bytes. Absolute offsets remain BigInt.
- Record: `{ offset: bigint, encodedSize, decodedSize, encoding, ckey, ekey }`. Sizes are nonnegative safe integers. Both 32-character hexadecimal keys are mandatory. The EKey's 40-bit offset must equal the record offset. The caller's trusted layer must establish the correct archive and path association; the decoder cannot authenticate EKey chunk/archive fields against an anonymous source.
- Explicit encoded and decoded total budgets are mandatory safe integers no greater than uint32 maximum. BLTE supports larger totals than the original whole-buffer API without changing that API. Original 4096-block and 4 MiB per-encoded/per-decoded-block limits remain. Non-BLTE n/z retain their original 4 MiB single-block limits.
- The stage defaults to `createRawFileStage`, requiring a caller-owned OPFS root. Injection is for an equally owned stage with `append`, `finalize`, and `dispose`, not an authentication mechanism. It receives `{root,maxBytes:decodedSize,signal}`. No RAM fallback is provided.
- Success returns `{size:number, readAt(offset:number,count:number,{signal}), dispose()}`. Reads are relative to decoded content and capped at 1 MiB. Only successful complete verification exposes this capability. No partial output chunks or unverified File handle escape. Dispose it when no longer needed; subsequent reads fail.

## Verification and resource boundaries

BLTE detection follows magic bytes, including when the declared spec is n. The header flag, entry count, exact header size, encoded/decoded extents, and exact totals are validated. Only uppercase N and Z block modes are accepted. The EKey digest prefix covers the BLTE header, or the entire encoded non-BLTE record. Every BLTE block MD5 includes its mode byte. Full decoded CKey is computed incrementally and must match before stage finalization.

To preserve verify-before-decode ordering, encoded blocks are hashed in at most 64 KiB slices. Blocks up to 1 MiB are cached once and decoded from the verified cache, avoiding duplicate authenticated payload reads for ordinary blocks. Larger blocks are reread from the same immutable source for decoding instead of retained. The decode pass checks encoded checksums again and requires its full MD5 to equal the first pass, including non-BLTE records whose EKey stores only a digest prefix. Changed second-pass bytes cannot be published even when they decode to identical content. Only one encoded cache is live in the algorithm at a time; header sniffing and table reads remain separate. Mutable sources violate the source contract; rereading is not a substitute for extraction authentication.

Uncached compressed blocks now use independent at-most-64 KiB second-pass read windows, while still feeding the decompressor sequentially in at-most-1 KiB slices with per-slice cancellation checks. This trades a fixed window of up to 64 KiB for fewer authenticated source/RPC calls; it does not raise read limits, the 1 MiB cache threshold, or output budgets. The second-pass full encoded MD5 check is unchanged.

Raw output is appended in at most 64 KiB chunks. Zlib input is fed in 1 KiB sequential, backpressured slices while output is drained concurrently, checked against the declared decoded block size, and copied into owned at-most-64 KiB stage chunks. No decoded-record-sized buffer is created. BLTE metadata occupies at most 98,316 header bytes plus bounded block descriptors, alongside at most one 1 MiB encoded-block cache. DecompressionStream's internal buffers, returned engine chunks, stage implementation, and delayed garbage collection add overhead: these buffer bounds are not a hard browser RSS guarantee. Run decoding in a bounded worker, not on the UI thread.

## Failure and cancellation

AbortSignal reaches reads and the owned stage. Waiting for pending host I/O is abortable, but the decoder does not claim it can forcibly cancel a source that ignores the signal. Decompression producer and consumer are stopped together. All failure paths dispose their acquired stage; late stage acquisition remains owned and is disposed when it arrives. External read/write/codec failure messages are sanitized before publication.

Cleanup is awaited for up to one second. If it is pending or fails, the error exposes a `cleanup` promise and a sanitized `cause`. Callers must retain/observe that promise rather than report cleanup complete. Distinct late acquisition and disposal failures reject this promise with the original internal failure, including AggregateError; these diagnostic details are not safe user-facing messages. The already-reported primary acquisition failure and a normal late AbortError after cancellation are not duplicated as cleanup failures. There is no publication or success capability before CKey verification, exact output size, and successful finalization. Callers should still impose an outer worker deadline for native browser operations that do not settle.

## Synthetic evidence

The focused tests compare n/z/BLTE bytes against the existing decoder, retain exact >4 GiB offsets, test empty n/z and BLTE-magic precedence, reject checksum/header/mode/bounds/short-read corruption, enforce decoded output size, and exercise cancellation plus late/pending cleanup. A 17 MiB synthetic BLTE record successfully stages through a counting sink without decoded-content retention; the original whole-buffer decoder still rejects that size. Regression tests cover delayed acquisition rejection, late disposal failure after the cleanup deadline, and changed large raw/compressed second-pass input (including unchanged decoded content). Tests use generated bytes only, no game files or keys. Existing archive-reader tests remain unchanged. Browser OPFS end-to-end evidence is still required; injected test sinks are not browser storage validation.

For a synthetic 2,097,495-byte encoded zlib record (2,097,169 decoded bytes), source calls decreased from 2,083 to 67: one prefix read, 33 verification reads, and 33 rather than 2,049 second-pass reads. Tests verify exact decoded bytes, serial reads and cancellation during window draining. These are operation counts, not browser/disk timing or RAM measurements.
