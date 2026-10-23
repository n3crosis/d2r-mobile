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

test("runtime staging keeps diagnostics while generic compiler identity excludes D2R helpers", async () => {
  const { readFile } = await import("node:fs/promises");
  const policy = await readFile(
    new URL("../runtime-build/payload-policy.mjs", import.meta.url),
    "utf8",
  );
  assert.match(policy, /"shader-diagnostics\.mjs"/);
  const adapter = await readFile(new URL("../air-compiler-adapter.mjs", import.meta.url), "utf8");
  assert.match(adapter, /shader-diagnostics\.mjs/);
  const { readReviewedSourceLock } = await import("./fixtures/air-fork-source/fork-source.mjs");
  const lock = await readReviewedSourceLock();
  assert(Object.keys(lock.compilerFiles).every((path) => !path.includes("shader-diagnostics")));
  assert(Object.keys(lock.sdkFiles).every((path) => !path.includes("shader-diagnostics")));
});

test("native frontend prose keeps privacy filtering, bounds and idempotence without a phrase whitelist", async () => {
  const { sanitizeAirFrontendDiagnostics } = await import("../shader-diagnostics.mjs");
  const value = [
    "address space is not permitted on this declaration",
    "parameter is declared here",
    "type conversion changes address space",
    "non-const binding is invalid",
    "an unfamiliar diagnostic should still be reported",
    "1 | kernel void PRIVATE_SOURCE() { private_function(); }",
    "    ^~~~",
    "parameter cannot use prod.keys PRIVATE_KEY_CANARY",
    "parameter from '/Users/PRIVATE_PATH/game.metal' is invalid",
    "type C:\\Users\\PRIVATE_PATH\\game.metal cannot be used",
    "private_shader_identifier",
    "float4 PRIVATE_SOURCE;",
    "return private_function();",
    "// PRIVATE_SOURCE comment",
    "kernel void PRIVATE_SOURCE() { private_function(); }",
    "%private = call void @private_function()",
  ].join("\n");
  const actual = sanitizeAirFrontendDiagnostics(value);
  assert.deepEqual(
    actual.slice(0, 5),
    value
      .split("\n")
      .slice(0, 5)
      .map((line) => `frontend diagnostic: ${line}`),
  );
  assert.doesNotMatch(
    actual.join("\n"),
    /PRIVATE|private_shader_identifier|private_function|Users/,
  );
  assert.deepEqual(sanitizeCompilerDiagnostics(actual), actual);
  assert.deepEqual(sanitizeAirFrontendDiagnostics(actual.join("\n")), actual);
  assert.deepEqual(sanitizeShaderDiagnostic({ diagnostics: actual }).diagnostics, actual);
  const bounded = sanitizeAirFrontendDiagnostics(
    Array.from({ length: 30 }, (_, i) => `parameter ${i} ${"detail ".repeat(200)}`).join("\n"),
  );
  assert.ok(bounded.length <= 8);
  assert.ok(bounded.every((line) => line.length <= 512));
  assert.ok(bounded.join("").length <= 2048);
  assert.deepEqual(sanitizeCompilerDiagnostics(bounded), bounded);
  assert.deepEqual(sanitizeCompilerDiagnostics("parameter may not be qualified"), []);
  assert.deepEqual(shaderFailureDiagnostic(new Error("parameter may not be qualified")), {
    errorType: "Error",
  });
});
