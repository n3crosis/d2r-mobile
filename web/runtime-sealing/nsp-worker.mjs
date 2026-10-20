import factory from "../toolchain/nsp-extract-spike/dist/hactool-boundary.mjs";
import { byteFactory, initializationWasm } from "./wasm-factory.mjs";
import { createBoundary } from "../toolchain/nsp-extract-spike/browser-boundary.mjs";
import { createExtractionEngine } from "../toolchain/nsp-extract-spike/extraction-engine.mjs";
// No caller-supplied module URLs, source code, native names or filesystem paths.
let ready;
let initializing = false;
let initialized = false;
let busy = false,
  closed = false,
  lastId = 0;
const reject = (id) => self.postMessage({ id, ok: false, error: "EXTRACTION_FAILED" });
self.onmessage = async ({ data }) => {
  if (data?.type === "initialize") {
    if (
      initializing ||
      initialized ||
      closed ||
      data.id !== 0 ||
      Object.keys(data).some((key) => !["id", "type", "assets"].includes(key))
    ) {
      self.postMessage({ id: 0, ok: false, error: "SEALED_INITIALIZATION_FAILED" });
      return;
    }
    initializing = true;
    try {
      ready = createBoundary(
        byteFactory(factory, initializationWasm(data.assets, "hactool-boundary.wasm")),
      ).then(createExtractionEngine);
      await ready;
      initialized = true;
      self.postMessage({ id: 0, ok: true, result: { initialized: true } });
    } catch {
      closed = true;
      self.postMessage({ id: 0, ok: false, error: "SEALED_INITIALIZATION_FAILED" });
      self.close();
    }
    return;
  }
  const id = data?.id;
  if (!initialized) {
    reject(Number.isSafeInteger(id) ? id : 0);
    return;
  }
  if (
    closed ||
    busy ||
    !Number.isSafeInteger(id) ||
    id <= lastId ||
    !data ||
    Object.keys(data).some((key) => !["id", "operation", "payload"].includes(key)) ||
    typeof data.operation !== "string"
  ) {
    reject(Number.isSafeInteger(id) ? id : 0);
    return;
  }
  busy = true;
  lastId = id;
  try {
    const engine = await ready;
    const result = await engine.execute(data.operation, data.payload);
    if (result instanceof Uint8Array) self.postMessage({ id, ok: true, result }, [result.buffer]);
    else self.postMessage({ id, ok: true, result });
    if (data.operation === "dispose") {
      closed = true;
      self.close();
    }
  } catch {
    // An error is terminal. Never serialize parser/native text or key-bearing state.
    try {
      await (await ready).execute("dispose");
    } catch {
      /* terminate regardless */
    }
    reject(id);
    closed = true;
    self.close();
  } finally {
    busy = false;
  }
};
