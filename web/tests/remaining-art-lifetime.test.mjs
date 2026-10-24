// 合成生命周期及别名测试；不测量浏览器内存或真实图像兼容性。
// Synthetic lifetime and alias tests; no browser memory or real-image compatibility measurement.
import test from "node:test";
import assert from "node:assert/strict";
import { generateRemainingArt, createRemainingArtOwnedBytes } from "../remaining-art-generator.mjs";

test("stage release preserves earlier shared buffers and explicit aliases", () => {
  const owned = createRemainingArtOwnedBytes(),
    shared = new Uint8Array([1]),
    temp = new Uint8Array([2]),
    personal = new Uint8Array([3]);
  owned.add(shared);
  const before = owned.snapshot();
  owned.add(new Uint8Array(shared.buffer));
  owned.add(temp);
  owned.add(new Uint8Array(temp.buffer));
  owned.add(personal);
  owned.releaseSince(before, [new Uint8Array(personal.buffer)]);
  assert.equal(shared[0], 1);
  assert.equal(temp[0], 0);
  assert.equal(personal[0], 3);
  owned.release(personal);
  owned.release(personal);
  assert.equal(personal[0], 0);
  owned.dispose();
  assert.equal(shared[0], 0);
});
test("actual generator releases intermediates while preserving shared inputs, vault round trip and returned copies", async () => {
  let main, wide, personal, previousRgba, previousLinear;
  const shared = [],
    resultBuffers = [];
  const empty = (bytes) => assert.ok(bytes.every((value) => value === 0));
  const source = (name) => {
    const isMain = name.endsWith("/mainpanelbg.sprite");
    const storage = 181 * 28 * 512;
    const bytes = new Uint8Array(isMain ? storage + 40 : 40).fill(7);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x31417053, true);
    view.setUint16(4, 61, true);
    view.setUint16(6, isMain ? 1440 : 652, true);
    view.setUint32(8, isMain ? 2888 : 652, true);
    view.setUint32(12, isMain ? 881 : 1, true);
    view.setUint16(20, isMain ? 2 : 1, true);
    if (isMain) {
      bytes[23] = 0;
      view.setUint32(32, storage, true);
      main = bytes;
    } else shared.push(bytes);
    return bytes;
  };
  const result = await generateRemainingArt({
    logicalAssets: {
      findUniquePathSuffix: (suffix) => `data:data${suffix}`,
      async read(path) {
        if (main) empty(main);
        return source(path);
      },
    },
    async decodeAtlas(raw) {
      assert.ok(raw.some((value) => value !== 0));
      if (raw.buffer === personal?.buffer) assert.equal(personal[0], 9);
      const width =
        raw.buffer === personal?.buffer ? 652 : new DataView(raw.buffer).getUint32(8, true);
      const pixels = new Uint8Array(width * 4).fill(6);
      shared.push(pixels);
      return { width, height: 1, pixelFormat: 70, bytesPerPixel: 4, pixels };
    },
    assetWorker: {
      async run(_op, payload, { kind, name }) {
        if (previousRgba) empty(previousRgba);
        if (previousLinear) empty(previousLinear);
        if (wide) empty(wide);
        if (kind === "vault") assert.equal(personal[0], 9);
        const inputs = JSON.parse(new TextDecoder().decode(payload));
        assert.ok(Object.keys(inputs).length);
        if (name === "StashPanelBGShared")
          assert.ok(shared.every((bytes) => bytes.some((value) => value !== 0)));
        const rgba = new Uint8Array(4).fill(8);
        previousRgba = rgba;
        resultBuffers.push(rgba);
        return {
          width: 1,
          height: 1,
          files: {
            "image.rgba": rgba.buffer,
            ...(kind === "vault" ? { "VaultBottom.png": new Uint8Array([4, 5]).buffer } : {}),
          },
        };
      },
    },
    textureEncoder: {
      async packLinearBC3(value) {
        wide = value.linearBC3;
        return { sprite: new Uint8Array(40).fill(3) };
      },
      async encodeAndPack({ templateHeader, rgba }) {
        assert.ok(templateHeader.some((value) => value !== 0));
        assert.equal(rgba[0], 8);
        const sprite = new Uint8Array(40).fill(9),
          linearBC3 = new Uint8Array([2]);
        previousLinear = linearBC3;
        if (resultBuffers.length === 2) personal = sprite;
        return { sprite: sprite.buffer, linearBC3: linearBC3.buffer };
      },
    },
  });
  assert.equal(Object.keys(result.files).length, 10);
  for (const bytes of Object.values(result.files)) assert.ok(bytes.some((value) => value !== 0));
  empty(main);
  empty(wide);
  empty(personal);
  empty(previousRgba);
  empty(previousLinear);
  for (const bytes of shared) empty(bytes);
});

test("missing or malformed remaining-art RGBA wipes all other worker files", async () => {
  for (const invalid of [false, true]) {
    const first = new Uint8Array([7]),
      last = new Uint8Array([8]);
    const sources = [];
    const options = {
      logicalAssets: {
        findUniquePathSuffix: (suffix) => suffix,
        async read(path) {
          const main = path.endsWith("/mainpanelbg.sprite"),
            storage = 181 * 28 * 512;
          const data = new Uint8Array(main ? storage + 40 : 40),
            view = new DataView(data.buffer);
          view.setUint32(0, 0x31417053, true);
          view.setUint16(4, 61, true);
          view.setUint16(6, main ? 1440 : 652, true);
          view.setUint32(8, main ? 2888 : 652, true);
          view.setUint32(12, main ? 881 : 1, true);
          view.setUint16(20, main ? 2 : 1, true);
          if (main) view.setUint32(32, storage, true);
          sources.push(data);
          return data;
        },
      },
      async decodeAtlas() {
        const pixels = new Uint8Array(652 * 4).fill(6);
        sources.push(pixels);
        return { width: 652, height: 1, pixelFormat: 70, bytesPerPixel: 4, pixels };
      },
      textureEncoder: {
        async packLinearBC3() {
          return { sprite: new Uint8Array(40) };
        },
      },
      assetWorker: {
        async run() {
          return {
            files: {
              "first.png": first,
              ...(invalid ? { "image.rgba": "not bytes" } : {}),
              "VaultBottom.png": last.buffer,
            },
          };
        },
      },
    };
    await assert.rejects(generateRemainingArt(options), /REMAINING_ART_BYTES/);
    assert.deepEqual(first, new Uint8Array(1));
    assert.deepEqual(last, new Uint8Array(1));
    for (const source of sources) assert.ok(source.every((byte) => byte === 0));
  }
});
