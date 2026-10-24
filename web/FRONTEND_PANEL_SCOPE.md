# Frontend right-panel transform

`frontend-panel-transform.mjs` supplies the exact five column copies from
`dm/ios/tools/gen_fe_rightpanel.py` (SHA-256
`c68ea1e6d5c720eca576b298708cd637d8d2d898d192e34a92c41121a52db424`).

The input is a single 401×1080 frame. A whole decoded atlas may contain one to
three trailing padding columns; those are cropped exactly as native
`romfs_art.sprite` crops to the frame width. Other dimensions, frame counts,
short buffers, and shared buffers reject. Only rows 980–1039 are changed; each
copy reads original input pixels, never an earlier destination. The source is
not mutated, and a failed transform wipes its allocated output.

`createFrontendPanelRecipe({ sha256 })` connects this transform to the existing
asset pipeline's hash check, BC3/v61 encoder, and CASC replacement serializer.
The replacement destination is the original frontend panel path, matching
`gen_romfs_overlay.py` line 102. Native's generated intermediate is
`NativeHUD/touch/fe_rightpanel.sprite`; no intermediate PNG is required.

The caller must supply an independently trusted release input hash. The native
generator does not contain that hash, so this module does not invent one. This
is an implemented transformation, not a complete production release recipe.

The transform reuses the original native BC3 algorithm and existing encoder by
composition; this module alone does not establish browser encoder or complete-game
parity. See [production flow](PRODUCTION_FLOW.md) for runtime integration.
