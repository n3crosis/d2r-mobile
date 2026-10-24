# Optional ASTC asset metadata binding

中文: [ASTC_ASSET_BINDING.zh-CN.md](ASTC_ASSET_BINDING.zh-CN.md)

`createProductionAssetAdapter` and `createAssetPipelineAdapter` accept an optional trusted constructor argument `prebuiltPack: {pack,records}`. It uses the dedicated external-reference overlay metadata shape: `pack` is `{name,size,sha256}`; each record is `{path,oldEkey,newEkey,encodedSize,decodedSize}`. No package bytes, source handles, arbitrary payload fields, or caller-supplied authentication flags are accepted. The exported `snapshotPrebuiltPackMetadata` is only a bounded immutable metadata validator/snapshot, not evidence of content authenticity. The actual path/CFT association and archive-location/range checks remain in the generator and dedicated CASC writer.

The snapshot caps references at 32,768, each path at 4096 UTF-8 bytes and combined paths at 8 MiB; both sizes are unsigned 32-bit and key strings are bounded hexadecimal. Pack size must be positive. Pipeline use requires `nativeOverlayGenerated`; it cannot silently turn a different recipe mode into an ASTC mode. Omitting the option preserves default output and leaves the binding absent. This is trusted internal plumbing, not a UI trigger or a new default profile.

After a successful `generateAssets`, both adapters expose synchronous `getAstcOutputBinding()`. It returns only a frozen `{count,pack,overlayArchives:{base,item_notes}}` snapshot. It returns `undefined` by default, before or during generation, after failure, and after disposal. Pipeline publication waits until client closure and owned-buffer cleanup complete; production publication additionally waits for its own ordinary art/derived postprocessing and client closure. The getter never includes generated files or the full reference list.

The generator's optional `.astc` receipt and ASTC-prefixed file subset are checked against the supplied metadata and `validateAstcOutputs`: exactly eleven additional files are required, including matching `pack.json`, both overlay archives, and the item-notes feature sidecar. Unbound, missing, or extra ASTC files fail closed. The pipeline's existing aggregate output cap remains 80 MiB across default and optional outputs together. Eleven additional files do not grant a separate byte allowance; an otherwise valid optional output that exceeds the shared budget fails without a binding. Production's pre-existing ordinary art/HUD output handling is unchanged.

Validation uses an eleven-entry map referencing the generator's existing byte views, not another copy of generated payloads. Pipeline output retains its existing single ownership copy and wipe behavior. Production forwards those exact entry objects rather than creating another file map or copying their bytes. ASTC entry iterators yield owned copies with both view and backing-buffer sizes at most 64 KiB; they never yield a small subarray retaining an entire archive. This satisfies the bounded streaming inspector's 1 MiB backing-buffer limit. Disposal clears metadata and invalidates retained output producers.

Run:

```
node --test web/tests/asset-pipeline-adapter.test.mjs web/tests/production-assets-astc.test.mjs
```

Six existing pipeline regressions and six isolated adapter cases pass. The normal test wrapper runs module doubles in a child Node process with its required flag, so the ordinary test command and CI need no new flags. Coverage includes delayed binding publication, default absence, metadata forwarding, exact-eleven checks, unchanged 80 MiB limit, owned output chunks, failure/disposal invalidation, constructor metadata rejection, and production client-closure failure. These are synthetic adapter contracts, not actual browser/WASM, complete asset-generation, or game-installation proof.
