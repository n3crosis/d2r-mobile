import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const pins = JSON.parse(readFileSync(new URL("../source-provenance.json", import.meta.url)));
const root = new URL("../../../../", import.meta.url);
for (const [path, expected] of Object.entries(pins)) {
  const bytes = readFileSync(new URL(path, root));
  if (createHash("sha256").update(bytes).digest("hex") !== expected)
    throw new Error("Remaining-art source drift: " + path);
}
console.log(`Verified ${Object.keys(pins).length} remaining-art source pins`);
