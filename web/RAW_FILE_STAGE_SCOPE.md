# Bounded raw-file staging

[简体中文](RAW_FILE_STAGE_SCOPE.zh-CN.md)

## Scope

`raw-file-stage.mjs` is an isolated local OPFS primitive for incrementally generated raw files. It is not wired into ASTC supplemental packs, the UI or production packaging. Tests use synthetic in-memory filesystem doubles, not real-browser, device, quota or crash-recovery proof.

## API contract

- `await createRawFileStage({ root, maxBytes, signal, randomUUID })`: the caller supplies an OPFS root. `maxBytes` is a required nonnegative safe integer covering every final byte. The default UUID comes from `crypto.randomUUID()`; injection is for trusted hosts or tests.
- `append(Uint8Array)`: append at the current end, at most 1 MiB per call, within the total budget.
- `backpatch(offset, Uint8Array)`: overwrite only existing bytes. Offsets must be nonnegative safe integers; no file growth or sparse gaps. At most 1 MiB per call.
- `finalize()`: close the writer once, then obtain and validate the file snapshot. Returns `{ file, size, readAt(offset, length) }`. Further writes and finalization reject.
- `readAt`: replay a finalized file range of at most 1 MiB, using nonnegative safe-integer offsets and lengths entirely inside the file. Returns `Uint8Array`.
- `dispose()`: immediately prohibit further operations, drain an in-flight filesystem operation, then abort any remaining writer and remove the owned child directory. Idempotent; failed cleanup can be retried.

When supplied, `signal` must be an actual `AbortSignal`, not a duck-typed object. Writes reject shared or resizable backing buffers and any backing `ArrayBuffer` larger than 1 MiB, even when the supplied view is smaller. This bounds retained input during asynchronous writes.

## Ownership and failures

The temporary child is `d2rm-raw-<UUID>`, containing only `data.bin`. Creation follows an absence check; existing entries or type mismatches are not reused or deleted. OPFS has no exclusive-create primitive, so same-origin scripts must be trusted. Only this instance's successfully created child may be deleted. No directory scans, unknown-file cleanup or source-folder writes occur.

Await operations sequentially; concurrent calls reject. Do not mutate supplied bytes until a write completes. Validation or filesystem failure terminates the stage and attempts cleanup. Close, quota, read and write errors never count as success. If cleanup also fails, `AggregateError` preserves the original cause and cleanup errors. Abort triggers cleanup; callers should still `await dispose()` in `finally` to observe or retry cleanup failures. An already-entered browser operation cannot be forcibly cancelled; cleanup waits for it to return.

The returned `File` is a browser-backed snapshot, not a whole-file JavaScript buffer; `readAt` loads bounded slices only. This module cannot revoke a native `File`: wrapper reads reject after disposal, but a caller-retained `File` remains subject to browser semantics and is not guaranteed immediately unreadable or storage-free. Callers must release their references. Browser crashes may leave a directory; there is no scavenging. There is no guaranteed quota reservation, RAM fallback, upload or networking.
