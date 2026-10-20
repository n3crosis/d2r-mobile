// 在真实 worker 源码上校验 CASC 分派，不初始化 Python 或编解码器。 | Check CASC dispatch in actual worker source without initializing Python or codecs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
for (const [relative, production] of [
  ["../../offline-runtime-spike/pyodide-worker.mjs", true],
  ["../../asset-generation-spike/public/worker.mjs", false],
]) {
  let source = await readFile(new URL(relative, import.meta.url), "utf8");
  if (!production)
    source = source
      .replace(/^import .*;\n/gm, "")
      .replaceAll("import.meta.url", JSON.stringify(new URL(relative, import.meta.url).href));
  const messages = [],
    input = new Uint8Array([1, 2, 3]),
    options = { parts: [3], jobs: [] };
  let calls = 0;
  const noPython = () => {
    throw new Error("Unexpected Python access");
  };
  const context = vm.createContext({
    ArrayBuffer,
    Uint8Array,
    crypto,
    TextEncoder,
    TextDecoder,
    JSON,
    hasAssetTransform: () => false,
    loadPyodide: noPython,
    _noPython: noPython,
    _casc: async (bytes, receivedOptions) => {
      calls++;
      assert.deepEqual(new Uint8Array(bytes), input);
      assert.equal(receivedOptions, options);
      return { files: { "data/.build.config": new Uint8Array([4, 5]) }, inventory: [] };
    },
    self: { postMessage: (message, transfers) => messages.push({ message, transfers }) },
  });
  vm.runInContext(source, context, { timeout: 1000 });
  vm.runInContext(
    production
      ? "initialized = true; transforms = { hasAssetTransform: () => false }; cascTransform = _casc; py = { globals: { set: _noPython }, runPython: _noPython };"
      : "cascRuntime = Promise.resolve(_casc);",
    context,
  );
  context.self.onmessage({
    data: { id: 1, operation: "casc-overlay", payload: input.buffer, options },
  });
  await vm.runInContext("queue", context);
  assert.equal(calls, 1);
  assert.equal(messages.length, 1);
  assert.equal(messages[0].message.ok, true, messages[0].message.error);
  const file = messages[0].message.result.files["data/.build.config"];
  assert.deepEqual(new Uint8Array(file), new Uint8Array([4, 5]));
  assert.equal(messages[0].transfers[0], file);
}
console.log(
  "Production and developer CASC routes bypass Python and preserve transferable outputs.",
);
