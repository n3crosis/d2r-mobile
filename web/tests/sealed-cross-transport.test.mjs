// 仅替换转换器导入，执行真实消息/失败路径；不加载或执行编译器、WASM 或私有输入。
// Replace only converter imports to exercise actual message/failure paths; no compiler, WASM or private inputs execute.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { shaderFailureDiagnostic, sanitizeShaderDiagnostic } from "../shader-diagnostics.mjs";

const source = readFileSync(
  new URL("../runtime-sealing/cross-worker.mjs", import.meta.url),
  "utf8",
).replace(/^import .+;\r?\n/gm, "");
function worker(error) {
  let listener;
  const replies = [];
  const context = createContext({
    ArrayBuffer,
    Uint8Array,
    shaderFailureDiagnostic,
    sanitizeShaderDiagnostic,
    factory() {
      throw new Error("The real factory must never execute");
    },
    async convertSpirv() {
      if (error) throw error;
      return { synthetic: true };
    },
    self: {
      addEventListener(type, callback) {
        assert.equal(type, "message");
        listener = callback;
      },
      postMessage(value) {
        replies.push(value);
      },
    },
  });
  runInContext(source + "\nsealedFactory = factory;", context);
  return async (data = { id: 14, type: "convert", spirv: new ArrayBuffer(20) }) => {
    listener({ data });
    await runInContext("queue", context);
    return replies.at(-1);
  };
}

test("Cross forwards only bounded recognized stderr diagnostics", async () => {
  const request = worker(
    new Error(
      "SPIRV-Cross exited 1: error: unsupported synthetic intrinsic\nPRIVATE-CANARY\n at /PRIVATE-CANARY/frame.mjs\nvoid PRIVATE-CANARY() {}",
    ),
  );
  const reply = await request();
  assert.equal(reply.id, 14);
  assert.equal(reply.ok, false);
  assert.equal(reply.error, "CROSS_CONVERSION_FAILED");
  assert.deepEqual(reply.shaderDiagnostic, {
    substep: "spirv-cross",
    errorType: "Error",
    message: "SPIRV-Cross conversion failed",
    diagnostics: ["error: unsupported synthetic intrinsic"],
  });
  assert.doesNotMatch(JSON.stringify(reply), /PRIVATE-CANARY/);
});

test("Cross preserves fixed contract causes but does not treat arbitrary errors as stderr", async () => {
  for (const [message, expected] of [
    ["Invalid SPIR-V header", "Invalid SPIR-V header"],
    ["error: PRIVATE-CANARY is arbitrary exception text", "SPIRV-Cross conversion failed"],
    ["PRIVATE-CANARY", "SPIRV-Cross conversion failed"],
  ]) {
    const reply = await worker(new Error(message))();
    assert.equal(reply.shaderDiagnostic.message, expected);
    assert.equal(reply.shaderDiagnostic.substep, "spirv-cross");
    assert.equal(Object.hasOwn(reply.shaderDiagnostic, "diagnostics"), false);
    assert.doesNotMatch(JSON.stringify(reply), /PRIVATE-CANARY/);
  }
});

test("Cross preserves success protocol and describes invalid conversion requests", async () => {
  assert.deepEqual((await worker()()).result, { synthetic: true });
  const reply = await worker()({ id: 15, type: "bad", spirv: new ArrayBuffer(4) });
  assert.equal(reply.shaderDiagnostic.message, "Invalid conversion request");
  assert.equal(reply.id, 15);
});
