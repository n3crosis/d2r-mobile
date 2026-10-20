import createModule from "./dist/texture.mjs";
import { createTextureDecoder } from "./browser-texture.mjs";
const decoder = createTextureDecoder(createModule);
// Request: {id, operation: 'layout'|'decode'|'decodeV61', descriptor, source, options}.
// Response: {id, ok:true, result} or {id, ok:false, error:{name,code,message}}.
// Transfer source.buffer to avoid copying large inputs. Results own their bytes.
let queue = Promise.resolve();
self.onmessage = ({ data }) => {
  queue = queue.then(async () => {
    try {
      const api = await decoder;
      let result;
      if (data.operation === "decodeV61") result = api.decodeV61(data.source);
      else if (data.operation === "decode")
        result = api.decode(data.descriptor, data.source, data.options);
      else if (data.operation === "layout") result = api.layout(data.descriptor, data.options);
      else throw new Error("Unsupported texture worker operation");
      self.postMessage(
        { id: data.id, ok: true, result },
        result.pixels ? [result.pixels.buffer] : [],
      );
    } catch (error) {
      self.postMessage({
        id: data?.id,
        ok: false,
        error: { name: error.name, code: error.code ?? -1, message: error.message },
      });
    }
  });
};
