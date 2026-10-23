// 固定公开元数据和惰性表单状态；不执行外壳、编译器或游戏。
// Pinned public metadata and inert form state; no shell, compiler or game execution.
import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveAppCustomizationDefaults,
  updateAppCustomizationDraft,
  normalizeAppCustomizationDraft,
} from "../app-customization-defaults.mjs";
import { BUNDLED_SHELL_PROFILE_IDS, resolveShellProfile } from "../shell-profiles.mjs";
import {
  normalizeAppCustomization,
  prepareAppCustomization,
  customizeUnsignedIpa,
} from "../app-customization.mjs";

test("visible defaults come from each selected bundled shell's inspected plist, not its release tag", () => {
  for (const id of BUNDLED_SHELL_PROFILE_IDS) {
    const defaults = resolveAppCustomizationDefaults(id);
    const { evidence } = resolveShellProfile(id);
    assert.deepEqual(defaults, {
      displayName: evidence.inspection.plist.CFBundleDisplayName,
      bundleIdentifier: evidence.inspection.plist.CFBundleIdentifier,
      version: evidence.inspection.plist.CFBundleShortVersionString,
      buildVersion: evidence.inspection.plist.CFBundleVersion,
    });
    assert.deepEqual(defaults, {
      displayName: "D2R Mobile",
      bundleIdentifier: "org.d2rmobile.app",
      version: "1.0",
      buildVersion: "1",
    });
    assert.notEqual(defaults.displayName, evidence.inspection.plist.CFBundleName);
    assert.notEqual(defaults.version, evidence.release.replace(/^v/, ""));
    assert.ok(Object.isFrozen(defaults));
    assert.equal(Object.hasOwn(defaults, "icon"), false);
  }
  assert.throws(() => resolveAppCustomizationDefaults("unregistered"), /SHELL_PROFILE_UNKNOWN/);
  assert.throws(
    () => resolveAppCustomizationDefaults("v1.0.18-ios26"),
    /SHELL_IDENTITY_EVIDENCE_MISSING/,
  );
});

test("untouched or restored defaults retain the exact original IPA with no customization transaction", async () => {
  for (const id of BUNDLED_SHELL_PROFILE_IDS) {
    const defaults = resolveAppCustomizationDefaults(id);
    for (const draft of [{}, { ...defaults }, { version: "1.0" }]) {
      const options = normalizeAppCustomizationDraft(draft, defaults);
      assert.deepEqual(options, {});
      const prepared = await prepareAppCustomization(options);
      const original = new Blob(["inert bytes; no archive parsing is needed for an unchanged IPA"]);
      const result = await customizeUnsignedIpa(original, prepared);
      assert.equal(result.blob, original);
      assert.equal(result.changed, false);
    }
  }
  assert.throws(
    () => normalizeAppCustomization({ version: "1.0" }),
    /APP_CUSTOMIZATION_VERSION_INVALID/,
    "the custom-version validator remains unchanged",
  );
});

test("editing a field sends only that override and never rewrites other shell metadata", () => {
  const defaults = resolveAppCustomizationDefaults(BUNDLED_SHELL_PROFILE_IDS[0]);
  const draft = updateAppCustomizationDraft({}, defaults, "displayName", "My game");
  assert.deepEqual(draft, { displayName: "My game" });
  assert.deepEqual(normalizeAppCustomizationDraft(draft, defaults), draft);
  const restored = updateAppCustomizationDraft(
    draft,
    defaults,
    "displayName",
    defaults.displayName,
  );
  assert.deepEqual(restored, {});
  assert.deepEqual(draft, { displayName: "My game" }, "updates do not mutate the previous draft");
  assert.throws(
    () => normalizeAppCustomizationDraft({ version: "1.2" }, defaults),
    /APP_CUSTOMIZATION_VERSION_INVALID/,
  );
  assert.deepEqual(normalizeAppCustomizationDraft({ version: "1.2.3" }, defaults), {
    version: "1.2.3",
  });
  for (const draft of [null, [], { path: "not-an-identity-field" }])
    assert.throws(
      () => normalizeAppCustomizationDraft(draft, defaults),
      /APP_CUSTOMIZATION_INVALID/,
    );
});

test("profile changes refresh only untouched fields and preserve deliberate edits and custom icon", () => {
  const first = resolveAppCustomizationDefaults(BUNDLED_SHELL_PROFILE_IDS[0]);
  // Distinct authored defaults prove this contract even though today's two shells share identity.
  const next = { ...first, displayName: "Another shell", version: "3.0" };
  const icon = new Blob(["inert icon selection"], { type: "image/png" });
  let draft = updateAppCustomizationDraft({ icon }, first, "buildVersion", "9");
  const displayed = (defaults) => ({ ...defaults, ...draft });
  assert.equal(displayed(first).displayName, first.displayName);
  assert.equal(displayed(next).displayName, next.displayName);
  assert.equal(displayed(next).version, next.version);
  assert.equal(displayed(next).buildVersion, "9");
  assert.equal(displayed(next).icon, icon);
  draft = updateAppCustomizationDraft(draft, first, "displayName", next.displayName);
  assert.equal(displayed(next).displayName, next.displayName);
  assert.equal(
    displayed(first).displayName,
    next.displayName,
    "a deliberate edit survives a round trip",
  );
  assert.deepEqual(normalizeAppCustomizationDraft(draft, next), { buildVersion: "9", icon });
  assert.equal(
    draft.displayName,
    next.displayName,
    "normalizing does not discard an explicit edit",
  );
  draft = {};
  assert.deepEqual(
    displayed(next),
    next,
    "reset resolves the current shell, not the initial shell",
  );
  assert.deepEqual(normalizeAppCustomizationDraft(draft, next), {});
});

test("a blank field remains editable and restores its selected-shell value on blur", () => {
  const defaults = resolveAppCustomizationDefaults(BUNDLED_SHELL_PROFILE_IDS[0]);
  const blank = updateAppCustomizationDraft({}, defaults, "version", "");
  assert.deepEqual(blank, { version: "" });
  assert.deepEqual(normalizeAppCustomizationDraft(blank, defaults), {});
  assert.deepEqual(updateAppCustomizationDraft(blank, defaults, "version", defaults.version), {});
});
