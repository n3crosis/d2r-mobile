import test from "node:test";
import { readFile } from "node:fs/promises";
import createModule from "./dist/texture.mjs";
import { conformance } from "./conformance.mjs";
test("bounded NVN native/WASM synthetic differential corpus", async () => {
  const fixtures = JSON.parse(
    await readFile(new URL("./.build/fixtures.json", import.meta.url), "utf8"),
  );
  const wasmBinary = await readFile(new URL("./dist/texture.wasm", import.meta.url));
  await conformance(createModule, fixtures, { wasmBinary });
});
