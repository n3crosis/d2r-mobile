// 合成源与注入的 Node 编解码器验证专用外部引用路由；不构成真实 WASM、浏览器或游戏证明。
// Verify dedicated external-reference routing with synthetic sources and injected Node codecs, not actual WASM, browser or game proof.
import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import {
  writeCascPrebuiltOverlay,
  reserveCascPackLocations,
  OVERLAY_LIMITS,
} from "../casc-overlay-writer.mjs";
import { createCascPrebuiltOverlayTransform } from "../toolchain/casc-overlay-js/overlay.mjs";
import {
  OPERATION_LIMITS,
  validateRequest,
  transferableResult,
} from "../toolchain/asset-runtime-js/contract.mjs";
import { fixture, source, jobs } from "./helpers/casc-overlay-fixture.mjs";
const manifest = Buffer.from(fixture.files["data/build_manifest.psv"], "base64")
  .toString()
  .split("\n");
const oldEkey = manifest.find((line) => line.includes("data:data/n.bin")).split("|")[6];
function external() {
  const bytes = new Uint8Array([9, 8, 7]);
  return {
    pack: {
      name: "00-00000003.data",
      size: 3,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    },
    records: [
      {
        path: "data/n.bin",
        oldEkey,
        newEkey: createHash("md5").update(bytes).digest("hex").slice(0, 18) + "00030000000000",
        encodedSize: 3,
        decodedSize: 3,
      },
    ],
  };
}
const transform = createCascPrebuiltOverlayTransform({
  md5: (bytes) => new Uint8Array(createHash("md5").update(bytes).digest()),
  compress: (bytes) => new Uint8Array(deflateSync(bytes, { level: 9 })),
});
function serializer(inspect = () => {}) {
  return {
    close() {},
    async run(operation, payload, options) {
      assert.equal(operation, "casc-prebuilt-overlay");
      assert.equal(options.parts.length, options.jobs.length + 4);
      assert.deepEqual(Object.keys(options).sort(), ["jobs", "location", "parts"]);
      const message = { id: 1, operation, payload: payload.buffer, options };
      const request = validateRequest(message);
      inspect(request);
      const result = await transform(request.payload, request.options);
      return transferableResult(1, result).message.result;
    },
  };
}
test("reservation keeps default overlay location first and external archive separate", () => {
  assert.deepEqual(reserveCascPackLocations(source()), {
    overlayLocation: [0, 2],
    packLocation: [0, 3],
    packName: "00-00000003.data",
  });
  assert.deepEqual(
    reserveCascPackLocations(source(), { packLocation: [1, 255] }).packLocation,
    [1, 255],
  );
  for (const packLocation of [
    [0, 1],
    [0, 2],
    [0, 256],
    [-1, 2],
  ])
    assert.throws(() => reserveCascPackLocations(source(), { packLocation }));
});
test("dedicated host routes metadata in its own segment without copying external archive bytes", async () => {
  const references = external(),
    romfs = source();
  let checked = false;
  const out = await writeCascPrebuiltOverlay({
    romfs,
    replacements: jobs().slice(1),
    external: references,
    worker: serializer(({ payload, options }) => {
      const offset = options.parts.slice(0, -1).reduce((a, b) => a + b, 0);
      assert.deepEqual(JSON.parse(new TextDecoder().decode(payload.subarray(offset))), references);
      assert.deepEqual(options.location, [0, 2]);
      checked = true;
    }),
  });
  assert.equal(checked, true);
  assert.equal(out.inventory.length, 3);
  assert.deepEqual(out.external, { count: 1, pack: references.pack });
  assert.deepEqual(Object.keys(out.files).sort(), ["data/.build.config", "data/00-00000002.data"]);
  assert.ok(!romfs.reads.some((r) => r.path === "data/00-00000003.data"));
});
test("external-only overlay is generated instead of default empty-job no-op", async () => {
  const out = await writeCascPrebuiltOverlay({
    romfs: source(),
    external: external(),
    worker: serializer(),
  });
  assert.equal(out.inventory.length, 0);
  assert.equal(out.external.count, 1);
  assert.equal(Object.keys(out.files).length, 2);
});
test("declared location, range, duplicates, overlap and original association fail closed", async () => {
  const variants = [
    (e) => {
      e.pack.name = "00-00000001.data";
    },
    (e) => {
      e.pack.name = "00-00000002.data";
    },
    (e) => {
      e.records[0].newEkey = "0".repeat(18) + "00040000000000";
    },
    (e) => {
      e.records[0].encodedSize = 4;
    },
    (e) => {
      e.records[0].newEkey = e.records[0].newEkey.slice(0, 22) + "ffffffffff";
    },
    (e) => {
      e.records[0].oldEkey = "f".repeat(32);
    },
    (e) => {
      e.records.push({ ...e.records[0] });
    },
    (e) => {
      e.records[0].decodedSize = 2 ** 32;
    },
    (e) => {
      e.records[0].path = "a".repeat(4097);
    },
  ];
  for (const mutate of variants) {
    const e = external();
    mutate(e);
    await assert.rejects(
      writeCascPrebuiltOverlay({ romfs: source(), external: e, worker: serializer() }),
    );
  }
  await assert.rejects(
    writeCascPrebuiltOverlay({
      romfs: source(),
      replacements: jobs(),
      external: external(),
      worker: serializer(),
    }),
  );
});
test("external metadata has independent entry/path budgets before source reads", async () => {
  for (const records of [
    Array(32769).fill(external().records[0]),
    Array.from({ length: 2049 }, (_, i) => ({
      ...external().records[0],
      path: `data/${String(i).padStart(5, "0")}/` + "a".repeat(4085),
      oldEkey: i.toString(16).padStart(32, "0"),
    })),
  ]) {
    const romfs = source();
    await assert.rejects(
      writeCascPrebuiltOverlay({
        romfs,
        external: { ...external(), records },
        worker: serializer(),
      }),
    );
    assert.equal(romfs.reads.length, 0);
  }
});
test("transport accepts over-1MiB external segment but retains existing options/input caps", () => {
  assert.deepEqual(OPERATION_LIMITS["casc-overlay"], [64, 1048576]);
  assert.deepEqual(OPERATION_LIMITS["casc-prebuilt-overlay"], [64, 1048576]);
  assert.equal(OVERLAY_LIMITS.jobs, 4096);
  const count = 1048577,
    message = {
      id: 1,
      operation: "casc-prebuilt-overlay",
      payload: new ArrayBuffer(count),
      options: { parts: [0, 0, 0, count], jobs: [], location: [0, 2] },
    };
  assert.equal(validateRequest(message).payload.length, count);
  for (const options of [
    { ...message.options, external: "x" },
    { ...message.options, parts: [0, 0, 0, 16 * 1024 * 1024 + 1] },
    { ...message.options, jobs: Array(4097).fill({}) },
    { ...message.options, location: [0, 256] },
    { ...message.options, jobs: [{ path: "x".repeat(1048576) }], parts: [0, 0, 0, 0, count] },
  ])
    assert.throws(() => validateRequest({ ...message, options }));
  assert.throws(() =>
    validateRequest({ ...message, payload: new ArrayBuffer(64 * 1024 * 1024 + 1) }),
  );
});
test("worker metadata mismatch is rejected without releasing changed files", async () => {
  const delegate = serializer();
  const worker = {
    close() {},
    async run(...args) {
      const result = await delegate.run(...args);
      result.external.pack.name = "00-00000009.data";
      return result;
    },
  };
  await assert.rejects(writeCascPrebuiltOverlay({ romfs: source(), external: external(), worker }));
});
