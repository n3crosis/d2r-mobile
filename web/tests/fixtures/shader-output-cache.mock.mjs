// Test-only synthetic production-loop dependencies, not real source/compiler proof.
import assert from "node:assert/strict";
import { mock } from "node:test";
const keys = Array.from({ length: 6927 }, (_, i) => i.toString(16).padStart(16, "0"));
const cache = new Map();
let full = false,
  proofFails = false,
  forceHit = false,
  badHit = false,
  controller,
  source = "synthetic",
  compiled = 0,
  translated = 0,
  proofs = 0,
  writes = 0,
  accepted = [],
  abortWrite = false;
const identity = {
  id: "synthetic-compiler",
  assetSha256: "1".repeat(64),
  factorySha256: "2".repeat(64),
  headerSha256: "3".repeat(64),
  apiVersion: 2,
  headerBundleVersion: 2,
  sourceLanguage: "floor-metal-3.2",
  mathProfile: "fast-f32",
};
const options = { platform: "ios", minimumOS: [18, 0], languageVersion: [3, 2], fastMath: true };
mock.module("../../sealed-runtime/clients.mjs", { namedExports: { assertSealedRuntime() {} } });
mock.module("../../shader-catalog-adapter.mjs", { namedExports: { assertShaderCatalog() {} } });
mock.module("../../extraction-job-adapter.mjs", {
  namedExports: {
    readAuthenticatedAssets() {
      return {
        logicalAssets: {
          async read() {
            return new Uint8Array([1]);
          },
        },
      };
    },
    readAuthenticatedProgramModules() {
      return {};
    },
  },
});
mock.module("../../logical-asset-suffixes.mjs", {
  namedExports: {
    resolveLogicalAssetSuffixes() {
      return ["data:data/hd/shaders/synthetic"];
    },
  },
});
mock.module("../../browser-task-yield.mjs", {
  namedExports: {
    async yieldBrowserTask({ signal }) {
      signal?.throwIfAborted();
    },
  },
});
mock.module("../../shader-pipeline.mjs", {
  namedExports: {
    createShaderPipeline() {
      return {
        async translate() {
          translated++;
          return {
            msl: source,
            replay: { entry: "main0", msl_entry_kind: "kernel" },
            resources: { notes: [] },
          };
        },
        async verifyCompleteSourceSet() {
          proofs++;
          if (proofFails) throw new Error("synthetic proof failed");
          return { sourceDigest: "be59c864f087b377" };
        },
        dispose() {},
      };
    },
  },
});
mock.module("../../compiled-shader-boundary.mjs", {
  namedExports: {
    async acceptCompiledShaderOutput({ binary, compiler, signal }) {
      signal?.throwIfAborted();
      assert.equal(binary[0], 7, "synthetic output rejected");
      const bytes = binary.slice();
      accepted.push(bytes);
      return { bytes, receipt: { compiler }, receiptSha256: "synthetic" };
    },
  },
});
const { createProductionShaderAdapter } = await import("../../production-shaders.mjs");
const runtime = {
  workerUrls: {},
  createShaderWorkerFactory() {},
  createAirCompilerClient() {
    return {
      compiler: { ...identity },
      options: structuredClone(options),
      limits: { outputBytes: 16 * 1024 * 1024 },
      async compile() {
        compiled++;
        return { bytes: new Uint8Array([7]), compiler: { ...identity }, options };
      },
      dispose() {},
    };
  },
};
const catalog = {
  keys,
  bfWant: [],
  describe(key) {
    return { name: "synthetic", index: parseInt(key, 16), embedded: false };
  },
  createOwnedPackSource() {
    return {
      async prepare(key) {
        if (!full && parseInt(key, 16) >= 2) throw new Error("synthetic stop");
        return { job: { stage: "cs" }, code: new Uint8Array([1]) };
      },
      dispose() {},
    };
  },
};
const outputCache = {
  async read({ key }) {
    return badHit
      ? new Uint8Array([0])
      : forceHit
        ? new Uint8Array([7])
        : (cache.get(key)?.slice() ?? null);
  },
  async write({ key, bytes }) {
    writes++;
    cache.set(key, bytes.slice());
    if (abortWrite) controller.abort();
    return true;
  },
};
async function run(context = { runtimeManifestSha256: "4".repeat(64) }) {
  controller = new AbortController();
  const adapter = createProductionShaderAdapter({
    runtime,
    catalog,
    outputCache,
    cacheContext: context,
    trustedShell: {
      trustedRecipe: { shaderKeys: keys, shaderDigest: "be59c864f087b377", chain: "123456789abc" },
    },
  });
  try {
    if (abortWrite)
      await assert.rejects(adapter.generateShaders({ signal: controller.signal }), {
        name: "AbortError",
      });
    else if (!full)
      await assert.rejects(
        adapter.generateShaders({ signal: controller.signal }),
        /synthetic stop/,
      );
    else if (proofFails)
      await assert.rejects(
        adapter.generateShaders({ signal: controller.signal }),
        /synthetic proof failed/,
      );
    else assert.ok((await adapter.generateShaders({ signal: controller.signal })).length > 6927);
  } finally {
    adapter.dispose();
  }
}
await run();
assert.equal(compiled, 2);
assert.equal(writes, 2);
await run();
assert.equal(compiled, 2);
assert.equal(translated, 4);
// Key binds compiler/header/factory/ABI/profile/options and normalized source/runtime.
for (const field of ["assetSha256", "factorySha256", "headerSha256"]) {
  identity[field] = "9".repeat(64);
  const before = compiled;
  await run();
  assert.equal(compiled, before + 2);
}
for (const field of ["apiVersion", "headerBundleVersion"]) {
  identity[field]++;
  const before = compiled;
  await run();
  assert.equal(compiled, before + 2);
}
identity.mathProfile = "synthetic-other";
let before = compiled;
await run();
assert.equal(compiled, before + 2);
options.fastMath = false;
before = compiled;
await run();
assert.equal(compiled, before + 2);
options.minimumOS = [26, 0];
before = compiled;
await run();
assert.equal(compiled, before + 2);
source = "different source";
before = compiled;
await run();
assert.equal(compiled, before + 2);
before = compiled;
await run({ runtimeManifestSha256: "5".repeat(64) });
assert.equal(compiled, before + 2);
badHit = true;
before = compiled;
await run();
assert.equal(compiled, before + 2);
badHit = false;
// Missing trusted context bypasses caching rather than weakening its key.
before = compiled;
const oldWrites = writes;
await run({});
assert.equal(compiled, before + 2);
assert.equal(writes, oldWrites);
forceHit = true;
full = true;
before = compiled;
const oldTranslated = translated;
await run();
assert.equal(compiled, before);
assert.equal(translated - oldTranslated, 6927);
assert.equal(proofs, 1);
proofFails = true;
await run();
assert.equal(compiled, before);
assert.equal(proofs, 2);
// A cancelled persistence step erases accepted buffers and cannot publish output.
full = false;
forceHit = false;
proofFails = false;
abortWrite = true;
source = "cancel fresh source";
accepted = [];
await run();
assert.equal(accepted.length, 1);
assert.deepEqual(accepted[0], new Uint8Array(1));
