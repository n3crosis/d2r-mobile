# Native overlay recipe

`generateNativeOverlay` connects authenticated extraction output, original native
layout/table/string transformations, and the real bounded CASC serializer. It is
not just a replacement-path plan. It returns actual base and `item_notes` overlay
bytes with their sidecars, ready for packaging-job entries.

## Revision boundary

Production retains the v1.0.18 overlay behavior while trusted v2 shell evidence
is not activated. The dormant release revision
`b811b90172f4eb40ec1bc89d903308e0c5ab88d0` adds Korean, Xbox glyphs and complete
per-variant manifests. The separate latest source revision
`e3756f8942b40eba6c851e881828a5b1bda17fd6` also adds PlayStation glyphs and four
voice strings; the published v2.0.0 shell predates those changes. A version label
alone cannot activate either new branch. See
[recipe revision status](toolchain/overlay-recipe-js/README.md#upstream-source-revision-and-shell-activation).

## Preserved semantics

The source-pinned `gen_romfs_overlay.py` orchestration and its helper modules are
packaged locally. Original code retains ordered touch/controller edits, large
font and string transforms, i18n additions, drop-light models, mercenary slots,
pouch and stash table/layout edits, complete touch namespace copying, inheritance
rewrites, exact controller/shared layout-set assertions, and the item-notes
variant. Optional private old-name/comment tables remain absent, just as the
original public-source path permits; no substitute game data is supplied.

Only boundaries change:

- Native `gen_assets.ensure` becomes a strict exact generated-art prerequisite
  check. The caller must provide every path in `NATIVE_OVERLAY_GENERATED`.
- Archive reads use authenticated logical assets. Original MD5 format checks
  remain in the Python read boundary; they are not claimed as authentication.
- The manifest is streamed and projected to the actual metadata columns the
  transforms use. The first-versus-last duplicate-row ambiguity is rejected
  rather than silently changing native selection semantics.
- The original emit function keeps namespace migration, inheritance rewrites,
  and exact layout inventory assertions. Native process invocation is replaced
  with captured binary replacement records, which then go through the existing
  actual `writeCascOverlay` implementation.
- Actual `ctrl_touch`, `touch_strings.tsv`, `features.txt`, and
  `dm_textbox_plain.tsv` sidecars are retained. No fake `.data` file is emitted.
- Every Python filesystem write is inside an operation-owned temporary root.
  Original helper modules and environment settings are restored afterwards.

The original recipe runs with iOS semantics. Mac keyboard glyphs and optional
external ASTC packs are deliberately not accepted. The currently required two
variants are the base overlay and `romfs_overlay_variants/item_notes`.

## Bounds and ownership

The worker operation is `overlay-recipe` with empty options. It accepts at most
128 MiB of JSON payload, including at most 64 MiB of authenticated source files
and 48 MiB of generated art. Individual source/output files are at most 16 MiB;
manifest metadata is at most 16 MiB / 262,144 rows; there are at most 8,192 source
files and 4,096 replacements per variant. Aggregate emitted bytes are at most
128 MiB. The CASC writer retains its separate 64 MiB per-overlay bound.

Source files are prefetched only from the layout/string/table/model/cursor/glyph
families used by the recipe. Original archives remain lazy and are never cloned.
Generated art is caller-owned; temporary decoded source buffers, payloads and
worker outputs are cleared after use. The caller owns worker lifetime; abort
terminates the worker. No keys or NSP handles enter this operation.

These conservative bounds fail closed; their sufficiency for a real title is
not yet measured. This is an internal primitive, not a complete production
profile or enabled Generate IPA path.

## Current evidence

The local packager verifies exact source hashes and compiles the adapted script.
Authored Python/JavaScript syntax, focused lint and formatting pass. The missing
input path rejects before native recipe execution. Full generated-art plus real
layout/table data, native/browser output parity, and full-title throughput remain
unverified. Broad tests are deferred per the current implementation-first plan.
