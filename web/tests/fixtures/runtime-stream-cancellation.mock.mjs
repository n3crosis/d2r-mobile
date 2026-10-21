// 用合成公开载荷及原生 Web Streams 验证读取清理和取消，不宣称浏览器内存或真实编译器证明。
// Verify read cleanup/cancellation with synthetic public payloads and native Web Streams, not browser RAM or actual compiler proof.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getEventListeners } from "node:events";
import { gzipSync } from "node:zlib";
const encode = (text) => new TextEncoder().encode(text);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const shell = encode("synthetic pinned shell");
const profile = {
  id: "synthetic-profile",
  archivePath: "profile/shell.zip",
  evidence: { archiveBytes: shell.length, sha256: sha(shell) },
};
mock.module("../../shell-profiles.mjs", {
  namedExports: { SHELL_PROFILE_IDS: [profile.id], resolveShellProfile: () => profile },
});
globalThis.isSecureContext = true;
globalThis.location = { href: "https://example.test/", origin: "https://example.test" };
Object.defineProperty(globalThis, "navigator", { value: {}, configurable: true });
const ResponseClass = Response;
let serial = 0;
async function setup(t, { cacheMode, gzip = false, manifestResponse } = {}) {
  const controller = new AbortController();
  const state = {
    timers: new Map(),
    responses: [],
    streams: [],
    cacheRequests: [],
    cancels: 0,
    deletes: 0,
    puts: 0,
    hashes: 0,
    fetches: [],
    workers: [],
    progress: [],
    ready: Promise.withResolvers(),
  };
  let timerId = 0;
  t.mock.method(globalThis, "setTimeout", (callback, delay) => {
    const id = ++timerId;
    state.timers.set(id, { callback, delay });
    return id;
  });
  t.mock.method(globalThis, "clearTimeout", (id) => state.timers.delete(id));
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  t.mock.method(crypto.subtle, "digest", (...args) => {
    state.hashes++;
    return digest(...args);
  });
  const data = new Map([
    [profile.archivePath, shell],
    ["sealed-workers/program-worker.mjs", encode("synthetic public worker")],
    [
      "toolchain/program-rewrite-spike/dist/capstone-lz4.wasm",
      gzip ? new Uint8Array(4 * 1024 * 1024).fill(42) : encode("synthetic public WASM"),
    ],
  ]);
  const assets = [...data].map(([path, bytes]) => ({
    path,
    bytes: bytes.length,
    sha256: sha(bytes),
  }));
  const inventory = { version: 1, assets, totalBytes: assets.reduce((sum, a) => sum + a.bytes, 0) };
  if (gzip) {
    const decoded = Buffer.concat([...data.values()]);
    const wire = gzipSync(decoded);
    const file = "payloads/synthetic.gz";
    let offset = 0;
    inventory.transport = {
      version: 1,
      totalBytes: wire.length,
      files: [
        {
          path: file,
          bytes: wire.length,
          sha256: sha(wire),
          encoding: "gzip",
          decodedBytes: decoded.length,
        },
      ],
      entries: assets.map((asset) => {
        const entry = { sha256: asset.sha256, bytes: asset.bytes, file, offset };
        offset += asset.bytes;
        return entry;
      }),
    };
    data.set(file, wire);
  }
  const manifest = encode(JSON.stringify(inventory));
  const cacheData = new Map(
    assets.map((a) => [
      `https://example.test/runtime/__public-runtime-cache__/${a.sha256}-${a.bytes}`,
      data.get(a.path),
    ]),
  );
  const makeCachedResponse = (key) => {
    const response = new ResponseClass(
      new ReadableStream({
        start(control) {
          state.streams.push({ control, bytes: cacheData.get(key) });
        },
        cancel() {
          state.cancels++;
        },
      }),
    );
    state.responses.push(response);
    return response;
  };
  globalThis.caches = {
    async open() {
      if (!cacheMode) throw new Error("Synthetic cache unavailable");
      return {
        async match(key) {
          const pending = Promise.withResolvers();
          state.cacheRequests.push({ key, pending });
          if (state.cacheRequests.length === assets.length) state.ready.resolve();
          return cacheMode === "late-match" ? pending.promise : makeCachedResponse(key);
        },
        async put() {
          state.puts++;
        },
        async delete() {
          state.deletes++;
        },
        async keys() {
          return [];
        },
      };
    },
  };
  t.mock.method(globalThis, "fetch", async (url) => {
    const path = new URL(url).pathname.slice("/runtime/".length);
    state.fetches.push(path);
    if (path === "runtime-manifest.json") return manifestResponse ?? new ResponseClass(manifest);
    assert.ok(data.has(path));
    return new ResponseClass(data.get(path));
  });
  globalThis.Worker = class {
    constructor() {
      state.workers.push(this);
    }
    postMessage(message, transfers) {
      structuredClone(message, { transfer: transfers });
      queueMicrotask(() =>
        this.onmessage({ data: { id: 0, ok: true, result: { initialized: true } } }),
      );
    }
    terminate() {
      this.terminated = true;
    }
  };
  const { prepareSealedRuntime } = await import(
    `../../sealed-runtime/clients.mjs?stream=${serial++}`
  );
  let runtime;
  t.after(async () => {
    await runtime?.close();
  });
  return {
    state,
    controller,
    async start() {
      runtime = await prepareSealedRuntime({
        baseUrl: "https://example.test/runtime/",
        manifestSha256: sha(manifest),
        components: ["program"],
        signal: controller.signal,
        onProgress: (event) => state.progress.push(event),
      });
      return runtime;
    },
    expireCacheReads() {
      const timeouts = [...state.timers].filter(([, timer]) => timer.delay === 3000);
      assert.equal(timeouts.length, 3);
      for (const [id, timer] of timeouts) {
        state.timers.delete(id);
        timer.callback();
      }
    },
    releaseLateMatches() {
      for (const { key, pending } of state.cacheRequests) pending.resolve(makeCachedResponse(key));
    },
    releaseBodies() {
      for (const { control, bytes } of state.streams) {
        try {
          control.enqueue(bytes);
          control.close();
        } catch {
          /* 已取消的流保持关闭。 | Cancelled streams remain closed. */
        }
      }
    },
  };
}
const flush = async () => {
  await new Promise(setImmediate);
};

test("cache read timeout cancels stalled bodies before successful network fallback", async (t) => {
  const { state, start, expireCacheReads, releaseBodies } = await setup(t, { cacheMode: "body" });
  const pending = start();
  await state.ready.promise;
  await flush();
  expireCacheReads();
  const runtime = await pending;
  try {
    assert.equal(state.cancels, 3);
    assert.ok(state.responses.every((response) => !response.body.locked));
    assert.equal(state.fetches.length, 4);
    assert.equal(state.puts, 0);
    assert.equal(state.deletes, 0);
    const hashes = state.hashes;
    await runtime.close();
    releaseBodies();
    await flush();
    assert.equal(state.hashes, hashes, "abandoned cache bodies never start late hashes");
    assert.equal(state.timers.size, 0);
  } finally {
    releaseBodies();
  }
});

test("responses arriving after cache timeout are cancelled without hashing or eviction", async (t) => {
  const { state, start, expireCacheReads, releaseLateMatches, releaseBodies } = await setup(t, {
    cacheMode: "late-match",
  });
  const pending = start();
  await state.ready.promise;
  expireCacheReads();
  const runtime = await pending;
  const hashes = state.hashes;
  await runtime.close();
  releaseLateMatches();
  await flush();
  try {
    assert.equal(state.cancels, 3);
    assert.ok(state.responses.every((response) => !response.body.locked));
    assert.equal(state.hashes, hashes);
    assert.equal(state.deletes, 0);
  } finally {
    releaseBodies();
  }
});

test("outer cancellation stops cached bodies immediately without waiting for storage timeout", async (t) => {
  const { state, start, controller, releaseBodies } = await setup(t, { cacheMode: "body" });
  const pending = start();
  const checked = assert.rejects(pending, /synthetic cancellation/);
  await state.ready.promise;
  await flush();
  const progress = state.progress.length;
  controller.abort(new Error("synthetic cancellation"));
  try {
    await checked;
    assert.equal(state.cancels, 3);
    assert.ok(state.responses.every((response) => !response.body.locked));
    assert.deepEqual(state.fetches, ["runtime-manifest.json"]);
    assert.equal(state.hashes, 1);
    assert.equal(state.deletes, 0);
    assert.equal(state.progress.length, progress);
    assert.equal(state.timers.size, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  } finally {
    releaseBodies();
  }
});

for (const cleanup of ["reject", "pending"])
  test(`manifest cap error survives ${cleanup} stream cancellation without waiting`, async (t) => {
    let cancels = 0;
    const stream = new ReadableStream({
      start(control) {
        control.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      },
      cancel() {
        cancels++;
        return cleanup === "reject"
          ? Promise.reject(new Error("cleanup failed"))
          : new Promise(() => {});
      },
    });
    const { state, start, controller } = await setup(t, {
      manifestResponse: new ResponseClass(stream),
    });
    await assert.rejects(start(), /^Error: Public runtime byte cap$/);
    assert.equal(cancels, 1);
    assert.equal(stream.locked, false);
    assert.equal(state.hashes, 0);
    assert.equal(state.timers.size, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });

test("synchronous cancellation and release errors cannot replace the primary read error", async (t) => {
  const primary = new Error("synthetic read failure");
  const { start } = await setup(t, {
    manifestResponse: {
      ok: true,
      body: {
        getReader: () => ({
          read: () => Promise.reject(primary),
          cancel() {
            throw new Error("synthetic cancel failure");
          },
          releaseLock() {
            throw new Error("synthetic release failure");
          },
        }),
      },
    },
  });
  await assert.rejects(start(), (error) => error === primary);
});

test("gzip cancellation stops decoded reads before logical hashes or worker initialization", async (t) => {
  const { state, start, controller } = await setup(t, { gzip: true });
  let decodedReads = 0,
    cancels = 0,
    body;
  t.mock.method(
    globalThis,
    "Response",
    class extends ResponseClass {
      constructor(stream) {
        super(stream);
        body = this.body;
        const getReader = body.getReader.bind(body);
        body.getReader = () => {
          const reader = getReader();
          const read = reader.read.bind(reader),
            cancel = reader.cancel.bind(reader);
          reader.read = async () => {
            const result = await read();
            if (!result.done) {
              decodedReads++;
              controller.abort(new Error("synthetic gzip cancellation"));
            }
            return result;
          };
          reader.cancel = () => {
            cancels++;
            return cancel();
          };
          return reader;
        };
      }
    },
  );
  await assert.rejects(start(), /synthetic gzip cancellation/);
  assert.equal(decodedReads, 1);
  assert.equal(cancels, 1);
  assert.equal(body.locked, false);
  assert.equal(state.hashes, 2, "only manifest and compressed transport were hashed");
  assert.equal(state.workers.length, 0);
  assert.equal(state.timers.size, 0);
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("normal gzip decoding retains size and integrity validation", async (t) => {
  const { state, start } = await setup(t, { gzip: true });
  const runtime = await start();
  assert.equal(runtime.readPublicAsset(profile.archivePath).length, shell.length);
  assert.equal(state.hashes, 5);
  assert.equal(state.workers.length, 1);
  await runtime.close();
  assert.equal(state.timers.size, 0);
});

for (const cleanup of ["resolve", "reject", "pending", "throw"])
  test(`non-OK public response cancels its unread body with ${cleanup} cleanup`, async (t) => {
    let cancels = 0,
      pulls = 0,
      readers = 0;
    const stream = new ReadableStream(
      {
        pull() {
          pulls++;
        },
        cancel() {
          cancels++;
          if (cleanup === "reject") return Promise.reject(new Error("synthetic cleanup failure"));
          if (cleanup === "pending") return new Promise(() => {});
        },
      },
      { highWaterMark: 0 },
    );
    if (cleanup === "throw")
      t.mock.method(stream, "cancel", () => {
        cancels++;
        throw new Error("synthetic synchronous cleanup failure");
      });
    t.mock.method(stream, "getReader", () => {
      readers++;
      throw new Error("Rejected response must not be read");
    });
    const { state, start, controller } = await setup(t, {
      manifestResponse: new ResponseClass(stream, { status: 503 }),
    });
    await assert.rejects(start(), /^Error: Missing public runtime asset$/);
    assert.equal(cancels, 1);
    assert.equal(pulls, 0);
    assert.equal(readers, 0);
    assert.equal(stream.locked, false);
    assert.equal(state.hashes, 0);
    assert.equal(state.workers.length, 0);
    assert.equal(state.timers.size, 0);
    assert.equal(getEventListeners(controller.signal, "abort").length, 0);
  });

test("missing public response body preserves the existing rejection", async (t) => {
  const { state, start } = await setup(t, {
    manifestResponse: new ResponseClass(null, { status: 503 }),
  });
  await assert.rejects(start(), /^Error: Missing public runtime asset$/);
  assert.equal(state.hashes, 0);
  assert.equal(state.timers.size, 0);
});
