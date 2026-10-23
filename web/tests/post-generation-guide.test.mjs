// Committed-output models and source wiring only; no generation, browser or private data.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createPostGenerationGuide } from "../post-generation-guide.mjs";
import { resolveAppIdentityPreview } from "../app-customization-defaults.mjs";

const defaults = {
  displayName: "D2R Mobile",
  bundleIdentifier: "org.d2rmobile.app",
  version: "1.0",
  buildVersion: "1",
};
const resources = { status: "complete", directoryName: "D2R-resources-authored-unique-id" };
const legacyPack = { status: "complete", directoryName: "Legacy Device Pack-authored-other-id" };

test("instructions preserve the actual produced folder names and custom app name", () => {
  const result = createPostGenerationGuide({ resources, legacyPack }, "My D2R");
  assert.deepEqual(result, {
    appName: "My D2R",
    resourcesDirectory: resources.directoryName,
    resourcesStatus: "complete",
    legacyDirectory: legacyPack.directoryName,
    legacyIncomplete: false,
  });
  assert.equal(Object.isFrozen(result), true);
});

test("legacy instructions require a completed real export, not a selected option", () => {
  const result = createPostGenerationGuide({ resources }, defaults.displayName);
  assert.equal(result.legacyDirectory, null);
  assert.equal(result.legacyIncomplete, false);
  for (const outcome of [
    undefined,
    { status: "pending", directoryName: "partial" },
    { status: "incomplete", directoryName: "partial" },
  ]) {
    const result = createPostGenerationGuide(
      { resources, legacyPack: outcome },
      defaults.displayName,
    );
    assert.equal(result.legacyDirectory, null);
    assert.equal(result.legacyIncomplete, outcome?.status === "incomplete");
  }
});

test("skipped, missing and incomplete resources never produce a copy-success instruction", () => {
  for (const outcome of [
    undefined,
    { status: "incomplete", directoryName: "partial" },
    { status: "complete", directoryName: "" },
    { status: "complete", directoryName: "../partial" },
  ]) {
    const result = createPostGenerationGuide({ resources: outcome }, defaults.displayName);
    assert.equal(result.resourcesDirectory, null);
    assert.equal(result.resourcesStatus, "incomplete");
  }
  const skipped = createPostGenerationGuide(
    { resources: { status: "skipped" }, legacyPack },
    defaults.displayName,
  );
  assert.equal(skipped.resourcesStatus, "skipped");
  assert.equal(skipped.resourcesDirectory, null);
  assert.equal(skipped.legacyDirectory, legacyPack.directoryName);
  assert.equal(createPostGenerationGuide({ resources }, ""), null);
});

test("visible identity uses valid edits and does not advertise invalid draft values", () => {
  assert.deepEqual(resolveAppIdentityPreview({}, defaults), {
    displayName: defaults.displayName,
    bundleIdentifier: defaults.bundleIdentifier,
  });
  assert.deepEqual(
    resolveAppIdentityPreview(
      { displayName: "My D2R", bundleIdentifier: "com.example.game" },
      defaults,
    ),
    { displayName: "My D2R", bundleIdentifier: "com.example.game" },
  );
  assert.deepEqual(
    resolveAppIdentityPreview(
      { displayName: "My D2R", bundleIdentifier: "invalid identifier" },
      defaults,
    ),
    { displayName: "My D2R", bundleIdentifier: defaults.bundleIdentifier },
  );
  assert.deepEqual(
    resolveAppIdentityPreview({ displayName: "", bundleIdentifier: "com.example.game" }, defaults),
    { displayName: defaults.displayName, bundleIdentifier: "com.example.game" },
  );
});

test("UI snapshots successful identity, uses originals for recovery, and reads actual download filename", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const guide = await readFile(
    new URL("../src/components/PostGenerationGuide.tsx", import.meta.url),
    "utf8",
  );
  assert.match(
    app,
    /createPostGenerationGuide\(\s*result,\s*preparedCustomization.displayName \?\? appCustomizationDefaults.displayName/,
  );
  assert.match(app, /createPostGenerationGuide\(report, appCustomizationDefaults.displayName\)/);
  assert.match(app, /download && completedOutput && !busy/);
  assert.match(app, /downloadFileName=\{download.fileName\}/);
  assert.match(app, /signed=\{signedDownload\}/);
  assert.match(guide, /output.resourcesDirectory &&/);
  assert.match(guide, /output.legacyDirectory &&/);
  assert.match(guide, /t\("dmWebResultCopy", output.resourcesDirectory, output.appName\)/);
  assert.match(guide, /t\("dmWebResultCopy", output.legacyDirectory, output.appName\)/);
  assert.doesNotMatch(guide, /legacyAstc|<UUID>|D2RMobile-unsigned\.ipa|org\.d2rmobile\.app/);
});

test("current identity is visible outside Advanced while edits stay inside the mounted section", async () => {
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const identityIndex = app.indexOf("{identityPreview.displayName}");
  const advancedIndex = app.indexOf('<AccordionItem value="advanced">');
  assert.ok(identityIndex !== -1 && identityIndex < advancedIndex);
  assert.ok(app.indexOf("{identityPreview.bundleIdentifier}") < advancedIndex);
  const advanced = app.slice(advancedIndex, app.indexOf('<AccordionItem value="signing">'));
  assert.match(advanced, /<AppCustomizationFields/);
  assert.match(advanced, /<AccordionContent forceMount/);
  assert.doesNotMatch(app, /<AccordionItem value="customize"/);
});
