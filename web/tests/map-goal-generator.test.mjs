import { test } from "node:test";
import assert from "node:assert/strict";
import { generateMapGoal, MAP_GOAL_OUTPUTS, MAP_GOAL_FONT } from "../map-goal-generator.mjs";
function fixture() {
  const reads = [],
    buffers = [];
  const logicalAssets = {
    async read(path, { maxBytes }) {
      reads.push([path, maxBytes]);
      const bytes = new TextEncoder().encode(path.endsWith(".json") ? "[]" : "fixture");
      buffers.push(bytes);
      return bytes;
    },
  };
  let n = 0;
  const decodeAtlas = async () => {
    const frames = 7 + n++;
    const pixels = new Uint8Array(frames * 4 * 3 * 4);
    buffers.push(pixels);
    return {
      width: frames * 4,
      height: 3,
      frameWidth: 3,
      frames,
      pixels,
      pixelFormat: 70,
      bytesPerPixel: 4,
    };
  };
  const assetWorker = {
    async run(op, payload, options) {
      assert.equal(op, "map-goal");
      assert.deepEqual(options, { names: "current" });
      const bundle = JSON.parse(new TextDecoder().decode(payload));
      assert.equal(Object.keys(bundle.strings).length, 5);
      return { files: Object.fromEntries(MAP_GOAL_OUTPUTS.map((n) => [n, new Uint8Array([1])])) };
    },
  };
  return { logicalAssets, decodeAtlas, assetWorker, reads, buffers };
}
test("Map-goal maps exactly eight archive reads and all164 required outputs", async () => {
  const f = fixture();
  const result = await generateMapGoal(f);
  assert.equal(Object.keys(result.files).length, 164);
  assert.equal(f.reads.length, 8);
  assert.ok(f.reads.some(([p]) => p === MAP_GOAL_FONT));
  for (const b of f.buffers) assert.ok(b.every((x) => x === 0));
});
test("Map-goal does not infer invalid frame layout", async () => {
  const f = fixture();
  f.decodeAtlas = async () => ({
    width: 10,
    height: 1,
    frames: 7,
    frameWidth: 1,
    pixels: new Uint8Array(40),
    pixelFormat: 70,
    bytesPerPixel: 4,
  });
  await assert.rejects(generateMapGoal(f), /MAP_GOAL_FRAME_LAYOUT/);
});
test("Map-goal rejects incomplete generator output", async () => {
  const f = fixture();
  f.assetWorker.run = async () => ({ files: { "mapgoal.json": new Uint8Array([1]) } });
  await assert.rejects(generateMapGoal(f), /MAP_GOAL_OUTPUT_SET/);
});
test("Map-goal missing archive font remains an error, never OS fallback", async () => {
  const f = fixture();
  const read = f.logicalAssets.read;
  f.logicalAssets.read = async (p, o) => {
    if (p === MAP_GOAL_FONT) throw Error("font missing");
    return read(p, o);
  };
  await assert.rejects(generateMapGoal(f), /font missing/);
  for (const b of f.buffers) assert.ok(b.every((x) => x === 0));
});
test("Map-goal cancellation prevents any read", async () => {
  const f = fixture();
  await assert.rejects(
    generateMapGoal({ ...f, signal: AbortSignal.abort() }),
    /MAP_GOAL_CANCELLED/,
  );
  assert.equal(f.reads.length, 0);
});
