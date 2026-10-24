# Mercenary image composition

`mercenary-art` executes the source-pinned pixel composition from
`dm/ios/tools/gen_merc_art.py`. The packager extracts its constants and the 19
original statements before codec/filesystem output, then returns the composed
Pillow image. It does not rewrite the geometry, drawing, masking, or row placement.

The JavaScript generator resolves exactly one authenticated CASC logical path for
each native `/ui/controller/panel/…` suffix:

- `hirelinginventory/v2/hirelinginventorybg.sprite`: SpA1 v61, frame width 652,
  storage dimensions 652 × 704.
- `inventorypanel/v2/inventorybg_classic.sprite`: decoded atlas 507 × 700.
- `mainpanelbg.sprite`: decoded full atlas 2888 × 881, whose right half is used by
  the original composition.

Suffix ambiguity (including duplicate manifest rows for a matching path) is
rejected instead of guessing which original record should win. No real-game
content hash is fabricated. Extraction identity and existing authenticated CASC
reads remain the trust boundary; a hash-pinned supported release profile remains
an independent production requirement.

Inputs are three bounded decoded RGBA atlases and their original 40-byte headers.
The JSON payload is capped at 20 MiB. The operation returns the exact 652 × 704
RGBA composition and PNG, then the existing original BC3 encoder/NVN packer creates
`HirelingInventoryBG.sprite` using the original template header. Source data and
intermediate byte arrays are cleared on completion/error where JavaScript owns
them. The job owns and terminates codec workers on cancellation.

`createAssetPipelineAdapter({ mercenaryArt: true, … })` emits the two native
`mercslots/HirelingInventoryBG.{png,sprite}` entries. It does not pretend to perform
`merc_slots.py`'s separate JSON layout/cell relocation changes or put the generated
background into CASC by itself. The native overlay orchestrator must still apply
those matching layout changes and replacement rules.

## Minimal local evidence

Run preparation and one authored composition smoke from the repository root:

```sh
python3 web/toolchain/asset-generation-spike/scripts/package-mercenary.py
python3 web/toolchain/asset-generation-spike/test/mercenary-reference.py
```

The smoke executes untouched original `main` with file/codec-boundary shims and
compares its complete RGBA and PNG to the packaged transform. It passed on an
authored pattern, including alpha masking, source-coordinate shifts, and bottom
bands. This is **composition parity only**: the shim does not claim to encode
BC3. The existing BC3 codec has its own independent tests. Fresh combined browser,
sealed-runtime, real-game image, and device/full-IPA validation remain pending.
