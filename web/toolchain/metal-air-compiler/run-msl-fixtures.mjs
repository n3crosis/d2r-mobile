import process from "node:process";
// Native bootstrap checks; not a browser/iOS/full-game completion claim.
import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const root = dirname(fileURLToPath(import.meta.url));
const clang = process.argv[2] || join(root, "build/bin/clang");
const out = process.env.AIR_TEST_OUTPUT_DIR || join(root, "msl-fixture-results");
mkdirSync(out, { recursive: true });
const sha = (b) => createHash("sha256").update(b).digest("hex");
const records = [];
for (const [stage, define, values] of [
  ["compute", "FACTOR", ["3", "7"]],
  ["vertex", "SCALE", ["2.0f", "4.0f"]],
  ["fragment", "THRESHOLD", ["0.25f", "0.75f"]],
]) {
  const path = join(root, "fixtures", `msl-${stage}.metal`);
  const source = readFileSync(path);
  const outputs = [];
  for (const value of values) {
    const args = [
      "-cc1",
      "-triple",
      "air64-apple-ios18.0.0",
      "-x",
      "metal",
      "-std=metal3.0",
      "-Werror=unknown-attributes",
      "-I",
      join(root, "api/include"),
      "-emit-llvm",
      "-o",
      "-",
      "-",
    ];
    const variant = source.toString().replaceAll(define, value);
    const r = spawnSync(clang, args, {
      input: variant,
      encoding: "utf8",
      maxBuffer: 16 * 1024 * 1024,
    });
    const name = `${stage}-${value}`;
    writeFileSync(join(out, name + ".stderr"), r.stderr || String(r.error || ""));
    assert.equal(r.status, 0, `${name} must compile`);
    assert.match(
      r.stdout,
      new RegExp(`!air\\.${stage === "compute" ? "kernel" : stage} =`),
      `${name} stage metadata`,
    );
    writeFileSync(join(out, name + ".ll"), r.stdout);
    records.push({
      stage,
      sourceSha256: sha(variant),
      fixtureTemplateSha256: sha(source),
      preludeSha256: sha(readFileSync(join(root, "api/include/metal_stdlib"))),
      sourceSubstitution: `${define}=${value}`,
      irSha256: sha(r.stdout),
    });
    outputs.push(r.stdout);
  }
  assert.notEqual(
    outputs[0],
    outputs[1],
    `${stage} output must respond to source changes (same stdin filename)`,
  );
}
writeFileSync(
  join(out, "results.json"),
  JSON.stringify({ scope: "native experimental subset only", records }, null, 2),
);
console.log(
  "Six authored MSL-subset inputs compiled to source-dependent AIR IR. Not browser, full-game or iOS acceptance proof.",
);
