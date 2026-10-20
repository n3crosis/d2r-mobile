const MAX_PIXELS = 4_194_304;
const MAX_PNG = MAX_PIXELS * 4 + 131_072;
const MAX_ZLIB_INPUT = 128 * 1024 * 1024;
function bytes(value, cap) {
  if (!(value instanceof Uint8Array) || value.length > cap)
    throw new TypeError("Invalid codec bytes/limit");
}
function geometry(width, height) {
  if (
    !Number.isInteger(width) ||
    !Number.isInteger(height) ||
    width < 1 ||
    height < 1 ||
    width > 8192 ||
    height > 8192 ||
    width * height > MAX_PIXELS
  )
    throw new RangeError("PNG image pixel limit");
}
export async function createPngCodec(wasmBytes) {
  const module =
    wasmBytes instanceof WebAssembly.Module ? wasmBytes : await WebAssembly.compile(wasmBytes);
  if (WebAssembly.Module.imports(module).length)
    throw new Error("Unexpected PNG codec host imports");
  const instance = await WebAssembly.instantiate(module);
  const wasm = instance.exports;
  wasm._initialize?.();
  const write = (value) =>
    new Uint8Array(wasm.memory.buffer, wasm.png_input(), value.length).set(value);
  const result = (length) => {
    if (length < 0) throw new Error(`PNG/zlib codec rejected input (code ${wasm.png_error()})`);
    if (length > MAX_PNG) throw new Error("Codec output cap");
    return new Uint8Array(wasm.memory.buffer, wasm.png_output(), length).slice();
  };
  const readVersion = (ptr) => {
    const raw = new Uint8Array(wasm.memory.buffer, ptr, 16);
    return new TextDecoder().decode(raw.subarray(0, raw.indexOf(0)));
  };
  const version = readVersion(wasm.png_zlib_version());
  const genericVersion = readVersion(wasm.generic_zlib_version());
  if (genericVersion !== "1.2.13") throw new Error("CASC codec zlib version mismatch");
  if (version !== "1.3.1") throw new Error("PNG codec zlib version mismatch");
  return Object.freeze({
    zlibVersion: version,
    genericZlibVersion: genericVersion,
    encodeRgba(rgba, width, height) {
      geometry(width, height);
      bytes(rgba, MAX_PIXELS * 4);
      if (rgba.length !== width * height * 4) throw new TypeError("RGBA byte length mismatch");
      write(rgba);
      return result(wasm.png_encode(width, height));
    },
    decodeRgba(png) {
      bytes(png, MAX_PNG);
      write(png);
      const data = result(wasm.png_decode(png.length));
      const width = wasm.png_width(),
        height = wasm.png_height();
      geometry(width, height);
      if (data.length !== width * height * 4) throw new Error("PNG decoded byte length mismatch");
      return { width, height, channels: 4, data };
    },
    compressZlib(raw, options = { level: 9 }) {
      bytes(raw, MAX_ZLIB_INPUT);
      if (!options || options.level !== 9 || Object.keys(options).some((k) => k !== "level"))
        throw new TypeError(
          "Generic zlib supports only level 9/default wbits15 memLevel8 strategy0",
        );
      if (wasm.zlib_begin(9) !== 0) throw new Error("Cannot initialize zlib compressor");
      const chunks = [];
      let total = 0;
      try {
        const step = 1024 * 1024;
        for (let offset = 0; offset < raw.length || offset === 0; offset += step) {
          const part = raw.subarray(offset, offset + step);
          write(part);
          const out = result(wasm.zlib_push(part.length, Number(offset + step >= raw.length)));
          total += out.length;
          if (total > MAX_ZLIB_INPUT + 1024 * 1024) throw new RangeError("Zlib output limit");
          chunks.push(out);
        }
      } finally {
        wasm.zlib_abort();
      }
      const all = new Uint8Array(total);
      let offset = 0;
      for (const chunk of chunks) {
        all.set(chunk, offset);
        offset += chunk.length;
      }
      return all;
    },
  });
}
