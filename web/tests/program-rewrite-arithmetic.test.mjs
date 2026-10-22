// 以自行编写的指令夹具检查成对访存偏移和栈恢复边界；不读取游戏输入。
// Check pair-memory offsets and stack restore bounds with authored instruction fixtures, not game inputs.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { STP, LDP, STP_PRE, LDP_POST } from "../toolchain/program-rewrite-spike/js/arm64.mjs";
import { createRelocations } from "../toolchain/program-rewrite-spike/js/relocations.mjs";

const encoders = { STP, LDP, STP_PRE, LDP_POST };
const source = fileURLToPath(new URL("../../dm/tools/patch_nso.py", import.meta.url));
const pairOffset = (word) => (((word >>> 15) & 127) << 25) >> 22;

test("pair encoders preserve every representable offset against the pinned Python functions", () => {
  const reference = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      `import ast,json,sys
names = ['STP', 'LDP', 'STP_PRE', 'LDP_POST']
tree = ast.parse(open(sys.argv[1], encoding='utf-8').read())
functions = [n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name in names]
scope = {}
exec(compile(ast.Module(body=functions, type_ignores=[]), sys.argv[1], 'exec'), scope)
print(json.dumps({name: [scope[name](0, 1, 31, off) for off in range(-512, 505, 8)] for name in names}))`,
      source,
    ],
    { encoding: "utf8" },
  );
  assert.equal(reference.status, 0, reference.stderr);
  const expected = JSON.parse(reference.stdout);
  for (const [name, encode] of Object.entries(encoders)) {
    const actual = [];
    for (let offset = -512; offset <= 504; offset += 8) {
      const word = encode(0, 1, 31, offset);
      assert.equal(pairOffset(word), offset);
      actual.push(word);
    }
    assert.deepEqual(actual, expected[name]);
  }
});

test("pair encoders reject out-of-range, unaligned and noninteger offsets", () => {
  const invalid = [-520, 512, -608, -513, 505, -511, -1, 1, 503, 0.5, NaN, Infinity];
  for (const encode of Object.values(encoders)) {
    for (const offset of invalid)
      assert.throws(() => encode(0, 1, 31, offset), /ARM64 pair offset out of range/);
  }
});

function relocator(decodeMaybe) {
  return createRelocations({ patchOff: 0x10000, keyPageOff: 0x4000 }, { decodeMaybe }, { K18: 0 });
}

test("large stack post-index rejects before any patch bytes or fixups are emitted", () => {
  const ins = {
    word: 0xa8df4ff2,
    address: 0x40,
    mnemonic: "ldp",
    op_str: "x18, x19, [sp], #0x1f0",
    reads: ["sp"],
    writes: ["x18", "x19", "sp"],
  };
  const r = relocator(() => assert.fail("Unsupported restore must reject before substitution"));
  assert.throws(() => r.sitePlain(ins), /ARM64 pair offset out of range/);
  assert.equal(r.here(), 0x10000);
  assert.equal(r.patchBytes().length, 0);
  assert.deepEqual(r.fix, []);
  assert.deepEqual(r.gates, []);
});

test("supported stack restores keep their existing instruction bytes exactly", () => {
  const cases = [
    [
      0x91000652,
      0x91000400,
      "add",
      "x18, x18, #1",
      "e0073fa961d03bd5a0ffff90000040f92100008b200040f900040091200000f9e0077fa908c0ff17",
    ],
    [
      0xa9ba4ff2,
      0xa9ba4fe0,
      "stp",
      "x18, x19, [sp, #-0x60]!",
      "e00739a961d03bd5a0ffff90000040f92100008b200040f9e04fbaa9200000f9e0077fa908c0ff17",
    ],
    [
      0xa8c14ff2,
      0xa8c14fe0,
      "ldp",
      "x18, x19, [sp], #0x10",
      "e00739a961d03bd5a0ffff90000040f92100008b200040f9e04fc1a8200000f9e00778a908c0ff17",
    ],
    [
      0xa8d94ff2,
      0xa8d94fe0,
      "ldp",
      "x18, x19, [sp], #0x190",
      "e00739a961d03bd5a0ffff90000040f92100008b200040f9e04fd9a8200000f9e00760a908c0ff17",
    ],
  ];
  for (const [word, substituted, mnemonic, op_str, expected] of cases) {
    const ins = { word, address: 0x40, mnemonic, op_str, reads: [], writes: [] };
    // 只接受夹具列出的替换字，不以模拟解码器声称 Capstone 或设备验证。
    // Accept only the fixture's substituted word; this is not Capstone or device verification.
    const r = relocator((candidate) =>
      candidate === substituted ? { ...ins, op_str: op_str.replaceAll("x18", "x0") } : null,
    );
    assert.equal(r.sitePlain(ins), 0x10000);
    assert.equal(Buffer.from(r.patchBytes()).toString("hex"), expected);
  }
});
