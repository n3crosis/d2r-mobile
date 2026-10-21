// 合成后端检查聚合预算与输出顺序，不使用游戏资源或真实字体。
// Synthetic backends check aggregate budgets and output order, without game assets or real fonts.
import test from "node:test";
import assert from "node:assert/strict";
import { generateMapGoal, LABELS } from "../toolchain/art-recipes-js/map-goal.mjs";
import { MAP_GOAL_OUTPUTS } from "../map-goal-generator.mjs";

function fixture(outputBytes) {
  const strings = {};
  for (const [table, key] of LABELS) {
    (strings[table] ??= []).push({
      Key: key,
      zhCN: "a",
      enUS: "a",
      esES: "a",
      esMX: "a",
      ruRU: "a",
    });
  }
  const image = (frames) => ({
    size: [frames, 1],
    frameWidth: 1,
    frames,
    rgba: btoa("\0".repeat(frames * 4)),
  });
  const payload = new TextEncoder().encode(
    JSON.stringify({
      images: { symbols: image(7), units: image(8) },
      font: btoa("synthetic"),
      strings: Object.fromEntries(
        Object.entries(strings).map(([key, rows]) => [key, JSON.stringify(rows)]),
      ),
    }),
  );
  let encoded = 0,
    closed = 0;
  const dependencies = {
    codec: {
      encodeRgba() {
        ++encoded;
        return typeof outputBytes === "function" ? outputBytes(encoded) : outputBytes;
      },
    },
    kernels: {
      crop: () => ({ width: 1, height: 1, data: new Uint8Array(4) }),
      channel: (image) => image,
      point: (image) => image,
      putAlpha: (image) => image,
    },
    font: {
      open() {},
      close() {
        ++closed;
      },
      measure: () => ({ length: 1 }),
      draw: (bytes) => bytes,
    },
  };
  return {
    run: () => generateMapGoal(payload, { names: "current" }, dependencies),
    get encoded() {
      return encoded;
    },
    get closed() {
      return closed;
    },
  };
}

test("map-goal stops encoding at the first aggregate output overflow", () => {
  const bytes = new Uint8Array(1024 * 1024).fill(9);
  const f = fixture(bytes);
  assert.throws(f.run, /MAP_GOAL_OUTPUT_LIMIT/);
  assert.equal(f.encoded, 17);
  assert.ok(bytes.every((value) => value === 0));
  assert.equal(f.closed, 1);
});

test("map-goal rejects one oversized image before encoding another", () => {
  const bytes = new Uint8Array(16 * 1024 * 1024 + 1).fill(9);
  const f = fixture(bytes);
  assert.throws(f.run, /MAP_GOAL_OUTPUT_LIMIT/);
  assert.equal(f.encoded, 1);
  assert.ok(bytes.every((value) => value === 0));
  assert.equal(f.closed, 1);
});

test("in-budget map-goal keeps the complete output set and recipe ordering", () => {
  const f = fixture(new Uint8Array([1]));
  const result = f.run();
  const names = Object.keys(result.files);
  assert.deepEqual([...names].sort(), [...MAP_GOAL_OUTPUTS].sort());
  assert.deepEqual(names.slice(0, 8), [
    ...Array.from({ length: 7 }, (_, i) => `sym_${i}.png`),
    "cross.png",
  ]);
  assert.deepEqual(names.slice(8, 13), [
    "label_0.png",
    "label_0_en.png",
    "label_0_es.png",
    "label_0_mx.png",
    "label_0_ru.png",
  ]);
  assert.equal(names.at(-1), "mapgoal.json");
  assert.equal(result.files["cross.png"][0], 1);
  assert.equal(f.encoded, 163);
  assert.equal(f.closed, 1);
});

test("map-goal includes the final JSON manifest in its aggregate budget", () => {
  const first = new Uint8Array(16 * 1024 * 1024 - 162).fill(9);
  const rest = new Uint8Array([9]);
  const f = fixture((index) => (index === 1 ? first : rest));
  assert.throws(f.run, /MAP_GOAL_OUTPUT_LIMIT/);
  assert.equal(f.encoded, 163);
  assert.ok(first.every((value) => value === 0));
  assert.equal(rest[0], 0);
  assert.equal(f.closed, 1);
});
