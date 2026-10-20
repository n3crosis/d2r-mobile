import test from "node:test";
import assert from "node:assert/strict";
import { createExtractionEngine } from "./extraction-engine.mjs";
const metaId = "11".repeat(16),
  programId = "33".repeat(16),
  programHash = "22".repeat(32);
function fixture() {
  const names = new TextEncoder().encode(`${metaId}.cnmt.nca\0${programId}.nca\0`);
  const bytes = new Uint8Array(16 + 48 + names.length + 2),
    v = new DataView(bytes.buffer);
  bytes.set([80, 70, 83, 48]);
  v.setUint32(4, 2, true);
  v.setUint32(8, names.length, true);
  v.setBigUint64(24, 1n, true);
  v.setBigUint64(40, 1n, true);
  v.setBigUint64(48, 1n, true);
  v.setUint32(56, metaId.length + ".cnmt.nca".length + 1, true);
  bytes.set(names, 64);
  return new Blob([bytes]);
}
function cnmt() {
  const bytes = new Uint8Array(136),
    v = new DataView(bytes.buffer);
  v.setBigUint64(0, 0x0100000000000000n, true);
  v.setUint32(8, 1, true);
  bytes[12] = 128;
  v.setUint16(14, 16, true);
  v.setUint16(16, 1, true);
  v.setBigUint64(32, 0x0100000000000800n, true);
  bytes.fill(0x22, 48, 80);
  bytes.fill(0x33, 80, 96);
  v.setUint32(96, 1, true);
  bytes[102] = 1;
  return bytes;
}
function setup({ wrongHash = false } = {}) {
  let mode,
    disposed = false,
    keyArrays;
  const metadata = cnmt(),
    calls = [];
  const boundary = {
    loadKeys(prod, title) {
      keyArrays = [prod, title];
    },
    mount(blobs) {
      assert.equal(blobs.length, 2);
    },
    hashInput(index) {
      return index === 1 ? (wrongHash ? "ff".repeat(32) : programHash) : "44".repeat(32);
    },
    inspect(index) {
      return { fixedSignatureValid: true, size: 1n, contentType: index === 0 ? 1 : 0 };
    },
    open(index, kind) {
      mode = kind;
      calls.push([index, kind]);
      return 1;
    },
    entry() {
      return mode === "meta"
        ? { name: "Application.cnmt", size: 136n, offset: 0n }
        : { name: "main", size: 4n, offset: 0n };
    },
    read(index, offset, count) {
      void index;
      return mode === "meta"
        ? metadata.slice(Number(offset), Number(offset) + count)
        : new Uint8Array(count).fill(7);
    },
    openRomfs(index) {
      assert.equal(index, 1);
      return {
        size: 10n,
        readAt(offset, count) {
          void offset;
          return new Uint8Array(count).fill(9);
        },
      };
    },
    dispose() {
      disposed = true;
    },
  };
  let sequence = 0;
  const engine = createExtractionEngine(boundary, { newToken: () => `token-${++sequence}` });
  return { engine, calls, keys: () => keyArrays, disposed: () => disposed };
}
const initialize = (engine) =>
  engine.execute("initialize", {
    nsps: [fixture()],
    prodKeys: new Blob(["synthetic-prod"]),
    titleKeys: new Blob(["synthetic-title"]),
  });
test("engine uses catalog, independent inventory and internal selection; tokens revoke ExeFS", async () => {
  const env = setup(),
    { engine } = env;
  const inspected = await initialize(engine);
  assert.equal(inspected.inventory.length, 2);
  assert.equal(inspected.records.length, 1);
  assert(env.keys().every((bytes) => bytes.every((byte) => byte === 0)));
  const selected = await engine.execute("select", { options: {} });
  assert.equal(selected.selection.base.version, 1n);
  assert.equal(
    (
      await engine.execute("readExefs", { token: selected.token, index: 0, offset: 0n, count: 4 })
    )[0],
    7,
  );
  const romfs = await engine.execute("openRomfs", { token: selected.token });
  assert.notEqual(romfs.token, selected.token);
  await assert.rejects(
    engine.execute("readExefs", { token: selected.token, index: 0, offset: 0n, count: 1 }),
  );
  await assert.rejects(
    engine.execute("readRomfs", { token: selected.token, offset: 0n, count: 1 }),
  );
  await assert.rejects(engine.execute("readRomfs", { token: romfs.token, offset: 9n, count: 2 }));
  assert.equal(
    (await engine.execute("readRomfs", { token: romfs.token, offset: 0n, count: 2 }))[0],
    9,
  );
  await engine.execute("dispose");
  assert(env.disposed());
  await assert.rejects(engine.execute("readRomfs", { token: romfs.token, offset: 0n, count: 1 }));
});
test("engine rejects content hash mismatch and arbitrary operation/fields", async () => {
  const { engine } = setup({ wrongHash: true });
  await initialize(engine);
  await assert.rejects(engine.execute("select", { options: {} }), /does not match/);
  await assert.rejects(engine.execute("ccall", { path: "secret" }));
  await assert.rejects(engine.execute("dispose", { extra: true }));
  await engine.execute("dispose");
});
