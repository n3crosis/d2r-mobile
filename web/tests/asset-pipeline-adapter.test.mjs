// 依据合成提取夹具检查资源流水线的验证、生命周期和清理契约。
// Check asset pipeline validation, lifetime and cleanup contracts using synthetic extraction fixtures.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createAssetPipelineAdapter } from "../asset-pipeline-adapter.mjs";
import { extractedFixture } from "./helpers/asset-extraction-fixture.mjs";
import { MAP_GOAL_OUTPUTS } from "../map-goal-generator.mjs";
import { source, worker as overlayWorker, fixture } from "./helpers/casc-overlay-fixture.mjs";

async function setup() {
  const calls = [],
    owned = [];
  let closed = 0,
    frames = 7;
  const template = new Uint8Array(48),
    header = new DataView(template.buffer);
  header.setUint32(0, 0x31417053, true);
  header.setUint16(4, 61, true);
  header.setUint16(6, 4, true);
  header.setUint32(8, 4, true);
  header.setUint32(12, 4, true);
  header.setUint16(20, 1, true);
  const sha256 = createHash("sha256").update(template).digest("hex");
  const py = overlayWorker();
  const options = {
    mapGoal: true,
    createAssetWorker: () => ({
      close() {
        closed++;
      },
      async run(op, payload, args) {
        calls.push(op);
        if (op === "map-goal")
          return {
            files: Object.fromEntries(MAP_GOAL_OUTPUTS.map((n) => [n, new Uint8Array([1, 2])])),
          };
        return py.run(op, payload, args);
      },
    }),
    createTextureClient: () => ({
      close() {
        closed++;
      },
      async decodeAtlas(bytes) {
        calls.push("decode");
        const count = bytes[0] === 0x53 ? 1 : frames++;
        const pixels = new Uint8Array(count * 4 * 4 * 4);
        owned.push(pixels);
        return {
          width: count * 4,
          height: 4,
          frameWidth: 4,
          frameCount: count,
          pixels,
          pixelFormat: 70,
          bytesPerPixel: 4,
        };
      },
    }),
    createTextureEncoder: () => ({
      close() {
        closed++;
      },
      async encodeAndPack({ width, height, templateHeader, rgba }) {
        calls.push("encode");
        assert.equal(templateHeader.length, 40);
        assert.equal(rgba.length, width * height * 4);
        return { width, height, sprite: template.slice(), linearBC3: new Uint8Array(16) };
      },
    }),
    textureReplacements: [
      {
        input: "data/template.sprite",
        replacement: fixture.replacements[0].path,
        add: false,
        sha256,
        transform: ({ pixels, width, height }) => {
          calls.push("transform");
          return { rgba: pixels.slice(), width, height };
        },
      },
    ],
  };
  return { options, calls, owned, closed: () => closed, auth: await extractedFixture(template) };
}
async function bytes(entry) {
  const parts = [];
  for await (const b of entry.chunks()) parts.push(b);
  return Buffer.concat(parts);
}

test("map-goal and BC3 replacement compose through real bounded CASC writer into native destinations", async () => {
  const f = await setup(),
    adapter = createAssetPipelineAdapter(f.options);
  const entries = await adapter.generateAssets(f.auth);
  assert.equal(entries.filter((e) => e.path.startsWith("mapgoal/")).length, 164);
  assert.deepEqual(
    entries.filter((e) => e.path.startsWith("romfs_overlay/")).map((e) => e.path),
    ["romfs_overlay/data/.build.config", "romfs_overlay/data/00-00000002.data"],
  );
  assert.equal(f.calls[0], "decode");
  assert.ok(f.calls.indexOf("map-goal") < f.calls.indexOf("transform"));
  assert.ok(f.calls.indexOf("transform") < f.calls.indexOf("encode"));
  assert.ok(f.calls.indexOf("encode") < f.calls.indexOf("casc-overlay"));
  assert.equal(f.closed(), 3);
  for (const b of f.owned) assert.ok(b.every((v) => v === 0));
  for (const entry of entries) assert.equal((await bytes(entry)).length, entry.size);
  // 暂存和校验前可重复读取；清理只失效生产器，不修改条目元数据或已返回副本。
  // Reads remain repeatable before staging/validation; cleanup invalidates producers,
  // not entry metadata or previously yielded copies.
  const metadata = entries.map(({ path, size, mode }) => ({ path, size, mode }));
  const first = await bytes(entries[0]);
  assert.deepEqual(await bytes(entries[0]), first);
  const iterator = entries[0].chunks();
  const yielded = (await iterator.next()).value;
  const saved = yielded.slice();
  await iterator.return();
  assert.equal(adapter.capabilities.completeAssetPipeline, false);
  await adapter.dispose();
  assert.deepEqual(yielded, saved);
  assert.deepEqual(
    entries.map(({ path, size, mode }) => ({ path, size, mode })),
    metadata,
  );
  for (const entry of entries) await assert.rejects(bytes(entry), /CANCELLED/);
  await adapter.dispose();
  await assert.rejects(adapter.generateAssets(f.auth), /SINGLE_USE/);
});
test("default resolver rejects forged extracted capabilities before workers or reads", async () => {
  const f = await setup();
  let created = false;
  f.options.createAssetWorker = () => {
    created = true;
  };
  await assert.rejects(
    createAssetPipelineAdapter(f.options).generateAssets({
      extracted: { romfs: source(), authenticated: true },
      selection: {},
    }),
    /^Error: ASSET_PIPELINE_FAILED$/,
  );
  assert.equal(created, false);
  assert.deepEqual(f.calls, []);
});
test("source hash mismatch stops before decode, transform, encode or overlay", async () => {
  const f = await setup();
  f.options.mapGoal = false;
  f.options.textureReplacements[0].sha256 = "0".repeat(64);
  await assert.rejects(createAssetPipelineAdapter(f.options).generateAssets(f.auth), /SOURCE_HASH/);
  assert.ok(!f.calls.includes("decode"));
  assert.ok(!f.calls.includes("encode"));
  assert.equal(f.closed(), 3);
  for (const b of f.owned) assert.ok(b.every((v) => v === 0));
});
test("recipe validation and snapshot precede input access", async () => {
  const f = await setup();
  for (const replacement of ["../escape", "Payload/App.app/x", "data/../x"])
    assert.throws(
      () =>
        createAssetPipelineAdapter({
          ...f.options,
          textureReplacements: [{ ...f.options.textureReplacements[0], replacement }],
        }),
      /RECIPE/,
    );
  const adapter = createAssetPipelineAdapter(f.options);
  f.options.textureReplacements[0].sha256 = "0".repeat(64);
  const entries = await adapter.generateAssets(f.auth);
  assert.equal(entries.length, 166);
  adapter.dispose();
});
test("abort stops a pending trusted transform promptly and wipes its late output", async () => {
  const f = await setup();
  f.options.mapGoal = false;
  let ready, finish;
  const started = new Promise((r) => {
    ready = r;
  });
  f.options.textureReplacements[0].transform = () => {
    ready();
    return new Promise((r) => {
      finish = r;
    });
  };
  const adapter = createAssetPipelineAdapter(f.options),
    controller = new AbortController();
  const pending = adapter.generateAssets({ ...f.auth, signal: controller.signal });
  await started;
  controller.abort("PRIVATE-CANARY");
  await assert.rejects(pending, /^Error: ASSET_PIPELINE_CANCELLED$/);
  assert.equal(f.closed(), 3);
  assert.ok(!f.calls.includes("encode"));
  const late = new Uint8Array(64).fill(4);
  finish({ rgba: late, width: 4, height: 4 });
  await new Promise((r) => setImmediate(r));
  assert.ok(late.every((v) => v === 0));
});
test("pre-abort never authenticates or constructs clients; invalid dimensions stop encoding", async () => {
  const f = await setup();
  await assert.rejects(
    createAssetPipelineAdapter(f.options).generateAssets({
      ...f.auth,
      signal: AbortSignal.abort(),
    }),
    /CANCELLED/,
  );
  assert.deepEqual(f.calls, []);
  f.options.mapGoal = false;
  f.options.textureReplacements[0].transform = () => ({
    rgba: new Uint8Array(1),
    width: 9000,
    height: 1,
  });
  await assert.rejects(
    createAssetPipelineAdapter(f.options).generateAssets(f.auth),
    /^Error: ASSET_PIPELINE_FAILED$/,
  );
  assert.ok(!f.calls.includes("encode"));
});
