# Browser archive checksum adapter

`checksum-verifier.mjs` supplies the mandatory archive-reader injection:

```js
import { decodeArchiveRecord } from "./archive-reader.mjs";
import { verifyMd5 } from "./checksum-verifier.mjs";
const bytes = await decodeArchiveRecord(source, record, { verifyMd5, signal });
```

The adapter accepts `verifyMd5(Uint8Array, expectedHex, { signal })` and resolves
exactly `true` for a match or `false` for a mismatch. Malformed digests and invalid
input types reject. Hex digests are case-insensitive and exactly 32 characters.
The archive reader continues to fail closed on missing or unsuccessful verifiers.
It also supplies `kind` and optional `index`; the adapter does not need those fields.

Only the supplied view's bytes are hashed, not unrelated bytes in its backing
buffer. Callers must not mutate the input while verification is pending.
Incremental updates are limited to 64 KiB; upstream makes bounded chunk copies
and retains at most 63 trailing bytes. There is no full-input copy in the adapter.
Each update yields an actual event-loop task so cancellation and UI events can
run. Aborted signals reject with their original reason, with checks before and
after each chunk. Per-call hash state is destroyed on success, failure, or abort.
The caller owns the input buffer and its lifetime.

The implementation is pinned, vendored SparkMD5 3.0.2 under its MIT alternative.
See [source provenance and license](vendor/spark-md5-3.0.2/PROVENANCE.md).
No npm dependency or browser network request is added.

MD5 is collision-broken and is used here solely because the archive format
requires it. A matching checksum is not authentication, an authenticity claim,
or evidence that a game version is supported. Supported-game identity remains
false. This module does not add manifest traversal, conversion, or UI wiring.
Tests use public RFC 1321 vectors and synthetic bytes, never game data.
