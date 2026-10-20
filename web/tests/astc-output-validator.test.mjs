// 只验证合成 ASTC 输出清单和元数据；不读取游戏或宣称内容认证。
// Validate synthetic ASTC inventories and metadata only, without game reads or content-authentication claims.
import test from "node:test";
import assert from "node:assert/strict";
import {
  validateAstcOutputs,
  validateLegacyPackMetadata,
  validateCascArchiveName,
} from "../astc-output-validator.mjs";
const encode = (s) => new TextEncoder().encode(s);
const pack = { name: "00-00000008.data", size: 3, sha256: "a".repeat(64) };
const overlayArchives = { base: "00-00000009.data", item_notes: "00-00000010.data" };
function fixture() {
  const files = {};
  for (const [prefix, name, sidecars] of [
    ["romfs_overlay_astc", overlayArchives.base, ["ctrl_touch", "touch_strings.tsv", "pack.json"]],
    [
      "romfs_overlay_astc_variants/item_notes",
      overlayArchives.item_notes,
      ["ctrl_touch", "touch_strings.tsv", "dm_textbox_plain.tsv", "features.txt"],
    ],
  ]) {
    files[`${prefix}/data/.build.config`] = encode("config");
    files[`${prefix}/data/${name}`] = Uint8Array.of(1);
    for (const side of sidecars)
      files[`${prefix}/${side}`] = encode(
        side === "pack.json"
          ? JSON.stringify(pack, null, 1)
          : side === "features.txt"
            ? "item_notes\ndata/example\n"
            : "text",
      );
  }
  return { files, pack, overlayArchives };
}
test("accepts exactly native ASTC base plus item_notes while leaving caller bytes unchanged", () => {
  const options = fixture(),
    before = structuredClone(options);
  const result = validateAstcOutputs(options);
  assert.equal(result.paths.length, 11);
  assert.deepEqual(result.pack, pack);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.paths));
  assert.deepEqual(options, before);
});
test("missing/extra/default BC/external data and index paths reject", () => {
  for (const extra of [
    "pack_index.tsv",
    `data/${pack.name}`,
    `romfs_overlay_astc/data/${pack.name}`,
    "romfs_overlay/data/.build.config",
    "romfs_overlay_astc_variants/other/features.txt",
    "romfs_overlay_astc/../escape",
  ]) {
    const options = fixture();
    options.files[extra] = Uint8Array.of(1);
    assert.throws(() => validateAstcOutputs(options), /ASTC_OUTPUT_INVALID/);
  }
  for (const path of Object.keys(fixture().files)) {
    const options = fixture();
    delete options.files[path];
    assert.throws(() => validateAstcOutputs(options), /ASTC_OUTPUT_INVALID/);
  }
});
test("pack metadata is exactly bound and ambiguous JSON is rejected", () => {
  const jsons = [
    JSON.stringify({ ...pack, size: 4 }),
    JSON.stringify({ ...pack, sha256: "b".repeat(64) }),
    JSON.stringify({ ...pack, extra: 1 }),
    JSON.stringify(pack).replace('"size":3', '"size":3,"size":3'),
    JSON.stringify(pack).replace('"size":3', '"size":3,"\\u0073ize":3'),
    " ".repeat(513),
    "not json",
  ];
  for (const json of jsons) {
    const options = fixture();
    options.files["romfs_overlay_astc/pack.json"] = encode(json);
    assert.throws(() => validateAstcOutputs(options));
  }
});
test("names, size limits, external archive alias and variant feature identity fail closed", () => {
  for (const name of [
    "../a",
    "0-00000008.data",
    "00-00000256.data",
    "256-00000008.data",
    "00-00000008.DATA",
    "000-00000008.data",
  ])
    assert.throws(() => validateCascArchiveName(name));
  assert.equal(validateCascArchiveName("255-00000255.data"), "255-00000255.data");
  for (const size of [-1, 0.1, NaN, Infinity, 2 ** 40 + 1])
    assert.throws(() => validateLegacyPackMetadata({ ...pack, size }));
  const options = fixture();
  options.overlayArchives = { ...overlayArchives, base: pack.name };
  assert.throws(() => validateAstcOutputs(options));
  const other = fixture();
  other.files["romfs_overlay_astc_variants/item_notes/features.txt"] = encode("other\n");
  assert.throws(() => validateAstcOutputs(other));
});
test("empty archive and shared/resizable byte buffers reject", () => {
  for (const bytes of [
    new Uint8Array(),
    new Uint8Array(new SharedArrayBuffer(1)),
    new Uint8Array(new ArrayBuffer(1, { maxByteLength: 2 })),
  ]) {
    const options = fixture();
    options.files[`romfs_overlay_astc/data/${overlayArchives.base}`] = bytes;
    assert.throws(() => validateAstcOutputs(options));
  }
});
