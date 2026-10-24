// 只覆盖惰性合成约定，不使用原生代码、WASM、浏览器、字体或私有输入。
// Inert synthetic contract coverage only. No native, WASM, browser, font or private input.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { generateNativeArt } from "../toolchain/art-recipes-js/native-art.mjs";
import {
  createNativeArtCases,
  nativeHashDependencies,
} from "../toolchain/art-recipes-js/test/native-cases.mjs";
import { vitalCharacters } from "../toolchain/hud-recipes-js/support.mjs";

const codec = {
  encodeRgba(rgba, width, height) {
    // 确定性的替身，不是 PNG 编码器或像素一致性参考。
    // A deterministic stand-in, not a PNG encoder or pixel-parity oracle.
    return new Uint8Array([...new TextEncoder().encode(`${width}x${height}:`), ...rgba]);
  },
};

test("v2 native-art preserves all bounded synthetic success/rejection cases", async () => {
  const cases = await createNativeArtCases(codec);
  for (const entry of cases) {
    const run = () =>
      generateNativeArt(entry.payload, entry.options, { codec, ...nativeHashDependencies });
    if (entry.rejects) await assert.rejects(run, undefined, entry.label);
    else {
      const result = await run();
      assert.equal(result.assetCount, 10, entry.label);
      assert.equal(Object.keys(result.files).length, 11, entry.label);
      const source = new TextDecoder().decode(result.files["dm_touch_native_art.c"]);
      assert.ok(
        source.startsWith(
          "/* 从冻结原版表生成，不手改。 | Generated from frozen official tables; do not hand-edit. */\n",
        ),
      );
      assert.ok(
        source.includes(
          `const char dm_ta_manifest_sha[]="${entry.options.metadataSha256.manifest}";`,
        ),
      );
      assert.ok(source.includes('#include "../../host/dm_input.h"'));
    }
  }
});

test("v2 native-art requires RGBA pins even when encoded bytes still match", async () => {
  const [entry] = await createNativeArtCases(codec);
  const bundle = JSON.parse(new TextDecoder().decode(entry.payload));
  const manifest = JSON.parse(bundle.metadata.manifest);
  delete manifest.assets[0].decoded_rgba_sha256;
  bundle.metadata.manifest = JSON.stringify(manifest);
  const bytes = new TextEncoder().encode(bundle.metadata.manifest);
  const options = {
    metadataSha256: {
      ...entry.options.metadataSha256,
      manifest: nativeHashDependencies.sha256(bytes),
    },
  };
  await assert.rejects(
    generateNativeArt(new TextEncoder().encode(JSON.stringify(bundle)), options, {
      codec,
      ...nativeHashDependencies,
    }),
    /RGBA/,
  );
});

const header = "键\t中文\tEnglish\tEspañol\tEspañol MX\tРусский\t한국어\t用在哪";
const i18n = (koLife = "생명력", koMana = "마나") =>
  `${header}\ndmHudLife\t生命\tLife\tVida\t\tЖизнь\t${koLife}\tHUD\ndmHudMana\t法力\tMana\tMana\t\tМана\t${koMana}\tHUD\n`;

test("v2 HUD includes Korean vital glyphs and validates the extra language", () => {
  const characters = vitalCharacters(i18n(), true);
  for (const char of "생명력마나") assert.ok(characters.includes(char));
  assert.throws(() => vitalCharacters(i18n(""), true), /HUD_I18N_ROW/);
  assert.throws(() => vitalCharacters(i18n("生命"), true), /HUD_I18N_CJK/);
  assert.throws(() => vitalCharacters(i18n("%d"), true), /HUD_I18N_PLACEHOLDER/);
  assert.throws(() => vitalCharacters(i18n("생명력\\n"), true), /HUD_I18N_NEWLINES/);
  assert.throws(
    () => vitalCharacters(i18n().replace("한국어", "missing"), true),
    /HUD_I18N_HEADER/,
  );
});

test("v2 HUD reads the actual shared source table, including Korean", () => {
  const table = readFileSync(new URL("../../dm/i18n/ui_text.tsv", import.meta.url), "utf8");
  const characters = vitalCharacters(table, true);
  for (const char of "생명마나") assert.ok(characters.includes(char));
});

test("legacy HUD defaults preserve the exact pre-v2 vital character sequence", () => {
  const table = readFileSync(new URL("../../dm/i18n/ui_text.tsv", import.meta.url), "utf8");
  // 仅从功能分支基点 75ce76f 的公开 TSV 派生，不进行渲染。
  // Derived only from the public TSV at feature base 75ce76f, without rendering.
  assert.equal(vitalCharacters(table), "生命法力:/ 0123456789LMVadefináЖМазинь");
});

test("b811/e375 art source comparison stays pinned to the reviewed merge inputs", () => {
  const record = JSON.parse(
    readFileSync(
      new URL("../toolchain/art-recipes-js/release-source-compatibility.json", import.meta.url),
      "utf8",
    ),
  );
  const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
  for (const [path, hash] of Object.entries(record.sharedSourceSha256)) {
    const expected = record.mergedSourceOverrides[path]?.sha256 ?? hash;
    assert.equal(sha(readFileSync(new URL(`../../${path}`, import.meta.url))), expected, path);
  }
  const table = readFileSync(new URL(`../../${record.i18n.path}`, import.meta.url), "utf8");
  assert.equal(sha(table), record.i18n.mergedSha256);
  for (const [key, columns] of Object.entries(record.i18n.unchangedHudVitalRows)) {
    const row = table.split("\n").find((line) => line.startsWith(`${key}\t`));
    assert.deepEqual(row.split("\t").slice(1, 7), columns);
  }
});
