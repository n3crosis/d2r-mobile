# Browser production flow

`prepareBrowserPackager` verifies the manifest against the build-substituted HTML
digest, preloads the complete same-origin runtime inventory, and initializes
every worker before permitting folder selection. The prototype no longer imposes
a CSP network lockdown; local processing and no-upload behavior remain.
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

Bulk RomFS is exported directly into a fresh `D2R-resources-<UUID>` child of the
selected input folder, streaming authenticated chunks while the isolated
extraction session is alive. The single folder picker requests read/write
permission; original NSPs and key files are never written. Root-only input
discovery ignores generated subtrees, and subsequent runs create new children.
Export runs
only after generated-content and assembly validation, and completes before IPA
commit. The validated IPA is published as a bounded Blob for a normal browser
download, not written to the input directory. Its destination follows browser
settings; a visible Download IPA link retains its object URL for retries until
the page is disposed or the URL is replaced. The resource exporter marks
incomplete transfers; a later IPA failure
does not invalidate an independently completed resource folder. Users copy the
resource folder into the installed app’s Files folder. This preserves the native
shell layout without requiring external extraction tools or bundling huge game
data into the IPA. Older GPUs'
optional ASTC resource pack is not produced here. No real game input or device run
has validated this browser flow. ZIP32, in-memory stage budgets, OPFS quota and
adapter limits can reject a genuine large build rather than silently truncate it.
Production runtime compilation and initialization must still succeed in the
published artifact; a successful source bundle is not game-compatibility proof.

DLC is optional. The trusted production policy accepts base plus update packages,
and accepts only the authenticated known DLC when supplied. The effective runtime
mode comes from the authenticated selection, not a UI checkbox. For a no-DLC
selection the original pinned shell executable is reverified and its unique
source-identified ownership-cache initializer changes from -1 to 0. Exact SHA,
symbol, section, preimage and deterministic result checks remain mandatory. The
output records this bounded variant in `dm/content_mode.json`; all other shell
bytes stay unchanged. The existing executable signature becomes stale and the
IPA must be re-signed before installation, as with any unsigned output. This is
source-backed behavior, not proof of base-only gameplay or runtime loading.
