// 合成 API 存在性检查，不访问浏览器权限或更改共享全局对象。
// Synthetic API presence checks do not access browser permissions or alter shared globals.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { assertBrowserPackagerCapabilities } from "../browser-packager.mjs";

function supported() {
  const unused = () => assert.fail("presence check must not invoke APIs");
  return {
    isSecureContext: true,
    navigator: { storage: { getDirectory: unused, estimate: unused } },
    Worker: unused,
    DecompressionStream: class {
      constructor(format) {
        assert.equal(format, "gzip");
      }
    },
    crypto: { subtle: {}, randomUUID: unused },
    AbortSignal: { any: unused, prototype: { throwIfAborted: unused } },
  };
}

test("complete capability surface passes without requesting permissions or reading input", () => {
  assert.doesNotThrow(() => assertBrowserPackagerCapabilities(supported()));
});

test("missing or non-callable required methods use the existing unsupported code", () => {
  for (const path of [
    ["navigator", "storage", "getDirectory"],
    ["navigator", "storage", "estimate"],
    ["Worker"],
    ["DecompressionStream"],
    ["crypto", "randomUUID"],
    ["AbortSignal", "any"],
    ["AbortSignal", "prototype", "throwIfAborted"],
  ]) {
    for (const value of [undefined, null, true, {}]) {
      const environment = supported();
      let owner = environment;
      for (const key of path.slice(0, -1)) owner = owner[key];
      owner[path.at(-1)] = value;
      assert.throws(() => assertBrowserPackagerCapabilities(environment), {
        message: "BROWSER_UNSUPPORTED",
      });
    }
  }
});

test("missing parent objects and insecure contexts reject without ReferenceError", () => {
  for (const override of [
    { isSecureContext: false },
    { navigator: undefined },
    { navigator: {} },
    { crypto: undefined },
    { crypto: { randomUUID() {} } },
    { AbortSignal: undefined },
    { AbortSignal: { any() {} } },
  ]) {
    assert.throws(() => assertBrowserPackagerCapabilities({ ...supported(), ...override }), {
      message: "BROWSER_UNSUPPORTED",
    });
  }
});

test("production bootstrap checks capabilities before runtime setup and private input methods", async () => {
  const source = await readFile(new URL("../browser-packager.mjs", import.meta.url), "utf8");
  const start = source.indexOf("export async function prepareBrowserPackager(");
  const check = source.indexOf("assertBrowserPackagerCapabilities();", start);
  const setup = source.indexOf("await prepareSealedRuntime(", start);
  const profile = source.indexOf("await loadProductionProfile(", setup);
  assert.ok(start >= 0 && check > start && setup > check && profile > setup);
  assert.equal(source.slice(start, check).includes("await "), false);
});

test("gzip constructor rejection uses the existing unsupported code", () => {
  for (const DecompressionStream of [
    () => undefined,
    class {
      constructor() {
        throw new TypeError("unsupported gzip");
      }
    },
  ]) {
    assert.throws(
      () => assertBrowserPackagerCapabilities({ ...supported(), DecompressionStream }),
      { message: "BROWSER_UNSUPPORTED" },
    );
  }
});
