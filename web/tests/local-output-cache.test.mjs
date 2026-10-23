// Synthetic storage only: no browser, private input, compiler, or WASM execution.
import test from "node:test";
import assert from "node:assert/strict";
import { cacheKeyFor, createLocalOutputCache } from "../local-output-cache.mjs";
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
  const shaderFolder = () => root.entries.get(".d2r-cache").entries.get("v1").entries.get("shader");
  return { state, root, caches, environment, options, shaderFolder };
}
const key = "a".repeat(64);
const value = new Uint8Array([1, 2, 3, 4]);
const read = (cache, extra = {}) => cache.read({ kind: "shader", key, maxBytes: 16, ...extra });
const write = (cache, extra = {}) => cache.write({ kind: "shader", key, bytes: value, ...extra });

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
  const root = await f.root.getDirectoryHandle(".d2r-cache", { create: true });
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
  const folder = f.root.entries.get(".d2r-cache").entries.get("v1");
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
