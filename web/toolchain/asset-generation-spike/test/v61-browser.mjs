import assert from "node:assert/strict";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";
import { chromium } from "playwright";
const root = resolve("../..");
const mime = {
  ".html": "text/html",
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
};
const server = createServer(async (req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  if (path === "/") {
    res.writeHead(200, {
      "Content-Type": "text/html",
      "Content-Security-Policy":
        "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'; connect-src 'self'",
    });
    res.end("<!doctype html><title>Synthetic v61 asset bridge</title>");
    return;
  }
  const file = resolve(root, "." + decodeURIComponent(path));
  if (!file.startsWith(root + sep)) {
    res.writeHead(403).end();
    return;
  }
  try {
    const bytes = await readFile(file);
    res.writeHead(200, { "Content-Type": mime[extname(file)] ?? "application/octet-stream" });
    res.end(bytes);
  } catch {
    res.writeHead(404).end();
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch();
const external = [],
  errors = [];
try {
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    if (new URL(route.request().url()).origin !== origin) {
      external.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(origin);
  const input = await readFile("test-results/v61/input.sprite");
  const result = await page.evaluate(async (input) => {
    const { AssetWorker } = await import("/toolchain/asset-generation-spike/public/client.mjs");
    const { createV61AssetWorker } = await import("/v61-asset-worker.mjs");
    const { createAssetGeneratorAdapter } = await import("/asset-generator-adapter.mjs");
    const adapter = createAssetGeneratorAdapter({
      enableV61Png: true,
      createWorker: () => createV61AssetWorker({ assetWorker: new AssetWorker() }),
      recipes: [
        {
          operation: "image-default-frame",
          input: "data/synthetic.sprite",
          frame: 1,
          outputs: { "frame.png": "NativeHUD/synthetic.png" },
        },
      ],
    });
    try {
      const entries = await adapter.generateAssets({
        extracted: { logicalAssets: { read: async () => new Uint8Array(input) } },
      });
      const bytes = [];
      for await (const chunk of entries[0].chunks()) bytes.push(...chunk);
      return { count: entries.length, path: entries[0].path, size: entries[0].size, bytes };
    } finally {
      await adapter.dispose();
    }
  }, Array.from(input));
  const atlas = await readFile("test-results/v61/atlas.sprite");
  const atlasResult = await page.evaluate(async (input) => {
    const { NativeArtTextureClient } = await import("/native-art-texture.mjs");
    const client = new NativeArtTextureClient();
    try {
      const result = await client.decodeAtlas(new Uint8Array(input));
      return { ...result, pixels: Array.from(result.pixels) };
    } finally {
      client.close();
    }
  }, Array.from(atlas));
  assert.equal(atlasResult.width, 136);
  assert.equal(atlasResult.height, 65);
  assert.equal(atlasResult.frameWidth, 65);
  assert.equal(atlasResult.framePitch, 68);
  assert.equal(atlasResult.frameCount, 2);
  assert.deepEqual(Buffer.from(atlasResult.pixels), await readFile("test-results/v61/atlas.rgba"));
  console.log("Whole padded atlas: exact independent native RGBA parity");
  assert.equal(result.count, 1);
  assert.equal(result.path, "NativeHUD/synthetic.png");
  assert.equal(result.size, result.bytes.length);
  assert.deepEqual(external, []);
  assert.deepEqual(errors, []);
  await writeFile("test-results/v61/browser.png", new Uint8Array(result.bytes));
  await writeFile(
    "test-results/v61/browser-report.json",
    JSON.stringify(
      {
        browser: browser.version(),
        entries: result.count,
        source: "native-authored-v61-bc3",
        destination: result.path,
        size: result.size,
        externalRequests: external,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
  await new Promise((resolve) => server.close(resolve));
}
