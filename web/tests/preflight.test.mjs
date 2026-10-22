import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import {
  safeRelativePath,
  indexFiles,
  readRange,
  inspectNso,
  fileSource,
  MAX_READ_BYTES,
  REQUIRED_NSO_MODULES,
  ZIP_PATH_LIMITS,
} from "../preflight.mjs";

function fixture() {
  const bytes = new Uint8Array(0x130),
    v = new DataView(bytes.buffer);
  bytes.set([0x4e, 0x53, 0x4f, 0x30]);
  for (let i = 0; i < 3; i++) {
    v.setUint32(0x10 + i * 16, 0x100 + i * 16, true);
    v.setUint32(0x14 + i * 16, i * 0x1000, true);
    v.setUint32(0x18 + i * 16, 16, true);
  }
  return bytes;
}
const source = (bytes) => ({ size: bytes.length, read: async (o, n) => bytes.slice(o, o + n) });
test("accepts safe paths and rejects cross-platform dangerous paths", () => {
  assert.equal(safeRelativePath("ExeFS/main"), "ExeFS/main");
  for (const p of [
    "",
    "/root",
    "../x",
    "a/../x",
    "a//x",
    "C:/x",
    "a\\b",
    "a\0b",
    "x.",
    "x ",
    "CON",
    "aux.txt",
    "e\u0301",
  ]) {
    assert.throws(() => safeRelativePath(p), /Unsafe/);
  }
});
test("indexes metadata without reading bytes and rejects duplicates", () => {
  assert.equal(indexFiles([{ path: "RomFS/data/archive.data", size: 6 * 1024 ** 3 }]).size, 1);
  assert.throws(
    () =>
      indexFiles([
        { path: "a", size: 1 },
        { path: "A", size: 2 },
      ]),
    /Conflicting/,
  );
  assert.throws(
    () =>
      indexFiles([
        { path: "a", size: 1 },
        { path: "a/b", size: 2 },
      ]),
    /conflict/,
  );
  assert.throws(() => indexFiles([{ path: "a", size: NaN }]), /size/);
});
test("implicit directories retain one case spelling regardless of entry order", () => {
  for (const paths of [
    ["Resources/a", "resources/b"],
    ["Resources/nested/a", "Resources/Nested/b"],
    ["Éléments/a", "éléments/b"],
  ]) {
    for (const order of [paths, [...paths].reverse()])
      assert.throws(() => indexFiles(order.map((path) => ({ path, size: 0 }))), /conflict/i);
  }
  const files = ["Resources/a", "Resources/b", "Resources/Nested/a", "Resources/Nested/b"].map(
    (path) => ({ path, size: 0 }),
  );
  assert.deepEqual(
    [...indexFiles(files).keys()],
    files.map(({ path }) => path),
  );
  for (const paths of [
    ["Resources/a", "resources"],
    ["Resources", "resources/a"],
  ])
    assert.throws(() => indexFiles(paths.map((path) => ({ path, size: 0 }))), /conflict/i);
});
test("optional path-index budgets bound depth and all distinct files and directories", () => {
  const limits = { maxPathDepth: 3, maxPathNodes: 4 };
  const entries = (paths) => paths.map((path) => ({ path, size: 0 }));
  assert.equal(indexFiles(entries(["a/b/c", "a/b/d"]), limits).size, 2);
  assert.throws(() => indexFiles(entries(["a/b/c", "a/b/d", "e"]), limits), /node limit/);
  assert.throws(() => indexFiles(entries(["a/b/c/d"]), limits), /depth limit/);
  assert.throws(
    () => indexFiles(entries(["x/".repeat(2000) + "file"]), ZIP_PATH_LIMITS),
    /depth limit/,
  );
  assert.equal(indexFiles(entries(["x/".repeat(64) + "file"])).size, 1);
  for (const key of ["maxPathDepth", "maxPathNodes"])
    for (const value of [-1, 1.5, NaN, -Infinity, Number.MAX_SAFE_INTEGER + 1, "32", null])
      assert.throws(() => indexFiles([], { [key]: value }), /Invalid path index limit/);
  assert.equal(indexFiles([], { maxPathDepth: 0, maxPathNodes: 0 }).size, 0);
});
test("NSO reads only 256 bytes even for virtual multi-GB input", async () => {
  const calls = [];
  const result = await inspectNso({
    size: 6 * 1024 ** 3,
    read: async (o, n) => {
      calls.push([o, n]);
      return fixture().slice(o, o + n);
    },
  });
  assert.deepEqual(calls, [[0, 256]]);
  assert.equal(result.segments.length, 3);
  assert.equal(result.versionVerified, false);
});
test("rejects malformed, truncated, out-of-bounds and overlapping NSO", async () => {
  await assert.rejects(inspectNso(source(new Uint8Array(12))), /range/);
  await assert.rejects(inspectNso(source(new Uint8Array(256))), /NSO0/);
  for (const [offset, value] of [
    [4, 1],
    [12, 128],
    [16, 0xfffffff0],
    [0x20, 0x100],
    [0x24, 0],
  ]) {
    const b = fixture();
    new DataView(b.buffer).setUint32(offset, value, true);
    await assert.rejects(inspectNso(source(b)));
  }
});
test("read budgets, short reads and cancellation are enforced", async () => {
  await assert.rejects(
    readRange(
      {
        size: 1e9,
        read: () => {
          throw Error("must not read");
        },
      },
      0,
      MAX_READ_BYTES + 1,
    ),
    /range/,
  );
  await assert.rejects(readRange({ size: 10, read: async () => new Uint8Array(1) }, 0, 2), /Short/);
  const c = new AbortController();
  c.abort();
  await assert.rejects(readRange(source(fixture()), 0, 1, c.signal), { name: "AbortError" });
  const d = new AbortController();
  await assert.rejects(
    readRange(
      {
        size: 1,
        read: async () => {
          d.abort();
          return new Uint8Array(1);
        },
      },
      0,
      1,
      d.signal,
    ),
    { name: "AbortError" },
  );
});
test("Blob adapter returns exact slices", async () => {
  assert.deepEqual(
    await readRange(fileSource(new Blob([new Uint8Array([1, 2, 3])])), 1, 2),
    new Uint8Array([2, 3]),
  );
});

test("required executable modules match native IPA packaging contract", () => {
  const python = readFileSync(new URL("../../dm/tools/d2rm_pack.py", import.meta.url), "utf8");
  const match = python.match(/^MODS = (\[[^\n]+\])/m);
  assert.ok(match, "native MODS declaration changed; review contract");
  assert.deepEqual(REQUIRED_NSO_MODULES, JSON.parse(match[1].replaceAll("'", '"')));
  assert.equal(Object.isFrozen(REQUIRED_NSO_MODULES), true);
});
