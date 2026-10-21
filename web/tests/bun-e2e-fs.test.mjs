// 仅使用合成临时文件，不运行私有输入打包器。
// Use synthetic temporary files only, never the private-input runner.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, rename, mkdir, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DirectoryHandle } from "../scripts/bun-e2e-fs.mjs";
import { cleanupBunE2e } from "../scripts/bun-e2e.mjs";
async function fixture(run) {
  const path = await mkdtemp(join(tmpdir(), "d2r-synthetic-fs-"));
  try {
    await run(new DirectoryHandle(path), path);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
}
test("handle identity survives own writes but rejects path replacements", () =>
  fixture(async (root, path) => {
    const file = await root.getFileHandle("a", { create: true });
    assert.equal(await file.isSameEntry(await root.getFileHandle("a")), true);
    const writer = await file.createWritable();
    await writer.write(Uint8Array.of(1, 2, 3));
    await writer.close();
    assert.deepEqual(await readFile(join(path, "a")), Buffer.from([1, 2, 3]));
    assert.equal(await file.isSameEntry(await root.getFileHandle("a")), true);
    await writeFile(join(path, "replacement"), "other");
    await rename(join(path, "replacement"), join(path, "a"));
    assert.equal(await file.isSameEntry(await root.getFileHandle("a")), false);
    assert.equal(await file.isSameEntry({ path: file.path, kind: "file" }), false);
    const dir = await root.getDirectoryHandle("dir", { create: true });
    assert.equal(await dir.isSameEntry(await root.getDirectoryHandle("dir")), true);
    await rename(join(path, "dir"), join(path, "old"));
    await mkdir(join(path, "dir"));
    assert.equal(await dir.isSameEntry(await root.getDirectoryHandle("dir")), false);
  }));
test("nonrecursive directory removal preserves nonempty directories", () =>
  fixture(async (root, path) => {
    await root.getDirectoryHandle("empty", { create: true });
    await root.removeEntry("empty");
    const full = await root.getDirectoryHandle("full", { create: true });
    await full.getFileHandle("keep", { create: true });
    await assert.rejects(root.removeEntry("full"), { name: "InvalidModificationError" });
    assert.deepEqual(await readdir(join(path, "full")), ["keep"]);
  }));
test("failed rename leaves temporary file recoverable by abort", () =>
  fixture(async (root, path) => {
    const file = await root.getFileHandle("a", { create: true });
    const writer = await file.createWritable();
    await writer.write(Uint8Array.of(7));
    await rm(join(path, "a"));
    await mkdir(join(path, "a"));
    await assert.rejects(writer.close());
    await writer.abort();
    await writer.abort();
    assert.deepEqual(await readdir(path), ["a"]);
  }));
test("cleanup drains every release and retains the primary cause", async () => {
  const primary = new Error("synthetic primary"),
    calls = [];
  await assert.rejects(
    cleanupBunE2e(
      [
        () => {
          calls.push(1);
          throw new Error("close");
        },
        () => {
          calls.push(2);
        },
        async () => {
          calls.push(3);
          throw new Error("remove");
        },
        () => {
          calls.push(4);
        },
      ],
      primary,
    ),
    (error) =>
      error.message === "BUN_E2E_CLEANUP_FAILED" &&
      error.cause === primary &&
      error.errors.length === 2,
  );
  assert.deepEqual(calls, [1, 2, 3, 4]);
});
