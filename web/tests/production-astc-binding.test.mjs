// 用合成条目验证可选 ASTC 契约绑定；不启用界面、不读取游戏或外壳二进制。
// Verify optional ASTC contract binding with synthetic entries, without enabling UI or reading game/shell binaries.
import test from "node:test";
import assert from "node:assert/strict";
import { bindProductionAstcEntries, inspectProductionAstcEntries } from "../production-profile.mjs";
import { selectProductionAstcEntries } from "../browser-packager.mjs";
const encode = (s) => new TextEncoder().encode(s);
const binding = {
  pack: { name: "00-00000008.data", size: 123, sha256: "a".repeat(64) },
  overlayArchives: { base: "00-00000009.data", item_notes: "00-00000009.data" },
};
function fixture() {
  const files = {};
  for (const [prefix, archive, sides] of [
    [
      "romfs_overlay_astc",
      binding.overlayArchives.base,
      ["ctrl_touch", "touch_strings.tsv", "pack.json"],
    ],
    [
      "romfs_overlay_astc_variants/item_notes",
      binding.overlayArchives.item_notes,
      ["ctrl_touch", "touch_strings.tsv", "dm_textbox_plain.tsv", "features.txt"],
    ],
  ]) {
    files[`${prefix}/data/.build.config`] = encode("config");
    files[`${prefix}/data/${archive}`] = new Uint8Array(70000);
    for (const side of sides)
      files[`${prefix}/${side}`] = encode(
        side === "pack.json"
          ? JSON.stringify(binding.pack, null, 1)
          : side === "features.txt"
            ? "item_notes\ndata/example\n"
            : "content",
      );
  }
  return Object.entries(files).map(([path, bytes]) => ({
    path,
    size: bytes.length,
    mode: 0o100644,
    async *chunks() {
      for (let i = 0; i < bytes.length; i += 65536) yield bytes.slice(i, i + 65536);
    },
  }));
}
function profileFixture() {
  const targetOS = { platform: "ios", minimumVersion: "26.0.0" };
  const recipe = {
    schemaVersion: 1,
    product: "synthetic",
    chain: "test",
    kind: "ios",
    shaderDigest: "0123456789abcdef",
    targetOS,
    requiredPaths: ["romfs_overlay/", "romfs_overlay_variants/"],
    extraFiles: ["dm/pack_info.txt", "dm/content_mode.json"],
  };
  const entries = ["Info.plist", "DmIOS", "dm/shell_info.txt", "dm/shell_manifest.txt"].map(
    (p) => ({ path: `Payload/DmIOS.app/${p}`, size: 1, mode: 0o100644 }),
  );
  return {
    trustedShell: { trustedRecipe: recipe },
    shell: {
      entries,
      contract: {
        entries,
        trustedRecipe: recipe,
        shellInfoText:
          "PRODUCT=synthetic\nCHAIN=test\nKIND=ios\nSHADER_SRC=0123456789abcdef\nSPIRV_CROSS=synthetic\n",
        shellManifestText: recipe.requiredPaths.join("\n"),
        observedTargetOS: targetOS,
      },
    },
    close() {},
  };
}
test("default selection preserves BC entries and requires no binding", () => {
  const entries = [
    { path: "romfs_overlay/data/00-00000007.data" },
    { path: "romfs_overlay_variants/item_notes/features.txt" },
  ];
  assert.deepEqual(selectProductionAstcEntries(entries), []);
  assert.equal(entries.length, 2);
});
test("binding extends only exact eleven extras and does not mutate default profile", async () => {
  const entries = fixture(),
    original = profileFixture();
  const result = await bindProductionAstcEntries(original, entries, binding);
  assert.equal(result.astcOutput.paths.length, 11);
  assert.equal(
    result.astcOutput.totalBytes,
    entries.reduce((total, entry) => total + entry.size, 0),
  );
  assert.deepEqual(result.trustedShell.trustedRecipe.extraFiles, [
    ...original.trustedShell.trustedRecipe.extraFiles,
    ...entries.map((entry) => entry.path).sort(),
  ]);
  assert.equal(original.trustedShell.trustedRecipe.extraFiles.length, 2);
  assert.equal(original.astcOutput, undefined);
  assert.equal(result.shell.entries, original.shell.entries);
  assert.equal(result.close, original.close);
  assert.equal(result.shell.contract.trustedRecipe, result.trustedShell.trustedRecipe);
  assert.ok(result.astcOutput.paths.every((path) => !path.endsWith("/")));
  await assert.rejects(bindProductionAstcEntries(result, entries, binding), /ALREADY_BOUND/);
});
test("unbound, partial, external archive/index and unexpected ASTC paths reject", async () => {
  assert.throws(() => selectProductionAstcEntries(fixture()), /UNBOUND/);
  assert.throws(() => selectProductionAstcEntries(fixture().slice(1), binding), /INVENTORY/);
  for (const path of [
    "pack_index.tsv",
    "x/pack_index.tsv",
    `data/${binding.pack.name}`,
    `romfs_overlay/data/${binding.pack.name}`,
    "Legacy Device Pack/data/00-00000008.data",
  ])
    assert.throws(
      () => selectProductionAstcEntries([...fixture(), { path }], binding),
      /EXTERNAL_PACK/,
    );
  const entries = fixture();
  entries[0] = { ...entries[0], path: "romfs_overlay_astc/unexpected" };
  await assert.rejects(inspectProductionAstcEntries(entries, binding), /ASTC_OUTPUT_INVALID/);
});
test("chunks are fully drained including later producer errors, with exact sizes and modes", async () => {
  for (const change of [
    (entry) => ({ ...entry, size: entry.size + 1 }),
    (entry) => ({ ...entry, mode: 0o100755 }),
    (entry) => ({ ...entry, mode: 0o120644 }),
    (entry) => ({
      ...entry,
      async *chunks() {
        yield new Uint8Array(entry.size + 1);
      },
    }),
    (entry) => ({
      ...entry,
      async *chunks() {
        yield new Uint8Array(entry.size);
        throw new Error("LATE_PRODUCER");
      },
    }),
    (entry) => ({
      ...entry,
      async *chunks() {
        yield new Uint8Array(new ArrayBuffer(1024 * 1024 + 1), 0, entry.size);
      },
    }),
  ]) {
    const entries = fixture();
    entries[0] = change(entries[0]);
    await assert.rejects(inspectProductionAstcEntries(entries, binding));
  }
});
test("duplicate entries and mismatched pack JSON cannot bind", async () => {
  const duplicate = fixture();
  duplicate[1] = duplicate[0];
  await assert.rejects(inspectProductionAstcEntries(duplicate, binding), /ENTRY/);
  await assert.rejects(
    inspectProductionAstcEntries(fixture(), { ...binding, pack: { ...binding.pack, size: 124 } }),
    /ASTC_OUTPUT_INVALID/,
  );
});
test("pre-abort prevents reading and cancellation after final chunk rejects", async () => {
  const pre = new AbortController();
  pre.abort();
  const untouched = fixture().map((entry) => ({
    ...entry,
    chunks() {
      assert.fail("unexpected read");
    },
  }));
  await assert.rejects(inspectProductionAstcEntries(untouched, binding, { signal: pre.signal }), {
    name: "AbortError",
  });
  const controller = new AbortController(),
    entries = fixture();
  entries[0] = {
    ...entries[0],
    async *chunks() {
      yield encode("config");
      controller.abort();
    },
  };
  await assert.rejects(
    inspectProductionAstcEntries(entries, binding, { signal: controller.signal }),
    { name: "AbortError" },
  );
});
test("large opaque files are drained without full-file reconstruction", async () => {
  const entries = fixture();
  const index = entries.findIndex((entry) => entry.path.endsWith(binding.overlayArchives.base));
  let count = 0;
  entries[index] = {
    ...entries[index],
    size: 2 * 1024 * 1024,
    async *chunks() {
      for (let i = 0; i < 32; i++) {
        count++;
        yield new Uint8Array(65536);
      }
    },
  };
  const result = await inspectProductionAstcEntries(entries, binding);
  assert.equal(count, 32);
  assert.equal(
    result.totalBytes,
    entries.reduce((sum, entry) => sum + entry.size, 0),
  );
});
