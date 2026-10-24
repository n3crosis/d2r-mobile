// 合成操作计数不是浏览器耗时或实际游戏测试。
// Synthetic operation counts are not browser timing or real-game tests.
import test from "node:test";
import assert from "node:assert/strict";
import {
  findUniqueLogicalPathSuffixes as batch,
  resolveLogicalAssetSuffixes as resolve,
  LOGICAL_SUFFIX_BATCH_LIMITS as LIMITS,
} from "../logical-asset-suffixes.mjs";
import { generateRemainingArt } from "../remaining-art-generator.mjs";
import { generateMercenaryArt } from "../mercenary-art-generator.mjs";
function logical(paths, duplicates = []) {
  const rows = paths.map((path) => Object.freeze([...Array(9), path]));
  const duplicate = new Set(duplicates);
  return {
    entries: () => rows.values(),
    hasDuplicatePath: (path) => duplicate.has(path.toLowerCase()),
  };
}
function singular(source, suffix) {
  let match;
  for (const row of source.entries()) {
    if (!row[9].toLowerCase().endsWith(suffix)) continue;
    if (match !== undefined || source.hasDuplicatePath(row[9]))
      throw Error("EXTRACTION_ASSET_AMBIGUOUS");
    match = row[9];
  }
  if (match === undefined) throw Error("EXTRACTION_ASSET_MISSING");
  return match;
}
test("batch preserves original mixed-case paths, suffix order and repeated requests", () => {
  const source = logical([
    "data:DATA/a/shared.sprite",
    "data:data/b/shared.sprite",
    "data:data/A/Other.sprite",
  ]);
  const wanted = ["/b/shared.sprite", "/a/other.sprite", "/a/shared.sprite", "/b/shared.sprite"];
  const result = batch(source, wanted);
  assert.deepEqual(
    result,
    wanted.map((suffix) => singular(source, suffix)),
  );
  assert.equal(result[2], "data:DATA/a/shared.sprite");
  assert.ok(Object.isFrozen(result));
});
test("missing and ambiguity follow request order, including normalized duplicate rows", () => {
  for (const source of [
    logical(["data:data/x/a.sprite", "data:data/y/a.sprite"]),
    logical(["data:DATA/x/a.sprite"], ["data:data/x/a.sprite"]),
  ]) {
    for (const wanted of [
      ["/missing.sprite", "/a.sprite"],
      ["/a.sprite", "/missing.sprite"],
      ["/a.sprite", "/a.sprite"],
    ]) {
      let expected;
      try {
        wanted.map((suffix) => singular(source, suffix));
      } catch (error) {
        expected = error.message;
      }
      assert.throws(() => batch(source, wanted), { message: expected });
    }
  }
});
test("request count and ASCII byte bounds reject before scanning; empty batch does not scan", () => {
  const source = {
    entries() {
      throw Error("must not scan");
    },
  };
  assert.deepEqual(batch(source, []), []);
  for (const wanted of [
    new Array(LIMITS.requests + 1).fill("/a"),
    new Array(2049).fill("/" + "a".repeat(511)),
  ])
    assert.throws(() => batch(source, wanted), /SUFFIX_LIMIT/);
  for (const wanted of [null, ["/../a"], ["/A"], ["/a\\b"], ["/" + "a".repeat(512)]])
    assert.throws(() => batch(source, wanted), /SUFFIX/);
});
test("cancellation checked on each scanned row and every call starts a new scan", () => {
  const abort = new Error("cancelled");
  let visited = 0,
    closed = false;
  const source = {
    entries: function* () {
      try {
        for (let i = 0; i < 10; i++) {
          visited++;
          yield [...Array(9), `data:data/${i}.sprite`];
        }
      } finally {
        closed = true;
      }
    },
    hasDuplicatePath: () => false,
  };
  assert.throws(
    () =>
      batch(source, ["/9.sprite"], () => {
        if (visited === 3) throw abort;
      }),
    (error) => error === abort,
  );
  assert.equal(visited, 3);
  assert.equal(closed, true);
  visited = 0;
  batch(source, ["/9.sprite"]);
  batch(source, ["/9.sprite"]);
  assert.equal(visited, 20);
});
test("singular-only test adapters remain supported in request order", () => {
  const calls = [];
  const adapter = {
    findUniquePathSuffix: (suffix) => {
      calls.push(suffix);
      return `original${suffix}`;
    },
  };
  assert.deepEqual(resolve(adapter, ["/b", "/a", "/b"]), [
    "original/b",
    "original/a",
    "original/b",
  ]);
  assert.deepEqual(calls, ["/b", "/a", "/b"]);
});
test("200k-row synthetic batch cuts 64 scans/lowercase passes to one", () => {
  const count = 200000,
    wanted = Array.from({ length: 64 }, (_, i) => `/hd/shaders/pack${i}.bin`);
  const paths = Array.from({ length: count }, (_, i) =>
    i < 64 ? `data:data/hd/shaders/pack${i}.bin` : `data:data/other/item${i}.sprite`,
  );
  const source = logical(paths);
  source.hasDuplicatePath = () => false;
  const lower = String.prototype.toLowerCase,
    ends = String.prototype.endsWith;
  let lowerCalls = 0,
    comparisons = 0;
  // 同步临时计数后立即还原，不跨异步边界或改变字符串结果。
  // Restore synchronous instrumentation immediately; never cross async boundaries or change string results.
  try {
    String.prototype.toLowerCase = function () {
      lowerCalls++;
      return lower.call(this);
    };
    String.prototype.endsWith = function (...args) {
      comparisons++;
      return ends.apply(this, args);
    };
    const expected = wanted.map((suffix) => singular(source, suffix));
    assert.equal(lowerCalls, count * 64);
    assert.equal(comparisons, count * 64);
    lowerCalls = comparisons = 0;
    const actual = batch(source, wanted);
    assert.equal(lowerCalls, count);
    assert.equal(comparisons, 64);
    assert.deepEqual(actual, expected);
  } finally {
    String.prototype.toLowerCase = lower;
    String.prototype.endsWith = ends;
  }
});
for (const [name, generate, expectedCount] of [
  ["remaining", generateRemainingArt, 9],
  ["mercenary", generateMercenaryArt, 3],
])
  test(`${name} art batches known queries before reads and preserves original lookup result`, async () => {
    let calls = 0;
    const sentinel = Error("stop before decoding");
    const logicalAssets = {
      findUniquePathSuffixes(suffixes) {
        calls++;
        assert.equal(suffixes.length, expectedCount);
        return suffixes.map((suffix) => `Original${suffix}`);
      },
      async read(path) {
        assert.ok(path.startsWith("Original/"));
        throw sentinel;
      },
    };
    await assert.rejects(generate({ logicalAssets }), (error) => error === sentinel);
    assert.equal(calls, 1);
  });
