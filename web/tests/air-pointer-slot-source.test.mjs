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
  assert.equal(manifest.patches.length, 8);
  assert.deepEqual(manifest.patches[6], { path, sha256: expected });
  assert.equal(hash(patch), expected);
  assert.deepEqual(
    [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]),
    ["llvm/lib/Transforms/LibFloor/PointerBCFixup.cpp"],
  );
  assert.equal(
    hash(await read("patches/0106-a2flo-corpus-compiler-fixes.patch")),
    "70e7f251eb79ef54d6725d314d0199fe813d11bba0294e349e6a9c3008976867",
    "writer and earlier corrections remain byte-identical",
  );
});

test("exact inverse merges are an additive authenticated 0108 correction", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  const path = "patches/0108-a2flo-exact-inverse-pointer-merges.patch";
  const expected = "f64c9fcbdae68aa36438cadce6fdc3d034a9c8a994b78e6125c594150ccbbb6f";
  const patch = await read(path);
  assert.deepEqual(manifest.patches.at(-1), { path, sha256: expected });
  assert.equal(hash(patch), expected);
  assert.deepEqual(
    [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]),
    ["llvm/lib/Transforms/LibFloor/PointerBCFixup.cpp"],
  );
  assert.equal(
    manifest.patchedFiles["llvm/lib/Transforms/LibFloor/PointerBCFixup.cpp"],
    "42bcc31a0c12f8a41705e690c8bd0483e2e229e553b248253ead6765fe83bb84",
  );
  assert.equal(
    hash(await read("ci-compile-canary.mjs")),
    "19415766142c77a9443478e74d5413a300397c28a1a0395b2f99d22d3547eeca",
    "existing 31-call strict real-WASM canary is unchanged",
  );
});

test("native slot matrix contains seventeen positive functions and twenty-seven isolated rejections", async () => {
  const matrix = await read("fixtures/metal-constant-pointer-slots.ll");
  assert.equal(hash(matrix), "6348d48faad7a4e58f0dcab5c5cb61af1f169be8d418898207aa2b7c6dcefaa8");
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
    "inverse_mixed_nominal",
    "inverse_vector_root",
    "inverse_zero_gep",
    "inverse_shifted_gep",
    "inverse_rootless_subcycle",
    "inverse_transitive_native",
    "inverse_null_native",
    "inverse_undef_native",
    "inverse_poison_native",
    "inverse_unknown_arm",
    "inverse_scalar_view",
    "inverse_merged_escape",
    "inverse_merged_write",
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
    "inverse_root_roundtrip",
    "inverse_diamond",
    "inverse_slot_select",
    "inverse_loop",
    "inverse_duplicate_edges",
    "inverse_local_nominal_types",
    "inverse_direct_vector_slot",
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
  const inverseReasons = {
    "inverse_mixed_nominal.ll": "inverse root nominal type mismatch (bitcast)",
    "inverse_vector_root.ll": "inverse root nominal type mismatch (bitcast)",
    "inverse_zero_gep.ll": "unsupported inverse pointer input (getelementptr)",
    "inverse_shifted_gep.ll": "unsupported inverse pointer input (getelementptr)",
    "inverse_rootless_subcycle.ll": "unanchored inverse pointer cycle (phi)",
    "inverse_transitive_native.ll": "inverse root depends on rewritten native graph (bitcast)",
    "inverse_null_native.ll": "unproved inverse native root (bitcast)",
    "inverse_undef_native.ll": "unproved inverse native root (bitcast)",
    "inverse_poison_native.ll": "unproved inverse native root (bitcast)",
    "inverse_unknown_arm.ll": "unmapped argument or constant pointer root",
    "inverse_scalar_view.ll": "scalar or non-aggregate inverse pointer cast (select)",
    "inverse_merged_escape.ll": "unsupported native-view user (call)",
    "inverse_merged_write.ll": "unsupported native-view user (store)",
  };
  for (const [, name, prefix] of negativeRuns) {
    assert.equal([...modules.get(name).matchAll(/^define /gm)].length, 1);
    assert(modules.get(name).includes(" = select "), name);
    if (Object.hasOwn(inverseReasons, name))
      assert(
        matrix.includes(`; ${prefix}: constant-vector graph: ${inverseReasons[name]}\n`),
        prefix,
      );
    else assert(matrix.includes(`; ${prefix}: invalid pointer bitcast:`), prefix);
  }
  assert(matrix.includes("opt -enable-new-pm=0 -PointerBCFixup -verify -S %t/slots.ll"));
  assert(matrix.includes("--implicit-check-not='= bitcast"));
  assert(matrix.includes("--implicit-check-not='= load"));
  const retained = {
    positives: [...modules.get("slots.ll").matchAll(/^define [^\n]+\n[\s\S]*?^\}/gm)]
      .slice(0, 10)
      .map((match) => match[0]),
    negativeModules: [...modules.values()].slice(1, 15).map((body) => body.trim()),
  };
  assert.equal(
    hash(JSON.stringify(retained)),
    "af5f6bbb56ef497954369ca146b58ef335a6b9eaa291f5ee6a28810cbc5e981e",
    "original 10/14 regression bodies remain unchanged",
  );
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
