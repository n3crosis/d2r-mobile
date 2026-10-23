// 仅测试静态树及隔离回调，不使用浏览器、运行时或用户文件。
// Static tree and isolated callbacks only. No browser, runtime or user-provided files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const fields = await readFile(
  new URL("../src/components/AppCustomizationFields.tsx", import.meta.url),
  "utf8",
);
const parse = (source) =>
  ts.createSourceFile("UI.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const appTree = parse(app);
const fieldTree = parse(fields);
function matching(tree, predicate) {
  const found = [];
  function visit(node) {
    if (predicate(node)) found.push(node);
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}
const openings = matching(
  appTree,
  (node) => ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node),
);
const attr = (node, key) =>
  node.attributes.properties.find(
    (entry) => ts.isJsxAttribute(entry) && entry.name.getText() === key,
  )?.initializer;
function ancestor(node, tag) {
  for (let parent = node.parent; parent; parent = parent.parent)
    if (ts.isJsxElement(parent) && parent.openingElement.tagName.getText() === tag) return parent;
}

test("editable identity and signing controls are in the main view with no disclosure ancestor", () => {
  const customization = openings.filter(
    (node) => node.tagName.getText() === "AppCustomizationFields",
  );
  assert.equal(customization.length, 2);
  const identity = customization.find((node) => attr(node, "section")?.text === "identity");
  const advanced = customization.find((node) => attr(node, "section")?.text === "advanced");
  assert.ok(identity);
  assert.ok(advanced);
  assert.equal(ancestor(identity, "Accordion"), undefined);
  assert.equal(attr(ancestor(advanced, "AccordionItem").openingElement, "value").text, "advanced");
  assert.ok(
    ancestor(advanced, "AccordionContent").openingElement.attributes.properties.some(
      (entry) => ts.isJsxAttribute(entry) && entry.name.getText() === "forceMount",
    ),
  );
  assert.doesNotMatch(app, /identityPreview|<dl\b|<AccordionItem value="signing"/);
  for (const id of ["signing-enabled", "signing-identity", "signing-password", "signing-profile"]) {
    const controls = openings.filter((node) => attr(node, "id")?.text === id);
    assert.equal(controls.length, 1, `${id} has one mounted control`);
    assert.equal(ancestor(controls[0], "Accordion"), undefined, id);
    for (let parent = controls[0].parent; parent; parent = parent.parent)
      assert.ok(!ts.isJsxExpression(parent), `${id} is not conditionally mounted`);
  }
});

test("identity and advanced fields form disjoint groups with a single visible error and icon input", () => {
  const definition = matching(
    fieldTree,
    (node) => ts.isVariableDeclaration(node) && node.name.getText() === "fields",
  )[0];
  const descriptors = matching(definition, ts.isObjectLiteralExpression).map((node) =>
    Object.fromEntries(
      node.properties.map((property) => [property.name.getText(), property.initializer.text]),
    ),
  );
  assert.deepEqual(
    descriptors.filter((field) => field.section === "identity").map((field) => field.name),
    ["displayName", "bundleIdentifier"],
  );
  assert.deepEqual(
    descriptors.filter((field) => field.section === "advanced").map((field) => field.name),
    ["version", "buildVersion"],
  );
  assert.equal(new Set(descriptors.map((field) => field.name)).size, 4);
  assert.match(fields, /\.filter\(\(field\) => field.section === section\)/);
  assert.match(fields, /value=\{value\[name\] \?\? defaults\[name\]\}/);
  assert.match(fields, /section === "identity" && error &&/);
  const icon = matching(
    fieldTree,
    (node) => ts.isJsxSelfClosingElement(node) && attr(node, "id")?.text === "custom-icon",
  );
  assert.equal(icon.length, 1);
  let condition;
  for (let parent = icon[0].parent; parent; parent = parent.parent)
    if (ts.isJsxExpression(parent)) {
      condition = parent.expression;
      break;
    }
  assert.match(condition.getText(), /^section === "advanced" &&/);
});
