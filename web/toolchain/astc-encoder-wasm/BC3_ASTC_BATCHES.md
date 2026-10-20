# Bounded BC3-to-ASTC batch orchestration

[简体中文](BC3_ASTC_BATCHES.zh-CN.md)

Isolated, unintegrated source building block. This combines the existing bounded BC3 decoder and ASTC worker client; real browser WASM transcoding remains unverified. Tests explicitly inject a fake codec, not Arm ASTC encoding. No production UI, CI, game files, texture metadata rewriting, or pack writer is involved.

## Contract

`transcodeBC3Batches(source, { profile, signal, batchBlocks = 65536, encode })` is a lazy async generator. `source.size` must be a nonnegative safe integer multiple of 16. Zero bytes yield nothing. `source.readAt(offset, length, { signal })` must return or resolve to an exact-length, fixed, non-shared Uint8Array view. Short reads and oversized reads fail; the generator never retries or silently truncates them. The profile must explicitly be `linear` or `srgb`. `encode` defaults to `encodeAstc4x4`; overriding it is a dependency-injection seam, not an alternative verified codec.

Each yielded item contains `blocks` (Uint8Array of raw ASTC blocks), `blockOffset`, `blockCount`, `completedBlocks`, `totalBlocks`, and `profile`. Offsets/counts are in blocks, not bytes. Completed counts increase after encoding succeeds and reach the total only for a completely consumed successful generator. Counts are caller-visible progress information, not a persisted transaction record.

Only one read and one encode are awaited at a time. The next batch is not read until the consumer requests another item; there is no prefetch queue. Batch size is 1–65,536 blocks, at most 1 MiB compressed input and 1 MiB yielded ASTC. The decoder's default 1024-block row grid bounds RGBA to 4 MiB including final row padding. The padded ASTC length is validated before trimming. Only trailing zero-grid padding is removed; genuine source blocks are never reordered or trimmed. The source is sampled in increasing byte offsets.

Consumers must write or consume each yielded chunk and release it before advancing; collecting all chunks intentionally retains a whole output and defeats streaming. This module does not retain a complete texture or pack, perform output writes, or provide rollback if a later batch fails. Callers own partial-output cleanup. Transfer of RGBA to the real worker consumes that intermediate buffer; the source input is not detached or changed. A final partial grid may briefly require both padded encoded output and its compact copied prefix. Browser/module overhead, source caching, and delayed garbage collection are additional memory, not included in the buffer bounds.

## Cancellation and limitations

An AbortSignal is checked before work, after reading, and after encoding. It is forwarded to both source and codec. Waiting for either operation is abortable even if the injected operation ignores the signal, but the underlying source can only release its own pending I/O resources if it honors that signal. The real encoder client terminates its disposable worker. An ignored abort in a custom codec cannot be forcibly stopped by this generator. Synchronous decoding is bounded; it is not cooperatively interruptible mid-function. Calling `return()` or breaking iteration while paused at a yielded result prevents subsequent reads; use the signal to cancel an operation already pending.

A caller that cancels or stops early must not treat prior chunks as a complete texture. This does not interpret texture dimensions, mip boundaries, block-linear tiling, descriptor caches, thumbnails, or CASC layout. It is not the complete native `astc_pack.py` workflow, and source-equivalent BC3 decoding does not establish real BC3-to-ASTC transcode parity.

## Verification

`node --test bc3-astc-batches.test.mjs` passes four deterministic fake-codec tests. They cover lazy sequential processing, a 65,536-block batch plus a three-block padded tail, bounded output, monotonic counts, exact tail trimming, malformed lengths/profiles, short reads, invalid codec lengths, empty input, cancellation before/during read and encoding, consumer stop, and preservation of decoded source-block identity across three batches. Real WASM compilation, browser execution, encoding quality, and native-versus-browser block equivalence remain outstanding.
