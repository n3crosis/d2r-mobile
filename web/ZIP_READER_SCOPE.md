# Bounded shell ZIP input

`openShellZip(source, { signal })` indexes a prebuilt ZIP32 shell from the
`preflight.mjs` random-access source interface (`size`, asynchronous
`read(offset, length)`). It returns a frozen object:

- `entries`: frozen metadata snapshots with `path`, uncompressed `size`, UNIX
  `mode`, `directory`, `compressedSize`, numeric `crc32`, and `method`.
- `readEntry(path, { signal })`: returns a new `Uint8Array` only after exact decoded
  length and CRC32 validation. The read signal defaults to the indexing signal.
  Unknown paths, concurrent reads on the same reader, cancellation, truncated
  reads and corruption reject. Errors do not include raw source errors, filenames,
  payload bytes or cancellation reasons.

Metadata fits `shell-contract.mjs`'s inventory shape. Passing the ZIP inventory to
that contract remains mandatory: this reader does **not** establish trusted
recipe provenance, content-free policy, bundle identity, signature status, target
OS compatibility, or cryptographic authenticity. Its safe UTF-8 path vocabulary
is deliberately broader than the contract's ASCII-only shell vocabulary; the
contract may reject otherwise readable entries. CRC32 is corruption detection,
not proof of trust. The source must remain immutable across indexing and reads.

## Accepted and rejected forms

STORE and native `DecompressionStream("deflate-raw")` DEFLATE are supported,
including signed and unsigned ZIP32 data descriptors. UTF-8 names require the
UTF-8 flag; unflagged ASCII is supported, but legacy non-ASCII codepages are not.
Directories have empty decoded content. UNIX regular files/directories and
ordinary permission bits are accepted; symlinks, special files and special
permission bits are rejected. Duplicate/case/ancestor conflicts, unsafe paths,
local/central disagreements, overlaps, gaps, prepended executable stubs and hidden
local records are rejected. This is intentionally stricter than a general ZIP
extractor. Unicode path override extras are unsupported.

ZIP64 input, multipart archives, encrypted entries, unsupported compression,
ambiguous end records and ZIP64/encryption extras are explicitly unsupported.
Output ZIP64 support belongs to the independent ZIP writer, not this reader.

## Resource boundaries

Fixed ceilings are 256 MiB archive and aggregate decoded bytes, 64 MiB per encoded
or decoded entry, 20,000 entries, 8 MiB central metadata, 2,048 encoded name bytes,
512 path characters, 32 path components, 50,000 distinct explicit/implicit path
nodes and 8 KiB extra fields per record. Metadata exceeding a
1,000:1 expansion ratio is rejected before output allocation. All local headers
and descriptors are checked before any payload is decoded. No full-archive copy
or extraction tree is made: indexing reads a maximum 65,557-byte tail plus small
records, and a read allocates only its declared bounded output entry. Callers
should consume and release entries sequentially rather than retain all outputs.

A separate bounded RFC 1951 structure scanner verifies stored/fixed/dynamic
blocks, Huffman tables, decoded counts and back-reference distances, and requires
the final block to end at the exact compressed-byte boundary. This rejects
trailing junk even on native runtimes that silently accept it (observed in Node
22). The scanner retains at most 8 KiB of incomplete framing and never creates
decoded payloads. The native decompressor still produces and validates output.

DEFLATE input uses 1 KiB reads, awaits each write's backpressure, and drains output
concurrently, checking every chunk against declared decoded size. Small input
slices matter because Chromium may expand an entire input chunk before JavaScript
can inspect output. Failure/cancellation cancels both stream directions and waits
for them to settle; source reads must eventually settle as the random-access
interface itself does not offer abortable I/O. STORE reads use the preflight 4 MiB
maximum. A reader permits only one active entry read at a time.

## Evidence and limits

The focused test file generates independent Python standard-library `zipfile`
fixtures using only synthetic public text/random bytes. It covers STORE, DEFLATE,
UTF-8, data descriptors, missing/truncated/corrupt data, metadata mutations,
malicious paths, modes, duplicates/conflicts, bounded reads and cancellation.
These fixtures are not real game content, keys, NSPs or downloaded shell bundles.
Full project/browser/device validation is left to CI and authorized device work.
