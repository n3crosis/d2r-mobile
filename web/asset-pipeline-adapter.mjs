import { readAuthenticatedAssets } from "./extraction-job-adapter.mjs";
import { generateMapGoal } from "./map-goal-generator.mjs";
import { writeCascOverlay } from "./casc-overlay-writer.mjs";
import { validateEncodeRequest } from "./toolchain/texture-spike/browser-texture-encoder.mjs";

export const ASSET_PIPELINE_LIMITS = Object.freeze({
  textures: 32,
  sourceBytes: 8 * 1024 * 1024,
  replacementBytes: 48 * 1024 * 1024,
  outputBytes: 80 * 1024 * 1024,
  chunkBytes: 64 * 1024,
});
class AssetPipelineError extends Error {}
const fail = (code) => {
  throw new AssetPipelineError(code);
};
const path = (value) => {
  if (
    typeof value !== "string" ||
    value.length > 512 ||
    !/^data\/[a-z0-9_./ -]+$/.test(value) ||
    value.split("/").some((p) => !p || p === "." || p === "..")
  )
    fail("ASSET_PIPELINE_RECIPE");
  return value;
};
const view = (value) =>
  value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;

/** Trusted host wiring only. This composes real primitives, not a complete game
 * profile. Texture transforms are explicitly supplied source-derived functions;
 * no layout or replacement image is invented. Factories must return preloaded,
 * sealed clients before job inputs are accepted by the application.
 *
 * Native destinations: d2rm_pack.py stages mapgoal/ and romfs_overlay/. This
 * adapter emits only overlay delta files, never clones the bulk RomFS.
 */
export function createAssetPipelineAdapter({
  mapGoal = false,
  textureReplacements = [],
  createAssetWorker,
  createTextureClient,
  createTextureEncoder,
} = {}) {
  if (
    typeof mapGoal !== "boolean" ||
    !Array.isArray(textureReplacements) ||
    textureReplacements.length > ASSET_PIPELINE_LIMITS.textures ||
    (!mapGoal && !textureReplacements.length) ||
    typeof createAssetWorker !== "function" ||
    typeof createTextureClient !== "function" ||
    (textureReplacements.length && typeof createTextureEncoder !== "function")
  )
    fail("ASSET_PIPELINE_OPTIONS");
  const destinations = new Set();
  const recipes = textureReplacements.map((recipe) => {
    const input = path(recipe?.input),
      replacement = path(recipe?.replacement);
    if (
      !/^[a-f0-9]{64}$/.test(recipe.sha256) ||
      typeof recipe.transform !== "function" ||
      typeof recipe.add !== "boolean" ||
      destinations.has(replacement)
    )
      fail("ASSET_PIPELINE_RECIPE");
    destinations.add(replacement);
    return Object.freeze({
      input,
      replacement,
      sha256: recipe.sha256,
      transform: recipe.transform,
      add: recipe.add,
    });
  });
  let used = false,
    disposed = false,
    cleanupFailed = false;
  const clients = [],
    outputs = [];
  let internalAbort;
  const closeClients = () => {
    for (const client of clients.splice(0)) {
      try {
        client.close();
      } catch {
        cleanupFailed = true;
      }
    }
  };
  const wipe = () => {
    for (const bytes of outputs.splice(0)) bytes.fill(0);
  };
  const dispose = () => {
    disposed = true;
    internalAbort?.abort();
    closeClients();
    wipe();
    if (cleanupFailed) fail("ASSET_PIPELINE_CLEANUP");
  };
  async function generateAssets({ extracted, selection, signal } = {}) {
    if (used || disposed) fail("ASSET_PIPELINE_SINGLE_USE");
    if (signal?.aborted) fail("ASSET_PIPELINE_CANCELLED");
    used = true;
    internalAbort = new AbortController();
    const combined = signal
      ? AbortSignal.any([signal, internalAbort.signal])
      : internalAbort.signal;
    const check = () => {
      if (combined.aborted || disposed) fail("ASSET_PIPELINE_CANCELLED");
    };
    const abort = () => closeClients();
    combined.addEventListener("abort", abort, { once: true });
    const owned = new Set();
    const entries = [];
    let outputBytes = 0;
    const own = (value) => {
      const bytes = view(value);
      if (!bytes) fail("ASSET_PIPELINE_BYTES");
      owned.add(bytes);
      return bytes;
    };
    const release = (bytes) => {
      bytes.fill(0);
      owned.delete(bytes);
    };
    const wipeLate = (result) => {
      const direct = view(result);
      if (direct) direct.fill(0);
      for (const value of Object.values(result?.files ?? {})) view(value)?.fill(0);
      for (const key of ["pixels", "rgba", "sprite", "linearBC3"]) view(result?.[key])?.fill(0);
    };
    const run = async (action) => {
      check();
      let cancel;
      const interrupted = new Promise((_, reject) => {
        cancel = () => reject(new Error("ASSET_PIPELINE_CANCELLED"));
        combined.addEventListener("abort", cancel, { once: true });
      });
      try {
        return await Promise.race([
          Promise.resolve()
            .then(() => {
              check();
              return action();
            })
            .then((result) => {
              if (combined.aborted || disposed) {
                wipeLate(result);
                check();
              }
              return result;
            }),
          interrupted,
        ]);
      } finally {
        combined.removeEventListener("abort", cancel);
      }
    };
    const client = (factory, method) => {
      const result = factory();
      if (result && typeof result.close === "function") clients.push(result);
      if (!result || typeof result.close !== "function" || typeof result[method] !== "function")
        fail("ASSET_PIPELINE_CLIENT");
      return result;
    };
    const append = (name, value) => {
      const bytes = view(value);
      if (!bytes?.length || (outputBytes += bytes.length) > ASSET_PIPELINE_LIMITS.outputBytes)
        fail("ASSET_PIPELINE_OUTPUT_LIMIT");
      const stored = bytes.slice();
      outputs.push(stored);
      entries.push(
        Object.freeze({
          path: name,
          size: stored.length,
          mode: 0o100644,
          async *chunks() {
            for (
              let offset = 0;
              offset < stored.length;
              offset += ASSET_PIPELINE_LIMITS.chunkBytes
            ) {
              check();
              yield stored.slice(offset, offset + ASSET_PIPELINE_LIMITS.chunkBytes);
            }
          },
        }),
      );
    };
    try {
      // Provenance is checked before constructing any runtime or reading input.
      const assets = readAuthenticatedAssets(extracted, selection, { signal: combined });
      if (!assets?.logicalAssets || !assets?.romfs) fail("ASSET_PIPELINE_PROVENANCE");
      const worker = client(createAssetWorker, "run");
      const decoder = client(createTextureClient, "decodeAtlas");
      const decodeAtlas = async (bytes, options) => {
        const result = await decoder.decodeAtlas(bytes, options);
        return { ...result, frames: result.frameCount };
      };
      if (mapGoal) {
        const generated = await run(() =>
          generateMapGoal({
            logicalAssets: assets.logicalAssets,
            assetWorker: worker,
            decodeAtlas,
            signal: combined,
          }),
        );
        check();
        for (const [name, bytes] of Object.entries(generated.files)) {
          const generatedBytes = own(bytes);
          append(`mapgoal/${name}`, generatedBytes);
          release(generatedBytes);
        }
      }
      if (recipes.length) {
        const encoder = client(createTextureEncoder, "encodeAndPack");
        const replacements = [];
        let replacementBytes = 0;
        for (const recipe of recipes) {
          const source = own(
            await run(() =>
              assets.logicalAssets.read(recipe.input, {
                maxBytes: ASSET_PIPELINE_LIMITS.sourceBytes,
                signal: combined,
              }),
            ),
          );
          if (!source.length || source.length > ASSET_PIPELINE_LIMITS.sourceBytes)
            fail("ASSET_PIPELINE_INPUT_LIMIT");
          const digest = new Uint8Array(await run(() => crypto.subtle.digest("SHA-256", source)));
          if (Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("") !== recipe.sha256)
            fail("ASSET_PIPELINE_SOURCE_HASH");
          const templateHeader = own(source.slice(0, 40));
          const decoded = await run(() => decoder.decodeAtlas(source, { signal: combined }));
          const pixels = own(decoded.pixels);
          if (
            decoded.frameCount !== 1 ||
            decoded.pixelFormat !== 70 ||
            decoded.bytesPerPixel !== 4 ||
            !Number.isSafeInteger(decoded.width) ||
            !Number.isSafeInteger(decoded.height) ||
            decoded.width < 1 ||
            decoded.height < 1 ||
            decoded.width * decoded.height > 4194304 ||
            pixels.length !== decoded.width * decoded.height * 4
          )
            fail("ASSET_PIPELINE_TEXTURE_LAYOUT");
          const transformed = await run(() =>
            recipe.transform({
              pixels,
              width: decoded.width,
              height: decoded.height,
              signal: combined,
            }),
          );
          const rgba = own(transformed?.rgba);
          validateEncodeRequest(templateHeader, transformed.width, transformed.height);
          if (rgba.length !== transformed.width * transformed.height * 4)
            fail("ASSET_PIPELINE_RGBA");
          const encoded = await run(() =>
            encoder.encodeAndPack(
              { templateHeader, rgba, width: transformed.width, height: transformed.height },
              { signal: combined },
            ),
          );
          const sprite = own(encoded?.sprite);
          if (encoded.linearBC3) release(own(encoded.linearBC3));
          if (
            encoded.width !== transformed.width ||
            encoded.height !== transformed.height ||
            sprite.length < 40 ||
            sprite.length > 16 * 1024 * 1024 ||
            (replacementBytes += sprite.length) > ASSET_PIPELINE_LIMITS.replacementBytes
          )
            fail("ASSET_PIPELINE_ENCODE_RESULT");
          replacements.push({ path: recipe.replacement, add: recipe.add, bytes: sprite });
          release(source);
          release(pixels);
          release(rgba);
          release(templateHeader);
        }
        const overlay = await run(() =>
          writeCascOverlay({ romfs: assets.romfs, replacements, worker, signal: combined }),
        );
        check();
        for (const [name, bytes] of Object.entries(overlay.files))
          append(`romfs_overlay/${name}`, own(bytes));
      }
      check();
      closeClients();
      if (cleanupFailed) fail("ASSET_PIPELINE_CLEANUP");
      return entries.sort((a, b) => a.path.localeCompare(b.path, "en"));
    } catch (error) {
      wipe();
      closeClients();
      const safe = new Error(
        combined.aborted || disposed
          ? "ASSET_PIPELINE_CANCELLED"
          : error instanceof AssetPipelineError
            ? error.message
            : "ASSET_PIPELINE_FAILED",
      );
      if (cleanupFailed) safe.cleanupCode = "ASSET_PIPELINE_CLEANUP";
      throw safe;
    } finally {
      for (const bytes of owned) bytes.fill(0);
      combined.removeEventListener("abort", abort);
    }
  }
  return Object.freeze({
    generateAssets,
    dispose,
    capabilities: Object.freeze({
      completeAssetPipeline: false,
      productionConversion: false,
      authenticatedAssetInputs: true,
      mapGoal,
      bc3OverlayRecipes: recipes.length,
    }),
  });
}
