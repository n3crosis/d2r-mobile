// Packaging gate only: preserve every existing source/metadata guard.
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const root = new URL("../../../", import.meta.url);
const pins = JSON.parse(readFileSync(new URL("provenance.json", import.meta.url)));
for (const [path, expected] of Object.entries(pins)) {
  const actual = createHash("sha256")
    .update(readFileSync(new URL(path, root)))
    .digest("hex");
  if (actual !== expected) throw new Error("HUD source drift: " + path);
}
const previous = JSON.parse(
  readFileSync(new URL("../asset-generation-spike/hud-provenance.json", import.meta.url)),
);
if (JSON.stringify(pins) !== JSON.stringify(previous))
  throw new Error("HUD provenance contract drift");
console.log("HUD recipe source and metadata pins verified");
