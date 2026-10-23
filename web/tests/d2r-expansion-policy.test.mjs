// 验证 d2r-expansion-policy 的约定与边界；依据 ../d2r-expansion-policy.mjs 及本文件的测试断言。
// Verify d2r-expansion-policy contracts and boundaries against ../d2r-expansion-policy.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import {
  D2R_APPLICATION_ID as app,
  D2R_PATCH_ID as patchId,
  D2R_WARLOCK_ID as warlock,
  resolveD2rExpansionSelection as resolve,
} from "../d2r-expansion-policy.mjs";

function fixture() {
  const content = (n, type = 1) => ({
    contentId: n.toString(16).padStart(32, "0"),
    sha256: n.toString(16).padStart(64, "0"),
    size: 100n,
    type,
    idOffset: 0,
  });
  return [
    {
      type: "Application",
      titleId: app,
      applicationId: app,
      patchId,
      version: 0n,
      contents: [content(1)],
    },
    {
      type: "Patch",
      titleId: patchId,
      applicationId: app,
      version: 65536n,
      contents: [content(2)],
    },
    {
      type: "AddOnContent",
      titleId: warlock,
      applicationId: app,
      version: 0n,
      requiredApplicationVersion: 65536n,
      contents: [content(3, 2)],
    },
  ];
}
const inventory = (rows) =>
  rows.flatMap((r) => r.contents.map((c) => ({ ...c, hashVerified: true })));
const code = (expected) => (error) => error.code === expected;

test("known expansion remains separate and fully required, never marked owned or compatible", () => {
  const rows = fixture();
  const result = resolve(rows, inventory(rows));
  assert.equal(result.dlc[0].titleId, warlock);
  assert.equal(result.requiredContents.length, 3);
  assert.equal(result.base.contents.length, 1);
  assert.equal(result.patch.contents.length, 1);
  assert.equal(result.requiresExecutableAllowlist, true);
  assert.equal(result.gameCompatibility, "unknown");
  assert.equal(result.patchApplied, false);
  assert.equal("owned" in result, false);
});

test("missing expansion/update and unknown expansion reject", () => {
  const rows = fixture();
  assert.throws(() => resolve(rows.slice(0, 2), inventory(rows)), code("D2R_EXPANSION_REQUIRED"));
  rows[2].requiredApplicationVersion = 0n;
  assert.throws(() => resolve([rows[0], rows[2]], inventory(rows)), code("D2R_UPDATE_REQUIRED"));
  rows[2].titleId++;
  assert.throws(() => resolve(rows, inventory(rows)), code("D2R_UNKNOWN_EXPANSION"));
});

test("association and required version checks are retained", () => {
  let rows = fixture();
  rows[2].applicationId++;
  assert.throws(() => resolve(rows, inventory(rows)), code("ORPHAN_CONTENT"));
  rows = fixture();
  rows[2].requiredApplicationVersion = 65537n;
  assert.throws(() => resolve(rows, inventory(rows)), code("INCOMPATIBLE_DLC"));
  rows = fixture();
  rows[1].titleId++;
  assert.throws(() => resolve(rows, inventory(rows)), code("INVALID_ASSOCIATION"));
  rows = fixture();
  for (const r of rows) {
    r.applicationId += 0x2000n;
    r.titleId += 0x2000n;
  }
  rows[0].patchId += 0x2000n;
  assert.throws(() => resolve(rows, inventory(rows)), code("D2R_APPLICATION_REQUIRED"));
});

test("missing, unverified, mismatched and conflicting full inventory reject", () => {
  const rows = fixture();
  const inv = inventory(rows);
  assert.throws(() => resolve(rows, inv.slice(0, 2)), code("MISSING_CONTENT"));
  inv[2].hashVerified = false;
  assert.throws(() => resolve(rows, inv), code("UNVERIFIED_CONTENT"));
  inv[2].hashVerified = true;
  inv[2].size++;
  assert.throws(() => resolve(rows, inv), code("CONTENT_IDENTITY_MISMATCH"));
  assert.throws(() => resolve(rows, [...inv, inventory(rows)[2]]), code("CONFLICTING_CONTENT"));
});

test("only conservative nonempty single Data slot is accepted", () => {
  for (const change of [
    (c) => (c.type = 1),
    (c) => (c.idOffset = 1),
    (c) => (c.attributes = 1),
    (c) => (c.size = 0n),
  ]) {
    const rows = fixture();
    change(rows[2].contents[0]);
    assert.throws(() => resolve(rows, inventory(rows)), code("D2R_EXPANSION_LAYOUT_UNSUPPORTED"));
  }
  const rows = fixture();
  rows[2].contents.push({
    ...rows[2].contents[0],
    contentId: "f".repeat(32),
    idOffset: 1,
  });
  assert.throws(() => resolve(rows, inventory(rows)), code("D2R_EXPANSION_LAYOUT_UNSUPPORTED"));
});

test("multiple DLC versions require explicit choice without omitting DLC evidence", () => {
  const rows = fixture();
  rows.push({ ...rows[2], version: 1n });
  assert.throws(() => resolve(rows, inventory(rows)), code("AMBIGUOUS_VERSION"));
  const selected = resolve(rows, inventory(rows), {
    dlcVersions: { [warlock.toString(16).padStart(16, "0")]: 1n },
  });
  assert.equal(selected.dlc[0].version, 1n);
});
