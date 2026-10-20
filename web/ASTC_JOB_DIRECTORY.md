# Parent-owned ASTC job directory

中文: [ASTC_JOB_DIRECTORY.zh-CN.md](ASTC_JOB_DIRECTORY.zh-CN.md)

`createAstcJobDirectory({ root, signal, stopAndDrain, cleanupTimeoutMs })` creates a
fresh UUID-named child of a caller-provided OPFS directory. The returned frozen
lease has `root`, `dispose()` and `status`. The parent retains the lease; only its
child directory handle is cloned to the producer worker. No source directory,
game files, network or UI is involved. The default bounded wait is 1000 ms, with
an explicit allowed range of 1–30000 ms. `randomUUID` is an injected test seam;
production defaults to cryptographic `crypto.randomUUID()`.

On successful pack production, keep this lease alive for the finalized File's
entire export/read lifetime. Receiving a File is NOT permission to remove its
backing directory. After export or abandonment, terminate/revoke the producer,
then await `dispose()`. Always retain the lease when disposal rejects so cleanup
can be retried. Aborting the supplied signal starts best-effort disposal; an
owner must still observe `dispose()` to establish the outcome.

The optional trusted `stopAndDrain` callback runs before any removal. It should
terminate the producer, revoke source RPC, detach listeners, and await tracked
pending operations. If omitted, the owner must do those steps before disposal.
A failed callback prevents removal and can be retried; it must therefore be
idempotent. A still-pending callback is shared, not called again. Worker
`terminate()` has no completion promise and does not prove native filesystem
writes have drained. Locked/deferred filesystem operations remain observable
errors or pending cleanup, not successful cleanup claims. Actual browser behavior
still requires browser testing.

Deletion checks `isSameEntry` against the original child handle. Preexisting
names and known replacement entries are never removed. An already-missing owned
directory is considered released. OPFS offers neither exclusive directory create
nor atomic delete-if-handle-matches: existence/identity checks cannot defend
against hostile same-origin code racing between check and mutation. This lease
requires trusted, cooperating same-origin code; it is not a security boundary
against such code. No fallback deletes an unrecognized entry.

A timeout does not cancel or declare a filesystem operation unexecuted. The
original acquisition/removal remains tracked, and repeated `dispose()` calls
wait for that same pending cleanup rather than issuing competing deletions.
After a settled failure, a new disposal attempt rechecks ownership. `status`
exposes `{ phase, removed, cleanupPending, lastError }`; only successful cleanup
enters `disposed`. On acquisition failure or timeout, the thrown error retains
`error.lease`, including when a late directory handle is still pending. Cleanup
is started automatically but the parent must retain this lease to observe/retry.

`node --test web/tests/astc-job-directory.test.mjs` uses synthetic handles to test
ownership, replacement refusal, shutdown ordering, timeout single-flight,
late-acquisition cleanup, cancellation and retry. These tests do not establish
real OPFS locking, cross-worker completion or device behavior.
