# Complete Switch-mode HUD generator

`hud-v4` runs the complete original `gen_hud_v4.py` rendering/layout body inside an
AST-generated function. Only CLI/environment setup, optional developer tuning and
module import discovery are removed. `hud_v4_design.load`, layout patch functions,
and i18n parsing/constants retain their original source. All source and metadata
files are SHA-256 pinned in `hud-provenance.json`; source drift stops packaging.

The mandatory mode is `switch-upscaled`, the native generator's documented fallback.
It is never described as native PC-resolution art. Optional PC input is unsupported.
The six logical archive inputs are explicit in `web/hud-generator.mjs`:

- front_panel, LevelUpButton and greater_healing_potion sprites;
- `hd/ui/fonts/blizzardglobal-v5_81.ttf`;
- `hd/ui/fonts/exocetblizzardot-medium.otf`;
- `global/ui/Layouts/Controller/HUDPanelHD.json`.

The native `Source.font` calls `romfs_art.font`, which reads exactly these font
paths from RomFS, not the operating system. The browser likewise obtains them through
`logicalAssets.read`. Users do not supply extra font files. Missing, unsupported or
oversized fonts fail; no font substitution/fallback is allowed. The nine verified
skill-atlas PNGs come from the previous native-art stage. Their frozen hashes and
dimensions are rechecked, and borrowed PNG buffers are not modified.

Outputs include base.png, hud.json and the entire hud_v4_ui directory: native-size
base/slot images, four level-button states, eight difficulty digits, nine skill
silhouettes, nine skill labels, all three glyph families and ui.json. The Python
adapter checks the exact output set against every glyph recorded by the original
renderer plus every fixed inventory member. A whitespace glyph with no ink retains
the native `file: null` representation; it is not silently dropped from ui.json.
The generated layout and base image remain necessary inputs for later overlays.

Bounds: HUD-only JSON payload 64 MiB; other operations retain 20 MiB. Six logical
reads total at most 40 MiB, each at most 16 MiB, with stricter CASC block/record limits
still enforced. Each font is at most 16 MiB, combined source/atlas imagery 4,194,304
pixels, metadata/layout 2 MiB each, outputs 512 files/32 MiB. Runtime canvases retain
the original fixed 2868×1320 dimensions and therefore need substantial WASM memory.
Real game font sizes have not been verified. These limits are explicit rejection
gates, not a claim that all current game revisions fit.

## Differential evidence

CI installs pinned FontTools only in the native fixture generator and creates a
new TrueType font from simple authored rectangular outlines. It does not download,
copy, rename or bundle any game/system font. Native and browser receive identical
fixture font bytes, synthetic input sprites, structural layout and atlas PNGs.
The oracle executes the unchanged native script and helpers. Chromium compares
EVERY output byte and exact inventory, including all glyphs and JSON. It also rejects
missing font input and undeclared mode. This proof is pending CI; no production
font/glyph fidelity or complete IPA is claimed from synthetic rectangles.

The stage requires a complete-image texture callback, not a frame crop. The native-art
whole-atlas client is suitable only for headers satisfying its padded-frame contract;
actual HUD headers have not been verified against that contract. A separate exact
whole-image descriptor path may be needed, and no existing frame guard is weakened.
This stage is not automatically wired into packaging. Cancellation propagates
through logical reads/decoder; the owner must terminate the Python worker when
cancelling long synchronous rendering. Font parsing stays in that dedicated worker.
Temporary files are removed; JS-owned input byte arrays are wiped. Secure erasure of
Python/string/WASM heap copies is not claimed.
