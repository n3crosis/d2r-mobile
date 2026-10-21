// 仅合成输出和启动失败，不打开私有输入或启动转换。
// Synthetic outputs and startup failures only; no private inputs or conversion.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";
import {
  replaceBunGlobal,
  requireUnusedOutput,
  writeBunOutput,
  resolvePreviewFile,
  run,
} from "../scripts/bun-e2e.mjs";
async function fixture(operation) {
  const root = await mkdtemp(join(tmpdir(), "d2r-synthetic-run-"));
  try {
    await operation(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
test("exclusive output rejects existing files and symlinks, including a precheck race", () =>
  fixture(async (root) => {
    const output = join(root, "output.ipa");
    await requireUnusedOutput(output);
    await writeFile(output, "keep");
    await assert.rejects(writeBunOutput(output, new Blob(["new"])), { code: "EEXIST" });
    await assert.rejects(requireUnusedOutput(output), /BUN_E2E_OUTPUT_EXISTS/);
    assert.equal(await readFile(output, "utf8"), "keep");
    const alias = join(root, "alias.ipa");
    await symlink(output, alias);
    await assert.rejects(writeBunOutput(alias, new Blob(["new"])), { code: "EEXIST" });
    const fresh = join(root, "fresh.ipa");
    await writeBunOutput(fresh, new Blob(["synthetic"]));
    assert.equal(await readFile(fresh, "utf8"), "synthetic");
  }));
test("global replacement restores original descriptors and absence", () => {
  const target = {};
  Object.defineProperty(target, "value", { configurable: true, get: () => 42 });
  Object.defineProperty(target, "fixed", {
    value: 1,
    writable: true,
    configurable: false,
    enumerable: true,
  });
  const fixed = Object.getOwnPropertyDescriptor(target, "fixed");
  const restoreFixed = replaceBunGlobal(target, "fixed", 2);
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "fixed"), { ...fixed, value: 2 });
  restoreFixed();
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "fixed"), fixed);
  const before = Object.getOwnPropertyDescriptor(target, "value");
  const restore = replaceBunGlobal(target, "value", 7);
  assert.equal(target.value, 7);
  restore();
  assert.deepEqual(Object.getOwnPropertyDescriptor(target, "value"), before);
  replaceBunGlobal(target, "absent", 1)();
  assert.equal(Object.hasOwn(target, "absent"), false);
});
test("setup failure restores globals, stops server, revokes URL and permits another run", () =>
  fixture(async (root) => {
    const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
    const source = Buffer.from("// synthetic worker, never executed");
    const compressed = gzipSync(source);
    const runtime = join(root, "runtime");
    await mkdir(runtime);
    const manifest = Buffer.from(
      JSON.stringify({
        assets: [
          { path: "sealed-workers/nsp-worker.mjs", bytes: source.length, sha256: hash(source) },
        ],
        transport: {
          entries: [{ sha256: hash(source), bytes: source.length, offset: 0, file: "chunk.gz" }],
          files: [{ path: "chunk.gz", sha256: hash(compressed) }],
        },
      }),
    );
    await writeFile(join(runtime, "runtime-manifest.json"), manifest);
    await writeFile(
      join(runtime, "runtime-integrity.mjs"),
      `export const runtimeManifestSha256='${hash(manifest)}';`,
    );
    await writeFile(join(runtime, "chunk.gz"), compressed);
    const fakeNavigator = {};
    Object.defineProperty(fakeNavigator, "storage", { value: "original", configurable: false });
    let stops = 0,
      revokes = 0;
    const restores = [];
    const originals = new Map(
      ["Worker", "location", "isSecureContext"].map((key) => [
        key,
        Object.getOwnPropertyDescriptor(globalThis, key),
      ]),
    );
    try {
      restores.push(replaceBunGlobal(globalThis, "Worker", class {}));
      const worker = globalThis.Worker;
      restores.push(replaceBunGlobal(globalThis, "navigator", fakeNavigator));
      // Bun 自身不可写，但公开方法可替换；Node 下仅创建合成命名空间。
      // Bun itself is readonly, but its public methods are writable; create a synthetic namespace only in Node.
      if (!globalThis.Bun) restores.push(replaceBunGlobal(globalThis, "Bun", {}));
      restores.push(replaceBunGlobal(globalThis.Bun, "file", () => ({ text: async () => "" })));
      restores.push(
        replaceBunGlobal(globalThis.Bun, "serve", () => ({
          url: new URL("http://127.0.0.1:1234"),
          stop() {
            stops++;
          },
        })),
      );
      const revoke = URL.revokeObjectURL;
      restores.push(
        replaceBunGlobal(URL, "revokeObjectURL", (url) => {
          revokes++;
          revoke(url);
        }),
      );
      for (let attempt = 0; attempt < 2; attempt++)
        await assert.rejects(
          run({
            preview: root,
            input: "unused",
            output: join(root, "new.ipa"),
            nsps: ["synthetic.nsp"],
          }),
          TypeError,
        );
      assert.equal(stops, 2);
      assert.equal(revokes, 2);
      assert.equal(globalThis.Worker, worker);
      for (const key of ["location", "isSecureContext"])
        assert.deepEqual(Object.getOwnPropertyDescriptor(globalThis, key), originals.get(key));
      assert.equal(fakeNavigator.storage, "original");
    } finally {
      for (const restore of restores.reverse()) restore();
    }
  }));

test("preview serves confined real targets and rejects external symlinks", () =>
  fixture(async (root) => {
    const preview = join(root, "preview");
    await mkdir(preview);
    const inside = join(preview, "asset");
    await writeFile(inside, "public synthetic");
    const outside = join(root, "outside");
    await writeFile(outside, "private synthetic");
    await symlink(outside, join(preview, "escape"));
    await symlink(inside, join(preview, "alias"));
    assert.equal(await resolvePreviewFile(preview, inside), inside);
    assert.equal(await resolvePreviewFile(preview, join(preview, "alias")), inside);
    assert.equal(await resolvePreviewFile(preview, join(preview, "escape")), null);
  }));
