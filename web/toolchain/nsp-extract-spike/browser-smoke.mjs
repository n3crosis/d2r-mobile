import assert from "node:assert/strict";
import process from "node:process";
import http from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
const root = path.dirname(fileURLToPath(import.meta.url));
const { chromium } = await import(pathToFileURL(process.env.PLAYWRIGHT_ENTRY).href);
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, "http://localhost").pathname;
  if (pathname === "/favicon.ico") {
    res.writeHead(204);
    res.end();
    return;
  }
  if (pathname === "/") {
    res.setHeader("Content-Type", "text/html");
    res.end("<!doctype html><title>Synthetic WASM smoke</title>");
    return;
  }
  const target = path.resolve(root, `.${pathname}`);
  if (!target.startsWith(root + path.sep)) {
    res.writeHead(403);
    res.end();
    return;
  }
  try {
    res.setHeader(
      "Content-Type",
      target.endsWith(".wasm") ? "application/wasm" : "text/javascript",
    );
    res.end(await readFile(target));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const diagnostics = [];
  page.on("console", () => diagnostics.push("console output"));
  page.on("pageerror", () => diagnostics.push("page error"));
  const external = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(`http://127.0.0.1:${server.address().port}/`))
      external.push("unexpected request");
  });
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const worker = new Worker("/smoke-worker.mjs", { type: "module" });
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error("Smoke timed out"));
        }, 60000);
        worker.onmessage = ({ data }) => {
          clearTimeout(timer);
          worker.terminate();
          resolve(data);
        };
        worker.onerror = () => {
          clearTimeout(timer);
          worker.terminate();
          reject(new Error("Worker failed"));
        };
      }),
  );
  assert.equal(result.ok, true, "Synthetic browser WASM smoke must pass");
  assert.deepEqual(external, [], "No external traffic");
  assert.deepEqual(diagnostics, [], "No native or runtime diagnostic output");
  console.log(JSON.stringify({ ok: true, checks: result.checks }));
} finally {
  if (browser) await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
