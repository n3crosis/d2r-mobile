// 依据固定着色器目录和合成标记数据验证目录解析与记录边界。
// Verify catalog parsing and record boundaries using pinned shader metadata and synthetic markers.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { loadShaderCatalog, decodeShaderRecord } from "../shader-catalog-adapter.mjs";
const root = new URL("../../", import.meta.url);
const input = () =>
  Object.fromEntries(
    [
      ["map", "shader_map.tsv"],
      ["facts", "shader_facts.tsv"],
      ["conflicts", "shader_map.tsv.conflicts.tsv"],
    ].map(([k, f]) => [k, new Uint8Array(readFileSync(new URL(`dm/gfx/nvn/${f}`, root)))]),
  );
test("pinned full catalog matches original first-source and conflict selection, retaining unsupported stages", async () => {
  const catalog = await loadShaderCatalog(input());
  const script = `import ast,json,sys\np=sys.argv[1]\nt=ast.parse(open(p).read())\nstart=next(i for i,n in enumerate(t.body) if isinstance(n,ast.Assign) and any(isinstance(x,ast.Tuple) and any(isinstance(y,ast.Name) and y.id=='pc_of' for y in x.elts) for x in n.targets))\nend=next(i for i,n in enumerate(t.body) if isinstance(n,ast.FunctionDef) and n.name=='main_rec')\ng={'MAP':sys.argv[2]}\nexec(compile(ast.Module(body=t.body[start:end],type_ignores=[]),p,'exec'),g)\nprint(json.dumps([{'key':k,'name':n,'index':i,'pcPaired':g['pc_of'][k],'stage':g['stage_of'].get(k,n[:2])} for k,(n,i) in g['loc'].items()]))`;
  const native = spawnSync(
    "python3",
    [
      "-c",
      script,
      new URL("dm/gfx/tools/dmsh_build.py", root).pathname,
      new URL("dm/gfx/nvn/shader_map.tsv", root).pathname,
    ],
    { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 },
  );
  assert.equal(native.status, 0, native.stderr);
  assert.deepEqual(
    catalog.keys.map((key) => {
      const { name, index, pcPaired, stage } = catalog.describe(key);
      return { key, name, index, pcPaired, stage };
    }),
    JSON.parse(native.stdout),
  );
  assert.equal(catalog.keys.length, 6927);
  assert.equal(catalog.keys.filter((k) => catalog.describe(k).embedded).length, 4);
  assert.deepEqual(
    catalog.unsupported.map((x) => x.key),
    ["14b6f7ad94a21328", "5221043a88afa381"],
  );
  for (const e of catalog.unsupported)
    await assert.rejects(
      catalog.prepare(e.key, { debug: true, reduced: true }),
      /Unsupported catalog stage/,
    );
  assert.equal(catalog.productionEquivalent, false);
  const copy = catalog.describe(catalog.keys[0]);
  copy.facts.tex.injected = "bad";
  assert.equal(catalog.describe(copy.key).facts.tex.injected, undefined);
});
test("tampered source and missing pack cannot become a job", async () => {
  for (const name of ["map", "facts", "conflicts"]) {
    const data = input();
    data[name][0] ^= 1;
    await assert.rejects(loadShaderCatalog(data), /source digest mismatch/);
  }
  const catalog = await loadShaderCatalog(input());
  await assert.rejects(
    catalog.prepare(catalog.keys[0], { packBytes: new Uint8Array(32), debug: true, reduced: true }),
    /record absent/,
  );
  await assert.rejects(
    catalog.prepare(catalog.keys[0], { packBytes: new Uint8Array(32) }),
    /Explicit/,
  );
});
function fixture(stage, c1Length) {
  const length = (stage === "cs" ? 16 : 0x90) + c1Length;
  const rec = new Uint8Array(0x38 + length + 0x880);
  const ci = 0x38 + length;
  rec.set(new TextEncoder().encode("BTCDBTCD"));
  if (stage !== "cs")
    new DataView(rec.buffer).setUint32(0x68, (stage === "vs" ? 1 : 5) << 10, true);
  rec.set([0x34, 0x12, 0x76, 0x98], ci);
  const v = new DataView(rec.buffer);
  v.setUint32(ci + 0x700, length - c1Length, true);
  v.setUint32(ci + 0x704, length, true);
  const key = createHash("sha256")
    .update(rec.subarray(ci, ci + 0x880))
    .digest("hex")
    .slice(0, 16);
  return {
    rec,
    descriptor: {
      key,
      stage,
      name: `${stage}_synthetic.bin`,
      index: 0,
      pcPaired: "0000000000000000",
      facts: { attr: {}, fout: {}, tex: {}, img: {} },
    },
  };
}
test("authored cs/vs/ps records and c1 match original native job_for exactly", async () => {
  for (const stage of ["cs", "vs", "ps"])
    for (const size of [0, 256, 512, 768]) {
      const { rec, descriptor } = fixture(stage, size);
      const actual = await decodeShaderRecord(descriptor, rec, { debug: true, reduced: false });
      const script = `import ast,base64,json,os,struct,sys,tempfile\na=json.load(sys.stdin);p=sys.argv[1];t=ast.parse(open(p).read());f=next(n for n in t.body if isinstance(n,ast.FunctionDef) and n.name=='job_for');g={'struct':struct,'os':os,'stage_of':{},'FACTS':{a['key']:a['facts']}};os.environ['XLATE_DEBUG']='1';os.environ['XLATE_REDUCED']='0';exec(compile(ast.Module(body=[f],type_ignores=[]),p,'exec'),g)\nwith tempfile.TemporaryDirectory() as d:\n j,c=g['job_for'](a['key'],a['name'],base64.b64decode(a['rec']),d);code=open(j.pop('code'),'rb').read();print(json.dumps({'job':j,'code':base64.b64encode(code).decode()}))`;
      const native = spawnSync(
        "python3",
        ["-c", script, new URL("dm/gfx/tools/dmsh_build.py", root).pathname],
        {
          input: JSON.stringify({ ...descriptor, rec: Buffer.from(rec).toString("base64") }),
          encoding: "utf8",
        },
      );
      assert.equal(native.status, 0, native.stderr);
      const expected = JSON.parse(native.stdout);
      assert.deepEqual(actual.job, expected.job);
      assert.equal(Buffer.from(actual.code).toString("base64"), expected.code);
      rec[rec.length - 1] ^= 1;
      await assert.rejects(
        decodeShaderRecord(descriptor, rec, { debug: true, reduced: false }),
        /Control hash/,
      );
    }
});
test("invalid c1 and SPH fail closed even with a matching control hash", async () => {
  for (const kind of ["c1", "sph"]) {
    const { rec, descriptor } = fixture("vs", 0);
    if (kind === "c1") {
      const ci = rec.length - 0x880;
      new DataView(rec.buffer).setUint32(ci + 0x704, 0xffffffff, true);
      descriptor.key = createHash("sha256").update(rec.subarray(ci)).digest("hex").slice(0, 16);
    } else new DataView(rec.buffer).setUint32(0x68, 0, true);
    await assert.rejects(
      decodeShaderRecord(descriptor, rec, { debug: true, reduced: true }),
      kind === "c1" ? /c1 range/ : /SPH stage/,
    );
  }
});
test("control search skips partial candidates without skipping the first full marker", async () => {
  const { rec, descriptor } = fixture("cs", 0);
  rec.set([0x34, 0x34, 0x12, 0x76], 0x38);
  const actual = await decodeShaderRecord(descriptor, rec, { debug: true, reduced: false });
  assert.deepEqual(actual.code, rec.slice(0x38, rec.length - 0x880));
  rec.set([0x34, 0x12, 0x76, 0x98], 0x38);
  await assert.rejects(
    decodeShaderRecord(descriptor, rec, { debug: true, reduced: false }),
    /Control hash/,
  );
});
test("control search rejects a partial marker at the end of the record", async () => {
  const { rec, descriptor } = fixture("cs", 0);
  rec[rec.length - 0x880] = 0;
  rec.set([0x34, 0x12, 0x76], rec.length - 3);
  await assert.rejects(
    decodeShaderRecord(descriptor, rec, { debug: true, reduced: false }),
    /Missing\/truncated shader control segment/,
  );
});
test("pack record search keeps native non-overlapping marker boundaries", async () => {
  const catalog = await loadShaderCatalog(input());
  const key = catalog.keys.find((candidate) => {
    const descriptor = catalog.describe(candidate);
    return !descriptor.embedded && descriptor.index === 1 && descriptor.stage === "cs";
  });
  assert.ok(key);
  // 仅有一个不重叠标记；若错误地逐字节推进，偏移 4 会被当作第二条记录。
  // Only one non-overlapping marker exists; advancing bytewise would count offset 4 as a second record.
  const packText = "BTCDBTCDBTCD";
  assert.equal(packText.indexOf("BTCDBTCD", 1), 4);
  assert.equal(packText.indexOf("BTCDBTCD", 8), -1);
  const packBytes = new TextEncoder().encode(packText);
  await assert.rejects(
    catalog.prepare(key, { packBytes, debug: true, reduced: false }),
    /Catalog record absent from pack/,
  );
});

const ownedFlags = Object.freeze({ debug: true, reduced: false });
function ownedFixture(catalog, name = "cs_lut_combine_c.bin") {
  const descriptors = catalog.keys
    .map((key) => catalog.describe(key))
    .filter((entry) => entry.name === name)
    .sort((a, b) => a.index - b.index);
  assert.ok(descriptors.length);
  const records = descriptors.map((descriptor) => {
    const { rec } = fixture(descriptor.stage, 0);
    // 每个合成控制段均有独立内容，不伪造真实目录或扩大摘要模拟范围。
    // Distinguish synthetic controls without replacing the pinned catalog or broadening the digest mock.
    new DataView(rec.buffer).setUint32(rec.length - 0x880 + 8, descriptor.index + 1, true);
    if (descriptor.stage === "cs") rec[0x38] = descriptor.index + 1;
    return rec;
  });
  return { descriptors, records };
}
function joinedBytes(parts) {
  const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}
function mockSyntheticControls(t, { descriptors, records }, beforeReturn = async () => {}) {
  const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
  const controls = new Map(
    records.map((record, i) => [
      Buffer.from(record.subarray(record.length - 0x880)).toString("hex"),
      descriptors[i].key,
    ]),
  );
  let calls = 0;
  t.mock.method(crypto.subtle, "digest", async (algorithm, data) => {
    const key =
      algorithm === "SHA-256" && data.byteLength === 0x880
        ? controls.get(Buffer.from(data).toString("hex"))
        : undefined;
    if (!key) return nativeDigest(algorithm, data);
    calls++;
    await beforeReturn();
    return Uint8Array.from(Buffer.from(key.padEnd(64, "0"), "hex")).buffer;
  });
  return {
    get calls() {
      return calls;
    },
  };
}
function observeOwnedStorage(t) {
  const nativeClone = globalThis.structuredClone;
  const NativeOffsets = Uint32Array;
  const transferred = [];
  const offsets = [];
  t.mock.method(globalThis, "structuredClone", (value, options) => {
    const result = nativeClone(value, options);
    if (options?.transfer?.length) {
      const buffer = result instanceof ArrayBuffer ? result : result.buffer;
      assert.ok(buffer instanceof ArrayBuffer);
      transferred.push(new Uint8Array(buffer));
    }
    return result;
  });
  t.mock.method(globalThis, "Uint32Array", function (...args) {
    const result = new NativeOffsets(...args);
    offsets.push(result);
    return result;
  });
  return { transferred, offsets };
}
test("public catalog prepare keeps borrowed subviews attached", async (t) => {
  const catalog = await loadShaderCatalog(input());
  const generated = ownedFixture(catalog);
  mockSyntheticControls(t, generated);
  const pack = joinedBytes(generated.records);
  const backing = new Uint8Array(pack.length + 2);
  backing.set(pack, 1);
  const borrowed = backing.subarray(1, -1);
  const result = await catalog.prepare(generated.descriptors[1].key, {
    ...ownedFlags,
    packBytes: borrowed,
  });
  assert.deepEqual(borrowed, pack);
  assert.equal(backing.byteLength, pack.length + 2);
  assert.equal(result.code[0], 2);
});
test("owned pack takes exclusive transferred storage and exposes only a frozen source", async (t) => {
  const catalog = await loadShaderCatalog(input());
  const generated = ownedFixture(catalog);
  const digest = mockSyntheticControls(t, generated);
  const storage = observeOwnedStorage(t);
  const pack = joinedBytes(generated.records);
  const alias = new Uint8Array(pack.buffer);
  const view = new DataView(pack.buffer);
  const independent = pack.slice();
  const source = catalog.createOwnedPackSource(generated.descriptors[0].name, pack);
  try {
    assert.equal(pack.byteLength, 0);
    assert.equal(alias.byteLength, 0);
    assert.throws(() => view.getUint8(0), TypeError);
    assert.ok(Object.isFrozen(source));
    assert.deepEqual(Reflect.ownKeys(source).sort(), ["dispose", "prepare"]);
    assert.equal(storage.transferred.length, 1);
    assert.deepEqual(storage.transferred[0], independent);
    assert.equal(storage.offsets.length, 1);
    assert.equal(storage.offsets[0].length, 3);
    assert.ok(
      storage.offsets[0].every((value) => value === 0),
      "offsets are populated lazily",
    );
    const descriptor = generated.descriptors[0];
    const prepared = await source.prepare(descriptor.key, {
      ...ownedFlags,
      packBytes: new Uint8Array(1),
    });
    assert.equal(prepared.job.key, descriptor.key);
    assert.equal(prepared.job.stage, descriptor.stage);
    assert.equal(prepared.source.name, descriptor.name);
    assert.equal(prepared.source.index, descriptor.index);
    assert.equal(prepared.source.pcPaired, descriptor.pcPaired);
    assert.equal(prepared.source.controlVerified, true);
    assert.equal(prepared.installable, false);
    assert.equal(digest.calls, 1);
  } finally {
    source.dispose();
  }
  source.dispose();
  assert.ok(storage.transferred[0].every((value) => value === 0));
  assert.ok(storage.offsets.length > 0);
  assert.ok(storage.offsets.every((table) => table.every((value) => value === 0)));
  assert.ok(independent.some((value) => value !== 0));
  await assert.rejects(source.prepare(generated.descriptors[0].key, ownedFlags), /disposed/i);
  assert.equal(digest.calls, 1);
});
test("owned pack rejects unknown or embedded names and non-exclusive backing stores without detaching", async () => {
  const catalog = await loadShaderCatalog(input());
  const name = catalog.describe(catalog.keys[0]).name;
  const embedded = catalog.keys.map((key) => catalog.describe(key)).find((entry) => entry.embedded);
  for (const invalidName of ["missing.bin", embedded.name, "../cs_lut_combine_c.bin", null]) {
    const pack = new Uint8Array([1, 2, 3]);
    assert.throws(() => catalog.createOwnedPackSource(invalidName, pack));
    assert.deepEqual(pack, new Uint8Array([1, 2, 3]));
  }
  const full = new Uint8Array([1, 2, 3, 4]);
  const shared = new Uint8Array(new SharedArrayBuffer(4));
  const resizable = new Uint8Array(new ArrayBuffer(4, { maxByteLength: 8 }));
  for (const pack of [
    new Uint8Array(),
    new Uint16Array(2),
    [1, 2],
    full.subarray(1),
    full.subarray(0, 3),
    shared,
    resizable,
  ]) {
    assert.throws(() => catalog.createOwnedPackSource(name, pack));
  }
  assert.deepEqual(full, new Uint8Array([1, 2, 3, 4]));
  assert.equal(shared.byteLength, 4);
  assert.equal(resizable.byteLength, 4);
  const detached = new Uint8Array(4);
  structuredClone(detached.buffer, { transfer: [detached.buffer] });
  assert.throws(() => catalog.createOwnedPackSource(name, detached));
  const oversized = new Uint8Array(256 * 1024 * 1024 + 1);
  assert.throws(() => catalog.createOwnedPackSource(name, oversized));
  assert.equal(oversized.byteLength, 256 * 1024 * 1024 + 1);
});
test("owned pack transfer failures have no copy fallback", async (t) => {
  const catalog = await loadShaderCatalog(input());
  const name = catalog.describe(catalog.keys[0]).name;
  const pack = new Uint8Array([1, 2, 3]);
  const failure = new Error("synthetic transfer unavailable");
  const clone = t.mock.method(globalThis, "structuredClone", () => {
    throw failure;
  });
  assert.throws(() => catalog.createOwnedPackSource(name, pack));
  assert.equal(clone.mock.callCount(), 1);
  assert.deepEqual(pack, new Uint8Array([1, 2, 3]));
});
test("owned pack index allocation failure leaves caller ownership intact", async (t) => {
  const catalog = await loadShaderCatalog(input());
  const name = catalog.describe(catalog.keys[0]).name;
  const pack = new Uint8Array([1, 2, 3]);
  const failure = new Error("synthetic offset allocation failure");
  const clone = t.mock.method(globalThis, "structuredClone");
  t.mock.method(globalThis, "Uint32Array", function () {
    throw failure;
  });
  assert.throws(() => catalog.createOwnedPackSource(name, pack), failure);
  assert.equal(clone.mock.callCount(), 0);
  assert.deepEqual(pack, new Uint8Array([1, 2, 3]));
});
test("owned pack binds its name and catalog key while preserving explicit decoder flags", async (t) => {
  const catalog = await loadShaderCatalog(input());
  const generated = ownedFixture(catalog);
  const digest = mockSyntheticControls(t, generated);
  const name = generated.descriptors[0].name;
  const storage = observeOwnedStorage(t);
  const embedded = catalog.keys.map((key) => catalog.describe(key)).find((entry) => entry.embedded);
  const other = catalog.keys
    .map((key) => catalog.describe(key))
    .find((entry) => !entry.embedded && entry.name !== name);
  for (const [key, flags, expected] of [
    ["0000000000000000", ownedFlags, /pack source/i],
    [embedded.key, ownedFlags, /pack source/i],
    [other.key, ownedFlags, /pack source/i],
    [generated.descriptors[0].key, undefined, /Explicit/],
  ]) {
    const source = catalog.createOwnedPackSource(name, joinedBytes(generated.records));
    try {
      await assert.rejects(source.prepare(key, flags), expected);
      assert.ok(storage.transferred.at(-1).every((value) => value === 0));
      await assert.rejects(source.prepare(generated.descriptors[0].key, ownedFlags), /disposed/i);
    } finally {
      source.dispose();
    }
  }
  assert.equal(digest.calls, 0);
  const source = catalog.createOwnedPackSource(name, joinedBytes(generated.records));
  t.after(() => source.dispose());
  const result = await source.prepare(generated.descriptors[0].key, {
    debug: false,
    reduced: true,
  });
  assert.equal(result.job.debug, false);
  assert.equal(result.job.reduced, true);
});
test("owned pack indexes lazily within the selected catalog bound and decodes repeated out-of-order requests", async (t) => {
  const catalog = await loadShaderCatalog(input());
  const generated = ownedFixture(catalog);
  assert.deepEqual(
    generated.descriptors.map((entry) => entry.index),
    [0, 1],
  );
  const digest = mockSyntheticControls(t, generated);
  const storage = observeOwnedStorage(t);
  const suffix = new TextEncoder().encode("BTCDBTCD".repeat(20000));
  const source = catalog.createOwnedPackSource(
    generated.descriptors[0].name,
    joinedBytes([...generated.records, suffix]),
  );
  t.after(() => source.dispose());
  assert.equal(storage.offsets.length, 1);
  assert.ok(storage.offsets[0].every((value) => value === 0));
  const nativeIndexOf = Uint8Array.prototype.indexOf;
  let packSearches = 0;
  t.mock.method(Uint8Array.prototype, "indexOf", function (...args) {
    if (this.buffer === storage.transferred[0].buffer) packSearches++;
    return nativeIndexOf.apply(this, args);
  });
  const last = await source.prepare(generated.descriptors[1].key, ownedFlags);
  assert.equal(last.code[0], 2);
  assert.ok(storage.offsets.length > 0);
  assert.ok(storage.offsets.every((table) => table.length <= 3));
  assert.ok(packSearches <= 3, "unused pack markers must not extend the catalog-bounded scan");
  const searches = packSearches;
  const tables = storage.offsets.length;
  last.code.fill(0);
  const first = await source.prepare(generated.descriptors[0].key, ownedFlags);
  const repeated = await source.prepare(generated.descriptors[1].key, ownedFlags);
  assert.equal(first.code[0], 1);
  assert.equal(repeated.code[0], 2);
  assert.notEqual(repeated.code.buffer, last.code.buffer);
  assert.equal(digest.calls, 3, "every prepare must re-run record integrity checks");
  assert.equal(packSearches, searches, "indexed requests must not rescan the pack");
  assert.equal(storage.offsets.length, tables);
});
test("owned pack preserves non-overlapping record markers and the final EOF boundary", async (t) => {
  const catalog = await loadShaderCatalog(input());
  const generated = ownedFixture(catalog);
  mockSyntheticControls(t, generated);
  const name = generated.descriptors[0].name;
  for (const prefix of [generated.records[0], new TextEncoder().encode("BTCDBTCDBTCD\0")]) {
    const source = catalog.createOwnedPackSource(name, joinedBytes([prefix, generated.records[1]]));
    try {
      const result = await source.prepare(generated.descriptors[1].key, ownedFlags);
      assert.deepEqual(result.code, generated.records[1].slice(0x38, -0x880));
    } finally {
      source.dispose();
    }
  }
  const absent = catalog.createOwnedPackSource(name, new TextEncoder().encode("BTCDBTCDBTCD"));
  try {
    await assert.rejects(absent.prepare(generated.descriptors[1].key, ownedFlags), /record absent/);
  } finally {
    absent.dispose();
  }
});
test("owned pack retains real control-hash rejection and permits failure cleanup", async (t) => {
  const catalog = await loadShaderCatalog(input());
  const generated = ownedFixture(catalog);
  const storage = observeOwnedStorage(t);
  const source = catalog.createOwnedPackSource(
    generated.descriptors[0].name,
    joinedBytes(generated.records),
  );
  try {
    // 此处使用真实摘要，合成控制段绝不能被认作固定目录中的游戏记录。
    // Real hashing here must reject synthetic controls as pinned catalog records.
    await assert.rejects(source.prepare(generated.descriptors[0].key, ownedFlags), /Control hash/);
    assert.ok(storage.transferred[0].every((value) => value === 0));
    assert.ok(storage.offsets.every((table) => table.every((value) => value === 0)));
  } finally {
    source.dispose();
  }
  assert.ok(storage.transferred[0].every((value) => value === 0));
  assert.ok(storage.offsets.every((table) => table.every((value) => value === 0)));
  await assert.rejects(source.prepare(generated.descriptors[0].key, ownedFlags), /disposed/i);
});
test("owned pack retains stage and c1 guards after a synthetic matching control hash", async (t) => {
  const catalog = await loadShaderCatalog(input());
  for (const kind of ["c1", "stage"]) {
    await t.test(kind, async (t) => {
      const generated = ownedFixture(catalog, "ps_alpha_threshold_p.bin");
      const record = generated.records[0];
      const view = new DataView(record.buffer);
      if (kind === "c1") view.setUint32(record.length - 0x880 + 0x704, 0xffffffff, true);
      else view.setUint32(0x68, 0, true);
      mockSyntheticControls(t, generated);
      const source = catalog.createOwnedPackSource(generated.descriptors[0].name, record);
      t.after(() => source.dispose());
      await assert.rejects(
        source.prepare(generated.descriptors[0].key, ownedFlags),
        kind === "c1" ? /c1 range/ : /SPH stage/,
      );
    });
  }
});
test("owned pack rejects already-aborted requests before decoding", async (t) => {
  const catalog = await loadShaderCatalog(input());
  const generated = ownedFixture(catalog);
  const digest = mockSyntheticControls(t, generated);
  const storage = observeOwnedStorage(t);
  const source = catalog.createOwnedPackSource(
    generated.descriptors[0].name,
    joinedBytes(generated.records),
  );
  t.after(() => source.dispose());
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    source.prepare(generated.descriptors[0].key, { ...ownedFlags, signal: controller.signal }),
    { name: "AbortError" },
  );
  assert.equal(digest.calls, 0);
  assert.ok(storage.transferred[0].every((value) => value === 0));
  assert.ok(storage.offsets.every((table) => table.every((value) => value === 0)));
  await assert.rejects(source.prepare(generated.descriptors[0].key, ownedFlags), /disposed/i);
});
test("owned pack wipes late successful code when disposal or cancellation races decoding", async (t) => {
  const catalog = await loadShaderCatalog(input());
  for (const mode of ["dispose", "abort"]) {
    await t.test(mode, async (t) => {
      const generated = ownedFixture(catalog);
      const reached = Promise.withResolvers();
      const gate = Promise.withResolvers();
      mockSyntheticControls(t, generated, async () => {
        reached.resolve();
        await gate.promise;
      });
      const storage = observeOwnedStorage(t);
      const codeCopies = [];
      const nativeSlice = Uint8Array.prototype.slice;
      t.mock.method(Uint8Array.prototype, "slice", function (...args) {
        const result = nativeSlice.apply(this, args);
        if (args[0] === 0x38 && result.length === 16) codeCopies.push(result);
        return result;
      });
      const controller = new AbortController();
      const source = catalog.createOwnedPackSource(
        generated.descriptors[0].name,
        joinedBytes(generated.records),
      );
      t.after(() => source.dispose());
      const pending = source.prepare(generated.descriptors[0].key, {
        ...ownedFlags,
        signal: controller.signal,
      });
      await reached.promise;
      if (mode === "dispose") source.dispose();
      else controller.abort();
      gate.resolve();
      await assert.rejects(pending, mode === "dispose" ? /disposed/i : { name: "AbortError" });
      assert.equal(codeCopies.length, 1, "decoder completed after the pending hash settled");
      assert.ok(codeCopies[0].every((value) => value === 0));
      source.dispose();
      assert.ok(storage.transferred[0].every((value) => value === 0));
      assert.ok(storage.offsets.every((table) => table.every((value) => value === 0)));
    });
  }
});
