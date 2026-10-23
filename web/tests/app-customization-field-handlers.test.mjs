// 只执行从表单源码读取的隔离回调；不启动浏览器或读取用户文件。
// Execute only isolated callbacks read from the form source; no browser or user files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import {
  resolveAppCustomizationDefaults,
  updateAppCustomizationDraft,
} from "../app-customization-defaults.mjs";
const source = await readFile(
  new URL("../src/components/AppCustomizationFields.tsx", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile(
  "Fields.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
function callback(attribute, contains) {
  const found = [];
  function visit(node) {
    if (ts.isJsxAttribute(node) && node.name.getText(parsed) === attribute) {
      const expression = node.initializer?.expression;
      if (expression?.getText(parsed).includes(contains)) found.push(expression.getText(parsed));
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(found.length, 1, `${attribute}: ${contains}`);
  return found[0];
}
const defaults = resolveAppCustomizationDefaults("v2.0.0-ios26");
function context(overrides = {}) {
  const changes = [];
  return {
    changes,
    scope: {
      defaults,
      value: {},
      name: "version",
      disabled: false,
      iconInput: { current: { value: "selected.png" } },
      updateAppCustomizationDraft,
      onChange: (value) => changes.push(value),
      ...overrides,
    },
  };
}

test("actual text callback stores only the edit and restores exact shell values without an override", () => {
  const { changes, scope } = context();
  const change = vm.runInNewContext(callback("onChange", "updateAppCustomizationDraft"), scope);
  change({ target: { value: "2.3.4" } });
  change({ target: { value: defaults.version } });
  assert.deepEqual(changes, [{ version: "2.3.4" }, {}]);
});

test("actual blur callback restores blanks, preserves deliberate edits and ignores disabled controls", () => {
  const blur = callback("onBlur", "updateAppCustomizationDraft");
  for (const [value, disabled, count] of [
    [{ version: "" }, false, 1],
    [{ version: "2.3.4" }, false, 0],
    [{ version: "" }, true, 0],
  ]) {
    const { changes, scope } = context({ value, disabled });
    vm.runInNewContext(blur, scope)();
    assert.equal(changes.length, count);
    if (count) assert.deepEqual(changes[0], {});
  }
});

test("actual reset clears text edits and file selection, is repeatable, and respects disabled state", () => {
  const reset = callback("onClick", "onChange({})");
  const { changes, scope } = context({ value: { displayName: "Changed", icon: {} } });
  const invoke = vm.runInNewContext(reset, scope);
  invoke();
  invoke();
  assert.deepEqual(changes.map(Object.keys), [[], []]);
  assert.equal(scope.iconInput.current.value, "");
  const blocked = context({ disabled: true });
  vm.runInNewContext(reset, blocked.scope)();
  assert.equal(blocked.changes.length, 0);
  assert.equal(blocked.scope.iconInput.current.value, "selected.png");
});

test("actual icon removal retains deliberate text edits and returns to the shell icon", () => {
  const { changes, scope } = context({ value: { displayName: "Changed", icon: {} } });
  vm.runInNewContext(callback("onClick", "icon: undefined"), scope)();
  assert.equal(changes[0].displayName, "Changed");
  assert.equal(changes[0].icon, undefined);
  assert.equal(scope.iconInput.current.value, "");
  assert.doesNotMatch(source, /<img\b|createObjectURL|FileReader|fetch\(/);
});
