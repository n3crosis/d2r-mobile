// Development-only Node preflight of the worker-targeted WASM module.
// Worker globals are explicit shims; this is NOT a real Chromium result.
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { gzipSync, brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { pathToFileURL, fileURLToPath } from "node:url";
import process from "node:process";
import { resolve, dirname, join } from "node:path";
import assert from "node:assert/strict";
import { readAirHeaderIdentity } from "./header-identity.mjs";
const args = process.argv.slice(2);
function option(name, fallback) {
  const index = args.indexOf(name);
  if (index < 0) return fallback;
  if (!args[index + 1] || args[index + 1].startsWith("--")) throw Error(`Missing ${name} value`);
  return args[index + 1];
}
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(option("--build", join(here, "work/api-build-wasm")));
const apiSource = resolve(option("--api-source", join(here, "api")));
const apiVersion = Number(option("--api-version", "2"));
assert.ok(apiVersion === 1 || apiVersion === 2, "API version must be 1 or 2");
const outputPath = resolve(option("--output", join(root, "node-preflight-results.json")));
const wasmBytes = readFileSync(`${root}/d2r_air_wasm.wasm`);
const glueBytes = readFileSync(`${root}/d2r_air_wasm.mjs`);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
let networkAttempts = 0;
globalThis.self = globalThis;
globalThis.location = { href: "https://invalid.test/isolated-worker.mjs" };
globalThis.importScripts = () => {
  throw new Error("Unexpected importScripts");
};
globalThis.fetch = () => {
  ++networkAttempts;
  throw new Error("Network forbidden");
};
const factory = (await import(pathToFileURL(`${root}/d2r_air_wasm.mjs`).href)).default;
const compiled = await WebAssembly.compile(wasmBytes);
let instantiations = 0;
const messages = [];
const start = performance.now();
const module = await factory({
  locateFile() {
    throw new Error("Unexpected URL resolution");
  },
  instantiateWasm(imports, receive) {
    ++instantiations;
    const instance = new WebAssembly.Instance(compiled, imports);
    receive(instance, compiled);
    return instance.exports;
  },
  print: (message) => messages.push(String(message)),
  printErr: (message) => messages.push(String(message)),
});
assert.equal(instantiations, 1);
assert.ok(module.HEAPU8 instanceof Uint8Array, "public HEAPU8 is available");
const initialHeap = module.HEAPU8.byteLength;
let compilePeakHeap = initialHeap;
function cString(ptr) {
  const view = module.HEAPU8;
  let end = ptr;
  while (end < view.length && view[end]) ++end;
  assert.ok(end < view.length, "terminated C string");
  return new TextDecoder().decode(view.subarray(ptr, end));
}
const headerSha256 = cString(module._air_compiler_header_sha256());
const expectedHeaderSha = await readAirHeaderIdentity(apiSource, apiVersion);
assert.equal(headerSha256, expectedHeaderSha, "module matches selected source header fingerprint");
function compile(source, kind = 0, profile = 1) {
  const bytes = new TextEncoder().encode(source);
  const ptr = module._malloc(bytes.length || 1);
  assert.ok(ptr);
  let result = 0;
  try {
    module.HEAPU8.set(bytes, ptr);
    result =
      apiVersion === 2
        ? module._air_compile_v2(ptr, bytes.length, 18, kind, profile)
        : module._air_compile_v1(ptr, bytes.length, 18, kind);
    assert.ok(result);
    compilePeakHeap = Math.max(compilePeakHeap, module.HEAPU8.byteLength);
    const status = module._air_result_status(result);
    const size = module._air_result_size(result);
    const out = module._air_result_data(result);
    const output = module.HEAPU8.slice(out, out + size);
    const diagnosticSize = module._air_result_diagnostics_size(result);
    return { status, output, diagnosticSize };
  } finally {
    if (result) module._air_result_free(result);
    module._free(ptr);
  }
}
if (apiVersion === 2) {
  assert.equal(module._air_compiler_header_bundle_version(), 2);
  const mathSource =
    "#include <metal_stdlib>\n#include <simd/simd.h>\nusing namespace metal; kernel void k(device float *o [[buffer(0)]]) {o[0]=sqrt(fma(o[0],o[1],o[2]));}";
  const mathResult = compile(mathSource, 1);
  assert.equal(mathResult.status, 0);
  assert.match(new TextDecoder().decode(mathResult.output), /air\.fast_sqrt\.f32/);
  assert.notEqual(compile(mathSource, 1, 0).status, 0, "conservative rejects unsupported sqrt");
  assert.notEqual(compile(mathSource, 1, 2).status, 0, "unknown profile rejected");
  for (const source of [
    'float bad(float) __asm__("air.fast_sqrt.f32");',
    '#line 1 "/include/metal_math"\nfloat bad(float) __asm__("air.fast_sqrt.f32");',
    "namespace metal { namespace __air_detail { float sqrt(float); } }",
    "namespace metal { namespace __air_detail { float sqrt(float x) {return x;} } }",
    '#define LABEL __asm__("air.fast_sqrt.f32")\nfloat bad(float) LABEL;',
  ])
    assert.notEqual(compile(source).status, 0, "untrusted AIR declaration rejected");
  assert.equal(compile(mathSource).status, 0, "recovery after declaration failures");
}
const sourcePrefix = "#include <metal_stdlib>\nusing namespace metal;\n";
const cases = [
  [
    "compute",
    sourcePrefix +
      "kernel void main0(device int *p [[buffer(2)]]) { p[0] = p[0] > 3 ? p[0] * 7 : p[0] + 2; }",
  ],
  [
    "vertex",
    sourcePrefix +
      "struct O { float4 p [[position]]; }; vertex O main0(constant float4 *p [[buffer(3)]]) { O o; o.p=p[0]; o.p.x*=2.0f; return o; }",
  ],
  [
    "fragment",
    sourcePrefix +
      "struct O { float4 c [[color(0)]]; }; fragment O main0(constant float4 *p [[buffer(5)]]) { O o; o.c=p[0].x>0.25f?p[0]:p[1]; return o; }",
  ],
  [
    "conversion",
    sourcePrefix +
      "kernel void main0(device float *f [[buffer(0)]], device int *i [[buffer(1)]]) { i[0]=(int)f[0]; f[1]=(float)i[1]; }",
  ],
];
const runs = [];
const stableIR = new Map();
for (let round = 0; round < 3; ++round) {
  for (const [name, source] of cases) {
    const began = performance.now();
    const library = compile(source);
    assert.equal(library.status, 0, `${name} compiles`);
    assert.equal(new TextDecoder().decode(library.output.subarray(0, 4)), "MTLB");
    const ir = compile(source, 1);
    assert.equal(ir.status, 0);
    const irText = new TextDecoder().decode(ir.output);
    if (name === "conversion") {
      assert.match(irText, /air\.convert\.s\.i32\.f\.f32/);
      assert.match(irText, /air\.convert\.f\.f32\.s\.i32/);
      assert.doesNotMatch(irText, /\b(?:fptosi|sitofp) /);
    }
    const irHash = hash(ir.output);
    if (stableIR.has(name)) assert.equal(irHash, stableIR.get(name), "repeated AIR is stable");
    else stableIR.set(name, irHash);
    runs.push({
      round,
      name,
      bytes: library.output.length,
      irSha256: irHash,
      elapsedMs: performance.now() - began,
      heapBytes: module.HEAPU8.byteLength,
    });
  }
  assert.notEqual(compile("kernel void broken( {").status, 0);
  assert.notEqual(
    compile(
      '#pragma clang diagnostic ignored "-Weverything"\n' +
        sourcePrefix +
        "[[unknown_msl_attribute]] kernel void main0() {}",
    ).status,
    0,
  );
  assert.equal(compile(cases[0][1]).status, 0, "recovery after failed compilation");
}
const changed = compile(cases[0][1].replace("* 7", "* 11"), 1);
assert.equal(changed.status, 0);
assert.notEqual(hash(changed.output), stableIR.get("compute"), "source changes executable AIR");
const normalCompileMaxRssKiB = process.resourceUsage().maxRSS;
const previousView = module.HEAPU8;
const previousHeapBytes = previousView.byteLength;
const growth = module._malloc(previousHeapBytes + 1);
assert.ok(growth, "controlled growth allocation");
assert.ok(module.HEAPU8.byteLength > previousHeapBytes, "public heap view refreshed after growth");
module.HEAPU8[growth] = 37;
assert.equal(module.HEAPU8[growth], 37);
module._free(growth);
assert.equal(networkAttempts, 0);
const result = {
  scope: "Node WASM preflight with worker globals shimmed; NOT Chromium or Apple validation",
  wasmSha256: hash(wasmBytes),
  glueSha256: hash(glueBytes),
  apiVersion,
  mathProfile: apiVersion === 2 ? 1 : null,
  headerSha256,
  wasmBytes: wasmBytes.length,
  glueBytes: glueBytes.length,
  gzipBytes: gzipSync(wasmBytes).length,
  brotliQuality5Bytes: brotliCompressSync(wasmBytes, {
    params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 5 },
  }).length,
  initialHeap,
  compilePeakHeap,
  forcedGrowthHeap: module.HEAPU8.byteLength,
  normalCompileMaxRssKiB,
  instantiations,
  networkAttempts,
  elapsedMs: performance.now() - start,
  diagnosticMessageCount: messages.length,
  runs,
};
writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result, null, 2));
