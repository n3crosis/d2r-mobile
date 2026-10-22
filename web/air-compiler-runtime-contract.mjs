// 新运行时必须携带真实编译器闭包；旧清单仍可读取，但没有编译服务。
// New runtimes carry a real compiler closure; legacy inventories remain readable without a compiler service.
export const AIR_COMPILER_RUNTIME = Object.freeze({
  version: 1,
  id: "d2r-floor-metal-air-v2",
  apiVersion: 2,
  headerBundleVersion: 2,
  entry: "sealed-workers/air-compiler-worker.mjs",
  factory: "toolchain/metal-air-compiler/dist/d2r_air_wasm.mjs",
  wasm: "toolchain/metal-air-compiler/dist/d2r_air_wasm.wasm",
  receipt: "toolchain/metal-air-compiler/dist/build-report.json",
});
export const AIR_COMPILER_OUTPUT_NAMES = Object.freeze(["d2r_air_wasm.mjs", "d2r_air_wasm.wasm"]);
const sha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const boundedFile = (value) =>
  Number.isSafeInteger(value?.bytes) &&
  value.bytes > 0 &&
  value.bytes <= 64 * 1024 * 1024 &&
  sha256(value.sha256);

export function validateAirCompilerBuildReceipt(report) {
  if (
    report?.version !== 1 ||
    report.id !== AIR_COMPILER_RUNTIME.id ||
    report.apiVersion !== 2 ||
    report.headerBundleVersion !== 2 ||
    report.emscripten !== "4.0.20" ||
    !sha256(report.headerSha256) ||
    !sha256(report.sourceFingerprintSha256) ||
    !sha256(report.sourceManifestSha256) ||
    !/^[a-f0-9]{40}$/.test(report.sourceCommit ?? "") ||
    !report.sourceInputs ||
    Object.keys(report.sourceInputs).length > 128 ||
    !Object.keys(report.sourceInputs).length ||
    Object.entries(report.sourceInputs).some(
      ([name, digest]) =>
        (name !== "toolchain.mjs" && !/^(?:api|patches)\/[A-Za-z0-9_.+/-]+$/.test(name)) ||
        name.split("/").some((part) => !part || part === "." || part === "..") ||
        !sha256(digest),
    ) ||
    !report.files ||
    Object.keys(report.files).length !== AIR_COMPILER_OUTPUT_NAMES.length ||
    AIR_COMPILER_OUTPUT_NAMES.some((name) => !boundedFile(report.files[name]))
  )
    throw new Error("Invalid AIR compiler build receipt");
  return report;
}

export function airCompilerRuntimeComponent(report) {
  validateAirCompilerBuildReceipt(report);
  return Object.freeze({
    ...AIR_COMPILER_RUNTIME,
    sealedEntry: AIR_COMPILER_RUNTIME.entry,
    sealedJobAdapter: true,
    headerSha256: report.headerSha256,
    sourceFingerprintSha256: report.sourceFingerprintSha256,
    factorySha256: report.files["d2r_air_wasm.mjs"].sha256,
    wasmSha256: report.files["d2r_air_wasm.wasm"].sha256,
  });
}

export function validateAirCompilerRuntimeComponent(manifest, { required = false } = {}) {
  const component = manifest?.components?.airCompiler;
  const records = new Map((manifest?.assets ?? []).map((asset) => [asset.path, asset]));
  const paths = ["entry", "factory", "wasm", "receipt"];
  if (component === undefined) {
    if (required || paths.some((name) => records.has(AIR_COMPILER_RUNTIME[name])))
      throw new Error("Verified AIR compiler component is missing; rebuild the public runtime");
    return undefined;
  }
  if (
    Object.entries(AIR_COMPILER_RUNTIME).some(([key, value]) => component[key] !== value) ||
    component.sealedEntry !== AIR_COMPILER_RUNTIME.entry ||
    component.sealedJobAdapter !== true ||
    !sha256(component.headerSha256) ||
    !sha256(component.sourceFingerprintSha256) ||
    !sha256(component.factorySha256) ||
    !sha256(component.wasmSha256) ||
    paths.some((name) => !records.has(component[name])) ||
    records.get(component.factory).sha256 !== component.factorySha256 ||
    records.get(component.wasm).sha256 !== component.wasmSha256
  )
    throw new Error("Invalid verified AIR compiler component");
  return component;
}

export function assertAirCompilerReceiptMatchesComponent(report, component) {
  const expected = airCompilerRuntimeComponent(report);
  if (!component || Object.entries(expected).some(([key, value]) => component[key] !== value))
    throw new Error("AIR compiler component does not match its authenticated build receipt");
  return report;
}
