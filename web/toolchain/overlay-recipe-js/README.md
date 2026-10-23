# Native overlay recipe, without Python

This scoped implementation replaces the bounded `overlay-recipe` operation. It
does not access a filesystem, fetch assets, serialize CASC archives, or change
shared runtime dispatch. Inputs and outputs retain the existing worker contract.

## Upstream source revision and shell activation

Production still uses the verified v1.0.18 shell contract. Empty operation options
retain its exact historical i18n rows, four-language settings page and sidecars;
`legacy-v1-data.json` records the source commit and original data hashes. A compact
67-key exclusion and one language-row replacement reconstruct the exact old key
order, translations and page bytes, rather than shipping duplicate recipe tables.

The internal `{ revision: "b811b90172f4eb40ec1bc89d903308e0c5ab88d0" }` operation
matches the v2.0.0 release source: Korean strings/fifth language option and Xbox
glyph remapping/marker, but no PlayStation marker or four later voice strings.
Its 449-row translation projection is checked against the exact historical data
hash; `release-contract-source.json` records the original native source closure.

The internal `{ revision: "e3756f8942b40eba6c851e881828a5b1bda17fd6" }` operation
adds Korean touch/i18n strings and the fifth language option, Xbox/PlayStation
face-glyph remapping and marker files. `generateNativeOverlay` accepts that same
internal `recipeRevision` and seals each completed CASC/ASTC variant with the
upstream `DM_OVERLAY_V1` manifest, including final sidecars and pack metadata.
Its fingerprint follows the normalized native dependency closure in
`contract-source.json`; payload hashes remain byte-exact.

No production profile selects this revision. The published v2.0.0 iOS shell was
built from an earlier commit, b811b901, and is not evidence of the later
PlayStation host behavior. iOS does not consume the Android manifest validator;
that is not permission to bypass browser integrity or capability validation.
All revisions keep MOVIE_FFMPEG=0, excluding optional movie/voice behavior.

Focused inert tests: `node --test web/tests/overlay-v2-contract.test.mjs
web/tests/native-overlay-prebuilt.test.mjs`. They cover isolated legacy output,
Korean rows/source checks, glyph mappings/fallbacks, manifest format/rejection and
all four regular/ASTC variant manifests. They are not native-oracle parity.

The latest-source full native recipe baseline is deliberately marked pending in
`test/expected-upstream-recipe-sha256.json`. The runner compares all bytes and
receipts to the native oracle before requiring a reviewed aggregate pin. Do not
copy a JS-only digest or overwrite the historical v1 aggregate to make it pass.
Native/WASM/browser/full-title verification was not run for this source update.
The explicit pending gate is
`node web/toolchain/overlay-recipe-js/test/recipe-parity.mjs`; it requires Python,
Pillow and the AST-packaged latest native source bundle. After independent
native/JS byte equality, review the full output/receipt digest and populate the
pending pin. This runner is not called by the production npm test/CI aggregates.
The legacy data equality and default-output tests remain in the ordinary inert
test suite; the historical 263-file native evidence is not relabeled as v2 proof.

Source closure checks do not execute native generators:
`python3 web/toolchain/overlay-recipe-js/scripts/generate-contract-source.py --check`
checks the merged source; adding `--release` checks exact b811 git blobs, requiring
that historical commit locally. Regular source verification uses the pinned static
release record and does not require a historical checkout.

Payload impact against the pre-merge browser HEAD: the changed/new runtime modules
and JSON above add 77,418 raw bytes (24,709 bytes by summed per-file gzip, not a
production bundle measurement). This includes a 46,514-byte annotation-table
increase, 8,043-byte legacy delta plus 1,389-byte helper, and 9,980 bytes of source
closure records. The release-specific row delta/helper add only 1,321 bytes.

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

`node web/toolchain/overlay-recipe-js/scripts/verify-source.mjs` checks 21 native
source/operation-boundary pins and eight static-data pins, including the fixed
close image and embedded image hash.

Focused annotation, inventory and touch-layout parity runners live under
`test/`. They use trusted local native sources as build-time oracles and
deterministic synthetic inputs, not a browser or game installation.

Before this upstream update, the legacy recipe passed complete
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
