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
three), only after selection/extraction. The default `secretLifetime: "extraction"`
disposes the secret session before generation. Started work is drained on failure;
cancellation cannot forcibly stop uncooperative adapters.

An explicit `secretLifetime: "archive"` supports huge authenticated inputs without
copying entire decrypted RomFS images into temporary storage. It keeps the isolated
key worker alive only behind bounded plaintext read capabilities until all archive
entry producers have drained. No keys, input handles or raw session object are
passed to generators. Disposal then runs before archive validation, resource
cleanup and final destination commit. Every failure also attempts disposal exactly
once; disposal failure prevents commit. This is opt-in plumbing, not proof that
an arbitrary injected reader isolates secrets. The actual strict extraction worker
must independently enforce its operation allowlist and generation-token lifetime.
The UI does not enable this mode yet.

The secret-session adapter owns key reading and an isolated worker. Its dispose
must wipe secrets and terminate the worker; failed session creation must clean up
partially-created resources itself. Generators receive no key-file handles or
secret-session reference. Adapters must never place keys in logs, caches, output,
reports or extracted results. JavaScript cannot prove erasure or prevent malicious
adapters from retaining references; this is a trusted capability boundary.

The native extraction spike now includes authenticated ExeFS/RomFS and legacy
BKTR boundaries, but they are deliberately not silently wired here. A real adapter
must own strict worker RPC, independent full-NCA hashes, verified content selection,
small executable staging and bounded plaintext readers. Signed real-package
coverage and complete content/DLC integration are still missing.

Generated validators return `valid: true` with independently observed target OS;
archive validators return `valid: true` only after inspecting actual staged ZIP
bytes against the manifest. Fake flags are test plumbing, not verification proof.
`createOutput` must return a staged sink with sequential awaited writes. Its close
is the sole commit boundary; archive validation and resource cleanup happen before
close. Close rejection means failure with `commitStarted: true`, not proof that a
provider rolled back. Abort must discard partial staging; cleanup failures are
reported as fixed codes. Cancellation after close begins cannot undo a successful
commit. Resource cleanup must not invalidate the staged output before close.

The default STORE-only ZIP32 writer retains its existing 512 MiB archive and
256 MiB file ceilings. An explicit `archiveFormat: "zip64"` selects the bounded
ZIP64 writer and requires a positive safe-integer `maxOutputBytes` archive budget.
Its layout and budget are checked before destination creation; the same staged
validation, cleanup and close boundary applies. ZIP64 byte counts are BigInt.
Both writers reject explicit directory entries. ZIP64 streaming has an independent
synthetic >4 GiB CI gate, but browser destination quotas and iOS installer ZIP64
compatibility remain unverified. No compression, runtime, signing or installation
claim is made. The UI still cannot generate an IPA.

Progress contains only fixed stage/state/label strings, never adapter error text,
paths or key data. Observer exceptions are ignored. `PackagingJobError.report`
is safe presentation data; `.cause` retains the original thrown value for trusted
callers only and MUST NOT be displayed, serialized or logged. Cleanup failures
never replace the primary error. Success requires every generation/validation
stage, secret disposal, temporary cleanup and final close to succeed.

Tests use synthetic fake adapters and establish orchestration, ordering,
backpressure, cancellation, isolation of reports and failure semantics only.
They do not establish real conversion correctness, compatibility or installability.
