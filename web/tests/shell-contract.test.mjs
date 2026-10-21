import test from "node:test";
import assert from "node:assert/strict";
import releaseEvidence from "../toolchain/shell-release-evidence/v1.0.18.json" with { type: "json" };
import {
  validateShellContract,
  validateAssemblyInventory,
  SHELL_LIMITS,
} from "../shell-contract.mjs";
const base = "Payload/DmIOS.app/";
const entry = (path, size = 10, mode = 0o100644) => ({ path, size, mode });
const requiredPaths = ["dm/derived.tsv", "Frameworks/Guest.framework/", "msl/b-test/"];
function fixture() {
  const targetOS = { platform: "ios", minimumVersion: "16.0" };
  return {
    shell: {
      entries: ["Info.plist", "DmIOS", "dm/shell_info.txt", "dm/shell_manifest.txt"].map((p) =>
        entry(base + p),
      ),
      shellInfoText:
        "PRODUCT=synthetic\nCHAIN=test\nKIND=ios\nSHADER_SRC=0123456789abcdef\nSPIRV_CROSS=synthetic\n",
      shellManifestText: requiredPaths.join("\n"),
      trustedRecipe: {
        schemaVersion: 1,
        product: "synthetic",
        chain: "test",
        kind: "ios",
        shaderDigest: "0123456789abcdef",
        targetOS,
        requiredPaths,
        extraFiles: ["dm/pack_info.txt"],
      },
      observedTargetOS: targetOS,
    },
    generatedEntries: [
      entry("dm/derived.tsv"),
      {
        ...entry("Frameworks/Guest.framework/Guest", 100, 0o100755),
        signature: { kind: "ad-hoc", offset: 80, size: 20 },
      },
      entry("Frameworks/Guest.framework/Info.plist"),
      entry("msl/b-test/synthetic.metal"),
      entry("dm/pack_info.txt"),
    ],
    observedOutputTargetOS: targetOS,
  };
}
test("metadata preserves executable Guest and signature without installability claims", () => {
  const f = fixture(),
    r = validateAssemblyInventory(f);
  assert.equal(r.status, "assembly-inventory-valid");
  assert.equal(r.installable, false);
  assert.equal(r.contentVerified, false);
  const g = r.entries.find((e) => e.path.endsWith("/Guest"));
  assert.equal(g.mode, 0o100755);
  assert.deepEqual(g.signature, { kind: "ad-hoc", offset: 80, size: 20 });
  g.signature.offset = 0;
  assert.equal(f.generatedEntries[1].signature.offset, 80);
});
test("strict recipe, independent target observations and text", () => {
  for (const mutate of [
    (f) => {
      delete f.shell.trustedRecipe;
    },
    (f) => {
      f.shell.trustedRecipe.schemaVersion = 2;
    },
    (f) => {
      delete f.shell.observedTargetOS;
    },
    (f) => {
      f.shell.observedTargetOS = { platform: "ios", minimumVersion: "17.0" };
    },
    (f) => {
      f.observedOutputTargetOS = { platform: "ios", minimumVersion: "15.0" };
    },
    (f) => {
      f.shell.trustedRecipe.kind = "mac";
    },
    (f) => {
      f.shell.shellInfoText += "VERSION=2\n";
    },
    (f) => {
      f.shell.shellInfoText += "PRODUCT=synthetic\n";
    },
    (f) => {
      f.shell.shellInfoText = f.shell.shellInfoText.replace("test", "other");
    },
    (f) => {
      f.shell.shellInfoText = f.shell.shellInfoText.replace("0123456789abcdef", "ffffffffffffffff");
    },
    (f) => {
      f.shell.shellManifestText += "\nunknown/";
    },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => validateAssemblyInventory(f));
  }
});
test("one app and required shell files", () => {
  for (const extra of ["Payload/Other.app/Info.plist", "__MACOSX/file", "outside"]) {
    const f = fixture();
    f.shell.entries.push(entry(extra));
    assert.throws(() => validateShellContract(f.shell));
  }
  const f = fixture();
  f.shell.entries.shift();
  assert.throws(() => validateShellContract(f.shell), /Missing required file/);
});
test("pinned production shell accepts Apple icon density and device suffixes", () => {
  const targetOS = {
    platform: "ios",
    minimumVersion: releaseEvidence.machOBuildVersions[0].minimumVersion,
  };
  const shell = {
    entries: releaseEvidence.entries,
    shellInfoText: Object.entries(releaseEvidence.shellInfo)
      .map(([key, value]) => `${key}=${value}`)
      .join("\n"),
    shellManifestText: releaseEvidence.requiredPaths.join("\n"),
    trustedRecipe: {
      schemaVersion: 1,
      product: releaseEvidence.shellInfo.PRODUCT,
      chain: releaseEvidence.shellInfo.CHAIN,
      kind: "ios",
      shaderDigest: releaseEvidence.shellInfo.SHADER_SRC,
      targetOS,
      requiredPaths: releaseEvidence.requiredPaths,
      extraFiles: ["dm/pack_info.txt", "dm/content_mode.json"],
    },
    observedTargetOS: targetOS,
  };
  const result = validateShellContract(shell);
  assert.equal(result.status, "shell-inventory-valid");
  for (const icon of ["AppIcon60x60@2x.png", "AppIcon76x76@2x~ipad.png"])
    assert.ok(result.entries.some((entry) => entry.path === base + icon));
  assert.deepEqual(
    result.entries.map((entry) => entry.path),
    shell.entries.map((entry) => entry.path),
  );
});
test("unsafe paths, duplicate entries, case collisions and ancestor conflicts", () => {
  for (const p of [
    "../escape",
    "/absolute",
    "a\\b",
    "a//b",
    "a/./b",
    "a/../b",
    "a\0b",
    "a:b",
    "a./b",
    "a /b",
    "@2x/../escape.png",
    "~ipad/./escape.png",
    "AppIcon@2x~ipad.png/../../escape.png",
    "AppIcon@2x~ipad.png\\escape",
    "AppIcon@2x~ipad.png:stream",
    "AppIcon@2x~ipad.png%2fescape",
    "AppIcon@2x~ipad.png?query",
    "AppIcon@2x~ipad.png#fragment",
    "AppIcon@2x~ipad.png.",
    "AppIcon@2x~ipad.png ",
    "dm/shell_info.txt",
    "DM/extra",
    "Info.plist/child",
  ]) {
    const f = fixture();
    f.shell.entries.push(entry(base + p));
    assert.throws(() => validateShellContract(f.shell), p);
  }
  const f = fixture();
  f.generatedEntries.push(f.generatedEntries[0]);
  assert.throws(() => validateAssemblyInventory(f), /Duplicate/);
});
test("reject symlinks, special files, credentials, signing and bulk archives", () => {
  for (const mode of [0o120777, 0o020600, 0o104755]) {
    const f = fixture();
    f.shell.entries.push(entry(base + "bad", 10, mode));
    assert.throws(() => validateShellContract(f.shell));
  }
  for (const p of [
    "embedded.mobileprovision",
    "_CodeSignature/CodeResources",
    "Extensions/Bad",
    "PlugIns/Bad",
    "RomFS/data/file",
    "dm/00-00000000.data",
    "secret.keys",
    "file.nsp",
    "cert.p12",
  ]) {
    const f = fixture();
    f.shell.entries.push(entry(base + p));
    assert.throws(() => validateShellContract(f.shell), /Forbidden/);
  }
});
test("only bounded generated overlay delta archives are allowed", () => {
  const allowOverlay = (value) => {
    value.shell.trustedRecipe.requiredPaths = [
      ...value.shell.trustedRecipe.requiredPaths,
      "romfs_overlay/",
    ];
    value.shell.shellManifestText += "\nromfs_overlay/";
  };
  const f = fixture();
  allowOverlay(f);
  f.generatedEntries.push(entry("romfs_overlay/data/00-00000002.data", 1024));
  assert.equal(validateAssemblyInventory(f).status, "assembly-inventory-valid");

  const shellArchive = fixture();
  shellArchive.shell.entries.push(entry(base + "romfs_overlay/data/00-00000002.data"));
  assert.throws(() => validateShellContract(shellArchive.shell), /Forbidden/);

  for (const path of [
    "dm/data/00-00000002.data",
    "romfs_overlay/other/00-00000002.data",
    "romfs_overlay/data/00-00000002.data/child",
  ]) {
    const bad = fixture();
    allowOverlay(bad);
    bad.generatedEntries.push(entry(path, 1024));
    assert.throws(() => validateAssemblyInventory(bad));
  }
  const oversized = fixture();
  allowOverlay(oversized);
  oversized.generatedEntries.push(
    entry("romfs_overlay/data/00-00000002.data", 128 * 1024 * 1024 + 1),
  );
  assert.throws(() => validateAssemblyInventory(oversized), /Forbidden/);
});
test("manifest completeness, no empty directories and no shell overwrite", () => {
  for (const remove of [
    "dm/derived.tsv",
    "msl/b-test/synthetic.metal",
    "Frameworks/Guest.framework/Guest",
  ]) {
    const f = fixture();
    f.generatedEntries = f.generatedEntries.filter((e) => e.path !== remove);
    assert.throws(() => validateAssemblyInventory(f));
  }
  const f = fixture();
  f.generatedEntries = f.generatedEntries.filter((e) => !e.path.startsWith("msl/"));
  f.generatedEntries.push(entry("msl/b-test/", 0, 0o40755));
  assert.throws(() => validateAssemblyInventory(f), /empty required directory/);
  const c = fixture();
  c.shell.entries.push(entry(base + "dm/pack_info.txt"));
  assert.throws(() => validateAssemblyInventory(c), /Duplicate/);
  const l = fixture();
  l.shell.entries.push(entry(base + "dm/derived.tsv"));
  assert.throws(() => validateAssemblyInventory(l), /already contains/);
});
test("Guest signature range and executable permissions required", () => {
  for (const change of [
    (g) => {
      g.mode = 0o100644;
    },
    (g) => {
      delete g.signature;
    },
    (g) => {
      g.signature.size = 21;
    },
    (g) => {
      g.signature.kind = "developer";
    },
  ]) {
    const f = fixture();
    change(f.generatedEntries[1]);
    assert.throws(() => validateAssemblyInventory(f));
  }
});
test("bounded inputs and generated allowlist", () => {
  const f = fixture();
  f.generatedEntries.push(entry("unapproved"));
  assert.throws(() => validateAssemblyInventory(f), /outside trusted/);
  for (const size of [-1, NaN, Infinity, SHELL_LIMITS.bytes + 1]) {
    const f = fixture();
    f.shell.entries[0].size = size;
    assert.throws(() => validateShellContract(f.shell));
  }
  const b = fixture();
  b.shell.shellInfoText = "x".repeat(SHELL_LIMITS.text + 1);
  assert.throws(() => validateShellContract(b.shell), /oversized/);
  const m = fixture();
  m.shell.entries = Array(SHELL_LIMITS.entries + 1).fill(entry(base + "x"));
  assert.throws(() => validateShellContract(m.shell), /limit/);
});
test("explicit parent directories and equivalent target patch zero", () => {
  const f = fixture();
  f.shell.entries.unshift(entry("Payload/", 0, 0o40755), entry(base, 0, 0o40755));
  f.observedOutputTargetOS = { platform: "ios", minimumVersion: "16.0.0" };
  assert.equal(validateAssemblyInventory(f).status, "assembly-inventory-valid");
});

// 四种生成覆盖路径共享规范 0–255 编号；外壳本身仍不可携带归档。
// All four generated overlay paths share canonical 0–255 numbering; shell archives remain forbidden.
for (const root of [
  "romfs_overlay",
  "romfs_overlay_variants/item_notes",
  "romfs_overlay_astc",
  "romfs_overlay_astc_variants/item_notes",
]) {
  test(`generated ${root} accepts canonical two/three-digit chunks only`, () => {
    const setup = (name, size = 1024) => {
      const f = fixture();
      f.shell.trustedRecipe.requiredPaths = [...f.shell.trustedRecipe.requiredPaths, root + "/"];
      f.shell.shellManifestText += "\n" + root + "/";
      f.generatedEntries.push(entry(`${root}/data/${name}`, size));
      return f;
    };
    for (const name of [
      "00-00000002.data",
      "99-00000255.data",
      "100-00000002.data",
      "255-00000255.data",
    ])
      assert.equal(validateAssemblyInventory(setup(name)).status, "assembly-inventory-valid");
    assert.equal(
      validateAssemblyInventory(setup("255-00000002.data", 128 * 1024 * 1024)).status,
      "assembly-inventory-valid",
    );
    for (const name of [
      "0-00000002.data",
      "100-0000002.data",
      "000-00000002.data",
      "099-00000002.data",
      "256-00000002.data",
      "100-00000256.data",
      "100-00000002.DATA",
      "100-00000002.data/child",
    ])
      assert.throws(() => validateAssemblyInventory(setup(name)), /Forbidden/);
    for (const size of [0, 128 * 1024 * 1024 + 1])
      assert.throws(() => validateAssemblyInventory(setup("100-00000002.data", size)), /Forbidden/);
    const shell = fixture();
    shell.shell.entries.push(entry(`${base}${root}/data/100-00000002.data`));
    assert.throws(() => validateShellContract(shell.shell), /Forbidden/);
  });
}
