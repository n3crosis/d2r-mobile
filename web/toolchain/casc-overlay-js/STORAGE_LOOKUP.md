# Bounded CFT storage lookup

`createCascPackStorageLookup(vfs, { expectedQueries = 0 })` snapshots the bounded
TVFS once. The optional hint must be an integer from 0 through 32,768. Only when
both CFT record count and expected queries are at least 2,048 does it choose the
compact index. Omitted hints and smaller batches retain the substring path.
The ASTC coordinator passes its existing selected-token count, including the
descriptor, without another manifest or early record opens. The hint grants no
trust and changes no metadata limits or output bytes.

The index retains two Uint32 arrays and one Uint8 array: 9 bytes per CFT record,
243,000 bytes for 27,000 records, and under 6 MiB at the existing 16 MiB TVFS cap.
These figures exclude the common immutable snapshot, object overhead and sort
scratch memory. The indexed path retains no duplicate CFT search string or path
manifest. The default path retains a CFT-length string whose actual memory use
is engine-dependent.

Aligned keys are ordered by a 32-bit rolling fingerprint and then the complete
16-byte key. Binary search uses that same ordering, including collisions; no
collision bucket or duplicate-key group is scanned linearly. Every possible
16-byte window in the CFT is checked, including unaligned and cross-record
occurrences. Counts saturate at two. Only an exactly unique aligned key is
accepted. Fingerprints are not integrity or authentication proofs. Existing
path, key, size, range, request-duplicate and snapshot checks remain unchanged.
Index construction takes O(B log N + N log N) bounded work, lookup O(log N),
where B is CFT bytes and N is record count; full-key comparisons are 16 bytes.

## Synthetic Node samples

Outside-repository prototype samples on the development host included build and
query time. At 27,000 records / 675,000 CFT bytes, substring versus indexed totals
were approximately 1 versus 181 ms for one query, 96 versus 161 ms for 512 queries,
377 versus 155 ms for 2,048 queries, and 5,023 versus 166 ms for all 27,000 queries.
At 128 records with all queried, totals were 0.12 versus 0.52 ms. At 2,048 records
with all queried, totals were 20 versus 9 ms. These samples motivate a conservative
2,048/2,048 threshold, not a browser/device performance guarantee or game test.

A separate single synthetic sample used the actual revised factory on Node
24.19.0 with the same 27,000-record fixture and 27,000 individual lookups.
Default construction (snapshot and validation included) took 26.8 ms, followed
by 5,160.9 ms of lookups and receipt work, totaling 5,187.6 ms. Indexed construction
took 195.6 ms, followed by 253.3 ms of lookups and receipt work, totaling 448.9 ms.
Both paths performed identical JSON serialization and receipt hashing, and their
output receipts matched exactly. These are production-factory Node measurements,
not the prototype timings above or a browser/device guarantee. The small-batch
tradeoff and conservative threshold remain unchanged.

Focused differential tests compare both paths for valid and absent keys, aligned,
unaligned and cross-record duplicates, all-identical keys, genuine fingerprint
collisions, source mutation, invalid hints and both threshold boundaries:

    node --test web/tests/casc-pack-metadata.test.mjs
