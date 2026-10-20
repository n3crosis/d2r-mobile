# Isolated extraction client and job adapter

This is trusted application wiring, not a UI conversion enablement or evidence that
real commercial content produces a functioning IPA. No production version catalog,
DLC overlay, signing, upload or network fallback is added.

## Boundaries

- `createExtractionWorkerClient({createWorker})` accepts a trusted Worker factory,
  never a caller-selected module URL, native symbol, filesystem path or generic RPC.
  It supports only initialize, select, readExefs, openRomfs, readRomfs and dispose.
- Requests use strictly increasing IDs and one active request. At most eight are
  queued by default (configurable 1–32). Queue overflow rejects the new request.
  Every request has an operation-specific total queue-plus-execution deadline
  (see below). A timeout, cancellation, malformed response,
  stale response ID, runtime error or worker failure terminates the entire session,
  rejects all pending requests, clears listeners and exposes only fixed error codes.
- Reads are bounded to 64 KiB, require a generation token and accept only an exact
  standalone Uint8Array response backed by an ArrayBuffer. The Worker transfers
  returned arrays; input Blob handles are structured-cloned directly to the isolated
  Worker, never read into strings or sent to generators by this adapter.
- `createExtractionJobAdapter({createWorker})` exposes openSecretSession,
  inspectContents, extractSelected and cleanup. Initialization uses the engine's
  independently hashed inventory and authenticated CNMT inspection. The coordinator
  chooses a selection. The adapter independently applies the known D2R expansion
  policy to its private retained records and inventory, reconstructs explicit base,
  update and DLC version choices, then the engine re-resolves the same options.
  Canonical equality of the complete result is required before staging plaintext.
- Both required ExeFS modules, `main` and `sdk`, are staged before opening RomFS.
  The default aggregate module budget is 32 MiB and cannot exceed 64 MiB. No other
  ExeFS entry is staged. Missing modules, mismatched selection or a budget violation
  fail closed. Exact D2R base/update and the known Warlock package with a single
  nonempty Data slot are required. Missing, unknown or unsupported DLC rejects;
  its authenticated evidence remains in selection but never overlays Program RomFS.
  This is a local input gate, not purchase, account, license or legal ownership
  verification. The engine separately rejects multi-program layouts.
- Opening RomFS invalidates the ExeFS generation. `indexRomfs` builds its bounded
  index over the new authenticated image; `createCascLogicalAssets` indexes only its
  manifest, retaining lazy archive reads and existing content-digest validation.
- The extracted result is exactly `{programModules, romfs, logicalAssets}`.
  programModules contains the staged `main` and `sdk` byte arrays. romfs exposes
  bounded `getFile(path).readAt(offset,count,{signal})`; logicalAssets exposes only
  `read(path,{maxBytes,signal})`. No keys, input files, session, token, Worker,
  arbitrary request method, metadata row enumeration or native boundary is exposed.
  Reader closures are revoked on disposal, including zero-byte/cached operations.

## Bounded large-input deadlines

The Worker performs complete NCA hashing during initialize and full IVFC/BKTR
verification during openRomfs. Memory-bounded verification is not time-bounded by
64 KiB chunk size: legitimate multi-GB inputs can take substantially longer than
the old uniform two-minute limit. Default deadlines are now:

| Operation           | Default total deadline | Hard maximum |
| ------------------- | ---------------------- | ------------ |
| initialize          | 2 hours                | 6 hours      |
| openRomfs           | 2 hours                | 6 hours      |
| select              | 2 minutes              | 10 minutes   |
| readExefs/readRomfs | 30 seconds             | 2 minutes    |
| dispose             | 30 seconds             | 2 minutes    |

Trusted wiring may pass `operationTimeoutMs: {initialize: ..., openRomfs: ...}`
to either client or adapter. Only these six fixed operation names and positive
safe-integer millisecond values within their respective caps are accepted. Values
are snapshotted before Worker creation. Neither zero, infinity nor disabling the
timer is supported. The legacy explicit `timeoutMs` option remains accepted up to
ten minutes, applies across operations but is clamped to shorter operation caps;
it can intentionally shorten the new long-operation defaults. Explicit operation
values take precedence over that legacy option.

Every deadline starts at enqueue, not dispatch, and is never renewed by Worker
activity or progress messages. A queued short request may therefore terminate an
in-flight long operation when its own total deadline expires. Normal adapter
sequencing awaits initialize/select/openRomfs before issuing dependent reads.
Queue capacity remains bounded. AbortSignal still terminates the Worker
immediately, even when synchronous native hashing or validation is busy; no
cooperative crypto cancellation, new progress channel or cryptographic gate
changes were added. Success clears the request timer before dispatching the next
request; timeout, abort and protocol errors revoke the entire queue.

These defaults provide a finite larger verification window, not a real-content
performance guarantee. Large-title throughput, background-tab timer throttling,
slow disks and lower-end devices remain unverified. Fake-timer protocol tests cover
old-limit survival, exact deadline expiry, short-read limits, queue time, immediate
abort, override bounds and no late-response resurrection without large local runs.

## Program provenance verification

`readAuthenticatedProgramModules(extracted, selection, {signal})` is a synchronous
verifier for trusted generator wiring. A private WeakMap registers only completed
extraction results. The verifier requires exact result object identity, canonical
full-selection equality, and a still-live session. Cloned results, caller boolean
flags, changed selections, cancellation and disposed sessions reject. No registration
helper is exported. This identity guard assumes the application supplies a trusted
extraction Worker factory; it cannot authenticate hostile application code.

The returned main/sdk arrays are borrowed. A program generator must immediately
snapshot both and verify exact trusted full-file hashes before processing them.
Provenance identifies the extraction boundary, not a supported program version.
Inject the verifier into a program adapter rather than importing extraction modules
into a separately sealed program runtime.

## Coordinator integration

Call `runPackagingJob` with explicit `secretLifetime: "archive"` so isolated keys
remain available during lazy output entry reads. The coordinator disposes the
session after all producers drain and before archive validation or commit, and on
failures. Default extraction-lifetime jobs remain unchanged and cannot use these
readers after early disposal.

Compose the adapter's cleanup with all generator/output cleanup. Session disposal
requests native cleanup, then terminates the Worker even if disposal fails or times
out. Abort terminates immediately. Staged module arrays survive session disposal
because generators may still own them, and cleanup overwrites them. Partial staging
is overwritten on extraction failures. Cleanup is idempotent and an adapter can
open only one session.

The existing program-rewriter adapter is still restricted to its synthetic catalog
and one synthetic input. A trusted resolver may explicitly use
`extracted.programModules.main` for that narrow test. This does **not** implement
production main-plus-sdk rewriting or confer production compatibility. Asset adapters
can use `extracted.logicalAssets` through their existing read-only interface.

No default Worker URL is installed. A later sealed preloaded-runtime loader can
supply its own trusted factory. The current offline-runtime proof does not yet cover
this extraction engine, so offline extraction is explicitly unproven.

## Evidence and remaining limits

Focused Node tests exercise serialized requests, transferred-array ownership,
queue limits, terminal errors, timeout, cancellation, strict responses, token
transition, required-module staging, aggregate budgets, selection mismatch, DLC
input gating, explicit DLC versions, lazy RomFS access, revocation and cleanup with
synthetic mock Workers.
Chromium CI separately loads the actual client and extraction Worker, checks clean
disposal and terminal malformed-input failure alongside the native WASM smoke.
These do not establish successful authenticated extraction of a real signed title,
commercial content conversion, complete program generation, device execution, or
an extraction-specific sealed offline runtime.
