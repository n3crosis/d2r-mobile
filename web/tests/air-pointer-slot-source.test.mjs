import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../toolchain/metal-air-compiler/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const hash = (source) => createHash("sha256").update(source).digest("hex");

// Source identity/coverage checks only: no native opt, verifier or compiler is run.
test("typed pointer-slot correction is a separately authenticated 0107 delta", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  const path = "patches/0107-a2flo-typed-constant-pointer-slots.patch";
  const patch = await read(path);
  const expected = "a347fbee6ebebf76a8eae835d3bcbfaff8a4082651c2e42d6a0f980b867c27ec";
  assert.equal(manifest.patches.length, 7);
  assert.deepEqual(manifest.patches.at(-1), { path, sha256: expected });
  assert.equal(hash(patch), expected);
  assert.deepEqual(
    [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]),
    ["llvm/lib/Transforms/LibFloor/PointerBCFixup.cpp"],
  );
  assert.equal(
    manifest.patchedFiles["llvm/lib/Transforms/LibFloor/PointerBCFixup.cpp"],
    "ba5027343c6a94449107c7070bdb762536d14fd88d48cad9fc2367402bf6fc6d",
  );
  assert.equal(
    hash(await read("patches/0106-a2flo-corpus-compiler-fixes.patch")),
    "70e7f251eb79ef54d6725d314d0199fe813d11bba0294e349e6a9c3008976867",
    "writer and earlier corrections remain byte-identical",
  );
});

test("native slot matrix retains ten positive functions and fourteen isolated rejections", async () => {
  const matrix = await read("fixtures/metal-constant-pointer-slots.ll");
  assert.equal(hash(matrix), "19e7d4f50c6fdac5ae55799f2d8114886d97d3e780289cccca444922297a87b8");
  const split = matrix.split(/^;--- (.+)\n/gm);
  const modules = new Map();
  for (let i = 1; i < split.length; i += 2) modules.set(split[i], split[i + 1]);
  const rejected = [
    "unknown_slot",
    "raw_byte_slot",
    "nonzero_pointer_field",
    "wrong_inner_as",
    "unproved_addrspacecast",
    "wrong_layout",
    "empty_slot_array",
    "volatile_slot",
    "atomic_slot",
    "shifted_reverse",
    "nonexact_reverse",
    "native_escape",
    "native_write",
    "padded_wrapper",
  ].map((name) => `${name}.ll`);
  assert.deepEqual([...modules.keys()], ["slots.ll", ...rejected]);
  const functions = [...modules.get("slots.ll").matchAll(/^define .+ @([^ (]+)\(/gm)].map(
    (match) => match[1],
  );
  assert.deepEqual(functions, [
    "direct_slot",
    "folded_record",
    "nested_slot",
    "vector_slot",
    "scalar_slot",
    "exact_reverse_mixed",
    "exact_reverse_native_only",
    "shared_slot_cast",
    "shared_consumed_slot",
    "native_recast_crosslink",
  ]);
  assert.deepEqual(
    [...matrix.matchAll(/^; POS-LABEL: define floor_fragment .+ @([^ (]+)\(/gm)].map(
      (match) => match[1],
    ),
    functions,
  );
  const negativeRuns = [
    ...matrix.matchAll(
      /^; RUN: not opt .+ %t\/([^ ]+) 2>&1 \| FileCheck %s --check-prefix=([^\n]+)$/gm,
    ),
  ];
  assert.deepEqual(
    negativeRuns.map((match) => match[1]),
    rejected,
  );
  for (const [, name, prefix] of negativeRuns) {
    assert.equal([...modules.get(name).matchAll(/^define /gm)].length, 1);
    assert(modules.get(name).includes(" = select "), name);
    assert(matrix.includes(`; ${prefix}: invalid pointer bitcast:`), prefix);
  }
  assert(matrix.includes("opt -enable-new-pm=0 -PointerBCFixup -verify -S %t/slots.ll"));
  assert(matrix.includes("--implicit-check-not='= bitcast"));
  assert(matrix.includes("--implicit-check-not='= load"));
});

test("demonstrated pointer-slot MSL input is authenticated in the strict real-WASM canary", async () => {
  const filename = "retyped-buffer-pointer-load.metal";
  const source = await read(`fixtures/${filename}`);
  const expected = "57f26a87e4b72aab90afb09caf9f650ddac7d7f025fd29bdfbabce9c46fa536e";
  assert.equal(hash(source), expected);
  assert(source.includes("fragment float4 retyped_buffer_pointer_load("));
  const canary = await read("ci-compile-canary.mjs");
  assert.match(
    canary,
    /stage: "fragment",\s*filename: "retyped-buffer-pointer-load\.metal",\s*entry: "retyped_buffer_pointer_load",\s*sha256: "57f26a87e4b72aab90afb09caf9f650ddac7d7f025fd29bdfbabce9c46fa536e",\s*define: ""/,
  );
  assert(
    canary.includes(
      'assert.equal(sourceSha256, fixture.sha256, "reviewed pointer-slot fixture identity")',
    ),
  );
  assert(canary.indexOf("if (fixture.sha256)") < canary.indexOf("output = adapter.compile(source"));
  assert.match(
    canary,
    /inspectCompiledMetalLibrary\(output.bytes,\s*\{\s*entry: fixture.entry \?\? "main0",\s*stage: fixture.stage,\s*minimumOS: \[18, 0\],\s*languageVersion: \[3, 2\],\s*metadataLengthIncludesPrefix: false/,
  );
  assert(
    !canary.includes("metal-constant-pointer-slots.ll"),
    "raw IR is not executed by the MSL API canary",
  );
});
