/** Native asset ordering; all readers come from authenticated extraction. */
import { readAuthenticatedAssets } from "./extraction-job-adapter.mjs";
import { generateNativeArt } from "./native-art-generator.mjs";
import { generateHud } from "./hud-generator.mjs";
import { generateProductionDerived } from "./production-derived.mjs";
import { createAssetPipelineAdapter } from "./asset-pipeline-adapter.mjs";
import { FRONTEND_PANEL_SOURCE, transformFrontendPanel } from "./frontend-panel-transform.mjs";

export function createProductionAssetAdapter({ runtime, profile }) {
  const owned = [];
  let pipeline;
  const entry = (path, bytes) => {
    owned.push(bytes);
    return {
      path,
      size: bytes.length,
      mode: 0o644,
      async *chunks() {
        yield bytes;
      },
    };
  };
  return {
    async generateAssets({ extracted, selection, signal }) {
      const { logicalAssets } = readAuthenticatedAssets(extracted, selection, { signal });
      const worker = runtime.createAssetWorker(),
        texture = runtime.createTextureClient(),
        encoder = runtime.createTextureEncoder();
      try {
        const decodeAtlas = (bytes) => texture.decodeAtlas(bytes, { signal });
        const art = await generateNativeArt({
          logicalAssets,
          assetWorker: worker,
          decodeAtlas,
          metadata: profile.nativeArt,
          metadataSha256: profile.nativeArtSha256,
          signal,
        });
        const hud = await generateHud({
          logicalAssets,
          assetWorker: worker,
          decodeAtlas,
          nativeArtFiles: art.files,
          metadata: profile.hud,
          metadataSha256: profile.hudSha256,
          signal,
        });
        const derived = await generateProductionDerived({
          logicalAssets,
          assetWorker: worker,
          nativeArtFiles: art.files,
          signal,
        });
        for (const [tag, expected] of Object.entries(profile.derivedCounts)) {
          if (derived.counts?.[tag] !== expected)
            throw new Error("SHELL_DERIVED_CAPACITY_MISMATCH");
        }
        const source = await logicalAssets.read(FRONTEND_PANEL_SOURCE.input, {
          maxBytes: 8 * 1024 * 1024,
          signal,
        });
        let decoded, transformed, encoded;
        try {
          decoded = await decodeAtlas(source);
          transformed = transformFrontendPanel({ ...decoded, signal });
          encoded = await encoder.encodeAndPack(
            { templateHeader: source.slice(0, 40), ...transformed },
            { signal },
          );
        } finally {
          source.fill(0);
          decoded?.pixels.fill(0);
          transformed?.rgba.fill(0);
          encoded?.linearBC3?.fill(0);
        }
        const generated = {
          "NativeHUD/v4/base.png": hud.files["base.png"],
          "NativeHUD/v4/hud.json": hud.files["hud.json"],
          "NativeHUD/v4/hud_v4_ui/ui.json": hud.files["hud_v4_ui/ui.json"],
          "NativeHUD/touch/fe_rightpanel.sprite": encoded.sprite,
        };
        pipeline = createAssetPipelineAdapter({
          mapGoal: true,
          mercenaryArt: true,
          remainingArt: true,
          nativeOverlayGenerated: generated,
          createAssetWorker: runtime.createAssetWorker,
          createTextureClient: runtime.createTextureClient,
          createTextureEncoder: runtime.createTextureEncoder,
        });
        const entries = await pipeline.generateAssets({ extracted, selection, signal });
        for (const [path, bytes] of Object.entries(art.files)) {
          if (path !== "dm_touch_native_art.c") entries.push(entry(path, bytes));
        }
        for (const [path, bytes] of Object.entries(hud.files))
          if (path.startsWith("hud_v4_ui/")) entries.push(entry(path, bytes));
        for (const [path, bytes] of Object.entries(derived.files ?? derived))
          entries.push(entry(path, bytes));
        entries.push(
          entry("native_art_manifest.json", new TextEncoder().encode(profile.nativeArt.manifest)),
        );
        art.files["dm_touch_native_art.c"].fill(0);
        for (const [path, bytes] of Object.entries(generated))
          if (path !== "NativeHUD/v4/hud_v4_ui/ui.json") bytes.fill(0);
        return entries;
      } finally {
        worker.close();
        texture.close();
        encoder.close();
      }
    },
    dispose() {
      pipeline?.dispose();
      for (const bytes of owned) bytes.fill(0);
      owned.length = 0;
    },
  };
}
