// 合成诊断过滤测试，不加载 WASM 或私有输入。
// Synthetic diagnostic filtering tests, without WASM or private input.
import test from "node:test";
import assert from "node:assert/strict";
import {
  sanitizeCompilerDiagnostics,
  sanitizeShaderDiagnostic,
  shaderFailureDiagnostic,
} from "../shader-diagnostics.mjs";

test("compiler prose is bounded, strips source excerpts, paths, secrets and IR", () => {
  const diagnostics = sanitizeCompilerDiagnostics([
    "unknown type name 'texture2d_ms'\nno matching function for call to 'sample'\n" +
      "1 | kernel void PRIVATE_SOURCE() { int value = 42; }\n^~~~~\n" +
      "error: title.keys = SECRET_CANARY\nerror: api_token: SECRET_CANARY\n" +
      "error: /home/Private Name/game/file.metal missing\n" +
      "error: C:\\Users\\Private\\game.metal missing\n" +
      "error: key 0123456789abcdef0123456789abcdef\n" +
      "define void @private() {\n%private = call void @thing()\n}",
  ]);
  assert.match(diagnostics.join("\n"), /texture2d_ms|sample/);
  assert.doesNotMatch(
    diagnostics.join("\n"),
    /PRIVATE_SOURCE|SECRET_CANARY|home|Users|0123456789abcdef|define|@thing/,
  );
  const bounded = sanitizeCompilerDiagnostics(
    Array.from({ length: 30 }, (_, i) => `error: ${i} ${"x".repeat(600)}`),
  );
  assert.ok(bounded.length <= 8);
  assert.ok(bounded.join("").length <= 2048);
  assert.ok(Object.isFrozen(diagnostics));
});

test("app causes are exact authored messages, never arbitrary exception strings or objects", () => {
  assert.deepEqual(
    shaderFailureDiagnostic(new Error("Control hash does not match catalog key"), {
      substep: "record-preparation",
      record: 1,
    }),
    {
      substep: "record-preparation",
      errorType: "Error",
      message: "Control hash does not match catalog key",
      record: 1,
    },
  );
  const value = sanitizeShaderDiagnostic({
    substep: "PRIVATE_SUBSTEP",
    message: "PRIVATE_MESSAGE",
    errorType: "PRIVATE_TYPE",
    record: 9000,
    diagnostics: ["PRIVATE_DIAGNOSTIC"],
    sourceSha256: "PRIVATE_HASH",
    path: "/private",
  });
  assert.equal(value, undefined);
  assert.deepEqual(
    shaderFailureDiagnostic(new TypeError("PRIVATE_RAW"), { substep: "source-read" }),
    { substep: "source-read", errorType: "TypeError" },
  );
});

test("already filtered diagnostics survive repeated worker and UI projections", () => {
  const once = sanitizeShaderDiagnostic({
    substep: "compilation",
    compilerPhase: "compiling",
    diagnostics: ["/input/shader.metal:1:4: error: unknown type name 'missing'"],
    record: 3,
    sourceSha256: "f".repeat(64),
  });
  assert.deepEqual(sanitizeShaderDiagnostic(once), once);
  assert.equal(once.diagnostics[0], "source:1:4: error: unknown type name 'missing'");
});

test("expected punctuation remains useful without accepting shader excerpt blocks", () => {
  assert.deepEqual(
    sanitizeCompilerDiagnostics(
      "expected '}'\nerror: expected '{' after function declarator\nerror: kernel void f() { do_work(); }",
    ),
    ["expected '}'", "error: expected '{' after function declarator"],
  );
});

test("compiler helper staging includes the diagnostics import without changing compiler identity inputs", async () => {
  const { readFile } = await import("node:fs/promises");
  for (const file of [
    "../runtime-build/prepare-air-compiler-source.mjs",
    "../toolchain/metal-air-compiler/browser-smoke-server.mjs",
    "../runtime-build/payload-policy.mjs",
  ])
    assert.match(
      await readFile(new URL(file, import.meta.url), "utf8"),
      /"(?:web\/)?shader-diagnostics\.mjs"/,
    );
  const { airCompilerSourceIdentity } = await import("../runtime-build/air-compiler-assets.mjs");
  const identity = await airCompilerSourceIdentity();
  assert.equal(Object.hasOwn(identity.sourceInputs, "shader-diagnostics.mjs"), false);
});
