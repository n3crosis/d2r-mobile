import factory from "./dist/hactool-boundary.mjs";
import { createBoundary } from "./browser-boundary.mjs";
import { createExtractionEngine } from "./extraction-engine.mjs";
// No caller-supplied module URLs, source code, native names or filesystem paths.
const ready = createBoundary(factory).then((boundary) => createExtractionEngine(boundary));
let busy = false,
  closed = false,
  lastId = 0;
const reject = (id) => self.postMessage({ id, ok: false, error: "EXTRACTION_FAILED" });
self.onmessage = async ({ data }) => {
  const id = data?.id;
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
