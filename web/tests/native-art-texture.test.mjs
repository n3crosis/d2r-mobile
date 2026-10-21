import test from "node:test";
import assert from "node:assert/strict";
import { nativeArtAtlasDescriptor, NativeArtTextureClient } from "../native-art-texture.mjs";
function sprite(width = 136, frameWidth = 65, frames = 2) {
  const bytes = new Uint8Array(56),
    h = new DataView(bytes.buffer);
  h.setUint32(0, 0x31417053, true);
  h.setUint16(4, 61, true);
  h.setUint16(6, frameWidth, true);
  h.setUint32(8, width, true);
  h.setUint32(12, 65, true);
  h.setUint16(20, frames, true);
  return bytes;
}
test("whole-atlas retains padded dimensions and accepts a final unpadded frame", () => {
  const a = nativeArtAtlasDescriptor(sprite());
  assert.equal(a.descriptor.width, 136);
  assert.equal(a.frameWidth, 65);
  assert.equal(a.framePitch, 68);
  assert.equal(nativeArtAtlasDescriptor(sprite(155, 155, 1)).descriptor.width, 155);
  assert.throws(() => nativeArtAtlasDescriptor(sprite(130)), /GEOMETRY/);
  assert.throws(() => nativeArtAtlasDescriptor(sprite(137)), /GEOMETRY/);
  assert.throws(() => nativeArtAtlasDescriptor(sprite(136, 65, 0)), /GEOMETRY/);
});
test("whole-atlas worker uses explicit decode descriptor and abort closes pending work", async () => {
  let sent,
    terminated = false;
  const worker = {
    postMessage(message) {
      sent = message;
    },
    terminate() {
      terminated = true;
    },
  };
  const client = new NativeArtTextureClient(worker);
  const controller = new AbortController();
  const pending = client.decodeAtlas(sprite(), { signal: controller.signal });
  assert.equal(sent.operation, "decodePillowBc3");
  assert.equal(sent.descriptor.width, 136);
  assert.equal(sent.source.length, 16);
  controller.abort();
  await assert.rejects(pending, /CANCELLED/);
  assert.equal(terminated, true);
});
