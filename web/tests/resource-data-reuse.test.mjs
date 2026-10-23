// 只使用合成字节，证明有界只读复用，而非游戏/设备兼容性。
// Synthetic bytes only: these tests establish bounded, read-only reuse, not game/device compatibility.
import test from "node:test";
import assert from "node:assert/strict";
import { verifyResourceData } from "../resource-data-reuse.mjs";
import { exportRomfsResources, RESOURCE_EXPORT_MARKER } from "../resource-folder-export.mjs";
import { withResourceOutputLock } from "../resource-output-lock.mjs";
import { resourceOutputLocks } from "./fixtures/resource-output-locks.mjs";
import { readFile } from "node:fs/promises";

function fixture() {
  const owned = [],
    progress = [],
    reads = [],
    operations = [];
  const source = new Map([
    ["archive.data", Uint8Array.from({ length: 70003 }, (_, i) => i % 251)],
    ["nested/manifest.txt", new TextEncoder().encode("synthetic current update")],
  ]);
  function file(bytes) {
    const handle = {
      kind: "file",
      bytes,
      isSameEntry: async (other) => other === handle,
      getFile: async () => new Blob([handle.bytes]),
      createWritable() {
        operations.push("write");
        throw Error("must not write");
      },
    };
    return handle;
  }
  function directory() {
    const children = new Map();
    const handle = {
      kind: "directory",
      children,
      queryPermission: async () => "granted",
      isSameEntry: async (other) => other === handle,
      async *entries() {
        yield* children;
      },
      async getFileHandle(name, options) {
        return get(name, "file", options);
      },
      async getDirectoryHandle(name, options) {
        return get(name, "directory", options);
      },
      removeEntry() {
        operations.push("remove");
        throw Error("must not remove");
      },
    };
    function get(name, kind, options) {
      if (options?.create) {
        operations.push("create");
        throw Error("must not create");
      }
      const value = children.get(name);
      if (!value) throw new DOMException("missing", "NotFoundError");
      if (value.kind !== kind) throw new DOMException("kind", "TypeMismatchError");
      return value;
    }
    return handle;
  }
  const data = directory(),
    nested = directory(),
    root = directory();
  data.children.set("archive.data", file(source.get("archive.data").slice()));
  nested.children.set("manifest.txt", file(source.get("nested/manifest.txt").slice()));
  data.children.set("nested", nested);
  data.children.set(
    RESOURCE_EXPORT_MARKER,
    file(new TextEncoder().encode('{"status":"complete","untrusted":true}')),
  );
  root.children.set("data", data);
  const entries = [...source].map(([path, bytes]) => ({
    path,
    sourcePath: `data/${path}`,
    size: BigInt(bytes.length),
  }));
  const romfs = {
    getFile(path) {
      const bytes = source.get(path.slice("data/".length));
      return (
        bytes && {
          size: BigInt(bytes.length),
          async readAt(offset, count) {
            assert.ok(count <= 65536);
            reads.push([offset, count]);
            const copy = bytes.slice(Number(offset), Number(offset) + count);
            owned.push(copy);
            return copy;
          },
        }
      );
    },
  };
  const options = {
    directory: data,
    entries,
    romfs,
    markerName: RESOURCE_EXPORT_MARKER,
    onProgress: (value) => progress.push(value),
  };
  return {
    root,
    data,
    nested,
    options,
    operations,
    reads,
    owned,
    progress,
    file,
    directory,
    source,
  };
}

test("existing data is compared completely in bounded chunks without any writes or trusting its marker", async () => {
  const f = fixture(),
    marker = f.data.children.get(RESOURCE_EXPORT_MARKER);
  const result = await verifyResourceData(f.options);
  assert.deepEqual(result, { filesVerified: 2, bytesVerified: 70027n });
  assert.deepEqual(f.progress.at(-1), result);
  assert.equal(f.reads.length, 3);
  assert.ok(f.owned.every((bytes) => bytes.every((byte) => byte === 0)));
  assert.equal(f.data.children.get(RESOURCE_EXPORT_MARKER), marker);
  assert.deepEqual(f.operations, []);
});

test("missing, extra, wrong-size and same-size changed files cannot reuse a claimed-complete folder", async () => {
  for (const mode of ["missing", "extra", "size", "bytes", "empty-dir", "marker-dir"]) {
    const f = fixture();
    if (mode === "missing") f.nested.children.delete("manifest.txt");
    if (mode === "extra") f.data.children.set("foreign.data", f.file(new Uint8Array()));
    if (mode === "size") f.data.children.get("archive.data").bytes = new Uint8Array(3);
    if (mode === "bytes") f.data.children.get("archive.data").bytes[65536] ^= 1;
    if (mode === "empty-dir") f.data.children.set("foreign", f.directory());
    if (mode === "marker-dir") f.data.children.set(RESOURCE_EXPORT_MARKER, f.directory());
    const before = [...f.data.children];
    await assert.rejects(verifyResourceData(f.options), /RESOURCE_EXISTING_DATA_UNVERIFIED/);
    assert.deepEqual([...f.data.children], before);
    assert.deepEqual(f.operations, []);
    assert.ok(f.owned.every((bytes) => bytes.every((byte) => byte === 0)));
  }
});

test("cancellation, short source reads and replaced handles cannot finish verification", async () => {
  for (const mode of ["cancel", "short", "replace"]) {
    const f = fixture(),
      controller = new AbortController(),
      original = f.options.romfs.getFile;
    f.options.romfs.getFile = (path) => {
      const source = original(path),
        read = source.readAt;
      source.readAt = async (...args) => {
        const bytes = await read(...args);
        if (mode === "cancel") controller.abort();
        if (mode === "short") return bytes.subarray(1);
        if (mode === "replace")
          f.data.children.set("archive.data", f.file(f.source.get("archive.data").slice()));
        return bytes;
      };
      return source;
    };
    await assert.rejects(verifyResourceData({ ...f.options, signal: controller.signal }));
    assert.deepEqual(f.operations, []);
    if (mode !== "short") assert.ok(f.owned.every((bytes) => bytes.every((byte) => byte === 0)));
  }
});

test("exporter preserves mismatching input/data instead of treating it as owned cleanup", async (t) => {
  const prior = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext");
  Object.defineProperty(globalThis, "isSecureContext", { value: true, configurable: true });
  t.after(() => {
    if (prior) Object.defineProperty(globalThis, "isSecureContext", prior);
    else delete globalThis.isSecureContext;
  });
  const f = fixture();
  const text = await readFile(new URL("../resource-folder-export.mjs", import.meta.url), "utf8");
  f.options.romfs.files = [...text.matchAll(/\["([\d-]+\.data)", (\d+)n\]/g)].map(
    ([, name, size]) => ({ path: `data/${name}`, size: BigInt(size) }),
  );
  assert.equal(f.options.romfs.files.length, 18);
  await assert.rejects(
    exportRomfsResources({
      romfs: f.options.romfs,
      outputDirectoryHandle: f.root,
      locks: resourceOutputLocks(),
    }),
    (error) => {
      assert.equal(error.report.directoryName, "data");
      assert.equal(error.report.existingDataPreserved, true);
      assert.equal(error.report.reason, "RESOURCE_EXISTING_DATA_UNVERIFIED");
      return true;
    },
  );
  assert.equal(f.root.children.get("data"), f.data);
  assert.deepEqual(f.operations, []);
});

test("same-origin exports are exclusive through completion and lock failures never touch files", async () => {
  const locks = resourceOutputLocks();
  let release,
    entered = false;
  const first = withResourceOutputLock(
    locks,
    undefined,
    () =>
      new Promise((resolve) => {
        entered = true;
        release = resolve;
      }),
  );
  assert.ok(entered);
  await assert.rejects(
    withResourceOutputLock(locks, undefined, () => assert.fail("must not run")),
    /RESOURCE_EXPORT_BUSY/,
  );
  release("complete");
  assert.equal(await first, "complete");
  assert.equal(await withResourceOutputLock(locks, undefined, () => "next"), "next");
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    withResourceOutputLock(locks, controller.signal, () => assert.fail("must not run")),
    { name: "AbortError" },
  );
  await assert.rejects(
    exportRomfsResources({ locks: {} }),
    (error) =>
      error.report.reason === "RESOURCE_EXPORT_LOCK_UNAVAILABLE" &&
      error.report.directoryName === null,
  );
});
