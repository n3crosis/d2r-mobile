// 源码约束测试不代替浏览器交互或设备验证。
// Source-contract tests do not replace browser interaction or device validation.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { catalog } from "../i18n-catalog.mjs";

const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
test("older-GPU selection is explicit, reload-based and passed before private selection", () => {
  assert.match(app, /get\("legacyAstc"\) === "1"/);
  assert.match(app, /prepareBrowserPackager\(\{[\s\S]*?profileId,\s+legacyAstc,/);
  const option = app.slice(
    app.indexOf('aria-describedby="legacy-option-help"'),
    app.indexOf('{t("dmWebLegacyOption")}'),
  );
  assert.match(
    option,
    /disabled=\{hasSelectedFolder \|\| busy \|\| generating \|\| download !== null\}/,
  );
  assert.match(option, /searchParams\.set\("legacyAstc", "1"\)/);
  assert.match(option, /searchParams\.delete\("legacyAstc"\)/);
  assert.match(option, /window\.location\.assign\(url\.href\)/);
});
test("pack progress and complete-on-later-failure outcome remain separate from IPA", () => {
  assert.match(app, /event\.stage === "legacy-pack"/);
  assert.match(app, /result\.legacyPack\?\.status === "complete"/);
  assert.match(app, /report\?\.legacyPack\?\.status === "complete"/);
  assert.match(app, /legacyAstc && legacyStatus/);
  assert.match(app, /setDownload\(\{ url, fileName: result\.download\.fileName \}\)/);
  for (const key of [
    "dmWebLegacyOption",
    "dmWebLegacyHelp",
    "dmWebLegacyPreparing",
    "dmWebLegacySaving",
    "dmWebLegacyComplete",
    "dmWebLegacyIncomplete",
  ]) {
    assert.equal(catalog[key].length, 2);
    assert.ok(catalog[key].every((value) => value.length > 0));
  }
  assert.ok(catalog.dmWebLegacyHelp.every((value) => value.includes("Legacy Device Pack")));
  assert.match(catalog.dmWebLegacyHelp[0], /not verified/);
  assert.match(catalog.dmWebLegacyComplete[0], /does not mean the IPA is complete/);
});

test("conversion shows bounded work counters, not a completion percentage", () => {
  const section = app.slice(
    app.indexOf('event.diagnostic?.kind === "legacy-astc"'),
    app.indexOf('event.stage === "legacy-pack"'),
  );
  assert.match(section, /Number\.isSafeInteger\(blocks\)/);
  assert.match(section, /Number\.isSafeInteger\(bytes\)/);
  assert.match(section, /dmWebLegacyConverting/);
  assert.doesNotMatch(section, /percent|totalBytes/);
  assert.match(catalog.dmWebLegacyConverting[0], /multiple passes/);
});
