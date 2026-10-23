import { test } from "node:test";
import assert from "node:assert/strict";
import {
  generateMapGoal,
  MAP_GOAL_OUTPUTS,
  UPSTREAM_MAP_GOAL_OUTPUTS,
  MAP_GOAL_FONT,
} from "../map-goal-generator.mjs";
import { UPSTREAM_ART_REVISION } from "../toolchain/art-recipes-js/revision.mjs";
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
test("Map-goal maps exactly eight archive reads and all 164 legacy outputs", async () => {
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

test("Map-goal owns late decoded pixels before cancellation", async () => {
  for (const arrayBuffer of [false, true]) {
    const f = fixture(),
      controller = new AbortController();
    const pixels = new Uint8Array([9]);
    f.decodeAtlas = async () => {
      controller.abort();
      return { pixels: arrayBuffer ? pixels.buffer : pixels };
    };
    await assert.rejects(
      generateMapGoal({ ...f, signal: controller.signal }),
      /MAP_GOAL_CANCELLED/,
    );
    assert.deepEqual(pixels, new Uint8Array(1));
    for (const bytes of f.buffers) assert.ok(bytes.every((byte) => byte === 0));
  }
});
test("Map-goal wipes all returned files on cancellation or rejected output", async () => {
  for (const failure of ["cancel", "missing", "invalid", "limit"]) {
    const f = fixture(),
      controller = new AbortController();
    const data = new Uint8Array([7]),
      other = new Uint8Array([8]);
    const files = Object.fromEntries(MAP_GOAL_OUTPUTS.map((name) => [name, new Uint8Array([1])]));
    files[MAP_GOAL_OUTPUTS[0]] = data;
    files[MAP_GOAL_OUTPUTS.at(-1)] = other.buffer;
    if (failure === "missing") delete files[MAP_GOAL_OUTPUTS[1]];
    if (failure === "invalid") files[MAP_GOAL_OUTPUTS[1]] = "not bytes";
    if (failure === "limit")
      files[MAP_GOAL_OUTPUTS[1]] = new Uint8Array(16 * 1024 * 1024 + 1).fill(2);
    f.assetWorker.run = async () => {
      if (failure === "cancel") controller.abort();
      return { files };
    };
    await assert.rejects(
      generateMapGoal({ ...f, signal: controller.signal }),
      /MAP_GOAL_(CANCELLED|OUTPUT_SET|OUTPUT_LIMIT)/,
    );
    for (const value of Object.values(files)) {
      const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
      if (bytes instanceof Uint8Array) assert.ok(bytes.every((byte) => byte === 0));
    }
    assert.deepEqual(data, new Uint8Array(1));
    assert.deepEqual(other, new Uint8Array(1));
  }
});
test("Map-goal leaves successful worker output ownership with the caller", async () => {
  const f = fixture();
  const files = Object.fromEntries(MAP_GOAL_OUTPUTS.map((name) => [name, new Uint8Array([7])]));
  files[MAP_GOAL_OUTPUTS[0]] = new Uint8Array([8]).buffer;
  f.assetWorker.run = async () => ({ files });
  const result = await generateMapGoal(f);
  assert.equal(result.files, files);
  for (const value of Object.values(files)) {
    const bytes = value instanceof ArrayBuffer ? new Uint8Array(value) : value;
    assert.ok(bytes.every((byte) => byte !== 0));
  }
});

test("Map-goal releases input snapshots before worker execution without wiping borrowed originals", async () => {
  const f = fixture(),
    original = new Uint8Array([4, 5, 6]);
  const read = f.logicalAssets.read;
  f.logicalAssets.read = async (path, options) => {
    for (const bytes of f.buffers) assert.ok(bytes.every((byte) => byte === 0));
    if (path === MAP_GOAL_FONT) {
      const copy = original.slice();
      f.buffers.push(copy);
      return copy;
    }
    return read(path, options);
  };
  let request;
  const run = f.assetWorker.run;
  f.assetWorker.run = async (operation, payload, options) => {
    request = payload;
    for (const bytes of f.buffers) assert.ok(bytes.every((byte) => byte === 0));
    assert.ok(payload.some((byte) => byte !== 0));
    await Promise.resolve();
    assert.ok(payload.some((byte) => byte !== 0));
    return run(operation, payload, options);
  };
  await generateMapGoal(f);
  assert.ok(request.every((byte) => byte === 0));
  assert.deepEqual(original, new Uint8Array([4, 5, 6]));
});

test("Map-goal enables the 195-file inventory only with an explicit internal revision", async () => {
  const f = fixture();
  f.recipeRevision = UPSTREAM_ART_REVISION;
  f.assetWorker.run = async (_op, _payload, options) => {
    assert.deepEqual(options, { names: "current", revision: UPSTREAM_ART_REVISION });
    return {
      files: Object.fromEntries(
        UPSTREAM_MAP_GOAL_OUTPUTS.map((name) => [name, new Uint8Array([1])]),
      ),
    };
  };
  assert.equal(Object.keys((await generateMapGoal(f)).files).length, 195);
  const invalid = fixture();
  invalid.recipeRevision = "v2";
  await assert.rejects(generateMapGoal(invalid), /RECIPE_REVISION/);
  assert.equal(invalid.reads.length, 0);
});
