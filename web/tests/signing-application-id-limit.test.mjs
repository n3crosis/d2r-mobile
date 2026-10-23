// 合成归档与源码契约，不执行原生签名或声称验证设备安装。
// Authored archives and source contracts, not native signing or device-install proof.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { prepareAppCustomization, customizeUnsignedIpa } from "../app-customization.mjs";
import { readCustomizationPlist, writeCustomizationPlist } from "../app-customization-plist.mjs";
import { createSignedSigningArchive, inspectUnsignedSigningArchive } from "../ipa-signing-zip.mjs";

const root = "Payload/Authored.app/";
test("signing length diagnostics do not truncate or reject supported unsigned bundle IDs", async () => {
  const plist = Object.assign(Object.create(null), {
    CFBundleIdentifier: "local.authored.original",
    CFBundlePackageType: "APPL",
    CFBundleExecutable: "Authored",
  });
  const original = await createSignedSigningArchive(
    [
      ["Info.plist", new Blob([writeCustomizationPlist(plist)]), 0o644],
      ["Authored", new Blob(["inert authored executable"]), 0o755],
    ].map(([path, blob, mode]) => ({ path: root + path, size: blob.size, blob, mode })),
  );
  // 保留 64 字符和 10 字符前缀对应的现有边界。
  // Existing prefix-qualified boundaries for 64-character and 10-character prefixes.
  for (const length of [190, 191, 244, 245, 255]) {
    const bundleIdentifier = "com." + "a".repeat(length - 4);
    const customized = await customizeUnsignedIpa(
      original,
      await prepareAppCustomization({ bundleIdentifier }),
    );
    const archive = await inspectUnsignedSigningArchive(customized.blob);
    const info = archive.entries.find(({ path }) => path === root + "Info.plist");
    const actual = readCustomizationPlist(new Uint8Array(await info.blob.arrayBuffer()));
    assert.equal(actual.CFBundleIdentifier, bundleIdentifier);
  }
});

test("native source separates application-ID overflow without widening exact/wildcard matching", async () => {
  const source = await readFile(
    new URL("../toolchain/zsign-wasm/profile-compatibility.inc", import.meta.url),
    "utf8",
  );
  assert.match(source, /value\.size\(\) > \(dotted \? 255U : 64U\)/);
  assert.match(
    source,
    /!D2RIdentifier\(concrete, true\) \|\| pattern\.empty\(\) \|\| pattern\.size\(\) > 255/,
  );
  assert.match(source, /return D2RIdentifier\(pattern, true\) && pattern == concrete/);
  assert.match(
    source,
    /application = prefix \+ "\." \+ bundle;[\s\S]*?if \(application\.size\(\) > 255\) \{\s*if \(applicationIdentifierTooLong\)\s*\*applicationIdentifierTooLong = true;\s*return false;\s*\}\s*if \(!D2RMatchApplication\(pattern, application\)\)/,
  );
  assert.match(
    source,
    /if \(applicationIdentifierTooLong\)\s*\*applicationIdentifierTooLong = false;\s*if \(!D2RIdentifier\(bundle, true\)\)/,
  );
  const bridge = await readFile(
    new URL("../toolchain/zsign-wasm/prepare-source.py", import.meta.url),
    "utf8",
  );
  assert.match(bridge, /bool applicationIdentifierTooLong = false;/);
  assert.match(
    bridge,
    /!zsa\.ValidateProfileForBundle\(infoPlist\["CFBundleIdentifier"\]\.as_string\(\),\s*&applicationIdentifierTooLong\)\)\s*return applicationIdentifierTooLong \? -207 : -206;/,
  );
  const authoredNativeTest = await readFile(
    new URL("../toolchain/zsign-wasm/profile-compatibility-test.cpp", import.meta.url),
    "utf8",
  );
  assert.match(authoredNativeTest, /string\("LEGACY1234"\), string\(64, 'A'\)/);
  assert.match(authoredNativeTest, /supported, supported \+ 1, size_t\(255\)/);
});
