import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
const pins = JSON.parse(readFileSync(new URL("../source-provenance.json", import.meta.url)));
const root = new URL("../../../../", import.meta.url);
for (const [path, expected] of Object.entries(pins)) {
  const raw = readFileSync(new URL(path, root));
  if (createHash("sha256").update(raw).digest("hex") !== expected)
    throw new Error("Overlay recipe source drift: " + path);
}
const close = JSON.parse(readFileSync(new URL("../close-image.json", import.meta.url)));
if (createHash("sha256").update(Buffer.from(close.base64, "base64")).digest("hex") !== close.sha256)
  throw new Error("Overlay recipe close image drift");
const dataPins = JSON.parse(readFileSync(new URL("../data-provenance.json", import.meta.url)));
for (const [path, expected] of Object.entries(dataPins)) {
  if (
    createHash("sha256")
      .update(readFileSync(new URL("../" + path, import.meta.url)))
      .digest("hex") !== expected
  )
    throw new Error("Overlay recipe static data drift: " + path);
}
console.log(
  `Verified ${Object.keys(pins).length} overlay recipe source pins and ${Object.keys(dataPins).length} static data pins`,
);
