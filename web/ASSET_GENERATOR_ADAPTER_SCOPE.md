# Browser asset generator adapter: bounded image subset

`asset-generator-adapter.mjs` is an **implemented adapter boundary**, not complete game asset generation and not a working IPA. It converts explicit, trusted v31 image recipes into the `OutputEntry[]` contract expected by `packaging-job.mjs`. It remains disconnected from the main UI and default packaging capabilities.

## Inputs and outputs

The caller provides:

- A trusted recipe list: operation `image-default-frame`, a `data/...` logical CASC asset path, a frame index and explicit output-name-to-app-relative-path mappings.
- A factory returning the existing asset spike's `AssetWorker` (`run` and `close`). Factory injection keeps node tests independent of browser globals and does not implicitly publish WASM files in the frontend build.
- An extracted-data handle with `logicalAssets.read(path, {maxBytes, signal})`, or an explicit `resolveReader(extracted)` implementation. This must return **decoded logical CASC file bytes**. Raw NSP/NCA/RomFS range reads do not satisfy this contract.

Example composition after a deployment has prepared and self-hosted the proven asset runtime:

```js
import { AssetWorker } from "./toolchain/asset-generation-spike/public/client.mjs";
import { createAssetGeneratorAdapter } from "./asset-generator-adapter.mjs";

const assetAdapter = createAssetGeneratorAdapter({
  createWorker: () => new AssetWorker(),
  recipes: trustedImageRecipes,
});
// Compose only when the whole required recipe inventory is separately implemented.
const generateAssets = assetAdapter.generateAssets;
// Application cleanup must call assetAdapter.dispose() after streams are consumed.
```

Only `frame.png` and `frame.sprite` may be mapped into application outputs. Returned entries carry app-relative paths, exact sizes, regular-file mode `0100644` and repeatable asynchronous 64 KiB chunks. These entries still require normal shell-contract and assembly validation. The adapter does not write ZIPs, invent missing required assets, access keys, obtain fonts, accept game-provided executable recipes, or sign anything.

The transformed sprite is the worker's **default-state color mask applied to a selected frame**, not a generic decoder or arbitrary full-generator recipe. Do not apply it to unrelated sprites. Recipe provenance and correct visual intent remain the caller's responsibility.

## Important build-artifact distinction

The existing worker also produces an experience-table **C header** and an overlay-directory **plan**. Neither is a deployable application asset by itself. This packaging adapter deliberately rejects those operations rather than placing them in the application and pretending that experience compilation or CASC overlay generation happened. For released-shell packaging, native `d2rm_pack.py` passes the generated experience/vault/skill-index C sources through `shell_stubs.data()` to produce `dm/derived.tsv`; the shell reads that TSV at runtime using `dm_derived_rt.h`. The production derived-table and CASC implementations live in `production-derived.mjs` and `production-assets.mjs`; this small image adapter does not replace them.

## Bounds and lifecycle

- At most 32 recipes, validated in full before any user-data read.
- At most 20 MiB per logical read and 128 MiB total bytes read per invocation.
- At most 64 MiB of worker-returned file buffers per response and 64 MiB retained selected output bytes across the invocation.
- The existing worker additionally caps each decoded image at 4,194,304 pixels.
- Input/output paths are bounded to 512 ASCII characters, reject absolute/traversal/empty segments and duplicate case-insensitive destinations. Final assembly enforces its own stricter allowed inventory.
- Recipes run sequentially inside the generator, preventing concurrent Pyodide image-memory peaks. The outer packaging scheduler may still run different generators concurrently.
- Stream chunks are copies; consumers cannot mutate retained output or worker buffers. This is bounded in-memory output, **not** a disk-backed/OPFS streaming image pipeline.
- An AbortSignal races pending reads/worker work and terminates the worker promptly. Readers must also honor the supplied signal to cancel their own I/O. Caller abort reasons and raw worker exceptions are not exposed in adapter errors.
- Worker closure occurs after generation success/failure/cancellation. The adapter is single-use. `dispose()` clears retained bytes and invalidates streams; compose it into packaging cleanup only after all output entries have been consumed.

## v61 and remaining gaps

`ASSET_ADAPTER_CAPABILITIES.completeAssetPipeline` is false. v61 remains rejected by default with `ASSET_V61_NOT_CONNECTED`. An explicit **PNG-only** composition is available in `v61-asset-worker.mjs`:

```js
const adapter = createAssetGeneratorAdapter({
  enableV61Png: true,
  createWorker: () => createV61AssetWorker({ assetWorker: new AssetWorker() }),
  recipes: trustedPngOnlyRecipes,
});
```

The composed worker invokes the actual texture WASM worker, checks source dimensions before decode, validates decoded format/length, then passes an internal raw-RGBA sprite to the unchanged Pyodide transform. This intermediate is not an application output. Only the resulting PNG is exposed; requesting `frame.sprite` from a v61 source fails `ASSET_V61_SPRITE_UNSUPPORTED`. Both workers are terminated on close and intermediate pixel buffers are erased. This does **not** implement native v61 BC3 encoding/swizzle or make PNG interchangeable with a game sprite.

Run `node --test web/tests/asset-generator-adapter.test.mjs web/tests/v61-asset-worker.test.mjs` for bounded reader, worker, ownership, cleanup and PNG-only adapter checks.
