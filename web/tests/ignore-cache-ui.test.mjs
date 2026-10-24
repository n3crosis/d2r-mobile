// 仅测试界面状态/选项及固定排障文字，不访问运行时或私有文件。
// UI state/options and fixed troubleshooting text only; no runtime or private file access.
import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import ts from "typescript";
import { readFile } from "node:fs/promises";
import { catalog } from "../i18n-catalog.mjs";
import { packagingActivity } from "../packaging-diagnostics.mjs";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(parsed);
const property = (object, key) =>
  object.properties.find((node) => node.name?.getText(parsed) === key);

test("ignore cache starts off and remains inside Advanced, without deleting existing files", () => {
  assert.match(app, /\[ignoreCache, setIgnoreCache\] = useState\(false\)/);
  const input = nodes.find(
    (node) =>
      ts.isJsxSelfClosingElement(node) &&
      node.tagName.getText(parsed) === "Checkbox" &&
      node.attributes.properties.some(
        (attribute) =>
          attribute.name.getText(parsed) === "id" && attribute.initializer?.text === "ignore-cache",
      ),
  );
  assert.ok(input);
  let panel;
  for (let parent = input.parent; parent; parent = parent.parent)
    if (
      ts.isJsxElement(parent) &&
      parent.openingElement.tagName.getText(parsed) === "AccordionItem"
    ) {
      panel = parent;
      break;
    }
  assert.equal(
    panel.openingElement.attributes.properties.find(
      (attribute) => attribute.name.getText(parsed) === "value",
    ).initializer.text,
    "advanced",
  );
  assert.doesNotMatch(app, /removeEntry\(|deleteDirectory\(/);
});

test("both cache policies are frozen per job and reach the actual session.generate call, not bootstrap", () => {
  const snapshot = nodes
    .find((node) => ts.isVariableDeclaration(node) && node.name.getText(parsed) === "jobOptions")
    .initializer.getText(parsed);
  const generate = nodes.find(
    (node) =>
      ts.isCallExpression(node) && node.expression.getText(parsed) === "jobPackager.generate",
  );
  const forwarded = property(generate.arguments[0], "ignoreCache").initializer.getText(parsed);
  const bootstrap = nodes.find(
    (node) =>
      ts.isCallExpression(node) && node.expression.getText(parsed) === "prepareBrowserPackager",
  );
  assert.equal(property(bootstrap.arguments[0], "ignoreCache"), undefined);
  for (const ignoreCache of [false, true]) {
    const state = {
      ignoreCache,
      profileId: "inert",
      legacyAstc: false,
      signing: false,
      astcPreset: "thorough",
      skipResources: false,
      inputMode: "packages",
    };
    const jobOptions = vm.runInNewContext(snapshot, state);
    assert.equal(Object.isFrozen(jobOptions), true);
    state.ignoreCache = !ignoreCache;
    assert.equal(vm.runInNewContext(forwarded, { jobOptions }), ignoreCache);
  }
});

test("cache help clearly separates manual private-cache cleanup from files the user must retain", () => {
  for (const key of [
    "dmWebIgnoreCache",
    "dmWebIgnoreCacheHelp",
    "dmWebIgnoreCacheActive",
    "dmWebFaqCacheQuestion",
    "dmWebFaqCacheAnswer",
  ])
    assert.ok(catalog[key]?.length === 2 && catalog[key].every((text) => text.length > 0), key);
  assert.match(
    catalog.dmWebIgnoreCacheHelp[0],
    /not deleted.*may update.*public runtime downloads/,
  );
  for (const text of catalog.dmWebFaqCacheAnswer) {
    assert.match(text, /D2R-cache/);
    assert.match(text, /D2R-resources-\*/);
    assert.match(text, /Legacy Device Pack/);
    assert.match(text, /data/);
  }
  assert.match(
    catalog.dmWebFaqCacheAnswer[0],
    /stop generation and close other packager tabs.*delete only the D2R-cache folder inside your selected game folder/,
  );
  assert.match(
    catalog.dmWebFaqCacheAnswer[0],
    /Do not delete.*original game files, keys, or saves/,
  );
  assert.match(
    catalog.dmWebFaqCacheAnswer[1],
    /先停止生成并关闭其他打包页面.*仅删除所选游戏文件夹内的 D2R-cache/,
  );
  assert.match(catalog.dmWebFaqCacheAnswer[1], /不要删除.*原始游戏文件、密钥或存档/);
});

test("cache unavailability is a fixed localized notice and never an overall progress milestone", () => {
  const notice = packagingActivity({
    phase: "cache",
    status: "unavailable",
    message: "untrusted raw filesystem text",
    path: "untrusted-path",
  });
  assert.ok(catalog.dmWebCacheUnavailable.includes(notice));
  assert.doesNotMatch(notice, /untrusted/);
  assert.equal(
    packagingActivity({
      phase: "cache",
      status: "untrusted-status",
      stage: "assets",
      state: "complete",
    }),
    null,
  );
  const handler = nodes.find(
    (node) => ts.isJsxAttribute(node) && node.name.getText(parsed) === "onProgress",
  );
  // 会话进度是对象回调，不是 DOM 处理器。
  // Session progress is an object callback, not a DOM handler.
  assert.equal(handler, undefined);
  const callback = nodes.find(
    (node) =>
      ts.isPropertyAssignment(node) &&
      node.name.getText(parsed) === "onProgress" &&
      node.initializer.getText(parsed).includes("acceptingProgress"),
  ).initializer;
  const cacheBranch = callback.body.statements.find(
    (node) =>
      ts.isIfStatement(node) && node.expression.getText(parsed) === 'event.phase === "cache"',
  );
  assert.match(cacheBranch.getText(parsed), /appendActivity\(cacheLabel, true\)/);
  assert.match(cacheBranch.getText(parsed), /return;/);
  assert.doesNotMatch(
    cacheBranch.getText(parsed),
    /tracker.observe|tracker.generated|publishProgress/,
  );
});
