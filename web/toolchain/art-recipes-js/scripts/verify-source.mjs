// 构建时校验原配方、适配器与已迁移的数值核。 | Verify original recipes, adapters and migrated numeric kernels at build time.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../../../../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("../source-provenance.json", import.meta.url), "utf8"),
);
export async function verifyArtRecipeSources() {
  if (manifest.schemaVersion !== 1 || Object.keys(manifest.sources).length !== 11)
    throw new Error("Art recipe source manifest drift");
  for (const [path, digest] of Object.entries(manifest.sources)) {
    if (
      createHash("sha256")
        .update(await readFile(new URL(path, root)))
        .digest("hex") !== digest
    )
      throw new Error(`Art recipe source drift: ${path}`);
  }
}
await verifyArtRecipeSources();
