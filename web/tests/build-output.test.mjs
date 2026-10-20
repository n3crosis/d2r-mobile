import test from "node:test";
import assert from "node:assert/strict";
import { productionCsp, validateStaticBuild } from "../scripts/build-policy.mjs";
import { assetPath } from "../scripts/serve.mjs";

const html = `<meta http-equiv="Content-Security-Policy" content="${productionCsp}"><link href="./app.css" rel="stylesheet"><script src="./app.js" type="module"></script>`;
const assets = new Map([
  ["app.js", "document.title = 'local';"],
  ["app.css", "body{color:black}"],
]);

test("static build accepts compiled browser assets and strict offline CSP", () => {
  assert.doesNotThrow(() => validateStaticBuild(html, assets));
});

test("static build rejects missing, remote, inline, runtime and uncompiled assets", () => {
  for (const invalid of [
    html.replace("connect-src 'none'", "connect-src *"),
    html.replace("./app.js", "https://example.com/app.js"),
    html + "<script>fetch('/')</script>",
    html + "<style>body{}</style>",
    html.replace("./app.css", "./missing.css"),
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
