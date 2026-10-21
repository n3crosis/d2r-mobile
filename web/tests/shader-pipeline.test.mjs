import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createShaderPipeline } from "../shader-pipeline.mjs";
import {
  CROSS_COMMIT,
  MSL_ARGUMENTS,
  validateSpirv,
} from "../toolchain/spirv-cross-spike/wwwroot/convert.mjs";
import { fixtures as graphicsFixtures } from "../toolchain/shader-pipeline-spike/graphics-fixtures.mjs";
import { replayFields } from "../toolchain/spirv-cross-spike/wwwroot/replay-reflection.mjs";
const key = "0000000000000001",
  chain = "abcdef012345",
  msl = "kernel void main0() {}\n";
const spv = new Uint8Array(new Uint32Array([0x07230203, 0x10000, 0, 1, 0]).buffer);
const sha = (x) => createHash("sha256").update(x).digest("hex");
const sourceDigest = (sources) => {
  const h = createHash("sha256");
  for (const [k, v] of [...sources].sort(([a], [b]) => a.localeCompare(b)))
    h.update(`${k}_b.metal`).update(createHash("sha256").update(v.replace(/\r\n/g, "\n")).digest());
  return h.digest("hex").slice(0, 16);
};
function shell(keys = [key], source = sourceDigest([[key, msl]])) {
  const targetOS = { platform: "ios", minimumVersion: "16.0" },
    requiredPaths = [`msl/b-${chain}/`];
  return {
    entries: ["Info.plist", "App", "dm/shell_info.txt", "dm/shell_manifest.txt"].map((x) => ({
      path: `Payload/App.app/${x}`,
      size: 10,
      mode: 0o100644,
    })),
    shellInfoText: `PRODUCT=synthetic\nCHAIN=${chain}\nKIND=ios\nSHADER_SRC=${source}\nSPIRV_CROSS=1.4.363.0\n`,
    shellManifestText: requiredPaths.join("\n"),
    observedTargetOS: targetOS,
    trustedRecipe: {
      schemaVersion: 1,
      product: "synthetic",
      chain,
      kind: "ios",
      shaderDigest: source,
      targetOS,
      requiredPaths,
      shaderKeys: keys,
      spirvCrossVersion: "1.4.363.0",
    },
  };
}
const job = { key, stage: "cs", local: [1, 1, 1], debug: true, reduced: false };
function setup({
  trustedShell = shell(),
  mutateTranslate,
  mutateCross,
  hang,
  crash,
  timeoutMs = 500,
  wrongId = false,
  transferInputs = true,
} = {}) {
  const workers = [];
  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      this.terminated = false;
      workers.push(this);
    }
    addEventListener(type, cb) {
      if (!this.listeners.has(type)) this.listeners.set(type, new Set());
      this.listeners.get(type).add(cb);
    }
    removeEventListener(type, cb) {
      this.listeners.get(type)?.delete(cb);
    }
    terminate() {
      this.terminated = true;
    }
    emit(type, value) {
      for (const fn of this.listeners.get(type) ?? []) fn(value);
    }
    postMessage(raw, transfer) {
      const data = structuredClone(raw, transferInputs ? { transfer } : undefined);
      this.request = data;
      queueMicrotask(() => {
        if (hang) return;
        if (crash) return this.emit("error", { message: "synthetic runtime failure" });
        if (this.url.includes("translator")) {
          let result = {
            spirvBase64: Buffer.from(spv).toString("base64"),
            resources: {
              key: data.job.key,
              stage: data.job.stage,
              notes: [],
              sbufs: [],
              cbufs: [],
              textures: [],
              images: [],
            },
          };
          result = mutateTranslate?.(result) ?? result;
          if (wrongId) this.emit("message", { data: { requestId: -1, error: "unrelated" } });
          this.emit("message", { data: { requestId: data.requestId, result } });
        } else {
          const stage = data.replayContext.stage;
          const stageMsl = {
            cs: msl,
            vs: "vertex void main0() {}\n",
            ps: "fragment void main0() {}\n",
          }[stage];
          const result = {
            schema: "spirv-cross-browser-stage-v1",
            msl: stageMsl,
            reflection: { entryPoints: [{ mode: { cs: "comp", vs: "vert", ps: "frag" }[stage] }] },
            replay: replayFields(stage, stageMsl, data.replayContext.resources),
            provenance: {
              spirvCrossCommit: CROSS_COMMIT,
              mslArguments: [...MSL_ARGUMENTS],
              inputSha256: sha(new Uint8Array(data.spirv)),
              mslSha256: sha(stageMsl),
              nativeChainClaimed: false,
              metalCompiled: false,
            },
          };
          this.emit("message", {
            data: { id: data.id, ok: true, result: mutateCross?.(result) ?? result },
          });
        }
      });
    }
  }
  const options = {
    trustedShell,
    baseUrl: "https://app.example/tools/index.html",
    translatorWorkerUrl: "./translator.mjs",
    crossWorkerUrl: "./cross.mjs",
    workerFactory: (url, opts) => {
      assert.deepEqual(opts, { type: "module" });
      return new FakeWorker(url);
    },
    timeoutMs,
  };
  return { pipeline: createShaderPipeline(options), workers, options };
}
test("actual worker protocols connect, resource facts pass unchanged, transfer preserves caller input", async () => {
  const { pipeline, workers } = setup({ wrongId: true }),
    code = new Uint8Array(16);
  const result = await pipeline.translate({ job, code });
  assert.equal(code.byteLength, 16);
  assert.equal(result.msl, msl);
  assert.equal(result.installable, false);
  assert.equal(result.shaderSourceSetVerified, false);
  assert.equal(result.metalCompiled, false);
  assert.equal(workers.length, 2);
  assert.ok(workers.every((x) => x.terminated));
  assert.deepEqual(workers[1].request.replayContext.resources, result.resources);
  assert.deepEqual(new Uint8Array(workers[1].request.spirv), spv);
  assert.match(result.provenance.codeSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(await pipeline.verifyCompleteSourceSet(), {
    status: "shader-source-set-equivalent",
    sourceDigest: sourceDigest([[key, msl]]),
    shellChain: chain,
    shaderCount: 1,
    installable: false,
    metalCompiled: false,
    chainRewritten: false,
  });
  await assert.rejects(pipeline.translate({ job, code }), /already converted/);
  pipeline.dispose();
});
test("SHADER_SRC aggregate matches original Python function with filename ordering", async () => {
  const key2 = "0000000000000002",
    expected = sourceDigest([
      [key, msl],
      [key2, msl],
    ]),
    { pipeline } = setup({ trustedShell: shell([key2, key], expected) });
  await pipeline.translate({ job: { ...job, key: key2 }, code: new Uint8Array(16) });
  await assert.rejects(pipeline.verifyCompleteSourceSet(), /Incomplete/);
  await pipeline.translate({ job, code: new Uint8Array(16) });
  const dir = mkdtempSync(join(tmpdir(), "shader-src-"));
  try {
    writeFileSync(join(dir, `${key}_b.metal`), msl);
    writeFileSync(join(dir, `${key2}_b.metal`), msl);
    const script =
      'import ast,hashlib,os,sys\np=sys.argv[1]\nt=ast.parse(open(p).read())\nf=next(n for n in t.body if isinstance(n,ast.FunctionDef) and n.name=="src_digest")\nexec(compile(ast.Module(body=[f],type_ignores=[]),p,"exec"))\nprint(src_digest(sys.argv[2]))';
    const native = spawnSync(
      "python3",
      ["-c", script, new URL("../../dm/tools/d2rm_pack.py", import.meta.url).pathname, dir],
      { encoding: "utf8" },
    );
    assert.equal(native.status, 0, native.stderr);
    assert.equal((await pipeline.verifyCompleteSourceSet()).sourceDigest, native.stdout.trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
    pipeline.dispose();
  }
});
test("trusted shell mismatch, missing catalog and off-origin assets fail before worker start", () => {
  const { options } = setup();
  const invalid = shell();
  invalid.shellInfoText = invalid.shellInfoText.replace(chain, "bad");
  assert.throws(
    () => createShaderPipeline({ ...options, trustedShell: invalid }),
    /CHAIN mismatch/,
  );
  // Both an obsolete compiler and an unverified future compiler fail closed,
  // even when the shell and application recipe agree with one another.
  for (const version of ["1.4.357.0", "1.4.999.0"]) {
    const incompatible = shell();
    incompatible.shellInfoText = incompatible.shellInfoText.replace(
      "SPIRV_CROSS=1.4.363.0",
      `SPIRV_CROSS=${version}`,
    );
    incompatible.trustedRecipe.spirvCrossVersion = version;
    assert.throws(
      () => createShaderPipeline({ ...options, trustedShell: incompatible }),
      /Unsupported shell SPIRV_CROSS/,
    );
  }
  const disagree = shell();
  disagree.trustedRecipe.spirvCrossVersion = "1.4.357.0";
  assert.throws(
    () => createShaderPipeline({ ...options, trustedShell: disagree }),
    /Unsupported shell SPIRV_CROSS/,
  );
  const missing = shell();
  delete missing.trustedRecipe.shaderKeys;
  assert.throws(() => createShaderPipeline({ ...options, trustedShell: missing }), /catalog/);
  for (const url of [
    "https://elsewhere.example/a.mjs",
    "data:text/javascript,x",
    "file:///tmp/a.mjs",
    "https://u:p@app.example/a.mjs",
  ])
    assert.throws(() => createShaderPipeline({ ...options, crossWorkerUrl: url }), /self-hosted/);
});
test("geometry/tessellation, unknown keys and implicit options remain unsupported", async () => {
  const { pipeline, workers } = setup();
  await assert.rejects(
    pipeline.translate({ job: { ...job, stage: "gs" }, code: new Uint8Array(16) }),
    /Unsupported shader stage/,
  );
  await assert.rejects(
    pipeline.translate({ job: { ...job, key: "ffffffffffffffff" }, code: new Uint8Array(16) }),
    /outside trusted/,
  );
  await assert.rejects(
    pipeline.translate({ job: { ...job, reduced: undefined }, code: new Uint8Array(16) }),
    /Explicit native/,
  );
  assert.equal(workers.length, 0);
  pipeline.dispose();
});
test("translator defaults, malformed SPIR-V and wrong resource identity fail closed", async () => {
  for (const mutateTranslate of [
    (r) => ({ ...r, spirvBase64: "bad" }),
    (r) => ({ ...r, resources: { ...r.resources, key: "bad" } }),
    (r) => ({ ...r, resources: { ...r.resources, notes: ["missing texture type"] } }),
  ]) {
    const { pipeline, workers } = setup({ mutateTranslate });
    await assert.rejects(pipeline.translate({ job, code: new Uint8Array(16) }));
    assert.equal(workers.length, 1);
    assert.ok(workers[0].terminated);
    pipeline.dispose();
  }
});
test("forged compiler provenance, output hash and replay are rejected", async () => {
  for (const mutateCross of [
    (r) => ({ ...r, provenance: { ...r.provenance, spirvCrossCommit: "wrong" } }),
    (r) => ({ ...r, msl: r.msl + "corrupt" }),
    (r) => ({ ...r, replay: {} }),
    (r) => ({ ...r, provenance: { ...r.provenance, nativeChainClaimed: true } }),
  ]) {
    const { pipeline, workers } = setup({ mutateCross });
    await assert.rejects(pipeline.translate({ job, code: new Uint8Array(16) }), /mismatch/);
    assert.ok(workers.every((x) => x.terminated));
    await assert.rejects(pipeline.verifyCompleteSourceSet(), /Incomplete/);
    pipeline.dispose();
  }
});
test("complete but mismatched source set is never accepted or relabeled", async () => {
  const { pipeline } = setup({ trustedShell: shell([key], "0000000000000000") });
  await pipeline.translate({ job, code: new Uint8Array(16) });
  await assert.rejects(pipeline.verifyCompleteSourceSet(), /SHADER_SRC mismatch/);
  pipeline.dispose();
});
test("abort, disposal, worker crash and deadline terminate workers and release busy state", async () => {
  for (const action of ["abort", "dispose", "timeout", "crash"]) {
    const { pipeline, workers } = setup({
        hang: action !== "crash",
        crash: action === "crash",
        timeoutMs: 20,
      }),
      controller = new AbortController();
    const pending = pipeline.translate({
      job,
      code: new Uint8Array(16),
      signal: controller.signal,
    });
    const rejected = assert.rejects(pending, /cancelled|timed out|worker failed/);
    if (action !== "crash")
      await assert.rejects(pipeline.translate({ job, code: new Uint8Array(16) }), /one shader/);
    await new Promise((resolve) => setTimeout(resolve, 5));
    if (action === "abort") controller.abort();
    if (action === "dispose") pipeline.dispose();
    await rejected;
    assert.ok(workers.every((x) => x.terminated));
    pipeline.dispose();
    await assert.rejects(pipeline.verifyCompleteSourceSet(), /disposed/);
  }
});

test("owned hash snapshots are wiped on cancellation, rejection and successful facade replies", async () => {
  const originalDigest = crypto.subtle.digest;
  for (const outcome of ["abort-code", "abort-spirv", "bad-provenance", "success"]) {
    const captured = [],
      controller = new AbortController();
    crypto.subtle.digest = function (algorithm, bytes) {
      captured.push(bytes);
      if (
        (outcome === "abort-code" && captured.length === 1) ||
        (outcome === "abort-spirv" && captured.length === 3)
      )
        controller.abort();
      return originalDigest.call(this, algorithm, bytes);
    };
    const { pipeline, workers } = setup({
      transferInputs: false,
      mutateCross:
        outcome === "bad-provenance" ? (result) => ({ ...result, replay: {} }) : undefined,
    });
    const caller = new Uint8Array(16).fill(7);
    try {
      const pending = pipeline.translate({ job, code: caller, signal: controller.signal });
      if (outcome === "success") {
        assert.equal((await pending).msl, msl);
      } else {
        await assert.rejects(pending, outcome.startsWith("abort") ? /cancelled/ : /mismatch/);
      }
      assert.equal(
        captured.length,
        outcome === "abort-code" ? 2 : outcome === "abort-spirv" ? 3 : 4,
      );
      for (const owned of captured) {
        assert.notEqual(owned, caller);
        assert.ok(owned.every((byte) => byte === 0));
      }
      assert.deepEqual(caller, new Uint8Array(16).fill(7));
      assert.ok(workers.every((worker) => worker.terminated));
      crypto.subtle.digest = originalDigest;
      if (outcome === "success")
        assert.equal((await pipeline.verifyCompleteSourceSet()).shaderCount, 1);
      else await assert.rejects(pipeline.verifyCompleteSourceSet(), /Incomplete/);
    } finally {
      crypto.subtle.digest = originalDigest;
      pipeline.dispose();
    }
  }
});

test("temporary decoded SPIR-V is wiped after validation success or rejection", async () => {
  const originalFrom = Uint8Array.from;
  for (const valid of [true, false]) {
    let decoded;
    Uint8Array.from = function (input, ...args) {
      const result = originalFrom.call(this, input, ...args);
      if (typeof input === "string") decoded = result;
      return result;
    };
    const { pipeline } = setup({
      mutateTranslate: valid
        ? undefined
        : (result) => ({
            ...result,
            spirvBase64: Buffer.alloc(20, 7).toString("base64"),
          }),
    });
    try {
      const pending = pipeline.translate({ job, code: new Uint8Array(16) });
      if (valid) assert.equal((await pending).msl, msl);
      else await assert.rejects(pending, /SPIR-V magic/);
      assert.equal(decoded.length, 20);
      assert.ok(decoded.every((byte) => byte === 0));
    } finally {
      Uint8Array.from = originalFrom;
      pipeline.dispose();
    }
  }
});

test("graphics validates full SPH, explicit metadata and stage-specific wire/replay fields", async () => {
  for (const f of graphicsFixtures.filter((f) => f.job.stage !== "cs")) {
    const expectedMsl =
      f.job.stage === "vs" ? "vertex void main0() {}\n" : "fragment void main0() {}\n";
    const { pipeline, workers } = setup({
      trustedShell: shell([f.job.key], sourceDigest([[f.job.key, expectedMsl]])),
    });
    const result = await pipeline.translate({ job: f.job, code: f.code });
    assert.equal(result.stage, f.job.stage);
    assert.equal(result.threadgroup_size, null);
    assert.equal(workers[1].request.replayContext.stage, f.job.stage);
    assert.equal(result.replay.msl_entry_kind, f.job.stage === "vs" ? "vertex" : "fragment");
    await pipeline.verifyCompleteSourceSet();
    pipeline.dispose();
    for (const [badJob, badCode, pattern] of [
      [f.job, new Uint8Array(16), /SPH/],
      [f.job, new Uint8Array(f.code.length), /SPH stage/],
      [{ ...f.job, attr: undefined }, f.code, /explicit attr/],
      [{ ...f.job, attr: { 32: "float" } }, f.code, /Invalid graphics/],
      [{ ...f.job, fout: { 0: "double" } }, f.code, /Invalid graphics/],
    ]) {
      const { pipeline, workers } = setup({ trustedShell: shell([f.job.key]) });
      await assert.rejects(pipeline.translate({ job: badJob, code: badCode }), pattern);
      assert.equal(workers.length, 0);
      pipeline.dispose();
    }
  }
});
test("compiled stage mismatch is rejected even if hashes and replay are otherwise valid", async () => {
  const { pipeline } = setup({
    mutateCross: (r) => ({ ...r, reflection: { entryPoints: [{ mode: "frag" }] } }),
  });
  await assert.rejects(
    pipeline.translate({ job, code: new Uint8Array(16) }),
    /stage does not match/,
  );
  pipeline.dispose();
});

test("SPIR-V validation owns an exact copy of Buffer subviews", () => {
  const backing = Buffer.alloc(spv.length + 8, 7),
    input = backing.subarray(4, -4);
  input.set(spv);
  const before = Buffer.from(backing),
    validated = validateSpirv(input);
  assert.equal(Object.getPrototypeOf(validated), Uint8Array.prototype);
  assert.notEqual(validated.buffer, input.buffer);
  assert.equal(validated.buffer.byteLength, input.byteLength);
  assert.deepEqual(validated, spv);
  validated.fill(0);
  assert.deepEqual(backing, before);
});

test("Buffer caller bytes survive shader transfers and all cleanup outcomes", async () => {
  for (const transferInputs of [true, false]) {
    for (const outcome of ["success", "abort", "crash"]) {
      const backing = Buffer.alloc(24, 7),
        code = backing.subarray(4, 20),
        before = Buffer.from(backing),
        controller = new AbortController(),
        { pipeline, workers } = setup({ transferInputs, crash: outcome === "crash" });
      try {
        const pending = pipeline.translate({ job, code, signal: controller.signal });
        if (outcome === "abort") controller.abort();
        if (outcome === "success") assert.equal((await pending).msl, msl);
        else await assert.rejects(pending, outcome === "abort" ? /cancelled/ : /worker failed/);
        assert.deepEqual(backing, before);
        assert.equal(code.byteLength, 16);
        assert.ok(workers.every((worker) => worker.terminated));
      } finally {
        pipeline.dispose();
      }
    }
  }
});
