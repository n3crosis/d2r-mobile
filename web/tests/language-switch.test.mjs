// Inert preference-store and source-wiring tests only; no browser, runtime, or private files.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import {
  createLanguagePreference,
  browserLanguage,
  setBrowserLanguage,
  subscribeLanguage,
  t,
} from "../i18n.mjs";
import { catalog } from "../i18n-catalog.mjs";

function environment(language = "en", saved) {
  const values = new Map(saved ? [["d2r-ui-language", saved]] : []);
  const writes = [];
  return {
    navigator: { language },
    localStorage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => {
        writes.push([key, value]);
        values.set(key, value);
      },
    },
    values,
    writes,
  };
}

test("browser language remains automatic until a supported explicit preference exists", () => {
  for (const [language, expected] of [
    ["zh-CN", "zh-CN"],
    ["zh-TW", "zh-CN"],
    ["ZH-HK", "zh-CN"],
    ["en-GB", "en"],
    ["ja", "en"],
    [undefined, "en"],
  ]) {
    const env = environment(language);
    assert.equal(createLanguagePreference(env).getLanguage(), expected);
    assert.deepEqual(env.writes, []);
  }
  assert.equal(createLanguagePreference(environment("zh-CN", "en")).getLanguage(), "en");
  assert.equal(createLanguagePreference(environment("en", "zh-CN")).getLanguage(), "zh-CN");
  assert.equal(createLanguagePreference(environment("zh-CN", "invalid")).getLanguage(), "zh-CN");
});

test("explicit choices notify mounted subscribers, persist only the preference, and survive a new store", () => {
  const env = environment("en");
  const preference = createLanguagePreference(env);
  const seen = [];
  const unsubscribe = preference.subscribe(() => seen.push(preference.getLanguage()));
  assert.equal(preference.setLanguage("zh-CN"), true);
  assert.equal(preference.setLanguage("zh-CN"), true);
  assert.deepEqual(seen, ["zh-CN"]);
  assert.deepEqual(env.writes, [
    ["d2r-ui-language", "zh-CN"],
    ["d2r-ui-language", "zh-CN"],
  ]);
  assert.equal(createLanguagePreference(env).getLanguage(), "zh-CN");
  unsubscribe();
  preference.setLanguage("en");
  assert.deepEqual(seen, ["zh-CN"]);
  assert.equal(preference.setLanguage("arbitrary"), false);
  assert.equal(preference.getLanguage(), "en");
  assert.equal(env.writes.length, 3);
});

test("choosing the current browser default still persists an explicit preference", () => {
  const env = environment("en");
  const preference = createLanguagePreference(env);
  assert.equal(preference.getLanguage(), "en");
  env.navigator.language = "zh-CN";
  assert.equal(preference.getLanguage(), "zh-CN");
  preference.setLanguage("zh-CN");
  assert.deepEqual(env.writes, [["d2r-ui-language", "zh-CN"]]);
  env.navigator.language = "en";
  assert.equal(preference.getLanguage(), "zh-CN");
  assert.equal(createLanguagePreference(env).getLanguage(), "zh-CN");
});

test("denied storage getters, reads, and writes retain a usable in-memory language switch", () => {
  for (const denied of [
    {
      get localStorage() {
        throw new Error("denied getter");
      },
    },
    {
      localStorage: {
        getItem() {
          throw new Error("denied read");
        },
        setItem() {
          throw new Error("denied write");
        },
      },
    },
    {},
  ]) {
    const preference = createLanguagePreference(
      Object.create(denied, { navigator: { value: { language: "zh-CN" } } }),
    );
    let changes = 0;
    preference.subscribe(() => changes++);
    assert.equal(preference.getLanguage(), "zh-CN");
    assert.equal(preference.setLanguage("en"), true);
    assert.equal(preference.getLanguage(), "en");
    assert.equal(changes, 1);
  }
});

test("the shared translation bridge switches future text while earlier messages retain their original text", () => {
  const original = browserLanguage();
  const seen = [];
  const unsubscribe = subscribeLanguage(() => seen.push(t("dmWebChoose")));
  try {
    setBrowserLanguage("en");
    const earlierMessage = t("dmWebChoose");
    setBrowserLanguage("zh-CN");
    assert.equal(t("dmWebChoose"), catalog.dmWebChoose[1]);
    assert.equal(earlierMessage, catalog.dmWebChoose[0]);
    assert.equal(seen.at(-1), catalog.dmWebChoose[1]);
    assert.equal(t("dmWebLanguageHistoryHelp"), catalog.dmWebLanguageHistoryHelp[1]);
  } finally {
    unsubscribe();
    setBrowserLanguage(original);
  }
});

test("top selector rerenders the mounted App and html language without remounting or restarting bootstrap", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile(
    "App.tsx",
    app,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const nodes = [];
  function visit(node) {
    nodes.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  const selector = nodes.find(
    (node) =>
      ts.isJsxOpeningElement(node) &&
      node.tagName.getText(parsed) === "NativeSelect" &&
      node.attributes.properties.some(
        (entry) => entry.name.getText(parsed) === "id" && entry.initializer?.text === "ui-language",
      ),
  );
  assert.ok(selector);
  assert.equal(
    selector.attributes.properties.some((entry) => entry.name.getText(parsed) === "disabled"),
    false,
  );
  const change = selector.attributes.properties.find(
    (entry) => entry.name.getText(parsed) === "onChange",
  ).initializer.expression;
  assert.equal(change.getText(parsed), "(event) => setBrowserLanguage(event.target.value)");
  assert.match(app, /useSyncExternalStore\(subscribeLanguage, browserLanguage, browserLanguage\)/);
  assert.ok(selector.pos < app.indexOf("<InstallationGuide"));
  assert.match(app, /Language \/ 语言/);
  assert.match(app, />\s*English\s*<\/NativeSelectOption>/);
  assert.match(app, />\s*简体中文\s*<\/NativeSelectOption>/);
  const effects = nodes.filter(
    (node) => ts.isCallExpression(node) && node.expression.getText(parsed) === "useEffect",
  );
  const bootstrap = effects.find((node) => node.getText(parsed).includes("prepareBrowserPackager"));
  assert.equal(bootstrap.arguments[1].getText(parsed), "[appendActivity]");
  const documentEffect = effects.find((node) =>
    node.getText(parsed).includes("document.documentElement.lang"),
  );
  assert.equal(documentEffect.arguments[1].getText(parsed), "[language]");
  assert.match(documentEffect.getText(parsed), /document.documentElement.lang = language/);
  assert.doesNotMatch(app, /key=\{language\}/);
  assert.doesNotMatch(
    change.getText(parsed),
    /reload|location|setFolder|setInputMode|setAppCustomization|clearSigningInputs|prepareBrowserPackager/,
  );
  assert.match(
    catalog.dmWebLanguageHistoryHelp[0],
    /Earlier status messages and activity entries keep their original language/,
  );
  assert.match(catalog.dmWebLanguageHistoryHelp[1], /之前的状态消息和活动记录保留原语言/);
});
