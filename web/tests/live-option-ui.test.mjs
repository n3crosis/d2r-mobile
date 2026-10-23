// 真实回调的隔离测试；不渲染页面、不运行编译器或访问私有文件。
// Isolated real callbacks, not rendered UI, compiler execution or private file access.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import ts from "typescript";
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) {
  if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(parsed);
function callback(anchor) {
  const node = nodes.find((node) => node.getText(parsed).includes(anchor));
  assert.ok(node, anchor);
  const attribute = node.attributes.properties.find(
    (property) =>
      ts.isJsxAttribute(property) &&
      ["onChange", "onValueChange", "onCheckedChange"].includes(property.name.getText(parsed)),
  );
  assert.ok(attribute, anchor);
  const expression = attribute.initializer.expression;
  // 仅保留参数名称及函数体，类型只解析，不编译或执行。
  // Parameter names + body only: types are parsed, never compiled or executed.
  return {
    code: `(${expression.parameters.map((parameter) => parameter.name.getText(parsed)).join(",")}) => ${expression.body.getText(parsed)}`,
    native: attribute.name.getText(parsed) === "onChange",
  };
}
const cases = [
  ['id="ios-target"', "setTarget", "ios18", "value"],
  ["checked={legacyAstc}", "setLegacyAstc", true, "checked"],
  ["checked={!skipContentHashes}", "setSkipContentHashes", true, "checked"],
  ['id="astc-preset"', "setAstcPreset", "fast", "value"],
  ["checked={signing}", "setSigning", true, "checked"],
  ["checked={ignoreCache}", "setIgnoreCache", true, "checked"],
];
function context(overrides = {}) {
  const writes = [];
  return {
    writes,
    value: {
      target: "ios26",
      legacyAstc: false,
      astcPreset: "thorough",
      signing: false,
      skipContentHashes: true,
      ignoreCache: false,
      busy: false,
      generating: false,
      finished: false,
      download: null,
      folder: { name: "selected" },
      hasSelectedFolder: true,
      operationGate: { current: { busy: false } },
      clearSigningInputs: () => writes.push(["clearSigningInputs"]),
      ...Object.fromEntries(
        cases.map(([, setter]) => [setter, (value) => writes.push([setter, value])]),
      ),
      ...overrides,
    },
  };
}
function invoke(anchor, value, field, globals) {
  const handler = callback(anchor);
  vm.runInNewContext(
    handler.code,
    globals,
  )(handler.native ? { target: { [field]: value } } : value);
}
test("all configuration choices remain editable after a successful folder selection", () => {
  for (const [anchor, setter, value, field] of cases) {
    const state = context();
    invoke(anchor, value, field, state.value);
    assert.deepEqual(state.writes, [[setter, setter === "setSkipContentHashes" ? false : value]]);
  }
});
test("operation ownership and terminal output protect every option from stale events", () => {
  for (const override of [
    { busy: true },
    { generating: true },
    { finished: true },
    { download: {} },
    { operationGate: { current: { busy: true } } },
  ])
    for (const [anchor, , value, field] of cases) {
      const state = context(override);
      invoke(anchor, value, field, state.value);
      assert.deepEqual(state.writes, [], anchor);
    }
});
test("disabling local signing clears transient credentials without discarding output", () => {
  const state = context({ signing: true });
  invoke("checked={signing}", false, "checked", state.value);
  assert.deepEqual(state.writes, [["clearSigningInputs"], ["setSigning", false]]);
});
test("option changes do not restart bootstrap, consume a job or dispose retained output", () => {
  const setup = app.slice(
    app.indexOf("const preparedDownload ="),
    app.indexOf("  async function choose()"),
  );
  assert.match(setup, /editableOptions: true/);
  assert.match(setup, /\}, \[appendActivity\]\)/);
  assert.doesNotMatch(app, /window\.location\.assign|setHasSelectedFolder/);
  for (const [anchor] of cases)
    assert.doesNotMatch(
      callback(anchor).code,
      /prepareBrowserPackager|\.close\(|\.dispose\(|setFolder|setDownload|setSigningRetryAvailable/,
    );
});
