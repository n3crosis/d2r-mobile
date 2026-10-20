// 仅使用合成字节测试预算、分块和生命周期；不构成游戏或浏览器内存测量。
// Synthetic bytes test budgets, chunking and lifetimes, not game validation or browser memory measurement.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createShaderOutputBudget,
  shaderOutputChunks,
  createShaderSourceCache,
} from "../production-shaders.mjs";
const encode = (value) => new TextEncoder().encode(value);

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
  cache.setPack("a", first);
  cache.enter({ embedded: true, name: "embedded-a" });
  assert.deepEqual(first, new Uint8Array(2));
  assert.equal(cache.packName, null);
  cache.setImage(image);
  cache.completeEmbedded();
  assert.equal(cache.image, image);
  cache.enter({ embedded: false, name: "a" });
  assert.equal(cache.pack, undefined);
  const second = new Uint8Array([3, 4]);
  cache.setPack("a", second);
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
  cache.setPack("a", pack);
  cache.setImage(image);
  cache.enter({ embedded: false, name: "b" });
  assert.equal(pack[0], 0);
  assert.equal(image[0], 6);
  cache.dispose();
  cache.dispose();
  assert.equal(image[0], 0);
  assert.equal(cache.image, undefined);
});
