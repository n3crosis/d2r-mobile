# Browser staged output scope

`browser-staged-output.mjs` supplies only the coordinator's `createOutput` and
`validateArchive` adapters. Production uses `browser-blob-output.mjs` to wrap
this transaction with a bounded IPA Blob destination. This does not establish
working NSP-to-IPA conversion, signing, installability or iOS support.

## Caller contract

- Desktop Chromium, secure context, OPFS, storage estimation, `AbortSignal.any`
  and writable File System Access handles are required.
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

1. Validate manifest and exact byte plan, destination capability/permission and
   estimated free origin quota (archive bytes plus a default 16 MiB reserve).
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
Disk-full errors and permission revocation still fail closed. During transfer,
staging and destination temporary copies coexist, potentially alongside an old
output file. OPFS has no exclusive-create primitive: a fresh UUID plus an
existence check avoids existing entries, but same-origin scripts remain trusted.
A crash can leave an orphaned stage. There is deliberately no global clearing,
startup scavenging, recursive removal, or deletion of unknown entries. No input
file handles are accepted or modified.

## Evidence and remaining gates

```sh
node --test web/tests/staged-zip-validator.test.mjs web/tests/browser-staged-output.test.mjs
```

Tests cover independent Python `zipfile` validation of both formats, mutation of
every byte in tiny archives, >4 GiB metadata arithmetic without large allocations,
quota/capability/permission failures, collisions, short/excess writes, output and
manifest ownership, post-validation mutation, write/close/cleanup failures,
cancellation, late cancellation and unrelated-file preservation. Lifecycle unit
tests use fault-injection mocks.

`staged-output-browser-checks.yml` runs a tiny real Chromium OPFS harness with
Playwright 1.64.1. The destination is a test-only OPFS file, not an OS save-picker
handle. It covers ZIP32/ZIP64 commit and independent reread, actual writable
cancellation preserving existing output, own-stage cleanup, unrelated-file
preservation and an injected insufficient quota estimate.

```sh
PLAYWRIGHT_ENTRY=/absolute/path/to/playwright/index.mjs \
  node web/toolchain/staged-output-spike/browser-smoke.mjs
```

Hosted proof passed on 2026-10-20 for commit
`b90743b5b70fdf9ffa895dfd1d54a0201ad270c7` using Chromium `156.0.8078.4`:
[real OPFS workflow run](https://github.com/n3crosis/d2r-mobile/actions/runs/39399152890).
All four browser scenarios passed; this establishes only the tiny OPFS scope
described above. Windows and macOS save-picker behavior, actual multi-GB OPFS
endurance, crash recovery and real-game output correctness remain release gates. The separate ZIP64
large-output workflow proves writer bytes, not this browser staging lifecycle.
