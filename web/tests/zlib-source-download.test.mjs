// 合成网络响应验证公开源码下载；不访问网络或改动已有缓存。
// Synthetic responses test public-source downloads without network access or cache mutation.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { downloadPinnedZlib } from "../toolchain/png-codec-exact/source-download.mjs";
const raw = new Uint8Array([1, 2, 3, 4]);
const pin = {
  url: "https://example.invalid/pinned.tar.gz",
  bytes: raw.length,
  sha256: createHash("sha256").update(raw).digest("hex"),
};

function run(responses) {
  const calls = [],
    sleeps = [];
  return {
    calls,
    sleeps,
    promise: downloadPinnedZlib(pin, {
      fetch: async (url, options) => {
        calls.push({ url, options });
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    }),
  };
}

test("connection timeout and transient HTTP retry the same pinned URL", async () => {
  let cancelled = false;
  const busy = new Response(
    new ReadableStream({
      cancel() {
        cancelled = true;
      },
    }),
    { status: 503 },
  );
  const f = run([
    new TypeError("fetch failed", { cause: { code: "UND_ERR_CONNECT_TIMEOUT" } }),
    busy,
    new Response(raw),
  ]);
  assert.deepEqual(await f.promise, raw);
  assert.deepEqual(f.sleeps, [1000, 2000]);
  assert.equal(cancelled, true);
  assert.equal(f.calls.length, 3);
  for (const call of f.calls) {
    assert.equal(call.url, pin.url);
    assert.ok(call.options.signal instanceof AbortSignal);
  }
});

test("partial transport failure discards bytes before a fresh verified attempt", async () => {
  let reads = 0;
  const broken = new Response(
    new ReadableStream({
      pull(controller) {
        if (reads++ === 0) controller.enqueue(new Uint8Array([99]));
        else controller.error(new TypeError("terminated"));
      },
    }),
  );
  const f = run([broken, new Response(raw)]);
  assert.deepEqual(await f.promise, raw);
  assert.equal(f.calls.length, 2);
});

test("retries stop after three transient failures", async () => {
  const f = run(Array.from({ length: 3 }, () => new DOMException("timeout", "TimeoutError")));
  await assert.rejects(f.promise, { name: "TimeoutError" });
  assert.equal(f.calls.length, 3);
  assert.deepEqual(f.sleeps, [1000, 2000]);
});

test("HTTP denial and size or hash mismatch never retry", async () => {
  for (const response of [
    new Response(null, { status: 404 }),
    new Response(raw.slice(1)),
    new Response(new Uint8Array([1, 2, 3, 5])),
    new Response(new Uint8Array(5)),
  ]) {
    const f = run([response]);
    await assert.rejects(f.promise, /zlib source fetch 404|Pinned zlib source mismatch/);
    assert.equal(f.calls.length, 1);
    assert.deepEqual(f.sleeps, []);
  }
});

test("oversized streamed response is cancelled without reading the remaining body", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new Uint8Array(5));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  await assert.rejects(run([response]).promise, /Pinned zlib source mismatch/);
  assert.equal(cancelled, true);
});
