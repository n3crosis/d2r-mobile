# Bounded resource write batching

[简体中文](RESOURCE_WRITE_BATCHING.zh-CN.md)

Original-resource and Legacy Device Pack exports keep authenticated read/RPC limits at 64 KiB. Only the filesystem write cap changes: one fixed, lazily allocated 1 MiB buffer batches sequential reads into serial writes. There is no configurable growth, concurrent write, new UI option, archive-size increase or whole-file buffering.

This adds up to 1 MiB of JavaScript working storage per active export, plus the existing current read of at most 64 KiB. Browser/filesystem internal buffering is not measured. The coalescer copies without modifying source aliases; exporters continue wiping their independently owned source copies. Completed/failed flushes and disposal wipe the write buffer. Sources must remain owned and destinations must consume bytes before resolving writes.

Cancellation is checked for every read and around each flush. A partial batch is flushed at each file boundary before close and size validation; cancelled unflushed bytes are discarded. Written-byte progress increases only after successful filesystem writes, not when reading into the buffer. A failed write can have unknown filesystem-side partial effects, so no failed flush is counted or claimed complete. The existing abort, incomplete-marker, ownership checks and nonrecursive cleanup remain; failed abort still prevents deletion ahead of a possibly live writer. A hung browser call remains cooperative, not forcibly interruptible. Size/hash metadata and final-marker commit rules are unchanged.

Synthetic exact-byte tests use 2 MiB + 17 bytes: 33 bounded reads produce three payload writes (1 MiB, 1 MiB, 17 bytes), instead of 33. Tests cover both exporters, write failure, cancellation before flush and during a write, final partial data, byte-progress accounting and source alias preservation. These are operation counts, not browser or disk timing claims.
