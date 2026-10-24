// SPIRV-Cross 工作线程在 Node 中使用与 Chromium 相同的 V8 WebAssembly 引擎。
// 端到端运行的其余部分由 Bun 驱动。
// Node uses the same V8 WebAssembly engine as Chromium for the SPIRV-Cross
// worker. Bun drives the rest of the end-to-end run.
import { createInterface } from "node:readline";
import { pathToFileURL, fileURLToPath } from "node:url";
import { execFile } from "node:child_process";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  MSL_ARGUMENTS,
  CROSS_COMMIT,
} from "../toolchain/spirv-cross-spike/wwwroot/spirv-contract.mjs";
import { replayFields } from "../toolchain/spirv-cross-spike/wwwroot/replay-reflection.mjs";

const children = new Map();
const jobs = new Set();
let stopping = false,
  stopPromise;
export function runNativeCommand(file, args) {
  if (stopping) return Promise.reject(new Error("BUN_E2E_CROSS_STOPPED"));
  return new Promise((resolve, reject) => {
    const child = execFile(
      file,
      args,
      { timeout: 120000, killSignal: "SIGKILL" },
      (error, stdout) => {
        children.delete(child);
        if (error) reject(error);
        else resolve({ stdout });
      },
    );
    children.set(child, new Promise((done) => child.once("close", done)));
  });
}
// 固定上限读取，文件增长也不能触发无界 readFile 分配。
// Fixed-size reads prevent unbounded readFile allocation even if a file grows.
export async function readNativeOutput(path, limit = 16 * 1024 * 1024) {
  const file = await open(path, "r");
  try {
    const size = (await file.stat()).size;
    if (!Number.isSafeInteger(size) || size > limit) throw new Error("BUN_E2E_CROSS_OUTPUT_LIMIT");
    const bytes = Buffer.alloc(size + 1);
    let at = 0;
    while (at < bytes.length) {
      const { bytesRead } = await file.read(bytes, at, bytes.length - at, at);
      if (!bytesRead) break;
      at += bytesRead;
    }
    if (at !== size) throw new Error("BUN_E2E_CROSS_OUTPUT_CHANGED");
    return bytes.subarray(0, size).toString("utf8");
  } finally {
    await file.close();
  }
}
// 先终止自有编译子进程并等待临时目录清理，再退出桥接进程。
// Stop owned compiler children and drain temporary-directory cleanup before exiting the bridge.
export function stopNativeChildren() {
  if (stopPromise) return stopPromise;
  stopping = true;
  stopPromise = (async () => {
    for (const child of children.keys()) child.kill("SIGTERM");
    const force = setTimeout(() => {
      for (const child of children.keys()) child.kill("SIGKILL");
    }, 500);
    await Promise.allSettled([...jobs, ...children.values()]);
    clearTimeout(force);
    for (const child of children.keys()) child.kill("SIGKILL");
  })();
  return stopPromise;
}
async function shutdown() {
  await stopNativeChildren();
  process.exit(0);
}

async function main() {
  process.on("SIGTERM", () => {
    void shutdown();
  });
  process.on("SIGINT", () => {
    void shutdown();
  });
  const cli = process.env.D2R_E2E_SPIRV_CROSS_CLI;
  const source = process.env.D2R_E2E_SPIRV_CROSS_SOURCE;
  const nativeOnly = process.env.D2R_E2E_SPIRV_CROSS_MODE === "native";
  if (Boolean(cli) !== Boolean(source)) throw new Error("BUN_E2E_CROSS_CLI_SOURCE_REQUIRED");
  if (nativeOnly && !cli) throw new Error("BUN_E2E_CROSS_NATIVE_CLI_REQUIRED");
  if (cli) {
    const { stdout } = await runNativeCommand("git", ["-C", source, "rev-parse", "HEAD"]);
    if (stdout.trim() !== CROSS_COMMIT) throw new Error("BUN_E2E_CROSS_SOURCE_COMMIT");
  }
  const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

  async function nativeConvert(message) {
    const dir = await mkdtemp(join(tmpdir(), "d2r-bun-cross-"));
    const input = join(dir, "input.spv");
    const mslFile = join(dir, "output.metal");
    const reflectionFile = join(dir, "reflection.json");
    const bytes = new Uint8Array(message.spirv);
    try {
      await writeFile(input, bytes);
      await runNativeCommand(cli, [input, ...MSL_ARGUMENTS, "--output", mslFile]);
      await runNativeCommand(cli, [input, "--reflect", "json", "--output", reflectionFile]);
      const msl = (await readNativeOutput(mslFile)).replace(/\r\n/g, "\n");
      const reflectionText = await readNativeOutput(reflectionFile);
      const reflection = JSON.parse(reflectionText);
      return {
        schema: "spirv-cross-browser-stage-v1",
        msl,
        reflection,
        replay: replayFields(message.replayContext.stage, msl, message.replayContext.resources),
        provenance: {
          spirvCrossCommit: CROSS_COMMIT,
          mslArguments: [...MSL_ARGUMENTS],
          inputSha256: sha256(bytes),
          mslSha256: sha256(new TextEncoder().encode(msl)),
          reflectionSha256: sha256(new TextEncoder().encode(reflectionText)),
          nativeChainClaimed: false,
          metalCompiled: false,
        },
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  const listeners = new Map();
  const pending = new Map();
  let nativeConversions = 0;
  globalThis.self = {
    addEventListener(type, listener) {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(listener);
    },
    async postMessage(value) {
      if (value?.type !== undefined || value?.id === 0) {
        process.stdout.write(`${JSON.stringify(value)}\n`);
        return;
      }
      const message = pending.get(value.id);
      pending.delete(value.id);
      if (value.ok === false && cli && message?.type === "convert") {
        try {
          const job = nativeConvert(message);
          jobs.add(job);
          let result;
          try {
            result = await job;
          } finally {
            jobs.delete(job);
          }
          value = { id: value.id, ok: true, result };
          nativeConversions++;
          if (nativeConversions === 1 || nativeConversions % 1000 === 0)
            process.stderr.write(`Pinned native SPIRV-Cross conversions: ${nativeConversions}\n`);
        } catch (error) {
          value = {
            id: value.id,
            ok: false,
            error: `Pinned native SPIRV-Cross failed: ${error.message}`,
          };
        }
      }
      process.stdout.write(`${JSON.stringify(value)}\n`);
    },
    close() {
      void shutdown();
    },
  };

  await import(pathToFileURL(process.argv[2]).href);
  for await (const line of createInterface({ input: process.stdin })) {
    if (stopping) break;
    const message = JSON.parse(line);
    if (message.assets)
      message.assets = message.assets.map(([name, encoded]) => [
        name,
        Uint8Array.from(Buffer.from(encoded, "base64")).buffer,
      ]);
    if (message.spirv) message.spirv = Uint8Array.from(Buffer.from(message.spirv, "base64")).buffer;
    if (message.type === "convert") pending.set(message.id, message);
    if (nativeOnly && message.type === "convert") {
      await self.postMessage({ id: message.id, ok: false, error: "NATIVE_MODE" });
      continue;
    }
    for (const listener of listeners.get("message") ?? []) listener({ data: message });
  }

  await shutdown();
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main();
