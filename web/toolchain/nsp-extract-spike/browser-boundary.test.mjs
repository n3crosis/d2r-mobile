// 依据模拟原生接口验证浏览器边界的密钥清理与生命周期约束。
// Verify browser-boundary key cleanup and lifecycle constraints using a mocked native interface.
import test from "node:test";
import assert from "node:assert/strict";
import { createBoundary } from "./browser-boundary.mjs";

test("native key bridge accepts an empty title file and wipes temporary files and input arrays", async () => {
  const previous = globalThis.FileReaderSync;
  globalThis.FileReaderSync = class {};
  const files = new Map();
  const writes = [];
  let loaded = false;
  try {
    const boundary = await createBoundary(async () => ({
      FS: {
        mkdir() {},
        writeFile(path, bytes) {
          const contents = bytes.slice();
          files.set(path, { contents });
          writes.push(contents);
        },
        lookupPath(path) {
          if (!files.has(path)) throw new Error("Not found");
          return { node: files.get(path) };
        },
        unlink(path) {
          files.delete(path);
        },
        readdir() {
          return [...files.keys()];
        },
      },
      _nsp_load_keys() {
        assert.ok(files.get("/secret/prod.keys").contents.length > 0);
        assert.equal(files.get("/secret/title.keys").contents.length, 0);
        loaded = true;
        return 0;
      },
      _nsp_reset() {},
      ccall() {
        return -6;
      },
      HEAPU8: new Uint8Array(16),
    }));
    const prod = new TextEncoder().encode(`header_key = ${"12".repeat(32)}\n`);
    const title = new Uint8Array();
    assert.equal(boundary.loadKeys(prod, title), 0);
    assert.equal(loaded, true);
    assert.equal(boundary.secretFilesPresent(), false);
    assert.throws(() => boundary.open(0), /^Error: TITLE_KEY_REQUIRED$/);
    assert.ok([prod, ...writes].every((bytes) => bytes.every((value) => value === 0)));
    boundary.dispose();
  } finally {
    if (previous === undefined) delete globalThis.FileReaderSync;
    else globalThis.FileReaderSync = previous;
  }
});

test("RomFS progress reports verified native bytes and restores the file reader", async () => {
  const previous = globalThis.FileReaderSync;
  globalThis.FileReaderSync = class {};
  try {
    const events = [];
    const operations = [];
    const streamOps = { read: () => 64 * 1024 * 1024 };
    const originalRead = streamOps.read;
    const boundary = await createBoundary(async (options) => ({
      FS: { mkdir() {} },
      WORKERFS: { stream_ops: streamOps },
      HEAPU8: new Uint8Array(16),
      _malloc: () => 1,
      _free() {},
      _nsp_zero() {},
      ccall(operation, _returnType, _argumentTypes, args) {
        operations.push(operation);
        if (operation === "nsp_open_patched_romfs") {
          options.onVerificationProgress(1, 0, 128 * 1024 * 1024);
          streamOps.read(null, null, 0, 64 * 1024 * 1024, 0);
          options.onVerificationProgress(1, 64 * 1024 * 1024, 128 * 1024 * 1024);
          options.onVerificationProgress(2, 0, 256 * 1024 * 1024);
          options.onVerificationProgress(2, 256 * 1024 * 1024, 256 * 1024 * 1024);
        } else assert.equal(operation, "nsp_open_patched_romfs_hash_verified");
        new DataView(this.HEAPU8.buffer).setBigUint64(args[2], 100n, true);
        return 0;
      },
    }));
    assert.equal(boundary.openPatchedRomfs(0, 1, (event) => events.push(event)).size, 100n);
    assert.equal(boundary.openPatchedRomfs(0, 1, undefined, false).size, 100n);
    assert.deepEqual(operations, [
      "nsp_open_patched_romfs",
      "nsp_open_patched_romfs_hash_verified",
    ]);
    assert.deepEqual(events, [
      { phase: "base", completed: 0, total: 128 * 1024 * 1024 },
      { phase: "base", completed: 64 * 1024 * 1024, total: 128 * 1024 * 1024 },
      { phase: "merged", completed: 0, total: 256 * 1024 * 1024 },
      { phase: "merged", completed: 256 * 1024 * 1024, total: 256 * 1024 * 1024 },
    ]);
    assert.equal(streamOps.read, originalRead);
  } finally {
    if (previous === undefined) delete globalThis.FileReaderSync;
    else globalThis.FileReaderSync = previous;
  }
});

test("older runtimes report real RomFS bytes read without inventing a percentage", async () => {
  const previous = globalThis.FileReaderSync;
  globalThis.FileReaderSync = class {};
  try {
    const events = [];
    const streamOps = { read: () => 64 * 1024 * 1024 };
    const boundary = await createBoundary(async () => ({
      FS: { mkdir() {} },
      WORKERFS: { stream_ops: streamOps },
      HEAPU8: new Uint8Array(16),
      _malloc: () => 1,
      _free() {},
      _nsp_zero() {},
      ccall(_operation, _returnType, _argumentTypes, args) {
        streamOps.read(null, null, 0, 64 * 1024 * 1024, 0);
        streamOps.read(null, null, 0, 64 * 1024 * 1024, 0);
        new DataView(this.HEAPU8.buffer).setBigUint64(args[1], 100n, true);
        return 0;
      },
    }));
    assert.equal(boundary.openRomfs(0, undefined, (event) => events.push(event)).size, 100n);
    assert.deepEqual(events, [
      { phase: "read", completed: 64 * 1024 * 1024, total: 0 },
      { phase: "read", completed: 128 * 1024 * 1024, total: 0 },
    ]);
  } finally {
    if (previous === undefined) delete globalThis.FileReaderSync;
    else globalThis.FileReaderSync = previous;
  }
});

test("failed RomFS open options revoke the previous reader", async () => {
  const previous = globalThis.FileReaderSync;
  globalThis.FileReaderSync = class {};
  try {
    let nativeReads = 0;
    const boundary = await createBoundary(async () => ({
      FS: { mkdir() {} },
      WORKERFS: { stream_ops: { read: () => 0 } },
      HEAPU8: new Uint8Array(16),
      _malloc: () => 1,
      _free() {},
      _nsp_zero() {},
      _nsp_read_romfs() {
        nativeReads++;
        return 1;
      },
      ccall(_operation, _returnType, _argumentTypes, args) {
        new DataView(this.HEAPU8.buffer).setBigUint64(args[1], 100n, true);
        return 0;
      },
    }));
    for (const invalidOpen of [
      () => boundary.openRomfs(0, undefined, undefined, "false"),
      () => boundary.openPatchedRomfs(0, -1),
    ]) {
      const reader = boundary.openRomfs(0);
      assert.throws(invalidOpen);
      assert.throws(() => reader.readAt(0n, 1), /Local extraction operation failed/);
      assert.equal(nativeReads, 0);
    }
  } finally {
    if (previous === undefined) delete globalThis.FileReaderSync;
    else globalThis.FileReaderSync = previous;
  }
});

test("failed key replacement revokes readers and clears native and temporary key state", async () => {
  const previous = globalThis.FileReaderSync;
  globalThis.FileReaderSync = class {};
  try {
    const files = new Map();
    const writes = [];
    let nativeKeys = false;
    let nativeReads = 0;
    let failure;
    const boundary = await createBoundary(async () => ({
      FS: {
        mkdir() {},
        writeFile(path, bytes) {
          if (failure === "write" && path.endsWith("title.keys")) throw new Error("I/O");
          const contents = bytes.slice();
          files.set(path, { contents });
          writes.push(contents);
        },
        lookupPath(path) {
          if (!files.has(path)) throw new Error("Not found");
          return { node: files.get(path) };
        },
        unlink(path) {
          files.delete(path);
        },
      },
      WORKERFS: { stream_ops: { read: () => 0 } },
      HEAPU8: new Uint8Array(16),
      _malloc: () => 1,
      _free() {},
      _nsp_zero() {},
      _nsp_reset() {
        nativeKeys = false;
      },
      _nsp_load_keys() {
        nativeKeys = true;
        if (failure === "throw") throw new Error("Native load failed");
        return failure === "native" ? -5 : 0;
      },
      _nsp_read_romfs() {
        nativeReads++;
        return 1;
      },
      ccall(_operation, _returnType, _argumentTypes, args) {
        assert.equal(nativeKeys, true);
        new DataView(this.HEAPU8.buffer).setBigUint64(args[1], 100n, true);
        return 0;
      },
    }));
    for (const mode of ["invalid", "write", "native", "throw"]) {
      failure = undefined;
      assert.equal(boundary.loadKeys(new Uint8Array([1]), new Uint8Array()), 0);
      const reader = boundary.openRomfs(0);
      failure = mode;
      const prod = mode === "invalid" ? new Uint8Array() : new Uint8Array([2]);
      const title = new Uint8Array([3]);
      assert.throws(() => boundary.loadKeys(prod, title), /Local extraction operation failed/);
      assert.throws(() => reader.readAt(0n, 1), /Local extraction operation failed/);
      assert.equal(nativeReads, 0);
      assert.equal(nativeKeys, false);
      assert.equal(files.size, 0);
      assert.ok([prod, title, ...writes].every((bytes) => bytes.every((value) => value === 0)));
    }
    boundary.dispose();
  } finally {
    if (previous === undefined) delete globalThis.FileReaderSync;
    else globalThis.FileReaderSync = previous;
  }
});

test("mount can recover after invalid replacement input or a failed replacement mount", async () => {
  const previous = globalThis.FileReaderSync;
  globalThis.FileReaderSync = class {};
  try {
    let mounted = false;
    let failMount = false;
    const boundary = await createBoundary(async () => ({
      FS: {
        mkdir() {},
        mount() {
          assert.equal(mounted, false);
          if (failMount) throw new Error("Mount failed");
          mounted = true;
        },
        unmount() {
          assert.equal(mounted, true);
          mounted = false;
        },
      },
      _nsp_close() {},
    }));
    boundary.mount([new Blob(["old"])]);
    assert.throws(() => boundary.mount(null), /Local extraction operation failed/);
    boundary.mount([new Blob(["new"])]);
    failMount = true;
    assert.throws(() => boundary.mount([]), /Local extraction operation failed/);
    failMount = false;
    boundary.mount([new Blob(["retry"])]);
    assert.equal(mounted, true);
  } finally {
    if (previous === undefined) delete globalThis.FileReaderSync;
    else globalThis.FileReaderSync = previous;
  }
});

for (const failure of ["reset", "unmount", "both"]) {
  test(`disposal remains irreversible and wipes the heap when ${failure} fails`, async () => {
    const previous = globalThis.FileReaderSync;
    globalThis.FileReaderSync = class {};
    try {
      const heap = new Uint8Array(32).fill(0xa5);
      const files = new Map([
        ["/secret/prod.keys", { contents: new Uint8Array([1, 2]) }],
        ["/secret/title.keys", { contents: new Uint8Array([3, 4]) }],
      ]);
      const secretBytes = [...files.values()].map((node) => node.contents);
      const calls = [];
      const resetError = new Error("Synthetic reset failure");
      const unmountError = new Error("Synthetic unmount failure");
      const boundary = await createBoundary(async () => ({
        FS: {
          mkdir() {},
          mount() {},
          unmount() {
            calls.push("unmount");
            if (failure !== "reset") throw unmountError;
          },
          lookupPath(path) {
            return { node: files.get(path) };
          },
          unlink(path) {
            files.delete(path);
          },
        },
        HEAPU8: heap,
        _nsp_close() {
          calls.push("close");
        },
        _nsp_reset() {
          calls.push("reset");
          if (failure !== "unmount") throw resetError;
        },
        _nsp_crypto_fixture() {
          calls.push("fixture");
          return 0;
        },
      }));
      boundary.mount([new Blob(["synthetic input"])]);
      assert.throws(
        () => boundary.dispose(),
        (error) => error === (failure === "reset" ? resetError : unmountError),
      );
      assert.ok(heap.every((byte) => byte === 0));
      assert.equal(files.size, 0);
      assert.ok(secretBytes.every((bytes) => bytes.every((byte) => byte === 0)));
      assert.throws(() => boundary.mount([]), /Extractor has been disposed/);
      assert.throws(() => boundary.cryptoFixture(), /Extractor has been disposed/);
      assert.doesNotThrow(() => boundary.dispose());
      assert.deepEqual(calls, ["close", "reset", "unmount"]);
    } finally {
      if (previous === undefined) delete globalThis.FileReaderSync;
      else globalThis.FileReaderSync = previous;
    }
  });
}
