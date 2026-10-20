/** Exact original mercenary image composition, with no invented release hashes. */
export const MERCENARY_INPUTS = Object.freeze({
  "hirelinginventory/v2/hirelinginventorybg": Object.freeze([652, 704]),
  "inventorypanel/v2/inventorybg_classic": Object.freeze([507, 700]),
  mainpanelbg: Object.freeze([2888, 881]),
});
const fail = (code) => {
  throw new Error(code);
};
const bytes = (v) =>
  v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null;
const base64 = (value) => {
  let text = "";
  for (let i = 0; i < value.length; i += 8192)
    text += String.fromCharCode(...value.subarray(i, i + 8192));
  return btoa(text);
};
/** logicalAssets must be the authenticated extraction capability. Encoder and
 * asset worker must already be loaded/sealed by their owning job controller. */
export async function generateMercenaryArt({
  logicalAssets,
  assetWorker,
  decodeAtlas,
  textureEncoder,
  signal,
}) {
  const owned = [],
    output = [];
  const check = () => {
    if (signal?.aborted) fail("MERCENARY_CANCELLED");
  };
  const own = (value) => {
    const b = bytes(value);
    if (!b) fail("MERCENARY_BYTES");
    owned.push(b);
    return b;
  };
  try {
    const images = {};
    let template,
      total = 0;
    for (const [name, [width, height]] of Object.entries(MERCENARY_INPUTS)) {
      check();
      const path = logicalAssets.findUniquePathSuffix(`/ui/controller/panel/${name}.sprite`);
      const source = own(await logicalAssets.read(path, { maxBytes: 8 * 1024 * 1024, signal }));
      check();
      if (
        source.length < 40 ||
        source.length > 8 * 1024 * 1024 ||
        (total += source.length) > 12 * 1024 * 1024
      )
        fail("MERCENARY_INPUT_LIMIT");
      const header = own(source.slice(0, 40));
      const h = new DataView(header.buffer, header.byteOffset, 40);
      if (
        h.getUint32(0, true) !== 0x31417053 ||
        h.getUint16(4, true) !== 61 ||
        h.getUint32(8, true) !== width ||
        h.getUint32(12, true) !== height ||
        (name.startsWith("hireling") && h.getUint16(6, true) !== 652)
      )
        fail("MERCENARY_SOURCE_GEOMETRY");
      const decoded = await decodeAtlas(source, { signal });
      const rgba = own(decoded.pixels);
      check();
      if (
        decoded.width !== width ||
        decoded.height !== height ||
        decoded.pixelFormat !== 70 ||
        decoded.bytesPerPixel !== 4 ||
        rgba.length !== width * height * 4
      )
        fail("MERCENARY_ATLAS_GEOMETRY");
      images[name] = { header: base64(header), rgba: base64(rgba) };
      if (name.startsWith("hireling")) template = header;
    }
    const payload = own(new TextEncoder().encode(JSON.stringify(images)));
    if (payload.length > 20 * 1024 * 1024) fail("MERCENARY_PAYLOAD_LIMIT");
    check();
    const result = await assetWorker.run("mercenary-art", payload, {});
    if (
      Object.keys(result.files ?? {})
        .sort()
        .join() !== "HirelingInventoryBG.png,mercenary.rgba"
    )
      fail("MERCENARY_OUTPUT_SET");
    const rgba = own(result.files["mercenary.rgba"]),
      png = own(result.files["HirelingInventoryBG.png"]);
    check();
    if (
      result.width !== 652 ||
      result.height !== 704 ||
      rgba.length !== 652 * 704 * 4 ||
      !png.length ||
      png.length > 4 * 1024 * 1024
    )
      fail("MERCENARY_OUTPUT_LIMIT");
    const encoded = await textureEncoder.encodeAndPack(
      { templateHeader: template, rgba, width: 652, height: 704 },
      { signal },
    );
    const sprite = own(encoded.sprite);
    if (encoded.linearBC3) own(encoded.linearBC3);
    check();
    if (
      encoded.width !== 652 ||
      encoded.height !== 704 ||
      sprite.length < 40 ||
      sprite.length > 4 * 1024 * 1024
    )
      fail("MERCENARY_ENCODE_RESULT");
    const files = {
      "HirelingInventoryBG.png": png.slice(),
      "HirelingInventoryBG.sprite": sprite.slice(),
    };
    output.push(...Object.values(files));
    check();
    return { width: 652, height: 704, files };
  } catch (error) {
    for (const value of output) value.fill(0);
    throw error;
  } finally {
    for (const value of owned) value.fill(0);
  }
}
