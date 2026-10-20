# Browser-origin storage advisory

中文: [OPFS_STORAGE_ADVISORY.zh-CN.md](OPFS_STORAGE_ADVISORY.zh-CN.md)

`readOpfsStorageAdvisory({ storage, requiredBytes, timeoutMs, signal })` queries only
`navigator.storage.estimate()` by default. It never requests persistence or changes
permissions, enumerates directories, reads user files, or reserves disk space.
The optional storage object is a test/integration seam; explicit `null` means
unavailable. Default timeout is 1000 ms; accepted explicit values are 1–30000 ms.

The frozen result contains:

- `status`: `estimated`, `unavailable`, `invalid`, `timeout`, or `cancelled`.
- `quotaBytes`, `usageBytes`, `availableBytes`: nonnegative safe integers for a
  valid estimate, otherwise `null`. Available is `max(0, quota - usage)`.
- `requiredBytes`: supplied known staging requirement, otherwise `null`.
- `sufficiency`: `unknown`, `estimated-sufficient`, or `estimated-insufficient`.
- `advisoryOnly`: always `true`.

Missing/rejected APIs, malformed numbers, timeout and cancellation return unknown
capacity rather than throwing an operational gate. No estimate means unknown,
not zero available storage. A valid zero estimate is distinct from unknown.
Missing, negative, fractional, nonfinite, unsafe, string or BigInt estimate values
are invalid without coercion. Incorrect caller options throw TypeError so a
configuration mistake is not silently treated as a trustworthy requirement.
Pending platform estimation cannot be cancelled; its late result/rejection is
observed but cannot alter an already returned result.

`requiredBytes` must be an independently known staging requirement. Without it,
sufficiency remains unknown even when quota and usage are available. Do not infer
required space from NSP input size. An ASTC `maxPackBytes` value, including an 8 GiB
cap, is an upper limit, NOT a required allocation or reservation. Do not require
that entire cap to be available before work starts.

UI wording should identify an estimated browser-origin staging capacity, not
physical free disk and not available space in a selected external output folder.
Quota may include other same-origin storage and may change during the job. Even
`estimated-sufficient` is not a promise of successful writes. Keep this advisory
nonblocking for normal mode; actual write failures remain authoritative. A
cancelled advisory is not itself permission to resume a cancelled packaging job.
No picker, retained file handle, persistence prompt or permission change is needed.

`node --test web/tests/opfs-storage-advisory.test.mjs` covers arithmetic and known
requirements, unavailable APIs, invalid numbers, bounded timeout, late rejection,
cancellation, and absence of persistence/file calls using synthetic doubles.
