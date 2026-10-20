# Bounded archive record decoding

`archive-reader.mjs` is a read-only browser core, not a game-data importer or IPA converter. It accepts an already resolved record and a `preflight.mjs` source adapter. It uses only bounded `readRange` calls; it never reads an entire archive. `archiveLocator` interprets the native key-layout-0 chunk/archive/40-bit offset without 32-bit truncation.

## Supported contract

- Raw native `n` and zlib-wrapped `z` records, and table-bearing BLTE with uppercase `N`/`Z` blocks. BLTE is detected by magic, as in `dm/tools/dmx.py`. Headerless BLTE, encryption and other modes are rejected.
- Fixed limits: 16 MiB encoded/decoded record, 4 MiB encoded/decoded block, 4,096 blocks. Raw records count as one block. Metadata and block extents/totals are validated before allocating the output or reading payloads. The whole decoded record is retained for final authentication; this is not an arbitrary-size streaming export.
- Zlib uses built-in `DecompressionStream("deflate")`; unsupported environments fail explicitly. Compressed input is submitted in at most 1 KiB slices with each writer.write awaited for backpressure, while a concurrent reader copies decoded chunks directly into the declared bounded output, never accumulating them. Overflow or cancellation stops the producer, cancels the reader, aborts the writer, and awaits both tasks before returning. An oversized decoded chunk is rejected before copying. Chromium may transiently expand each input slice in native code before JavaScript can inspect its output. Small slices limit the input to each such synchronous operation but are not a measured or asserted strict browser peak-memory bound. Browser-internal decompressor buffering remains implementation-controlled.
- Every BLTE encoded block (including its mode byte) requires MD5 verification, matching `casc_overlay.py`'s emitted checksums. Final decoded content requires CKey MD5 verification, matching `dmx.py`. This is integrity checking, not proof of trusted provenance.
- A trusted, mandatory `verifyMd5(bytes, expectedHex, context)` callback must return exactly `true`. WebCrypto lacks MD5; the browser integration supplies the dedicated [checksum verifier](CHECKSUM_VERIFIER_SCOPE.md). This reader does not silently skip verification. The callback must treat input bytes as read-only and cooperate with `context.signal`; the decoder checks cancellation before/after calls but cannot interrupt a non-cooperative verifier or source adapter.
- Abort signals are checked around range reads and checksums, and cancel the decompression reader. No partial output is returned on any failure.

## Evidence and exclusions

Tests generate synthetic fixtures with Python stdlib and decode them through the actual native `dm/tools/dmx.py` using an in-memory archive as an independent oracle. Node MD5 is used only in tests. Coverage includes corrupt checksums, malformed tables, oversized metadata/output, truncation, unsupported modes, cancellation and sparse virtual offsets above 4 GiB, without large allocations or game files.

This does not parse manifests/TVFS, authenticate the EKey storage-header digest, resolve archive dependencies, supply MD5 for browsers, alter resources, handle NSO/shaders, or produce/install an unsigned IPA. No game version or real archive compatibility is claimed. Chromium browser/device execution and end-to-end integration remain separate work.
