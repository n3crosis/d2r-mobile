// 验证 shader-feature-inventory 的约定与边界；依据 ../shader-feature-inventory.mjs 及本文件的测试断言。
// Verify shader-feature-inventory contracts and boundaries against ../shader-feature-inventory.mjs and this file's assertions.
import assert from "node:assert/strict";
import test from "node:test";
import { createShaderFeatureInventory } from "../shader-feature-inventory.mjs";

test("inventories generated ABI features and variants without retaining identifiers", () => {
  const inventory = createShaderFeatureInventory();
  inventory.add(
    `
    struct PrivateArguments {
      texture2d<float> secretTexture [[id(5)]];
      sampler secretSampler [[id(9)]];
    };
    constant bool secretFlag [[function_constant(32)]];
    struct PrivateOutput { float4 secretColor [[color(0), function_constant(secretFlag)]]; };
    fragment PrivateOutput secretEntry(constant PrivateArguments& args [[buffer(0)]],
      float4 p [[position]]) {
      return {args.secretTexture.sample(args.secretSampler, p.xy) + dfdx(p)};
    }
  `,
    { stage: "ps", variant: "readableTile" },
  );
  const result = inventory.snapshot();
  assert.equal(result.records, 1);
  assert.equal(result.stages.ps, 1);
  assert.equal(result.variants.readableTile, 1);
  assert.equal(result.attributes.id, 2);
  assert.equal(result.attributes.buffer, 1);
  assert.equal(result.textureTypeOccurrences.texture2d, 1);
  assert.deepEqual(result.functionConstants, {
    numericAttributeOccurrences: 1,
    symbolicAttributeOccurrences: 1,
  });
  assert.equal(result.featureShaderCounts.textureSampling, 1);
  assert.equal(result.featureShaderCounts.derivatives, 1);
  assert.doesNotMatch(JSON.stringify(result), /secret|Private/);
});

test("comments, escaped literals and raw literals do not spoof features", () => {
  const inventory = createShaderFeatureInventory();
  inventory.add(
    `// texture2d<float> [[buffer(42)]]\n
    /* threadgroup atomic_uint */
    "discard_fragment() \\" [[id(4)]]";
    R"tag(texture3d<float> [[id(7)]] ")tag";
    kernel void actual() { threadgroup_barrier(mem_flags::mem_threadgroup); }
  `,
    { stage: "cs" },
  );
  const result = inventory.snapshot();
  assert.equal(result.featureShaderCounts.barriers, 1);
  assert.equal(result.featureShaderCounts.threadgroupMemory, 0);
  assert.equal(result.featureShaderCounts.discard, 0);
  assert.equal(result.attributes.id, 0);
  assert.equal(result.textureTypeOccurrences.texture2d, 0);
  assert.equal(result.textureTypeOccurrences.texture3d, 0);
});

test("line splicing is processed before comments and identifiers", () => {
  const inventory = createShaderFeatureInventory();
  inventory.add("// ignored \\\ntexture2d<float>\nthread\\\ngroup float value;", { stage: "cs" });
  assert.equal(inventory.snapshot().textureTypeOccurrences.texture2d, 0);
  assert.equal(inventory.snapshot().featureShaderCounts.threadgroupMemory, 1);
});

test("reports preprocessor and unknown attributes without publishing their names", () => {
  const inventory = createShaderFeatureInventory();
  inventory.add("#if 0\nfloat x [[private_attribute(3)]];\n#endif", { stage: "vs" });
  const result = inventory.snapshot();
  assert.equal(result.featureShaderCounts.preprocessor, 1);
  assert.equal(result.unknownAttributeOccurrences, 1);
  assert.doesNotMatch(JSON.stringify(result), /private_attribute/);
});

test("snapshots are detached and invalid records never update totals", () => {
  const inventory = createShaderFeatureInventory();
  inventory.add("kernel void f() {}", { stage: "cs" });
  const snapshot = inventory.snapshot();
  snapshot.stages.cs = 100;
  for (const source of ['"secret', "/* secret", 'R"tag(secret']) {
    assert.throws(() => inventory.add(source, { stage: "cs" }), /MSL_INVENTORY_/);
  }
  assert.throws(() => inventory.add("", { stage: "secret" }), /INVALID_INPUT/);
  assert.throws(() => inventory.add("x".repeat(8 * 1024 * 1024 + 1), { stage: "cs" }), /LIMIT/);
  assert.equal(inventory.snapshot().records, 1);
  assert.equal(inventory.snapshot().stages.cs, 1);
});

test("preserves directive line boundaries and nested attribute argument commas", () => {
  const inventory = createShaderFeatureInventory();
  inventory.add("float x; /* comment\n */ #if 0\nfloat y [[private_call(f(1, 2), 3), position]];", {
    stage: "vs",
  });
  const result = inventory.snapshot();
  assert.equal(result.featureShaderCounts.preprocessor, 1);
  assert.equal(result.unknownAttributeOccurrences, 1);
  assert.equal(result.attributes.position, 1);
  assert.throws(
    () => inventory.add("float y [[color((0)]];", { stage: "ps" }),
    /INVALID_ATTRIBUTE/,
  );
  assert.equal(inventory.snapshot().records, 1);
});
