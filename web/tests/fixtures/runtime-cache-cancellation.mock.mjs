// 使用延迟的合成缓存与哈希验证取消边界，不读取私有输入或执行真实工作线程。
// Check cancellation boundaries with delayed synthetic cache/hash results, without private inputs or actual workers.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

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
let serial = 0;

async function setup(
  t,
  { hits = false, delayMatch = false, delayHash = false, delayPut = false } = {},
) {
  const controller = new AbortController();
  const data = new Map([
    [profile.archivePath, shell],
    ["sealed-workers/program-worker.mjs", encode("synthetic public worker")],
    ["toolchain/program-rewrite-spike/dist/capstone-lz4.wasm", encode("synthetic public wasm")],
  ]);
  const assets = [...data].map(([path, bytes]) => ({
    path,
    bytes: bytes.length,
    sha256: sha(bytes),
  }));
  const manifest = encode(
    JSON.stringify({
      version: 1,
      assets,
      totalBytes: assets.reduce((sum, item) => sum + item.bytes, 0),
    }),
  );
  const byKey = new Map(
    assets.map((asset) => [
      `https://example.test/runtime/__public-runtime-cache__/${asset.sha256}-${asset.bytes}`,
      data.get(asset.path),
    ]),
  );
  const state = { fetches: [], puts: [], deletes: [], progress: [], workers: 0, finishedPuts: 0 };
  const ready = Promise.withResolvers(),
    release = Promise.withResolvers();
  const pending = [];
  let waiting = 0;
  async function delay() {
    if (++waiting === assets.length) ready.resolve();
    await release.promise;
  }
  function delayedResult(operation) {
    const result = delay().then(operation);
    pending.push(result);
    return result;
  }
  let clock = 0;
  t.mock.method(performance, "now", () => (clock += 101));
  globalThis.Worker = class {
    constructor() {
      state.workers++;
      throw new Error("Unexpected worker after cancellation");
    }
  };
  globalThis.fetch = async (url) => {
    const path = new URL(url).pathname.slice("/runtime/".length);
    state.fetches.push(path);
    return new Response(path === "runtime-manifest.json" ? manifest : data.get(path));
  };
  globalThis.caches = {
    async open() {
      return {
        async match(key) {
          if (delayMatch)
            return delayedResult(() => (hits ? new Response(byKey.get(key)) : undefined));
          return hits ? new Response(byKey.get(key)) : undefined;
        },
        async put(key, response) {
          state.puts.push(key);
          assert.equal(
            sha(new Uint8Array(await response.arrayBuffer())),
            key.split("/").at(-1).split("-")[0],
          );
          if (delayPut) await delayedResult(() => undefined);
          state.finishedPuts++;
        },
        async delete(key) {
          state.deletes.push(key);
        },
        async keys() {
          return [];
        },
      };
    },
  };
  if (delayHash) {
    const digest = crypto.subtle.digest.bind(crypto.subtle);
    let calls = 0;
    t.mock.method(crypto.subtle, "digest", async (...args) => {
      if (++calls > 1) return delayedResult(() => digest(...args));
      return digest(...args);
    });
  }
  const { prepareSealedRuntime } = await import(
    `../../sealed-runtime/clients.mjs?cache-cancel=${serial++}`
  );
  const running = prepareSealedRuntime({
    baseUrl: "https://example.test/runtime/",
    manifestSha256: sha(manifest),
    components: ["program"],
    signal: controller.signal,
    onProgress: (progress) => state.progress.push(progress),
  });
  const cancelled = assert.rejects(running, /synthetic cancellation/);
  await ready.promise;
  controller.abort(new Error("synthetic cancellation"));
  const progressAtAbort = state.progress.length;
  release.resolve();
  await cancelled;
  await Promise.allSettled(pending);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(state.progress.length, progressAtAbort);
  assert.equal(state.workers, 0);
  assert.deepEqual(state.deletes, []);
  return state;
}

test("delayed cached responses cannot retain bytes or report progress after cancellation", async (t) => {
  const state = await setup(t, { hits: true, delayMatch: true });
  assert.deepEqual(state.fetches, ["runtime-manifest.json"]);
  assert.deepEqual(state.puts, []);
});
test("delayed cached hashes do not delete valid entries or report cancelled progress", async (t) => {
  const state = await setup(t, { hits: true, delayHash: true });
  assert.deepEqual(state.fetches, ["runtime-manifest.json"]);
  assert.deepEqual(state.puts, []);
});
test("delayed downloaded hashes cannot start cache writes after cancellation", async (t) => {
  const state = await setup(t, { delayHash: true });
  assert.equal(state.fetches.length, 4);
  assert.deepEqual(state.puts, []);
});
test("already-started verified cache writes may finish without rollback or progress", async (t) => {
  const state = await setup(t, { delayPut: true });
  assert.equal(state.puts.length, 3);
  assert.equal(state.finishedPuts, 3);
});
