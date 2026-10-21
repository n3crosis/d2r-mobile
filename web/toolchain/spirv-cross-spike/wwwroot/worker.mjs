import { convertSpirv } from "./convert.mjs";
// 请求串行执行，避免不受限的并发 WASM 堆分配。
// Requests are serialized to avoid unbounded concurrent WASM heap allocations.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    const id = data?.id;
    try {
      if (data?.type !== "convert" || !(data.spirv instanceof ArrayBuffer))
        throw new TypeError('Expected { id, type: "convert", spirv: ArrayBuffer }');
      const result = await convertSpirv(new Uint8Array(data.spirv), {
        replayContext: data.replayContext,
      });
      self.postMessage({ id, ok: true, result });
    } catch (error) {
      self.postMessage({ id, ok: false, error: String(error.message ?? error) });
    }
  });
};
