// 执行真实密封工作线程消息路径，仅替换已初始化的托管导出；不加载编译器或游戏数据。
// Exercise the real sealed-worker message path, replacing only initialized managed exports; no compiler or game inputs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createContext, runInContext } from "node:vm";
import { sanitizeShaderDiagnostic } from "../shader-diagnostics.mjs";

const source = readFileSync(
  new URL("../sealed-runtime/dotnet-worker.mjs", import.meta.url),
  "utf8",
);
function worker({ resultJson, parse, managedError } = {}) {
  const listeners = new Map(),
    replies = [],
    calls = [];
  const context = createContext({
    ArrayBuffer,
    Uint8Array,
    ...(parse ? { JSON: { parse, stringify: JSON.stringify } } : {}),
    self: {
      addEventListener(type, listener) {
        listeners.set(type, listener);
      },
      postMessage(reply) {
        replies.push(reply);
      },
    },
    managed: {
      ShaderBridge: {
        Translate(json, bytes) {
          calls.push({ job: JSON.parse(json), bytes: [...bytes] });
          if (managedError) throw managedError;
          return resultJson === undefined
            ? JSON.stringify({ sentinel: "managed-export-reached" })
            : resultJson;
        },
      },
    },
  });
  runInContext(source + "\ninitialized = true; exports = managed;", context);
  return {
    calls,
    async request(data) {
      listeners.get("message")({ data });
      await runInContext("queue", context);
      return replies.at(-1);
    },
  };
}
function request(stage, flag) {
  return {
    id: 42,
    type: "run",
    job: {
      key: "5221043a88afa381",
      stage,
      debug: true,
      reduced: true,
      attr: {},
      fout: {},
      img: {},
      tex: {},
      ...(flag === undefined ? {} : { allowUnverifiedTessellation: flag }),
    },
    payload: new Uint8Array([1, 2, 3, 4]).buffer,
  };
}

test("sealed transport preserves explicit hull/domain opt-in and all job fields", async () => {
  const transport = worker();
  for (const stage of ["cs", "vs", "ps", "hs", "ds"]) {
    const message = request(stage, ["hs", "ds"].includes(stage) ? true : undefined),
      reply = await transport.request(message);
    assert.equal(reply.id, 42);
    assert.equal(reply.ok, true);
    assert.equal(reply.result.sentinel, "managed-export-reached");
    assert.deepEqual(transport.calls.at(-1), { job: message.job, bytes: [1, 2, 3, 4] });
  }
});

test("sealed transport rejects absent, false and nonboolean tessellation opt-ins and geometry", async () => {
  const transport = worker();
  for (const stage of ["hs", "ds"])
    for (const flag of [undefined, false, 1, "true", null]) {
      const reply = await transport.request(request(stage, flag));
      assert.equal(reply.id, 42);
      assert.equal(reply.ok, false);
    }
  for (const stage of ["gs", "unknown"])
    assert.equal((await transport.request(request(stage, true))).ok, false);
  assert.equal(transport.calls.length, 0);
});

test("tessellation opt-in does not bypass existing payload or metadata caps", async () => {
  const transport = worker();
  for (const change of [
    { payload: new Uint8Array(4) },
    { payload: new ArrayBuffer(1024 * 1024 + 1) },
    { job: { ...request("hs", true).job, extra: "x".repeat(65536) } },
    { job: null },
  ])
    assert.equal((await transport.request({ ...request("hs", true), ...change })).ok, false);
  assert.equal(transport.calls.length, 0);
});

// 不允许超限回复先进入 JSON.parse；保留正常回复与净化错误行为。
// Oversized replies must not reach JSON.parse; normal replies and sanitized errors remain intact.
test("managed output is bounded before parsing", async () => {
  for (const resultJson of ['"' + "x".repeat(24 * 1024 * 1024) + '"', null, 7]) {
    let parses = 0;
    const transport = worker({
      resultJson,
      parse(value) {
        parses++;
        return JSON.parse(value);
      },
    });
    const reply = await transport.request(request("cs"));
    assert.equal(transport.calls.length, 1);
    assert.equal(parses, 0);
    assert.equal(reply.ok, false);
    assert.equal(reply.error, "Offline .NET operation failed (new)");
    assert.equal(reply.shaderDiagnostic.substep, "translation");
    assert.equal(reply.shaderDiagnostic.message, "Shader result cap");
  }
  const transport = worker({ resultJson: '{"bounded":true}' });
  assert.equal((await transport.request(request("cs"))).result.bounded, true);
});

test("managed failures expose reviewed causes and exception types without arbitrary text", async () => {
  for (const [message, expected, type] of [
    [
      "Shader must be 16 bytes to 1 MiB and 8-byte aligned.",
      "Shader must be 16 bytes to 1 MiB and 8-byte aligned.",
      "Error",
    ],
    [
      "System.ArgumentException: Graphics jobs require explicit attr and fout type tables.\n at /PRIVATE-CANARY/frame.cs",
      "Graphics jobs require explicit attr and fout type tables.",
      "ArgumentException",
    ],
    [
      "System.NotImplementedException: PRIVATE-CANARY",
      "Translator does not implement this operation",
      "NotImplementedException",
    ],
    [
      "System.MissingMethodException: PRIVATE-CANARY",
      "Translator dependency is missing",
      "MissingMethodException",
    ],
    [
      "System.InvalidOperationException: Missing embedded shader helper: PRIVATE-CANARY",
      "Missing embedded shader helper",
      "InvalidOperationException",
    ],
    ["PRIVATE-CANARY source bytes and keys", undefined, "Error"],
    ["error: PRIVATE-CANARY is not compiler stderr", undefined, "Error"],
  ]) {
    const transport = worker({ managedError: new Error(message) });
    const reply = await transport.request(request("cs"));
    assert.equal(reply.ok, false);
    assert.equal(reply.error, "Offline .NET operation failed (new)");
    assert.equal(reply.shaderDiagnostic.substep, "translation");
    assert.equal(reply.shaderDiagnostic.errorType, type);
    assert.equal(reply.shaderDiagnostic.message, expected);
    assert.deepEqual(sanitizeShaderDiagnostic(reply.shaderDiagnostic), {
      ...reply.shaderDiagnostic,
    });
    assert.doesNotMatch(JSON.stringify(reply), /PRIVATE-CANARY/);
    assert.equal(Object.hasOwn(reply.shaderDiagnostic, "diagnostics"), false);
  }
});

test("standalone translator diagnostic allowlist stays within the shared boundary", () => {
  const context = createContext({ self: { addEventListener() {} } });
  runInContext(source, context);
  const messages = runInContext("[...translatorMessages]", context);
  for (const message of messages)
    assert.equal(sanitizeShaderDiagnostic({ message })?.message, message);
  const errorTypes = runInContext("[...translatorErrorTypes]", context);
  for (const errorType of errorTypes)
    assert.equal(sanitizeShaderDiagnostic({ errorType })?.errorType, errorType);
});

test("managed output parse failures do not expose the invalid returned JSON", async () => {
  const transport = worker({ resultJson: "PRIVATE-CANARY" });
  const reply = await transport.request(request("cs"));
  assert.equal(reply.shaderDiagnostic.errorType, "SyntaxError");
  assert.doesNotMatch(JSON.stringify(reply), /PRIVATE-CANARY/);
});
