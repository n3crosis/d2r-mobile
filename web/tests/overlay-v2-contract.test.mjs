// 仅合成字节和仓库静态数据的 v2 覆盖层测试；不运行原生生成器或 WASM。
// V2 overlay tests use only synthetic bytes and repository static data, never native generators or WASM.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import data from "../toolchain/overlay-recipe-js/annotation-data.json" with { type: "json" };
import legacy from "../toolchain/overlay-recipe-js/legacy-v1-data.json" with { type: "json" };
import {
  legacyI18n,
  legacyTouch,
  legacyCustomPage,
} from "../toolchain/overlay-recipe-js/legacy-v1.mjs";
import release from "../toolchain/overlay-recipe-js/release-v2-data.json" with { type: "json" };
import { releaseI18n } from "../toolchain/overlay-recipe-js/release-v2.mjs";
import { createAnnotations } from "../toolchain/overlay-recipe-js/annotations.mjs";
import { padCustomPage } from "../toolchain/overlay-recipe-js/touch-layout.mjs";
import { controllerGlyphs } from "../toolchain/overlay-recipe-js/recipe.mjs";
import {
  LEGACY_OVERLAY_REVISION,
  RELEASE_OVERLAY_REVISION,
  UPSTREAM_OVERLAY_REVISION,
  requireOverlayRevision,
} from "../toolchain/overlay-recipe-js/revision.mjs";
import { createOverlayManifest, OVERLAY_SOURCE_FINGERPRINT } from "../overlay-contract.mjs";

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
