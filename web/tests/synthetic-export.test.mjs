// 验证 synthetic-export 的约定与边界；依据 ../synthetic-export.mjs、../guest-framework.mjs 及本文件的测试断言。
// Verify synthetic-export contracts and boundaries against ../synthetic-export.mjs、../guest-framework.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import {
  exportSyntheticArchive,
  syntheticModules,
  SYNTHETIC_CHUNK_BYTES,
  SYNTHETIC_FILENAME,
} from "../synthetic-export.mjs";
import { buildGuestFramework, guestInfoPlist } from "../guest-framework.mjs";

function sink() {
  return {
    parts: [],
    closed: 0,
    aborted: 0,
    async write(bytes) {
      this.parts.push(bytes.slice());
    },
    async close() {
      this.closed++;
    },
    async abort() {
      this.aborted++;
    },
  };
}
// 解析中央目录及本地载荷，不访问磁盘或用户文件。
// Parse central directory and local payloads without disk or user file access.
function unpack(parts) {
  const bytes = Buffer.concat(parts),
    view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const end = bytes.length - 22;
  assert.equal(view.getUint32(end, true), 0x06054b50);
  let at = view.getUint32(end + 16, true);
  const files = new Map();
  for (let i = 0; i < view.getUint16(end + 10, true); i++) {
    assert.equal(view.getUint32(at, true), 0x02014b50);
    const size = view.getUint32(at + 24, true),
      nameLength = view.getUint16(at + 28, true);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString();
    const local = view.getUint32(at + 42, true);
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    files.set(name, bytes.subarray(start, start + size));
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return files;
}
test("synthetic ZIP contains exactly the generated Guest, plist and explicit warning; chunks and progress are bounded", async () => {
  const out = sink(),
    progress = [];
  const result = await exportSyntheticArchive(out, {
    crypto: webcrypto,
    onProgress: (p) => progress.push(p),
  });
  assert.equal(SYNTHETIC_FILENAME, "d2r-packager-synthetic-test.zip");
  assert.equal(out.closed, 1);
  assert.equal(out.aborted, 0);
  assert.ok(out.parts.every((p) => p.length <= SYNTHETIC_CHUNK_BYTES));
  assert.equal(
    result.bytesWritten,
    out.parts.reduce((n, p) => n + p.length, 0),
  );
  assert.equal(result.entries, 3);
  const files = unpack(out.parts);
  assert.deepEqual(
    [...files.keys()],
    ["Guest.framework/Guest", "Guest.framework/Info.plist", "README-NOT-INSTALLABLE.txt"],
  );
  const expected = await buildGuestFramework(syntheticModules(), { crypto: webcrypto });
  assert.deepEqual(new Uint8Array(files.get("Guest.framework/Guest")), expected);
  assert.equal(
    files.get("Guest.framework/Info.plist").toString(),
    guestInfoPlist("local.synthetic.guest"),
  );
  assert.match(files.get("README-NOT-INSTALLABLE.txt").toString(), /^NOT INSTALLABLE/);
  assert.match(files.get("README-NOT-INSTALLABLE.txt").toString(), /NO GAME CONTENT/);
  assert.equal(progress[0].phase, "generating");
  assert.equal(progress[0].bytesWritten, 0);
  assert.equal(progress.at(-1).phase, "finishing");
  assert.equal(progress.at(-1).bytesWritten, result.bytesWritten);
  assert.ok(progress.every((p, i) => !i || p.bytesWritten >= progress[i - 1].bytesWritten));
});
test("pre-abort and generation failure abort the sink before ZIP writes begin", async () => {
  const controller = new AbortController();
  controller.abort();
  for (const options of [{ signal: controller.signal, crypto: webcrypto }, { crypto: {} }]) {
    const out = sink();
    await assert.rejects(exportSyntheticArchive(out, options));
    assert.equal(out.parts.length, 0);
    assert.equal(out.aborted, 1);
    assert.equal(out.closed, 0);
  }
});
test("cancellation during framework hashing aborts without starting ZIP", async () => {
  const out = sink(),
    controller = new AbortController();
  const crypto = {
    subtle: {
      async digest(...args) {
        const digest = await webcrypto.subtle.digest(...args);
        controller.abort();
        return digest;
      },
    },
  };
  await assert.rejects(exportSyntheticArchive(out, { crypto, signal: controller.signal }), {
    name: "AbortError",
  });
  assert.equal(out.parts.length, 0);
  assert.equal(out.aborted, 1);
  assert.equal(out.closed, 0);
});
test("cancellation while writing aborts exactly once and does not close", async () => {
  const out = sink(),
    controller = new AbortController();
  out.write = async () => {
    controller.abort();
  };
  await assert.rejects(
    exportSyntheticArchive(out, { crypto: webcrypto, signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(out.aborted, 1);
  assert.equal(out.closed, 0);
});
test("write and close failures preserve original error and abort exactly once", async () => {
  for (const operation of ["write", "close"]) {
    const out = sink(),
      failure = new Error(`${operation} failed`);
    out[operation] = async () => {
      throw failure;
    };
    out.abort = async function () {
      this.aborted++;
      throw new Error("cleanup failed");
    };
    await assert.rejects(exportSyntheticArchive(out, { crypto: webcrypto }), (e) => e === failure);
    assert.equal(out.aborted, 1);
  }
});
test("late cancellation after close starts does not report a committed save as cancelled", async () => {
  const out = sink(),
    controller = new AbortController();
  out.close = async function () {
    controller.abort();
    this.closed++;
  };
  const result = await exportSyntheticArchive(out, {
    crypto: webcrypto,
    signal: controller.signal,
  });
  assert.equal(out.closed, 1);
  assert.equal(out.aborted, 0);
  assert.equal(result.entries, 3);
});
