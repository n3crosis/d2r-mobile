// 合成公共入口回归：大载荷解码保持字节和严格语法，不测量浏览器内存。
// Synthetic public-entry regressions: large decodes preserve bytes and strict grammar, not browser RAM measurements.
import test from "node:test";
import assert from "node:assert/strict";
import {
  executeAssetTransform,
  VAULT_PATHS,
} from "../toolchain/asset-transforms-js/transforms.mjs";
import { createOverlayRecipe, GENERATED } from "../toolchain/overlay-recipe-js/recipe.mjs";
import { createRemainingArtRecipes } from "../toolchain/remaining-art-js/recipes.mjs";
const encode = (value) => new TextEncoder().encode(JSON.stringify(value));
const encoded = (bytes) => Buffer.from(bytes).toString("base64");
const vaultPayload = (first) =>
  encode({
    manifest: "",
    assets: Object.fromEntries(VAULT_PATHS.map((name, i) => [name, i ? "" : first])),
  });
const remaining = (inspect = () => {}) =>
  createRemainingArtRecipes({
    pixels: Object.fromEntries(
      ["crop", "paste", "flip", "convert", "resizeLanczos"].map((name) => [name, (image) => image]),
    ),
    png: { encodeRgba: () => new Uint8Array([1]) },
    numeric: {
      rgbStats() {},
      stone() {},
      feather() {},
      vaultCover(bytes) {
        inspect(bytes);
        return bytes;
      },
    },
  });
const overlay = (
  decodeRgba = () => {
    throw new Error("DECODED");
  },
) => createOverlayRecipe({ png: { decodeRgba }, md5() {}, sha1() {} });
function noStringIterable(t) {
  const from = Uint8Array.from;
  t.mock.method(Uint8Array, "from", function (value, ...args) {
    assert.notEqual(
      typeof value,
      "string",
      "large binary strings must not expand through an iterable",
    );
    return from.call(this, value, ...args);
  });
}

test("vault public transform decodes a 2 MiB asset without regex stack or string iterable expansion", async (t) => {
  noStringIterable(t);
  const bytes = new Uint8Array(2 * 1024 * 1024).fill(65);
  const digest = crypto.subtle.digest.bind(crypto.subtle);
  let observed = false;
  t.mock.method(crypto.subtle, "digest", (algorithm, value) => {
    assert.deepEqual(value, bytes);
    observed = true;
    return digest(algorithm, value);
  });
  await assert.rejects(
    executeAssetTransform("vault-table", vaultPayload(encoded(bytes))),
    /VAULT_ASSET_LIMIT/,
  );
  assert.equal(
    observed,
    true,
    "first decoded asset reached its byte digest before the empty second asset was rejected",
  );
});

test("overlay public recipe decodes a 16 MiB generated image byte-exactly without string iterable expansion", async (t) => {
  noStringIterable(t);
  const bytes = new Uint8Array(16 * 1024 * 1024);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  let observed = false;
  const recipe = overlay((value) => {
    assert.deepEqual(value, bytes);
    observed = true;
    throw new Error("DECODED");
  });
  const generated = Object.fromEntries(
    GENERATED.map((name) => [name, name === "NativeHUD/v4/base.png" ? encoded(bytes) : "AA=="]),
  );
  await assert.rejects(
    recipe.execute("overlay-recipe", encode({ manifest: "", assets: {}, generated })),
    /DECODED/,
  );
  assert.equal(observed, true);
});

test("remaining-art public recipe decodes multi-MiB RGBA byte-exactly without string iterable expansion", (t) => {
  noStringIterable(t);
  const bytes = new Uint8Array(848 * 1024 * 4);
  for (let i = 0; i < bytes.length; i++) bytes[i] = i % 256;
  let observed = false;
  const recipe = remaining((value) => {
    assert.deepEqual(value, bytes);
    observed = true;
  });
  const result = recipe.execute(
    "remaining-art",
    encode({ image: { width: 848, height: 1024, rgba: encoded(bytes) } }),
    { kind: "vault", name: "VaultBottom" },
  );
  assert.equal(observed, true);
  assert.deepEqual(result.files["image.rgba"], bytes);
});

for (const value of [
  "A",
  "AA",
  "AAA",
  "A===",
  "====",
  "AA=A",
  "=AAA",
  "AAAA=",
  "AAAA===",
  "AA==AA==",
  "AA-_",
  "AA==\n",
  " AA==",
  "AA\t==",
  "AA==\r\n",
  "AA==\u2028",
])
  test(`asset base64 decoders reject malformed padding/alphabet/whitespace ${JSON.stringify(value)}`, async () => {
    await assert.rejects(executeAssetTransform("vault-table", vaultPayload(value)), /VAULT_BASE64/);
    await assert.rejects(
      overlay().execute(
        "overlay-recipe",
        encode({ manifest: "", assets: { "data/a": value }, generated: {} }),
      ),
      /OVERLAY_BASE64/,
    );
    assert.throws(
      () =>
        remaining().execute(
          "remaining-art",
          encode({ image: { width: 1, height: 1, rgba: value } }),
          { kind: "advanced", name: "unused" },
        ),
      /REMAINING_ART_RGBA/,
    );
  });

for (const value of ["", "AA==", "AB==", "AAA=", "AAB=", "AAAA", "AA+/", "AAAAAA=="])
  test(`vault and overlay preserve accepted base64 grammar ${JSON.stringify(value)}`, async () => {
    await assert.rejects(
      executeAssetTransform("vault-table", vaultPayload(value)),
      /VAULT_ASSET_LIMIT/,
    );
    await assert.rejects(
      overlay().execute(
        "overlay-recipe",
        encode({ manifest: "", assets: { "data/a": value }, generated: {} }),
      ),
      /OVERLAY_GENERATED_ART_REQUIRED/,
    );
  });
