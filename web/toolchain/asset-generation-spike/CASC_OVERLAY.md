# Bounded CASC overlay serialization

This is an internal serialization primitive, not production enablement or a claim
that all replacement assets exist. `web/casc-overlay-writer.mjs` returns real
changed files: `data/.build.config` and one new `data/NN-MMMMMMMM.data` archive.
The new archive holds replacement bytes, rewritten vfs-1 TVFS, and rewritten
vfs-root TVFS. Config CKeys, EKeys, sizes and matching vfs-2 references are updated.
An empty replacement list returns no changed files. Callers retain the original
lazy RomFS tree for every unchanged file; no source archive is cloned.

## Source fidelity

`casc-overlay-provenance.json` pins `dm/tools/casc_overlay.py`. Packaging verifies
its SHA-256 and extracts exact source segments for pure functions, including
`encode_by_espec`, `blte_encode`, `ekey_for`, `set_cft_sizes`, `add_paths`, and
compressed-trie helpers. No original file is modified. Original zlib level 9,
uncompressed n records, 256-KiB BLTE blocks, encoded-block MD5, EKey header MD5,
and decoded TVFS CKeys are retained. Replacement ordering matches native
`rewrite_tvfs`: existing replacements first, additions next, indices last.
The returned inventory is ordered the same way and includes actual assigned
EKeys and encoded/decoded lengths, not an overlay plan.

## Asynchronous reads and memory bounds

A Pyodide synchronous filesystem callback cannot await browser crypto/RomFS
reads. Instead, JavaScript asynchronously reads the authenticated index's config,
streams its manifest selecting only requested keys, and fetches exactly the two
referenced TVFS records. It validates BLTE block MD5, decoded CKey, and EKey header
hash before passing bounded decoded buffers into Python. This does not replace
NCA authentication: the caller must obtain its RomFS index through the existing
authenticated extraction path. Checksums alone are not authentication.

No fake sparse archive, zero-filled missing ranges, synchronous network read, or
full source-archive copy is used. Short reads reject. Manifest duplicate lookup
uses the original overlay writer's first-row rule, deliberately different from
dmx's last-row rule. Inputs are contiguous config, vfs-1, root, and ordered
replacement buffers with exact lengths. The worker receives only those bytes.

Bounds: 1 MiB config, 128 MiB streaming manifest, 16 MiB per TVFS/record or
replacement, 4096 replacements, 64 MiB packed input, and 64 MiB retained output.
Original table layout is explicitly constrained to version 1, 16-byte EKeys,
flags 0x0a, one-byte encoding-spec indexes and fixed 25-byte CFT entries.
Unsupported layouts, unknown encoding specs, ambiguous keys, unsafe paths,
invalid table extents, budget overflows, and unsupported additions reject.
Original restricted new-subdirectory additions are supported. Their tree is
validated with bounded depth before calling original recursive traversal.
Cancellation terminates the worker, and no partially serialized files escape.

The next free valid byte-sized chunk/archive location is selected. Unlike the
native filename search, this cannot select an archive number above 255 that
`ekey_for` itself cannot encode. Prebuilt standalone packs are not implemented.
Tables larger than the current record decoder's 16 MiB cap fail closed. No
production packaging profile is wired to this primitive yet.

## Evidence and CI

`test/casc-overlay-oracle.py` creates only synthetic source archives and invokes
the unchanged original `make_overlay` in an independent temporary filesystem.
It requires exact output bytes from the bounded serializer for n (including an
empty replacement), z, multi-block BLTE, and a restricted new-path addition.
`web/tests/casc-overlay-writer.test.mjs` runs the actual JS lazy-read boundary
against that independent native oracle and tests duplicate lookup, short reads,
checksums, absent paths, budgets and cancellation.

`test/casc-overlay-browser.mjs` runs the actual Chromium/Pyodide worker with the
same lazy JS boundary, blocks external origins, and requires exact native output
bytes. The browser-asset CI workflow runs it and retains
`test-results/casc-overlay-browser.json`. This browser evidence remains pending
until that CI job succeeds. Local validation was limited to fast targeted
Node/Python oracle tests and authored-source format/lint checks.
