// Source/checker tests only. These do not execute a compiler or prove AIR acceptance.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { sourceReviewOptions, readForkSource } from "./fixtures/air-fork-source/fork-source.mjs";
import { checkFragmentInputLiveness } from "../toolchain/metal-air-compiler/check-fragment-input-liveness.mjs";

function syntheticIR(keepVarying, keepPosition = keepVarying) {
  const unusedVarying = keepVarying ? "" : ', !"air.arg_unused"';
  const unusedPosition = keepPosition ? "" : ', !"air.arg_unused"';
  let value = "%sum";
  const body = [];
  if (keepVarying) {
    body.push(`  %sum1 = fadd <4 x float> ${value}, %in.1`);
    value = "%sum1";
  }
  if (keepPosition) {
    body.push(`  %sum2 = fadd <4 x float> ${value}, %in.2`);
    value = "%sum2";
  }
  body.push(`  ret <4 x float> ${value}`);
  return `define <4 x float> @fragment_input_liveness(<4 x float> %in.0, <4 x float> %in.1, <4 x float> %in.2, <4 x float> addrspace(2)* %bias, <4 x float> addrspace(2)* %untouched) {
entry:
  %loaded = load <4 x float>, <4 x float> addrspace(2)* %bias
  %sum = fadd <4 x float> %in.0, %loaded
${body.join("\n")}
}
!air.fragment = !{!0}
!0 = !{<4 x float> (<4 x float>, <4 x float>, <4 x float>, <4 x float> addrspace(2)*, <4 x float> addrspace(2)*)* @fragment_input_liveness, !1, !2}
!1 = !{!3}
!2 = !{!4, !5, !6, !7, !8}
!3 = !{i32 0, !"air.render_target", i32 0, i32 0, !"air.arg_type_name", !"float4", !"air.arg_name", !"color"}
!4 = !{i32 0, !"air.fragment_input", !"user(locn7)", !"air.flat", !"air.arg_type_name", !"float4", !"air.arg_name", !"kept"}
!5 = !{i32 1, !"air.fragment_input", !"user(locn11)", !"air.flat", !"air.arg_type_name", !"float4", !"air.arg_name", !"optionalValue"${unusedVarying}}
!6 = !{i32 2, !"air.position", !"air.center", !"air.no_perspective", !"air.arg_type_name", !"float4", !"air.arg_name", !"position"${unusedPosition}}
!7 = !{i32 3, !"air.buffer", !"air.location_index", i32 9, i32 1, !"air.read", !"air.address_space", i32 2, !"air.arg_type_name", !"float4", !"air.arg_name", !"bias"}
!8 = !{i32 4, !"air.buffer", !"air.location_index", i32 13, i32 1, !"air.read", !"air.address_space", i32 2, !"air.arg_type_name", !"float4", !"air.arg_name", !"untouched"}
`;
}

test("checker follows entry metadata and distinguishes live/dead input descriptors", () => {
  for (const keepVarying of [false, true]) {
    for (const keepPosition of [false, true]) {
      const result = checkFragmentInputLiveness(syntheticIR(keepVarying, keepPosition), {
        keepVarying,
        keepPosition,
      });
      assert.deepEqual(result.argumentUsed, [true, keepVarying, keepPosition, true, false]);
      if (keepVarying !== keepPosition)
        assert.throws(() =>
          checkFragmentInputLiveness(syntheticIR(keepVarying, keepPosition), {
            keepVarying: keepPosition,
            keepPosition: keepVarying,
          }),
        );
    }
  }
});

test("checker rejects missing, duplicate, misplaced and inappropriate unused markers", () => {
  const ir = syntheticIR(false);
  for (const invalid of [
    ir.replaceAll(', !"air.arg_unused"', ""),
    ir.replace(
      '!"optionalValue", !"air.arg_unused"',
      '!"optionalValue", !"air.arg_unused", !"air.arg_unused"',
    ),
    ir.replace(
      '!"air.arg_name", !"optionalValue", !"air.arg_unused"',
      '!"air.arg_unused", !"air.arg_name", !"optionalValue"',
    ),
    ir.replace('!"kept"}', '!"kept", !"air.arg_unused"}'),
    ir.replace('!"untouched"}', '!"untouched", !"air.arg_unused"}'),
    ir.replace('!"color"}', '!"color", !"air.arg_unused"}'),
  ])
    assert.throws(() => checkFragmentInputLiveness(invalid));
  assert.throws(() => checkFragmentInputLiveness(ir, { keepAll: true }));
});

test("checker rejects changed indices, semantics, interpolation, types and bindings", () => {
  const ir = syntheticIR(false);
  for (const [before, after] of [
    ["!5 = !{i32 1,", "!5 = !{i32 4,"],
    ['!"user(locn11)"', '!"user(locn12)"'],
    ['!"air.flat"', '!"air.perspective"'],
    ['!"air.no_perspective"', '!"air.perspective"'],
    ['!"air.position"', '!"air.point_coord"'],
    [
      '!"air.arg_type_name", !"float4", !"air.arg_name", !"position"',
      '!"air.arg_type_name", !"half4", !"air.arg_name", !"position"',
    ],
    ['!"air.location_index", i32 13', '!"air.location_index", i32 12'],
    ['!"air.address_space", i32 2', '!"air.address_space", i32 1'],
    ["!2 = !{!4, !5, !6, !7, !8}", "!2 = !{!4, !6, !5, !7, !8}"],
  ])
    assert.throws(() => checkFragmentInputLiveness(ir.replace(before, after)));
});

test("checker rejects signature changes and markers contradicting final parameter uses", () => {
  const ir = syntheticIR(false);
  for (const invalid of [
    ir.replace("<4 x float> %in.1, ", ""),
    ir.replace("<4 x float> %in.2", "<2 x float> %in.2"),
    ir.replace("%sum = fadd <4 x float> %in.0, %loaded", "%sum = fadd <4 x float> %in.1, %loaded"),
    ir.replace(
      "ret <4 x float> %sum",
      "%unexpected = fadd <4 x float> %in.2, %sum\n  ret <4 x float> %unexpected",
    ),
    ir.replace("addrspace(2)* %bias\n", "addrspace(2)* %untouched\n"),
  ])
    assert.throws(() => checkFragmentInputLiveness(invalid));
});

test("checker will not accept orphan matching descriptors or another entry/stage", () => {
  const ir = syntheticIR(false);
  for (const invalid of [
    ir.replace("!air.fragment = !{!0}", "!air.vertex = !{!0}"),
    ir.replace("!air.fragment = !{!0}", "!air.fragment = !{!0, !0}"),
    ir.replace("!0 = !{", "!99 = !{"),
    ir.replace("@fragment_input_liveness, !1, !2", "@another_entry, !1, !2"),
    ir.replace("!2 = !{!4, !5, !6, !7, !8}", "!2 = !{!4, !99, !6, !7, !8}"),
    ir + "!4 = !{i32 0}\n",
  ])
    assert.throws(() => checkFragmentInputLiveness(invalid));
});

test(
  "authenticated fork source runs narrow finalization after optimization and before verifier/output",
  sourceReviewOptions,
  async () => {
    const source = await readForkSource("wasm/api/air_compiler.cpp");
    const helper = source.slice(
      source.indexOf("bool finalizeFragmentInputLiveness("),
      source.indexOf("bool hasEntry("),
    );
    assert.match(helper, /getNamedMetadata\("air\.fragment"\)/);
    assert.match(
      helper,
      /semantic->getString\(\) != "air\.fragment_input" &&\s*semantic->getString\(\) != "air\.position"/,
    );
    assert.match(helper, /index->getValue\(\)\.uge\(function->arg_size\(\)\)/);
    assert.match(helper, /function->getArg\(unsigned\(index->getZExtValue\(\)\)\)->use_empty\(\)/);
    assert.match(helper, /if \(alreadyUnused\) continue;/);
    assert.match(
      helper,
      /for \(const auto &field : input->operands\(\)\) fields.push_back\(field.get\(\)\);\s*fields.push_back\(llvm::MDString::get\(context, "air.arg_unused"\)\);/,
    );
    assert.match(helper, /entryFields\[2\] = llvm::MDNode::get\(context, newInputs\);/);
    assert.doesNotMatch(
      helper,
      /replaceAllUsesWith|replaceOperandWith|mutateType|mutateFunctionType|removeArg|setAttributes|air\.vertex|air\.kernel|air\.function_constants/,
    );
    const positions = [
      "compiler.ExecuteAction(action)",
      "auto module = action.takeModule();",
      "if (!finalizeFragmentInputLiveness(*module))",
      "if (llvm::verifyModule(*module, &errors))",
      "if (!validControlStages(*module))",
      "Output output(result->data);",
      "if (output_kind == AIR_LLVM_TEXT)",
      "writerSucceeded = llvm::WriteMetalLibToFile(*module, output);",
    ].map((needle) => source.indexOf(needle));
    assert(positions.every((p, i) => p >= 0 && (i === 0 || positions[i - 1] < p)));
  },
);

test("authored fixture keeps identical live/dead interfaces and out-of-scope resource", () => {
  const source = readFileSync(
    new URL(
      "../toolchain/metal-air-compiler/fixtures/msl-fragment-input-liveness.metal",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /optionalValue \[\[user\(locn11\), flat\]\]/);
  assert.match(source, /position \[\[position\]\]/);
  assert.match(source, /\*untouched \[\[buffer\(13\)\]\]/);
  assert.match(
    source,
    /#if LIVENESS_KEEP_VARYING && LIVENESS_KEEP_POSITION\s+color \+= input.optionalValue \+ input.position;/,
  );
  assert.match(source, /float4 discarded = input.optionalValue \+ input.position;/);
  assert.match(source, /#elif LIVENESS_KEEP_VARYING\s+color \+= input.optionalValue;/);
  assert.match(source, /#elif LIVENESS_KEEP_POSITION\s+color \+= input.position;/);
});

// Canary wiring remains covered by air-header-operations.test.mjs.
