// 合成目录与可控编译替身检查生产并发，不执行真实编译器、WASM 或游戏输入。
// Synthetic catalogs and controlled compiler substitutes exercise production concurrency, not real compilers, WASM or game inputs.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { setImmediate as nextTurn } from "node:timers/promises";
const keys = Array.from({ length: 6927 }, (_, index) => index.toString(16).padStart(16, "0"));
let state;
mock.module("../../sealed-runtime/clients.mjs", { namedExports: { assertSealedRuntime() {} } });
mock.module("../../shader-catalog-adapter.mjs", { namedExports: { assertShaderCatalog() {} } });
mock.module("../../extraction-job-adapter.mjs", {
  namedExports: {
    readAuthenticatedAssets: () => ({ logicalAssets: { read: async () => new Uint8Array([1]) } }),
    readAuthenticatedProgramModules: () => ({}),
  },
});
mock.module("../../logical-asset-suffixes.mjs", {
  namedExports: { resolveLogicalAssetSuffixes: () => ["data:data/hd/shaders/synthetic"] },
});
mock.module("../../browser-task-yield.mjs", {
  namedExports: {
    async yieldBrowserTask({ signal }) {
      signal?.throwIfAborted();
    },
  },
});
mock.module("../../shader-native-artifacts.mjs", {
  namedExports: {
    c1NeedsFullBuffer: (source) => Number(source.slice(9)) % 2 === 0,
    readableTileVariant: (source) => ({ msl: `${source}_fetch`, metadata: { synthetic: true } }),
  },
});
mock.module("../../shader-pipeline.mjs", {
  namedExports: {
    createShaderPipeline() {
      return {
        async translate({ job }) {
          state.translated.push(job.key);
          return {
            msl: `synthetic${parseInt(job.key, 16)}`,
            replay: {
              entry: "main0",
              msl_entry_kind: job.stage === "ps" ? "fragment" : "kernel",
              bindings: [],
            },
            resources: { notes: [] },
          };
        },
        async verifyCompleteSourceSet() {
          assert.equal(state.active, 0, "proof waits for every compile");
          assert.equal(state.translated.length, 6927);
          state.proofs++;
          if (state.proofFails) throw new Error("synthetic proof failure");
          return { sourceDigest: "be59c864f087b377" };
        },
        dispose() {},
      };
    },
  },
});
mock.module("../../compiled-shader-boundary.mjs", {
  namedExports: {
    async acceptCompiledShaderOutput({ binary, expected, signal }) {
      signal?.throwIfAborted();
      const bytes = binary.slice();
      state.accepted.push(bytes);
      return {
        bytes,
        receipt: { compiler: { id: "synthetic" }, ...expected },
        receiptSha256: `synthetic-${expected.key}-${expected.variant}`,
      };
    },
  },
});
const { createProductionShaderAdapter } = await import("../../production-shaders.mjs");
function setup(concurrency, { automatic = false, cache = false, proofFails = false } = {}) {
  state = {
    active: 0,
    peak: 0,
    calls: [],
    translated: [],
    proofs: 0,
    accepted: [],
    raw: [],
    progress: [],
    writeActive: 0,
    writes: 0,
    proofFails,
  };
  const current = state;
  const controller = new AbortController();
  const adapter = createProductionShaderAdapter({
    runtime: {
      workerUrls: {},
      createShaderWorkerFactory() {},
      createAirCompilerClient() {
        return {
          concurrency,
          compiler: { id: "synthetic" },
          options: {},
          limits: { outputBytes: 1024 },
          async compile(source, { signal }) {
            signal.throwIfAborted();
            current.active++;
            current.peak = Math.max(current.peak, current.active);
            assert.ok(current.active <= concurrency);
            const job = Promise.withResolvers();
            const abort = () => job.reject(signal.reason);
            signal.addEventListener("abort", abort, { once: true });
            const index = Number(source.match(/\d+/)[0]);
            const complete = () => {
              const bytes = new Uint8Array([index % 251, source.endsWith("_fetch") ? 1 : 0]);
              current.raw.push(bytes);
              job.resolve({ bytes, compiler: { id: "synthetic" }, options: {} });
            };
            current.calls.push({ source, complete, reject: job.reject });
            if (automatic) queueMicrotask(complete);
            try {
              return await job.promise;
            } finally {
              current.active--;
              signal.removeEventListener("abort", abort);
            }
          },
          dispose() {},
        };
      },
    },
    catalog: {
      keys,
      bfWant: [],
      describe(key) {
        return { name: "synthetic", index: parseInt(key, 16), embedded: false };
      },
      createOwnedPackSource() {
        return {
          async prepare(key) {
            return {
              job: { key, stage: parseInt(key, 16) % 2 ? "ps" : "cs" },
              code: new Uint8Array([1]),
            };
          },
          dispose() {},
        };
      },
    },
    outputCache: cache
      ? {
          read: async () => null,
          async write({ signal }) {
            signal.throwIfAborted();
            assert.equal(current.writeActive, 0, "cache commits are serialized");
            current.writeActive++;
            await nextTurn();
            current.writeActive--;
            current.writes++;
            return true;
          },
        }
      : undefined,
    cacheContext: { runtimeManifestSha256: "1".repeat(64) },
    trustedShell: {
      trustedRecipe: { shaderKeys: keys, shaderDigest: "be59c864f087b377", chain: "123456789abc" },
    },
  });
  const result = adapter.generateShaders({
    signal: controller.signal,
    onProgress: (event) => current.progress.push(event),
  });
  result.catch(() => {});
  return { state: current, adapter, controller, result };
}
async function until(predicate) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await nextTurn();
  }
  assert.fail("synthetic condition did not settle");
}

test("translation overlaps four compiles without preparing a fifth record; cancellation drains all", async () => {
  const run = setup(4);
  await until(() => run.state.active === 4);
  assert.equal(run.state.translated.length, 4);
  await nextTurn();
  assert.equal(run.state.translated.length, 4);
  run.state.calls[2].complete();
  await until(() => run.state.translated.length === 5);
  assert.equal(run.state.proofs, 0);
  run.controller.abort();
  await assert.rejects(run.result, { name: "AbortError" });
  assert.equal(run.state.active, 0);
  assert.ok(run.state.accepted.every((bytes) => bytes.every((x) => x === 0)));
  assert.ok(run.state.raw.every((bytes) => bytes.every((x) => x === 0)));
  assert.ok(run.state.progress.every((event) => event.compilerWorkers === 4));
  run.adapter.dispose();
});

test("the first compile failure aborts siblings and retains its own record diagnostic", async () => {
  const run = setup(4);
  await until(() => run.state.active === 4);
  const failure = new Error("synthetic compiler failure");
  failure.code = "AIR_FRONTEND_FAILED";
  run.state.calls[2].reject(failure);
  await assert.rejects(run.result, (error) => {
    assert.equal(error.code, "AIR_FRONTEND_FAILED");
    assert.equal(error.shaderDiagnostic.record, 3);
    assert.equal(error.shaderDiagnostic.substep, "compilation");
    return true;
  });
  assert.equal(run.state.active, 0);
  assert.equal(run.state.proofs, 0);
  assert.equal(run.state.translated.length, 4);
  run.adapter.dispose();
});

async function outputDigest(concurrency, cache) {
  const run = setup(concurrency, { automatic: true, cache });
  const entries = await run.result;
  const hash = createHash("sha256");
  for (const entry of entries) {
    hash.update(entry.path);
    for await (let bytes of entry.chunks()) {
      if (entry.path === "dm/c1_full.tsv")
        bytes = new TextEncoder().encode(new TextDecoder().decode(bytes).replace(/^#.*\n/, ""));
      hash.update(bytes);
    }
  }
  assert.equal(run.state.proofs, 1);
  assert.equal(run.state.calls.length, 6927 + Math.floor(6927 / 2));
  assert.ok(run.state.peak <= concurrency);
  if (cache) assert.equal(run.state.writes, run.state.calls.length);
  run.adapter.dispose();
  assert.ok(run.state.accepted.every((bytes) => bytes.every((x) => x === 0)));
  return hash.digest("hex");
}
test("sequential and parallel output order/base-fetch receipts match and every concurrent cache result persists", async () => {
  assert.equal(await outputDigest(4, true), await outputDigest(1, false));
});

test("all parallel outputs are withheld and wiped when final source proof fails", async () => {
  const run = setup(4, { automatic: true, proofFails: true });
  await assert.rejects(run.result, /synthetic proof failure/);
  assert.equal(run.state.proofs, 1);
  assert.equal(run.state.active, 0);
  assert.ok(run.state.accepted.every((bytes) => bytes.every((x) => x === 0)));
  run.adapter.dispose();
});
