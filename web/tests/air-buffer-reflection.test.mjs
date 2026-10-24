// 仅测试合成元数据解析，不执行编译器，也不提供 AIR 证据。
// Synthetic metadata parser checks only, not compiler execution or AIR evidence.
import assert from "node:assert/strict";
import test from "node:test";
import {
  checkReflection,
  readReflection,
  checkFloat3Storage,
} from "../toolchain/metal-air-compiler/check-buffer-reflection.mjs";

const fixture = {
  entry: "reflection_parser",
  buffer: {
    name: "source",
    binding: 0,
    addressSpace: 2,
    size: 48,
    align: 16,
    fields: [
      { name: "tag", offset: 0, size: 4, count: 0 },
      {
        name: "items",
        offset: 16,
        size: 16,
        count: 2,
        children: [{ name: "payload", offset: 0, size: 16, count: 0 }],
      },
    ],
  },
};
const ir = `define void @reflection_parser() { ret void }
!air.kernel = !{!0}
!0 = !{!1}
!1 = !{i32 0, !"air.buffer", !"air.location_index", i32 0, !"air.address_space", i32 2, !"air.arg_type_size", i32 48, !"air.buffer_size", i32 48, !"air.arg_type_align_size", i32 16, !"air.arg_name", !"source", !"air.struct_type_info", !2}
!2 = !{i32 0, i32 4, i32 0, !"uint", !"tag", !"air.struct_type_info", !3, i32 16, i32 16, i32 2, !"Element", !"items"}
!3 = !{i32 0, i32 16, i32 0, !"float4", !"payload"}
`;

test("reflection parser checks exact buffer and recursive array descriptors", () => {
  checkReflection(ir, fixture);
  assert.deepEqual(readReflection(ir, fixture), { ...fixture.buffer, bufferSize: 48 });
});

test("reflection checks reject wrong offsets, strides, counts, sizes, binding and alignment", () => {
  for (const [before, after] of [
    ['i32 16, i32 16, i32 2, !"Element"', 'i32 4, i32 16, i32 2, !"Element"'],
    ['i32 16, i32 16, i32 2, !"Element"', 'i32 16, i32 12, i32 2, !"Element"'],
    ['i32 16, i32 16, i32 2, !"Element"', 'i32 16, i32 16, i32 3, !"Element"'],
    ['!"air.arg_type_size", i32 48', '!"air.arg_type_size", i32 64'],
    ['!"air.buffer_size", i32 48', '!"air.buffer_size", i32 64'],
    ['!"air.arg_type_align_size", i32 16', '!"air.arg_type_align_size", i32 4'],
    ['!"air.location_index", i32 0', '!"air.location_index", i32 1'],
    ['!"air.address_space", i32 2', '!"air.address_space", i32 1'],
  ])
    assert.throws(() => checkReflection(ir.replace(before, after), fixture));
});

test("reflection parser rejects missing stage, entry, unique buffer and referenced fields", () => {
  for (const invalid of [
    ir.replace("!air.kernel", "!other"),
    ir.replace("@reflection_parser(", "@unexpected("),
    ir.replace('!"source"', '!"other"'),
    ir.replace('!"air.struct_type_info", !2', '!"air.struct_type_info", !99'),
    ir +
      ir
        .split("\n")
        .find((line) => line.startsWith("!1 ="))
        .replace("!1 =", "!4 ="),
  ])
    assert.throws(() => readReflection(invalid, fixture));
});

// 手写的解析输入，不是编译器结果或已编译参考产物。
// Hand-authored parser input, not a compiler result or a compiled reference.
const storage = `target datalayout = "e-p:64:64:64-i8:8:8-i32:32:32-f32:32:32-v96:128:128"
%struct.PaddedVectorLayout = type { i32, <3 x float>, [2 x <3 x float>], i32, [12 x i8] }
define void @reflection_float3(%struct.PaddedVectorLayout addrspace(2)* align 16 dereferenceable(80) %source, <4 x float> addrspace(1)* %output) {
  %direction = getelementptr inbounds %struct.PaddedVectorLayout, %struct.PaddedVectorLayout addrspace(2)* %source, i32 0, i32 1
  %path = getelementptr inbounds %struct.PaddedVectorLayout, %struct.PaddedVectorLayout addrspace(2)* %source, i32 0, i32 2, i32 1
  %state = getelementptr inbounds %struct.PaddedVectorLayout, %struct.PaddedVectorLayout addrspace(2)* %source, i32 0, i32 0
  %tail = getelementptr inbounds %struct.PaddedVectorLayout, %struct.PaddedVectorLayout addrspace(2)* %source, i32 0, i32 3
  %a = load <3 x float>, <3 x float> addrspace(2)* %direction, align 16
  %b = load <3 x float>, <3 x float> addrspace(2)* %path, align 16
  %c = load i32, i32 addrspace(2)* %state, align 16
  %d = load i32, i32 addrspace(2)* %tail, align 16
  ret void
}
`;

test("float3 storage parser derives allocation and source addresses from type syntax", () => {
  checkFloat3Storage(storage);
  checkFloat3Storage(storage.replace(", i32, [12 x i8] }", ", i32 }"));
});

test("float3 storage rejects stale padding, wrong stride, wrong GEPs and absent evidence", () => {
  for (const invalid of [
    storage.replace(
      "i32, <3 x float>, [2 x <3 x float>], i32, [12 x i8]",
      "i32, [12 x i8], <3 x float>, [4 x i8], [2 x <3 x float>], [8 x i8], i32, [12 x i8]",
    ),
    storage.replace("v96:128:128", "v96:8:8"),
    storage.replace('target datalayout = "e-', 'target datalayout = "e-a:256:256-'),
    storage.replace('target datalayout = "e-', 'target datalayout = "e-a0:256:256-'),
    storage.replace("i32 2, i32 1", "i32 2, i32 0"),
    storage.replace("i32 0, i32 3", "i32 1, i32 3"),
    storage.replace("i32 0, i32 3", "i32 0, i32 4"),
    storage.replace("i32 2, i32 1", "i32 2, i32 2"),
    storage.replace("@reflection_float3", "@other"),
    storage.replace("v96:128:128", ""),
    storage.replace("%struct.PaddedVectorLayout = type", "%other = type"),
    storage.replace("* %path, align", "* %direction, align"),
    storage.replace("* %state, align", "* %other, align"),
    storage.replace(
      "  ret void",
      "  %extra = bitcast %struct.PaddedVectorLayout addrspace(2)* %source to i8 addrspace(2)*\n  ret void",
    ),
  ])
    assert.throws(() => checkFloat3Storage(invalid));
});
