import { Buffer } from "node:buffer";
import assert from "node:assert/strict";
import http from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import process from "node:process";
const root = fileURLToPath(new URL("./pyodide-dist/", import.meta.url));
const publicManifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
const runtimeNames = publicManifest.assets.map((asset) => asset.path);
assert.ok(
  runtimeNames.every((name) => /^[a-zA-Z0-9][a-zA-Z0-9_.+-]*$/.test(name)),
  "Prepared runtime names must be flat safe filenames",
);
const publicNames = new Set(["index.html", "bootstrap.mjs", "manifest.json", ...runtimeNames]);
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_ENTRY).href);
let sealed = false;
let mode = "valid";
const receipts = [];
const servers = [];
function makeServer(assets) {
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, "http://localhost").pathname;
    receipts.push({ pathname, sealed, assets });
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "no-store");
    if (pathname.startsWith("/probe/")) {
      res.setHeader("Content-Type", "text/javascript");
      res.end("export default true;");
      return;
    }
    if (pathname === "/control") {
      res.setHeader("Content-Type", "text/html");
      res.end("<!doctype html><title>Positive network control</title>");
      return;
    }
    if (!assets) {
      res.writeHead(404);
      res.end();
      return;
    }
    const name = pathname === "/" ? "index.html" : pathname.slice(1);
    if (!publicNames.has(name)) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (mode === "redirect" && name === "manifest.json") {
      res.writeHead(302, { Location: "/probe/redirect" });
      res.end();
      return;
    }
    if (mode === "missing" && name === "pyodide.asm.wasm") {
      res.writeHead(404);
      res.end();
      return;
    }
    try {
      let bytes = await readFile(path.join(root, name));
      if (mode === "manifest" && name === "manifest.json") bytes = Buffer.from("{}");
      if (mode === "corrupt" && name === "worker.mjs") {
        bytes = Buffer.from(bytes);
        bytes[bytes.length - 1] ^= 1;
      }
      if (mode === "oversized" && name === "pyodide.asm.wasm")
        bytes = Buffer.concat([bytes, Buffer.alloc(1)]);
      res.setHeader(
        "Content-Type",
        name.endsWith(".html")
          ? "text/html"
          : name.endsWith(".wasm")
            ? "application/wasm"
            : name.endsWith(".json")
              ? "application/json"
              : "text/javascript",
      );
      res.end(bytes);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  servers.push(server);
  return server;
}
const originServer = makeServer(true);
const foreignServer = makeServer(false);
let browser;
try {
  for (const server of servers)
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${originServer.address().port}`;
  const foreign = `http://127.0.0.1:${foreignServer.address().port}`;
  const probes = [`${origin}/probe/same`, `${foreign}/probe/cross`];
  browser = await chromium.launch({
    headless: true,
    ...(process.env.CHROMIUM_EXECUTABLE ? { executablePath: process.env.CHROMIUM_EXECUTABLE } : {}),
  });
  const context = await browser.newContext({ serviceWorkers: "block" });
  // No routing/interception is installed. Prove both sentinels are reachable first.
  const control = await context.newPage();
  await control.goto(`${origin}/control`);
  assert.deepEqual(
    await control.evaluate(
      async (urls) => Promise.all(urls.map(async (url) => (await fetch(url)).ok)),
      probes,
    ),
    [true, true],
  );
  await control.close();
  const results = [];
  for (const scenario of ["manifest", "corrupt", "oversized", "missing", "redirect", "valid"]) {
    mode = scenario;
    sealed = false;
    receipts.length = 0;
    const page = await context.newPage();
    let workers = 0;
    page.on("worker", () => workers++);
    await page.exposeFunction("offlineProofSealed", () => {
      sealed = true;
    });
    await page.goto(origin);
    await page.waitForFunction(() => typeof globalThis.startOfflinePyodide === "function");
    const outcome = await page.evaluate(async (urls) => {
      try {
        globalThis.pyProof = await globalThis.startOfflinePyodide(urls);
        return { result: globalThis.pyProof.stats };
      } catch (error) {
        return { error: error.message };
      }
    }, probes);
    if (scenario !== "valid") {
      assert.ok(outcome.error, `${scenario} must fail closed`);
      assert.equal(sealed, false, `${scenario} must fail before sealing`);
      assert.equal(workers, 0, `${scenario} must not execute any runtime Worker`);
      assert.equal(
        receipts.some((entry) => entry.pathname.startsWith("/probe/")),
        false,
      );
    } else {
      assert.equal(outcome.result?.initialized, true, outcome.error);
      assert.equal(outcome.result.version, "0.27.7");
      assert.deepEqual(outcome.result.packages, { numpy: true, pillow: true });
      assert.equal(outcome.result.reads, 5);
      assert.equal(outcome.result.blocked, 8);
      assert.equal(outcome.result.documentBlocked, 4);
      assert.equal(outcome.result.transferred, true);
      assert.equal(workers, 1);
      const reference = new URL(
        "../asset-generation-spike/test-results/reference/",
        import.meta.url,
      );
      async function run(operation, bytes, options = {}) {
        return page.evaluate(
          async ({ operation, input, options }) => {
            try {
              const result = await globalThis.pyProof.run(
                operation,
                new Uint8Array(input),
                options,
              );
              return {
                ok: true,
                files: Object.fromEntries(
                  Object.entries(result.files).map(([name, buffer]) => [
                    name,
                    Array.from(new Uint8Array(buffer)),
                  ]),
                ),
              };
            } catch {
              return { ok: false };
            }
          },
          { operation, input: [...bytes], options },
        );
      }
      for (const [operation, inputName, options, names] of [
        ["image-default-frame", "input.sprite", { frame: 1 }, ["frame.rgba", "frame.sprite"]],
        ["experience-table", "experience.tsv", {}, ["dm_hud_exp.h"]],
        ["overlay-paths", "paths.json", {}, ["overlay-paths.json"]],
      ]) {
        const actual = await run(operation, await readFile(new URL(inputName, reference)), options);
        assert.equal(actual.ok, true, operation);
        for (const name of names)
          assert.deepEqual(
            Buffer.from(actual.files[name]),
            await readFile(new URL(name, reference)),
            `Sealed exact native parity: ${name}`,
          );
      }
      assert.equal((await run("image-default-frame", new Uint8Array(39))).ok, false);
      assert.equal((await run("casc-pack", new Uint8Array())).ok, false);
      assert.equal(
        (
          await run("image-default-frame", await readFile(new URL("input.sprite", reference)), {
            frame: 1,
          })
        ).ok,
        true,
      );
      await page.waitForTimeout(250);
      assert.deepEqual(
        receipts.filter((entry) => entry.sealed),
        [],
        "No HTTP receipt after seal, including package loading and conversions",
      );
      const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
      assert.deepEqual(
        receipts.map((entry) => entry.pathname).sort(),
        [
          "/",
          "/bootstrap.mjs",
          "/manifest.json",
          ...manifest.assets.map((asset) => `/${asset.path}`),
        ].sort(),
        "Exact public preload closure",
      );
      await page.evaluate(() => globalThis.pyProof.close());
    }
    results.push({ scenario, passed: true, workers });
    await page.close();
  }
  console.log(JSON.stringify({ ok: true, browser: browser.version(), results }));
} finally {
  if (browser) await browser.close();
  for (const server of servers)
    if (server.listening) await new Promise((resolve) => server.close(resolve));
}
