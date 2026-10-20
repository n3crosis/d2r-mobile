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
