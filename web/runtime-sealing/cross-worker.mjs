import factory from "../toolchain/spirv-cross-spike/wwwroot/spirv-cross.mjs";
import { convertSpirv } from "../toolchain/spirv-cross-spike/wwwroot/convert.mjs";
import { byteFactory, initializationWasm } from "./wasm-factory.mjs";
let sealedFactory;
let started = false;
let queue = Promise.resolve();
self.addEventListener("message", ({ data }) => {
  if (data?.type === "initialize") {
    if (
      started ||
      data.id !== 0 ||
      Object.keys(data).some((key) => !["id", "type", "assets"].includes(key))
    ) {
      self.postMessage({ id: 0, ok: false, error: "SEALED_INITIALIZATION_FAILED" });
      return;
    }
    started = true;
    try {
      sealedFactory = byteFactory(factory, initializationWasm(data.assets, "spirv-cross.wasm"));
      self.postMessage({ id: 0, ok: true, result: { initialized: true } });
    } catch {
      self.postMessage({ id: 0, ok: false, error: "SEALED_INITIALIZATION_FAILED" });
      self.close();
    }
    return;
  }
  if (!sealedFactory) {
    self.postMessage({ id: data?.id, ok: false, error: "CROSS_NOT_INITIALIZED" });
    return;
  }
  queue = queue.then(async () => {
    try {
      if (data?.type !== "convert" || !(data.spirv instanceof ArrayBuffer))
        throw new Error("Invalid conversion request");
      const result = await convertSpirv(new Uint8Array(data.spirv), {
        factory: sealedFactory,
        replayContext: data.replayContext,
      });
      self.postMessage({ id: data.id, ok: true, result });
    } catch {
      self.postMessage({ id: data?.id, ok: false, error: "CROSS_CONVERSION_FAILED" });
    }
  });
});
