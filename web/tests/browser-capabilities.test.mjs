// 合成 API 存在性检查，不访问浏览器权限或更改共享全局对象。
// Synthetic API presence checks do not access browser permissions or alter shared globals.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { assertBrowserPackagerCapabilities } from "../browser-packager.mjs";

function supported() {
  const unused = () => assert.fail("presence check must not invoke APIs");
  return {
    isSecureContext: true,
    navigator: { locks: { request: unused }, storage: { getDirectory: unused, estimate: unused } },
    Worker: unused,
    DecompressionStream: class {
      constructor(format) {
        assert.equal(format, "gzip");
      }
    },
    crypto: { subtle: {}, randomUUID: unused },
    AbortSignal: { any: unused, prototype: { throwIfAborted: unused } },
  };
}

test("complete capability surface passes without requesting permissions or reading input", () => {
  assert.doesNotThrow(() => assertBrowserPackagerCapabilities(supported()));
});

test("storage estimates are optional and never read by the capability check", () => {
  const environment = supported();
  delete environment.navigator.storage.estimate;
  assert.doesNotThrow(() => assertBrowserPackagerCapabilities(environment));
  Object.defineProperty(environment.navigator.storage, "estimate", {
    get() {
      throw new Error("storage estimates must not gate browser support");
    },
  });
  assert.doesNotThrow(() => assertBrowserPackagerCapabilities(environment));
});

test("missing or non-callable required methods use the existing unsupported code", () => {
  for (const path of [
    ["navigator", "storage", "getDirectory"],
    ["navigator", "locks", "request"],
    ["Worker"],
    ["DecompressionStream"],
    ["crypto", "randomUUID"],
    ["AbortSignal", "any"],
    ["AbortSignal", "prototype", "throwIfAborted"],
  ]) {
    for (const value of [undefined, null, true, {}]) {
      const environment = supported();
      let owner = environment;
      for (const key of path.slice(0, -1)) owner = owner[key];
      owner[path.at(-1)] = value;
      assert.throws(() => assertBrowserPackagerCapabilities(environment), {
        message: "BROWSER_UNSUPPORTED",
      });
    }
  }
});

test("missing parent objects and insecure contexts reject without ReferenceError", () => {
  for (const override of [
    { isSecureContext: false },
    { navigator: undefined },
    { navigator: {} },
    { crypto: undefined },
    { crypto: { randomUUID() {} } },
    { AbortSignal: undefined },
    { AbortSignal: { any() {} } },
  ]) {
    assert.throws(() => assertBrowserPackagerCapabilities({ ...supported(), ...override }), {
      message: "BROWSER_UNSUPPORTED",
    });
  }
});

function assertCapabilityOrder(source) {
  const file = ts.createSourceFile(
    "packager.mjs",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.JS,
  );
  assert.equal(file.parseDiagnostics.length, 0);
  const entry = file.statements.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.text === "prepareBrowserPackager",
  );
  assert.ok(entry?.body);
  for (const kind of [ts.SyntaxKind.ExportKeyword, ts.SyntaxKind.AsyncKeyword])
    assert.ok(entry.modifiers?.some((modifier) => modifier.kind === kind));
  const nodes = [];
  const visit = (node) => {
    if (ts.isFunctionLike(node)) {
      // 跳过未调用的定义，但立即调用的函数体仍参与前置等待检查。
      // Skip inert definitions, but include immediately invoked bodies in the pre-check await rule.
      let callee = node;
      while (ts.isParenthesizedExpression(callee.parent)) callee = callee.parent;
      if (!ts.isCallExpression(callee.parent) || callee.parent.expression !== callee) return;
    }
    nodes.push(node);
    ts.forEachChild(node, visit);
  };
  visit(entry.body);
  const call = (name) => {
    const matches = nodes.filter(
      (node) =>
        ts.isCallExpression(node) &&
        ts.isIdentifier(node.expression) &&
        node.expression.text === name,
    );
    assert.equal(matches.length, 1, `Expected one ${name} call`);
    return matches[0];
  };
  const check = call("assertBrowserPackagerCapabilities"),
    setup = call("prepareSealedRuntime"),
    profile = call("loadProductionProfile");
  assert.ok(
    entry.body.statements.some(
      (node) => ts.isExpressionStatement(node) && node.expression === check,
    ),
  );
  assert.ok(ts.isAwaitExpression(setup.parent));
  assert.ok(ts.isAwaitExpression(profile.parent));
  assert.ok(check.pos < setup.pos && setup.pos < profile.pos);
  assert.equal(
    nodes.some((node) => ts.isAwaitExpression(node) && node.pos < check.pos),
    false,
  );
}

test("capability ordering ignores harmless comments and formatting, not missing or reordered checks", () => {
  for (const source of [
    `export async function prepareBrowserPackager() {
      // 验证前不等待。 | Do not await setup before the check.
      assertBrowserPackagerCapabilities();
      const runtime = await prepareSealedRuntime();
      await loadProductionProfile(runtime);
    }`,
    `export async function prepareBrowserPackager () {
      const unused = async () => await unrelatedWork();
      assertBrowserPackagerCapabilities /* 校验 | Check */ ( );
      const runtime = await prepareSealedRuntime\n( );
      await loadProductionProfile\n(runtime);
    }`,
  ])
    assert.doesNotThrow(() => assertCapabilityOrder(source));

  for (const body of [
    "/* assertBrowserPackagerCapabilities(); */ const runtime = await prepareSealedRuntime(); await loadProductionProfile(runtime);",
    "const runtime = await prepareSealedRuntime(); assertBrowserPackagerCapabilities(); await loadProductionProfile(runtime);",
    "await otherWork(); assertBrowserPackagerCapabilities(); const runtime = await prepareSealedRuntime(); await loadProductionProfile(runtime);",
    "(async () => { await otherWork(); })(); assertBrowserPackagerCapabilities(); const runtime = await prepareSealedRuntime(); await loadProductionProfile(runtime);",
    "((async function () { await otherWork(); }))(); assertBrowserPackagerCapabilities(); const runtime = await prepareSealedRuntime(); await loadProductionProfile(runtime);",
    "function unused() { assertBrowserPackagerCapabilities(); } const runtime = await prepareSealedRuntime(); await loadProductionProfile(runtime);",
    "assertBrowserPackagerCapabilities(); const runtime = prepareSealedRuntime(); await loadProductionProfile(runtime);",
    "assertBrowserPackagerCapabilities(); await loadProductionProfile(); const runtime = await prepareSealedRuntime();",
  ])
    assert.throws(() =>
      assertCapabilityOrder(`export async function prepareBrowserPackager() { ${body} }`),
    );
});

test("production bootstrap checks capabilities before runtime setup and private input methods", async () => {
  const source = await readFile(new URL("../browser-packager.mjs", import.meta.url), "utf8");
  assertCapabilityOrder(source);
});

test("gzip constructor rejection uses the existing unsupported code", () => {
  for (const DecompressionStream of [
    () => undefined,
    class {
      constructor() {
        throw new TypeError("unsupported gzip");
      }
    },
  ]) {
    assert.throws(
      () => assertBrowserPackagerCapabilities({ ...supported(), DecompressionStream }),
      { message: "BROWSER_UNSUPPORTED" },
    );
  }
});
