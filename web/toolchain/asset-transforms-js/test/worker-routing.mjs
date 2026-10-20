// 原生产/开发 worker 的分派检查；Python 哨兵在被访问时抛错。 | Actual worker dispatch checks with a throwing Python sentinel.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import * as transforms from "../transforms.mjs";
const payload = new TextEncoder().encode(
  JSON.stringify(["data/global/ui/layouts/controller/hud.json"]),
);
const expected = await transforms.executeAssetTransform("overlay-paths", payload);
for (const [relative, production] of [
  ["../../offline-runtime-spike/pyodide-worker.mjs", true],
  ["../../asset-generation-spike/public/worker.mjs", false],
]) {
  let source = await readFile(new URL(relative, import.meta.url), "utf8");
  if (!production) {
    const imports = source.match(/^import .*;$/gm);
    assert.equal(imports.length, 3);
    source = source
      .replace(/^import .*;\n/gm, "")
      .replaceAll("import.meta.url", JSON.stringify(new URL(relative, import.meta.url).href));
  }
  const messages = [];
  const noPython = () => {
    throw new Error("Unexpected Python access for a JavaScript operation");
  };
  const context = vm.createContext({
    ArrayBuffer,
    Uint8Array,
    crypto,
    TextEncoder,
    TextDecoder,
    JSON,
    hasAssetTransform: transforms.hasAssetTransform,
    executeAssetTransform: transforms.executeAssetTransform,
    loadPyodide: noPython,
    _transforms: transforms,
    _noPython: noPython,
    self: { postMessage: (message, transfers) => messages.push({ message, transfers }) },
  });
  vm.runInContext(source, context, { timeout: 1000 });
  if (production)
    vm.runInContext(
      "initialized = true; transforms = _transforms; py = { globals: { set: _noPython }, runPython: _noPython };",
      context,
    );
  context.self.onmessage({
    data: { id: 1, operation: "overlay-paths", payload: payload.slice().buffer, options: {} },
  });
  await vm.runInContext("queue", context);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.ok, true, messages[0].message.error);
  const result = messages[0].message.result.files["overlay-paths.json"];
  assert.deepEqual(new Uint8Array(result), expected.files["overlay-paths.json"]);
  assert.equal(messages[0].transfers[0], result);
  context.self.onmessage({
    data: {
      id: 2,
      operation: "overlay-paths",
      payload: new TextEncoder().encode('["data/../bad"]').buffer,
      options: {},
    },
  });
  await vm.runInContext("queue", context);
  assert.equal(messages[1].message.ok, false);
}
console.log(
  "Production and developer workers route pure transforms without Python, retain transferable outputs, and reject malformed paths.",
);
