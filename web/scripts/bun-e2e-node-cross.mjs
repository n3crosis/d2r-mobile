// Node uses the same V8 WebAssembly engine as Chromium for the SPIRV-Cross
// worker. Bun drives the rest of the end-to-end run.
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import {
  MSL_ARGUMENTS,
  CROSS_COMMIT,
} from "../toolchain/spirv-cross-spike/wwwroot/spirv-contract.mjs";
import { replayFields } from "../toolchain/spirv-cross-spike/wwwroot/replay-reflection.mjs";

const run = promisify(execFile);
const cli = process.env.D2R_E2E_SPIRV_CROSS_CLI;
const source = process.env.D2R_E2E_SPIRV_CROSS_SOURCE;
const nativeOnly = process.env.D2R_E2E_SPIRV_CROSS_MODE === "native";
if (Boolean(cli) !== Boolean(source)) throw new Error("BUN_E2E_CROSS_CLI_SOURCE_REQUIRED");
if (nativeOnly && !cli) throw new Error("BUN_E2E_CROSS_NATIVE_CLI_REQUIRED");
if (cli) {
  const { stdout } = await run("git", ["-C", source, "rev-parse", "HEAD"]);
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
    await run(cli, [input, ...MSL_ARGUMENTS, "--output", mslFile]);
    await run(cli, [input, "--reflect", "json", "--output", reflectionFile]);
    const msl = (await readFile(mslFile, "utf8")).replace(/\r\n/g, "\n");
    const reflectionText = await readFile(reflectionFile, "utf8");
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
        value = { id: value.id, ok: true, result: await nativeConvert(message) };
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
    process.exit(0);
  },
};

await import(pathToFileURL(process.argv[2]).href);
for await (const line of createInterface({ input: process.stdin })) {
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
