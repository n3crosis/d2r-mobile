// Build/CI only. Browser never contacts the CDN. npm lock pins the runtime bytes;
// upstream pyodide-lock.json pins dependency wheels with SHA-256.
import { mkdir, readFile, copyFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const version = "0.27.7";
const source = resolve("node_modules/pyodide");
const dest = resolve("public/vendor/pyodide");
await mkdir(dest, { recursive: true });
const pkg = JSON.parse(await readFile(`${source}/package.json`));
if (pkg.version !== version) throw new Error("Pyodide version drift");
const lock = JSON.parse(await readFile(`${source}/pyodide-lock.json`));
const hashes = {};
for (const file of [
  "pyodide.mjs",
  "pyodide.asm.js",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
]) {
  await copyFile(`${source}/${file}`, `${dest}/${file}`);
  hashes[file] = createHash("sha256")
    .update(await readFile(`${dest}/${file}`))
    .digest("hex");
}
// Preserve the runtime package's distributed license/notice files. Wheel archives
// retain their own dist-info licenses; package metadata is saved below as well.
for (const file of await readdir(source)) {
  if (/^(license|copying|notice)/i.test(file))
    await copyFile(`${source}/${file}`, `${dest}/${file}`);
}
const seen = new Set();
async function vendor(name) {
  if (seen.has(name)) return;
  seen.add(name);
  const info = lock.packages[name];
  if (!info || !/^[a-zA-Z0-9_.+-]+$/.test(info.file_name))
    throw new Error(`Invalid package ${name}`);
  for (const dep of info.depends ?? []) await vendor(dep);
  const response = await fetch(
    `https://cdn.jsdelivr.net/pyodide/v${version}/full/${info.file_name}`,
  );
  if (!response.ok) throw new Error(`Package fetch failed: ${name} ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const hash = createHash("sha256").update(bytes).digest("hex");
  if (hash !== info.sha256) throw new Error(`Integrity mismatch: ${name}`);
  await writeFile(`${dest}/${info.file_name}`, bytes);
  hashes[info.file_name] = hash;
}
await vendor("pillow");
await vendor("numpy");
await writeFile(
  `${dest}/vendor-manifest.json`,
  JSON.stringify(
    {
      version,
      packages: Object.fromEntries([...seen].map((name) => [name, lock.packages[name]])),
      sha256: hashes,
    },
    null,
    2,
  ),
);
console.log(`Self-hosted Pyodide ${version}; packages: ${[...seen].join(", ")}`);
