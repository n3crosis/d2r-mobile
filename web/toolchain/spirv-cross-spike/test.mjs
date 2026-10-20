import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { validateSpirv, convertSpirv, MSL_ARGUMENTS, CROSS_COMMIT } from "./wwwroot/convert.mjs";
import { replayFields } from "./wwwroot/replay-reflection.mjs";
import { cases } from "./reflection-cases.mjs";
const valid = new Uint8Array(new Uint32Array([0x07230203, 0x10000, 0, 1, 0]).buffer);
test("malformed and non-word SPIR-V rejected before module loading", () => {
  for (const value of [null, new Uint8Array(), new Uint8Array(21), new Uint8Array(20)])
    assert.throws(() => validateSpirv(value));
  const bad = new Uint8Array(24);
  bad.set(valid);
  assert.throws(() => validateSpirv(bad));
  assert.notEqual(validateSpirv(valid), valid);
});
test("byte API invokes exact native flags, isolates calls, preserves hashes and failure", async () => {
  const calls = [];
  let instances = 0;
  const factory = async () => {
    instances++;
    const files = new Map();
    return {
      FS: {
        writeFile: (p, v) => files.set(p, v),
        readFile: (p) => files.get(p),
        unlink: (p) => files.delete(p),
      },
      callMain(args) {
        calls.push(args);
        files.set(
          args.at(-1),
          args.includes("--msl") ? "kernel void main0() {}\r\n" : '{"entryPoints":[]}\n',
        );
        return 0;
      },
    };
  };
  const result = await convertSpirv(valid, {
    factory,
    replayContext: { stage: "cs", resources: { sbufs: [] } },
  });
  assert.equal(instances, 2);
  assert.deepEqual(calls[0].slice(0, -3), MSL_ARGUMENTS);
  assert.deepEqual(calls[1], ["--reflect", "json", "/input.spv", "--output", "/reflection.json"]);
  assert.equal(result.msl, "kernel void main0() {}\n");
  assert.equal(result.replay.entry, "main0");
  assert.match(result.provenance.inputSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.provenance.nativeChainClaimed, false);
  await assert.rejects(
    convertSpirv(valid, {
      factory: async () => ({ FS: { writeFile() {}, unlink() {} }, callMain: () => 1 }),
    }),
    /exited 1/,
  );
});
test("replay parser equals unchanged native Python functions on authored branch corpus", () => {
  const native = spawnSync("python3", [new URL("./native-oracle.py", import.meta.url).pathname], {
    input: JSON.stringify(cases),
    encoding: "utf8",
  });
  assert.equal(native.status, 0, native.stderr);
  assert.deepEqual(
    cases.map((x) => replayFields(x.stage, x.msl, x.resources)),
    JSON.parse(native.stdout),
  );
});

test("native, WASM and linked CI use the same verified release compiler pin", () => {
  const lock = JSON.parse(readFileSync(new URL("./toolchain-lock.json", import.meta.url), "utf8"));
  assert.equal(lock.spirvCross.tag, "vulkan-sdk-1.4.363.0");
  assert.equal(lock.spirvCross.commit, "f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7");
  assert.equal(CROSS_COMMIT, lock.spirvCross.commit);
  for (const file of [
    "./build.sh",
    "../../../.github/workflows/spirv-cross-browser-checks.yml",
    "../../../.github/workflows/shader-pipeline-browser-checks.yml",
  ]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.ok(source.includes(lock.spirvCross.commit), `${file}: commit drift`);
    if (file.endsWith(".yml"))
      assert.ok(source.includes(lock.spirvCross.tag), `${file}: tag drift`);
  }
});
