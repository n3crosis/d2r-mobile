# Bounded streaming zlib adapter

中文: [STREAMING_ZLIB.zh-CN.md](STREAMING_ZLIB.zh-CN.md)

`createPngCodec(...).compressZlibStream(input, { maxInputBytes, maxOutputBytes, signal?, level?: 9 })` returns an async generator. Input must be an async iterable of ordinary, non-resizable `Uint8Array` chunks whose entire backing `ArrayBuffer` is no larger than 1 MiB. Ordinary subviews within that bound are accepted; a one-byte view over a larger buffer is rejected to prevent oversized backing-buffer retention across yields. Producers slicing a large record must yield owned bounded copies (`slice`, not `subarray`). This deliberate constraint applies only to the streaming API; existing `compressZlib` accepts its original input forms unchanged. Both total byte budgets are required nonnegative safe integers; they are independent of the unchanged 128 MiB whole-buffer API cap. Output chunks are at most 1 MiB. No whole-record input or output concatenation occurs.

The existing `compressZlib(raw, { level: 9 })` API and its bytes are unchanged. The new stream retains pinned zlib 1.2.13, level 9, zlib framing (windowBits 15), memLevel 8, and default strategy. Nonempty input uses `Z_NO_FLUSH`; one final empty call uses `Z_FINISH`. Empty input chunks are skipped. This is one compressed stream, not concatenated independently compressed chunks.

The C ABI consumes the complete supplied input or returns an error and aborts. It does not expose partial consumption. Each call uses the existing fixed input/output buffers; the adapter copies returned bytes before yielding, retaining at most one ABI result (bounded by the approximately 16 MiB C output buffer). Actual caller-facing chunks are at most 1 MiB. The generator does not request another input while yielded output remains outstanding. The producer must keep its chunk stable until the next pull; consumers own any memory they choose to retain.

One codec instance is exclusive for the stream's lifetime. Other PNG or zlib calls reject while it is active. Normal completion, consumer `return`/`throw`, upstream failures, invalid chunks, exceeded budgets and abort signals release the native stream. A signal also releases it immediately when the consumer is paused at a yield. An old canceled generator cannot release a newer stream's ownership.

Abort signals interrupt waiting for upstream input. Cancellation requests upstream `return` once even while paused at a yield. Upstream cleanup is best-effort on cancellation or an existing failure: rejection cannot mask the primary error, and a hung cleanup cannot delay it. Normal consumer `return` still awaits upstream closure. An arbitrary producer may never settle; cancel cannot undo that producer's independent work. Without a signal, a consumer `return` queued behind an unresolved `next` follows normal async-generator semantics. Callers must signal cancellation, not merely abandon an iterator. Checks yield to a task every 32 input chunks so empty or immediately resolved producers do not indefinitely starve cancellation.

`createZlibStream` is the low-level ABI test seam: its injected `begin` must enforce ownership, `push` must fully consume its input and return copied bytes, and `abort` must release it. Production obtains these operations only from the pinned codec instance.

## Verification

Run `node --test web/tests/zlib-stream.test.mjs`. Mocked ABI tests cover lifecycle, backpressure, budgets and cancellation; they are explicitly not WASM execution evidence. When the existing local `dist/png_codec_native.so` is present, a separate native check verifies pinned zlib 1.2.13 fragmented calls plus an empty final call against the original whole-buffer call sequence, including empty and incompressible inputs. It checks decompression independently with Python's zlib. The native check is explicitly skipped when that artifact is absent.

The local WASM artifact was unavailable for this change. Real WASM execution, browser-worker cancellation and future CASC pack integration remain separate gates. No dependency, toolchain, UI, CI job or deployed pack has been added.
