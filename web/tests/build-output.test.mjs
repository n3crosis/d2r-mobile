// 验证 build-output 的约定与边界；依据 ../scripts/build-policy.mjs、../scripts/serve.mjs 及本文件的测试断言。
// Verify build-output contracts and boundaries against ../scripts/build-policy.mjs、../scripts/serve.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import { validateStaticBuild } from "../scripts/build-policy.mjs";
import { assetPath } from "../scripts/serve.mjs";

const html = `<link href="./app.css" rel="stylesheet"><script src="./app.js" type="module"></script>`;
const assets = new Map([
  ["app.js", "document.title = 'local';"],
  ["app.css", "body{color:black}"],
]);

test("static build accepts compiled local browser assets", () => {
  assert.doesNotThrow(() => validateStaticBuild(html, assets));
});

test("static build rejects missing, remote, runtime and uncompiled assets", () => {
  for (const invalid of [
    html.replace("./app.js", "https://example.com/app.js"),
    html.replace("./app.css", "./missing.css"),
    html.replace("./app.js", "../app.js"),
    '<script src="./app.js" type="module"></script>',
    '<link href="./app.css" rel="stylesheet">',
  ]) {
    assert.throws(() => validateStaticBuild(invalid, assets));
  }
  assert.throws(() =>
    validateStaticBuild(html, new Map([...assets, ["app.js", "Bun.file('secret')"]])),
  );
  assert.throws(() =>
    validateStaticBuild(html, new Map([...assets, ["app.css", "@apply bg-background;"]])),
  );
});

test("preview only resolves visible generated files within dist", () => {
  assert.match(assetPath("/"), /[/\\]dist[/\\]index\.html$/);
  assert.match(assetPath("/app.js"), /[/\\]dist[/\\]app\.js$/);
  for (const path of [
    "/../prod.keys",
    "/%2e%2e/prod.keys",
    "/.env",
    "/a\\..\\prod.keys",
    "/%00",
    "/%zz",
  ]) {
    assert.equal(assetPath(path), null);
  }
});
