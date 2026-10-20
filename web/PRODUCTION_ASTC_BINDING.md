# Optional production ASTC inventory binding

[简体中文](PRODUCTION_ASTC_BINDING.zh-CN.md)

This integration changes no UI toggle, default BC files, shell-profile selection or runtime payload choice. Bootstrap starts with the original production shell contract. It does not accept externally supplied pack bytes, index TSVs, authentication flags or arbitrary extra-path lists.

## Producer boundary

After successful asset generation, the trusted adapter may expose the synchronous `getAstcOutputBinding()` getter:

- Disabled, before generation, failed or disposed: `undefined`.
- Enabled: `{ pack: { name, size, sha256 }, overlayArchives: { base, item_notes } }`, where both archive values are canonical bare filenames derived from generated output.

The getter contains metadata only, not copied files, records or the external staged pack. Generator and adapter wiring must supply a real internal producer before this path is usable. This boundary does not create or authenticate that producer and does not enable an end-user ASTC option.

## Exact post-generation contract

`selectProductionAstcEntries` selects paths beginning with `romfs_overlay_astc` for strict validation. It rejects unbound ASTC entries, missing/incomplete enabled sets, external supplemental archive names, root `data/*.data`, `pack_index.tsv` at any depth and `Legacy Device Pack` paths before ordinary filtering can silently discard them.

`inspectProductionAstcEntries` verifies exactly eleven entries using the contract in [ASTC output validation](ASTC_OUTPUT_EXPORT.md). It checks unique paths, ordinary 0644 file modes, safe declared sizes, 64 MiB per-file / 128 MiB total limits and exact stream exhaustion. Every yielded buffer must be ordinary, non-resizable and at most 1 MiB. Late producer errors and aborts reject.

Validation drains opaque files without reconstructing them. It retains only up to 512 bytes of pack JSON, eleven bytes of the feature marker, and one byte for each other file. Actual declared and observed lengths are checked independently. These probes cover exactly the existing validator's content predicates; they are not substitutes for byte hashes or CASC semantic validation. Caller-owned chunks are never modified. Temporary probes are wiped after checking.

`bindProductionAstcEntries` returns a replacement profile with the validated eleven exact filenames appended to `extraFiles`. It revalidates the shell contract and preserves original required paths, shell inventory, executable target and lifecycle method. It does not mutate the original profile or admit directory wildcards. A second binding rejects.

The packager binds after asset generation and before shell loading/assembly. Ordinary BC filtering remains unchanged; only the bound exact ASTC paths are additionally retained. The final generated-output validation drains the ASTC entries again against the frozen pack/archive binding before assembly. External pack data and its index never become IPA entries.

## Limits and evidence

The getter, staged pack hash and archive allocation are trusted internal contracts, not user authentication. This layer cannot establish path-to-CFT associations, texture conversion completeness, source pack integrity or native-device compatibility. Separate pack export and source disposal remain caller responsibilities.

Focused synthetic tests cover default behavior, exact contract extension, immutable original profile, unexpected/partial/unbound paths, external-data rejection, exact stream sizes, producer errors, mode/buffer bounds, cancellation, pack JSON mismatch and bounded draining. Existing production-profile tests remain passing. No browser, game, device or end-to-end installation proof is claimed.

## Optional producer orchestration

`prepareBrowserPackager({legacyAstc: true})` preloads the closed `legacy-astc`
group during public bootstrap; default false stays unchanged. A preinitialized
one-shot producer consumes authenticated extraction capabilities before the asset
adapter is constructed. Only finalized `{pack,records}` metadata enters asset
generation, never external pack bytes or index TSV.

Implementation limits: 256 MiB per encoded/decoded record, 8 GiB staged pack,
4096 blocks per encoder batch. These are limits, not native parity evidence.
Oversized records fail rather than being skipped; original error causes retain
size/quota diagnostics.

The File-backed pack exports after resources and before opening the IPA sink,
into a fresh owned child of the already authorized input directory. `legacyPack`
outcomes remain separate from `resources` and IPA committed state. Progress uses
`stage: "legacy-pack"` with exporter state and byte/file counts. Export failure
prevents IPA completion. Previously completed folders can remain after a later
failure and are reported separately. The producer lease closes after job cleanup;
cleanup failures remain observable without replacing the primary cause. Synthetic
tests do not prove real-browser, real-game or native compatibility.
