// 仅构建时核对原始来源；不读取游戏资源。 | Build-only source pin check; reads no game resources.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../../../../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("../source-provenance.json", import.meta.url), "utf8"),
);
export async function verifyAssetTransformSources() {
  if (manifest.schemaVersion !== 1 || Object.keys(manifest.sources).length !== 7)
    throw new Error("Asset transform source manifest drift");
  for (const [path, expected] of Object.entries(manifest.sources)) {
    const bytes = await readFile(new URL(path, root));
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      throw new Error(`Asset transform native source drift: ${path}`);
  }
  return manifest;
}
await verifyAssetTransformSources();
