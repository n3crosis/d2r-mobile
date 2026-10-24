// 不支持文件夹访问时的界面契约；只检查源码和能力表达式，不加载运行时或私有输入。
// UI contract without folder access; inspect source and capability expressions, never runtimes or private inputs.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { catalog } from "../i18n-catalog.mjs";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const faq = await readFile(
  new URL("../src/components/PreparationFaq.tsx", import.meta.url),
  "utf8",
);
const tree = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(tree);
const openings = nodes.filter(
  (node) => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node),
);
const attr = (node, key) =>
  node.attributes.properties.find(
    (entry) => ts.isJsxAttribute(entry) && entry.name.getText(tree) === key,
  )?.initializer;

test("folder access is detected by callable API, not browser name or OPFS availability", () => {
  const declaration = nodes.find(
    (node) =>
      ts.isVariableDeclaration(node) && node.name.getText(tree) === "supportsDirectoryPicker",
  );
  assert.ok(declaration);
  const expression = declaration.initializer.getText(tree);
  for (const [browser, expected] of [
    [{}, false],
    [{ navigator: { storage: { getDirectory() {} } } }, false],
    [{ showDirectoryPicker: true }, false],
    [{ showDirectoryPicker() {} }, true],
  ]) {
    assert.equal(runInNewContext(expression, { browser }), expected);
  }
  assert.doesNotMatch(expression, /userAgent|platform|storage/);
});

test("unsupported folder access has an early shared-table notice before the long guide", () => {
  const notice = openings.find((node) => attr(node, "role")?.text === "alert");
  assert.ok(notice);
  assert.ok(notice.pos < app.indexOf("<InstallationGuide"));
  const paragraph = notice.parent;
  assert.match(paragraph.getText(tree), /t\("dmWebFolderAccessUnsupported"\)/);
  assert.match(paragraph.parent.parent.getText(tree), /!supportsDirectoryPicker &&/);
  let inHeader = false;
  for (let parent = paragraph.parent; parent; parent = parent.parent) {
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText(tree) === "CardHeader")
      inHeader = true;
  }
  assert.ok(inHeader);
  assert.equal(catalog.dmWebFolderAccessUnsupported.length, 2);
  assert.match(catalog.dmWebFolderAccessUnsupported[0], /desktop Chrome or Edge/);
  assert.match(catalog.dmWebFolderAccessUnsupported[1], /桌面版 Chrome 或 Edge/);
});

test("unsupported bootstrap stops before downloading runtimes and keeps packaging disabled", () => {
  const effect = nodes.find(
    (node) =>
      ts.isCallExpression(node) &&
      node.expression.getText(tree) === "useEffect" &&
      node.getText(tree).includes("prepareBrowserPackager"),
  );
  const body = effect.getText(tree);
  assert.match(
    body,
    /if \(!supportsDirectoryPicker\) \{\s*setStatus\(t\("dmWebFolderAccessUnsupported"\)\);\s*return;/,
  );
  assert.ok(
    body.indexOf("if (!supportsDirectoryPicker)") < body.indexOf("void prepareBrowserPackager"),
  );
  assert.match(app, /disabled=\{!ready \|\| busy\}/);
  assert.match(app, /disabled=\{!generationReadiness\.canGenerate\}/);
});

test("language and help remain outside disabled fieldsets without a page-wide interaction block", () => {
  const language = openings.find((node) => attr(node, "id")?.text === "ui-language");
  assert.ok(language);
  assert.equal(attr(language, "disabled"), undefined);
  for (const control of [
    language,
    ...openings.filter((node) =>
      ["InstallationGuide", "PreparationFaq", "AccordionTrigger"].includes(
        node.tagName.getText(tree),
      ),
    ),
  ]) {
    for (let parent = control.parent; parent; parent = parent.parent) {
      if (ts.isJsxElement(parent)) {
        const ancestor = parent.openingElement;
        assert.equal(attr(ancestor, "inert"), undefined);
        if (["FieldSet", "fieldset"].includes(ancestor.tagName.getText(tree)))
          assert.equal(attr(ancestor, "disabled"), undefined);
      }
    }
  }
  assert.doesNotMatch(faq, /disabled=|inert=/);
  assert.doesNotMatch(app, /inert=|pointer-events-none/);
});
