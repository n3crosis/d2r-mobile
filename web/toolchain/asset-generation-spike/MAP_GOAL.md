# Complete current-name map-goal generator

`generateMapGoal` reads only authenticated `logicalAssets.read(path,{maxBytes,signal})`
inputs: TalRashaSymbol and Units sprite atlases; `hd/ui/fonts/BlizzardGlobal-V5_81.ttf`;
and `local/lng/strings/{levels,monsters,objects,item-names,npcs}.json`. The font is
an original logical archive input, never an installed OS font or an added user-file
requirement. Missing inputs fail. No proprietary content is bundled.

The pinned original `gen_map_goal_art.py` constants and all functions are extracted
without algorithm changes. The boundary replaces only decoded atlas and logical-read
access. It runs the original `main`, original label rendering, crops, cross alpha
halving, and manifest construction. All 31 labels render in zhCN, enUS, esES, esMX,
and ruRU. The optional private `annot/oldnames.tsv` is absent, as upstream permits;
old names therefore equal current names, with no `_old` image. Supplying an old-name
table is not supported by this operation.

The required inventory is exactly 164 files: seven symbols, cross, 155 labels, and
`mapgoal.json`. No partial inventory succeeds. Inputs are bounded to 24 MiB total
logical bytes, 8 MiB per sprite/font, 2 MiB per string table, 20 MiB serialized
payload, and 2,097,152 decoded pixels. Labels are nonempty, control-free, at most
256 characters; tables contain at most 20,000 unique keys and all required locales.
Measured label widths are bounded to 8,192 pixels before original rendering.
Outputs are bounded to 16 MiB. Temporary work is isolated; owned JS bytes are wiped
on exit, not a secure erasure guarantee. Cancelling a running synchronous Python
render requires terminating its worker.

The decoder callback must supply the validated **complete atlas** and actual frame
width/count. Seven/eight frames, integral pitch and frame width within pitch are
mandatory. No production sprite descriptor is guessed or silently reinterpreted.
Automatic wiring to an extraction/packaging job remains unsupported until that
contract is proven for real source inputs.

## Differential evidence contract

CI executes the untouched original script with authored synthetic full-atlas RGBA,
newly authored TrueType outlines and synthetic five-language strings. The native
oracle independently constructs sprite headers and runs the original `sprite_png`
header parsing and original main. Browser tests require exact bytes for every file,
exact inventory and exact backend versions, with no image tolerance.

This is the separately documented Pillow10.2.0/FreeType2.6.0/BASIC contract from
[HUD.md](HUD.md), not parity with original default RAQM or proprietary game fonts.
The preserved [HUD backend evidence](HUD_BACKEND_EVIDENCE.json) remains applicable.
Legacy FreeType is not a current/safe dependency endorsement: release security and
supported-runtime review remains mandatory before processing real user fonts.
CI proof is pending until the committed workflow passes. No complete production
asset bundle or working IPA is claimed.
