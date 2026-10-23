// 惰性界面与文件夹状态测试，只运行真实处理器的隔离片段和内存桩。
// Inert UI/folder state tests run isolated real-handler snippets and in-memory stubs only.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { createUiOperationGate } from "../ui-operation-gate.mjs";
import { catalog } from "../i18n-catalog.mjs";
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const details = [];
const selects = [];
function visit(node) {
  if (
    ts.isJsxElement(node) &&
    ["details", "AccordionItem"].includes(node.openingElement.tagName.getText(parsed))
  )
    details.push(node);
  if (
    ts.isJsxOpeningElement(node) &&
    ["select", "NativeSelect"].includes(node.tagName.getText(parsed))
  )
    selects.push(node);
  ts.forEachChild(node, visit);
}
visit(parsed);
function attribute(node, name) {
  return node.attributes.properties.find(
    (entry) => ts.isJsxAttribute(entry) && entry.name.getText(parsed) === name,
  );
}
test("default primary flow contains no expanded selectors and keeps overrides together", () => {
  const advanced = details.find((node) =>
    node.getText(parsed).includes('t("dmWebAdvancedOptions")'),
  );
  assert.ok(advanced);
  assert.equal(attribute(advanced.openingElement, "open"), undefined);
  for (const select of selects) {
    assert.ok(select.pos > advanced.pos && select.end < advanced.end);
  }
  for (const setting of [
    "checked={legacyAstc}",
    "checked={!skipContentHashes}",
    "checked={skipResources}",
  ])
    assert.ok(advanced.getText(parsed).includes(setting));
  assert.ok(app.indexOf('{t("dmWebChoose")}') < advanced.pos);
  assert.ok(app.indexOf('t("dmWebGenerate")') < advanced.pos);
  assert.ok(app.indexOf("{status}") < advanced.pos);
  assert.ok(app.indexOf("originalIdentityDownload\n") < advanced.pos);
  const signing = details.find((node) => node.getText(parsed).includes('t("dmWebSigningOptions")'));
  if (signing.openingElement.tagName.getText(parsed) === "AccordionItem") {
    assert.equal(attribute(signing.openingElement, "value").initializer.text, "signing");
    assert.match(app, /useState<string\[\]>\(\(\) => \(signing \? \["signing"\] : \[\]\)\)/);
    assert.match(app, /if \(signingRetryAvailable\)[\s\S]*?setOpenOptions/);
  } else {
    assert.equal(
      attribute(signing.openingElement, "open").initializer.expression.getText(parsed),
      "signing || signingRetryAvailable",
    );
  }
  assert.match(app, /get\("target"\) === "ios18" \? "ios18" : "ios26"/);
  assert.match(app, /get\("legacyAstc"\) === "1"/);
  assert.doesNotMatch(app, /userAgent|userAgentData|deviceMemory/);
});
test("brief compatibility and detection copy does not claim authenticated extracted content", () => {
  for (const key of [
    "dmWebAutoInstructions",
    "dmWebOutputCompatibility",
    "dmWebBcTextures",
    "dmWebLegacyTextures",
    "dmWebOptionsBeforeFolder",
    "dmWebAdvancedOptions",
    "dmWebSigningOptions",
    "dmWebIncludedPackages",
    "dmWebPackagesReady",
    "dmWebDetectingInput",
  ])
    assert.ok(
      catalog[key]?.every((value) => value.length > 0),
      key,
    );
  assert.match(catalog.dmWebBcTextures[0], /required/);
  assert.match(catalog.dmWebLegacyTextures[0], /unverified/);
  assert.match(catalog.dmWebOptionsBeforeFolder[0], /before generating/);
  assert.match(catalog.dmWebExtractedInstructions[0], /not authenticated/);
  assert.match(catalog.dmWebIncludedPackages[0], /All/);
});
// 只去掉处理器中的三处类型注解，不构建应用、不加载真实打包器。
// Remove only the handler's three type annotations; do not build the app or load the real packager.
const chooseSource = app
  .slice(app.indexOf("  async function choose()"), app.indexOf("  function prepareDownload("))
  .replace("let progress: FolderProgress", "let progress")
  .replace("(event: FolderProgress)", "(event)")
  .replace("(error as { code?: string })", "error");
function harness({ pick, discover, previous = {} }) {
  const writes = [],
    calls = [];
  const state = {
    ready: true,
    busy: false,
    status: "ready",
    folder: null,
    inputMode: null,
    nspNames: [],
    skipResources: false,
    ...previous,
  };
  const gate = createUiOperationGate();
  const context = {
    ...state,
    DOMException,
    mounted: { current: true },
    operationGate: { current: gate },
    cancellation: { current: null },
    packager: { current: { close: async () => calls.push("close") } },
    browser: {
      showDirectoryPicker: async () => {
        calls.push("pick");
        return pick();
      },
    },
    discoverGameFolder: async (folder, options) => {
      calls.push("discover");
      assert.equal(Object.hasOwn(options, "inputMode"), false);
      return discover(folder, options);
    },
    t: (key, ...args) => [key, ...args].join(" | "),
    folderSummary: (event) => event.inputMode ?? "auto",
    gameFolderFailureMessage: (code) => code,
    appendActivity: (value) => writes.push(["activity", value]),
  };
  for (const name of [
    "Busy",
    "Cancelling",
    "Status",
    "SkipResources",
    "Folder",
    "NspNames",
    "InputMode",
    "Finished",
  ])
    context[`set${name}`] = (value) => {
      const key = name[0].toLowerCase() + name.slice(1);
      state[key] = value;
      writes.push([key, value]);
    };
  const choose = vm.runInNewContext(`${chooseSource}\nchoose;`, context);
  return { state, calls, writes, gate, context, choose };
}
const deferred = () => {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
};
test("automatic discovery includes every package, including DLC, with no filename heuristics", async () => {
  const folder = { name: "game" };
  const names = ["base.xci", "update.nsp", "DLC.nsp"];
  const h = harness({
    pick: () => folder,
    discover: async (_folder, { onProgress }) => {
      onProgress({
        inputMode: "packages",
        nspCount: names.length,
        prodKeysFound: true,
        titleKeysFound: true,
      });
      return { inputMode: "packages", nsps: names.map((name) => ({ name })) };
    },
    previous: { skipResources: true },
  });
  await h.choose();
  assert.equal(h.state.folder, folder);
  assert.equal(h.state.inputMode, "packages");
  assert.deepEqual([...h.state.nspNames], names);
  assert.equal(h.state.skipResources, false);
  assert.equal(h.state.busy, false);
  assert.equal(h.gate.busy, false);
  assert.match(h.state.status, /dmWebPackagesReady/);
});
test("extracted detection sets provenance and clears package state from an earlier folder", async () => {
  const folder = { name: "extracted" };
  const h = harness({
    pick: () => folder,
    discover: async () => ({ inputMode: "extracted", nsps: [] }),
    previous: {
      folder: { name: "old" },
      nspNames: ["old.nsp"],
      inputMode: "packages",
      skipResources: true,
    },
  });
  await h.choose();
  assert.equal(h.state.folder, folder);
  assert.equal(h.state.inputMode, "extracted");
  assert.equal(h.state.nspNames.length, 0);
  assert.equal(h.state.skipResources, false);
  assert.ok(
    h.writes.some(([key, value]) => key === "activity" && value === "dmWebExtractedChecked"),
  );
});
test("failed package discovery cannot retain a prior extracted selection or retry a weaker route", async () => {
  const h = harness({
    pick: () => ({ name: "packages" }),
    discover: async () => {
      throw Object.assign(new Error("missing keys"), { code: "MISSING_INPUT" });
    },
    previous: {
      folder: { name: "old" },
      inputMode: "extracted",
      nspNames: ["old.nsp"],
      skipResources: true,
    },
  });
  await h.choose();
  assert.equal(h.state.folder, null);
  assert.equal(h.state.inputMode, null);
  assert.equal(h.state.nspNames.length, 0);
  assert.equal(h.calls.filter((call) => call === "discover").length, 1);
  assert.match(h.state.status, /MISSING_INPUT/);
});
test("failed or dismissed first selection does not permanently lock configuration", async () => {
  for (const failure of ["picker", "discovery"]) {
    const h = harness({
      pick: () => {
        if (failure === "picker") throw new DOMException("cancel", "AbortError");
        return { name: "invalid" };
      },
      discover: () => {
        throw Object.assign(new Error("missing keys"), { code: "MISSING_INPUT" });
      },
    });
    await h.choose();
    assert.equal(h.state.busy, false, failure);
    assert.equal(h.gate.busy, false, failure);
  }
});
test("picker dismissal preserves an earlier selection and never starts discovery", async () => {
  const old = { name: "old" };
  const h = harness({
    pick: () => {
      throw new DOMException("cancel", "AbortError");
    },
    discover: () => assert.fail("unexpected discovery"),
    previous: {
      folder: old,
      inputMode: "packages",
      nspNames: ["old.nsp"],
      skipResources: true,
      status: "previous",
    },
  });
  await h.choose();
  assert.equal(h.state.folder, old);
  assert.equal(h.state.skipResources, true);
  assert.equal(h.state.status, "previous");
  assert.deepEqual(h.calls, ["pick"]);
  assert.equal(h.gate.busy, false);
});
test("duplicate clicks cannot start a second scan before rendered busy state catches up", async () => {
  const pending = deferred();
  const h = harness({
    pick: () => pending.promise,
    discover: async () => ({ inputMode: "packages", nsps: [{ name: "game.nsp" }] }),
  });
  const first = h.choose();
  await h.choose();
  assert.equal(h.calls.filter((call) => call === "pick").length, 1);
  pending.resolve({ name: "game" });
  await first;
  assert.equal(h.calls.filter((call) => call === "discover").length, 1);
  assert.equal(h.gate.busy, false);
});
test("late cancelled discovery cannot repopulate mode or packages and closes the owned runtime", async () => {
  const pending = deferred(),
    started = deferred();
  const h = harness({
    pick: () => ({ name: "game" }),
    discover: () => {
      started.resolve();
      return pending.promise;
    },
  });
  const task = h.choose();
  await started.promise;
  h.context.cancellation.current.abort();
  pending.resolve({ inputMode: "packages", nsps: [{ name: "late.nsp" }] });
  await task;
  assert.equal(h.state.folder, null);
  assert.equal(h.state.inputMode, null);
  assert.equal(h.state.nspNames.length, 0);
  assert.equal(h.state.finished, true);
  assert.equal(h.calls.filter((call) => call === "close").length, 1);
  assert.equal(h.gate.busy, false);
});
test("late unmounted discovery cannot publish state or release a replacement operation", async () => {
  const pending = deferred(),
    started = deferred();
  const h = harness({
    pick: () => ({ name: "game" }),
    discover: () => {
      started.resolve();
      return pending.promise;
    },
  });
  const task = h.choose();
  await started.promise;
  h.context.mounted.current = false;
  h.gate.cancel();
  const replacement = h.gate.begin();
  const count = h.writes.length;
  pending.resolve({ inputMode: "extracted", nsps: [] });
  await task;
  assert.equal(h.writes.length, count);
  assert.equal(replacement.isCurrent(), true);
  replacement.finish();
});

// 固定诊断按优先级映射；不把原始证书、描述文件或错误内容带进界面。
// Map fixed diagnostics in precedence order without exposing certificate, profile or raw error content.
test("signer length limit stays actionable, sanitized, and subordinate to cancellation", () => {
  let expression;
  function findDiagnostic(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(parsed) === "signingMessage") {
      expression = node.initializer?.getText(parsed);
    }
    ts.forEachChild(node, findDiagnostic);
  }
  findDiagnostic(parsed);
  assert.ok(expression);
  for (const [code, expected] of [
    ["SIGNING_APPLICATION_ID_TOO_LONG", "dmWebSigningApplicationIdTooLong"],
    ["SIGNING_PROFILE_MISMATCH", "dmWebSigningProfileMismatch"],
    ["PRIVATE-PROFILE-NAME", "dmWebSigningFailed"],
  ]) {
    for (const aborted of [false, true]) {
      const result = vm.runInNewContext(expression, {
        Error,
        signingError: new Error(code),
        controller: { signal: { aborted } },
        t: (key) => key,
      });
      assert.equal(result, aborted ? "dmWebSigningCancelled" : expected);
    }
  }
  assert.match(
    catalog.dmWebSigningApplicationIdTooLong[0],
    /255-character limit.*Unsigned IPA retained.*another signer.*shorter bundle ID/,
  );
});
