// 完全使用合成数据，测试校验器而非编译器或 Metal。
// Wholly synthetic data. Tests the checker, not a compiler or Metal.
import assert from "node:assert/strict";
import test from "node:test";
import {
  checkFragmentInputReflection,
  inspectFragmentReflection,
} from "../toolchain/metal-air-compiler/check-fragment-input-reflection.mjs";

// 依据字段布局独立编写的最小前向模式样例。容器刻意省略有效 bitcode/哈希；使用此补充语义检查前，必须另行执行生产编译着色器边界校验。
// Minimal forward-written schema fixture, independently authored from field layout.
// Container omits bitcode/hash validity intentionally: always run the production
// compiled-shader boundary separately before using this supplemental semantic check.
export function syntheticLibrary({
  keepVarying = false,
  keepPosition = false,
  unusedOverride = {},
  fragmentIds = [0],
  argumentIds = [1, 2, 3, 4, 5],
  mutate = () => {},
} = {}) {
  const b = [];
  const write = (n, size = 4) => {
    const p = b.length;
    for (let i = 0; i < size; ++i) b.push(Math.floor(n / 2 ** (8 * i)) & 255);
    return p;
  };
  const patch = (p, n, size = 4) => {
    for (let i = 0; i < size; ++i) b[p + i] = Math.floor(n / 2 ** (8 * i)) & 255;
  };
  const pad = () => {
    while (b.length % 4) write(0, 1);
  };
  const table = (fields) => {
    const vs = 4 + fields.length * 2;
    if (vs % 4) write(0, 2);
    const vt = b.length;
    const size =
      4 + fields.reduce((s, x) => s + (x === null ? 0 : Array.isArray(x) ? x.length * 4 : 4), 0);
    write(vs, 2);
    write(size, 2);
    let offset = 4;
    for (const x of fields) {
      write(x === null ? 0 : offset, 2);
      if (x !== null) offset += Array.isArray(x) ? x.length * 4 : 4;
    }
    const root = b.length;
    write(root - vt);
    const slots = fields.map((x) => {
      if (x === null) return null;
      const p = b.length;
      for (const v of Array.isArray(x) ? x : [x]) write(v);
      return p;
    });
    return { root, vt, slots };
  };
  const vector = (pointer, values) => {
    pad();
    const p = b.length;
    patch(pointer, p - pointer);
    write(values.length);
    return values.map((value) => write(value));
  };
  const string = (pointer, text) => {
    pad();
    const p = b.length;
    patch(pointer, p - pointer);
    const textBytes = new TextEncoder().encode(text);
    write(textBytes.length);
    b.push(...textBytes, 0);
    pad();
  };
  const fieldUnused = (name, expected) =>
    Object.hasOwn(unusedOverride, name) ? unusedOverride[name] : expected ? 1 : null;
  write(0);
  b.push(...new TextEncoder().encode("AIRR"));
  const root = table([[0, 4, 0], 0, 0]);
  patch(0, root.root);
  const nodeSlots = vector(root.slots[1], [0, 0, 0, 0, 0, 0]);
  vector(root.slots[2], fragmentIds);
  const structures = [];
  function node(id, kind, fields) {
    const w = table([kind, 0]);
    patch(nodeSlots[id], w.root - nodeSlots[id]);
    const t = table(fields);
    patch(w.slots[1], t.root - w.slots[1]);
    structures.push({ wrapper: w, payload: t });
    return t;
  }
  const fn = node(0, 1, [0, null, 0]);
  string(fn.slots[0], "fragment_input_liveness");
  vector(fn.slots[2], argumentIds);
  for (const [id, name, attr, unused] of [
    [1, "kept", "user(locn7)", fieldUnused("kept", false)],
    [2, "optionalValue", "user(locn11)", fieldUnused("optionalValue", !keepVarying)],
  ]) {
    const t = node(id, 274432, [null, 0, null, null, 2, 0, 0, unused]);
    string(t.slots[1], attr);
    string(t.slots[5], "float4");
    string(t.slots[6], name);
  }
  const pos = node(3, 274434, [null, 1, 3, 0, 0, fieldUnused("position", !keepPosition)]);
  string(pos.slots[3], "float4");
  string(pos.slots[4], "position");
  for (const [id, name, binding] of [
    [4, "bias", 9],
    [5, "untouched", 13],
  ]) {
    const t = node(id, 262144, [
      null,
      16,
      binding,
      1,
      1,
      2,
      null,
      null,
      16,
      16,
      0,
      0,
      fieldUnused(name, false),
    ]);
    string(t.slots[10], "float4");
    string(t.slots[11], name);
  }
  mutate({ b, patch, root, structures, nodeSlots });
  const airr = Uint8Array.from(b);
  b.length = 0;
  for (let i = 0; i < 88; ++i) write(0, 1);
  const tag = (name, payload) => {
    b.push(...new TextEncoder().encode(name));
    if (name !== "ENDT") {
      write(payload.length, 2);
      b.push(...payload);
    }
  };
  const u64 = (n) => {
    const a = [];
    for (let i = 0; i < 8; ++i) a.push(Math.floor(n / 2 ** (8 * i)) & 255);
    return a;
  };
  write(1);
  const record = write(0);
  tag("NAME", [...new TextEncoder().encode("fragment_input_liveness"), 0]);
  tag("TYPE", [1]);
  tag("RFLT", u64(4));
  tag("ENDT");
  patch(record, b.length - record);
  const functionSize = b.length - 88 - 4;
  const rlstTag = b.length;
  tag("RLST", [...u64(0), ...u64(0)]);
  tag("ENDT");
  const pub = b.length;
  tag("ENDT");
  const priv = b.length;
  tag("ENDT");
  const bitcode = b.length;
  write(0);
  const rl = b.length;
  write(1);
  const group = write(0);
  b.push(...new TextEncoder().encode("RBUF"));
  const payloadSize = write(0);
  const payload = b.length;
  while (b.length % 16) write(0, 1);
  const airrStart = b.length;
  b.push(...airr);
  tag("ENDT");
  patch(group, b.length - group);
  patch(payloadSize, b.length - 4 - payload);
  patch(rlstTag + 6, rl, 8);
  patch(rlstTag + 14, b.length - rl, 8);
  for (const [p, n] of [
    [16, b.length],
    [24, 88],
    [32, functionSize],
    [40, pub],
    [48, 4],
    [56, priv],
    [64, 4],
    [72, bitcode],
    [80, 4],
  ])
    patch(p, n, 8);
  b.splice(0, 4, ...new TextEncoder().encode("MTLB"));
  return { bytes: Uint8Array.from(b), airrStart, structures, root };
}

for (const keepVarying of [false, true])
  for (const keepPosition of [false, true])
    test(`synthetic optional inputs varying=${keepVarying}, position=${keepPosition}`, () => {
      const { bytes } = syntheticLibrary({ keepVarying, keepPosition });
      const result = checkFragmentInputReflection(bytes, { keepVarying, keepPosition });
      assert.equal(result.arguments.length, 5);
      assert.equal(result.unusedInputs, Number(!keepVarying) + Number(!keepPosition));
    });

test("rejects an ignore-only implementation that serializes no unused flags", () => {
  const { bytes } = syntheticLibrary({ keepVarying: true, keepPosition: true });
  assert.throws(() => checkFragmentInputReflection(bytes), /unused presence\/value/);
});
for (const name of ["optionalValue", "position"]) {
  test(`explicit false ${name} decodes but fails dead assertion`, () => {
    const { bytes } = syntheticLibrary({ unusedOverride: { [name]: 0 } });
    const args = inspectFragmentReflection(bytes).entries[0].fragments[0].arguments;
    assert.deepEqual(args.find((x) => x.name === name).unused.value, false);
    assert.throws(() => checkFragmentInputReflection(bytes), /unused presence\/value/);
  });
  test(`explicit false ${name} fails strict live-absence assertion`, () => {
    const opts = { keepVarying: true, keepPosition: true };
    const { bytes } = syntheticLibrary({ ...opts, unusedOverride: { [name]: 0 } });
    assert.throws(() => checkFragmentInputReflection(bytes, opts), /unused presence\/value/);
  });
}
for (const name of ["kept", "bias", "untouched"])
  test(`out-of-scope unused on ${name} rejected`, () => {
    const { bytes } = syntheticLibrary({ unusedOverride: { [name]: 1 } });
    assert.throws(() => checkFragmentInputReflection(bytes), /unused presence\/value/);
  });
test("noncanonical bool byte rejected", () => {
  const { bytes } = syntheticLibrary({ unusedOverride: { optionalValue: 2 } });
  assert.throws(() => checkFragmentInputReflection(bytes), /noncanonical boolean/);
});
test("all truncation points reject without nontermination", () => {
  const { bytes } = syntheticLibrary();
  for (let n = 0; n < bytes.length; ++n)
    assert.throws(() => checkFragmentInputReflection(bytes.subarray(0, n)));
});
for (const [name, mutate] of [
  [
    "oversized node vector",
    ({ patch, root, b }) => {
      const p = root.slots[1],
        relative = b[p] + b[p + 1] * 256 + b[p + 2] * 65536 + b[p + 3] * 16777216;
      patch(p + relative, 0xffffffff);
    },
  ],
  ["out-of-bounds wrapper", ({ patch, nodeSlots }) => patch(nodeSlots[0], 0x7fffffff)],
  [
    "out-of-bounds vtable",
    ({ patch, structures }) => patch(structures[2].payload.root, 0x7fffffff),
  ],
  [
    "oversized inline data",
    ({ patch, structures }) => patch(structures[2].payload.vt + 2, 65535, 2),
  ],
  [
    "unknown argument node ID",
    ({ patch, structures, b }) => {
      const p = structures[0].payload.slots[2],
        relative = b[p] + b[p + 1] * 256;
      patch(p + relative + 4, 99999);
    },
  ],
  ["wrong argument kind", ({ patch, structures }) => patch(structures[2].wrapper.slots[0], 274434)],
  ["wrong buffer binding", ({ patch, structures }) => patch(structures[4].payload.slots[2], 8)],
  [
    "string escapes AIRR",
    ({ patch, structures }) => patch(structures[2].payload.slots[6], 0xffffffff),
  ],
  [
    "bool slot exceeds table",
    ({ patch, structures }) => patch(structures[2].payload.vt + 18, 65535, 2),
  ],
])
  test(name, () => {
    const { bytes } = syntheticLibrary({ mutate });
    assert.throws(() => checkFragmentInputReflection(bytes));
  });
test("Uint8Array byteOffset honored", () => {
  const { bytes } = syntheticLibrary();
  const larger = new Uint8Array(bytes.length + 17);
  larger.set(bytes, 13);
  checkFragmentInputReflection(larger.subarray(13, 13 + bytes.length));
});

for (const count of [2, 4096])
  test(`fragment alias amplification rejected before mapping: ${count}`, () => {
    const { bytes } = syntheticLibrary({ fragmentIds: Array(count).fill(0) });
    assert.throws(() => checkFragmentInputReflection(bytes), /vector count limit/);
  });
for (const count of [6, 4096])
  test(`argument alias amplification rejected before mapping: ${count}`, () => {
    const { bytes } = syntheticLibrary({ argumentIds: Array(count).fill(1) });
    assert.throws(() => checkFragmentInputReflection(bytes), /vector count limit/);
  });
test("five aliased argument IDs rejected", () => {
  const { bytes } = syntheticLibrary({ argumentIds: [1, 1, 1, 1, 1] });
  assert.throws(() => checkFragmentInputReflection(bytes), /duplicate argument node IDs/);
});
test("multiple fixture entries rejected before record traversal", () => {
  const { bytes } = syntheticLibrary();
  new DataView(bytes.buffer).setUint32(88, 64, true);
  assert.throws(() => checkFragmentInputReflection(bytes), /one fixture entry required/);
});
