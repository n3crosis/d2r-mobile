import test from "node:test";
import assert from "node:assert/strict";
import { createExtractionEngine } from "./extraction-engine.mjs";
import {
  D2R_APPLICATION_ID as app,
  D2R_PATCH_ID as patch,
  D2R_WARLOCK_ID as dlc,
} from "../../d2r-expansion-policy.mjs";
const ids = [0x11, 0x33, 0x44, 0x55, 0x99, 0x77],
  hashes = [0xaa, 0x22, 0xbb, 0x66, 0xcc, 0x88];
function fixture() {
  const names = ids.map(
    (id, i) => id.toString(16).repeat(16) + (i % 2 ? ".nca" : ".cnmt.nca") + "\0",
  );
  const nameBytes = new TextEncoder().encode(names.join(""));
  const bytes = new Uint8Array(16 + 24 * 6 + nameBytes.length + 6),
    v = new DataView(bytes.buffer);
  bytes.set([80, 70, 83, 48]);
  v.setUint32(4, 6, true);
  v.setUint32(8, nameBytes.length, true);
  let nameOffset = 0;
  for (let i = 0; i < 6; i++) {
    v.setBigUint64(16 + 24 * i, BigInt(i), true);
    v.setBigUint64(24 + 24 * i, 1n, true);
    v.setUint32(32 + 24 * i, nameOffset, true);
    nameOffset += names[i].length;
  }
  bytes.set(nameBytes, 160);
  return new Blob([bytes]);
}
function cnmt(kind) {
  const ext = kind === 1 ? 24 : 16,
    p = 32 + ext;
  const bytes = new Uint8Array(p + 56 + 32),
    v = new DataView(bytes.buffer);
  v.setBigUint64(0, [app, patch, dlc][kind], true);
  v.setUint32(8, kind === 1 ? 65536 : 0, true);
  bytes[12] = 128 + kind;
  v.setUint16(14, ext, true);
  v.setUint16(16, 1, true);
  v.setBigUint64(32, kind === 0 ? patch : app, true);
  if (kind === 2) v.setUint32(40, 65536, true);
  bytes.fill(hashes[kind * 2 + 1], p, p + 32);
  bytes.fill(ids[kind * 2 + 1], p + 32, p + 48);
  v.setUint32(p + 48, 1, true);
  bytes[p + 54] = kind === 2 ? 2 : 1;
  return bytes;
}
function setup({
  wrongHash = false,
  wrongDlcHeader = false,
  missingDlcMeta = false,
  unsignedDlc = false,
} = {}) {
  let mode,
    active,
    disposed = false,
    keyArrays;
  const metadata = [cnmt(0), cnmt(1), cnmt(2)],
    calls = [];
  const boundary = {
    loadKeys(prod, title) {
      keyArrays = [prod, title];
    },
    mount(blobs) {
      assert.equal(blobs.length, 6);
    },
    hashInput(index) {
      return (index === 5 && wrongHash ? "ff" : hashes[index].toString(16)).repeat(32);
    },
    inspect(index) {
      return {
        fixedSignatureValid: !(unsignedDlc && index === 5),
        size: 1n,
        contentType:
          index === 4 && missingDlcMeta
            ? 0
            : index % 2 === 0
              ? 1
              : index === 5 && !wrongDlcHeader
                ? 2
                : 0,
      };
    },
    open(index, kind) {
      mode = kind;
      active = index;
      calls.push([index, kind]);
      return 1;
    },
    entry() {
      return mode === "meta"
        ? { name: "Content.cnmt", size: BigInt(metadata[active / 2].length), offset: 0n }
        : { name: "main", size: 4n, offset: 0n };
    },
    read(index, offset, count) {
      void index;
      return mode === "meta"
        ? metadata[active / 2].slice(Number(offset), Number(offset) + count)
        : new Uint8Array(count).fill(7);
    },
    openPatchedRomfs(baseIndex, patchIndex) {
      assert.equal(baseIndex, 1);
      assert.equal(patchIndex, 3);
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
  assert.equal(inspected.inventory.length, 6);
  assert.equal(inspected.records.length, 3);
  assert(env.keys().every((bytes) => bytes.every((byte) => byte === 0)));
  const selected = await engine.execute("select", { options: {} });
  assert.equal(selected.selection.base.version, 0n);
  assert.equal(
    (
      await engine.execute("readExefs", { token: selected.token, index: 0, offset: 0n, count: 4 })
    )[0],
    7,
  );
  assert.equal(selected.selection.dlc[0].titleId, dlc);
  assert(selected.selection.requiredContents.some((c) => c.contentId === "77".repeat(16)));
  assert.equal("owned" in selected.selection, false);
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

test("known DLC requires authenticated Meta evidence and actual signed Data NCA type", async () => {
  for (const options of [{ wrongDlcHeader: true }, { missingDlcMeta: true }]) {
    const { engine } = setup(options);
    await initialize(engine);
    await assert.rejects(engine.execute("select", { options: {} }));
    await engine.execute("dispose");
  }
  const { engine } = setup({ unsignedDlc: true });
  await assert.rejects(initialize(engine));
  await engine.execute("dispose");
});
