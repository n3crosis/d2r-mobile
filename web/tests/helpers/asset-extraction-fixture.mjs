import { createHash } from "node:crypto";
import { fixture, open, selection } from "./extraction-adapter-fixture.mjs";
import { fixture as casc } from "./casc-overlay-fixture.mjs";
import { MAP_GOAL_IMAGE_PATHS, MAP_GOAL_TABLES, MAP_GOAL_FONT } from "../../map-goal-generator.mjs";
// Authored flat data/ RomFS image, served through the real extraction adapter's
// bounded worker protocol. No production resolver override or registration seam.
function romfs(files) {
  const items = Object.entries(files).map(([path, bytes]) => ({
    name: new TextEncoder().encode(path.slice(5)),
    bytes,
  }));
  let fileSize = 0,
    dataSize = 0;
  for (const item of items) {
    item.meta = fileSize;
    item.data = dataSize;
    fileSize += 32 + Math.ceil(item.name.length / 4) * 4;
    dataSize += item.bytes.length;
  }
  const dirStart = 84,
    dirSize = 52,
    hashStart = dirStart + dirSize,
    fileStart = hashStart + 4,
    dataStart = fileStart + fileSize;
  const out = new Uint8Array(dataStart + dataSize),
    v = new DataView(out.buffer);
  const u32 = (p, x) => v.setUint32(p, x, true),
    u64 = (p, x) => v.setBigUint64(p, BigInt(x), true);
  [80, 80, 4, dirStart, dirSize, hashStart, 4, fileStart, fileSize, dataStart].forEach((x, i) =>
    u64(i * 8, x),
  );
  [0, 0xffffffff, 24, 0xffffffff, 0xffffffff, 0].forEach((x, i) => u32(dirStart + i * 4, x));
  [0, 0xffffffff, 0xffffffff, 0, 0xffffffff, 4].forEach((x, i) => u32(dirStart + 24 + i * 4, x));
  out.set(new TextEncoder().encode("data"), dirStart + 48);
  items.forEach((item, i) => {
    const p = fileStart + item.meta;
    u32(p, 24);
    u32(p + 4, items[i + 1]?.meta ?? 0xffffffff);
    u64(p + 8, item.data);
    u64(p + 16, item.bytes.length);
    u32(p + 24, 0xffffffff);
    u32(p + 28, item.name.length);
    out.set(item.name, p + 32);
    out.set(item.bytes, dataStart + item.data);
  });
  return out;
}
export async function extractedFixture(template) {
  const files = Object.fromEntries(
    Object.entries(casc.files).map(([p, b]) => [p, Buffer.from(b, "base64")]),
  );
  const assets = {
    ...Object.fromEntries(
      [...Object.values(MAP_GOAL_IMAGE_PATHS), MAP_GOAL_FONT].map((p) => [
        p,
        Buffer.from("fixture"),
      ]),
    ),
    ...Object.fromEntries(
      MAP_GOAL_TABLES.map((p) => [`local/lng/strings/${p}.json`, Buffer.from("[]")]),
    ),
    "template.sprite": template,
  };
  let offset = 0;
  const rows = [],
    chunks = [];
  for (const [name, bytes] of Object.entries(assets)) {
    const ekey = "0".repeat(18) + "0003" + offset.toString(16).padStart(10, "0");
    rows.push(
      [
        "0",
        "0",
        "0",
        "3",
        createHash("md5").update(bytes).digest("hex"),
        bytes.length,
        ekey,
        bytes.length,
        "n",
        `data:data/${name.toLowerCase()}`,
        "0",
      ].join("|"),
    );
    chunks.push(bytes);
    offset += bytes.length;
  }
  files["data/build_manifest.psv"] = Buffer.concat([
    files["data/build_manifest.psv"],
    Buffer.from("\n" + rows.join("\n") + "\n"),
  ]);
  files["data/00-00000003.data"] = Buffer.concat(chunks);
  const f = fixture({ romfs: romfs(files) }),
    session = await open(f);
  return {
    extracted: await f.adapter.extractSelected({ session, selection }),
    selection,
    cleanup: f.adapter.cleanup,
  };
}
