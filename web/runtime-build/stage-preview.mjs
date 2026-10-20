import process from "node:process";
import { mkdir, copyFile, rm, readFile, writeFile } from "node:fs/promises";
import { verifyRuntimeInventory } from "./inventory.mjs";
import { createPreviewManifest } from "../verification/preview-manifest.mjs";

const source = new URL("./out/", import.meta.url);
const preview = new URL("../dist/", import.meta.url);
const destination = new URL("runtime/", preview);
const expected = process.env.EXPECTED_RUNTIME_MANIFEST_SHA256;
const inventory = await verifyRuntimeInventory(source, expected, process.env.GITHUB_SHA || null);
// The fixed destination belongs only to the generated Bun output. Do not copy
// arbitrary trees; only independently verified manifest entries are staged.
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });
for (const entry of inventory.files) {
  const target = new URL(entry.path, destination);
  await mkdir(new URL("./", target), { recursive: true });
  await copyFile(new URL(entry.path, source), target);
}
const htmlUrl = new URL("index.html", preview);
const html = await readFile(htmlUrl, "utf8");
const marker = "__RUNTIME_MANIFEST_SHA256__";
if (html.split(marker).length !== 2)
  throw new Error("Missing or duplicate runtime trust-anchor placeholder");
await writeFile(htmlUrl, html.replace(marker, expected));
await createPreviewManifest(preview, process.env.GITHUB_SHA || null, expected);
console.log(
  `Staged ${inventory.files.length} verified public runtime files; production remains disabled.`,
);
