# Bounded texture-container streaming adapter

[简体中文](TEXTURE_STREAM.zh-CN.md)

Isolated source only, not production integration. `texture-stream.mjs` wraps `bc3-astc-batches.mjs` using the structural interpretation in `dm/tools/astc_pack.py`: format byte at offset 4, unsigned little-endian relative data pointer at offset 40, and `dataStart = 40 + pointer`. BC3 format 0x3d maps to ASTC 0x5f with linear encoding; 0x3e maps to 0x51 with sRGB encoding. Every other header byte is preserved exactly. The payload remains 16 bytes per block, so output file length and offsets are unchanged.

## Stream contract

`transcodeTextureStream(source, { signal, batchBlocks, encode })` consumes a readAt source with a nonnegative safe integer `size`. `readAt(offset, length, { signal })` must return an exact-length fixed, non-shared Uint8Array. It yields typed events:

- `skip`: reason `short-input` for fewer than 48 bytes, or `unsupported-format` with the observed numeric format. These cases produce no output bytes and no completion event. Skipping is explicit; unsupported files are never silently rewritten.
- `header`: an owned byte chunk and its absolute output offset. The first event also reports original/new format, dataStart, and profile. Byte 4 alone is changed. The initial read is 48 bytes; subsequent header chunks are at most 64 KiB. Even an unusually long header is streamed rather than retained as a whole.
- `blocks`: raw ASTC byte chunk, absolute output offset, block count, completed block count, and total block count. These use the existing serial bounded batch adapter, at most 1 MiB per chunk. Profile is derived from the original format, not guessed or overridden by callers.
- `complete`: emitted only after all header and payload bytes have been yielded successfully, with unchanged file size and format/profile information. It does not mean a downstream file writer has persisted the output.

The consumer must distinguish event kinds, consume each byte chunk promptly, and handle skip explicitly. The adapter performs no writes and retains no complete texture or CASC pack. Consumers own partial-output cleanup after errors, cancellation, or early termination. Holding all emitted chunks intentionally defeats streaming. Header chunks are copied to avoid retaining a large source backing buffer; source caching and JavaScript garbage collection remain outside the adapter's control.

## Bounds, cancellation, and native distinctions

For supported formats, the data start must be at least 48, strictly below source size, and leave a nonempty tail divisible by 16. Rejecting dataStart below 48 is deliberately stricter malformed-input validation than the native script, which does not explicitly reject header overlap. The format mapping, pointer interpretation, untouched header bytes, and block ordering match the native structural rules; this does not establish full native conversion parity.

Options that predictably fail batch validation are checked before the first output. Short reads, wrong buffer types, shared/resizable buffers, unsafe sizes, and malformed offsets fail. Errors from the caller's read function or injected codec are replaced by fixed category messages without private filenames or original causes. Abort errors retain the generic AbortError category.

Cancellation is forwarded to header reads and the batch adapter, checked between chunks, and stops waiting for pending reads. Underlying reads only release their resources if the source honors its signal. Synchronous bounded decoding is not cooperatively interrupted. Breaking at a yielded chunk prevents subsequent reads; an AbortSignal is needed to interrupt already-pending work. Earlier emitted chunks are not a complete valid conversion if the stream does not finish.

No mip table parsing, texture-dimension interpretation, descriptor-cache updates, thumbnail changes, CASC writing, quality reporting, or game content handling is implemented here. The native script's separate container and pack responsibilities remain outstanding.

## Synthetic evidence

`node --test texture-stream.test.mjs` passes five deterministic tests using an injected fake encoder, not actual ASTC compression. Cases cover both format/profile mappings, exact header preservation, ordered batch offsets and counts, bounded long-header reads, lazy early stop, explicit skips, overlapping/out-of-range/misaligned pointers, short reads, invalid sizes/options, pending-read cancellation, and privacy-safe error categories. Real WASM transcoding, game-file behavior, and full native pipeline equivalence are not claimed.
