import { rm, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";
import tailwind from "bun-plugin-tailwind";
import { productionCsp, validateStaticBuild } from "./build-policy.mjs";

export const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const outputDirectory = resolve(root, "dist");

export async function build() {
  // This directory contains only generated frontend assets. Never copy source,
  // key files, toolchain fixtures, or environment variables into the deployment.
  await rm(outputDirectory, { recursive: true, force: true });
  await mkdir(outputDirectory, { recursive: true });
  const result = await Bun.build({
    entrypoints: [resolve(root, "index.html")],
    outdir: outputDirectory,
    target: "browser",
    format: "esm",
    minify: true,
    sourcemap: "none",
    env: "disable",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [tailwind],
  });
  if (!result.success) throw new AggregateError(result.logs, "Frontend bundling failed");
  const htmlPath = resolve(outputDirectory, "index.html");
  const html = await readFile(htmlPath, "utf8");
  if (html.split("__APP_CSP__").length !== 2) throw new Error("Missing or duplicate CSP marker");
  const finalHtml = html.replace("__APP_CSP__", productionCsp);
  await writeFile(htmlPath, finalHtml);
  const files = await readdir(outputDirectory);
  if (!files.some((name) => name.endsWith(".js")) || !files.some((name) => name.endsWith(".css"))) {
    throw new Error("Missing browser script or Tailwind stylesheet");
  }
  const assets = new Map(
    await Promise.all(
      files
        .filter((name) => name !== "index.html")
        .map(async (name) => [name, await readFile(resolve(outputDirectory, name), "utf8")]),
    ),
  );
  validateStaticBuild(finalHtml, assets);
  console.log(`Bun bundled ${files.length} static files into dist/`);
}

if (import.meta.main) await build();
