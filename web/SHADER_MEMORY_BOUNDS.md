# Shader output memory bounds

[简体中文](SHADER_MEMORY_BOUNDS.zh-CN.md)

Production shader output retains the existing 512 MiB ceiling. Base and fetch
source bytes count once. Compact replay JSON reserves interim budget; after the
full source digest proof, actual post-chain formatted JSON replaces that
reservation. The final c1 index also counts. Failure occurs before retaining an
output that exceeds the ceiling. Output formatting, source digest checks and
noMetal/on-device compilation remain unchanged.

Each output replay yields owned copies with at most 64 KiB backing buffers and
checks cancellation/disposal before every chunk. Concatenated bytes remain
identical. This bounds a replay copy, not the total retained shader outputs.

Entering embedded shaders wipes and drops any previous physical pack and resets
its cache identity. The main image remains until all embedded records have fully
completed, even if their ordering is noncontiguous; its last completion wipes and
drops it. Later physical-pack revisits reload rather than reuse stale bytes.
Failure/final cleanup wipes remaining sources. Existing per-source limits remain
256 MiB; no caps increase.

## Bounded pack-record index

Production uses `catalog.createOwnedPackSource(name, packBytes)`, returning only
`prepare(key, flags)` and `dispose()`. It transfers the complete ordinary
ArrayBuffer backing, detaching all caller aliases without a full-pack copy.
Shared/resizable buffers and subviews are rejected, with no copy fallback.
The source cache disposes the owner on source changes and final cleanup; failed
preparation is terminal and wipes the pack and index. Late results after
cancellation/disposal also have their owned code wiped.

The private Uint32 offset table is bounded by the pinned catalog's highest
selected index plus two: at most **17,284 bytes** for the one retained pack.
Offsets are populated lazily, preserving native non-overlapping `BTCDBTCD`
matches, EOF boundaries and repeated/out-of-order requests. Public
`catalog.prepare(key, {packBytes})` semantics and per-record control hashes, stage,
c1 and size checks remain unchanged.

The pinned catalog selects 6,923 pack records across 149 packs, plus four embedded
records. Prefix rescanning requires at least 7,843,265 successful marker matches.
A Node synthetic run through the actual APIs, ending each pack at its highest
selected record, counted **7,850,039** full-marker matches with raw preparation
versus **10,058** with owned indexing. Synthetic control digests were mocked only
to exercise selection; no real translation ran. These are operation counts, not
browser timing, RAM measurements or real-game proof.

Focused synthetic tests establish accounting, chunk backing sizes, cancellation
and cache lifetime behavior. They do not measure browser RAM savings or establish
real-game validation.
