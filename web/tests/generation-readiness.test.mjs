// 就绪条件与真实界面表达式的隔离回归；不读取游戏、凭据，也不运行打包器。
// Isolated readiness and real UI-expression regressions; no game or credential reads and no packager execution.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { getGenerationReadiness } from "../generation-readiness.mjs";
import {
  normalizeAppCustomizationDraft,
  resolveAppCustomizationDefaults,
} from "../app-customization-defaults.mjs";
import { BUNDLED_SHELL_PROFILE_IDS } from "../shell-profiles.mjs";
import { appCustomizationFailureMessage } from "../packaging-diagnostics.mjs";
import { catalog } from "../i18n-catalog.mjs";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile("App.tsx", app, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const nodes = [];
function visit(node) {
  nodes.push(node);
  ts.forEachChild(node, visit);
}
visit(parsed);
const declaration = (name) =>
  nodes.find((node) => ts.isVariableDeclaration(node) && node.name.getText(parsed) === name);
const attribute = (node, name) =>
  node.attributes.properties.find(
    (property) => ts.isJsxAttribute(property) && property.name.getText(parsed) === name,
  );
const generateButton = nodes.find(
  (node) =>
    ts.isJsxOpeningElement(node) &&
    attribute(node, "onClick")?.initializer?.getText(parsed).includes("void generate()"),
);
const readyState = (overrides = {}) => ({
  ready: true,
  busy: false,
  finished: false,
  download: null,
  folder: { name: "inert folder" },
  inputMode: "packages",
  nspNames: ["base.nsp", "update.nsp", "addon.nsp"],
  customizationValidation: { options: {}, error: "" },
  customizationError: "",
  signing: false,
  signingReady: true,
  signingFiles: { identity: false, profile: false },
  ...overrides,
});
function rendered(overrides = {}) {
  const context = {
    ...readyState(overrides),
    getGenerationReadiness,
    t: (key) => key,
  };
  context.generationReadiness = vm.runInNewContext(
    declaration("generationReadiness").initializer.getText(parsed),
    context,
  );
  const message = vm.runInNewContext(
    declaration("generationReadinessMessage").initializer.getText(parsed),
    context,
  );
  const disabled = vm.runInNewContext(
    attribute(generateButton, "disabled").initializer.expression.getText(parsed),
    context,
  );
  return { ...context.generationReadiness, disabled, message };
}

test("three discovered packages with untouched 1.0 defaults allow unsigned generation for either target", () => {
  for (const profileId of BUNDLED_SHELL_PROFILE_IDS) {
    const defaults = resolveAppCustomizationDefaults(profileId);
    assert.equal(defaults.version, "1.0");
    for (const draft of [{}, { ...defaults }]) {
      const options = normalizeAppCustomizationDraft(draft, defaults);
      assert.deepEqual(options, {});
      for (const legacyAstc of [false, true]) {
        const result = rendered({
          profileId,
          legacyAstc,
          customizationValidation: { options, error: "" },
          signingReady: false,
        });
        assert.equal(result.disabled, false);
        assert.equal(result.canGenerate, true);
        assert.equal(result.message, "dmWebGenerateReady");
      }
    }
  }
  assert.match(app, /get\("signing"\) === "1"/);
  assert.match(app, /editableOptions: true/);
  assert.equal(rendered({ inputMode: "extracted", nspNames: [] }).disabled, false);
});

test("folder readiness cannot hide enabled signing's exact missing-file requirement", () => {
  for (const [identity, profile, messageKey] of [
    [false, false, "dmWebGenerateSigningFilesNeeded"],
    [false, true, "dmWebGenerateSigningIdentityNeeded"],
    [true, false, "dmWebGenerateSigningProfileNeeded"],
    [true, true, "dmWebGenerateReady"],
  ]) {
    const result = rendered({ signing: true, signingFiles: { identity, profile } });
    assert.equal(result.disabled, !identity || !profile);
    assert.equal(result.message, messageKey);
  }
  const unavailable = rendered({ signing: true, signingReady: false });
  assert.equal(unavailable.disabled, true);
  assert.equal(unavailable.message, "dmWebGenerateSigningUnavailable");
  const signingOff = rendered({ signing: false, signingReady: false });
  assert.equal(signingOff.disabled, false);
});

test("customization blocks honestly and restoring shell defaults clears the blocker", () => {
  const defaults = resolveAppCustomizationDefaults(BUNDLED_SHELL_PROFILE_IDS[0]);
  let error;
  try {
    normalizeAppCustomizationDraft({ version: "1.2" }, defaults);
    assert.fail("an invalid custom version must be rejected");
  } catch (failure) {
    error = appCustomizationFailureMessage(failure);
  }
  for (const state of [{ customizationValidation: { error } }, { customizationError: error }]) {
    const result = rendered(state);
    assert.equal(result.disabled, true);
    assert.equal(result.message, `dmWebCustomCorrect ${error}`);
    assert.doesNotMatch(result.message, /dmWebGenerateReady/);
  }
  assert.deepEqual(normalizeAppCustomizationDraft({ version: "1.0" }, defaults), {});
  assert.equal(rendered().disabled, false);
});

test("missing input and active, unready, or terminal states stay blocked", () => {
  for (const state of [{ folder: null }, { inputMode: null }, { nspNames: [] }]) {
    const result = rendered(state);
    assert.equal(result.disabled, true);
    assert.equal(result.message, "dmWebGenerateChooseFolder");
  }
  for (const state of [
    { busy: true },
    { ready: false },
    { finished: true },
    { download: { url: "blob:inert" } },
  ]) {
    const result = rendered(state);
    assert.equal(result.disabled, true);
    assert.equal(result.message, "", "the live operation status takes precedence");
  }
  assert.match(app, /if \(!generationReadiness.canGenerate \|\| !packager.current/);
  assert.match(app, /aria-describedby=\{[\s\S]*?"generation-readiness" : "packager-status"/);
  assert.match(
    app,
    /id="generation-readiness"[\s\S]*?role="status"[\s\S]*?\{generationReadinessMessage\}/,
  );
});

test("real file callbacks update each selection, removal and operation guard independently", () => {
  for (const id of ["signing-identity", "signing-profile"]) {
    const input = nodes.find(
      (node) => ts.isJsxSelfClosingElement(node) && attribute(node, "id")?.initializer?.text === id,
    );
    const handler = attribute(input, "onChange").initializer.expression.getText(parsed);
    for (const identity of [false, true]) {
      for (const profile of [false, true]) {
        const writes = [];
        const context = {
          identityInput: { current: { files: identity ? [{}] : [] } },
          profileInput: { current: { files: profile ? [{}] : [] } },
          operationGate: { current: { busy: false } },
          setSigningFiles: (value) => writes.push({ ...value }),
        };
        vm.runInNewContext(handler, context)();
        assert.deepEqual(writes, [{ identity, profile }]);
        context.operationGate.current.busy = true;
        vm.runInNewContext(handler, context)();
        assert.equal(writes.length, 1);
      }
    }
  }
});

test("turning signing off clears both file-selection flags and transient credentials", () => {
  const clear = nodes.find(
    (node) => ts.isFunctionDeclaration(node) && node.name?.getText(parsed) === "clearSigningInputs",
  );
  const writes = [];
  const context = {
    mounted: { current: true },
    identityInput: { current: { value: "inert selection" } },
    profileInput: { current: { value: "inert selection" } },
    passwordInput: { current: { value: "inert input" } },
    setSigningFiles: (value) => writes.push({ ...value }),
  };
  vm.runInNewContext(`${clear.getText(parsed)}\nclearSigningInputs();`, context);
  assert.deepEqual(writes, [{ identity: false, profile: false }]);
  for (const ref of [context.identityInput, context.profileInput, context.passwordInput])
    assert.equal(ref.current.value, "");
  assert.equal(rendered({ signing: false, signingFiles: writes[0] }).disabled, false);
});

test("folder summaries never claim global readiness and every blocker is localized", () => {
  for (const key of ["dmWebPackagesReady", "dmWebExtractedReady"])
    for (const text of catalog[key]) assert.doesNotMatch(text, /ready|就绪|可以生成/i);
  for (const key of [
    "dmWebGenerateChooseFolder",
    "dmWebGenerateReady",
    "dmWebGenerateSigningFilesNeeded",
    "dmWebGenerateSigningIdentityNeeded",
    "dmWebGenerateSigningProfileNeeded",
    "dmWebGenerateSigningUnavailable",
  ]) {
    assert.equal(catalog[key]?.length, 2, key);
    assert.ok(
      catalog[key].every((text) => typeof text === "string" && text.length > 0),
      key,
    );
  }
});
