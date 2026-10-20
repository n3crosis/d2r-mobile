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
  Every request has a total queue-plus-execution deadline (120 seconds by default,
  configurable up to ten minutes). A timeout, cancellation, malformed response,
  stale response ID, runtime error or worker failure terminates the entire session,
  rejects all pending requests, clears listeners and exposes only fixed error codes.
- Reads are bounded to 64 KiB, require a generation token and accept only an exact
  standalone Uint8Array response backed by an ArrayBuffer. The Worker transfers
  returned arrays; input Blob handles are structured-cloned directly to the isolated
  Worker, never read into strings or sent to generators by this adapter.
- `createExtractionJobAdapter({createWorker})` exposes openSecretSession,
  inspectContents, extractSelected and cleanup. Initialization uses the engine's
  independently hashed inventory and authenticated CNMT inspection. The coordinator
  chooses a selection, then the engine independently re-resolves its version options.
  Canonical equality of the complete result is required before staging plaintext.
- Both required ExeFS modules, `main` and `sdk`, are staged before opening RomFS.
  The default aggregate module budget is 32 MiB and cannot exceed 64 MiB. No other
  ExeFS entry is staged. Missing modules, selected DLC, mismatched selection or a
  budget violation fail closed. The engine separately rejects multi-program layouts.
- Opening RomFS invalidates the ExeFS generation. `indexRomfs` builds its bounded
  index over the new authenticated image; `createCascLogicalAssets` indexes only its
  manifest, retaining lazy archive reads and existing content-digest validation.
- The extracted result is exactly `{programModules, romfs, logicalAssets}`.
  programModules contains the staged `main` and `sdk` byte arrays. romfs exposes
  bounded `getFile(path).readAt(offset,count,{signal})`; logicalAssets exposes only
  `read(path,{maxBytes,signal})`. No keys, input files, session, token, Worker,
  arbitrary request method, metadata row enumeration or native boundary is exposed.
  Reader closures are revoked on disposal, including zero-byte/cached operations.

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
rejection, lazy RomFS access, revocation and cleanup with synthetic mock Workers.
Chromium CI separately loads the actual client and extraction Worker, checks clean
disposal and terminal malformed-input failure alongside the native WASM smoke.
These do not establish successful authenticated extraction of a real signed title,
commercial content conversion, complete program generation, device execution, or
an extraction-specific sealed offline runtime.
