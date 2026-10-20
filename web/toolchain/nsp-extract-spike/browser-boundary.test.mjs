import test from "node:test";
import assert from "node:assert/strict";
import { createBoundary } from "./browser-boundary.mjs";

test("native key bridge accepts an empty title file and wipes temporary files and input arrays", async () => {
  const previous = globalThis.FileReaderSync;
  globalThis.FileReaderSync = class {};
  const files = new Map();
  const writes = [];
  let loaded = false;
  try {
    const boundary = await createBoundary(async () => ({
      FS: {
        mkdir() {},
        writeFile(path, bytes) {
          const contents = bytes.slice();
          files.set(path, { contents });
          writes.push(contents);
        },
        lookupPath(path) {
          if (!files.has(path)) throw new Error("Not found");
          return { node: files.get(path) };
        },
        unlink(path) {
          files.delete(path);
        },
        readdir() {
          return [...files.keys()];
        },
      },
      _nsp_load_keys() {
        assert.ok(files.get("/secret/prod.keys").contents.length > 0);
        assert.equal(files.get("/secret/title.keys").contents.length, 0);
        loaded = true;
        return 0;
      },
      _nsp_reset() {},
      ccall() {
        return -6;
      },
      HEAPU8: new Uint8Array(16),
    }));
    const prod = new TextEncoder().encode(`header_key = ${"12".repeat(32)}\n`);
    const title = new Uint8Array();
    assert.equal(boundary.loadKeys(prod, title), 0);
    assert.equal(loaded, true);
    assert.equal(boundary.secretFilesPresent(), false);
    assert.throws(() => boundary.open(0), /^Error: TITLE_KEY_REQUIRED$/);
    assert.ok([prod, ...writes].every((bytes) => bytes.every((value) => value === 0)));
    boundary.dispose();
  } finally {
    if (previous === undefined) delete globalThis.FileReaderSync;
    else globalThis.FileReaderSync = previous;
  }
});
