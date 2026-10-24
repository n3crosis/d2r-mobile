// Feature suite: output-cache. Original test sections retain independent lexical scopes.
import * as strictModule from "node:assert/strict";
import * as nodeTestModule from "node:test";
import * as assetOutputCacheModule from "../asset-output-cache.mjs";
import * as promisesModule from "node:fs/promises";
import * as browserPackagerModule from "../browser-packager.mjs";
import * as packagingJobModule from "../packaging-job.mjs";
import * as downloadPreparationModule from "../download-preparation.mjs";
import * as packagingDiagnosticsModule from "../packaging-diagnostics.mjs";
import * as localOutputCacheModule from "../local-output-cache.mjs";
import * as opfsStorageAdvisoryModule from "../opfs-storage-advisory.mjs";
import * as nodeChild_processModule from "node:child_process";
import * as assertIsolatedRunModule from "./helpers/assert-isolated-run.mjs";

// asset-output-cache
{
  // 验证 asset-output-cache 的约定与边界；依据 ../asset-output-cache.mjs 及本文件的测试断言。
  // Verify asset-output-cache contracts and boundaries against ../asset-output-cache.mjs and this file's assertions.
  const { default: assert } = strictModule;
  const { default: test } = nodeTestModule;
  const { runCachedAssetOperation } = assetOutputCacheModule;

  const context = Object.freeze({
    runtimeManifestSha256: "a".repeat(64),
    profileId: "synthetic-ios",
    artRevision: "synthetic-art-1",
    overlayRevision: "synthetic-overlay-1",
  });
  const encode = (value) => new TextEncoder().encode(value);
  function fixture() {
    const entries = new Map(),
      writes = [];
    let runs = 0,
      validations = 0;
    const cache = {
      async read({ kind, key, maxBytes }) {
        const bytes = entries.get(`${kind}/${key}`);
        return bytes && bytes.length <= maxBytes ? bytes.slice() : null;
      },
      async write({ kind, key, bytes }) {
        writes.push(kind);
        entries.set(`${kind}/${key}`, bytes.slice());
        return true;
      },
    };
    const options = {
      outputCache: cache,
      cacheContext: context,
      operation: "native-art",
      payload: encode("synthetic pixels and source bytes"),
      options: { metadataSha256: { manifest: "b".repeat(64) } },
      async run() {
        runs++;
        return { files: { "art.png": new Uint8Array([1, 2, 3]) }, assetCount: 1 };
      },
      validate(result) {
        validations++;
        assert.deepEqual(Object.keys(result.files), ["art.png"]);
        assert.deepEqual([...new Uint8Array(result.files["art.png"])], [1, 2, 3]);
      },
    };
    return { options, cache, entries, writes, runs: () => runs, validations: () => validations };
  }

  test("encoded asset hits preserve outputs and repeat the same validation", async () => {
    const f = fixture();
    const first = await runCachedAssetOperation(f.options);
    assert.deepEqual(f.writes, ["asset-file", "asset-index"]);
    first.files["art.png"].fill(0);
    const second = await runCachedAssetOperation(f.options);
    assert.deepEqual([...second.files["art.png"]], [1, 2, 3]);
    assert.equal(second.assetCount, 1);
    assert.equal(f.runs(), 1);
    assert.equal(f.validations(), 2);
    assert.equal(f.entries.size, 2);
    assert.ok(
      [...f.entries.values()].every(
        (bytes) => !new TextDecoder().decode(bytes).includes("synthetic pixels"),
      ),
    );
  });

  test("every source payload, option, profile, recipe and runtime identity changes the key", async () => {
    for (const changed of [
      { payload: encode("different source bytes") },
      { options: { metadataSha256: { manifest: "c".repeat(64) } } },
      { cacheContext: { ...context, profileId: "other-profile" } },
      { cacheContext: { ...context, artRevision: "other-art" } },
      { cacheContext: { ...context, overlayRevision: "other-overlay" } },
      { cacheContext: { ...context, runtimeManifestSha256: "d".repeat(64) } },
    ]) {
      const f = fixture();
      await runCachedAssetOperation(f.options);
      await runCachedAssetOperation({ ...f.options, ...changed });
      assert.equal(f.runs(), 2);
    }
  });

  test("unavailable, denied or incomplete caches fall back to normal generation", async () => {
    for (const setup of [
      (f) => {
        f.options.outputCache = undefined;
      },
      (f) => {
        f.options.cacheContext = undefined;
      },
      (f) => {
        f.cache.read = async () => {
          throw new Error("denied");
        };
      },
      (f) => {
        f.cache.write = async () => {
          throw new Error("quota");
        };
      },
    ]) {
      const f = fixture();
      setup(f);
      await runCachedAssetOperation(f.options);
      assert.equal(f.runs(), 1);
    }
    const f = fixture();
    await runCachedAssetOperation(f.options);
    for (const key of f.entries.keys()) if (key.startsWith("asset-file/")) f.entries.delete(key);
    await runCachedAssetOperation(f.options);
    assert.equal(f.runs(), 2);
  });

  test("malformed metadata or cached outputs rejected by the generator are misses", async () => {
    for (const kind of ["asset-index", "asset-file"]) {
      const f = fixture();
      await runCachedAssetOperation(f.options);
      for (const [key, bytes] of f.entries) if (key.startsWith(`${kind}/`)) bytes[0] = 42;
      await runCachedAssetOperation(f.options);
      assert.equal(f.runs(), 2);
    }
  });

  test("rejected fresh output never publishes a reusable cache index", async () => {
    const f = fixture();
    f.options.validate = () => {
      throw new Error("rejected output");
    };
    await assert.rejects(runCachedAssetOperation(f.options), /rejected output/);
    assert.deepEqual(f.writes, []);
  });

  test("a partial file write does not publish the complete result", async () => {
    const f = fixture();
    f.options.run = async () => ({
      files: { "art.png": new Uint8Array([1, 2, 3]), "extra.png": new Uint8Array([4]) },
    });
    f.options.validate = () => {};
    let attempted = 0;
    const write = f.cache.write;
    f.cache.write = async (request) => (++attempted === 2 ? false : write(request));
    await runCachedAssetOperation(f.options);
    assert.deepEqual(f.writes, ["asset-file"]);
    assert.ok([...f.entries.keys()].every((key) => !key.startsWith("asset-index/")));
  });

  test("a failed refresh cannot replace files referenced by the earlier complete index", async () => {
    const f = fixture();
    let value = 1;
    f.options.run = async () => ({
      files: {
        "one.png": new Uint8Array([value]),
        "two.png": new Uint8Array([value]),
      },
    });
    f.options.validate = () => {};
    await runCachedAssetOperation(f.options);
    const read = f.cache.read,
      write = f.cache.write;
    let writes = 0;
    value = 2;
    f.cache.read = async () => null;
    f.cache.write = async (request) => (++writes === 2 ? false : write(request));
    await runCachedAssetOperation(f.options);
    f.cache.read = read;
    f.cache.write = write;
    const retained = await runCachedAssetOperation(f.options);
    assert.deepEqual([...retained.files["one.png"]], [1]);
    assert.deepEqual([...retained.files["two.png"]], [1]);
  });

  test("cache read cancellation wipes returned snapshots without falling through to compute", async () => {
    const f = fixture();
    await runCachedAssetOperation(f.options);
    const controller = new AbortController(),
      returned = [];
    const read = f.cache.read;
    f.cache.read = async (request) => {
      const bytes = await read(request);
      returned.push(bytes);
      if (request.kind === "asset-file") controller.abort();
      return bytes;
    };
    await assert.rejects(runCachedAssetOperation({ ...f.options, signal: controller.signal }), {
      name: "AbortError",
    });
    assert.equal(f.runs(), 1);
    assert.ok(returned.every((bytes) => bytes.every((byte) => byte === 0)));
  });

  test("cancellation after fresh generation wipes results and prevents cache writes", async () => {
    const f = fixture(),
      controller = new AbortController();
    const bytes = new Uint8Array([1, 2, 3]);
    f.options.run = async () => {
      controller.abort();
      return { files: { "art.png": bytes } };
    };
    await assert.rejects(runCachedAssetOperation({ ...f.options, signal: controller.signal }), {
      name: "AbortError",
    });
    assert.deepEqual([...bytes], [0, 0, 0]);
    assert.deepEqual(f.writes, []);
  });

  test("per-file and aggregate cache budgets never enlarge normal output acceptance", async () => {
    for (const limits of [{ maxFileBytes: 2 }, { maxTotalBytes: 2 }]) {
      const f = fixture();
      await runCachedAssetOperation({ ...f.options, ...limits });
      assert.equal(f.runs(), 1);
      assert.deepEqual(f.writes, []);
    }
  });
}

// committed-download-recovery
{
  // 合成产物证明提交后清理失败可恢复下载，不构成真实浏览器证明。
  // Synthetic artifacts prove post-commit cleanup recovery, not real-browser behavior.
  const { default: test } = nodeTestModule;
  const { default: assert } = strictModule;
  const { readFile } = promisesModule;
  const { withLegacyAstcProducerLease, takeCommittedDownload } = browserPackagerModule;
  const { PackagingJobError } = packagingJobModule;
  const { createDownloadPreparation } = downloadPreparationModule;
  const { committedCleanupWarning } = packagingDiagnosticsModule;

  test("committed Blob survives cleanup error privately and URL retry never regenerates", async () => {
    const blob = new Blob(["synthetic IPA"]);
    const cleanup = new Error("private cleanup details");
    let conversions = 0,
      attempts = 0;
    let failure;
    try {
      await withLegacyAstcProducerLease(
        {
          close() {
            throw cleanup;
          },
        },
        async () => {
          conversions++;
          return { committed: true };
        },
        () => ({ blob, fileName: "unsigned.ipa" }),
      );
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof PackagingJobError);
    assert.equal(failure.cause, cleanup);
    assert.deepEqual(failure.cleanupErrors, [cleanup]);
    assert.equal(failure.report.committed, true);
    assert.doesNotMatch(JSON.stringify(failure), /blob|unsigned\.ipa|synthetic IPA/);
    const recovery = takeCommittedDownload(failure);
    assert.equal(recovery.blob, blob);
    assert.equal(takeCommittedDownload(failure), undefined);
    const preparation = createDownloadPreparation({
      createObjectURL(value) {
        assert.equal(value, blob);
        if (++attempts === 1) throw new Error("URL failed");
        return "blob:ready";
      },
      revokeObjectURL() {},
    });
    preparation.retain(recovery);
    assert.equal(preparation.prepare().status, "retryable");
    assert.equal(preparation.prepare().status, "ready");
    assert.equal(conversions, 1);
    assert.match(committedCleanupWarning(), /cleanup failed.*Save the IPA, then reload/);
    assert.doesNotMatch(committedCleanupWarning(), /No completed IPA/);
  });

  test("forged reports and precommit failures never authorize retrieval", async () => {
    const forged = new PackagingJobError(new Error("validation"), { committed: true });
    let reads = 0;
    assert.equal(takeCommittedDownload(forged), undefined);
    for (const operation of [
      async () => {
        throw forged;
      },
      async () => ({ committed: false }),
    ]) {
      await assert.rejects(
        withLegacyAstcProducerLease(
          {
            close() {
              throw new Error("cleanup");
            },
          },
          operation,
          () => {
            reads++;
            return { blob: new Blob(), fileName: "x" };
          },
        ),
        (error) => {
          assert.equal(takeCommittedDownload(error), undefined);
          return true;
        },
      );
    }
    assert.equal(reads, 0);
  });

  test("unavailable committed output preserves original cleanup cause without recovery", async () => {
    const cleanup = new Error("cleanup");
    await assert.rejects(
      withLegacyAstcProducerLease(
        {
          close() {
            throw cleanup;
          },
        },
        async () => ({ committed: true }),
        () => {
          throw new Error("not available");
        },
      ),
      (error) => {
        assert.equal(error.cause, cleanup);
        assert.equal(takeCommittedDownload(error), undefined);
        return true;
      },
    );
  });

  test("UI uses opaque recovery before generic failure wording and preserves export outcomes", async () => {
    const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
    const recovery = source.slice(
      source.indexOf("const recovered = takeCommittedDownload(error)"),
      source.indexOf("appendActivity(packagingFailureSummary(report)"),
    );
    assert.match(recovery, /retain\(recovered\)/);
    assert.match(recovery, /committedCleanupWarning\(\)/);
    assert.match(recovery, /dmWebResourcesSaved/);
    assert.match(recovery, /prepareDownload\(!originalIdentity && !jobOptions.signing\)/);
    assert.doesNotMatch(recovery, /\.generate\(/);
  });

  test("packager binds its own sink and transfers recovery when preserving export reports", async () => {
    const source = await readFile(new URL("../browser-packager.mjs", import.meta.url), "utf8");
    assert.match(source, /\(\) => output\.getDownload\(\)/);
    assert.match(
      source,
      /const recovery = takeCommittedDownload\(error\);\s*if \(recovery\) committedDownloads\.set\(reported, recovery\);\s*throw reported;/,
    );
    const { catalog } = await import("../i18n-catalog.mjs");
    assert.match(catalog.dmWebCommittedCleanupWarning[1], /清理失败.*先保存 IPA.*重新载入/);
  });
}

// local-output-cache
{
  // 仅使用合成存储，不执行浏览器、私有输入、编译器或 WASM。
  // Synthetic storage only: no browser, private input, compiler, or WASM execution.
  const { default: test } = nodeTestModule;
  const { default: assert } = strictModule;
  const { cacheKeyFor, createLocalOutputCache } = localOutputCacheModule;
  const missing = () => new DOMException("Missing", "NotFoundError");
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  function deferred() {
    let resolve;
    const promise = new Promise((done) => {
      resolve = done;
    });
    return { promise, resolve };
  }
  class Directory {
    constructor(state) {
      this.state = state;
      this.entries = new Map();
      this.kind = "directory";
    }
    async getDirectoryHandle(name, { create = false } = {}) {
      if (!this.entries.has(name)) {
        if (!create) throw missing();
        this.entries.set(name, new Directory(this.state));
      }
      const result = this.entries.get(name);
      if (result.kind !== "directory") throw new DOMException("Wrong kind", "TypeMismatchError");
      return result;
    }
    async getFileHandle(name, { create = false } = {}) {
      if (!this.entries.has(name)) {
        if (!create) throw missing();
        this.entries.set(name, new LocalFile(this.state, name));
      }
      const result = this.entries.get(name);
      if (this.state.getHandle) await this.state.getHandle({ name, create, handle: result });
      return result;
    }
    async removeEntry(name) {
      if (!this.entries.delete(name)) throw missing();
    }
  }
  class LocalFile {
    constructor(state, name) {
      this.state = state;
      this.name = name;
      this.bytes = new Uint8Array();
      this.kind = "file";
    }
    async isSameEntry(value) {
      return this === value;
    }
    async getFile() {
      const owner = this;
      return {
        size: owner.advertisedSize ?? owner.bytes.length,
        async text() {
          return new TextDecoder().decode(owner.bytes);
        },
        async arrayBuffer() {
          owner.state.reads++;
          const copy = owner.bytes.slice().buffer;
          if (owner.state.readBuffer) await owner.state.readBuffer(copy);
          return copy;
        },
      };
    }
    async createWritable() {
      const owner = this,
        chunks = [];
      let aborted = false;
      return {
        async write(bytes) {
          if (owner.state.writeFailure) throw new Error("QuotaExceeded");
          chunks.push(new Uint8Array(bytes));
        },
        async close() {
          if (owner.state.closeWait) await owner.state.closeWait();
          if (aborted) throw new Error("Aborted");
          owner.bytes = new Uint8Array(chunks.reduce((n, b) => n + b.length, 0));
          let at = 0;
          for (const bytes of chunks) {
            owner.bytes.set(bytes, at);
            at += bytes.length;
          }
        },
        async abort() {
          aborted = true;
          owner.state.aborts++;
        },
      };
    }
  }
  function fixture() {
    const state = { reads: 0, aborts: 0 },
      root = new Directory(state),
      caches = new Map();
    let locked = false;
    const environment = {
      location: { href: "https://packager.test/app/" },
      crypto,
      navigator: {
        locks: {
          async request(_name, options, callback) {
            assert.equal(options.ifAvailable, true);
            if (locked) return callback(null);
            locked = true;
            try {
              return await callback({});
            } finally {
              locked = false;
            }
          },
        },
      },
      caches: {
        async open(name) {
          if (!caches.has(name)) {
            const entries = new Map();
            caches.set(name, {
              entries,
              async keys() {
                return [...entries.keys()].map((url) => ({ url }));
              },
              async put(url, response) {
                if (state.putFailure) throw new Error("Storage failed");
                if (state.putWait) await state.putWait();
                entries.set(url, response);
              },
              async delete(url) {
                return entries.delete(url);
              },
            });
          }
          return caches.get(name);
        },
      },
    };
    const options = { directory: root, environment };
    const shaderFolder = () =>
      root.entries.get("D2R-cache").entries.get("v1").entries.get("shader");
    return { state, root, caches, environment, options, shaderFolder };
  }
  const key = "a".repeat(64);
  const value = new Uint8Array([1, 2, 3, 4]);
  const read = (cache, extra = {}) => cache.read({ kind: "shader", key, maxBytes: 16, ...extra });
  const write = (cache, extra = {}) => cache.write({ kind: "shader", key, bytes: value, ...extra });

  test("visible cache starts with a fresh ledger and leaves older hidden caches untouched", async () => {
    const f = fixture();
    const previous = await createLocalOutputCache(f.options);
    assert.equal(await write(previous), true);
    previous.close();
    await tick();
    const hidden = f.root.entries.get("D2R-cache");
    const oldMarker = hidden.entries.get("v1").entries.get("cache.json").bytes.slice();
    const oldLedger = [...f.caches.values()][0];
    const oldEntries = [...oldLedger.entries];
    f.root.entries.set(".d2r-cache", hidden);
    f.root.entries.delete("D2R-cache");
    const getDirectory = f.root.getDirectoryHandle.bind(f.root);
    f.root.getDirectoryHandle = (name, options) => {
      assert.notEqual(name, ".d2r-cache", "never probe or migrate the old hidden folder");
      return getDirectory(name, options);
    };
    const cache = await createLocalOutputCache(f.options);
    assert.equal(await read(cache), null);
    assert.equal(f.caches.size, 2);
    assert.notEqual(f.root.entries.get("D2R-cache"), hidden);
    assert.equal(await write(cache), true);
    assert.deepEqual(await read(cache), value);
    assert.equal(f.root.entries.get(".d2r-cache"), hidden);
    assert.deepEqual(hidden.entries.get("v1").entries.get("cache.json").bytes, oldMarker);
    assert.deepEqual([...oldLedger.entries], oldEntries);
    cache.close();
  });

  test("canonical key order, complete inputs, and bounded metadata", async () => {
    assert.equal(
      await cacheKeyFor({ b: [1, true], a: "source" }),
      await cacheKeyFor({ a: "source", b: [1, true] }),
    );
    assert.notEqual(await cacheKeyFor({ source: "a" }), await cacheKeyFor({ source: "b" }));
    await assert.rejects(cacheKeyFor({ value: undefined }));
    await assert.rejects(cacheKeyFor(new Array(2)));
    await assert.rejects(cacheKeyFor(Array(8).fill("x".repeat(1024 * 1024))), /LIMIT/);
    await assert.rejects(cacheKeyFor({ ["k".repeat(1024 * 1024 + 1)]: true }), /LIMIT/);
  });
  test("cold miss, accepted write, warm independently checked owned snapshot", async () => {
    const f = fixture();
    let cache = await createLocalOutputCache(f.options);
    assert.equal(await read(cache), null);
    assert.equal(await write(cache), true);
    const first = await read(cache);
    assert.deepEqual(first, value);
    first.fill(0);
    cache.close();
    await tick();
    cache = await createLocalOutputCache(f.options);
    assert.deepEqual(await read(cache), value);
    assert.equal([...f.caches.values()][0].entries.size, 1);
    cache.close();
  });
  test("folder bytes and neighboring receipts cannot enroll themselves in missing ledger", async () => {
    const f = fixture();
    let cache = await createLocalOutputCache(f.options);
    await write(cache);
    cache.close();
    await tick();
    f.caches.clear();
    const forged = await f.shaderFolder().getFileHandle("receipt.json", { create: true });
    forged.bytes = new TextEncoder().encode(JSON.stringify({ outputSha256: "b".repeat(64) }));
    cache = await createLocalOutputCache(f.options);
    assert.equal(await read(cache), null);
    cache.close();
  });
  test("tampering and oversized advertised file are misses, never unbounded reads", async () => {
    const f = fixture(),
      cache = await createLocalOutputCache(f.options);
    await write(cache);
    const file = [...f.shaderFolder().entries.values()][0];
    file.bytes = new Uint8Array([9, 9, 9, 9]);
    assert.equal(await read(cache), null);
    const before = f.state.reads;
    file.advertisedSize = 10 ** 9;
    assert.equal(await read(cache), null);
    assert.equal(f.state.reads, before);
    cache.close();
  });
  test("ignore bypasses reuse, fresh outputs can refresh, mutated old leaf preserved", async () => {
    const f = fixture();
    let cache = await createLocalOutputCache(f.options);
    await write(cache);
    cache.close();
    await tick();
    const old = [...f.shaderFolder().entries.values()][0];
    old.bytes = new Uint8Array([8, 8, 8, 8]);
    cache = await createLocalOutputCache({ ...f.options, ignoreCache: true });
    const reads = f.state.reads;
    assert.equal(await read(cache), null);
    assert.equal(f.state.reads, reads);
    assert.equal(await write(cache, { bytes: new Uint8Array([5]) }), true);
    assert.ok([...f.shaderFolder().entries.values()].includes(old));
    cache.close();
    await tick();
    cache = await createLocalOutputCache(f.options);
    assert.deepEqual(await read(cache), new Uint8Array([5]));
    cache.close();
  });
  test("readwrite failure warns once, removes owned incomplete file, and stays optional", async () => {
    const f = fixture(),
      warnings = [];
    const cache = await createLocalOutputCache({
      ...f.options,
      onWarning: (event) => warnings.push(event),
    });
    f.state.writeFailure = true;
    assert.equal(await write(cache), false);
    assert.equal(await write(cache), false);
    assert.equal(await read(cache), null);
    assert.equal(f.shaderFolder().entries.size, 0);
    assert.deepEqual(warnings, [{ phase: "cache", status: "unavailable" }]);
    assert.equal([...f.caches.values()][0].entries.size, 0);
    cache.close();
  });
  test("ledger completion failure cannot authorize or leave the incomplete output", async () => {
    const f = fixture(),
      cache = await createLocalOutputCache(f.options);
    f.state.putFailure = true;
    assert.equal(await write(cache), false);
    assert.equal(f.shaderFolder().entries.size, 0);
    assert.equal([...f.caches.values()][0].entries.size, 0);
    cache.close();
  });
  test("origin lock conflict does not wait or mutate another generation's cache", async () => {
    const f = fixture(),
      first = await createLocalOutputCache(f.options);
    const second = await createLocalOutputCache(f.options);
    assert.equal(await write(second), false);
    assert.equal(await write(first), true);
    second.close();
    first.close();
    await tick();
    const third = await createLocalOutputCache(f.options);
    assert.deepEqual(await read(third), value);
    third.close();
  });
  test("one instance never runs two cache writes concurrently", async () => {
    const f = fixture(),
      cache = await createLocalOutputCache(f.options);
    const results = await Promise.all([write(cache), write(cache, { key: "b".repeat(64) })]);
    assert.deepEqual(results, [true, false]);
    assert.equal([...f.caches.values()][0].entries.size, 1);
    cache.close();
  });
  test("cancelled late cache read promptly rejects and wipes its late snapshot", async () => {
    const f = fixture(),
      cache = await createLocalOutputCache(f.options);
    await write(cache);
    const wait = deferred(),
      entered = deferred(),
      controller = new AbortController();
    let late;
    f.state.readBuffer = async (bytes) => {
      late = bytes;
      entered.resolve();
      await wait.promise;
    };
    const pending = read(cache, { signal: controller.signal });
    await entered.promise;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    wait.resolve();
    await tick();
    assert.deepEqual(new Uint8Array(late), new Uint8Array(value.length));
    cache.close();
  });
  test("late created output handles are cleaned after cancellation, never committed", async () => {
    const f = fixture(),
      cache = await createLocalOutputCache(f.options);
    const wait = deferred(),
      entered = deferred(),
      controller = new AbortController();
    f.state.getHandle = async ({ name, create }) => {
      if (create && name.endsWith(".bin")) {
        entered.resolve();
        await wait.promise;
      }
    };
    const pending = write(cache, { signal: controller.signal });
    await entered.promise;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    wait.resolve();
    await tick();
    await tick();
    assert.equal(f.shaderFolder().entries.size, 0);
    assert.equal([...f.caches.values()][0].entries.size, 0);
    cache.close();
  });
  test("late empty marker creation is cleaned and a subsequent attempt remains usable", async () => {
    const f = fixture(),
      wait = deferred(),
      entered = deferred(),
      controller = new AbortController();
    f.state.getHandle = async ({ name, create }) => {
      if (create && name === "cache.json") {
        entered.resolve();
        await wait.promise;
      }
    };
    const pending = createLocalOutputCache({ ...f.options, signal: controller.signal });
    await entered.promise;
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    wait.resolve();
    await tick();
    await tick();
    f.state.getHandle = undefined;
    const cache = await createLocalOutputCache(f.options);
    assert.equal(await write(cache), true);
    cache.close();
  });
  test("hung optional storage times out and abandoned completion is not reused", async () => {
    const f = fixture(),
      cache = await createLocalOutputCache({ ...f.options, timeoutMs: 100 });
    const wait = deferred();
    f.state.putWait = () => wait.promise;
    assert.equal(await write(cache), false);
    assert.equal(f.shaderFolder().entries.size, 0);
    wait.resolve();
    await tick();
    await tick();
    assert.equal([...f.caches.values()][0].entries.size, 0);
    assert.equal(await read(cache), null);
    cache.close();
  });
  test("unavailable browser storage and malformed foreign marker never block or get deleted", async () => {
    const f = fixture();
    const root = await f.root.getDirectoryHandle("D2R-cache", { create: true });
    const folder = await root.getDirectoryHandle("v1", { create: true });
    const marker = await folder.getFileHandle("cache.json", { create: true });
    marker.bytes = new TextEncoder().encode("not our marker");
    const cache = await createLocalOutputCache(f.options);
    assert.equal(await write(cache), false);
    assert.equal(new TextDecoder().decode(marker.bytes), "not our marker");
    cache.close();
  });

  test("close cancels a pending ledger commit and holds lock through its late outcome", async () => {
    const f = fixture(),
      cache = await createLocalOutputCache(f.options);
    const wait = deferred(),
      entered = deferred();
    f.state.putWait = () => {
      entered.resolve();
      return wait.promise;
    };
    const pending = write(cache);
    await entered.promise;
    cache.close();
    assert.equal(await pending, false);
    const second = await createLocalOutputCache(f.options);
    assert.equal(await write(second), false);
    second.close();
    wait.resolve();
    await tick();
    await tick();
    f.state.putWait = undefined;
    const third = await createLocalOutputCache(f.options);
    assert.equal(await read(third), null);
    assert.equal(await write(third), true);
    third.close();
  });
  test("closed cache cannot start later leaf creation after a suspended directory lookup", async () => {
    const f = fixture(),
      cache = await createLocalOutputCache(f.options);
    const folder = f.root.entries.get("D2R-cache").entries.get("v1");
    const original = folder.getDirectoryHandle.bind(folder),
      wait = deferred(),
      entered = deferred();
    folder.getDirectoryHandle = async (...args) => {
      entered.resolve();
      await wait.promise;
      return original(...args);
    };
    const pending = write(cache);
    await entered.promise;
    cache.close();
    assert.equal(await pending, false);
    wait.resolve();
    await tick();
    await tick();
    assert.equal(f.shaderFolder().entries.size, 0);
  });
}

// opfs-storage-advisory
{
  // 只使用存储估算替身；不访问真实存储或改变权限。
  // Storage-estimate doubles only; no real storage access or permission changes.
  const { default: assert } = strictModule;
  const { default: test } = nodeTestModule;
  const { readOpfsStorageAdvisory } = opfsStorageAdvisoryModule;
  const storage = (value) => ({ estimate: async () => value });
  test("reports origin estimate and compares only explicit known staging requirements", async () => {
    const options = { storage: storage({ quota: 1000, usage: 300 }) };
    const unknown = await readOpfsStorageAdvisory(options);
    assert.deepEqual(unknown, {
      status: "estimated",
      quotaBytes: 1000,
      usageBytes: 300,
      availableBytes: 700,
      requiredBytes: null,
      sufficiency: "unknown",
      advisoryOnly: true,
    });
    assert.ok(Object.isFrozen(unknown));
    assert.equal(
      (await readOpfsStorageAdvisory({ ...options, requiredBytes: 700 })).sufficiency,
      "estimated-sufficient",
    );
    assert.equal(
      (await readOpfsStorageAdvisory({ ...options, requiredBytes: 701 })).sufficiency,
      "estimated-insufficient",
    );
    assert.equal(
      (await readOpfsStorageAdvisory({ ...options, requiredBytes: 0 })).sufficiency,
      "estimated-sufficient",
    );
    const over = await readOpfsStorageAdvisory({
      storage: storage({ quota: 10, usage: 12 }),
      requiredBytes: 1,
    });
    assert.equal(over.availableBytes, 0);
    assert.equal(over.sufficiency, "estimated-insufficient");
  });
  test("missing, throwing or rejected APIs are advisory unavailable, never a normal-mode gate", async () => {
    for (const candidate of [
      null,
      {},
      { estimate: 1 },
      {
        get estimate() {
          throw new Error("unavailable");
        },
      },
      {
        estimate() {
          throw new Error("unavailable");
        },
      },
      {
        estimate() {
          return Promise.reject(new Error("unavailable"));
        },
      },
    ]) {
      const result = await readOpfsStorageAdvisory({ storage: candidate, requiredBytes: 100 });
      assert.equal(result.status, "unavailable");
      assert.equal(result.availableBytes, null);
      assert.equal(result.sufficiency, "unknown");
    }
  });
  test("missing and unsafe numeric estimates stay unknown without coercion", async () => {
    for (const value of [
      null,
      {},
      { quota: 100 },
      { quota: 100, usage: undefined },
      ...[-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1, "100", 100n].flatMap((n) => [
        { quota: n, usage: 0 },
        { quota: 100, usage: n },
      ]),
      {
        get quota() {
          throw new Error("bad getter");
        },
        usage: 0,
      },
    ]) {
      const result = await readOpfsStorageAdvisory({ storage: storage(value) });
      assert.equal(result.status, "invalid");
      assert.equal(result.availableBytes, null);
      assert.equal(result.sufficiency, "unknown");
    }
  });
  test("timeout returns promptly and late rejected estimates remain observed", async () => {
    let reject;
    const result = await readOpfsStorageAdvisory({
      storage: {
        estimate: () =>
          new Promise((_, r) => {
            reject = r;
          }),
      },
      timeoutMs: 5,
    });
    assert.equal(result.status, "timeout");
    assert.equal(result.availableBytes, null);
    reject(new Error("late failure"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  test("pre-cancel avoids estimation; pending cancellation returns unknown without hanging", async () => {
    const controller = new AbortController();
    controller.abort();
    let calls = 0;
    assert.equal(
      (
        await readOpfsStorageAdvisory({
          storage: {
            estimate() {
              calls++;
            },
          },
          signal: controller.signal,
        })
      ).status,
      "cancelled",
    );
    assert.equal(calls, 0);
    const active = new AbortController(),
      pending = readOpfsStorageAdvisory({
        storage: { estimate: () => new Promise(() => {}) },
        signal: active.signal,
      });
    await Promise.resolve();
    active.abort();
    assert.equal((await pending).status, "cancelled");
  });
  test("only estimate is invoked and option limits reject configuration mistakes", async () => {
    const candidate = {
      estimate() {
        assert.equal(this, candidate);
        return { quota: 100, usage: 0 };
      },
      persist() {
        assert.fail("must not request persistence");
      },
      getDirectory() {
        assert.fail("must not inspect files");
      },
    };
    await readOpfsStorageAdvisory({ storage: candidate });
    for (const options of [
      { requiredBytes: -1 },
      { requiredBytes: Infinity },
      { requiredBytes: 1.1 },
      { timeoutMs: 0 },
      { timeoutMs: 30001 },
      { signal: {} },
    ])
      await assert.rejects(readOpfsStorageAdvisory({ storage: candidate, ...options }), /options/);
  });
}

// shader-output-cache
{
  // 只使用模块模拟及合成字节，不执行编译器或私有输入。
  // Only module mocks and synthetic bytes. No compiler or private inputs execute.
  const { default: test } = nodeTestModule;
  const { default: assert } = strictModule;
  const { spawnSync } = nodeChild_processModule;
  const { assertIsolatedRun } = assertIsolatedRunModule;
  test("production shader reuse preserves identity, validation, source proof and cancellation", () => {
    const result = spawnSync(
      process.execPath,
      ["--experimental-test-module-mocks", "tests/fixtures/shader-output-cache.mock.mjs"],
      {
        cwd: new URL("../", import.meta.url),
        encoding: "utf8",
        timeout: 60000,
      },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });

  test("bounded production shader concurrency preserves ownership, cache and deterministic proof-first output", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--test",
        "--test-reporter=tap",
        new URL("./fixtures/production-shader-concurrency.mock.mjs", import.meta.url).pathname,
      ],
      { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    assertIsolatedRun(result);
  });
}
