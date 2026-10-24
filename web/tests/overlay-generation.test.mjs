// Feature suite: overlay-generation. Original test sections retain independent lexical scopes.
import * as assertIsolatedRunModule from "./helpers/assert-isolated-run.mjs";
import * as nodeTestModule from "node:test";
import * as nodeChild_processModule from "node:child_process";
import * as nodeProcessModule from "node:process";
import * as strictModule from "node:assert/strict";
import * as nodeUrlModule from "node:url";
import * as nodeCryptoModule from "node:crypto";
import * as nodeZlibModule from "node:zlib";
import * as recipeModule from "../toolchain/overlay-recipe-js/recipe.mjs";
import * as inventoryModule from "../toolchain/overlay-recipe-js/inventory.mjs";
import * as annotationsModule from "../toolchain/overlay-recipe-js/annotations.mjs";
import * as inventoryParityModule from "../toolchain/overlay-recipe-js/test/inventory-parity.mjs";
import * as annotationsParityModule from "../toolchain/overlay-recipe-js/test/annotations-parity.mjs";
import * as overlayModule from "../toolchain/casc-overlay-js/overlay.mjs";
import * as annotationDataJsonModule from "../toolchain/overlay-recipe-js/annotation-data.json" with { type: "json" };
import * as legacyV1DataJsonModule from "../toolchain/overlay-recipe-js/legacy-v1-data.json" with { type: "json" };
import * as legacyV1Module from "../toolchain/overlay-recipe-js/legacy-v1.mjs";
import * as releaseV2DataJsonModule from "../toolchain/overlay-recipe-js/release-v2-data.json" with { type: "json" };
import * as releaseV2Module from "../toolchain/overlay-recipe-js/release-v2.mjs";
import * as touchLayoutModule from "../toolchain/overlay-recipe-js/touch-layout.mjs";
import * as revisionModule from "../toolchain/overlay-recipe-js/revision.mjs";
import * as overlayContractModule from "../overlay-contract.mjs";
import * as nodeFsModule from "node:fs";
import * as nativeArtModule from "../toolchain/art-recipes-js/native-art.mjs";
import * as nativeCasesModule from "../toolchain/art-recipes-js/test/native-cases.mjs";
import * as supportModule from "../toolchain/hud-recipes-js/support.mjs";

// native-overlay-prebuilt
{
  // 普通测试入口始终执行隔离模块模拟覆盖，不要求调用方记住实验标志。
  // The ordinary test entry always executes isolated module-mock coverage without caller flags.
  const { assertIsolatedRun } = assertIsolatedRunModule;
  const { default: test } = nodeTestModule;
  const { spawnSync } = nodeChild_processModule;
  const { default: process } = nodeProcessModule;
  test("native overlay optional prebuilt assembly (isolated module mocks)", () => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(
      process.execPath,
      [
        "--experimental-test-module-mocks",
        "--test",
        "--test-reporter=tap",
        new URL("./fixtures/native-overlay-prebuilt.mock.mjs", import.meta.url).pathname,
      ],
      { env, encoding: "utf8", timeout: 30000, maxBuffer: 1024 * 1024 },
    );
    assertIsolatedRun(result);
  });
}

// overlay-recipe-provenance
{
  // 验证 overlay-recipe-provenance 的约定与边界；依据 web/tests 及本文件的测试断言。
  // Verify overlay-recipe-provenance contracts and boundaries against web/tests and this file's assertions.
  const { default: assert } = strictModule;
  const { spawnSync } = nodeChild_processModule;
  const { fileURLToPath } = nodeUrlModule;
  const { default: test } = nodeTestModule;

  test("overlay source and derived-data pins stay synchronized after shared UI text changes", () => {
    const result = spawnSync(
      process.execPath,
      [
        fileURLToPath(
          new URL("../toolchain/overlay-recipe-js/scripts/verify-source.mjs", import.meta.url),
        ),
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

// overlay-unicode-allocation
{
  // 合成文本检查避免字符数组扩张，同时保留 Unicode 行为；不使用游戏输入。
  // Synthetic text checks avoid character-array expansion while preserving Unicode behavior; no game inputs.
  const { default: test } = nodeTestModule;
  const { default: assert } = strictModule;
  const { createHash } = nodeCryptoModule;
  const { spawnSync } = nodeChild_processModule;
  const { deflateSync } = nodeZlibModule;
  const { logical } = recipeModule;
  const { vaultTab } = inventoryModule;
  const { createAnnotations } = annotationsModule;
  const { inventoryFixtures } = inventoryParityModule;
  const { buildAnnotationFixture } = annotationsParityModule;
  const { createCascOverlayTransform } = overlayModule;
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();

  test("logical paths preserve codepoint boundaries and reject huge paths before iteration", () => {
    for (const value of ["a".repeat(4091), "😀".repeat(4091), "\ud800"])
      assert.equal(logical("DATA\\" + value), "data/" + value);
    for (const value of ["a".repeat(4092), "😀".repeat(4092), "bad\n", "../bad"])
      assert.throws(() => logical("data/" + value), /OVERLAY_PATH/);
    const original = String.prototype[Symbol.iterator];
    String.prototype[Symbol.iterator] = function () {
      assert.ok(this.length <= 8192, "must not iterate an oversized path");
      return original.call(this);
    };
    try {
      assert.throws(() => logical("data/" + "a".repeat(1024 * 1024)), /OVERLAY_PATH/);
      assert.equal(logical("x".repeat(1024 * 1024) + ":data/good"), "data/good");
    } finally {
      String.prototype[Symbol.iterator] = original;
    }
  });

  test("vault layout span counts astral codepoints without a full character array", () => {
    const { bank } = inventoryFixtures();
    const rewritten = vaultTab(bank);
    const start = rewritten.indexOf('"name": "BankTabs"');
    const key = '"tabRightIndicatorPosition":';
    const span = rewritten.indexOf(key) - start;
    const original = Array.from;
    Array.from = function (value, ...args) {
      assert.notEqual(typeof value, "string", "must not expand a layout span");
      return original.call(this, value, ...args);
    };
    try {
      for (const char of ["a", "😀"])
        for (const extra of [0, 1]) {
          const text = bank.replace(key, char.repeat(2500 - span + extra) + key);
          if (extra) assert.throws(() => vaultTab(text), /BankTabs/);
          else assert.ok(vaultTab(text).includes('"x": 920'));
        }
      assert.throws(() => vaultTab(bank.replace(key, "x".repeat(1024 * 1024) + key)), /BankTabs/);
    } finally {
      Array.from = original;
    }
  });

  test("annotations avoid expanding discarded long skills and preserve first-codepoint uppercase", async () => {
    const fixture = buildAnnotationFixture();
    const longSkill = "Skill" + "x".repeat(10000);
    const name = "ß" + "x".repeat(10000);
    for (const [file, change] of [
      [
        "skills.json",
        (rows) => {
          rows.find((row) => row.Key === "skillname1").esES = longSkill;
        },
      ],
      [
        "item-names.json",
        (rows) => {
          rows.find((row) => row.Key === "isc").esES = "[ms]Pergamino de " + name;
        },
      ],
    ]) {
      const path = "data/local/lng/strings/" + file;
      const rows = JSON.parse(decoder.decode(fixture.assets.get(path)));
      change(rows);
      fixture.assets.set(path, encoder.encode(JSON.stringify(rows)));
    }
    const original = Array.from;
    Array.from = function (value, ...args) {
      assert.ok(
        value !== longSkill && value !== name,
        "must not expand the checked skill or stripped name",
      );
      return original.call(this, value, ...args);
    };
    try {
      const result = await createAnnotations({
        readAsset: (path) => fixture.assets.get(path),
        sha1: fixture.sha1,
      }).buildItemNotes();
      const rows = JSON.parse(
        decoder
          .decode(result.replacements.get("data/local/lng/strings/item-names.json"))
          .replace(/^\ufeff/, ""),
      );
      assert.equal(rows.find((row) => row.Key === "isc").esES, "[ms]SS" + "x".repeat(10000));
    } finally {
      Array.from = original;
    }
  });

  test("CASC config encoding validates large text without a character array", async () => {
    const fixture = spawnSync(
      "python3",
      [new URL("../toolchain/casc-overlay-js/test/fixture.py", import.meta.url).pathname],
      { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
    );
    assert.equal(fixture.status, 0, fixture.stderr);
    const request = JSON.parse(fixture.stdout);
    const payload = Buffer.from(request.payload, "base64");
    const comment = "#" + "x".repeat(100000) + "\n";
    const config = Buffer.concat([
      payload.subarray(0, request.options.parts[0]),
      encoder.encode(comment),
    ]);
    const input = Buffer.concat([config, payload.subarray(request.options.parts[0])]);
    request.options.parts[0] = config.length;
    const generate = createCascOverlayTransform({
      md5: (bytes) => new Uint8Array(createHash("md5").update(bytes).digest()),
      compress: (bytes) => new Uint8Array(deflateSync(bytes, { level: 9 })),
    });
    const original = Array.from;
    Array.from = function (value, ...args) {
      assert.ok(
        typeof value !== "string" || value.length < 5000,
        "must not expand the large config",
      );
      return original.call(this, value, ...args);
    };
    try {
      const result = await generate(input, request.options);
      assert.ok(decoder.decode(result.files["data/.build.config"]).includes(comment));
    } finally {
      Array.from = original;
    }
  });
}

// overlay-v2-contract
{
  // 仅合成字节和仓库静态数据的 v2 覆盖层测试；不运行原生生成器或 WASM。
  // V2 overlay tests use only synthetic bytes and repository static data, never native generators or WASM.
  const { default: assert } = strictModule;
  const { createHash } = nodeCryptoModule;
  const { default: test } = nodeTestModule;
  const { default: data } = annotationDataJsonModule;
  const { default: legacy } = legacyV1DataJsonModule;
  const { legacyI18n, legacyTouch, legacyCustomPage } = legacyV1Module;
  const { default: release } = releaseV2DataJsonModule;
  const { releaseI18n } = releaseV2Module;
  const { createAnnotations } = annotationsModule;
  const { padCustomPage } = touchLayoutModule;
  const { controllerGlyphs } = recipeModule;
  const {
    LEGACY_OVERLAY_REVISION,
    RELEASE_OVERLAY_REVISION,
    UPSTREAM_OVERLAY_REVISION,
    requireOverlayRevision,
  } = revisionModule;
  const { createOverlayManifest, OVERLAY_SOURCE_FINGERPRINT } = overlayContractModule;

  const enc = new TextEncoder(),
    dec = new TextDecoder();
  const sha256 = (value) => createHash("sha256").update(value).digest("hex");
  const stringPath = "data/local/lng/strings/ui.json";
  test("compact legacy deltas restore the exact historical data hashes", () => {
    for (const [key, value] of [
      ["i18nSha256", legacyI18n],
      ["touchSha256", legacyTouch],
      ["customPageSha256", legacyCustomPage],
    ])
      assert.equal(sha256(JSON.stringify(value)), legacy.expected[key]);
  });
  test("upstream Korean i18n is isolated from the existing v1 shell", async () => {
    for (const upstream of [true, false]) {
      const pipeline = createAnnotations({
        readAsset: () => enc.encode('[{"Key":"original"}]'),
        sha1: () => "0".repeat(40),
        upstream,
      });
      const result = await pipeline.buildI18n();
      const rows = JSON.parse(dec.decode(result.replacements.get(stringPath))).slice(1);
      const expected = upstream ? data.i18n : legacyI18n;
      assert.equal(result.count, expected.rows.length);
      assert.deepEqual(
        rows.map((row) => row.Key),
        expected.rows.map((row) => row[0]),
      );
      assert.ok(rows.every((row) => !row.Key.startsWith("dmWeb")));
      for (let i = 0; i < rows.length; i++) {
        assert.equal(rows[i].id, expected.id0 + i);
        assert.equal(rows[i].koKR, upstream ? expected.rows[i][6] : expected.rows[i][2]);
        assert.equal(rows[i].esMX, expected.rows[i][4] || expected.rows[i][3]);
      }
      const page = padCustomPage('"name": "VideoOptionsPanel" "name": "OptionsTable"', upstream);
      assert.equal(page.includes("TouchCustom_lang_ko"), upstream);
      assert.equal(page.includes("TouchCustomLangHintKo"), upstream);
      assert.ok(!page.includes("TouchCustom_voice"));
      if (!upstream) assert.equal(page, legacyCustomPage[0]);
    }
    assert.equal(requireOverlayRevision(LEGACY_OVERLAY_REVISION), false);
    assert.equal(requireOverlayRevision(UPSTREAM_OVERLAY_REVISION), true);
    assert.equal(requireOverlayRevision(RELEASE_OVERLAY_REVISION), true);
    assert.throws(() => requireOverlayRevision("v2.0.0"), /REVISION/);
  });
  test("b811 release preserves its exact row IDs and excludes later voice additions", async () => {
    assert.equal(sha256(JSON.stringify(releaseI18n)), release.i18nSha256);
    const result = await createAnnotations({
      readAsset: () => enc.encode('[{"Key":"original"}]'),
      sha1: () => "0".repeat(40),
      release: true,
    }).buildI18n();
    const rows = JSON.parse(dec.decode(result.replacements.get(stringPath))).slice(1);
    assert.equal(rows.length, 449);
    assert.deepEqual(
      rows.map((row) => row.Key),
      releaseI18n.rows.map((row) => row[0]),
    );
    assert.ok(rows.some((row) => row.Key === "dmCustomLangKoOpt"));
    assert.ok(rows.every((row) => !row.Key.startsWith("dmCustomVoice")));
  });

  test("Korean touch strings retain source checks and do not affect legacy sidecars", async () => {
    const records = new Map();
    for (const [lang, tables] of Object.entries(data.touch.tables))
      for (const [name, items] of Object.entries(tables)) {
        if (!records.has(name)) records.set(name, new Map());
        for (const [key, [hash]] of Object.entries(items)) {
          if (!records.get(name).has(key)) records.get(name).set(key, { Key: key });
          records.get(name).get(key)[lang] = `HASH:${hash}`;
        }
      }
    const assets = new Map(
      [...records].map(([name, rows]) => [
        "data/local/lng/strings/" + name,
        enc.encode(JSON.stringify([...rows.values()])),
      ]),
    );
    for (const upstream of [true, false]) {
      const pipeline = createAnnotations({
        readAsset: (path) => assets.get(path),
        upstream,
        sha1: (raw) => dec.decode(raw).slice(5) + "0".repeat(32),
      });
      const sidecar = dec.decode((await pipeline.buildTouchStrings()).touchStrings);
      assert.equal(sidecar.includes("두 번 탭하여 사용"), upstream);
      assert.ok(sidecar.includes("MoviePlaybackHoldToSkip"));
    }
    await assert.rejects(
      createAnnotations({
        readAsset: (path) => assets.get(path),
        sha1: () => "0".repeat(40),
      }).buildTouchStrings(),
      /TOUCH_STRING_SOURCE/,
    );
  });

  test("controller glyphs implement face swaps, rectangle fallback and Switch fallback", () => {
    const prefix = "data/hd/global/ui/controller/controllerbuttons/",
      names = [
        "ButtonRight.sprite",
        "ButtonBottom.sprite",
        "ButtonTop.sprite",
        "ButtonLeft.sprite",
        "ButtonLeftRectangle.sprite",
        "DPad.sprite",
      ];
    const assets = new Map();
    const rows = [];
    const add = (path) => {
      assets.set(path.toLowerCase(), enc.encode(path));
      const row = Array(11).fill("");
      row[9] = "asset:" + path;
      rows.push(row);
    };
    for (const name of names)
      for (const platform of ["switch", "xbox"]) add(prefix + platform + "/" + name);
    for (const name of names.slice(0, 4)) add(prefix + "ps5/" + name);
    const out = controllerGlyphs(rows, (path) => {
      const bytes = assets.get(path.toLowerCase());
      assert.ok(bytes, path);
      return bytes;
    });
    const dest = "data/hd/global/ui/ztouch_controller_buttons_ui/";
    for (const [name, source] of [
      ["switchxbuttonright.sprite", "xbox/ButtonBottom.sprite"],
      ["switchxbuttonbottom.sprite", "xbox/ButtonRight.sprite"],
      ["switchxbuttontop.sprite", "xbox/ButtonTop.sprite"],
      ["switchpbuttonright.sprite", "ps5/ButtonBottom.sprite"],
      ["switchpbuttontop.sprite", "ps5/ButtonLeft.sprite"],
      ["switchpbuttonleftrectangle.sprite", "ps5/ButtonLeft.sprite"],
      ["switchpdpad.sprite", "switch/DPad.sprite"],
    ])
      assert.equal(dec.decode(out.get(dest + name)), prefix + source);
    assert.equal(out.size, names.length * 2);
    const releaseGlyphs = controllerGlyphs(rows, (path) => assets.get(path.toLowerCase()), {
      playstation: false,
    });
    assert.equal(releaseGlyphs.size, names.length);
    assert.ok([...releaseGlyphs.keys()].every((name) => name.startsWith(dest + "switchx")));
  });

  function overlayFiles() {
    return {
      "data/a.data": enc.encode("archive"),
      "data/.build.config": enc.encode("config\r\n"),
      ctrl_touch: enc.encode("marker\n"),
      "touch_strings.tsv": enc.encode("text\n"),
      ps_glyphs: new Uint8Array(),
      "pack.json": enc.encode('{"pack":1}\n'),
    };
  }
  test("manifest uses exact payload bytes, portable sorted paths and all sidecars", async () => {
    const files = overlayFiles();
    const expected =
      `DM_OVERLAY_V1 ${OVERLAY_SOURCE_FINGERPRINT}\n` +
      Object.keys(files)
        .sort()
        .map((path) => `${sha256(files[path])} ${path}\n`)
        .join("");
    assert.equal(dec.decode(await createOverlayManifest(files)), expected);
    assert.notEqual(sha256(files["data/.build.config"]), sha256(enc.encode("config\n")));
    assert.equal(
      dec.decode(await createOverlayManifest(Object.fromEntries(Object.entries(files).reverse()))),
      expected,
    );
  });
  test("manifest rejects incomplete, ambiguous, unsafe and cancelled payloads", async () => {
    for (const name of ["ctrl_touch", "touch_strings.tsv", "data/.build.config", "data/a.data"]) {
      const files = overlayFiles();
      delete files[name];
      await assert.rejects(createOverlayManifest(files), /REQUIRED/);
      files[name] = new Uint8Array();
      await assert.rejects(createOverlayManifest(files), /EMPTY/);
    }
    for (const name of [
      "../outside",
      "data/CON.bin",
      "data/x.",
      "data/é",
      "CTRL_TOUCH",
      "ctrl_touch/nested",
      "overlay.manifest",
    ])
      await assert.rejects(
        createOverlayManifest({ ...overlayFiles(), [name]: enc.encode("bad") }),
        /PATH/,
      );
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await assert.rejects(
      createOverlayManifest(overlayFiles(), { signal: controller.signal }),
      /cancelled/,
    );
  });
}

// upstream-v2-art-contract
{
  // 只覆盖惰性合成约定，不使用原生代码、WASM、浏览器、字体或私有输入。
  // Inert synthetic contract coverage only. No native, WASM, browser, font or private input.
  const { default: test } = nodeTestModule;
  const { default: assert } = strictModule;
  const { readFileSync } = nodeFsModule;
  const { createHash } = nodeCryptoModule;
  const { generateNativeArt } = nativeArtModule;
  const { createNativeArtCases, nativeHashDependencies } = nativeCasesModule;
  const { vitalCharacters } = supportModule;

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
}
