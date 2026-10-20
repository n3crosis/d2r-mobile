// 依据模拟边界与合成内容元数据验证提取引擎的选择和校验约束。
// Verify extraction-engine selection and validation constraints using a mocked boundary and synthetic content metadata.
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
function fixture({
  ticket = false,
  ticketName = "aa".repeat(16),
  ticketSize = 0x2c0,
  ticketType = 0,
  ticketVersion = 2,
  signature = 0x10004,
  ticketKey = 0x11,
  ticketCount = 1,
} = {}) {
  const names = ids.map(
    (id, i) => id.toString(16).repeat(16) + (i % 2 ? ".nca" : ".cnmt.nca") + "\0",
  );
  const rightsIds = Array.from({ length: ticket ? ticketCount : 0 }, (_, i) =>
    ticketCount === 1 ? "aa".repeat(16) : (i + 1).toString(16).padStart(32, "0"),
  );
  for (const id of rightsIds) names.push(`${ticketCount === 1 ? ticketName : id}.tik\0`);
  const nameBytes = new TextEncoder().encode(names.join(""));
  const count = names.length;
  const dataOffset = 16 + 24 * count + nameBytes.length;
  const bytes = new Uint8Array(dataOffset + 6 + rightsIds.length * ticketSize),
    v = new DataView(bytes.buffer);
  bytes.set([80, 70, 83, 48]);
  v.setUint32(4, count, true);
  v.setUint32(8, nameBytes.length, true);
  let nameOffset = 0;
  for (let i = 0; i < count; i++) {
    v.setBigUint64(16 + 24 * i, BigInt(i < 6 ? i : 6 + (i - 6) * ticketSize), true);
    v.setBigUint64(24 + 24 * i, BigInt(i < 6 ? 1 : ticketSize), true);
    v.setUint32(32 + 24 * i, nameOffset, true);
    nameOffset += names[i].length;
  }
  for (const [i, id] of rightsIds.entries()) {
    const ticketBytes = new Uint8Array(0x2c0);
    new DataView(ticketBytes.buffer).setUint32(0, signature, true);
    ticketBytes.fill(ticketKey, 0x180, 0x190);
    ticketBytes[0x280] = ticketVersion;
    ticketBytes[0x281] = ticketType;
    for (let j = 0; j < 16; j++)
      ticketBytes[0x2a0 + j] = Number.parseInt(id.slice(j * 2, j * 2 + 2), 16);
    bytes.set(ticketBytes.subarray(0, ticketSize), dataOffset + 6 + i * ticketSize);
  }
  bytes.set(nameBytes, 16 + 24 * count);
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
  onProgress = () => {},
  failLoad = false,
} = {}) {
  let mode,
    active,
    disposed = false,
    keyArrays,
    loadedTitle;
  const metadata = [cnmt(0), cnmt(1), cnmt(2)],
    calls = [];
  const boundary = {
    loadKeys(prod, title) {
      keyArrays = [prod, title];
      loadedTitle = title.slice();
      if (failLoad) throw new Error("PRIVATE-KEY-CANARY");
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
    openPatchedRomfs(baseIndex, patchIndex, onProgress, verifyRomfs) {
      assert.equal(baseIndex, 1);
      assert.equal(patchIndex, 3);
      calls.push(["romfs", verifyRomfs]);
      onProgress({ phase: "base", completed: 64 * 1024 * 1024, total: 128 * 1024 * 1024 });
      onProgress({ phase: "merged", completed: 128 * 1024 * 1024, total: 128 * 1024 * 1024 });
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
  const engine = createExtractionEngine(boundary, {
    newToken: () => `token-${++sequence}`,
    onProgress,
  });
  return {
    engine,
    calls,
    keys: () => keyArrays,
    title: () => loadedTitle,
    disposed: () => disposed,
  };
}
const initialize = (engine, fixtureOptions) =>
  engine.execute("initialize", {
    nsps: [fixture(fixtureOptions)],
    prodKeys: new Blob([`header_key = ${"12".repeat(32)}\n`]),
    titleKeys: new Blob([`${"34".repeat(16)} = ${"56".repeat(16)}\n`]),
  });
test("package tickets supply title keys when title.keys has no matching rights ID", async () => {
  const { engine, title, keys } = setup();
  await initialize(engine, { ticket: true });
  assert.match(new TextDecoder().decode(title()), /a{32} = 1{32}\n/);
  assert(keys().every((bytes) => bytes.every((byte) => byte === 0)));
  await engine.execute("dispose");
});
test("package ticket filename must match its embedded rights ID", async () => {
  const { engine } = setup();
  await assert.rejects(initialize(engine, { ticket: true, ticketName: "bb".repeat(16) }), {
    code: "TICKET_RIGHTS_ID_MISMATCH",
  });
  await engine.execute("dispose");
});
test("engine uses catalog, independent inventory and internal selection; tokens revoke ExeFS", async () => {
  const progress = [];
  const env = setup({ onProgress: (event) => progress.push(event) }),
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
  const romfs = await engine.execute("openRomfs", { token: selected.token, verifyRomfs: true });
  assert.deepEqual(
    progress.filter(({ stage }) => stage.startsWith("romfs-")),
    [
      { stage: "romfs-base", completed: 50, total: 100, bytes: 64 * 1024 * 1024 },
      { stage: "romfs-merged", completed: 100, total: 100, bytes: 128 * 1024 * 1024 },
    ],
  );
  assert.notEqual(romfs.token, selected.token);
  assert.deepEqual(env.calls.at(-1), ["romfs", true]);
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
test("fast RomFS mode requires measured package evidence", async () => {
  const env = setup();
  await initialize(env.engine);
  const selected = await env.engine.execute("select", { options: {} });
  await assert.rejects(
    env.engine.execute("openRomfs", { token: selected.token, verifyRomfs: "false" }),
  );
  const romfs = await env.engine.execute("openRomfs", {
    token: selected.token,
    verifyRomfs: false,
  });
  assert.deepEqual(env.calls.at(-1), ["romfs", false]);
  assert.equal(romfs.size, 10n);
  await env.engine.execute("dispose");
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

test("empty title keys reach the native loader, while key failures are safely distinguished", async () => {
  const valid = new Blob([`header_key = ${"12".repeat(32)}\n`]);
  const env = setup();
  await env.engine.execute("initialize", {
    nsps: [fixture()],
    prodKeys: valid,
    titleKeys: new Blob(),
  });
  assert.equal(env.keys()[1].length, 0);
  for (const [prodKeys, titleKeys, expected] of [
    [undefined, new Blob(), "PROD_KEYS_MISSING"],
    [new Blob(), new Blob(), "PROD_KEYS_EMPTY"],
    [new Blob(["PRIVATE-KEY-CANARY"]), new Blob(), "PROD_KEYS_MALFORMED"],
    [valid, new Blob(["PRIVATE-RIGHTS-CANARY"]), "TITLE_KEYS_MALFORMED"],
  ]) {
    const { engine } = setup();
    await assert.rejects(
      engine.execute("initialize", { nsps: [fixture()], prodKeys, titleKeys }),
      (error) => {
        assert.equal(error.code, expected);
        assert.equal(error.message, expected);
        return true;
      },
    );
  }
  const unreadable = new Blob(["private"]);
  unreadable.arrayBuffer = async () => {
    throw new Error("PRIVATE-PATH-CANARY");
  };
  await assert.rejects(
    setup().engine.execute("initialize", {
      nsps: [fixture()],
      prodKeys: unreadable,
      titleKeys: new Blob(),
    }),
    /^Error: PROD_KEYS_UNREADABLE$/,
  );
});

test("absent optional title file becomes an empty in-worker buffer", async () => {
  const env = setup();
  await env.engine.execute("initialize", {
    nsps: [fixture()],
    prodKeys: new Blob([`header_key = ${"12".repeat(32)}\n`]),
  });
  assert.equal(env.keys()[1].length, 0);
});

const ticketInitialize = (engine, nsps, titleKeys) =>
  engine.execute("initialize", {
    nsps,
    prodKeys: new Blob([`header_key = ${"12".repeat(32)}\n`]),
    titleKeys,
  });
test("explicit title keys take precedence and rescue personalized tickets", async () => {
  for (const options of [{ ticketType: 0 }, { ticketType: 1 }, { signature: 0x10001 }]) {
    const events = [];
    const env = setup({ onProgress: (event) => events.push(event) });
    const explicit = `  ${"AA".repeat(16)} = ${"22".repeat(16)}`;
    await ticketInitialize(
      env.engine,
      [fixture({ ticket: true, ...options })],
      new Blob([explicit]),
    );
    assert.equal(new TextDecoder().decode(env.title()), explicit);
    assert.deepEqual(
      events.filter(({ stage }) => stage.startsWith("ticket-")),
      [
        { stage: "ticket-found", completed: 1, total: 1, bytes: 0 },
        { stage: "ticket-key-reused", completed: 1, total: 1, bytes: 0 },
      ],
    );
    assert(env.keys().every((bytes) => bytes.every((byte) => byte === 0)));
    await env.engine.execute("dispose");
  }
});
test("ticket diagnostics distinguish unsupported, malformed and mismatched input", async () => {
  for (const [options, code] of [
    [{ ticketType: 1 }, "TICKET_UNSUPPORTED"],
    [{ signature: 0xdeadbeef }, "TICKET_UNSUPPORTED"],
    [{ signature: 0x10001 }, "TICKET_UNSUPPORTED"],
    [{ ticketSize: 0x2b0 }, "TICKET_INVALID"],
    [{ ticketVersion: 0 }, "TICKET_INVALID"],
    [{ ticketType: 2 }, "TICKET_INVALID"],
    [{ ticketKey: 0 }, "TICKET_INVALID"],
    [{ ticketName: "bb".repeat(16) }, "TICKET_RIGHTS_ID_MISMATCH"],
  ]) {
    const { engine } = setup();
    await assert.rejects(
      ticketInitialize(engine, [fixture({ ticket: true, ...options })]),
      (error) => error.code === code && error.message === code,
    );
    await engine.execute("dispose");
  }
});
test("explicit keys do not suppress malformed or mismatched tickets", async () => {
  for (const [options, code] of [
    [{ ticketSize: 0x2b0 }, "TICKET_INVALID"],
    [{ ticketType: 1, ticketName: "bb".repeat(16) }, "TICKET_RIGHTS_ID_MISMATCH"],
  ]) {
    const { engine } = setup();
    const explicit = new Blob([`${options.ticketName || "aa".repeat(16)} = ${"22".repeat(16)}\n`]);
    await assert.rejects(
      ticketInitialize(engine, [fixture({ ticket: true, ...options })], explicit),
      { code },
    );
    await engine.execute("dispose");
  }
});
test("duplicate ticket keys are reused and conflicting ticket keys fail before native loading", async () => {
  const events = [];
  const env = setup({ onProgress: (event) => events.push(event) });
  // 合成边界要求六个 NCA；这里只检查早期密钥加载阶段。
  // The synthetic boundary expects six NCAs; inspect the early key-load stage only.
  await assert.rejects(
    ticketInitialize(env.engine, [fixture({ ticket: true }), fixture({ ticket: true })]),
    { code: "CONTENT_READ_FAILED" },
  );
  assert.equal(new TextDecoder().decode(env.title()), `${"aa".repeat(16)} = ${"11".repeat(16)}\n`);
  assert.equal(events.filter(({ stage }) => stage === "ticket-key-added").length, 1);
  assert.equal(events.filter(({ stage }) => stage === "ticket-key-reused").length, 1);
  assert(env.keys().every((bytes) => bytes.every((byte) => byte === 0)));
  await env.engine.execute("dispose");
  const conflict = setup();
  await assert.rejects(
    ticketInitialize(conflict.engine, [
      fixture({ ticket: true }),
      fixture({ ticket: true, ticketKey: 0x22 }),
    ]),
    { code: "TICKET_KEY_CONFLICT" },
  );
  assert.equal(conflict.keys(), undefined);
  await conflict.engine.execute("dispose");
});
test("ticket count and merged-key budget are enforced before native loading", async () => {
  const many = setup();
  await assert.rejects(
    ticketInitialize(many.engine, [fixture({ ticket: true, ticketCount: 4097 })]),
    { code: "TICKET_LIMIT_EXCEEDED" },
  );
  assert.equal(many.keys(), undefined);
  await many.engine.execute("dispose");
  const full = setup();
  const comments = ("#" + "x".repeat(4094) + "\n").repeat(256);
  await assert.rejects(
    ticketInitialize(full.engine, [fixture({ ticket: true })], new Blob([comments])),
    { code: "TICKET_LIMIT_EXCEEDED" },
  );
  assert.equal(full.keys(), undefined);
  await full.engine.execute("dispose");
});

test("merged buffers are wiped if the native loader fails", async () => {
  const env = setup({ failLoad: true });
  await assert.rejects(ticketInitialize(env.engine, [fixture({ ticket: true })]), {
    code: "KEYS_RUNTIME_FAILED",
    message: "KEYS_RUNTIME_FAILED",
  });
  assert(env.keys().every((bytes) => bytes.every((byte) => byte === 0)));
  await env.engine.execute("dispose");
});
test("explicit ID indexing handles comments, blank CRLF lines and missing final newline", async () => {
  const env = setup();
  const explicit = `# comment\r\n  \r\n\t${"AA".repeat(16)}, ${"22".repeat(16)}`;
  await ticketInitialize(
    env.engine,
    [fixture({ ticket: true, ticketType: 1 })],
    new Blob([explicit]),
  );
  assert.equal(new TextDecoder().decode(env.title()), explicit);
  await env.engine.execute("dispose");
});
