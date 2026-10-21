// 合成文本检查避免字符数组扩张，同时保留 Unicode 行为；不使用游戏输入。
// Synthetic text checks avoid character-array expansion while preserving Unicode behavior; no game inputs.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { logical } from "../toolchain/overlay-recipe-js/recipe.mjs";
import { vaultTab } from "../toolchain/overlay-recipe-js/inventory.mjs";
import { createAnnotations } from "../toolchain/overlay-recipe-js/annotations.mjs";
import { inventoryFixtures } from "../toolchain/overlay-recipe-js/test/inventory-parity.mjs";
import { buildAnnotationFixture } from "../toolchain/overlay-recipe-js/test/annotations-parity.mjs";
import { createCascOverlayTransform } from "../toolchain/casc-overlay-js/overlay.mjs";
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
    assert.ok(typeof value !== "string" || value.length < 5000, "must not expand the large config");
    return original.call(this, value, ...args);
  };
  try {
    const result = await generate(input, request.options);
    assert.ok(decoder.decode(result.files["data/.build.config"]).includes(comment));
  } finally {
    Array.from = original;
  }
});
