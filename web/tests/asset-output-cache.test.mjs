import assert from "node:assert/strict";
import test from "node:test";
import { runCachedAssetOperation } from "../asset-output-cache.mjs";

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
