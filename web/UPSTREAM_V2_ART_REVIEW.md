# Upstream v2 art source review

Reviewed the merge of upstream `e3756f8942b40eba6c851e881828a5b1bda17fd6`
against browser feature base `75ce76faf90d71d9466b4a5a655953c553a81859`.
This record covers art/HUD/table-path source adaptation, not a new shell release.

## Semantic changes and handling

- `native_art/generate.py` now checks decoded RGBA dimensions and SHA-256 instead
  of depending on one PNG compressor. The manifest adds exactly twelve
  `decoded_rgba_sha256` fields; removing those fields yields the previous manifest
  exactly, including every original source hash, PNG hash, descriptor and binding.
  The JavaScript recipe requires the new RGBA hashes **and retains** its existing
  encoded-PNG digest guard and frozen/browser digest pairing. The Python boundary
  likewise retains its PNG-byte guard. The new `validate_rgba` function is included
  in AST packaging. The generated C comment and embedded manifest hash change;
  descriptor rows and the default iOS include path do not. The optional upstream
  external output directory is not exposed in the browser recipe.
- `gen_map_goal_art.py` adds Korean rendering and `koKR` manifest entries. Both
  bounded wrappers retain five locales and the 164-file inventory by default.
  Only the explicit internal upstream revision requires all six locales and
  returns 195 files: seven symbols, one cross, 186 labels and one JSON manifest.
  Korean validation, both inventories, ordering, output budgets and cleanup have
  inert synthetic coverage. AST-only branch specialization proves the packaged
  `main` matches the old or upstream source AST exactly for its selected revision.
- `gen_hud_v4.py` moves CLI parsing to argparse and makes skill silhouettes
  conditional on `--overlay-only`. Static AST comparison found the full normal
  computation unchanged after omitting CLI tuning and selecting the full iOS
  silhouette branch. Packaging now performs those explicit transformations and
  fails if `args`/`sys` dependencies remain. Its `dflt` numeric function is
  AST-identical to the prior revision.
- `dm_i18n.py` and the shared TSV add Korean. HUD parsing validates
  that column, while its default vital-character sequence remains identical to
  the public pre-v2 TSV. Only the explicit upstream revision includes the actual
  Korean life/mana characters, changing the vital-glyph inventory. Historical 96-file HUD rendering evidence is not
  evidence for the expanded v2 inventory.
- `romfs_art.py` and `gen_widestash_art.py` add an optional prebuilt deswizzle
  library. That native-library loading code is not included in browser recipes.
  Static AST comparison confirmed `widen_bg` unchanged; no pixel-kernel change
  or native-library execution is needed for this source adaptation.
- `gen_romfs_overlay.py` has substantial overlay additions handled separately.
  Its extracted `touch_path` function and `LAY`/`UI`/`TDIR` constants are
  AST-identical, so the narrow table/path transform remains unchanged.
- `shell_stubs.py` adds optional generated-directory arguments and changes native
  stub registration. Only `unq`, `paths`, `parse` and `data` are packaged here.
  `unq` is AST-identical; the other three only add `gen=None` plumbing in this
  subset. Their default path selection, parsing and derived-TSV serialization
  remain unchanged. The changed native `stubs` implementation is not packaged.
  This review neither changes nor verifies a v2 shell compatibility profile.

`art-recipes-js/revision.mjs` aliases the overlay discriminator: default
`v1.0.18`, inactive release source `b811b90172f4eb40ec1bc89d903308e0c5ab88d0`,
and inactive upstream source `e3756f8942b40eba6c851e881828a5b1bda17fd6`.
Unknown revisions fail closed. The pipeline never selects the upstream branch;
this is an internal integration discriminator, not a user choice. It must not be
activated without separately verified, matching future shell evidence.

Pins were updated only after these source comparisons and corresponding browser
changes. Hash validation still fails closed on any further source drift.

## Published b811 release source binding

`RELEASE_ART_REVISION` aliases the exact b811 overlay discriminator, independently
of the later e375 discriminator. Both inactive revisions use the same art/HUD
branch, based on a byte comparison of 21 shared input files recorded in
[`release-source-compatibility.json`](toolchain/art-recipes-js/release-source-compatibility.json).
This covers the native generator/manifest/index metadata, HUD/design/layout,
map-goal, remaining art, numeric/path helpers and selected table sources.
The only shared-table difference is four `dmCustomVoice*` rows added after b811;
the two HUD vital rows are identical and those voice rows never enter its glyph
inventory. The merged browser `dm_i18n.py` changes only build/header integration;
its extracted `rows` function is AST-identical. Additional merged `dmWeb` rows
do not enter HUD vital glyph selection. The comparison record also pins these
merged inputs, and an inert regression checks them and both mock map outputs.
This is source-level evidence, not a rendered-output or shell-activation claim.

## Verification performed

Passed source gates:

    node web/toolchain/art-recipes-js/scripts/verify-source.mjs
    node web/toolchain/hud-recipes-js/verify-sources.mjs
    node web/toolchain/asset-transforms-js/scripts/verify-source.mjs
    node web/toolchain/remaining-art-js/scripts/verify-sources.mjs

AST-only packaging of core, native-art, HUD, map-goal and remaining-art passed,
as did the static art-kernel migration script. These
scripts parsed source as data and emitted text; the emitted original recipes
were not imported or executed.

The following inert JavaScript suite passed 35 tests. The new native-art test
runs sixteen authored success/rejection cases using a deterministic byte codec
stand-in, not a PNG encoder. Map-goal rendering uses mock pixel/font backends.

    node --test web/tests/upstream-v2-art-contract.test.mjs \
      web/tests/map-goal-generator.test.mjs \
      web/tests/map-goal-recipe-budget.test.mjs \
      web/tests/native-art-generator.test.mjs \
      web/tests/native-art-png-digests.test.mjs \
      web/tests/hud-generator.test.mjs \
      web/tests/asset-text-validation.test.mjs \
      web/tests/asset-generator-output-lifetime.test.mjs

The broader asset-pipeline test stopped at a stale CASC packaging pin before its
Python recipe oracle ran. It was not used as v2 parity evidence or rerun as part
of this restricted source-only validation.

Modified JavaScript modules and generated Python text pass syntax parsing, and
`git diff --check` passes. Repository formatter/linter executables are unavailable
in this workspace; no fresh formatter/linter result is claimed.

## Remaining gates

No compiler, native renderer, WASM module, browser, simulator, or private game
input was executed. No rendered-byte equality, font compatibility, complete
production bundle, or old/new-shell compatibility is claimed. Preserve the
existing proven shell profiles. Fresh authorized rendering/integration evidence
is required before treating this v2 source migration as a release proof.
