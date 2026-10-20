# Native overlay recipe, without Python

This scoped implementation replaces the bounded `overlay-recipe` operation. It
does not access a filesystem, fetch assets, serialize CASC archives, or change
shared runtime dispatch. Inputs and outputs retain the existing worker contract.

## Runtime API

`createOverlayRecipe({ png, md5, sha1 }).execute("overlay-recipe", payload, {})`
returns a promise for `{ files, variants }`.

- `payload` is the original UTF-8 JSON `Uint8Array`, containing `manifest`,
  base64 `assets`, and the exact 14-entry base64 `generated` map.
- `png.decodeRgba` is the pinned exact PNG codec.
- `md5(bytes)` and `sha1(bytes)` return lowercase hex, synchronously or by promise.
- Every output file is a unique `Uint8Array`. Variant and file insertion order,
  `file-N` references, replacement additions, and sorted sidecars match the
  original capture boundary.

The operation has no font or browser-canvas dependency. It consumes generated
HUD/mercenary/stash/pouch artwork and emits the source's raw SpA1 v31 sprites for
the HUD and fixed close button. Other artwork is passed through byte-for-byte.

The original input limits remain: 128 MiB payload, 16 MiB manifest and individual
files, 64 MiB decoded assets, 48 MiB generated assets, 8,192 files per input map,
262,144 manifest rows, 4,096 replacements per variant, and 128 MiB total output.
Canonical base64 is required. Authentication hashes are checked before consumed
assets are exposed to the transforms; the caller's authenticated extraction and
receipt validation remain necessary.

The orchestration preserves:

- Ordered touch, frontend, in-game, mercenary, profile, strings, i18n, drop-light,
  pouch, wide-stash and controller modifications.
- Original-layout copying into the three touch directories, conditional
  inheritance rewrites, and the exact controller/shared-layout allowlists.
- Separate `base` and `item_notes` variants, including the original feature and
  textbox sidecars. Unchanged paths retain their original bytes.
- Public-source annotation behavior, without unavailable private annotation
  files, Mac-only keyboard glyphs, or legacy ASTC-pack branches.

Static widget strings and translation tables are generated only from pinned
repository sources. They are data, not a Python runtime or source interpreter.
All original source files stay in the repository.

## Verification

`node web/toolchain/overlay-recipe-js/scripts/verify-source.mjs` checks 19 native
source/operation-boundary pins and four static-data pins, including the fixed
close image and embedded image hash.

Focused annotation, inventory and touch-layout parity runners live under
`test/`. They use trusted local native sources as build-time oracles and
deterministic synthetic inputs, not a browser or game installation.

`node web/toolchain/overlay-recipe-js/test/recipe-parity.mjs` passed complete
synthetic operation parity: 263 exact output files and both ordered variant
receipts, including every sidecar. The test checks a committed aggregate digest
of all output hashes and receipts, and rejects incorrect source MD5/options.
It combines 79 synthetic layouts with authored string, model and binary tables.
Some touch strings use explicit test-only SHA-1 sentinels because original game
strings are not available; production checksum checks are unchanged.

By default, the two PNG inputs use their known decoded test pixels. Add `--wasm`
after building the exact PNG codec to verify that dependency too. This is
complete synthetic recipe parity, not full-title or game compatibility evidence.
The operation is not integrated into shared worker dispatch by this directory.

The full oracle exposed a pre-existing wrapper defect: its `gen_merc_art` stub
provided `ART` but omitted the native `DX=63` and `DY=11` used by mercenary layout
placement. The authorized boundary fix is in the source Python wrapper; the test
loads that corrected wrapper and the original pinned native recipe. No layout
transformation or guard is bypassed to obtain the comparison.
