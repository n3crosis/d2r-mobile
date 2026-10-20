# Isolated authenticated ASTC pack jobs

中文: [ASTC_PACK_JOBS.zh-CN.md](ASTC_PACK_JOBS.zh-CN.md)

Source-only candidate. No UI, production runtime or device claim.

`createAuthenticatedAstcPackJobs(extracted, selection, options)` returns
`{ jobs, maxEntries, dispose }`. Required options: caller-owned staging `root`,
positive uint32 `maxEncodedBytes`/`maxDecodedBytes`, `batchBlocks` (1–65536), and
trusted `encode` function. Optional `signal` and `createStage` support cancellation
and stage wiring. Authentication is fixed, not injected: the facade enumerates
original WeakMap-bound first-row tokens, and `readAuthenticatedCascVfs` reads
`data/.build.config` and verifies `vfs-1` through the existing bounded TVFS decoder.
There is no caller VFS, row, EKey or authentication flag in this public API.

Pass `jobs` and `maxEntries` to the pack writer's bounded unknown-count mode.
Each job is `{ path, spec, decodedSize, source }`. The source is a single-use async
byte iterable. Fully consume it before asking for the next job. Advancing early
fails closed; returning the outer iterator cleans the current stage. Always call
`dispose()` in the owner’s finally, including when iteration never starts.

Each texture is decoded once to one integrity-verified private stage. Only then
is its header examined; unsupported formats are skipped without a second decode.
Conversion is backpressured by the pack writer. After source consumption, the
stage is disposed before the next record is opened. The descriptor is required
and emitted last, using only successfully converted paths and sRGB flags. Its
JSON uses the existing explicit 16 MiB input / 32 MiB output limits; input and
output buffers are wiped after use. The generic archive and texture limits are
not raised. Original CFT storage specs and sizes are checked using one reusable
bounded lookup snapshot, not a fresh full-table string for every texture.

Cancellation closes the active stage even while the outer iterator is suspended.
Cleanup is idempotent, bounded to one second per wait and does not replace an
already-known conversion error. Parent ownership of a fresh OPFS job directory
remains necessary for cleanup after worker termination or a hung filesystem.
No final artifact should be published until the pack writer has consumed all jobs
and validated the completed pack. Partial texture output is internal pack staging,
not a verified final artifact.

## Worker boundary

`astc-pack-jobs-core.mjs` owns `createAstcPackJobsCore({ selected, vfs, openRecord, ...options }, dependencies)`, which is
an internal non-authenticating core. `selected` contains bounded texture and
last-descriptor handles. `openRecord` resolves only handles issued by the trusted
parent and returns `{ source, record }`. For a worker, sources must be bound
reverse-read RPC capabilities; record metadata comes from parent initialization,
not user-selected EKeys or worker path requests. The core takes ownership of the
VFS bytes and wipes them on completion/cancel/disposal. It does not establish
provenance itself. Never present its successful synthetic execution as extraction
authentication.

The fixed public facade in `astc-pack-jobs.mjs` retains its original authenticated
imports and reexports the same core function and cleanup constant for compatibility.
The producer worker imports the core module directly. This keeps parent WeakMap
identity unchanged and prevents UI/authentication dependencies from entering the
worker. The existing Bun worker build rejects those forbidden module loads before
bundling; it does not use PURE annotations or change runtime semantics. Parent
loader/raw package dependencies are unchanged. Lifecycle wiring is documented in
[ASTC_PRODUCER.md](ASTC_PRODUCER.md).

Bun 1.4.3 measurement against the c49368d artifact: 89,189 to 55,837 worker bytes
(33,352 fewer, 37.4%); Node gzip level 9: 31,096 to 19,342 bytes. The resulting
worker has zero unresolved literal imports and no loaded parent-auth/UI graph.
These are local current-source build measurements, not a deployed artifact or a
measured browser-memory reduction. Codec bytes, pins and receipts are unchanged.

`node --test web/tests/astc-pack-jobs.test.mjs` uses synthetic RomFS/config/TVFS,
real record verification and conversion structure with a fake ASTC encoder and
memory stage. It checks one-stage peak, single decode per record, skipping,
descriptor order/formats, early return/advance, cancellation, cleanup and forged
identity rejection. It is not browser, real ASTC quality or game validation.
