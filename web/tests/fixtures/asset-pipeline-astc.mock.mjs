// 隔离模块替身仅验证可选元数据、11项输出、所有权和预算，不声明游戏或浏览器证明。
// Isolated module doubles test optional metadata, eleven outputs, ownership and budgets, not game or browser proof.
import assert from "node:assert/strict";
import { mock, test } from "node:test";
mock.module("../../extraction-job-adapter.mjs", {
  namedExports: { readAuthenticatedAssets: () => ({ logicalAssets: {}, romfs: {} }) },
});
const pack = { name: "00-00000008.data", size: 20, sha256: "a".repeat(64) };
const metadata = () => ({
  pack: { ...pack },
  records: [
    {
      path: "data/a",
      oldEkey: "1".repeat(32),
      newEkey: "2".repeat(32),
      encodedSize: 20,
      decodedSize: 30,
    },
  ],
});
let received, output, mode, unblock;
const generate = ({ prebuiltPack }) => {
  received = prebuiltPack;
  const files = {
    "romfs_overlay/default":
      mode === "oversize" ? new Uint8Array(80 * 1024 * 1024 + 1) : new Uint8Array([8]),
  };
  let astc;
  if (prebuiltPack || mode === "unbound") {
    for (const [prefix, names] of [
      [
        "romfs_overlay_astc",
        [
          "data/.build.config",
          "data/00-00000002.data",
          "ctrl_touch",
          "touch_strings.tsv",
          "pack.json",
        ],
      ],
      [
        "romfs_overlay_astc_variants/item_notes",
        [
          "data/.build.config",
          "data/00-00000002.data",
          "ctrl_touch",
          "touch_strings.tsv",
          "dm_textbox_plain.tsv",
          "features.txt",
        ],
      ],
    ])
      for (const name of names)
        files[`${prefix}/${name}`] = new TextEncoder().encode(
          name === "pack.json"
            ? JSON.stringify(pack)
            : name === "features.txt"
              ? "item_notes\n"
              : "x",
        );
    astc = {
      count: 1,
      pack: { ...pack },
      overlayArchives: { base: "00-00000002.data", item_notes: "00-00000002.data" },
    };
    if (mode === "missing") delete files["romfs_overlay_astc/ctrl_touch"];
  }
  if (mode === "late-oversize") {
    files["romfs_overlay/too-large"] = new Uint8Array(80 * 1024 * 1024).fill(3);
  }
  if (mode === "alias") files["romfs_overlay/alias"] = files["romfs_overlay/default"];
  if (mode === "subview") files["romfs_overlay/default"] = new Uint8Array([7, 8]).subarray(1);
  output = files;
  const result = { files, ...(astc ? { astc } : {}) };
  if (mode === "pending")
    return new Promise((resolve) => {
      unblock = () => resolve(result);
    });
  return result;
};
mock.module("../../native-overlay-generator.mjs", {
  namedExports: {
    NATIVE_OVERLAY_GENERATED: ["NativeHUD/v4/base.png"],
    generateNativeOverlay: generate,
  },
});
const { createAssetPipelineAdapter, ASSET_PIPELINE_LIMITS, snapshotPrebuiltPackMetadata } =
  await import("../../asset-pipeline-adapter.mjs");
const options = (prebuiltPack) => ({
  nativeOverlayGenerated: { "NativeHUD/v4/base.png": new Uint8Array([1]) },
  prebuiltPack,
  createAssetWorker: () => ({ run() {}, close() {} }),
  createTextureClient: () => ({ decodeAtlas() {}, close() {} }),
});
test("optional binding appears only after complete successful generation and clears on dispose", async () => {
  mode = "pending";
  const input = metadata(),
    adapter = createAssetPipelineAdapter(options(input));
  assert.equal(adapter.getAstcOutputBinding(), undefined);
  const work = adapter.generateAssets({});
  while (!unblock) await new Promise((resolve) => setImmediate(resolve));
  assert.equal(adapter.getAstcOutputBinding(), undefined);
  assert.notEqual(received, input);
  assert.deepEqual(received, input);
  assert.ok(Object.isFrozen(received.records[0]));
  unblock();
  const entries = await work;
  unblock = undefined;
  assert.equal(entries.length, 12);
  const binding = adapter.getAstcOutputBinding();
  assert.deepEqual(Object.keys(binding).sort(), ["count", "overlayArchives", "pack"]);
  assert.ok(Object.isFrozen(binding));
  assert.ok(Object.isFrozen(binding.pack));
  assert.ok(Object.isFrozen(binding.overlayArchives));
  assert.equal(binding.count, 1);
  assert.equal(binding.pack.name, pack.name);
  for (const bytes of Object.values(output)) assert.ok(bytes.some((n) => n !== 0));
  for (const entry of entries.filter((item) => item.path.startsWith("romfs_overlay_astc")))
    for await (const bytes of entry.chunks()) {
      assert.ok(bytes.length <= 64 * 1024);
      assert.ok(bytes.buffer.byteLength <= 64 * 1024);
    }
  const part = await entries[0].chunks().next();
  assert.ok(part.value.some((n) => n !== 0));
  const snapshot = part.value.slice();
  adapter.dispose();
  for (const bytes of Object.values(output)) assert.ok(bytes.every((n) => n === 0));
  assert.deepEqual(part.value, snapshot);
  assert.equal(adapter.getAstcOutputBinding(), undefined);
});
test("default pipeline has no ASTC binding and rejects unbound optional files", async () => {
  mode = undefined;
  const adapter = createAssetPipelineAdapter(options());
  assert.equal((await adapter.generateAssets({})).length, 1);
  assert.equal(adapter.getAstcOutputBinding(), undefined);
  adapter.dispose();
  mode = "unbound";
  const bad = createAssetPipelineAdapter(options());
  await assert.rejects(bad.generateAssets({}));
  assert.equal(bad.getAstcOutputBinding(), undefined);
});
test("exact11 validation and unchanged80MiB aggregate limit fail without binding", async () => {
  assert.equal(ASSET_PIPELINE_LIMITS.outputBytes, 80 * 1024 * 1024);
  for (const value of ["missing", "oversize"]) {
    mode = value;
    const adapter = createAssetPipelineAdapter(options(metadata()));
    await assert.rejects(
      adapter.generateAssets({}),
      value === "oversize" ? /OUTPUT_LIMIT/ : /FAILED/,
    );
    assert.equal(adapter.getAstcOutputBinding(), undefined);
    for (const bytes of Object.values(output)) assert.ok(bytes.every((n) => n === 0));
  }
});
test("metadata rejects payloads and out-of-bound counts before any generator work", () => {
  for (const value of [
    { ...metadata(), source: {} },
    { ...metadata(), bytes: new Uint8Array(1) },
    { ...metadata(), records: Array(32769).fill(metadata().records[0]) },
    { ...metadata(), records: [{ ...metadata().records[0], bytes: new Uint8Array(1) }] },
  ])
    assert.throws(() => snapshotPrebuiltPackMetadata(value));
  const input = metadata(),
    snap = snapshotPrebuiltPackMetadata(input);
  input.pack.name = "changed";
  assert.equal(snap.pack.name, pack.name);
});

test("native overlay output is adopted without a payload copy and chunks stay detached", async (t) => {
  mode = undefined;
  const slice = Uint8Array.prototype.slice;
  const observed = [];
  t.mock.method(Uint8Array.prototype, "slice", function (...args) {
    if (Object.values(output ?? {}).includes(this)) observed.push(this);
    return slice.apply(this, args);
  });
  const adapter = createAssetPipelineAdapter(options());
  const entries = await adapter.generateAssets({});
  assert.deepEqual(observed, []);
  const source = output["romfs_overlay/default"];
  const { value: chunk } = await entries[0].chunks().next();
  assert.deepEqual(observed, [source]);
  assert.notEqual(chunk.buffer, source.buffer);
  assert.deepEqual([...chunk], [8]);
  adapter.dispose();
  assert.deepEqual([...source], [0]);
  assert.deepEqual([...chunk], [8]);
});

for (const invalidMode of ["late-oversize", "alias", "subview"])
  test(`native overlay ${invalidMode} failure wipes adopted and scratch outputs`, async () => {
    mode = invalidMode;
    const adapter = createAssetPipelineAdapter(options());
    await assert.rejects(
      adapter.generateAssets({}),
      invalidMode === "late-oversize" ? /OUTPUT_LIMIT/ : /BYTES/,
    );
    for (const bytes of Object.values(output)) assert.ok(bytes.every((n) => n === 0));
    adapter.dispose();
  });
