import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCnmt,
  resolveContentSelection,
  ContentSelectionError,
} from "../content-selection.mjs";
const app = 0xf123456789abc000n,
  patchId = app + 0x800n;
const c = (n = 1) => ({
  contentId: n.toString(16).padStart(32, "0"),
  sha256: n.toString(16).padStart(64, "0"),
  size: 100n,
  type: 1,
  idOffset: 0,
});
const base = (version = 0n) => ({
  type: "Application",
  titleId: app,
  applicationId: app,
  patchId,
  version,
  contents: [c()],
});
const patch = (version = 65536n) => ({
  type: "Patch",
  titleId: patchId,
  applicationId: app,
  version,
  contents: [c(2)],
});
const dlc = (version = 0n) => ({
  type: "AddOnContent",
  titleId: app + 0x1001n,
  applicationId: app,
  version,
  requiredApplicationVersion: 65536n,
  contents: [c(3)],
});
const inv = (...rows) => rows.flatMap((r) => r.contents.map((x) => ({ ...x, hashVerified: true })));
const code = (expected) => (error) =>
  error instanceof ContentSelectionError && error.code === expected;
function fixture(type = 128, ext = type === 129 ? 24 : 16, extra = 0) {
  const bytes = new Uint8Array(32 + ext + 56 + extra + 32),
    v = new DataView(bytes.buffer);
  v.setBigUint64(0, type === 128 ? app : type === 129 ? patchId : app + 0x1001n, true);
  v.setUint32(8, 65536, true);
  v.setUint8(12, type);
  v.setUint16(14, ext, true);
  v.setUint16(16, 1, true);
  v.setBigUint64(32, type === 128 ? patchId : app, true);
  if (type === 129) v.setUint32(44, extra, true);
  const p = 32 + ext;
  bytes[p + 31] = 1;
  bytes[p + 47] = 1;
  v.setUint32(p + 48, 100, true);
  bytes[p + 54] = 1;
  return bytes;
}
test("CNMT reads exact little-endian IDs, version, hash, size, content slot", () => {
  const bytes = fixture(),
    p = 48;
  bytes[p + 52] = 1;
  bytes[p + 53] = 2;
  const r = parseCnmt(bytes);
  assert.equal(r.titleId, app);
  assert.equal(r.patchId, patchId);
  assert.equal(r.version, 65536n);
  assert.equal(r.contents[0].size, 4294967396n);
  assert.equal(r.contents[0].attributes, 2);
  assert.equal(r.digestVerified, false);
  assert.equal(r.contents[0].sha256, c().sha256);
  const padded = new Uint8Array(bytes.length + 20);
  padded.set(bytes, 7);
  assert.deepEqual(parseCnmt(padded.subarray(7, 7 + bytes.length)), r);
});
test("patch extended data bounds and both DLC extended headers", () => {
  assert.equal(parseCnmt(fixture(129, 24, 48)).extendedDataSize, 48);
  assert.equal(parseCnmt(fixture(130)).applicationId, app);
  assert.equal(parseCnmt(fixture(130, 24)).type, "AddOnContent");
  const b = fixture(130, 24);
  new DataView(b.buffer).setBigUint64(48, 1n, true);
  assert.throws(() => parseCnmt(b), code("UNSUPPORTED_DATA_PATCH"));
});
test("full patch ignores authenticated delta fragment records during selection", () => {
  const original = fixture(129, 24);
  const bytes = new Uint8Array(original.length + 56);
  bytes.set(original.subarray(0, 32 + 24 + 56));
  new DataView(bytes.buffer).setUint16(16, 2, true);
  bytes.set(original.subarray(32 + 24 + 56), 32 + 24 + 112);
  const fragment = 32 + 24 + 56;
  bytes[fragment + 31] = 2;
  bytes[fragment + 47] = 2;
  new DataView(bytes.buffer).setUint32(fragment + 48, 200, true);
  bytes[fragment + 54] = 6;
  const parsed = parseCnmt(bytes);
  assert.equal(parsed.contents.length, 1);
  assert.equal(parsed.deltaFragmentCount, 1);
  assert.equal(parsed.contents[0].type, 1);
  bytes[fragment + 53] = 1;
  assert.throws(() => parseCnmt(bytes), code("UNSUPPORTED_CONTENT_TYPE"));
  bytes[fragment + 53] = 0;
  bytes[fragment + 47] = 1;
  assert.throws(() => parseCnmt(bytes), code("DUPLICATE_CONTENT"));
});
test("all truncations and trailing data fail closed", () => {
  const b = fixture();
  for (let i = 0; i < b.length; i++)
    assert.throws(() => parseCnmt(b.subarray(0, i)), ContentSelectionError);
  assert.throws(() => parseCnmt(new Uint8Array(b.length + 1)), ContentSelectionError);
  assert.throws(() => parseCnmt(new Uint8Array(16 * 1024 * 1024 + 1)), code("INVALID_CNMT_SIZE"));
});
test("unsupported type, content, dependencies, platform, counts and lengths", () => {
  for (const [offset, value, expected] of [
    [12, 131, "UNSUPPORTED_META_TYPE"],
    [13, 1, "UNSUPPORTED_PLATFORM"],
    [22, 1, "UNSUPPORTED_PLATFORM"],
    [14, 8, "INVALID_EXTENDED_HEADER"],
    [16, 0, "INVALID_CONTENT"],
    [102, 6, "UNSUPPORTED_CONTENT_TYPE"],
  ]) {
    const b = fixture();
    b[offset] = value;
    assert.throws(() => parseCnmt(b), code(expected));
  }
  const b = fixture(129);
  new DataView(b.buffer).setUint32(44, 0xffffffff, true);
  assert.throws(() => parseCnmt(b), code("INVALID_CNMT_SIZE"));
  const deps = new Uint8Array(fixture().length + 16);
  deps.set(fixture());
  deps[18] = 1;
  assert.throws(() => parseCnmt(deps), code("UNSUPPORTED_DEPENDENCIES"));
});
test("base + explicit full patch + compatible DLC deterministic across input order", () => {
  const rows = [base(), patch(), dlc()];
  const a = resolveContentSelection(rows, inv(...rows));
  const b = resolveContentSelection([...rows].reverse(), inv(...rows).reverse());
  assert.deepEqual(a, b);
  assert.equal(a.effectiveVersion, 65536n);
  assert.equal(a.dlc.length, 1);
  assert.equal(a.gameCompatibility, "unknown");
  assert.equal(a.requiresExecutableAllowlist, true);
  assert.equal(a.patchApplied, false);
});
test("missing base, orphan DLC, ambiguous applications and patch ID mismatch", () => {
  assert.throws(() => resolveContentSelection([patch()], inv(patch())), code("MISSING_BASE"));
  assert.throws(
    () => resolveContentSelection([base(), { ...dlc(), applicationId: app + 1n }], []),
    code("ORPHAN_CONTENT"),
  );
  assert.throws(
    () =>
      resolveContentSelection(
        [base(), { ...base(), titleId: app + 1n, applicationId: app + 1n }],
        [],
      ),
    code("AMBIGUOUS_APPLICATION"),
  );
  assert.throws(
    () => resolveContentSelection([base(), { ...patch(), titleId: patchId + 1n }], []),
    code("INVALID_ASSOCIATION"),
  );
});
test("versions are numeric, explicit, range-safe, and never inferred from newest", () => {
  const rows = [base(), patch(10n), patch(2n)];
  assert.throws(
    () => resolveContentSelection(rows, inv(...rows)),
    (e) => e.code === "AMBIGUOUS_VERSION" && e.message.includes("2, 10"),
  );
  assert.equal(resolveContentSelection(rows, inv(...rows), { patchVersion: 2n }).patch.version, 2n);
  assert.throws(
    () => resolveContentSelection(rows, [], { patchVersion: 9n }),
    code("MISSING_VERSION"),
  );
  for (const version of [
    -1n,
    4294967296n,
    NaN,
    Infinity,
    1.5,
    "65536",
    Number.MAX_SAFE_INTEGER + 1,
  ])
    assert.throws(() => resolveContentSelection([base(version)], []), code("INVALID_INTEGER"));
  assert.throws(
    () => resolveContentSelection([{ ...base(), titleId: 1n << 64n }], []),
    code("INVALID_INTEGER"),
  );
});
test("DLC compatibility and base/update minimum versions are enforced", () => {
  assert.throws(
    () => resolveContentSelection([base(), dlc()], inv(base(), dlc())),
    code("INCOMPATIBLE_DLC"),
  );
  assert.throws(
    () => resolveContentSelection([base(10n), patch(2n)], []),
    code("INCOMPATIBLE_VERSION"),
  );
  assert.throws(
    () => resolveContentSelection([{ ...base(), requiredApplicationVersion: 1n }], []),
    code("INCOMPATIBLE_VERSION"),
  );
});
test("duplicate equal records are idempotent; differing same-version records fail", () => {
  assert.deepEqual(
    resolveContentSelection([base(), base()], inv(base(), base())),
    resolveContentSelection([base()], inv(base())),
  );
  assert.throws(
    () => resolveContentSelection([base(), { ...base(), contents: [c(8)] }], []),
    code("CONFLICTING_METADATA"),
  );
  assert.throws(
    () => resolveContentSelection([{ ...base(), contents: [c(), c()] }], []),
    code("DUPLICATE_CONTENT"),
  );
  assert.throws(
    () => resolveContentSelection([{ ...base(), contents: [c(), c(2)] }], []),
    code("DUPLICATE_CONTENT"),
  );
});
test("required content existence, computed hash, size, and inventory conflicts are gates", () => {
  assert.throws(() => resolveContentSelection([base()], []), code("MISSING_CONTENT"));
  assert.throws(() => resolveContentSelection([base()], [c()]), code("UNVERIFIED_CONTENT"));
  assert.throws(
    () =>
      resolveContentSelection([base()], [{ ...c(), hashVerified: true, sha256: "a".repeat(64) }]),
    code("CONTENT_IDENTITY_MISMATCH"),
  );
  assert.throws(
    () => resolveContentSelection([base()], [{ ...c(), hashVerified: true, size: 99n }]),
    code("CONTENT_IDENTITY_MISMATCH"),
  );
  assert.throws(
    () =>
      resolveContentSelection(
        [base()],
        [...inv(base()), { ...c(), hashVerified: true, size: 99n }],
      ),
    code("CONFLICTING_CONTENT"),
  );
  assert.throws(
    () => resolveContentSelection([{ ...base(), contents: [{ ...c(), contentId: "bad" }] }], []),
    code("INVALID_IDENTITY"),
  );
  assert.throws(
    () => resolveContentSelection([{ ...base(), contents: [{ ...c(), size: 1n << 40n }] }], []),
    code("INVALID_INTEGER"),
  );
});
test("multiple DLC versions require explicit choice and DLC is never merged", () => {
  const rows = [base(), patch(), dlc(2n), dlc(10n)],
    id = (app + 0x1001n).toString(16);
  assert.throws(() => resolveContentSelection(rows, inv(...rows)), code("AMBIGUOUS_VERSION"));
  const result = resolveContentSelection(rows, inv(...rows), { dlcVersions: { [id]: 2n } });
  assert.equal(result.dlc[0].version, 2n);
  assert.equal(result.base.contents.length, 1);
});

test("conflicting CNMT digests or required-system metadata are not silently deduplicated", () => {
  assert.throws(
    () =>
      resolveContentSelection(
        [
          { ...base(), cnmtDigest: "a".repeat(64) },
          { ...base(), cnmtDigest: "b".repeat(64) },
        ],
        [],
      ),
    code("CONFLICTING_METADATA"),
  );
  assert.throws(
    () => resolveContentSelection([base(), { ...base(), requiredSystemVersion: 1n }], []),
    code("CONFLICTING_METADATA"),
  );
});
test("malformed arrays, inventory, non-default DLC accessibility, and oversized count fail", () => {
  for (const rows of [null, [], new Array(4097).fill(base())])
    assert.throws(() => resolveContentSelection(rows, []), code("INVALID_INPUT"));
  assert.throws(() => resolveContentSelection([base()], [null]), code("INVALID_INPUT"));
  assert.throws(() => resolveContentSelection([base()], [], null), code("INVALID_INPUT"));
  assert.throws(
    () => resolveContentSelection([{ ...dlc(), contentAccessibilities: 1 }], []),
    code("UNSUPPORTED_DLC_ACCESS"),
  );
  const b = fixture();
  new DataView(b.buffer).setUint16(16, 4097, true);
  assert.throws(() => parseCnmt(b), code("INVALID_CONTENT"));
  const d = fixture(130, 24);
  d[44] = 1;
  assert.throws(() => parseCnmt(d), code("UNSUPPORTED_DLC_ACCESS"));
});

// 显式版本请求不能被静默忽略；这里只验证元数据策略，不授予认证。
// Explicit version requests must not be silently ignored; this tests metadata policy, not authentication.
test("DLC version requests reject absent titles without changing optional defaults", () => {
  const rows = [base(), patch()];
  const id = (app + 0x1001n).toString(16);
  for (const options of [{}, { dlcVersions: {} }, { dlcVersions: Object.create(null) }])
    assert.deepEqual(resolveContentSelection(rows, inv(...rows), options).dlc, []);
  assert.throws(
    () => resolveContentSelection(rows, inv(...rows), { dlcVersions: { [id]: 0n } }),
    code("MISSING_VERSION"),
  );
  const withDlc = [...rows, dlc(2n)];
  assert.throws(
    () =>
      resolveContentSelection(withDlc, inv(...withDlc), {
        dlcVersions: { [id]: 2n, ["0000000000000001"]: 0n },
      }),
    code("MISSING_VERSION"),
  );
});
test("DLC version map types, canonical keys and exact uint32 values fail closed", () => {
  const id = (app + 0x1001n).toString(16);
  const rows = [base(), patch(), dlc(2n)];
  const run = (dlcVersions) => resolveContentSelection(rows, inv(...rows), { dlcVersions });
  for (const value of [null, [], "not a map", new Map(), new Date(), 2, true])
    assert.throws(() => run(value), code("INVALID_INPUT"));
  for (const key of [id.toUpperCase(), "1", "g".repeat(16), Symbol("id")])
    assert.throws(() => run({ [key]: 2n }), code("INVALID_IDENTITY"));
  for (const value of [undefined, "2", -1, 1.5, 2 ** 32, 1n << 32n, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => run({ [id]: value }), code("INVALID_INTEGER"));
  let getterCalled = false;
  assert.throws(
    () =>
      run(
        Object.defineProperty({}, id, {
          get() {
            getterCalled = true;
            return 2n;
          },
        }),
      ),
    code("INVALID_INPUT"),
  );
  assert.equal(getterCalled, false);
  assert.throws(
    () =>
      run(
        Object.fromEntries(
          Array.from({ length: 4097 }, (_, i) => [i.toString(16).padStart(16, "0"), 0]),
        ),
      ),
    code("INVALID_INPUT"),
  );
  for (const version of [2, 2n]) {
    const map = Object.assign(Object.create(null), { [id]: version });
    assert.equal(run(map).dlc[0].version, 2n);
  }
  assert.throws(
    () => resolveContentSelection([{}], [], { dlcVersions: [] }),
    code("INVALID_INPUT"),
  );
});
