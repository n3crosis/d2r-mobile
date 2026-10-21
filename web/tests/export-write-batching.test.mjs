// 合成字节和文件系统调用计数，不代表磁盘速度或浏览器表现。
// Synthetic bytes and filesystem call counts are not disk-speed or browser evidence.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { exportRomfsResources } from "../resource-folder-export.mjs";
import { exportLegacyDevicePack } from "../legacy-device-pack-export.mjs";
import {
  createResourceWriteBuffer,
  RESOURCE_WRITE_BUFFER_BYTES as BATCH,
} from "../resource-write-buffer.mjs";
const contents = Uint8Array.from({ length: 2 * 1024 * 1024 + 17 }, (_, i) => i % 251);
const sourceText = await readFile(
  new URL("../resource-folder-export.mjs", import.meta.url),
  "utf8",
);
const native = [...sourceText.matchAll(/\["([\d-]+\.data)", (\d+)n\]/g)].map(([, name, size]) => ({
  path: `data/${name}`,
  size: BigInt(size),
}));
function fixture(kind, mode) {
  let reads = 0,
    written = 0;
  const calls = [],
    controller = new AbortController();
  const stop = Error("stop after synthetic first resource");
  function directory() {
    const entries = new Map();
    const handle = {
      kind: "directory",
      isSameEntry: async (other) => other === handle,
      queryPermission: async () => "granted",
      getDirectoryHandle: async (name, options) => get(name, options, true),
      getFileHandle: async (name, options) => get(name, options, false),
      async removeEntry(name, options) {
        assert.equal(options, undefined);
        if (entries.get(name)?.entries?.size) throw Error("not empty");
        entries.delete(name);
      },
      entries,
    };
    function get(name, options, isDir) {
      if (!entries.has(name)) {
        if (!options?.create) throw new DOMException("missing", "NotFoundError");
        entries.set(name, isDir ? directory() : file(name));
      }
      return entries.get(name);
    }
    return handle;
  }
  function file(name) {
    let size = 0;
    const handle = {
      kind: "file",
      isSameEntry: async (other) => other === handle,
      getFile: async () => ({ size }),
      async createWritable() {
        size = 0;
        return {
          async write(bytes) {
            if (name === "000-test.bin" || name === "00-00000008.data") {
              calls.push(bytes.length);
              assert.ok(bytes.length <= BATCH);
              if (mode === "write-fail" && calls.length === 2) throw stop;
              assert.deepEqual(bytes, contents.subarray(written, written + bytes.length));
              written += bytes.length;
              if (mode === "write-cancel") controller.abort();
            }
            size += bytes.length;
          },
          close: async () => {},
          abort: async () => {},
        };
      },
    };
    return handle;
  }
  const root = directory();
  async function readAt(offset, count) {
    reads++;
    assert.ok(count <= 65536);
    const bytes = contents.slice(Number(offset), Number(offset) + count);
    if (mode === "read-cancel" && reads === 2) controller.abort();
    return bytes;
  }
  const run = () =>
    kind === "legacy"
      ? exportLegacyDevicePack({
          outputDirectoryHandle: root,
          secureContext: true,
          signal: controller.signal,
          finalizedPack: {
            pack: { name: "00-00000008.data", size: contents.length, sha256: "a".repeat(64) },
            source: { size: contents.length, file: { size: contents.length }, readAt },
          },
        })
      : exportRomfsResources({
          outputDirectoryHandle: root,
          signal: controller.signal,
          romfs: {
            files: [{ path: "000-test.bin", size: BigInt(contents.length) }, ...native],
            getFile(path) {
              if (path === "000-test.bin") return { size: BigInt(contents.length), readAt };
              const entry = native.find((file) => file.path === path);
              return {
                size: entry.size,
                readAt: async () => {
                  throw stop;
                },
              };
            },
          },
        });
  return {
    run,
    controller,
    calls,
    stop,
    get reads() {
      return reads;
    },
    get written() {
      return written;
    },
  };
}
for (const kind of ["legacy", "resources"])
  for (const mode of ["exact", "read-cancel", "write-cancel", "write-fail"])
    test(`${kind}: bounded batch ${mode}`, async () => {
      const old = Object.getOwnPropertyDescriptor(globalThis, "isSecureContext");
      Object.defineProperty(globalThis, "isSecureContext", { value: true, configurable: true });
      try {
        const f = fixture(kind, mode);
        let report;
        try {
          report = await f.run();
        } catch (error) {
          report = error.report;
          if (mode === "exact") assert.equal(error.cause, f.stop);
        }
        assert.ok(report);
        if (mode === "exact") {
          assert.equal(f.reads, 33);
          assert.deepEqual(f.calls, [BATCH, BATCH, 17]);
          assert.equal(f.written, contents.length);
          assert.equal(Number(report.bytesWritten), contents.length);
        } else if (mode === "read-cancel") {
          assert.equal(f.reads, 2);
          assert.deepEqual(f.calls, []);
          assert.equal(Number(report.bytesWritten), 0);
        } else {
          assert.equal(Number(report.bytesWritten), BATCH);
          assert.equal(f.written, BATCH);
          assert.deepEqual(f.calls, mode === "write-fail" ? [BATCH, BATCH] : [BATCH]);
        }
        if (mode !== "exact") assert.equal(report.status, "incomplete");
      } finally {
        if (old) Object.defineProperty(globalThis, "isSecureContext", old);
        else delete globalThis.isSecureContext;
      }
    });
test("coalescer copies without mutating source aliases and wipes retained buffer after writes", async () => {
  const source = new Uint8Array(65536).fill(7),
    alias = source.subarray(0);
  let sent,
    written = 0;
  const buffer = createResourceWriteBuffer({
    check() {},
    written: (n) => (written += n),
    write: async (bytes) => {
      sent = bytes;
      assert.equal(bytes[0], 7);
    },
  });
  await buffer.append(source);
  assert.equal(written, 0);
  assert.equal(alias[0], 7);
  await buffer.flush();
  assert.equal(written, source.length);
  assert.ok(sent.every((n) => n === 0));
  assert.ok(alias.every((n) => n === 7));
  buffer.dispose();
});
test("coalescer enforces serial backpressure and rejects concurrent disposal", async () => {
  let release,
    calls = 0;
  const buffer = createResourceWriteBuffer({
    check() {},
    written() {},
    write: async () => {
      calls++;
      await new Promise((resolve) => {
        release = resolve;
      });
    },
  });
  await buffer.append(Uint8Array.of(9));
  const pending = buffer.flush();
  await assert.rejects(buffer.flush(), /BUSY/);
  await assert.rejects(buffer.append(Uint8Array.of(8)), /BUSY/);
  assert.throws(() => buffer.dispose(), /BUSY/);
  assert.equal(calls, 1);
  release();
  await pending;
  buffer.dispose();
});

test("coalescer clears only used tails while all retained backing bytes remain zero", async (t) => {
  const fills = [],
    originalFill = Uint8Array.prototype.fill;
  t.mock.method(Uint8Array.prototype, "fill", function (value, start = 0, end = this.length) {
    if (this.length === BATCH && value === 0) fills.push(end - start);
    return originalFill.call(this, value, start, end);
  });
  let retained;
  const buffer = createResourceWriteBuffer({
    check() {},
    written() {},
    write: async (bytes) => {
      retained = new Uint8Array(bytes.buffer);
    },
  });
  for (const count of [65536, 17, 1]) {
    await buffer.append(new Uint8Array(count).fill(7));
    await buffer.flush();
    assert.ok(retained.every((value) => value === 0));
  }
  assert.deepEqual(fills, [65536, 17, 1]);
  buffer.dispose();
  assert.ok(retained.every((value) => value === 0));
});
