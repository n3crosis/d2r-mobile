# Linked asset job adapter

`createAssetPipelineAdapter` is callable through the existing packaging job's
`generateAssets({extracted, selection, signal})` interface. It composes reusable
primitives; `production-assets.mjs` supplies the complete production recipe.
The adapter alone does not provide a full asset pipeline.

## Provenance and source ordering

The fixed resolver is `readAuthenticatedAssets`. Its private WeakMap record
binds the exact extraction result identity, selected base/patch/DLC versions and
live extraction session. Copying an object, changing selection, setting a trust
boolean or using a disposed session cannot satisfy it. The resolver exposes only
the existing bounded logical reader and bounded RomFS capability. The RomFS
inventory contains frozen path/BigInt-size records, not raw offsets, worker
transport, NSP handles, keys or sessions. Indexing's existing file/path/depth caps
remain authoritative.

There is no exported resolver override or registration test seam. Synthetic tests
construct outputs through the real extraction adapter with a fake worker. The
packaging job still requires `secretLifetime: "archive"`; compose this adapter's
`dispose` with job cleanup.

1. Verify extraction provenance before creating clients or reading source bytes.
2. Optionally generate all 164 legacy map-goal outputs from authenticated archive fonts,
   strings and complete atlases. The existing decoder's `frameCount` is passed as
   `frames`; its full layout/pixel checks are not weakened.
3. For each explicit trusted texture recipe, read a bounded template and verify
   its exact configured SHA-256 **before** decoding or applying its transform.
4. Call the supplied source-derived RGBA transform, validate bounded dimensions
   and the v61 single-frame template, then call `encodeAndPack` on the real BC3
   encoder interface.
5. Serialize the ordered encoded replacements with the real bounded CASC writer.
   Existing archives remain lazy; only changed config/new data bytes are emitted.
6. Return sorted chunked entries; keep output bytes until consumed/disposed and
   close all runtime clients. Cancellation or disposal terminates clients and
   rejects pending transforms promptly; late worker/transform byte results are
   wiped instead of released as successful output.

## Native destinations and boundaries

`dm/tools/d2rm_pack.py` stages `mapgoal/` from generated NativeHUD assets and
`romfs_overlay/` from `gen_romfs_overlay.py`. The adapter uses these exact prefixes.
It does **not** copy bulk game resources into an IPA, decide where those resources
live on the phone, change the native shell, or manufacture the remaining overlay
profiles/variants/sidecar files. Original transforms still need to be ported and
wired with their trusted source/digest contracts. No inferred template hash or
production replacement image is bundled here.

The plan is snapshotted before execution. Limits are 32 texture recipes, 8 MiB per
source, 4M pixels per transform, 48 MiB retained encoded replacements, 80 MiB total
output, and 64 KiB output chunks. The underlying map-goal/CASC/encoder limits also
apply. Generated intermediate bytes are wiped once copied/consumed; failure
removes retained output and returns a fixed sanitized error. Cleanup failure is
reported explicitly. No browser-runtime factory silently loads remote assets;
trusted application wiring must provide fully preloaded/sealed clients.

## Source-derived generation extensions

`mercenaryArt: true` produces the two native mercslots files with the original
composition and shared BC3 encoder. `remainingArt: true` requires
`nativeOverlayGenerated` and produces the source-pinned stash/trove/vault/pouch
prerequisites privately. The optional `nativeOverlayGenerated` object carries
only named native recipe prerequisites (normally the preceding HUD and panel
generator outputs). The adapter adds generated mercenary/remaining sprites,
rejects collisions and calls the original native overlay recipe, then the real
CASC writer. It emits base and item_notes overlay paths as package entries.

Native overlay mode rejects concurrent ad-hoc texture replacement recipes,
which could otherwise overwrite its config. Extra intermediate PNG files are
not passed to the recipe or added blindly to the package. Missing prerequisites
fail explicitly; the adapter does not fabricate HUD/panel output or source hashes.
All intermediate arrays are job-owned and cleared after serialization. This
wiring is not a claim of full real-game or combined browser validation.
