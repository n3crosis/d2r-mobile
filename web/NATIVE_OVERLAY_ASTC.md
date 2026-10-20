# Optional ASTC overlay assembly

中文: [NATIVE_OVERLAY_ASTC.zh-CN.md](NATIVE_OVERLAY_ASTC.zh-CN.md)

Internal `generateNativeOverlay` accepts optional `prebuiltPack: {pack,records}`,
using the `writeCascPrebuiltOverlay` metadata contract. No pack source or payload
is accepted. Original assets still enter through `readAuthenticatedAssets`;
metadata is not an authentication flag. The trusted coordinator must supply
records and digest from its finalized generated pack, not user-provided claims.

Before asynchronous work, selected metadata fields are copied with limits of
32768 records, 8 MiB path bytes and 16 MiB serialized JSON. Each host write binds
old keys to the original manifest, reserves the original overlay location before
the pack location, and checks the returned pack receipt. Each ASTC archive name
must equal its corresponding BC archive name, preserving native prefetch naming.

The same base and item_notes recipes produce both BC and ASTC roots. Sidecars
are copied unchanged. Exactly one `pack.json` is written under
`romfs_overlay_astc/`, not under the item_notes variant. The external archive
itself is never included. Combined output retains the existing 128 MiB cap.

With no option, existing BC files, variants and return shape remain unchanged.
When enabled the result adds:
`astc: {count,pack,overlayArchives:{base,item_notes}}`.
Archive values are bare filenames derived from actual matching output pairs.
The combined `files` map contains ordinary outputs and eleven ASTC files;
`variants` remains `["base","item_notes"]`. Downstream assembly must validate
the exact ASTC inventory and permit only those paths, and separately export the
pack. This module does not wire production adapters, UI or export.

Narrow assembly checks:
`node --test web/tests/native-overlay-prebuilt.test.mjs`.
These injected synthetic dependencies check default-byte preservation, recipe
reuse, eleven paths, receipt/sidecars and mismatch rejection. They are not an
extraction/authentication proof, real codec/native oracle, browser test or device
compatibility claim. The CASC transform and host have separate native synthetic
oracle tests.
