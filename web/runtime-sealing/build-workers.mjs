import { mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const outdir = fileURLToPath(new URL("../runtime-build/.build/sealed-workers/", import.meta.url));
await rm(outdir, { recursive: true, force: true });
await mkdir(outdir, { recursive: true });
for (const name of ["nsp-worker", "cross-worker", "program-worker"]) {
  const result = await globalThis.Bun.build({
    entrypoints: [fileURLToPath(new URL(`${name}.mjs`, import.meta.url))],
    outdir,
    naming: `${name}.mjs`,
    target: "browser",
    format: "esm",
    minify: true,
    splitting: false,
    sourcemap: "none",
    env: "disable",
    define: { process: "undefined" },
    // Generated Emscripten includes dormant Node branches. They cannot run in
    // these browser-only workers, and no Node shim is bundled into the output.
    external: ["node:*", "module", "fs", "path", "url", "crypto"],
  });
  if (!result.success) throw new AggregateError(result.logs, `Failed to bundle ${name}`);
  if (result.outputs.length !== 1) throw new Error(`Unexpected split worker output: ${name}`);
  const code = await result.outputs[0].text();
  // All literal imports must be closed by the build. The only dynamic imports
  // remaining are verified in-memory Pyodide blob URLs created at initialization.
  const imports = new globalThis.Bun.Transpiler({ loader: "js" }).scanImports(code);
  if (imports.length) throw new Error(`Unclosed worker import graph: ${name}`);
}
