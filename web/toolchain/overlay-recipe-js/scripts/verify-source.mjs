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
const contract = JSON.parse(readFileSync(new URL("../contract-source.json", import.meta.url)));
const fingerprint = createHash("sha256").update("DM_OVERLAY_SOURCE_V1\0");
for (const [path, expected] of Object.entries(contract.normalizedSources)) {
  const text = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(new URL(path, root)));
  const normalized = Buffer.from(text.replace(/\r\n|\r/g, "\n")),
    length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(normalized.length));
  if (createHash("sha256").update(normalized).digest("hex") !== expected)
    throw new Error("Overlay contract normalized source drift: " + path);
  fingerprint
    .update(path + "\0")
    .update(length)
    .update(normalized);
}
if (fingerprint.digest("hex") !== contract.sourceFingerprint)
  throw new Error("Overlay contract source fingerprint drift");
console.log(
  `Verified ${Object.keys(pins).length} overlay recipe source pins and ${Object.keys(dataPins).length} static data pins`,
);
