import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { code, job } from "./synthetic-fixture.mjs";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const expectedHash = (
  await readFile(new URL("./upstream-source.sha256", import.meta.url), "utf8")
).split(/\s/)[0];
const source = await readFile(join(root, "dm/gfx/tools/dmsh_xlate/Program.cs"));
assert.equal(
  createHash("sha256").update(source).digest("hex"),
  expectedHash,
  "Native source changed: review/update bridge and parity provenance before testing.",
);
const [command, first, second] = process.argv.slice(2);
if (command === "prepare" && first) {
  const directory = resolve(first);
  await mkdir(directory, { recursive: true });
  const shaderPath = join(directory, "synthetic-exit.bin");
  await writeFile(shaderPath, code);
  await writeFile(
    join(directory, "jobs.json"),
    JSON.stringify([{ ...job, code: shaderPath }], null, 2),
  );
  console.log("Synthetic fixture prepared; native oracle has NOT been run.");
} else if (command === "compare" && first && second) {
  const nativeSpirv = await readFile(join(first, `${job.key}.spv`));
  const nativeResources = JSON.parse(await readFile(join(first, `${job.key}.res.json`), "utf8"));
  const browser = JSON.parse(await readFile(second, "utf8"));
  const browserSpirv = Buffer.from(browser.spirvBase64, "base64");
  assert.ok(nativeSpirv.length >= 20 && nativeSpirv.length % 4 === 0, "Invalid SPIR-V size");
  assert.equal(nativeSpirv.readUInt32LE(0), 0x07230203, "Invalid SPIR-V magic");
  assert.deepEqual(browserSpirv, nativeSpirv, "SPIR-V binary differs from native oracle");
  assert.deepEqual(
    browser.resources,
    nativeResources,
    "Resource sidecar differs from native oracle",
  );
  console.log("Synthetic EXIT byte/metadata parity passed; not game or graphics compatibility.");
} else {
  throw new Error(
    "Usage: node verify-parity.mjs prepare <fixture-dir> | compare <native-output-dir> <browser-result.json>",
  );
}
