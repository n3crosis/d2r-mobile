import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { chromium } from 'playwright';
const publicRoot = resolve('public');
const reference = resolve('test-results/reference');
const output = resolve('test-results/browser');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.wasm': 'application/wasm', '.json': 'application/json', '.py': 'text/plain' };
const server = createServer(async (req, res) => {
  const name = new URL(req.url, 'http://localhost').pathname;
  const file = resolve(publicRoot, '.' + (name === '/' ? '/index.html' : decodeURIComponent(name)));
  if (!file.startsWith(publicRoot + sep)) { res.writeHead(403).end(); return; }
  try {
    res.writeHead(200, { 'Content-Type': mime[extname(file)] ?? 'application/octet-stream' });
    res.end(await readFile(file));
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ headless: true });
const errors = [], blocked = [];
try {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  await context.route('**/*', route => {
    if (new URL(route.request().url()).origin !== origin) {
      blocked.push(route.request().url());
      return route.abort();
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  await page.goto(origin);
  await page.evaluate(async () => {
    const { AssetWorker } = await import('./client.mjs');
    window.asset = new AssetWorker();
  });
  async function run(operation, bytes, options = {}) {
    return page.evaluate(async ({ operation, input, options }) => {
      try {
        const result = await window.asset.run(operation, new Uint8Array(input), options);
        result.files = Object.fromEntries(Object.entries(result.files).map(([name, buffer]) => [name, Array.from(new Uint8Array(buffer))]));
        return { ok: true, result };
      } catch (e) { return { ok: false, error: e.message }; }
    }, { operation, input: Array.from(bytes), options });
  }
  const sprite = await readFile(`${reference}/input.sprite`);
  const cases = [
    ['image-default-frame', sprite, { frame: 1 }, ['frame.rgba', 'frame.sprite']],
    ['experience-table', await readFile(`${reference}/experience.tsv`), {}, ['dm_hud_exp.h']],
    ['overlay-paths', await readFile(`${reference}/paths.json`), {}, ['overlay-paths.json']],
  ];
  const report = { browser: browser.version(), cases: [], externalRequests: blocked };
  const results = await Promise.all(cases.map(c => run(c[0], c[1], c[2])));
  for (let i = 0; i < cases.length; i++) {
    const [operation, , , names] = cases[i];
    const actual = results[i];
    assert.equal(actual.ok, true, actual.error);
    for (const [name, bytes] of Object.entries(actual.result.files)) await writeFile(`${output}/${name}`, Buffer.from(bytes));
    for (const name of names) assert.deepEqual(Buffer.from(actual.result.files[name]), await readFile(`${reference}/${name}`), `${operation}: exact byte parity ${name}`);
    report.cases.push({ operation, exactParity: names, versions: actual.result.versions });
  }
  const v61 = Buffer.from(sprite); v61.writeUInt16LE(61, 4);
  const oversized = Buffer.from(sprite); oversized.writeUInt32LE(0xffffffff, 8);
  const negatives = [
    ['image-default-frame', v61, {}, 'UNSUPPORTED_V61'],
    ['image-default-frame', sprite.subarray(0, 39), {}, 'header'],
    ['image-default-frame', sprite.subarray(0, sprite.length - 1), {}, 'Truncated'],
    ['image-default-frame', oversized, {}, 'dimensions'],
    ['image-default-frame', sprite, { frame: -1 }, 'Frame index'],
    ['experience-table', Buffer.from('Level\tAmazon\n0\t0\n'), {}, ''],
    ['overlay-paths', Buffer.from('["data/../escape"]'), {}, 'Unsafe'],
    ['casc-pack', Buffer.alloc(0), {}, 'not implemented'],
  ];
  for (const [operation, bytes, options, message] of negatives) {
    const actual = await run(operation, bytes, options);
    assert.equal(actual.ok, false, `Must fail closed: ${operation}`);
    assert.ok(actual.error.includes(message), actual.error);
    report.cases.push({ operation, rejected: true });
  }
  assert.equal((await run('image-default-frame', sprite, { frame: 1 })).ok, true, 'Worker recovers after rejected inputs');
  assert.deepEqual(errors, []);
  assert.deepEqual(blocked, [], 'Browser must never request external resources');
  await page.evaluate(() => window.asset.close());
  await writeFile('test-results/report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await new Promise(r => server.close(r));
}
