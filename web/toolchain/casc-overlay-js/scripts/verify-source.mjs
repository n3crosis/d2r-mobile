// 固定原生 CASC 来源与 MD5，构建时拒绝漂移。 | Pin native CASC sources and MD5; fail the build on drift.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = new URL("../../../../", import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL("../source-provenance.json", import.meta.url), "utf8"),
);
export async function verifyCascOverlaySources() {
  if (manifest.schemaVersion !== 1 || Object.keys(manifest.sources).length !== 3)
    throw new Error("CASC overlay source manifest drift");
  for (const [path, expected] of Object.entries(manifest.sources)) {
    const bytes = await readFile(new URL(path, root));
    if (createHash("sha256").update(bytes).digest("hex") !== expected)
      throw new Error(`CASC overlay source drift: ${path}`);
  }
}
await verifyCascOverlaySources();
