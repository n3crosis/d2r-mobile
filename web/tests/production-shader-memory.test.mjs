// 仅使用合成字节测试预算、分块和生命周期；不构成游戏或浏览器内存测量。
// Synthetic bytes test budgets, chunking and lifetimes, not game validation or browser memory measurement.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  createShaderOutputBudget,
  createShaderRecordProgress,
  createShaderFinalizationCheckpoint,
  shaderOutputChunks,
  createShaderSourceCache,
} from "../production-shaders.mjs";
const encode = (value) => new TextEncoder().encode(value);
const packOwner = (bytes) =>
  Object.freeze({
    dispose() {
      bytes.fill(0);
    },
  });

test("actual post-chain formatted replay rejects a compact-estimate budget bypass", () => {
  const replay = { bindings: [{ name: "value", slot: 1 }], notes: ["synthetic"] };
  const compact = encode(JSON.stringify(replay));
  const actual = encode(JSON.stringify({ ...replay, chain: "trusted-chain" }, null, 1));
  const base = 20,
    fetch = 10;
  assert.ok(actual.length > compact.length);
  const budget = createShaderOutputBudget(base + fetch + compact.length);
  budget.replace(0, base + fetch + compact.length);
  assert.throws(() => budget.replace(compact.length, actual.length), /budget exceeded/);
  assert.equal(budget.used, base + fetch + compact.length);
});
test("base, fetch, final JSON and index count exactly once", () => {
  const budget = createShaderOutputBudget(100);
  budget.replace(0, 20 + 10 + 5);
  budget.replace(5, 30);
  budget.replace(0, 40);
  assert.equal(budget.used, 100);
  assert.throws(() => budget.replace(0, 1), /budget exceeded/);
});
test("output chunks own <=64KiB backings and preserve exact bytes across replays", async () => {
  const original = Uint8Array.from({ length: 150000 }, (_, i) => i % 251);
  for (let run = 0; run < 2; run++) {
    let offset = 0,
      checks = 0;
    for await (const chunk of shaderOutputChunks(original, () => checks++)) {
      assert.ok(chunk.buffer.byteLength <= 65536);
      assert.notEqual(chunk.buffer, original.buffer);
      assert.deepEqual(chunk, original.subarray(offset, offset + chunk.length));
      offset += chunk.length;
      chunk.fill(0);
    }
    assert.equal(offset, original.length);
    assert.equal(checks, 3);
  }
});
test("cancellation between chunks prevents further allocation/delivery", async () => {
  const controller = new AbortController();
  const iterator = shaderOutputChunks(new Uint8Array(100000), () =>
    controller.signal.throwIfAborted(),
  );
  assert.equal((await iterator.next()).value.length, 65536);
  controller.abort();
  await assert.rejects(iterator.next(), { name: "AbortError" });
});
test("noncontiguous embedded uses retain image until final completion and invalidate pack identity", () => {
  const cache = createShaderSourceCache(2),
    image = new Uint8Array([7, 8]);
  const first = new Uint8Array([1, 2]);
  cache.setPack("a", packOwner(first));
  cache.enter({ embedded: true, name: "embedded-a" });
  assert.deepEqual(first, new Uint8Array(2));
  assert.equal(cache.packName, null);
  cache.setImage(image);
  cache.completeEmbedded();
  assert.equal(cache.image, image);
  cache.enter({ embedded: false, name: "a" });
  assert.equal(cache.pack, undefined);
  const second = new Uint8Array([3, 4]);
  cache.setPack("a", packOwner(second));
  cache.enter({ embedded: true, name: "embedded-b" });
  assert.deepEqual(second, new Uint8Array(2));
  assert.equal(cache.image, image);
  cache.completeEmbedded();
  assert.equal(cache.image, undefined);
  assert.deepEqual(image, new Uint8Array(2));
  cache.enter({ embedded: false, name: "a" });
  assert.equal(cache.packName, null);
});
test("source switches and failure cleanup wipe only retained owned buffers", () => {
  const cache = createShaderSourceCache(1),
    pack = new Uint8Array([5]),
    image = new Uint8Array([6]);
  cache.setPack("a", packOwner(pack));
  cache.setImage(image);
  cache.enter({ embedded: false, name: "b" });
  assert.equal(pack[0], 0);
  assert.equal(image[0], 6);
  cache.dispose();
  cache.dispose();
  assert.equal(image[0], 0);
  assert.equal(cache.image, undefined);
});
test("a pack owner survives same-source entries and is released exactly once on replacement", () => {
  const cache = createShaderSourceCache(0);
  let first = 0,
    second = 0;
  const source = Object.freeze({ dispose: () => first++ });
  cache.setPack("a", source);
  cache.enter({ embedded: false, name: "a" });
  assert.equal(cache.pack, source);
  assert.equal(first, 0);
  cache.setPack("b", Object.freeze({ dispose: () => second++ }));
  assert.equal(first, 1);
  cache.dispose();
  cache.dispose();
  assert.equal(first, 1);
  assert.equal(second, 1);
  assert.equal(cache.pack, undefined);
  assert.equal(cache.packName, null);
});

// 执行真实生产循环，验证每个物理包只交接一次，并在下一来源失败时释放两个所有者。
// Execute the real production loop: hand off each physical pack once and release both owners when the next source fails.
test("production reuses one owner per pack and releases owners and code on preparation failure", () => {
  const script = `
    import assert from "node:assert/strict";
    import { mock } from "node:test";
    const reads = [], created = [], disposed = [], code = [], compiled = [], accepted = [];
    let translated = 0, compilerDisposed = 0;
    mock.module("./sealed-runtime/clients.mjs", { namedExports: { assertSealedRuntime() {} } });
    mock.module("./shader-catalog-adapter.mjs", { namedExports: { assertShaderCatalog() {} } });
    mock.module("./extraction-job-adapter.mjs", { namedExports: {
      readAuthenticatedAssets() { return { logicalAssets: { async read(path) {
        reads.push(path);
        return new Uint8Array([7, 8]);
      } } }; },
      readAuthenticatedProgramModules() { return {}; }
    } });
    mock.module("./logical-asset-suffixes.mjs", { namedExports: {
      resolveLogicalAssetSuffixes() { return ["data:data/hd/shaders/a", "data:data/hd/shaders/b"]; }
    } });
    mock.module("./shader-pipeline.mjs", { namedExports: { createShaderPipeline() {
      return { async translate() {
        translated++;
        return { msl: "synthetic", replay: { entry: "synthetic_main", msl_entry_kind: "kernel" }, resources: { notes: [] } };
      }, dispose() {} };
    } } });
    // Only ownership is exercised; this mock does not validate or fabricate a real compiled library.
    mock.module("./compiled-shader-boundary.mjs", { namedExports: {
      async acceptCompiledShaderOutput({ binary, compiler, expected, signal }) {
        assert.ok(signal instanceof AbortSignal);
        assert.equal(expected.entry, "synthetic_main");
        assert.equal(expected.stage, "kernel");
        assert.match(expected.sourceSha256, /^[a-f0-9]{64}$/);
        const bytes = binary.slice();
        accepted.push(bytes);
        return { bytes, receipt: { compiler }, receiptSha256: "synthetic-cleanup-only" };
      }
    } });
    const { createProductionShaderAdapter } = await import("./production-shaders.mjs");
    const keys = Array.from({ length: 6927 }, (_, i) => i.toString(16).padStart(16, "0"));
    const adapter = createProductionShaderAdapter({
      runtime: {
        workerUrls: {}, createShaderWorkerFactory() {},
        createAirCompilerClient() {
          return {
            async compile(source, { entry, stage, signal }) {
              assert.equal(source, "synthetic");
              assert.equal(entry, "synthetic_main");
              assert.equal(stage, "kernel");
              assert.ok(signal instanceof AbortSignal);
              signal.throwIfAborted();
              const bytes = new Uint8Array([3, 4]);
              compiled.push(bytes);
              return { bytes, compiler: { id: "synthetic-cleanup-only" }, options: {} };
            },
            dispose() { compilerDisposed++; }
          };
        }
      },
      catalog: { keys, bfWant: [], describe(key) {
        const index = parseInt(key, 16);
        return { name: index < 2 ? "a" : "b", index, embedded: false };
      },
      prepare() { throw new Error("Pack must use its owned source"); },
      createOwnedPackSource(name, input) {
        created.push(name);
        const owned = structuredClone(input, { transfer: [input.buffer] });
        assert.equal(input.byteLength, 0);
        return {
          async prepare(key, flags) {
            assert.ok(flags.signal instanceof AbortSignal);
            if (name === "b") throw new Error("synthetic preparation failure");
            const bytes = new Uint8Array([1, 2]);
            code.push(bytes);
            return { job: { stage: "cs" }, code: bytes };
          },
          dispose() { owned.fill(0); disposed.push(name); }
        };
      } },
      trustedShell: { trustedRecipe: { shaderKeys: keys, shaderDigest: "be59c864f087b377" } }
    });
    await assert.rejects(adapter.generateShaders(), /synthetic preparation failure/);
    assert.deepEqual(reads, ["data:data/hd/shaders/a", "data:data/hd/shaders/b"]);
    assert.deepEqual(created, ["a", "b"]);
    assert.deepEqual(disposed, ["a", "b"]);
    assert.equal(translated, 2);
    assert.equal(compiled.length, 2);
    assert.equal(accepted.length, 2);
    assert.equal(compilerDisposed, 1);
    for (const bytes of code) assert.deepEqual(bytes, new Uint8Array(2));
    for (const bytes of [...compiled, ...accepted]) assert.deepEqual(bytes, new Uint8Array(2));
    adapter.dispose();
    assert.deepEqual(disposed, ["a", "b"]);
    assert.equal(compilerDisposed, 1);
  `;
  const result = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--input-type=module", "-e", script],
    { cwd: new URL("../", import.meta.url), encoding: "utf8", timeout: 30000 },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

// 模拟异步准备结束时的取消，直接执行生产适配器而非复制其清理逻辑。
// Simulate cancellation as async preparation settles, executing the production adapter rather than copied cleanup logic.
test("cancellation after preparation wipes owned code without starting translation", () => {
  const script = `
    import assert from "node:assert/strict";
    import { mock } from "node:test";
    const controller = new AbortController();
    const code = new Uint8Array([9, 8, 7, 6]);
    const independent = code.slice();
    let translated = 0, disposed = 0, prepared = 0, sourceDisposed = 0, compilerDisposed = 0;
    mock.module("./sealed-runtime/clients.mjs", { namedExports: { assertSealedRuntime() {} } });
    mock.module("./shader-catalog-adapter.mjs", { namedExports: { assertShaderCatalog() {} } });
    mock.module("./extraction-job-adapter.mjs", { namedExports: {
      readAuthenticatedAssets() { return { logicalAssets: { async read() { return new Uint8Array([1]); } } }; },
      readAuthenticatedProgramModules() { return {}; }
    } });
    mock.module("./logical-asset-suffixes.mjs", { namedExports: {
      resolveLogicalAssetSuffixes() { return ["data:data/hd/shaders/synthetic"]; }
    } });
    mock.module("./shader-pipeline.mjs", { namedExports: { createShaderPipeline() {
      return { async translate() { translated++; }, dispose() { disposed++; } };
    } } });
    const { createProductionShaderAdapter } = await import("./production-shaders.mjs");
    const keys = Array.from({ length: 6927 }, (_, i) => i.toString(16).padStart(16, "0"));
    const adapter = createProductionShaderAdapter({
      runtime: {
        workerUrls: {}, createShaderWorkerFactory() {},
        createAirCompilerClient() {
          return {
            async compile() { assert.fail("Cancelled preparation must never start compilation"); },
            dispose() { compilerDisposed++; }
          };
        }
      },
      catalog: { keys, describe() { return { name: "synthetic", index: 0, embedded: false }; },
        prepare() { throw new Error("Pack must use its owned source"); },
        createOwnedPackSource() {
          return {
            async prepare() {
              prepared++;
              await Promise.resolve();
              controller.abort();
              return { job: {}, code };
            },
            dispose() { sourceDisposed++; }
          };
        }
      },
      trustedShell: { trustedRecipe: { shaderKeys: keys, shaderDigest: "be59c864f087b377" } }
    });
    await assert.rejects(adapter.generateShaders({ signal: controller.signal }), { name: "AbortError" });
    assert.equal(prepared, 1);
    assert.equal(translated, 0);
    assert.equal(sourceDisposed, 1);
    assert.ok(disposed > 0);
    assert.equal(compilerDisposed, 1);
    assert.deepEqual(code, new Uint8Array(4));
    assert.deepEqual(independent, new Uint8Array([9, 8, 7, 6]));
    adapter.dispose();
    assert.equal(compilerDisposed, 1);
  `;
  const result = spawnSync(
    process.execPath,
    ["--experimental-test-module-mocks", "--input-type=module", "-e", script],
    {
      cwd: new URL("../", import.meta.url),
      encoding: "utf8",
      timeout: 30000,
    },
  );
  assert.equal(result.status, 0, result.stderr || result.stdout);
});

// 合成时钟验证节流与最终记录计数，不把计数当作阶段完成。
// A synthetic clock verifies throttling and the last record count, not stage completion.
test("shader counters are monotonic, throttled, bounded and observer-isolated", async () => {
  let time = 0;
  const controller = new AbortController(),
    events = [];
  const report = createShaderRecordProgress(
    6,
    (value) => events.push(value),
    controller.signal,
    () => time,
  );
  report(1);
  report(2);
  report(2);
  report(0);
  report(7);
  report(NaN);
  time = 249;
  report(3);
  time = 250;
  report(4);
  report(3);
  report(5);
  report(6);
  report(6);
  assert.deepEqual(
    events,
    [1, 4, 6].map((completedRecords) => ({ completedRecords, totalRecords: 6 })),
  );
  assert.ok(events.every(Object.isFrozen));
  assert.ok(events.every((value) => !Object.hasOwn(value, "state")));
  controller.abort();
  assert.doesNotThrow(() => report(6));
  const cancelled = createShaderRecordProgress(
    1,
    () => assert.fail("cancelled observer"),
    controller.signal,
  );
  cancelled(1);
  createShaderRecordProgress(1, () => {
    throw new Error("private");
  })(1);
  createShaderRecordProgress(1, async () => {
    throw new Error("private async");
  })(1);
  await new Promise((resolve) => setImmediate(resolve));
  for (const total of [0, 6928, Infinity, 1.5])
    assert.throws(() => createShaderRecordProgress(total));
});

test("finalization yields on byte or monotonic work budget without per-row tasks", async () => {
  let time = 0,
    tasks = 0,
    checks = 0;
  const checkpoint = createShaderFinalizationCheckpoint(
    () => checks++,
    undefined,
    async () => {
      tasks++;
    },
    () => time,
  );
  for (let i = 0; i < 3; i++) assert.equal(checkpoint(1024 * 1024), undefined);
  assert.equal(tasks, 0);
  await checkpoint(1024 * 1024);
  assert.equal(tasks, 1);
  time = 7;
  assert.equal(checkpoint(0), undefined);
  time = 8;
  await checkpoint(0);
  assert.equal(tasks, 2);
  assert.ok(checks >= 8);
  assert.throws(() => checkpoint(-1));
});

test("cancellation delivered by a finalization task rejects before continuing", async () => {
  const controller = new AbortController();
  const checkpoint = createShaderFinalizationCheckpoint(
    () => controller.signal.throwIfAborted(),
    controller.signal,
    async ({ signal }) => {
      assert.equal(signal, controller.signal);
      controller.abort();
    },
    () => 0,
  );
  await assert.rejects(checkpoint(4 * 1024 * 1024), { name: "AbortError" });
  assert.throws(() => checkpoint(1), { name: "AbortError" });
});

// 检查让出位置仍位于完整证明之后；结果发布前必须完成最后取消检查。
// Check yields remain after complete proof, with a final cancellation check before publishing results.
test("production finalization preserves proof-first ordering and signal-aware record yields", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../production-shaders.mjs", import.meta.url), "utf8");
  assert.ok(
    source.indexOf("await pipeline.verifyCompleteSourceSet()") <
      source.indexOf("const checkpoint = createShaderFinalizationCheckpoint"),
  );
  assert.match(source, /await yieldBrowserTask\(\{ signal: controller.signal \}\)/);
  assert.doesNotMatch(source, /setTimeout\(resolve, 0\)/);
  assert.match(
    source,
    /entries.push\(entry\("dm\/c1_full.tsv", index\)\);\s*check\(\);\s*return entries/,
  );
  assert.match(source, /const pause = checkpoint\(json.length\);\s*if \(pause\) await pause/);
});

// 直接约束所有权登记顺序，使预算拒绝同样擦除刚分配的元数据。
// Constrain ownership registration order so budget rejection also wipes newly allocated metadata.
test("finalization owns replay and index bytes before a budget check can reject them", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("../production-shaders.mjs", import.meta.url), "utf8");
  assert.match(
    source,
    /const json = encoder\.encode\(JSON\.stringify\(row\.replay, null, 1\)\);\s*retained\.push\(json\);\s*budget\.replace\(row\.replayReservation, json\.length\)/,
  );
  assert.match(source, /retained\.push\(index\);\s*budget\.replace\(0, index\.length\)/);
});
