import test from "node:test";
import assert from "node:assert/strict";
import { utf8 } from "../toolchain/art-recipes-js/util.mjs";
import {
  executeAssetTransform,
  VAULT_PATHS,
} from "../toolchain/asset-transforms-js/transforms.mjs";

// 监测逐字符数组扩张，不测量 RSS 或改变字符串编码语义。
// Detect character-array expansion without measuring RSS or changing encoding semantics.
test("art and table UTF-8 checks avoid character arrays and preserve scalar validation", async () => {
  const original = Array.from;
  Array.from = function (value, ...args) {
    assert.notEqual(typeof value, "string", "must not expand strings into character arrays");
    return original.call(this, value, ...args);
  };
  try {
    for (const text of ["", "plain", "中文 😀\t\n", "x".repeat(2 * 1024 * 1024)])
      assert.deepEqual(utf8(text), new TextEncoder().encode(text));
    for (const text of ["\ud800", "\udfff", "x\ud800y"])
      assert.throws(() => utf8(text), /ART_UTF8/);
    assert.throws(() => utf8(null), /ART_UTF8/);
    const assets = Object.fromEntries(VAULT_PATHS.map((path) => [path, ""]));
    for (const [manifest, expected] of [
      ["x".repeat(4 * 1024 * 1024 + 1), /VAULT_MANIFEST_LIMIT/],
      ["\ud800", /ASSET_UTF8/],
    ]) {
      const payload = new TextEncoder().encode(JSON.stringify({ assets, manifest }));
      await assert.rejects(executeAssetTransform("vault-table", payload), expected);
    }
  } finally {
    Array.from = original;
  }
});

// 在下一验证阶段停止，以隔离长度检查；不需要图像后端或真实资源。
// Stop at the next validation stage to isolate length checks without image backends or real assets.
test("recipe label and path limits count Unicode without expanding strings", async () => {
  const { generateMapGoal, LABELS } = await import("../toolchain/art-recipes-js/map-goal.mjs");
  const { generateNativeArt } = await import("../toolchain/art-recipes-js/native-art.mjs");
  const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
  const original = Array.from;
  Array.from = function (value, ...args) {
    assert.notEqual(typeof value, "string", "must not expand strings into character arrays");
    return original.call(this, value, ...args);
  };
  try {
    for (const value of ["a".repeat(256), "😀".repeat(256), "a😀".repeat(128), "\ud800"])
      checkLabel(value, /MAP_GOAL_DIMENSIONS/);
    for (const value of ["", "a".repeat(257), "😀".repeat(257), "x\n", "a".repeat(1024 * 1024)])
      checkLabel(value, /MAP_GOAL_LABEL_LIMIT/);
    function checkLabel(value, expected) {
      const tables = {};
      for (const [table, Key] of LABELS)
        (tables[table] ??= []).push({
          Key,
          zhCN: "a",
          enUS: "a",
          esES: "a",
          esMX: "a",
          ruRU: "a",
          koKR: "가",
        });
      // 只替换首个标签，保持超长用例仍在表格输入预算之内。
      // Replace only the first label to keep oversized cases within the table input budget.
      tables[LABELS[0][0]][0].zhCN = value;
      const strings = Object.fromEntries(
        Object.entries(tables).map(([name, rows]) => [name, JSON.stringify(rows)]),
      );
      assert.throws(
        () =>
          generateMapGoal(
            encode({ images: { symbols: {}, units: {} }, font: "", strings }),
            { names: "current" },
            {},
          ),
        expected,
      );
    }
    for (const value of ["a".repeat(1024), "😀".repeat(1024), "a😀".repeat(512), "\ud800"])
      await executeAssetTransform("overlay-paths", encode([value]));
    for (const value of ["a".repeat(1025), "😀".repeat(1025), "a".repeat(1024 * 1024)])
      await assert.rejects(
        executeAssetTransform("overlay-paths", encode([value])),
        /Unsafe logical path/,
      );
    for (const [count, expected] of [
      [113, /NATIVE_ART_TABLE_SET/],
      [114, /NATIVE_ART_OUTPUT_NAME/],
      [1024 * 1024, /NATIVE_ART_OUTPUT_NAME/],
    ]) {
      const name = "dm_native_" + "😀".repeat(count) + ".png";
      // The large-name fixture uses ASCII so its manifest remains below the 2 MiB cap.
      // 超长名称用 ASCII，确保清单仍低于 2 MiB 上限。
      const assets = [
        { asset: count > 1000 ? "dm_native_" + "a".repeat(count) + ".png" : name },
        ...Array.from({ length: 8 }, (_, i) => ({ asset: `dm_native_${i}.png` })),
      ];
      const metadata = {
        manifest: JSON.stringify({ assets }),
        geometry: "",
        binding: "",
        implementation: "",
      };
      await assert.rejects(
        generateNativeArt(
          encode({ metadata }),
          {
            metadataSha256: Object.fromEntries(
              Object.keys(metadata).map((key) => [key, "synthetic"]),
            ),
          },
          { sha256: async () => "synthetic" },
        ),
        expected,
      );
    }
  } finally {
    Array.from = original;
  }
});

test("derived strings retain control-character rejection without character arrays", async () => {
  const { createHash } = await import("node:crypto");
  const sourcesFor = (name) => ({
    "dm_hud_exp.h":
      "static const uint32_t k_exp[100] = {" +
      Array.from({ length: 100 }, (_, i) => i).join(",") +
      "};\n",
    "dm_vault_tab.h":
      '#define VT_NPART 1\nstatic const char *const vt_part_name[VT_NPART] = { "' +
      name +
      '" };\nstatic const vt_row vt_rows[] = {\n    { 1, 0, 2, 5, 17, -1, "Name", "Path" },\n};\nstatic const char *const vt_set_key[] = { "Set" };\n',
    "dm_touch_native_art.c":
      "static const struct { uint32_t id; int atlas,frame; } rows[]={\n {12,1,2},\n};\n",
  });
  const original = Array.from;
  Array.from = function (value, ...args) {
    assert.notEqual(typeof value, "string", "must not expand strings into character arrays");
    return original.call(this, value, ...args);
  };
  try {
    for (const [name, error] of [
      ["中文 😀", null],
      ["bad\\tname", /DERIVED_CONTROL_CHARACTER/],
      ["bad\\177name", /DERIVED_CONTROL_CHARACTER/],
      ["x".repeat(100000), /DERIVED_RUNTIME_LINE_LIMIT/],
    ]) {
      const sources = sourcesFor(name);
      const result = executeAssetTransform(
        "derived-tables",
        new TextEncoder().encode(JSON.stringify(sources)),
        {
          mode: "generated",
          expectedSourceSha256: Object.fromEntries(
            Object.entries(sources).map(([key, text]) => [
              key,
              createHash("sha256").update(text).digest("hex"),
            ]),
          ),
        },
      );
      if (error) await assert.rejects(result, error);
      else assert.ok((await result).files["derived.tsv"].length > 0);
    }
  } finally {
    Array.from = original;
  }
});
