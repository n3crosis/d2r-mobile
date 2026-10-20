/** Complete current-name map-goal assets. No OS fonts, private old names, or inferred atlas layout. */
export const MAP_GOAL_IMAGE_PATHS = Object.freeze({
  symbols: "hd/global/ui/PANEL/Quest_Log/TalRashaSymbol.sprite",
  units: "hd/global/ui/AUTOMAP/Units.sprite",
});
export const MAP_GOAL_TABLES = Object.freeze([
  "levels",
  "monsters",
  "objects",
  "item-names",
  "npcs",
]);
export const MAP_GOAL_FONT = "hd/ui/fonts/BlizzardGlobal-V5_81.ttf";
export const MAP_GOAL_OUTPUTS = Object.freeze([
  "mapgoal.json",
  "cross.png",
  ...Array.from({ length: 7 }, (_, i) => `sym_${i}.png`),
  ...Array.from({ length: 31 }, (_, i) =>
    ["", "_en", "_es", "_mx", "_ru"].map((s) => `label_${i}${s}.png`),
  ).flat(),
]);
const fail = (code) => {
  throw new Error(code);
};
const encode = (bytes) => {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
};
/** decodeAtlas must return the validated full atlas plus actual frameWidth and frames. */
export async function generateMapGoal({ logicalAssets, assetWorker, decodeAtlas, signal }) {
  const owned = [];
  let total = 0,
    pixels = 0;
  const check = () => {
    if (signal?.aborted) fail("MAP_GOAL_CANCELLED");
  };
  const read = async (path, limit) => {
    check();
    const bytes = await logicalAssets.read(path, { maxBytes: limit, signal });
    if (!(bytes instanceof Uint8Array)) fail("MAP_GOAL_READ_TYPE");
    owned.push(bytes);
    if (!bytes.length || bytes.length > limit || (total += bytes.length) > 24 * 1024 * 1024)
      fail("MAP_GOAL_READ_LIMIT");
    check();
    return bytes;
  };
  try {
    const images = {},
      strings = {};
    for (const [name, path] of Object.entries(MAP_GOAL_IMAGE_PATHS)) {
      const decoded = await decodeAtlas(await read(path, 8 * 1024 * 1024), { signal });
      check();
      const { width, height, frameWidth, frames } = decoded;
      if (decoded.pixels instanceof Uint8Array) owned.push(decoded.pixels);
      if (
        ![width, height, frameWidth, frames].every((v) => Number.isSafeInteger(v) && v > 0) ||
        frames !== (name === "symbols" ? 7 : 8) ||
        width % frames !== 0 ||
        frameWidth > width / frames ||
        (pixels += width * height) > 2097152 ||
        decoded.pixelFormat !== 70 ||
        decoded.bytesPerPixel !== 4 ||
        !(decoded.pixels instanceof Uint8Array) ||
        decoded.pixels.length !== width * height * 4
      )
        fail("MAP_GOAL_FRAME_LAYOUT");
      images[name] = { size: [width, height], frameWidth, frames, rgba: encode(decoded.pixels) };
    }
    const font = encode(await read(MAP_GOAL_FONT, 8 * 1024 * 1024));
    for (const name of MAP_GOAL_TABLES)
      strings[name] = new TextDecoder("utf-8", { fatal: true }).decode(
        await read(`local/lng/strings/${name}.json`, 2 * 1024 * 1024),
      );
    const payload = new TextEncoder().encode(JSON.stringify({ images, font, strings }));
    owned.push(payload);
    if (payload.length > 20 * 1024 * 1024) fail("MAP_GOAL_INPUT_LIMIT");
    check();
    const result = await assetWorker.run("map-goal", payload, { names: "current" });
    check();
    if (
      Object.keys(result.files ?? {})
        .sort()
        .join() !== [...MAP_GOAL_OUTPUTS].sort().join()
    )
      fail("MAP_GOAL_OUTPUT_SET");
    let output = 0;
    for (const value of Object.values(result.files)) {
      if (
        !(value instanceof Uint8Array || value instanceof ArrayBuffer) ||
        !value.byteLength ||
        (output += value.byteLength) > 16 * 1024 * 1024
      )
        fail("MAP_GOAL_OUTPUT_LIMIT");
    }
    return result;
  } finally {
    for (const bytes of owned) bytes.fill(0);
  }
}
