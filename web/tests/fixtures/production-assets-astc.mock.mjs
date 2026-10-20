// 生产组合层使用隔离测试依赖验证发布时机；不增加生产注入或认证绕过接口。
// Test publication timing in production composition with isolated dependencies, without production injection or authentication bypass APIs.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
const pack = { name: "00-00000008.data", size: 20, sha256: "a".repeat(64) };
const prebuilt = {
  pack,
  records: [
    {
      path: "data/a",
      oldEkey: "1".repeat(32),
      newEkey: "2".repeat(32),
      encodedSize: 20,
      decodedSize: 30,
    },
  ],
};
const binding = Object.freeze({
  count: 1,
  pack: Object.freeze({ ...pack }),
  overlayArchives: Object.freeze({ base: "00-00000002.data", item_notes: "00-00000002.data" }),
});
const pipelineEntry = Object.freeze({
  path: "romfs_overlay_astc/mock",
  size: 1,
  async *chunks() {
    yield new Uint8Array([1]);
  },
});
let forwarded, failure, pipelineDisposed;
mock.module("../../extraction-job-adapter.mjs", {
  namedExports: {
    readAuthenticatedAssets: () => ({ logicalAssets: { read: async () => new Uint8Array(40) } }),
  },
});
mock.module("../../native-art-generator.mjs", {
  namedExports: {
    generateNativeArt: async () => ({ files: { "dm_touch_native_art.c": new Uint8Array([1]) } }),
  },
});
mock.module("../../hud-generator.mjs", {
  namedExports: {
    generateHud: async () => ({
      files: {
        "base.png": new Uint8Array([1]),
        "hud.json": new Uint8Array([1]),
        "hud_v4_ui/ui.json": new Uint8Array([1]),
      },
    }),
  },
});
mock.module("../../production-derived.mjs", {
  namedExports: { generateProductionDerived: async () => ({ files: {}, counts: {} }) },
});
mock.module("../../frontend-panel-transform.mjs", {
  namedExports: {
    FRONTEND_PANEL_SOURCE: { input: "data/a" },
    transformFrontendPanel: () => ({ rgba: new Uint8Array(4), width: 1, height: 1 }),
  },
});
mock.module("../../asset-pipeline-adapter.mjs", {
  namedExports: {
    snapshotPrebuiltPackMetadata: (value) => value,
    createAssetPipelineAdapter: ({ prebuiltPack }) => {
      forwarded = prebuiltPack;
      pipelineDisposed = false;
      return {
        async generateAssets() {
          if (failure === "pipeline") throw new Error("pipeline failure");
          return [pipelineEntry];
        },
        getAstcOutputBinding: () => (prebuiltPack ? binding : undefined),
        dispose() {
          pipelineDisposed = true;
        },
      };
    },
  },
});
const { createProductionAssetAdapter } = await import("../../production-assets.mjs");
function adapter(enabled = true) {
  const close = () => {
    if (failure === "close") throw new Error("close failed");
  };
  const runtime = {
    createAssetWorker: () => ({ close }),
    createTextureClient: () => ({
      close,
      decodeAtlas: async () => ({ pixels: new Uint8Array(4) }),
    }),
    createTextureEncoder: () => ({
      close,
      encodeAndPack: async () => ({ sprite: new Uint8Array([1]), linearBC3: new Uint8Array(1) }),
    }),
  };
  return createProductionAssetAdapter({
    runtime,
    profile: { nativeArt: { manifest: "{}" }, derivedCounts: {} },
    ...(enabled ? { prebuiltPack: prebuilt } : {}),
  });
}
test("production adapter forwards only metadata and publishes binding after success", async () => {
  failure = undefined;
  const assets = adapter();
  assert.equal(assets.getAstcOutputBinding(), undefined);
  const entries = await assets.generateAssets({});
  assert.equal(entries[0], pipelineEntry);
  assert.equal(forwarded, prebuilt);
  assert.equal(assets.getAstcOutputBinding(), binding);
  assets.dispose();
  assert.equal(assets.getAstcOutputBinding(), undefined);
  assert.equal(pipelineDisposed, true);
});
test("production default, pipeline failure and final closure failure never publish ASTC binding", async () => {
  failure = undefined;
  const standard = adapter(false);
  await standard.generateAssets({});
  assert.equal(standard.getAstcOutputBinding(), undefined);
  standard.dispose();
  for (const mode of ["pipeline", "close"]) {
    failure = mode;
    const assets = adapter();
    await assert.rejects(assets.generateAssets({}));
    assert.equal(assets.getAstcOutputBinding(), undefined);
    failure = undefined;
    assets.dispose();
  }
});
