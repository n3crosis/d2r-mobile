/** Native stash/trove/vault/pouch build order, operating only on authenticated assets.
 * Original image statements are packaged by package-remaining-art.py. MainPanel
 * copies original BC3 blocks without re-encoding, matching gen_widestash_art.py.
 */
const BG = {
  StashPanelBG: "stash/v2/stashpanelbg",
  StashPanelBGPersonal: "stash/v2/stashpanelbgpersonal",
  StashPanelBGShared: "stash/v2/stashpanelbgshared",
};
const ADV = {
  AdvancedStash_Gems_Console: "stash/v2/additionalstash/advancedstash_gems_console",
  AdvancedStash_Consumables_Console: "stash/v2/additionalstash/advancedstash_consumables_console",
  AdvancedStash_Runes_Console: "stash/v2/additionalstash/advancedstash_runes_console",
};
const fail = (code) => {
  throw new Error(code);
};
const asBytes = (value) =>
  value instanceof Uint8Array ? value : value instanceof ArrayBuffer ? new Uint8Array(value) : null;
function base64(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
/** Source-exact 2D BC3 offset from nvn_deswizzle.c; only the pinned main-panel
 * geometry is accepted. This does not change generic decoder/encoder limits. */
export function widenMainPanelBlocks(source) {
  if (!(source instanceof Uint8Array) || source.length < 40 || source.length > 8 * 1024 * 1024)
    fail("STASH_MAIN_BYTES");
  const h = new DataView(source.buffer, source.byteOffset, source.length);
  if (
    h.getUint32(0, true) !== 0x31417053 ||
    h.getUint16(4, true) !== 61 ||
    h.getUint16(6, true) !== 1440 ||
    h.getUint32(8, true) !== 2888 ||
    h.getUint32(12, true) !== 881 ||
    h.getUint16(20, true) !== 2 ||
    source[23] > 5
  )
    fail("STASH_MAIN_GEOMETRY");
  const rowBytes = (2888 / 4) * 16,
    rows = Math.ceil(881 / 4);
  let shift = source[23];
  while (shift && rows <= 8 * 2 ** (shift - 1)) shift--;
  const blockHeight = 2 ** shift,
    gobsX = Math.ceil(rowBytes / 64),
    blockBytes = 512 * blockHeight;
  const storage = gobsX * Math.ceil(rows / (8 * blockHeight)) * blockBytes;
  if (source.length !== storage + 40 || h.getUint32(32, true) !== storage)
    fail("STASH_MAIN_STORAGE");
  const output = new Uint8Array((1640 / 4) * 16 * rows);
  for (let y = 0; y < rows; y++) {
    for (let block = 0; block < 410; block++) {
      const originalBlock = block < 87 ? block : block - 49;
      const x = (361 + originalBlock) * 16;
      const gob =
        Math.floor((x % 64) / 32) * 256 +
        Math.floor((y % 8) / 2) * 64 +
        Math.floor((x % 32) / 16) * 32 +
        (y % 2) * 16;
      const offset =
        Math.floor(y / (8 * blockHeight)) * gobsX * blockBytes +
        Math.floor(x / 64) * blockBytes +
        Math.floor((y % (8 * blockHeight)) / 8) * 512 +
        gob;
      output.set(source.subarray(40 + offset, 40 + offset + 16), (y * 410 + block) * 16);
    }
  }
  // Encoder template metadata is normalized to one physical frame. Final display
  // width is restored to native fw+EX=1636 after packing width1640.
  const templateHeader = source.slice(0, 40),
    t = new DataView(templateHeader.buffer);
  t.setUint16(6, 1444, true);
  t.setUint32(8, 1444, true);
  t.setUint16(20, 1, true);
  return { templateHeader, linearBC3: output, width: 1640, height: 881, frameWidth: 1636 };
}
export async function generateRemainingArt({
  logicalAssets,
  assetWorker,
  decodeAtlas,
  textureEncoder,
  signal,
}) {
  const owned = new Set(),
    files = {};
  let inputBytes = 0,
    outputBytes = 0,
    success = false;
  const check = () => {
    if (signal?.aborted) fail("REMAINING_ART_CANCELLED");
  };
  const own = (value) => {
    const bytes = asBytes(value);
    if (!bytes) fail("REMAINING_ART_BYTES");
    owned.add(bytes);
    return bytes;
  };
  const keep = (path, value) => {
    const bytes = own(value);
    if (
      !bytes.length ||
      bytes.length > 8 * 1024 * 1024 ||
      (outputBytes += bytes.length) > 32 * 1024 * 1024 ||
      Object.hasOwn(files, path)
    )
      fail("REMAINING_ART_OUTPUT_LIMIT");
    files[path] = bytes.slice();
  };
  async function source(rel) {
    check();
    const path = logicalAssets.findUniquePathSuffix(`/ui/controller/panel/${rel}.sprite`);
    const raw = own(await logicalAssets.read(path, { maxBytes: 8 * 1024 * 1024, signal }));
    check();
    if (
      raw.length < 40 ||
      raw.length > 8 * 1024 * 1024 ||
      (inputBytes += raw.length) > 32 * 1024 * 1024
    )
      fail("REMAINING_ART_INPUT_LIMIT");
    const h = new DataView(raw.buffer, raw.byteOffset, raw.length);
    if (h.getUint32(0, true) !== 0x31417053 || h.getUint16(4, true) !== 61)
      fail("REMAINING_ART_HEADER");
    return raw;
  }
  async function decode(raw) {
    const result = await decodeAtlas(raw, { signal });
    const rgba = own(result.pixels);
    check();
    if (
      result.pixelFormat !== 70 ||
      result.bytesPerPixel !== 4 ||
      !Number.isSafeInteger(result.width) ||
      !Number.isSafeInteger(result.height) ||
      result.width * result.height > 4 * 1024 * 1024 ||
      rgba.length !== result.width * result.height * 4
    )
      fail("REMAINING_ART_DECODE");
    return { width: result.width, height: result.height, rgba };
  }
  async function transform(kind, name, images) {
    check();
    const input = Object.fromEntries(
      Object.entries(images).map(([key, im]) => [
        key,
        { width: im.width, height: im.height, rgba: base64(im.rgba) },
      ]),
    );
    const payload = own(new TextEncoder().encode(JSON.stringify(input)));
    if (payload.length > 20 * 1024 * 1024) fail("REMAINING_ART_PAYLOAD_LIMIT");
    let result;
    try {
      result = await assetWorker.run("remaining-art", payload, { kind, name });
    } finally {
      payload.fill(0);
      owned.delete(payload);
    }
    const rgba = own(result.files?.["image.rgba"]);
    for (const bytes of Object.values(result.files ?? {})) own(bytes);
    check();
    if (
      !Number.isSafeInteger(result.width) ||
      !Number.isSafeInteger(result.height) ||
      result.width < 1 ||
      result.width > 1640 ||
      result.height < 1 ||
      result.height > 1024 ||
      rgba.length !== result.width * result.height * 4
    )
      fail("REMAINING_ART_RESULT");
    const names = Object.keys(result.files).sort().join();
    if (names !== (kind === "vault" ? "VaultBottom.png,image.rgba" : "image.rgba"))
      fail("REMAINING_ART_OUTPUT_SET");
    return { ...result, rgba };
  }
  async function encode(template, image) {
    check();
    const encoded = await textureEncoder.encodeAndPack(
      {
        templateHeader: template.slice(0, 40),
        rgba: image.rgba,
        width: image.width,
        height: image.height,
      },
      { signal },
    );
    for (const key of ["sprite", "linearBC3"]) if (encoded[key]) own(encoded[key]);
    check();
    return own(encoded.sprite);
  }
  try {
    const main = own(await source("mainpanelbg"));
    const wide = widenMainPanelBlocks(main);
    own(wide.templateHeader);
    own(wide.linearBC3);
    const packed = await textureEncoder.packLinearBC3(wide, { signal });
    const wideSprite = own(packed.sprite);
    check();
    new DataView(wideSprite.buffer, wideSprite.byteOffset, wideSprite.length).setUint16(
      6,
      wide.frameWidth,
      true,
    );
    keep("NativeHUD/widestash/MainPanelBG_Wide.sprite", wideSprite);
    const sources = {},
      images = {};
    for (const [name, rel] of Object.entries({ ...BG, ...ADV })) {
      sources[name] = await source(rel);
      images[name] = await decode(sources[name]);
      const h = new DataView(sources[name].buffer, sources[name].byteOffset, sources[name].length);
      if (h.getUint16(6, true) !== 652 || images[name].width !== 652 || h.getUint16(20, true) !== 1)
        fail("REMAINING_ART_STASH_SOURCE");
    }
    const character = await decode(await source("charactersheet/v2/charactersheet_bg"));
    let personal;
    for (const name of Object.keys({ ...BG, ...ADV })) {
      const kind = Object.hasOwn(BG, name)
        ? "stash"
        : name === "AdvancedStash_Gems_Console"
          ? "trove"
          : "advanced";
      const inputs =
        kind === "stash"
          ? { image: images[name], personal: images.StashPanelBGPersonal }
          : kind === "trove"
            ? {
                gems: images.AdvancedStash_Gems_Console,
                runes: images.AdvancedStash_Runes_Console,
                cons: images.AdvancedStash_Consumables_Console,
                character,
              }
            : { image: images[name] };
      const result = await transform(kind, name, inputs);
      const sprite = await encode(sources[name], result);
      keep(`NativeHUD/widestash/${name}_wide.sprite`, sprite);
      if (name === "StashPanelBGPersonal") personal = sprite;
    }
    // Native cover is derived from the lossy encoded widestash result, not the
    // pre-encoding RGBA. Keep this round trip and its original gold-box guard.
    const vault = await transform("vault", "VaultBottom", { image: await decode(personal) });
    keep("NativeHUD/widestash/VaultBottom.sprite", await encode(personal, vault));
    keep("NativeHUD/widestash/VaultBottom.png", vault.files["VaultBottom.png"]);
    const inventory = await source("inventorypanel/v2/inventorybg_classic");
    const pouch = await transform("pouch", "PouchBox", { image: await decode(inventory) });
    keep("NativeHUD/pouch/PouchBox.sprite", await encode(inventory, pouch));
    check();
    success = true;
    return { files };
  } finally {
    for (const bytes of owned) bytes.fill(0);
    if (!success) for (const bytes of Object.values(files)) bytes.fill(0);
  }
}
