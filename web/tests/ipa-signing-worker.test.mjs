// 合成依赖只测试生命周期与 ABI，不声称合成字节具有有效签名。
// Synthetic dependencies test lifecycle and ABI only, not signature validity of synthetic bytes.
import test from "node:test";
import assert from "node:assert/strict";
import {
  createIpaSigningWorkerHandler,
  invokeSigningNative,
  SIGNING_NATIVE_PATHS,
} from "../ipa-signing-worker-core.mjs";
const makeCredentials = () => ({
  kind: "p12",
  identity: new Uint8Array([1, 2]).buffer,
  profile: new Uint8Array([3, 4]).buffer,
  password: "synthetic",
});
const input = () => new Blob([new Uint8Array(30)]);
function fakeNative(code = 0) {
  const files = new Map(),
    freed = [],
    calls = [];
  let at = 16;
  const native = {
    HEAPU8: new Uint8Array(4096),
    _malloc(size) {
      const p = at;
      at += size;
      return p;
    },
    _free(pointer) {
      freed.push(pointer);
    },
    _zsign_sign_bundle(...args) {
      const strings = args.slice(0, 9).map((p) => {
        const end = native.HEAPU8.indexOf(0, p);
        return new TextDecoder().decode(native.HEAPU8.slice(p, end));
      });
      calls.push({ strings, flags: args.slice(9) });
      return code;
    },
    FS: {
      mkdirTree() {},
      writeFile(path, bytes) {
        files.set(path, { contents: bytes.slice() });
      },
      lookupPath(path) {
        if (!files.has(path)) throw Error("missing");
        return { node: files.get(path) };
      },
      unlink(path) {
        files.delete(path);
      },
    },
  };
  return { native, files, freed, calls };
}
function harness(overrides = {}) {
  const mock = fakeNative(),
    messages = [],
    events = [];
  let closed = 0;
  const archive = { appRoot: "Payload/Original.app/", entries: [] };
  const entries = ["embedded.mobileprovision", "_CodeSignature/CodeResources"].map((p) => ({
    path: archive.appRoot + p,
    size: 1,
    mode: 0o644,
    blob: new Blob(["x"]),
  }));
  const dependencies = {
    createNative: async () => mock.native,
    inspectArchive: async () => {
      events.push("inspect");
      return archive;
    },
    mountArchive: () => ({
      collectEntries() {
        events.push("collect");
        return entries;
      },
      dispose() {
        events.push("dispose");
      },
    }),
    createArchive: async () => {
      events.push("package");
      return input();
    },
    postMessage: (message) => {
      if (message.ok && message.id === 1) {
        assert.equal(mock.files.size, 0);
        assert.ok(mock.native.HEAPU8.every((v) => v === 0));
        events.push("reply");
      }
      messages.push(message);
    },
    closeWorker: () => {
      closed++;
    },
    ...overrides,
  };
  const handle = createIpaSigningWorkerHandler(dependencies);
  return {
    ...mock,
    messages,
    events,
    handle,
    get closed() {
      return closed;
    },
  };
}
const initialize = (h) =>
  h.handle({ id: 0, type: "initialize", assets: [["zsign.wasm", new ArrayBuffer(8)]] });
test("one-shot worker composes stages then removes credentials and wipes heap before success", async () => {
  const h = harness();
  await initialize(h);
  const credentials = makeCredentials();
  await h.handle({ id: 1, type: "sign", ipa: input(), credentials });
  assert.deepEqual(h.events, ["inspect", "collect", "package", "dispose", "reply"]);
  assert.equal(h.messages.at(-1).ok, true);
  assert.equal(h.closed, 1);
  assert.equal(credentials.password, "");
  assert.ok(new Uint8Array(credentials.identity).every((v) => v === 0));
  assert.deepEqual(h.calls[0].strings, [
    SIGNING_NATIVE_PATHS.app,
    "",
    SIGNING_NATIVE_PATHS.identity,
    SIGNING_NATIVE_PATHS.profile,
    "synthetic",
    "",
    "",
    "",
    "",
  ]);
  assert.deepEqual(h.calls[0].flags, [0, 1, 1, 0, 0]);
});
test("native string allocations are zeroed and freed, including non-ASCII password", () => {
  const h = fakeNative();
  invokeSigningNative(h.native, "测试-password");
  assert.equal(h.calls[0].strings[4], "测试-password");
  assert.equal(h.freed.length, 9);
  assert.ok(h.native.HEAPU8.every((v) => v === 0));
});
test("native failure still wipes strings and reports a closed error", () => {
  const h = fakeNative(-203);
  assert.throws(() => invokeSigningNative(h.native, "private"), /SIGNING_IDENTITY_INVALID/);
  assert.equal(h.freed.length, 9);
  assert.ok(h.native.HEAPU8.every((v) => v === 0));
});
test("raw packaging failure is sanitized and no partial output is published", async () => {
  const h = harness({
    createArchive: async () => {
      throw Error("private certificate path");
    },
  });
  await initialize(h);
  await h.handle({ id: 1, type: "sign", ipa: input(), credentials: makeCredentials() });
  assert.deepEqual(h.messages.at(-1), { id: 1, ok: false, error: { code: "SIGNING_FAILED" } });
  assert.equal(h.files.size, 0);
  assert.ok(h.native.HEAPU8.every((v) => v === 0));
  assert.equal(h.closed, 1);
});
test("missing signature resources never reach packaging", async () => {
  let packaged = false;
  const h = harness({
    mountArchive: () => ({ collectEntries: () => [], dispose() {} }),
    createArchive: async () => {
      packaged = true;
      return input();
    },
  });
  await initialize(h);
  await h.handle({ id: 1, type: "sign", ipa: input(), credentials: makeCredentials() });
  assert.equal(packaged, false);
  assert.equal(h.messages.at(-1).error.code, "SIGNING_OUTPUT_INVALID");
});
test("bad inputs and embedded NUL password never reach native", async () => {
  const h = harness();
  await initialize(h);
  const credentials = makeCredentials();
  credentials.password = "a\0b";
  await h.handle({ id: 1, type: "sign", ipa: input(), credentials });
  assert.equal(h.calls.length, 0);
  assert.equal(h.messages.at(-1).error.code, "SIGNING_INPUT_INVALID");
  assert.ok(new Uint8Array(credentials.profile).every((v) => v === 0));
});
test("a second request during inspection closes protocol and prevents native continuation", async () => {
  let resume;
  const archive = { appRoot: "Payload/Original.app/", entries: [] };
  const h = harness({
    inspectArchive: () =>
      new Promise((resolve) => {
        resume = () => resolve(archive);
      }),
  });
  await initialize(h);
  const first = h.handle({ id: 1, type: "sign", ipa: input(), credentials: makeCredentials() });
  const credentials = makeCredentials();
  await h.handle({ id: 1, type: "sign", ipa: input(), credentials });
  resume();
  await first;
  assert.equal(h.calls.length, 0);
  assert.equal(h.closed, 1);
  assert.equal(h.messages.at(-1).error.code, "SIGNING_PROTOCOL_INVALID");
  assert.ok(h.native.HEAPU8.every((v) => v === 0));
});
test("initialization failure is sanitized; no private work can run after close", async () => {
  const h = harness({
    createNative: async () => {
      throw Error("native private detail");
    },
  });
  await initialize(h);
  assert.equal(h.messages.at(-1).error.code, "SIGNING_INITIALIZATION_FAILED");
  const credentials = makeCredentials();
  await h.handle({ id: 1, type: "sign", ipa: input(), credentials });
  assert.ok(new Uint8Array(credentials.identity).every((v) => v === 0));
  assert.equal(h.closed, 1);
});

test("native profile mismatch is closed, wipes credentials and never packages output", async () => {
  const h = harness();
  h.native._zsign_sign_bundle = () => -206;
  await initialize(h);
  const credentials = makeCredentials();
  await h.handle({ id: 1, type: "sign", ipa: input(), credentials });
  assert.deepEqual(h.messages.at(-1), {
    id: 1,
    ok: false,
    error: { code: "SIGNING_PROFILE_MISMATCH" },
  });
  assert.deepEqual(h.events, ["inspect", "dispose"]);
  assert.equal(h.files.size, 0);
  assert.equal(h.freed.length, 9);
  assert.ok(h.native.HEAPU8.every((value) => value === 0));
  assert.equal(credentials.password, "");
  assert.equal(h.closed, 1);
});
