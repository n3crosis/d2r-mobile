// 表单显示已固定外壳的真实身份；只把用户修改传给现有的自定义事务。
// Show the pinned shell's actual identity; pass only edits to the existing customization transaction.
import { resolveShellProfile } from "./shell-profiles.mjs";
import { normalizeAppCustomization } from "./app-customization.mjs";

const identityKeys = Object.freeze({
  displayName: "CFBundleDisplayName",
  bundleIdentifier: "CFBundleIdentifier",
  version: "CFBundleShortVersionString",
  buildVersion: "CFBundleVersion",
});

/**
 * These are inspected plist values, not the release tag or current native build settings.
 * @returns {Readonly<{ displayName: string, bundleIdentifier: string, version: string, buildVersion: string }>}
 */
export function resolveAppCustomizationDefaults(profileId) {
  const { evidence } = resolveShellProfile(profileId);
  const plist = evidence.inspection?.plist;
  for (const key of Object.values(identityKeys))
    if (typeof plist?.[key] !== "string" || !plist[key])
      throw new Error("SHELL_IDENTITY_EVIDENCE_MISSING");
  return Object.freeze({
    displayName: plist.CFBundleDisplayName,
    bundleIdentifier: plist.CFBundleIdentifier,
    version: plist.CFBundleShortVersionString,
    buildVersion: plist.CFBundleVersion,
  });
}

/** Keep explicit edits separate so switching shells updates untouched fields, not user edits. */
export function updateAppCustomizationDraft(draft, defaults, field, value) {
  if (!Object.hasOwn(identityKeys, field) || typeof value !== "string")
    throw new Error("APP_CUSTOMIZATION_INVALID");
  const next = { ...draft };
  if (value === defaults[field]) delete next[field];
  else next[field] = value;
  return next;
}

/**
 * Exact defaults are not overrides. In particular, the pinned shell's version "1.0"
 * must not be rejected by or rewritten to fit the stricter custom-version contract.
 */
export function normalizeAppCustomizationDraft(draft, defaults) {
  if (!draft || typeof draft !== "object" || Array.isArray(draft))
    return normalizeAppCustomization(draft);
  const overrides = { ...draft };
  for (const field of Object.keys(identityKeys))
    if (overrides[field] === defaults[field]) delete overrides[field];
  return normalizeAppCustomization(overrides);
}

/** Show valid proposed identity values only; an invalid field still blocks generation separately. */
export function resolveAppIdentityPreview(draft, defaults) {
  const identity = {
    displayName: defaults.displayName,
    bundleIdentifier: defaults.bundleIdentifier,
  };
  for (const field of Object.keys(identity)) {
    try {
      const normalized = normalizeAppCustomizationDraft({ [field]: draft[field] }, defaults);
      identity[field] = normalized[field] ?? defaults[field];
    } catch {
      // Keep this field's true shell default, never present an invalid draft as a usable identity.
    }
  }
  return Object.freeze(identity);
}
