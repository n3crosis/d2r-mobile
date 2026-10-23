// 验证 preview-manifest 的约定与边界；依据 ../verification/preview-manifest.mjs 及本文件的测试断言。
// Verify preview-manifest contracts and boundaries against ../verification/preview-manifest.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createPreviewManifest } from "../verification/preview-manifest.mjs";

test("preview manifest accepts only referenced static bundle files", async () => {
  const path = await mkdtemp(join(tmpdir(), "preview-manifest-"));
  const directory = pathToFileURL(`${path}/`);
  try {
    await writeFile(
      join(path, "index.html"),
      '<meta charset="utf-8"><link href="./app.css"><script src="./app.js"></script>',
    );
    await writeFile(join(path, "app.js"), "console.log('preview');");
    await writeFile(join(path, "app.css"), "body{color:black}");
    const manifest = await createPreviewManifest(directory, "a".repeat(40));
    assert.equal(manifest.commit, "a".repeat(40));
    assert.equal(manifest.files.length, 3);
    for (const name of ["prod.keys", "notes.txt", "unused.js"]) {
      await writeFile(join(path, name), "not public");
      await assert.rejects(createPreviewManifest(directory));
      await rm(join(path, name));
    }
    await rm(join(path, "build-manifest.json"));
    await symlink(join(path, "app.js"), join(path, "build-manifest.json"));
    await assert.rejects(createPreviewManifest(directory), /regular files/);
  } finally {
    await rm(path, { recursive: true, force: true });
  }
});
