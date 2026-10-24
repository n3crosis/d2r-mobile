// Feature suite: e2e-tooling. Original test sections retain independent lexical scopes.
import * as nodeTestModule from "node:test";
import * as strictModule from "node:assert/strict";
import * as promisesModule from "node:fs/promises";
import * as nodeOsModule from "node:os";
import * as nodePathModule from "node:path";
import * as bunE2eFsModule from "../scripts/bun-e2e-fs.mjs";
import * as bunE2eModule from "../scripts/bun-e2e.mjs";
import * as nodeCryptoModule from "node:crypto";
import * as nodeZlibModule from "node:zlib";
import * as nodeEventsModule from "node:events";
import * as bunE2eNodeWorkerModule from "../scripts/bun-e2e-node-worker.mjs";
import * as bunE2eNodeCrossModule from "../scripts/bun-e2e-node-cross.mjs";

// bun-e2e-fs
{
  // 仅使用合成临时文件，不运行私有输入打包器。
  // Use synthetic temporary files only, never the private-input runner.
  const { default: test } = nodeTestModule;
  const { default: assert } = strictModule;
  const { mkdtemp, rm, readFile, writeFile, rename, mkdir, readdir } = promisesModule;
  const { tmpdir } = nodeOsModule;
  const { join } = nodePathModule;
  const { DirectoryHandle } = bunE2eFsModule;
  const { cleanupBunE2e } = bunE2eModule;
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
}

// bun-e2e-lifecycle
{
  // 仅合成输出和启动失败，不打开私有输入或启动转换。
  // Synthetic outputs and startup failures only; no private inputs or conversion.
  const { default: test } = nodeTestModule;
  const { default: assert } = strictModule;
  const { mkdtemp, mkdir, writeFile, readFile, rm, symlink, realpath } = promisesModule;
  const { tmpdir } = nodeOsModule;
  const { join } = nodePathModule;
  const { createHash } = nodeCryptoModule;
  const { gzipSync } = nodeZlibModule;
  const { replaceBunGlobal, requireUnusedOutput, writeBunOutput, resolvePreviewFile, run } =
    bunE2eModule;
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
            { path: "sealed-workers/cross-worker.mjs", bytes: source.length, sha256: hash(source) },
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
      const previewRoot = await realpath(preview);
      assert.equal(await resolvePreviewFile(previewRoot, inside), await realpath(inside));
      assert.equal(
        await resolvePreviewFile(previewRoot, join(preview, "alias")),
        await realpath(inside),
      );
      assert.equal(await resolvePreviewFile(previewRoot, join(preview, "escape")), null);
    }));
}

// bun-e2e-node-worker
{
  // 合成子进程测试，不使用转换器二进制或私有输入。
  // Synthetic child-process tests, without converter binaries or private inputs.
  const { default: test } = nodeTestModule;
  const { default: assert } = strictModule;
  const { mkdtemp, writeFile, rm, readFile } = promisesModule;
  const { join } = nodePathModule;
  const { tmpdir } = nodeOsModule;
  const { once } = nodeEventsModule;
  const { NodeCrossWorker } = bunE2eNodeWorkerModule;
  const { readNativeOutput, runNativeCommand, stopNativeChildren } = bunE2eNodeCrossModule;
  async function fixture(action) {
    const root = await mkdtemp(join(tmpdir(), "d2r-synthetic-cross-"));
    try {
      await action(root);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  }
  test("native output rejects oversized files before returning text", () =>
    fixture(async (root) => {
      const file = join(root, "text");
      await writeFile(file, "1234");
      assert.equal(await readNativeOutput(file, 4), "1234");
      await assert.rejects(readNativeOutput(file, 3), /OUTPUT_LIMIT/);
    }));
  test("worker receives synthetic response and termination clears retained state", () =>
    fixture(async (root) => {
      const source = join(root, "worker.mjs");
      await writeFile(
        source,
        `self.addEventListener('message',({data})=>self.postMessage({id:data.id,ok:true}));`,
      );
      const worker = new NodeCrossWorker(source);
      try {
        const response = new Promise((resolve, reject) => {
          worker.onmessage = resolve;
          worker.onerror = reject;
        });
        worker.postMessage({ id: 0 });
        assert.equal((await response).data.ok, true);
        const exited = once(worker.child, "exit");
        worker.terminate();
        await exited;
        assert.equal(worker.closed, true);
        assert.equal(worker.buffer, "");
        assert.equal(worker.listeners.size, 0);
      } finally {
        worker.terminate();
      }
    }));
  test("stdin failure terminates even when an observer throws", () =>
    fixture(async (root) => {
      const source = join(root, "worker.mjs");
      await writeFile(source, `self.addEventListener('message',()=>{});`);
      const worker = new NodeCrossWorker(source);
      worker.onerror = () => {
        throw new Error("observer");
      };
      const exited = once(worker.child, "exit");
      worker.child.stdin.emit(
        "error",
        Object.assign(new Error("synthetic pipe"), { code: "EPIPE" }),
      );
      assert.equal(worker.closed, true);
      await exited;
    }));
  test("owned child ignoring SIGTERM is killed and drained before cleanup", () =>
    fixture(async (root) => {
      const marker = join(root, "ready");
      // 使用 Node 本身运行固定合成脚本，不调用 git 或真实编译器。
      // Run a fixed synthetic script with Node itself, never git or a real compiler.
      const result = runNativeCommand("node", [
        "-e",
        `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],String(process.pid));setInterval(()=>{},1000);`,
        marker,
      ]).catch((error) => error);
      for (let i = 0; i < 200; i++) {
        if (await readFile(marker, "utf8").catch(() => null)) break;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      const pid = Number(await readFile(marker, "utf8"));
      await Promise.all([stopNativeChildren(), stopNativeChildren()]);
      assert.ok((await result) instanceof Error);
      assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    }));
}
