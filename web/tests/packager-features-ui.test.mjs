// 惰性界面契约与隔离回调测试，不加载浏览器、编译器、真实游戏或签名凭据。
// Inert UI contracts and isolated callbacks; no browser, compiler, real game or signing credentials.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { PROGRAM_COMPATIBILITY } from "../program-compatibility.mjs";
import { catalog } from "../i18n-catalog.mjs";
import {
  appCustomizationFailureMessage,
  gameFolderFailureMessage,
  packagingFailureSummary,
} from "../packaging-diagnostics.mjs";
const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const customization = await readFile(
  new URL("../src/components/AppCustomizationFields.tsx", import.meta.url),
  "utf8",
);
const parsed = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function handler(tag, id) {
  const matches = [];
  function visit(node) {
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      node.tagName.getText(parsed) === tag
    ) {
      const attributes = node.attributes.properties.filter(ts.isJsxAttribute);
      const identifier = attributes.find((attribute) => attribute.name.getText(parsed) === "id");
      if (!id || identifier?.initializer?.text === id) {
        const change = attributes.find(
          (attribute) => attribute.name.getText(parsed) === "onChange",
        );
        if (change?.initializer && ts.isJsxExpression(change.initializer))
          matches.push(change.initializer.expression.getText(parsed));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(matches.length, 1);
  return matches[0];
}
function inputContext(overrides = {}) {
  const writes = [];
  const context = {
    ready: true,
    busy: false,
    finished: false,
    download: null,
    inputMode: "packages",
    operationGate: { current: { busy: false } },
    t: (key) => key,
    ...Object.fromEntries(
      [
        "setInputMode",
        "setFolder",
        "setNspNames",
        "setSelectedNsps",
        "setSkipResources",
        "setStatus",
        "setAppCustomization",
        "setCustomizationError",
      ].map((name) => [name, (value) => writes.push([name, value])]),
    ),
    ...overrides,
  };
  return { writes, context };
}
test("changing input route invalidates selected inputs and resource skipping atomically", () => {
  const { context, writes } = inputContext();
  vm.runInNewContext(handler("select", "input-mode"), context)({ target: { value: "extracted" } });
  assert.deepEqual(
    writes.map(([name]) => name),
    [
      "setInputMode",
      "setFolder",
      "setNspNames",
      "setSelectedNsps",
      "setSkipResources",
      "setStatus",
    ],
  );
  assert.equal(writes[0][1], "extracted");
  assert.equal(writes[1][1], null);
  assert.equal(writes[2][1].length, 0);
  assert.equal(writes[3][1].size, 0);
  assert.equal(writes[4][1], false);
});
test("stale or terminal input/customization changes cannot mutate an active operation", () => {
  for (const overrides of [
    { ready: false },
    { busy: true },
    { finished: true },
    { download: {} },
    { operationGate: { current: { busy: true } } },
  ]) {
    const { context, writes } = inputContext(overrides);
    vm.runInNewContext(
      handler("select", "input-mode"),
      context,
    )({ target: { value: "extracted" } });
    vm.runInNewContext(handler("AppCustomizationFields"), context)({ displayName: "changed" });
    assert.equal(writes.length, 0);
  }
  for (const value of ["packages", "unknown", ""]) {
    const { context, writes } = inputContext();
    vm.runInNewContext(handler("select", "input-mode"), context)({ target: { value } });
    assert.equal(writes.length, 0);
  }
});
test("package input remains default and only package mode submits selected package names", () => {
  assert.match(app, /useState<InputMode>\("packages"\)/);
  assert.match(app, /discoverGameFolder\(selected, \{\s*inputMode,\s*signal:/);
  assert.match(
    app,
    /inputMode === "packages" \? \{ selectedNspNames: \[\.\.\.selectedNsps\] \} : \{\}/,
  );
  assert.equal((app.match(/inputMode === "packages" && !selectedNsps.size/g) ?? []).length, 2);
  assert.match(app, /inputMode === "packages" && nspNames.length > 0/);
  assert.match(catalog.dmWebInstructions[0], /NSP\/XCI.*prod.keys/);
  assert.match(
    catalog.dmWebExtractedInstructions[0],
    /already-merged ExeFS and RomFS.*No keys needed/,
  );
  assert.match(
    catalog.dmWebExtractedInstructions[0],
    /Base\/update only.*expansion input is unsupported.*not authenticated/,
  );
  assert.match(app, /if \(inputMode === "packages"\)\s*appendActivity\(t\(skipContentHashes/);
});
test("compatibility display derives from the actual selected profile registry", () => {
  assert.match(
    app,
    /PROGRAM_COMPATIBILITY.releases[\s\S]*?profile.id === profileId[\s\S]*?programReleaseIds.includes\(release.id\)/,
  );
  assert.match(app, /dmWebSupportedVersions", supportedVersions/);
  assert.ok(PROGRAM_COMPATIBILITY.releases.length > 0);
  assert.equal(PROGRAM_COMPATIBILITY.arbitraryGameVersions, false);
  assert.equal(PROGRAM_COMPATIBILITY.arbitraryShellImports, false);
  assert.equal(PROGRAM_COMPATIBILITY.browserNativeSourceRebuild, false);
  assert.match(catalog.dmWebSupportedVersions[0], /only.*Other versions are not supported/);
});
test("advanced customization is collapsed, blank by default, and never persists private data", () => {
  const details = customization.match(/<details\b[^>]*>/g);
  assert.equal(details.length, 1);
  assert.doesNotMatch(details[0], /\bopen\b/);
  assert.match(app, /useState<AppCustomizationDraft>\(\{\}\)/);
  assert.match(
    app,
    /Object.keys\(preparedCustomization\).length\s*\? \{ appCustomization: preparedCustomization \}\s*: \{\}/,
  );
  assert.match(customization, /type="file"\s*accept="image\/png,.png"/);
  assert.match(customization, /autoComplete="off"/);
  assert.doesNotMatch(customization, /fetch\(|URL.createObjectURL|localStorage|sessionStorage/);
  assert.match(catalog.dmWebCustomBundleHelp[0], /signing profile must match the new bundle ID/);
  assert.match(catalog.dmWebCustomIconHelp[0], /appearance is unverified/);
});
test("icon preflight precedes runtime consumption and invalid input remains correctable", () => {
  const generation = app.slice(
    app.indexOf("  async function generate()"),
    app.indexOf("  return (\n    <main"),
  );
  const preflight = generation.slice(0, generation.indexOf('    setResourceOutcome("")'));
  assert.match(
    preflight,
    /await prepareAppCustomization\(customizationValidation.options, \{\s*signal: controller.signal/,
  );
  assert.match(preflight, /controller.signal.throwIfAborted\(\)/);
  assert.match(preflight, /if \(!current\(\)\) \{\s*operation.finish\(\);\s*return;/);
  assert.match(
    preflight,
    /if \(controller.signal.aborted\)[\s\S]*?setFinished\(true\)[\s\S]*?await jobPackager.close\(\)/,
  );
  assert.match(
    preflight,
    /else \{\s*setCustomizationError\(appCustomizationFailureMessage\(error\)\);\s*setStatus\(t\("dmWebCustomCorrect"\)\)/,
  );
  assert.match(preflight, /if \(signing\) clearSigningInputs\(\)/);
  assert.match(preflight, /operation.finish\(\);\s*return;\s*\}/);
  assert.doesNotMatch(preflight, /jobPackager.generate\(|downloadPreparation.current.retain/);
});
test("customization failure recovery labels original identity without automatic download or signing", () => {
  const recovery = app.slice(
    app.indexOf("      if (recovered) {"),
    app.indexOf("      appendActivity(packagingFailureSummary"),
  );
  assert.match(
    recovery,
    /const originalIdentity = Object.keys\(preparedCustomization\).length > 0/,
  );
  assert.match(recovery, /setOriginalIdentityDownload\(originalIdentity\)/);
  assert.match(recovery, /dmWebCustomOriginalRetained/);
  assert.match(recovery, /prepareDownload\(!originalIdentity\)/);
  assert.doesNotMatch(
    recovery,
    /runSigning|setSigningRetryAvailable\(true\)|unsignedForSigning.current =/,
  );
  assert.match(app, /originalIdentityDownload\s*\? "dmWebCustomOriginalDownload"/);
  assert.match(
    catalog.dmWebCustomOriginalRetained[0],
    /not applied.*original app name, bundle ID, version, and icon.*not automatically signed/,
  );
});
test("version errors are allowlisted without raw hashes, file paths or messages", () => {
  for (const detailCode of [
    "PROGRAM_UNSUPPORTED_VERSION",
    "PROGRAM_MODULE_RELEASE_MISMATCH",
    "PROGRAM_SHELL_RELEASE_MISMATCH",
    "PROGRAM_INVALID_MODULE_SET",
    "PROGRAM_INPUT_DIGEST_MISMATCH",
    "PROGRAM_BUILD_ID_MISMATCH",
  ]) {
    const message = packagingFailureSummary({
      stage: "program",
      detailCode,
      message: "PRIVATE-HASH-PATH",
    });
    assert.match(message, new RegExp(`\\[${detailCode}\\]`));
    assert.doesNotMatch(message, /PRIVATE|undefined/);
    const secretMessage = packagingFailureSummary({ stage: "secrets", detailCode });
    if (["PROGRAM_UNSUPPORTED_VERSION", "PROGRAM_MODULE_RELEASE_MISMATCH"].includes(detailCode))
      assert.match(secretMessage, new RegExp(`\\[${detailCode}\\]`));
    else assert.doesNotMatch(secretMessage, new RegExp(detailCode));
    for (const stage of ["assets", "shaders", "discovery", "customization"])
      assert.doesNotMatch(packagingFailureSummary({ stage, detailCode }), new RegExp(detailCode));
  }
  assert.doesNotMatch(
    packagingFailureSummary({ stage: "assets", detailCode: "PROGRAM_SHELL_RELEASE_MISMATCH" }),
    /PROGRAM_SHELL_RELEASE_MISMATCH/,
  );
  assert.doesNotMatch(
    packagingFailureSummary({ stage: "program", detailCode: "PRIVATE-HASH-PATH" }),
    /PRIVATE/,
  );
});
test("discovery and customization diagnostics accept fixed codes only", () => {
  for (const code of [
    "MISSING_INPUT",
    "EXTRACTED_MISSING_INPUT",
    "EXTRACTED_DLC_UNSUPPORTED",
    "EXTRACTED_NAME",
    "EXTRACTED_LIMIT",
  ])
    assert.doesNotMatch(gameFolderFailureMessage(code), /undefined/);
  assert.equal(gameFolderFailureMessage("PRIVATE-PATH"), gameFolderFailureMessage(undefined));
  assert.match(
    appCustomizationFailureMessage(new Error("APP_CUSTOMIZATION_ICON_INVALID")),
    /opaque square PNG/,
  );
  assert.match(
    appCustomizationFailureMessage(new Error("APP_CUSTOMIZATION_BUNDLE_INVALID")),
    /bundle ID/,
  );
  assert.doesNotMatch(appCustomizationFailureMessage(new Error("PRIVATE-NAME")), /PRIVATE/);
  assert.doesNotMatch(
    packagingFailureSummary({ stage: "assets", detailCode: "APP_CUSTOMIZATION_ICON_INVALID" }),
    /APP_CUSTOMIZATION_ICON_INVALID/,
  );
});
test("feature copy is complete in both browser languages without implementation marketing", () => {
  for (const prefix of [
    "dmWebCustom",
    "dmWebExtracted",
    "dmWebProgram",
    "dmWebInput",
    "dmWebSupportedVersions",
  ]) {
    const entries = Object.entries(catalog).filter(([key]) => key.startsWith(prefix));
    assert.ok(entries.length > 0);
    for (const [key, translations] of entries) {
      assert.equal(translations.length, 2, key);
      assert.ok(
        translations.every((value) => typeof value === "string" && value.length > 0),
        key,
      );
      assert.doesNotMatch(translations[0], /React|shadcn|Tailwind|WebAssembly|powered by/);
    }
  }
});

// 只执行实际处理器的预检片段；打包器关闭为内存桩，不执行转换。
// Execute only the actual handler's preflight slice; packager closure is an in-memory stub, never conversion.
async function runPreflight(options, makeIcon) {
  const { prepareAppCustomization } = await import("../app-customization.mjs");
  const { createUiOperationGate } = await import("../ui-operation-gate.mjs");
  const generation = app.slice(app.indexOf("  async function generate()"));
  const source = generation.slice(
    generation.indexOf("{") + 1,
    generation.indexOf('    setResourceOutcome("")'),
  );
  const writes = [],
    cancellation = { current: null },
    mounted = { current: true };
  let closes = 0;
  const state = { ready: true, finished: false, busy: false, generating: false };
  const context = {
    ...state,
    folder: {},
    inputMode: "extracted",
    selectedNsps: new Set(),
    signing: false,
    customizationError: "",
    customizationValidation: {
      options: makeIcon ? { icon: makeIcon(cancellation, mounted) } : options,
      error: "",
    },
    operationGate: { current: createUiOperationGate() },
    mounted,
    cancellation,
    packager: {
      current: {
        async close() {
          closes++;
        },
      },
    },
    prepareAppCustomization,
    appCustomizationFailureMessage,
    t: (key) => key,
    appendActivity: (value) => writes.push(["activity", value]),
    ...Object.fromEntries(
      ["Ready", "Finished", "Busy", "Generating", "Cancelling", "Status", "CustomizationError"].map(
        (key) => [
          `set${key}`,
          (value) => {
            state[key[0].toLowerCase() + key.slice(1)] = value;
            writes.push([key, value]);
          },
        ],
      ),
    ),
  };
  const prepared = await vm.runInNewContext(
    `(async () => { ${source}\n return preparedCustomization; })()`,
    context,
  );
  return { prepared, state, writes, closes, gate: context.operationGate.current };
}

test("actual icon preflight failure allows correction without closing the prepared packager", async () => {
  const result = await runPreflight({ icon: new Blob(["invalid PNG"]) });
  assert.equal(result.prepared, undefined);
  assert.equal(result.closes, 0);
  assert.equal(result.state.ready, true);
  assert.equal(result.state.finished, false);
  assert.equal(result.state.busy, false);
  assert.equal(result.state.generating, false);
  assert.equal(result.gate.busy, false);
  assert.match(result.state.customizationError, /opaque square PNG/);
});

test("actual icon preflight cancellation closes runtime once and releases the UI lease", async () => {
  const result = await runPreflight(
    undefined,
    (cancellation) =>
      new (class extends Blob {
        async arrayBuffer() {
          cancellation.current.abort();
          return super.arrayBuffer();
        }
      })(["cancelled PNG"]),
  );
  assert.equal(result.prepared, undefined);
  assert.equal(result.closes, 1);
  assert.equal(result.state.ready, false);
  assert.equal(result.state.finished, true);
  assert.equal(result.state.busy, false);
  assert.equal(result.state.generating, false);
  assert.equal(result.gate.busy, false);
  assert.equal(result.state.status, "dmWebCancelledReload");
});

// 恢复分支直接来自真实界面，覆盖自定义之前发生的提交后清理失败。
// Use the real UI recovery branch, including post-commit cleanup failures before customization.
test("every requested-customization recovery stays manual and labels the original IPA", () => {
  const recovery = app.slice(
    app.indexOf("      if (recovered) {"),
    app.indexOf("      appendActivity(packagingFailureSummary"),
  );
  for (const stage of ["cleanup", "customization"]) {
    for (const requested of [false, true]) {
      const calls = [],
        retained = { blob: new Blob(["original"]), fileName: "original.ipa" };
      const context = {
        recovered: retained,
        report: { stage },
        preparedCustomization: requested ? { displayName: "Custom" } : {},
        downloadPreparation: { current: { retain: (value) => assert.equal(value, retained) } },
        setOriginalIdentityDownload: (value) => calls.push(["original", value]),
        t: (key) => key,
        committedCleanupWarning: () => "cleanup warning",
        appendActivity: (value) => calls.push(["warning", value]),
        setStatus: () => {},
        prepareDownload: (automatic) => calls.push(["automatic", automatic]),
      };
      vm.runInNewContext(`(() => { ${recovery} })()`, context);
      assert.deepEqual(
        calls.find(([kind]) => kind === "original"),
        ["original", requested],
      );
      assert.deepEqual(
        calls.find(([kind]) => kind === "automatic"),
        ["automatic", !requested],
      );
      const warning = calls.find(([kind]) => kind === "warning")[1];
      if (requested) assert.match(warning, /dmWebCustomOriginalRetained/);
      if (stage === "cleanup" || !requested) assert.match(warning, /cleanup warning/);
    }
  }
});

// 下载链接准备失败后的重试也不能自动下载未应用自定义的原始 IPA。
// Retrying failed link preparation must not auto-download the original uncustomized IPA either.
test("download preparation retries preserve manual original-identity recovery", () => {
  const prepare = app.slice(
    app.indexOf("  function prepareDownload("),
    app.indexOf("  function clearSigningInputs()"),
  );
  for (const originalIdentityDownload of [false, true]) {
    const calls = [];
    vm.runInNewContext(`${prepare}\nprepareDownload();`, {
      originalIdentityDownload,
      downloadPreparation: {
        current: {
          prepare: () => ({ status: "ready", url: "blob:local", fileName: "original.ipa" }),
        },
      },
      setDownload: (value) => calls.push(["prepared", value.fileName]),
      setDownloadPreparationFailed: () => {},
      attemptAutomaticDownload: () => calls.push(["automatic"]),
    });
    assert.equal(calls.filter(([kind]) => kind === "prepared").length, 1);
    assert.equal(
      calls.filter(([kind]) => kind === "automatic").length,
      originalIdentityDownload ? 0 : 1,
    );
  }
});
