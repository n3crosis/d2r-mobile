import process from "node:process";
import { readdir, readFile, writeFile, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { validateStaticBuild } from "../scripts/build-policy.mjs";

export async function createPreviewManifest(directory, commit = null) {
  const files = [];
  const assets = new Map();
  let html;
  for (const name of await readdir(directory)) {
    const url = new URL(name, directory);
    const info = await lstat(url);
    if (!info.isFile() || info.isSymbolicLink())
      throw new Error("Preview must contain regular files only");
    if (name === "build-manifest.json") continue;
    if (name !== "index.html" && !/^[A-Za-z0-9_-]+\.(js|css)$/.test(name)) {
      throw new Error("Unexpected file outside the static bundle allowlist");
    }
    if (info.size > 16 * 1024 * 1024) throw new Error("Unexpected oversized preview file");
    const bytes = await readFile(url);
    files.push({
      path: name,
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    if (name === "index.html") html = bytes.toString("utf8");
    else assets.set(name, bytes.toString("utf8"));
  }
  if (!html || files.length > 200) throw new Error("Invalid preview inventory");
  validateStaticBuild(html, assets);
  const references = new Set(
    [...html.matchAll(/\b(?:src|href)="\.\/([^"]+)"/g)].map((match) => match[1]),
  );
  if (references.size !== assets.size || [...assets.keys()].some((name) => !references.has(name))) {
    throw new Error("Unreferenced file in preview bundle");
  }
  const manifest = {
    schema: 1,
    commit: /^[0-9a-f]{40}$/.test(commit || "") ? commit : null,
    scope: "Static preview only; not a working game IPA",
    files: files.sort((a, b) => a.path.localeCompare(b.path)),
  };
  await writeFile(
    new URL("build-manifest.json", directory),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await createPreviewManifest(new URL("../dist/", import.meta.url), process.env.GITHUB_SHA);
}
