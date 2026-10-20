# Browser production flow

`prepareBrowserPackager` verifies the manifest against the build-substituted HTML
digest, preloads the complete same-origin runtime inventory, irreversibly seals
network access, and initializes every worker before permitting folder selection.
Public shell bytes and metadata are included in that inventory. The shell ZIP
additionally matches the independently bundled release SHA-256 and per-entry
inventory; its actual Mach-O target is inspected.

One folder supplies all NSP files, prod.keys, and title.keys. Isolated extraction
owns keys through the last authenticated lazy read. The callable sequence is
program rewriting, native art, HUD, generated tables, frontend/remaining art and
CASC overlays, full shader conversion, inventory checks, then local staged IPA
writing. Private data is never uploaded. Generation is single-use; cancellation
closes the session and requires reload.

The shader chain label alone is **not** a compatibility blocker. Native
`d2rm_pack.py` explicitly relabels metadata and the c1 directory to the shell's
chain, provided the complete normalized shader-source digest matches SHADER_SRC.
The browser preserves that digest gate, pinned shell hash, and target checks.
Relabeling cannot accept differing shader sources.

Bulk RomFS remains separate as required by the unchanged native shell. This flow
creates an unsigned app package, not a self-contained game-data IPA. Older GPUs'
optional ASTC resource pack is not produced here. No real game input or device run
has validated this browser flow. ZIP32, in-memory stage budgets, OPFS quota and
adapter limits can reject a genuine large build rather than silently truncate it.
Production runtime compilation and initialization must still succeed in the
published artifact; a successful source bundle is not game-compatibility proof.
