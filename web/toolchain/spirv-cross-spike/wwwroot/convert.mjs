// Browser/Node byte boundary. No external processes, uploads or game assets.
import { replayFields } from "./replay-reflection.mjs";
export const MSL_ARGUMENTS = Object.freeze([
  "--msl",
  "--msl-version",
  "20300",
  "--msl-argument-buffers",
  "--msl-texture-buffer-native",
  "--msl-pad-fragment-output",
]);
export const CROSS_COMMIT = "f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7";
export function validateSpirv(input) {
  if (!(input instanceof Uint8Array)) throw new TypeError("SPIR-V must be Uint8Array");
  if (input.byteLength < 20 || input.byteLength % 4 || input.byteLength > 64 * 1024 * 1024)
    throw new RangeError("SPIR-V must contain 5–16777216 whole words");
  const data = new DataView(input.buffer, input.byteOffset, input.byteLength);
  if (data.getUint32(0, true) !== 0x07230203) throw new Error("Invalid little-endian SPIR-V magic");
  if (!data.getUint32(12, true) || data.getUint32(16, true))
    throw new Error("Invalid SPIR-V header");
  for (let offset = 20; offset < input.byteLength;) {
    const words = data.getUint32(offset, true) >>> 16;
    if (!words || offset + words * 4 > input.byteLength)
      throw new Error("Invalid SPIR-V instruction size");
    offset += words * 4;
  }
  return input.slice();
}
async function sha256(bytes) {
  return [...new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
// A fresh instance isolates global CLI state and virtual files between requests.
async function invoke(factory, input, args, output) {
  const errors = [];
  const module = await factory({
    noInitialRun: true,
    print() {},
    printErr(text) {
      errors.push(text);
    },
  });
  try {
    module.FS.writeFile("/input.spv", input);
    const status = module.callMain([...args, "/input.spv", "--output", output]);
    if (status !== 0) throw new Error(`SPIRV-Cross exited ${status}: ${errors.join("\n")}`);
    return module.FS.readFile(output, { encoding: "utf8" }).replace(/\r\n/g, "\n");
  } finally {
    for (const path of ["/input.spv", output]) {
      try {
        module.FS.unlink(path);
      } catch {
        /* May not exist after compiler failure. */
      }
    }
  }
}
export async function convertSpirv(input, { factory, replayContext } = {}) {
  const bytes = validateSpirv(input);
  factory ??= (await import("./spirv-cross.mjs")).default;
  const msl = await invoke(factory, bytes, MSL_ARGUMENTS, "/output.metal");
  // This is upstream SPIR-V reflection, NOT the game's replay .json schema.
  const reflectionText = await invoke(factory, bytes, ["--reflect", "json"], "/reflection.json");
  const reflection = JSON.parse(reflectionText);
  const mslBytes = new TextEncoder().encode(msl);
  return {
    schema: "spirv-cross-browser-stage-v1",
    msl,
    reflection,
    ...(replayContext
      ? { replay: replayFields(replayContext.stage, msl, replayContext.resources) }
      : {}),
    provenance: {
      spirvCrossCommit: CROSS_COMMIT,
      mslArguments: [...MSL_ARGUMENTS],
      inputSha256: await sha256(bytes),
      mslSha256: await sha256(mslBytes),
      reflectionSha256: await sha256(new TextEncoder().encode(reflectionText)),
      nativeChainClaimed: false,
      metalCompiled: false,
    },
  };
}
