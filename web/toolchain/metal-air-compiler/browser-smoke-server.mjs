// 本地开发服务器只暴露明确列出的编译器和自编测试资产，不读取游戏文件。
// Local developer server exposes only explicitly listed compiler and authored test assets, never game files.
import { createServer } from "node:http";
import process from "node:process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { readAirHeaderIdentity } from "./header-identity.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
if (
  ![2, 4].includes(args.length) ||
  args[0] !== "--build" ||
  (args.length === 4 && args[2] !== "--api-source")
)
  throw new Error(
    "Usage: node browser-smoke-server.mjs --build /path/to/API-WASM-build [--api-source /path/to/matching/API-source]",
  );
const build = resolve(args[1]);
const apiSource = args[3] ? resolve(args[3]) : resolve(here, "api");
const routes = new Map();
async function add(url, path, type) {
  const data = await readFile(path);
  routes.set(url, { data, type });
  return data;
}
const factory = await add("/compiler.mjs", resolve(build, "d2r_air_wasm.mjs"), "text/javascript");
const wasm = await add("/compiler.wasm", resolve(build, "d2r_air_wasm.wasm"), "application/wasm");
const hash = (data) => createHash("sha256").update(data).digest("hex");
const apiHeader = await readFile(resolve(apiSource, "air_compiler.h"), "utf8");
const apiVersion = apiHeader.includes("air_compiler_header_bundle_version(") ? 2 : 1;
const headerSha256 = await readAirHeaderIdentity(apiSource, apiVersion);
routes.set("/manifest.json", {
  type: "application/json",
  data: JSON.stringify({
    factorySha256: hash(factory),
    wasmSha256: hash(wasm),
    headerSha256,
    apiVersion,
  }),
});
for (const name of ["browser-smoke-worker.mjs", "browser-smoke-client.mjs"])
  await add(`/web/toolchain/metal-air-compiler/${name}`, resolve(here, name), "text/javascript");
for (const name of [
  "air-compiler-adapter.mjs",
  "air-compiler-contract.mjs",
  "shader-diagnostics.mjs",
  "compiled-shader-boundary.mjs",
])
  await add(`/web/${name}`, resolve(here, "../..", name), "text/javascript");
for (const name of ["compute", "vertex", "fragment"])
  await add(`/fixture-${name}.metal`, resolve(here, `fixtures/msl-${name}.metal`), "text/plain");
routes.set("/", {
  type: "text/html",
  data:
    '<!doctype html><meta charset="utf-8"><title>AIR compiler browser smoke</title>' +
    '<button id="cancel">Cancel</button><pre id="status">Loading compiler files…</pre>' +
    '<script type="module" src="/web/toolchain/metal-air-compiler/browser-smoke-client.mjs"></script>',
});
const server = createServer((request, response) => {
  const route = routes.get(request.url);
  if (request.method !== "GET" || !route) {
    response.writeHead(404).end();
    return;
  }
  response.writeHead(200, {
    "Content-Type": route.type,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  response.end(route.data);
});
server.listen(0, "127.0.0.1", () => {
  console.log(`Open http://127.0.0.1:${server.address().port}/ in desktop Chromium.`);
  console.log("Developer smoke only; no full-game or Apple runtime acceptance claim.");
});
