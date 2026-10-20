# Local packaging job coordinator

`runPackagingJob(options)` orchestrates explicit, trusted local adapters. It is not
wired into the UI and does not supply missing decryption, patching, executable,
asset or shader conversion. No network or upload operation is included.

All required capabilities are checked before input discovery, key reads or output
creation. Root-only input discovery and metadata selection use the existing NSP
and content-selection APIs. Adapters must independently verify content hashes,
perform supported extraction/patching, generate real content and independently
validate it. Shell and final assembly metadata use the existing shell contract.
The three generation stages run through a bounded pool (default two, maximum
three), only after selection/extraction and secret-session disposal. Started work
is drained on failure; cancellation cannot forcibly stop uncooperative adapters.

The secret-session adapter owns key reading and an isolated worker. Its dispose
must wipe secrets and terminate the worker; failed session creation must clean up
partially-created resources itself. Generators receive no key-file handles or
secret-session reference. Adapters must never place keys in logs, caches, output,
reports or extracted results. JavaScript cannot prove erasure or prevent malicious
adapters from retaining references; this is a trusted capability boundary.

The native extraction spike's `createBoundary` API is deliberately not silently
wired here: its current metadata-only NCA boundary cannot satisfy full
`extractSelected`, executable generation or patch application. A real adapter
must own worker RPC, independent full-NCA hashes, verified selection and eventual
supported Program/BKTR extraction before this coordinator can produce real IPAs.

Generated validators return `valid: true` with independently observed target OS;
archive validators return `valid: true` only after inspecting actual staged ZIP
bytes against the manifest. Fake flags are test plumbing, not verification proof.
`createOutput` must return a staged sink with sequential awaited writes. Its close
is the sole commit boundary; archive validation and resource cleanup happen before
close. Close rejection means failure with `commitStarted: true`, not proof that a
provider rolled back. Abort must discard partial staging; cleanup failures are
reported as fixed codes. Cancellation after close begins cannot undo a successful
commit. Resource cleanup must not invalidate the staged output before close.

The current STORE-only ZIP32 writer retains its existing 512 MiB archive and
256 MiB file ceilings and rejects explicit directory entries; larger real games
and directory-bearing shells need an independently validated writer upgrade.
No ZIP64, compression, runtime support, signing or installation claim is made.

Progress contains only fixed stage/state/label strings, never adapter error text,
paths or key data. Observer exceptions are ignored. `PackagingJobError.report`
is safe presentation data; `.cause` retains the original thrown value for trusted
callers only and MUST NOT be displayed, serialized or logged. Cleanup failures
never replace the primary error. Success requires every generation/validation
stage, secret disposal, temporary cleanup and final close to succeed.

Tests use synthetic fake adapters and establish orchestration, ordering,
backpressure, cancellation, isolation of reports and failure semantics only.
They do not establish real conversion correctness, compatibility or installability.
