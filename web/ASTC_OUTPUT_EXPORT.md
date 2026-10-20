# ASTC output validation and Legacy Device Pack export

[简体中文](ASTC_OUTPUT_EXPORT.zh-CN.md)

## Scope

These isolated primitives are not connected to browser packaging, production profiles, generators or UI. Default BC generation is unchanged. Layouts follow `dm/ios/tools/gen_romfs_overlay.py`, `dm/tools/astc_pack.py finalize` and `dm/ios/Sources/main.m`.

## Exact generated-output validation

`validateAstcOutputs({ files, pack, overlayArchives: { base, item_notes } })` accepts a generated path-to-`Uint8Array` map and returns a frozen inventory summary. `pack` is the trusted finalized supplemental-pack `{ name, size, sha256 }`; the two overlay archive names are trusted generator results. No caller-provided authenticity flag is accepted.

The complete exact set is eleven files:

- `romfs_overlay_astc/data/.build.config`
- `romfs_overlay_astc/data/<base archive>`
- `romfs_overlay_astc/ctrl_touch`
- `romfs_overlay_astc/touch_strings.tsv`
- `romfs_overlay_astc/pack.json`
- `romfs_overlay_astc_variants/item_notes/data/.build.config`
- `romfs_overlay_astc_variants/item_notes/data/<item_notes archive>`
- `romfs_overlay_astc_variants/item_notes/ctrl_touch`
- `romfs_overlay_astc_variants/item_notes/touch_strings.tsv`
- `romfs_overlay_astc_variants/item_notes/dm_textbox_plain.tsv`
- `romfs_overlay_astc_variants/item_notes/features.txt`

No directories, additional variants, BC paths, external supplemental archive, index TSV or arbitrary extra files are accepted in this set. The two overlay archive names cannot equal the supplemental archive name. Archive names are canonical decimal names for byte-sized CASC locations (0–255 each). Data files and `ctrl_touch` must be nonempty; feature text must start with `item_notes\n`. The pack JSON is bounded to 512 bytes and must contain exactly one unescaped `name`, `size` and `sha256`, equal to the trusted pack metadata. Unknown, duplicate and escaped keys reject.

Every file and backing buffer is capped at 64 MiB, total visible bytes at 128 MiB; shared/resizable buffers reject. Pack metadata permits nonnegative safe-integer sizes through 2^40 and lowercase SHA-256. Metadata validation does not prove bytes match that hash, CFT references point to that archive, source locations were unused, or textures work. The caller must integrate this ASTC-only validated set without adding external pack data/index to the IPA. Existing BC output is neither accepted in this set nor altered.

## Separate local export

`exportLegacyDevicePack({ finalizedPack: { source, pack }, outputDirectoryHandle, signal?, onProgress?, secureContext?, randomUUID? })` consumes a live trusted finalized source (`file`, numeric `size`, bounded `readAt`). The injectable environment values are for trusted hosts/tests, not permission bypasses. The caller must previously obtain the destination through an authorized user gesture; this module only checks existing read/write permission and never prompts or requests it.

The exporter creates `Legacy Device Pack-<UUID>` beneath that destination, containing:

- `data/<pack.name>`: exact staged bytes, copied in at most 64 KiB owned chunks.
- `manifest.json`: native `{ "files": [pack] }` shape.
- `.d2rm-legacy-pack-export.json`: incomplete/complete marker and counts, explicitly separate from IPA status.

The native iOS host searches renamed directories and one nested level for `data/<name>` and validates size/SHA-256 against bundled ASTC `pack.json`; therefore the UUID folder need not use the fixed `Legacy Device Pack` name. The exporter uses finalized metadata rather than recomputing a hash, and makes no authentication claim. The native host performs its own check when loading. Staged-source integrity and location allocation remain internal caller responsibilities.

There is no overwrite, upload, source-folder mutation, ZIP, RAM fallback or whole-pack buffering. The source remains caller-owned and is not disposed. Callers must retain it through export and dispose it afterward as appropriate. Input chunks must be owned ordinary non-resizable `Uint8Array` buffers no larger than 64 KiB; they are wiped after writes.

## Completion, cancellation and cleanup

The incomplete marker closes before payload writing. Archive and manifest close/size checks precede the final complete marker. Successful final-marker close is the commit boundary; cancellation after it does not reclassify completed output. Progress is advisory, throttled to 100 ms except stage transitions; observer failures cannot alter the result. Counters use safe integers and count archive bytes, excluding manifest/marker overhead.

Failures throw `LegacyPackExportError` with a frozen incomplete report: directory, byte/file counts, cancellation code, cleanup completion, incomplete-marker presence and cleanup codes. Cleanup aborts an active writer, then removes only individually tracked entries whose current handles match their original handles. It is nonrecursive and preserves unknown additions/replacements. Cleanup failures leave an incomplete marker when possible and are reported, not concealed. Never treat a partial directory as complete or delete it recursively based on its name.

As in the existing resource exporter, cancellation is checked around awaited filesystem operations, not an ability to forcibly cancel a hung browser call. OPFS/File System Access has no exclusive-create primitive; secure random UUID plus absence checks assumes no hostile concurrent writer. A crash may leave incomplete output; there is no scavenging.

## Evidence and limits

Focused tests use synthetic inventories, staged byte sources and fake filesystems. They exercise exact inventories, JSON binding, bounded copies, permission/collision failures, cancellation, commit timing, partial reports and preservation of unknown/replaced entries. This is not real-browser, device, game, hashing or end-to-end installation proof.
