# Browser asset generator adapter: bounded image subset

`asset-generator-adapter.mjs` is an **implemented adapter boundary**, not complete game asset generation and not a working IPA. It converts explicit, trusted v31 image recipes into the `OutputEntry[]` contract expected by `packaging-job.mjs`. It remains disconnected from the main UI and default packaging capabilities.

## Inputs and outputs

The caller provides:

- A trusted recipe list: operation `image-default-frame`, a `data/...` logical CASC asset path, a frame index and explicit output-name-to-app-relative-path mappings.
- A factory returning the existing asset spike's `AssetWorker` (`run` and `close`). Factory injection keeps node tests independent of browser globals and does not implicitly publish WASM files in the Vite build.
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

The existing worker also produces an experience-table **C header** and an overlay-directory **plan**. Neither is a deployable application asset by itself. This packaging adapter deliberately rejects those operations rather than placing them in the application and pretending that experience compilation or CASC overlay generation happened. A future program-build stage may consume the header through a distinct build-artifact contract. A future CASC writer must consume and validate the overlay plan.

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

`ASSET_ADAPTER_CAPABILITIES.completeAssetPipeline` is false. v61 inputs fail with `ASSET_V61_NOT_CONNECTED`, independently of the worker's own rejection. The separate texture adapter proposes `decodeV61(bytes) -> {pixels,width,height,pixelFormat,bytesPerPixel,frameWidth}`. It is not imported or enabled here; its independent CI proof and a cross-adapter pixel-parity test are required before integration. No v31 stand-in for required block-linear frontend sprites is allowed.

Missing: the real logical CASC reader connection, complete native image recipe inventory, source-manifest validation for actual game versions, original-font handling, BC encoding/swizzle where required, full HUD/skill/vault generation, generated C compilation, CASC overlay packing, destination inventory matching against the shell, main UI integration and real-game end-to-end proof.

## Evidence and tests

The underlying Pyodide image/table/path subset passed real Chromium CI on commit `143e375973d4f4d5fbc770e3464f9112c2403a4b`: [asset run 39392846657](https://github.com/n3crosis/d2r-mobile/actions/runs/39392846657).

`tests/asset-generator-adapter.test.mjs` covers the new adapter with **synthetic injected reader/worker doubles**: bounded logical reads, operation arguments, exact entry data, immutable ownership, chunk sizing, cleanup, cancellation, path rejection, unsupported stage rejection, error redaction and single-use lifecycle. These tests establish the adapter contract, not new Pyodide or real-game parity. They are picked up by the existing web CI test glob; execution is deferred to CI after this coherent implementation batch.
