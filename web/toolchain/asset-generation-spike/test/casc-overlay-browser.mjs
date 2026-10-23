/* global window */
/**
 * 真实 Pyodide 工作线程、惰性 JS 读取器及独立原生参考实现。
 * Actual Pyodide Worker + lazy JS reader + independent original-native oracle. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";
const fixture = JSON.parse(
  execFileSync("python3", ["test/casc-overlay-oracle.py"], { maxBuffer: 4 * 1024 * 1024 }),
);
const webRoot = resolve("../..");
const mime = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".json": "application/json",
  ".py": "text/plain",
};
const server = createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (url.pathname === "/") {
    res
      .writeHead(200, { "Content-Type": "text/html" })
      .end("<!doctype html><title>CASC synthetic oracle</title>");
    return;
  }
  const file = resolve(webRoot, "." + decodeURIComponent(url.pathname));
  if (!file.startsWith(webRoot + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
    res.end(await readFile(file));
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const blocked = [],
  errors = [];
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      blocked.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(origin);
  const actual = await page.evaluate(async (fixture) => {
    const { writeCascOverlay } = await import("/casc-overlay-writer.mjs");
    const { AssetWorker } = await import("/toolchain/asset-generation-spike/public/client.mjs");
    const decode = (s) => Uint8Array.from(window.atob(s), (c) => c.charCodeAt(0));
    const reads = [];
    const files = Object.entries(fixture.files).map(([path, base64]) => {
      const bytes = decode(base64);
      return {
        path,
        size: BigInt(bytes.length),
        async readAt(start, count) {
          reads.push({ path, start: String(start), count });
          return bytes.slice(Number(start), Number(start) + count);
        },
      };
    });
    const worker = new AssetWorker();
    try {
      const result = await writeCascOverlay({
        romfs: { files, getFile: (path) => files.find((f) => f.path === path) },
        replacements: fixture.replacements.map((j) => ({ ...j, bytes: decode(j.bytes) })),
        worker,
      });
      return {
        files: Object.fromEntries(
          Object.entries(result.files).map(([path, bytes]) => [path, Array.from(bytes)]),
        ),
        inventory: result.inventory,
        reads,
      };
    } finally {
      worker.close();
    }
  }, fixture);
  for (const [path, expected] of Object.entries(fixture.expected))
    assert.deepEqual(Buffer.from(actual.files[path]), Buffer.from(expected, "base64"), path);
  assert.deepEqual(actual.inventory, fixture.inventory);
  assert.deepEqual(blocked, []);
  assert.deepEqual(errors, []);
  await mkdir("test-results", { recursive: true });
  await writeFile(
    "test-results/casc-overlay-browser.json",
    JSON.stringify(
      {
        browser: browser.version(),
        byteParity: true,
        outputs: Object.keys(actual.files),
        replacementModes: ["n", "z", "BLTE multi-block"],
        addition: true,
        readCount: actual.reads.length,
        externalRequests: blocked,
      },
      null,
      2,
    ),
  );
  console.log("CASC overlay: actual browser bytes equal independent original native output");
} finally {
  await browser.close();
  await new Promise((r) => server.close(r));
}
