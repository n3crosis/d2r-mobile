// 在无网络的 Node 测试线程中检查实际 WASM、导出、静态密码提供程序及随机源。
// Check actual WASM, exports, static crypto providers and entropy in an offline Node test worker.
// 不使用真实凭据，不签名应用；此检查不证明浏览器或设备兼容性。
// No real credentials or app signing; this check does not establish browser or device compatibility.
import assert from "node:assert/strict";
import process from "node:process";
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { isMainThread, parentPort, Worker } from "node:worker_threads";

const DEADLINE_MS = 30000;
const MAX_ARTIFACT_BYTES = 64 * 1024 * 1024;
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function checkedFile(name) {
  const url = new URL(`./dist/${name}`, import.meta.url);
  const info = await stat(url);
  assert.ok(info.isFile() && info.size > 0 && info.size <= MAX_ARTIFACT_BYTES);
  const bytes = await readFile(url);
  assert.equal(bytes.length, info.size);
  return bytes;
}
async function runWorker() {
  assert.ok(Number(process.versions.node.split(".")[0]) >= 24, "Node 24 or newer required");
  const [wasm, javascript, receiptBytes, compiler, pinsBytes, expectedPins] = await Promise.all([
    checkedFile("zsign.wasm"),
    checkedFile("zsign.mjs"),
    checkedFile("build-report.json"),
    checkedFile("compiler-version.txt"),
    checkedFile("pins.json"),
    readFile(new URL("./pins.json", import.meta.url), "utf8"),
  ]);
  const receipt = JSON.parse(receiptBytes.toString());
  assert.deepEqual(JSON.parse(pinsBytes.toString()), JSON.parse(expectedPins));
  assert.deepEqual(receipt.sourcePins, JSON.parse(expectedPins));
  for (const [name, bytes] of [
    ["zsign.wasm", wasm],
    ["zsign.mjs", javascript],
  ]) {
    assert.equal(receipt.files[name].sha256, digest(bytes));
    assert.equal(receipt.files[name].bytes, bytes.length);
  }
  assert.match(compiler.toString().split("\n")[0], /^emcc .* 4\.0\.20(?:\s|$)/);
  assert.ok(WebAssembly.validate(wasm));
  // 仅测试线程提供 Emscripten worker 环境垫片；拒绝任何网络回退。
  // Provide worker-environment shims only in this test thread; reject any network fallback.
  globalThis.WorkerGlobalScope = class TestOnlyWorkerGlobalScope {};
  globalThis.self = globalThis;
  globalThis.fetch = () => {
    throw new Error("Network forbidden in signing WASM smoke");
  };
  globalThis.XMLHttpRequest = class {
    constructor() {
      throw new Error("XHR forbidden in signing WASM smoke");
    }
  };
  const { default: factory } = await import(
    `data:text/javascript;base64,${javascript.toString("base64")}`
  );
  let instantiations = 0;
  const module = await factory({
    wasmBinary: new Uint8Array(wasm.buffer, wasm.byteOffset, wasm.byteLength),
    locateFile() {
      throw new Error("External WASM resource forbidden");
    },
    instantiateWasm(imports, receive) {
      const compiled = new WebAssembly.Module(wasm);
      const instance = new WebAssembly.Instance(compiled, imports);
      instantiations++;
      receive(instance, compiled);
      return instance.exports;
    },
    print() {},
    printErr(message) {
      process.stderr.write(`Signing WASM diagnostic: ${String(message)}\n`);
    },
    onAbort(reason) {
      throw new Error(`Signing WASM aborted: ${String(reason)}`);
    },
  });
  try {
    assert.equal(instantiations, 1);
    for (const name of ["_zsign_sign_bundle", "_malloc", "_free"])
      assert.equal(typeof module[name], "function", `Missing native export ${name}`);
    for (const name of ["mount", "unmount", "createNode", "mkdirTree", "writeFile", "readFile"])
      assert.equal(typeof module.FS[name], "function", `Missing filesystem export ${name}`);
    assert.equal(typeof module.FS.ErrnoError, "function");
    assert.ok(module.HEAPU8 instanceof Uint8Array);
    assert.ok(module.HEAPU8.byteLength <= 512 * 1024 * 1024);
    // 空路径必须在密码提供程序和随机源检查成功后返回 -201，而不是 -205。
    // Empty paths must return -201 after providers/entropy pass, never -205.
    assert.equal(module._zsign_sign_bundle(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0), -201);
    const pointer = module._malloc(32);
    assert.ok(pointer > 0);
    module.HEAPU8.fill(0, pointer, pointer + 32);
    module._free(pointer);
    module.FS.mkdirTree("/smoke");
    module.FS.writeFile("/smoke/bytes", new Uint8Array([1, 2, 3]));
    assert.deepEqual(module.FS.readFile("/smoke/bytes"), new Uint8Array([1, 2, 3]));
    module.FS.unlink("/smoke/bytes");
    module.FS.rmdir("/smoke");
    return {
      wasmInitializationVerified: true,
      staticProvidersAndEntropyVerified: true,
      browserExecutionVerified: false,
      signingVerified: false,
      deviceInstallVerified: false,
      wasmSha256: digest(wasm),
      javascriptSha256: digest(javascript),
    };
  } finally {
    module.HEAPU8?.fill(0);
  }
}
if (isMainThread) {
  let worker, timer;
  try {
    const result = await new Promise((resolve, reject) => {
      worker = new Worker(new URL(import.meta.url), {
        resourceLimits: { maxOldGenerationSizeMb: 128 },
      });
      timer = setTimeout(() => reject(new Error("Signing WASM smoke timed out")), DEADLINE_MS);
      worker.once("message", (message) =>
        message.ok ? resolve(message.result) : reject(new Error(message.error)),
      );
      worker.once("error", reject);
      worker.once("exit", (code) => reject(new Error(`Smoke exited without result (${code})`)));
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(`Signing WASM initialization smoke failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    await worker?.terminate();
  }
} else {
  try {
    parentPort.postMessage({ ok: true, result: await runWorker() });
  } catch (error) {
    const details =
      error && typeof error === "object"
        ? Object.fromEntries(
            Object.getOwnPropertyNames(error).map((key) => [key, String(error[key])]),
          )
        : {};
    parentPort.postMessage({
      ok: false,
      error:
        error instanceof Error
          ? String(error.stack || error.message)
          : `Non-Error rejection (${typeof error}): ${String(error)} ${JSON.stringify(details)}`,
    });
  } finally {
    parentPort.close();
  }
}
