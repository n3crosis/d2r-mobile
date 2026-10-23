// 生产组合层使用隔离测试依赖验证发布时机；不增加生产注入或认证绕过接口。
// Test publication timing in production composition with isolated dependencies, without production injection or authentication bypass APIs.
import assert from "node:assert/strict";
import { SHELL_PROFILE_IDS, resolveShellProfile } from "../../shell-profiles.mjs";
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
let forwarded, failure, pipelineDisposed, hudRevision, pipelineRevisions, lifetimeCase;
const output = (name, value, mayUseBuffer = false) => {
  const bytes = new Uint8Array([value]);
  lifetimeCase?.outputs.set(name, bytes);
  return mayUseBuffer && lifetimeCase?.arrayBuffers ? bytes.buffer : bytes;
};
const fileBatch = (stage, files) =>
  lifetimeCase?.invalidBatch === stage ? { invalid: "wrong type", ...files } : files;
mock.module("../../extraction-job-adapter.mjs", {
  namedExports: {
    readAuthenticatedAssets: () => ({ logicalAssets: { read: async () => new Uint8Array(40) } }),
  },
});
mock.module("../../native-art-generator.mjs", {
  namedExports: {
    generateNativeArt: async () => ({
      files: fileBatch("native", {
        "dm_touch_native_art.c": output("art-c", 11, true),
        "native/icon.png": output("art-icon", 12, true),
      }),
    }),
  },
});
mock.module("../../hud-generator.mjs", {
  namedExports: {
    generateHud: async ({ recipeRevision }) => {
      hudRevision = recipeRevision;
      await lifetimeCase?.onStage?.("hud");
      const result = {
        files: fileBatch("hud", {
          "base.png": output("hud-base", 21, true),
          "hud.json": output("hud-json", 22, true),
          "hud_v4_ui/ui.json": output("hud-ui", 23, true),
        }),
      };
      await lifetimeCase?.onHudResult?.();
      return result;
    },
  },
});
mock.module("../../production-derived.mjs", {
  namedExports: {
    generateProductionDerived: async () => {
      await lifetimeCase?.onStage?.("derived");
      return {
        files: fileBatch("derived", { "dm/derived.tsv": output("derived", 31) }),
        counts: {},
      };
    },
  },
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
    createAssetPipelineAdapter: ({ prebuiltPack, artRecipeRevision, overlayRecipeRevision }) => {
      pipelineRevisions = {
        artRevision: artRecipeRevision,
        overlayRevision: overlayRecipeRevision,
      };
      forwarded = prebuiltPack;
      pipelineDisposed = false;
      return {
        async generateAssets() {
          await lifetimeCase?.onStage?.("pipeline");
          if (failure instanceof Error) throw failure;
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
function adapter(enabled = true, options = {}) {
  const factory = (name, client) => {
    options.created?.push(name);
    if (options.failFactory === name) throw new Error(`factory ${name} failed`);
    return {
      ...client,
      close() {
        options.closed?.push(name);
        options.onClose?.(name);
        if (failure === "close" || options.failClose === name) throw new Error("close failed");
      },
    };
  };
  const runtime = {
    createAssetWorker: () => factory("worker", {}),
    createTextureClient: () =>
      factory("texture", {
        decodeAtlas: async () => ({ pixels: new Uint8Array(4) }),
      }),
    createTextureEncoder: () =>
      factory("encoder", {
        encodeAndPack: async () => ({
          sprite: output("panel-sprite", 41),
          linearBC3: new Uint8Array(1),
        }),
      }),
  };
  return createProductionAssetAdapter({
    runtime,
    profile: {
      profileId: options.profileId ?? "v1.0.18-ios26",
      nativeArt: { manifest: "{}" },
      derivedCounts: options.derivedCounts ?? {},
    },
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

test("production cleanup closes all created clients despite factory, generation or close failures", async () => {
  failure = undefined;
  for (const failFactory of ["worker", "texture", "encoder"]) {
    const created = [],
      closed = [];
    const assets = adapter(true, { created, closed, failFactory, failClose: "worker" });
    await assert.rejects(assets.generateAssets({}), { message: `factory ${failFactory} failed` });
    assert.deepEqual(closed, created.slice(0, -1));
    assert.equal(assets.getAstcOutputBinding(), undefined);
    assets.dispose();
  }
  for (const failClose of ["worker", "texture", "encoder"]) {
    const closed = [];
    const assets = adapter(true, { closed, failClose });
    await assert.rejects(assets.generateAssets({}), { message: "PRODUCTION_ASSET_CLEANUP" });
    assert.deepEqual(closed, ["worker", "texture", "encoder"]);
    assert.equal(assets.getAstcOutputBinding(), undefined);
    assets.dispose();
  }
  failure = "pipeline";
  const closed = [];
  const assets = adapter(true, { closed, failClose: "worker" });
  await assert.rejects(assets.generateAssets({}), {
    message: "pipeline failure",
    cleanupCode: "PRODUCTION_ASSET_CLEANUP",
  });
  assert.deepEqual(closed, ["worker", "texture", "encoder"]);
  assert.equal(assets.getAstcOutputBinding(), undefined);
  failure = undefined;
  assets.dispose();
});

test("cleanup annotation never replaces an error with a readonly cleanupCode", async () => {
  const primary = new Error("primary failure");
  Object.defineProperty(primary, "cleanupCode", { value: "existing cleanup code" });
  assert.equal(Object.isExtensible(primary), true);
  failure = primary;
  const closed = [];
  const assets = adapter(true, { closed, failClose: "worker" });
  await assert.rejects(assets.generateAssets({}), (error) => error === primary);
  assert.equal(primary.cleanupCode, "existing cleanup code");
  assert.deepEqual(closed, ["worker", "texture", "encoder"]);
  failure = undefined;
  assets.dispose();
});

test("production forwards closed b811 and explicit legacy recipes, never caller revisions", async () => {
  failure = undefined;
  for (const profileId of SHELL_PROFILE_IDS) {
    const assets = adapter(false, { profileId });
    await assets.generateAssets({});
    const expected = resolveShellProfile(profileId).assetRecipe;
    assert.equal(hudRevision, expected.artRevision);
    assert.deepEqual(pipelineRevisions, {
      artRevision: expected.artRevision,
      overlayRevision: expected.overlayRevision,
    });
    assets.dispose();
  }
  assert.throws(
    () => adapter(false, { profileId: "e3756f8942b40eba6c851e881828a5b1bda17fd6" }),
    /SHELL_PROFILE_UNKNOWN/,
  );
  assert.throws(
    () => createProductionAssetAdapter({ runtime: {}, profile: {} }),
    /PRODUCTION_ASSET_PROFILE/,
  );
});

const trackOutputs = (t, options = {}) => {
  failure = undefined;
  lifetimeCase = { outputs: new Map(), ...options };
  t.after(() => {
    lifetimeCase = undefined;
    failure = undefined;
  });
  return lifetimeCase;
};
const assertWiped = (outputs) => {
  assert.ok(outputs.size > 0);
  for (const [name, bytes] of outputs) assert.deepEqual([...bytes], [0], name);
};

test("production wipes intermediate outputs on HUD, derived and pipeline failure", async (t) => {
  for (const stage of ["hud", "derived", "pipeline"]) {
    for (const arrayBuffers of [false, true]) {
      const primary = new Error(`${stage} stopped`);
      const tracked = trackOutputs(t, {
        arrayBuffers,
        onStage(current) {
          if (current === stage) throw primary;
        },
      });
      const assets = adapter();
      await assert.rejects(assets.generateAssets({}), (error) => error === primary);
      assertWiped(tracked.outputs);
      assets.dispose();
      assertWiped(tracked.outputs);
    }
  }
});

test("production wipes returned derived bytes before rejecting capacity mismatch", async (t) => {
  const tracked = trackOutputs(t);
  const assets = adapter(true, { derivedCounts: { expected: 1 } });
  await assert.rejects(assets.generateAssets({}), { message: "SHELL_DERIVED_CAPACITY_MISMATCH" });
  assert.equal(tracked.outputs.has("derived"), true);
  assertWiped(tracked.outputs);
  assets.dispose();
});

test("production wipes valid siblings after an invalid-first generated batch", async (t) => {
  for (const invalidBatch of ["native", "hud", "derived"]) {
    const tracked = trackOutputs(t, { invalidBatch, arrayBuffers: true });
    const assets = adapter();
    await assert.rejects(assets.generateAssets({}), { message: "PRODUCTION_ASSET_OUTPUT_TYPE" });
    assertWiped(tracked.outputs);
    assets.dispose();
    assertWiped(tracked.outputs);
  }
});

test("production wipes all generated output on pipeline cancellation or final close failure", async (t) => {
  for (const mode of ["pipeline-abort", "close-abort", "close-failure"]) {
    const controller = new AbortController();
    const primary = new Error("cancelled generation");
    const tracked = trackOutputs(t, {
      onStage(stage) {
        if (stage === "pipeline" && mode === "pipeline-abort") controller.abort(primary);
      },
    });
    const assets = adapter(true, {
      failClose: mode === "close-failure" ? "worker" : undefined,
      onClose(name) {
        if (name === "worker" && mode === "close-abort") controller.abort(primary);
      },
    });
    await assert.rejects(
      assets.generateAssets({ signal: controller.signal }),
      mode === "close-failure"
        ? { message: "PRODUCTION_ASSET_CLEANUP" }
        : (error) => error === primary,
    );
    assert.equal(tracked.outputs.has("panel-sprite"), true);
    assertWiped(tracked.outputs);
    assert.equal(assets.getAstcOutputBinding(), undefined);
    assets.dispose();
  }
});

test("production disposal wipes prior outputs and later returned HUD bytes", async (t) => {
  let releaseHud, hudReady;
  const ready = new Promise((resolve) => (hudReady = resolve));
  const gate = new Promise((resolve) => (releaseHud = resolve));
  const tracked = trackOutputs(t, {
    async onHudResult() {
      hudReady();
      await gate;
    },
  });
  const assets = adapter();
  const pending = assets.generateAssets({});
  await ready;
  assets.dispose();
  assert.deepEqual([...tracked.outputs.get("art-icon")], [0]);
  assert.deepEqual([...tracked.outputs.get("hud-ui")], [23]);
  releaseHud();
  await assert.rejects(pending, { message: "PRODUCTION_ASSET_DISPOSED" });
  assertWiped(tracked.outputs);
});

test("production retains success entry bytes until dispose without wiping shared HUD UI early", async (t) => {
  const tracked = trackOutputs(t, {
    arrayBuffers: true,
    onStage() {
      for (const [name, bytes] of tracked.outputs) assert.notEqual(bytes[0], 0, name);
    },
  });
  const assets = adapter();
  const entries = await assets.generateAssets({});
  for (const name of ["art-c", "hud-base", "hud-json", "panel-sprite"])
    assert.deepEqual([...tracked.outputs.get(name)], [0], name);
  for (const [path, name, value] of [
    ["native/icon.png", "art-icon", 12],
    ["hud_v4_ui/ui.json", "hud-ui", 23],
    ["dm/derived.tsv", "derived", 31],
  ]) {
    const item = entries.find((entry) => entry.path === path);
    for (let repeat = 0; repeat < 2; repeat++) {
      const chunks = [];
      for await (const bytes of item.chunks()) chunks.push(bytes);
      assert.equal(chunks[0].buffer, tracked.outputs.get(name).buffer);
      assert.deepEqual([...chunks[0]], [value], name);
    }
  }
  assert.equal(assets.getAstcOutputBinding(), binding);
  assets.dispose();
  assertWiped(tracked.outputs);
  const item = entries.find((entry) => entry.path === "native/icon.png");
  await assert.rejects(item.chunks().next(), { message: "PRODUCTION_ASSET_DISPOSED" });
});
