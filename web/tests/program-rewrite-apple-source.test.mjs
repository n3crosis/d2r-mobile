// Source parsing and authored synthetic byte records only; no native/WASM execution.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PROGRAM_REWRITER_SOURCE } from "../program-release-catalog.mjs";
import { SOURCE_SHA256 } from "../toolchain/program-rewrite-spike/js/rule-data.mjs";
import { buildOutputs } from "../toolchain/program-rewrite-spike/js/outputs.mjs";
const root = new URL("../toolchain/program-rewrite-spike/", import.meta.url);

test("v2 source, catalog, rule data and explicit Apple proof share the exact source digest", async () => {
  const source = await readFile(new URL("../../dm/tools/patch_nso.py", import.meta.url));
  const digest = createHash("sha256").update(source).digest("hex");
  const baseline = JSON.parse(await readFile(new URL("apple-source-baseline.json", root), "utf8"));
  assert.equal(digest, PROGRAM_REWRITER_SOURCE);
  assert.equal(digest, SOURCE_SHA256);
  assert.equal(digest, baseline.sourceSha256);
  assert.equal(
    (await readFile(new URL("upstream-source.sha256", root), "utf8")).trim(),
    `${digest}  dm/tools/patch_nso.py`,
  );
  assert.equal(baseline.outputFormatAddition, "# TARGET\t0x0\n");
});

test("the full Apple-specialized source AST matches the prior script and rejects semantic mutations", () => {
  const result = spawnSync(
    "python3",
    [
      "-B",
      "-c",
      `
import ast,importlib.util,json,sys
from pathlib import Path
p=Path(sys.argv[1]); spec=importlib.util.spec_from_file_location('apple_audit', p/'audit-apple-source.py')
audit=importlib.util.module_from_spec(spec); spec.loader.exec_module(audit)
contract=audit.verify(); source=audit.SOURCE.read_text(encoding='utf-8')
mutations = [
 ('else: emit(MRS_TPIDRRO(t))', 'else: emit(MRS_TPIDR(t))'),
 ("os.environ.get('DM_TARGET', 'apple')", "os.environ.get('DM_TARGET', 'android')"),
 ('"apple": 0, "android": 1', '"apple": 1, "android": 1'),
 ('emit(STRX(S, T))', 'emit(STRX(T, S))'),
 ('range(0, 16)', 'range(0, 17)'),
 ('else STP(S, T, 31, -16)', 'else STP(S, T, 31, -32)'),
]
for old,new in mutations:
 assert old in source
 changed=source.replace(old,new)
 try:
  normalized,reviewed=audit.specialize(ast.parse(changed))
  assert reviewed != contract['reviewedTargetNodes'] or audit.digest(normalized) != contract['baselineAstSha256'], old
 except ValueError:
  pass
print(json.dumps({'mutationsRejected':len(mutations)}))
`,
      fileURLToPath(root),
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mutationsRejected, 6);
});

test("synthetic output declares Apple0 without changing image bytes or layout records", async () => {
  const patch = Uint8Array.of(1, 2, 3, 4);
  const files = await buildOutputs(
    {
      image: new Uint8Array(65536),
      patchOff: 65536,
      keyPageOff: 49152,
      textEnd: 4,
      roOff: 16384,
      dataOff: 32768,
      moduleName: "main",
      kinds: new Map(),
      done: new Set(),
      windows: [],
      jumps: new Map(),
      relocator: { patchBytes: () => patch, gates: [] },
    },
    { cuts: [], params: [], obs: [], buildId: "synthetic" },
    { K18: 0 },
  );
  assert.deepEqual(files["main.patched.bin"].subarray(65536), patch);
  assert.equal(
    new TextDecoder().decode(files["main.fixups.tsv"]),
    "# TARGET\t0x0\n# PATCH_OFF\t0x10000\n# KEY_PAGE_OFF\t0xc000\n# KEY_PAGE_SIZE\t0x4000\n# TEXT_END\t0x4\n# RO_OFF\t0x4000\n# DATA_OFF\t0x8000\n# KEY_K18_IDX\t0\n",
  );
});
