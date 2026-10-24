# Browser staged output scope

`browser-staged-output.mjs` supplies only the coordinator's `createOutput` and
`validateArchive` adapters. Production uses `browser-blob-output.mjs` to wrap
this transaction with a bounded IPA Blob destination. This does not establish
working NSP-to-IPA conversion, signing, installability or iOS support.

## Caller contract

- Desktop Chromium, secure context, OPFS, `AbortSignal.any` and writable File
  System Access handles are required. Storage estimation is optional and advisory.
- Obtain a user-selected destination with a user-initiated save picker and grant
  its `readwrite` permission before creating output. This adapter never prompts,
  opens a picker, uploads, or falls back to a whole-archive Blob download.
- Call `createBrowserStagedOutputAdapters` with `destinationHandle`, explicit
  `archiveFormat: "zip32" | "zip64"` and positive safe-integer `maxOutputBytes`.
  Match format and budget to `runPackagingJob`. Spread the returned two methods
  into the otherwise complete trusted adapter set.
- The coordinator's separate `cleanup` releases generator resources; it must not
  clear OPFS or remove this adapter's still-needed stage.
- Exact budget includes all metadata and payload bytes. ZIP32 retains the
  existing writer's smaller limits. ZIP64 addresses are limited to JavaScript
  safe integers, not the full theoretical unsigned-64-bit address range.

## Lifecycle

1. Validate manifest and exact byte plan, OPFS capability and destination
   capability/permission. Do not gate staging on a storage estimate or reserve.
2. Create one cryptographically named OPFS temporary file, refusing an existing
   name. Sequential writes are backpressured with exact cumulative accounting.
3. Seal the staging writer in `validateArchive`. The independent
   `staged-zip-validator.mjs` reads actual bytes, never writer-reported offsets,
   CRCs or validity flags. It validates canonical STORE ZIP32/ZIP64 headers,
   names, regular-file modes, sizes, descriptors, central directory, offsets,
   ZIP64 extras, end records and streaming payload CRCs against the manifest.
   It rejects duplicate/conflicting paths and trailing bytes. This is integrity
   and layout validation, not authenticity or executable validation.
4. `output.close()` requires completed validation. Open the chosen destination's
   transactional writable, independently revalidate the immutable File snapshot
   actually being copied, then transfer it in bounded chunks. The extra pass
   deliberately trades disk reads for protection against stage replacement.
5. Remove only the owned staging entry before destination `close()`. Cleanup
   failure prevents commit. The final destination close is the commit boundary;
   there is no post-close cancellation check that misreports a successful commit.
   Failure causes best-effort abort and owned staging cleanup. Failed/uncertain
   browser close cannot promise OS-level rollback.

Reads and writes are bounded to 4 MiB; metadata and entry counts have independent
limits. The direct file adapter does not retain a whole archive in memory.
The production Blob wrapper is capped at 512 MiB, snapshots bounded chunks into
immutable Blobs, and publishes a completed download only after validation and
owned-stage cleanup. It may retain the whole IPA in browser memory, never bulk
game resources. Cancellation is checked around
I/O and bounded reads. `abort()` requests cancellation and drains pending work
before disposal; it cannot interrupt an already-started browser commit.

Quota estimates do not reserve capacity or expose destination-drive free space.
Missing, rejected, malformed or pessimistic estimates do not block generation;
the UI handles them separately as advisory information. No extra quota reserve
is required. This may allow work to start that later fails when storage fills.
Disk-full errors and permission revocation still fail closed. During transfer,
staging and destination temporary copies coexist, potentially alongside an old
output file. OPFS has no exclusive-create primitive: a fresh UUID plus an
existence check avoids existing entries, but same-origin scripts remain trusted.
A crash can leave an orphaned stage. There is deliberately no global clearing,
startup scavenging, recursive removal, or deletion of unknown entries. No input
file handles are accepted or modified.

## Local verification

Run the optional `staged-output` profile in [TESTING.md](TESTING.md). Its Chromium
harness uses a test-only OPFS destination, not an OS save-picker handle. It does
not establish Windows/macOS save-picker behavior, multi-GB OPFS endurance, crash
recovery or real-game output correctness. The separate `zip64` profile checks
writer bytes, not browser staging.
