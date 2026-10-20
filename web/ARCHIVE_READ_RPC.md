# Bounded archive read RPC

[简体中文](ARCHIVE_READ_RPC.zh-CN.md)

`archive-read-rpc.mjs` owns a dedicated MessagePort pair. It does not spawn workers, fetch code, authenticate manifest rows, or accept paths/keys as authority. The trusted parent opens original authenticated record tokens and registers only their immutable source closures.

## API

- `createArchiveReadRpcHost(port, {signal, maxPending=1})`: `register(source)` returns frozen `{id,size}` with a random UUID capability and canonical decimal size. Source is `{size:bigint,readAt(bigint,count,{signal})}`. Registration snapshots size and binds the original method. At most 32,768 sources, sizes up to uint64 maximum. Source must remain immutable and enforce its selected record extent/live session.
- `createArchiveReadRpcClient(port, {signal,maxPending=1,timeoutMs=30000})`: `open(descriptor)` returns frozen `{size:bigint,readAt(bigint,count,{signal})}`. Opening a descriptor twice is rejected. Descriptor/record metadata must arrive through trusted parent initialization, not user inputs.
- Both expose `close()`. Host `revoke(id)` closes the entire dedicated job transport, not just one source. Any read cancellation also closes the transport and rejects all pending reads. Use a separate pair for unrelated jobs.

Reads are at most 65,536 bytes. Wire offsets are canonical unsigned decimal strings, never lossy Numbers; request IDs are strictly monotonic safe integers with no reuse. Concurrency is 1 by default, configurable through 16 on both endpoints. Excess local calls reject `ARCHIVE_RPC_BUSY` immediately: callers must await reads rather than accumulate a queue. Host independently enforces its cap. Client deadlines are 1–120,000 ms.

Responses contain fresh exact-size transferable ArrayBuffers. Shared/resizable buffers and short reads are rejected. Source-owned buffers are not detached. Malformed, unknown-capability, stale, duplicated, unsolicited, oversized and extra-field messages fail closed. Closed endpoints release listeners/timers, clear capability maps, and reject pending client reads. Sources receive a host AbortSignal; if they ignore it, late results are suppressed, not claimed forcibly cancelled. Unexpected silent port loss is bounded by the client request deadline. External errors are replaced with fixed safe codes, never source filenames.

## Worker and storage ownership

The worker core can use the client's readAt source directly with `stageArchiveRecord`; trusted record metadata is delivered separately. This RPC does not transfer WeakMap provenance or let callers reconstruct authenticated tokens. Only trusted parent registration establishes each source binding.

The parent must own a dedicated OPFS job directory and retain its cleanup handle before transferring directory access to a worker. On worker termination, revoke this transport and clean only that owned subtree; retain observable pending/failed cleanup. Worker lifecycle, hard termination, storage deletion, codec preload and runtime inventory are intentionally not implemented here.

Synthetic tests cover exact offsets beyond Number precision, bounded backpressure, source errors, shared buffers, abort/revocation/deadlines, replay and malformed traffic, listener release, plus a real Node MessageChannel round trip. No browser-worker, OPFS, private archive or game-data validation is claimed.
