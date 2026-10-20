// 依据原生资源生成器及提取能力契约组合生产资源阶段。
// Compose production asset stages from native asset generators and extraction capability contracts.
/**
 * 原生资源顺序；所有读取器均来自已认证提取。
 * Native asset ordering; all readers come from authenticated extraction.
 */
import { readAuthenticatedAssets } from "./extraction-job-adapter.mjs";
import { generateNativeArt } from "./native-art-generator.mjs";
import { generateHud } from "./hud-generator.mjs";
import { generateProductionDerived } from "./production-derived.mjs";
import {
  createAssetPipelineAdapter,
  snapshotPrebuiltPackMetadata,
} from "./asset-pipeline-adapter.mjs";
import { FRONTEND_PANEL_SOURCE, transformFrontendPanel } from "./frontend-panel-transform.mjs";

// 工作线程传回 ArrayBuffer；只建立字节视图，不复制生成文件。
// Workers return ArrayBuffers; create byte views without copying generated files.
const fileViews = (files) =>
  Object.fromEntries(
    Object.entries(files).map(([path, value]) => {
      if (value instanceof Uint8Array) return [path, value];
      if (value instanceof ArrayBuffer) return [path, new Uint8Array(value)];
      throw new Error("PRODUCTION_ASSET_OUTPUT_TYPE");
    }),
  );

export function createProductionAssetAdapter({ runtime, profile, prebuiltPack }) {
  prebuiltPack = snapshotPrebuiltPackMetadata(prebuiltPack);
  let astcBinding;
  const owned = [],
    releaseEntries = [];
  let pipeline,
    disposed = false;
  const entry = (path, bytes) => {
    owned.push(bytes);
    releaseEntries.push(() => {
      bytes = undefined;
    });
    return {
      path,
      size: bytes.length,
      mode: 0o644,
      async *chunks() {
        if (disposed || !bytes) throw new Error("PRODUCTION_ASSET_DISPOSED");
        yield bytes;
      },
    };
  };
  return {
    async generateAssets({ extracted, selection, signal }) {
      if (disposed) throw new Error("PRODUCTION_ASSET_DISPOSED");
      astcBinding = undefined;
      const { logicalAssets } = readAuthenticatedAssets(extracted, selection, { signal });
      const worker = runtime.createAssetWorker(),
        texture = runtime.createTextureClient(),
        encoder = runtime.createTextureEncoder();
      let completed = false,
        pendingAstcBinding;
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
        const artFiles = fileViews(art.files);
        const hud = await generateHud({
          logicalAssets,
          assetWorker: worker,
          decodeAtlas,
          nativeArtFiles: artFiles,
          metadata: profile.hud,
          metadataSha256: profile.hudSha256,
          mode: "switch-upscaled",
          signal,
        });
        const hudFiles = fileViews(hud.files);
        const derived = await generateProductionDerived({
          logicalAssets,
          assetWorker: worker,
          nativeArtFiles: artFiles,
          signal,
        });
        for (const [tag, expected] of Object.entries(profile.derivedCounts)) {
          if (derived.counts?.[tag] !== expected)
            throw new Error("SHELL_DERIVED_CAPACITY_MISMATCH");
        }
        let source = await logicalAssets.read(FRONTEND_PANEL_SOURCE.input, {
          maxBytes: 8 * 1024 * 1024,
          signal,
        });
        let decoded, transformed, encoded, panelSprite;
        try {
          decoded = await decodeAtlas(source);
          transformed = transformFrontendPanel({ ...decoded, signal });
          encoded = await encoder.encodeAndPack(
            { templateHeader: source.slice(0, 40), ...transformed },
            { signal },
          );
          panelSprite = encoded.sprite;
        } finally {
          source.fill(0);
          decoded?.pixels.fill(0);
          transformed?.rgba.fill(0);
          encoded?.linearBC3?.fill(0);
          // 擦除后解除临时缓冲区引用，避免后续流水线等待期间保留它们。
          // Drop wiped temporary buffers before awaiting the subsequent pipeline.
          source = decoded = transformed = encoded = undefined;
        }
        const generated = {
          "NativeHUD/v4/base.png": hudFiles["base.png"],
          "NativeHUD/v4/hud.json": hudFiles["hud.json"],
          "NativeHUD/v4/hud_v4_ui/ui.json": hudFiles["hud_v4_ui/ui.json"],
          "NativeHUD/touch/fe_rightpanel.sprite": panelSprite,
        };
        pipeline = createAssetPipelineAdapter({
          mapGoal: true,
          mercenaryArt: true,
          remainingArt: true,
          nativeOverlayGenerated: generated,
          prebuiltPack,
          createAssetWorker: runtime.createAssetWorker,
          createTextureClient: runtime.createTextureClient,
          createTextureEncoder: runtime.createTextureEncoder,
        });
        const entries = await pipeline.generateAssets({ extracted, selection, signal });
        for (const [path, bytes] of Object.entries(artFiles)) {
          if (path !== "dm_touch_native_art.c") entries.push(entry(path, bytes));
        }
        for (const [path, bytes] of Object.entries(hudFiles))
          if (path.startsWith("hud_v4_ui/")) entries.push(entry(path, bytes));
        for (const [path, bytes] of Object.entries(derived.files ?? derived))
          entries.push(entry(path, bytes));
        entries.push(
          entry("native_art_manifest.json", new TextEncoder().encode(profile.nativeArt.manifest)),
        );
        artFiles["dm_touch_native_art.c"].fill(0);
        for (const [path, bytes] of Object.entries(generated))
          if (path !== "NativeHUD/v4/hud_v4_ui/ui.json") bytes.fill(0);
        signal?.throwIfAborted();
        if (disposed) throw new Error("PRODUCTION_ASSET_DISPOSED");
        pendingAstcBinding = pipeline.getAstcOutputBinding();
        completed = true;
        return entries;
      } finally {
        worker.close();
        texture.close();
        encoder.close();
        if (completed && !disposed && !signal?.aborted) astcBinding = pendingAstcBinding;
      }
    },
    getAstcOutputBinding() {
      return disposed ? undefined : astcBinding;
    },
    dispose() {
      disposed = true;
      astcBinding = undefined;
      prebuiltPack = undefined;
      try {
        pipeline?.dispose();
      } finally {
        try {
          for (const bytes of owned) bytes.fill(0);
        } finally {
          owned.length = 0;
          // 清理时解除输出闭包引用，不改变暂存前可重复读取的行为。
          // Release output closure references at cleanup, preserving repeatable reads before staging.
          for (const release of releaseEntries.splice(0)) release();
        }
      }
    },
  };
}
