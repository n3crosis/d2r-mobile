// 合成生命周期测试，不构成真实图像或浏览器内存证明。
// Synthetic lifecycle tests are not real-image or browser-memory proof.
import test from "node:test";
import assert from "node:assert/strict";
import {
  generateMercenaryArt,
  MERCENARY_INPUTS,
  createMercenaryOwnedBytes,
} from "../mercenary-art-generator.mjs";

test("owned alias release is idempotent and leaves independent copies intact", () => {
  const owned = createMercenaryOwnedBytes(),
    buffer = new Uint8Array([1, 2, 3, 4]);
  const alias = new Uint8Array(buffer.buffer),
    copy = buffer.slice();
  owned.add(buffer);
  owned.add(alias);
  owned.add(copy);
  owned.release(alias);
  assert.equal(owned.size, 1);
  assert.deepEqual(buffer, new Uint8Array(4));
  assert.deepEqual(copy, new Uint8Array([1, 2, 3, 4]));
  owned.release(buffer);
  assert.equal(owned.size, 1);
  owned.dispose();
  owned.dispose();
  assert.deepEqual(copy, new Uint8Array(4));
});
function fixture(failWorker = false) {
  const raw = [],
    decoded = [],
    headers = [];
  let payload;
  const names = Object.keys(MERCENARY_INPUTS);
  const logicalAssets = {
    findUniquePathSuffix(suffix) {
      return `data:data${suffix}`;
    },
    async read(path) {
      for (const value of [...raw, ...decoded]) assert.ok(value.every((byte) => byte === 0));
      const name = names.find((name) => path.endsWith(`/${name}.sprite`));
      const [width, height] = MERCENARY_INPUTS[name];
      const source = new Uint8Array(40),
        view = new DataView(source.buffer);
      view.setUint32(0, 0x31417053, true);
      view.setUint16(4, 61, true);
      view.setUint16(6, 652, true);
      view.setUint32(8, width, true);
      view.setUint32(12, height, true);
      raw.push(source);
      headers.push(source.slice());
      return source;
    },
  };
  return {
    raw,
    decoded,
    headers,
    get payload() {
      return payload;
    },
    options: {
      logicalAssets,
      async decodeAtlas(source) {
        const view = new DataView(source.buffer);
        const width = view.getUint32(8, true),
          height = view.getUint32(12, true);
        const pixels = new Uint8Array(width * height * 4).fill(7);
        decoded.push(pixels);
        return { width, height, pixelFormat: 70, bytesPerPixel: 4, pixels };
      },
      assetWorker: {
        async run(_op, bytes) {
          payload = bytes;
          assert.ok(bytes.some((byte) => byte !== 0));
          const images = JSON.parse(new TextDecoder().decode(bytes));
          assert.equal(Object.keys(images).length, 3);
          if (failWorker) throw new Error("worker failure");
          return {
            width: 652,
            height: 704,
            files: {
              "mercenary.rgba": new Uint8Array(652 * 704 * 4).fill(9),
              "HirelingInventoryBG.png": new Uint8Array([1, 2, 3]),
            },
          };
        },
      },
      textureEncoder: {
        async encodeAndPack({ templateHeader, rgba }) {
          assert.ok(payload.every((byte) => byte === 0));
          assert.deepEqual(templateHeader, headers[0]);
          assert.equal(rgba[0], 9);
          return {
            width: 652,
            height: 704,
            sprite: new Uint8Array(40).fill(3),
            linearBC3: new Uint8Array([5, 6]),
          };
        },
      },
    },
  };
}
test("sources release after snapshots, payload after consumption, template and returned copies survive", async () => {
  const f = fixture();
  const result = await generateMercenaryArt(f.options);
  assert.deepEqual(result.files["HirelingInventoryBG.png"], new Uint8Array([1, 2, 3]));
  assert.ok(result.files["HirelingInventoryBG.sprite"].every((byte) => byte === 3));
  for (const value of [...f.raw, ...f.decoded, f.payload])
    assert.ok(value.every((byte) => byte === 0));
});
test("worker rejection still releases request and sources", async () => {
  const f = fixture(true);
  await assert.rejects(generateMercenaryArt(f.options), /worker failure/);
  assert.ok(f.payload.every((byte) => byte === 0));
  for (const value of [...f.raw, ...f.decoded]) assert.ok(value.every((byte) => byte === 0));
});

test("malformed mercenary worker results wipe every returned byte buffer", async () => {
  for (const invalid of [false, true]) {
    const f = fixture(),
      first = new Uint8Array([4]),
      last = new Uint8Array([5]);
    f.options.assetWorker.run = async () => ({
      files: invalid
        ? { "mercenary.rgba": null, "HirelingInventoryBG.png": last.buffer }
        : { unexpected: first, extra: last.buffer },
    });
    await assert.rejects(generateMercenaryArt(f.options), /MERCENARY_(OUTPUT_SET|BYTES)/);
    assert.deepEqual(last, new Uint8Array(1));
    if (!invalid) assert.deepEqual(first, new Uint8Array(1));
    for (const value of [...f.raw, ...f.decoded]) assert.ok(value.every((byte) => byte === 0));
  }
});
