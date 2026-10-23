import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../toolchain/metal-air-compiler/", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");
const hash = (data) => createHash("sha256").update(data).digest("hex");

// Source-only assertions: no compiler, LLVM parser/verifier or generated shader runs.
test("scalar i1 conversion hardening has an exact isolated 0110 source boundary", async () => {
  const manifest = JSON.parse(await read("manifest.json"));
  const path = "patches/0110-a2flo-scalar-i1-conversions.patch";
  const sha256 = "1e41886634d829084a3752d56723e38b55ff20dd75649510be6c4be446ca0c82";
  const patch = await read(path);
  assert.equal(manifest.patches.length, 10);
  assert.deepEqual(manifest.patches[9], { path, sha256 });
  assert.equal(hash(patch), sha256);
  assert.deepEqual(
    [...patch.matchAll(/^\+\+\+ b\/(.+)$/gm)].map((match) => match[1]),
    ["llvm/lib/Transforms/LibFloor/MetalFinal.cpp"],
  );
  assert.equal(
    manifest.patchedFiles["llvm/lib/Transforms/LibFloor/MetalFinal.cpp"],
    "b7f8c3d17df3fddea4e87cd8a6fc2ac6ed0d53531714f9403b73ab72f3c39973",
  );
  for (const invariant of [
    "llvm::Value* conv_instr = nullptr",
    "cast_op == Instruction::SIToFP || cast_op == Instruction::UIToFP",
    "from->getType()->isIntegerTy(1)",
    "to_type->isHalfTy() || to_type->isFloatTy() || to_type->isDoubleTy()",
    "ConstantFP::get(to_type, cast_op == Instruction::SIToFP ? -1.0 : 1.0)",
    "ConstantFP::get(to_type, 0.0)",
    "conv_instr = call_conversion_func<cast_op>(I.getOperand(0), I.getDestTy())",
    "if (auto* inst = dyn_cast<Instruction>(conv_instr))",
    "inst->setDebugLoc(I.getDebugLoc())",
  ])
    assert(patch.includes(invariant), invariant);
  assert(patch.indexOf("I.replaceAllUsesWith(conv_instr)") < patch.indexOf("I.eraseFromParent()"));
  assert(patch.includes("was_modified = true"));
  assert.equal(
    hash(await read("api/air_compiler.cpp")),
    "fce9a24557cca900398b2e7b9afbb853297a5d8bd034616d9c80b89a9d20981b",
  );
  assert.equal(
    hash(await read("ci-compile-canary.mjs")),
    "19415766142c77a9443478e74d5413a300397c28a1a0395b2f99d22d3547eeca",
  );
  assert.equal(
    hash(await readFile(new URL("../../.github/workflows/verify.yml", import.meta.url))),
    "12aad45d6fa09d8c9b9a74752f5d4d9526659d44402e7bf779dd20b83eacbe73",
  );
});

test("25 scalar i1 cases are frozen authored symbolic shapes, not compiler output", async () => {
  const files = {
    "fixtures/scalar-i1-conversions.ll":
      "38a92cd67dd7522aeab39b8af191a4e02253d193c097b27c8d4cfdb80f06e4e5",
    "fixtures/scalar-i1-conversions.expected.ll":
      "1c562583db1b9180d54706f8f67db369fba1eb1000ea6459e15f1671a1eac21a",
    "fixtures/scalar-i1-conversions.json":
      "06a74555c99c67bf8093f8f440909653343abc36bfb15f11bdbd18767f1f6613",
  };
  const sources = {};
  for (const [path, expected] of Object.entries(files)) {
    sources[path] = await read(path);
    assert.equal(hash(sources[path]), expected, path);
  }
  const input = sources["fixtures/scalar-i1-conversions.ll"];
  const expected = sources["fixtures/scalar-i1-conversions.expected.ll"];
  const cases = JSON.parse(sources["fixtures/scalar-i1-conversions.json"]);
  assert.equal(cases.kind, "hand-authored-symbolic-shapes");
  assert.equal(cases.compilerExecuted, false);
  assert.equal(cases.llvmVerified, false);
  const names = [
    "signed_half",
    "signed_float",
    "signed_double",
    "signed_true",
    "signed_false",
    "signed_poison",
    "signed_undef",
    "unsigned_half",
    "unsigned_float",
    "unsigned_double",
    "unsigned_true",
    "unsigned_false",
    "unsigned_poison",
    "unsigned_undef",
    "frozen_input",
    "adjacent_debug_multiuse",
    "vector_signed",
    "vector_unsigned",
    "vector_one_signed",
    "signed_i8",
    "unsigned_i64",
    "unsupported_bfloat",
    "unsupported_fp128",
    "reverse_signed",
    "reverse_unsigned",
  ];
  assert.deepEqual(
    cases.cases.map((entry) => entry.name),
    names,
  );
  for (const source of [input, expected]) {
    assert.deepEqual(
      [...source.matchAll(/^define .+ @([^ (]+)\(/gm)].map((match) => match[1]),
      names,
    );
    assert.doesNotMatch(source, /^; RUN:/m);
    assert(source.includes("Hand-authored symbolic fixtures, not captured compiler output"));
  }
  for (const type of ["half", "float", "double"])
    for (const sign of ["-", ""])
      assert(expected.includes(`select i1 %b, ${type} ${sign}1.000000e+00, ${type} 0.000000e+00`));
  assert(expected.includes("ret float poison"));
  assert(expected.includes("freeze i1"));
  assert(!(await read("ci-compile-canary.mjs")).includes("scalar-i1-conversions"));
});
