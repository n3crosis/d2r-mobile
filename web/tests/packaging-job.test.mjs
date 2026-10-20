import test from "node:test";
import assert from "node:assert/strict";
import {
  runPackagingJob,
  REQUIRED_PACKAGING_ADAPTERS,
  PackagingJobError,
} from "../packaging-job.mjs";

// Synthetic orchestration fixtures ONLY. Not decryption, conversion, signing or IPA compatibility proof.
function fixture() {
  const calls = [],
    progress = [];
  const input = ["game.nsp", "prod.keys", "title.keys"].map((name) => ({
    name,
    webkitRelativePath: `folder/${name}`,
    size: 0,
    slice() {
      throw new Error("Keys must only be opened by secret adapter");
    },
  }));
  const targetOS = { platform: "ios", minimumVersion: "16.0" };
  const entry = (path, mode = 0o100644) => ({
    path,
    mode,
    size: 1,
    async *chunks() {
      yield new Uint8Array([1]);
    },
  });
  const shellEntries = ["Info.plist", "Game", "dm/shell_info.txt", "dm/shell_manifest.txt"].map(
    (p) => entry(`Payload/Game.app/${p}`),
  );
  const requiredPaths = ["Frameworks/Guest.framework/", "dm/assets", "msl/shader"];
  const contract = {
    entries: shellEntries,
    shellInfoText: "PRODUCT=test\nCHAIN=test\nKIND=ios\nSHADER_SRC=0123456789abcdef",
    shellManifestText: requiredPaths.join("\n"),
    trustedRecipe: {
      schemaVersion: 1,
      product: "test",
      chain: "test",
      kind: "ios",
      shaderDigest: "0123456789abcdef",
      targetOS,
      requiredPaths,
    },
    observedTargetOS: targetOS,
  };
  const content = {
    contentId: "1".repeat(32),
    sha256: "2".repeat(64),
    size: 1n,
    type: 1,
    idOffset: 0,
  };
  const app = 0xf123456789abc000n;
  const base = {
    type: "Application",
    titleId: app,
    applicationId: app,
    patchId: app + 0x800n,
    version: 0n,
    contents: [content],
  };
  const adapters = {
    async openSecretSession() {
      calls.push("open");
      return {
        async dispose() {
          calls.push("dispose");
        },
      };
    },
    async inspectContents() {
      calls.push("inspect");
      return { records: [base], inventory: [{ ...content, hashVerified: true }] };
    },
    async extractSelected() {
      calls.push("extract");
      return {};
    },
    async generateProgram(context) {
      assert.equal(context.inputs, undefined);
      assert.equal(context.session, undefined);
      calls.push("program");
      return [
        {
          ...entry("Frameworks/Guest.framework/Guest", 0o100755),
          signature: { kind: "ad-hoc", offset: 0, size: 1 },
        },
      ];
    },
    async generateAssets() {
      calls.push("assets");
      return [entry("dm/assets")];
    },
    async generateShaders() {
      calls.push("shaders");
      return [entry("msl/shader")];
    },
    async loadShell() {
      calls.push("shell");
      return { contract, entries: shellEntries };
    },
    async validateGenerated() {
      calls.push("validate");
      return { valid: true, observedOutputTargetOS: targetOS };
    },
    async createOutput() {
      calls.push("create");
      return {
        async write() {
          calls.push("write");
        },
        async close() {
          calls.push("close");
        },
        async abort() {
          calls.push("abort");
        },
      };
    },
    async validateArchive() {
      calls.push("archive");
      return { valid: true };
    },
    async cleanup() {
      calls.push("cleanup");
    },
  };
  return { input, adapters, calls, progress, onProgress: (p) => progress.push(p) };
}

test("missing capabilities fail before touching input or opening output", async () => {
  for (const missing of REQUIRED_PACKAGING_ADAPTERS) {
    const f = fixture();
    delete f.adapters[missing];
    f.input = {
      get kind() {
        throw new Error("Input touched");
      },
    };
    await assert.rejects(runPackagingJob(f), (e) => e.report.code === "CAPABILITY_UNAVAILABLE");
    assert.deepEqual(f.calls, []);
  }
});
test("complete ordered lifecycle and deterministic detached manifest", async () => {
  const f = fixture();
  const result = await runPackagingJob(f);
  assert.equal(result.status, "complete");
  assert.equal(result.installable, false);
  assert.equal(result.committed, true);
  assert.deepEqual(f.calls.slice(0, 4), ["open", "inspect", "extract", "dispose"]);
  assert.ok(f.calls.indexOf("validate") < f.calls.indexOf("create"));
  assert.deepEqual(f.calls.slice(-3), ["archive", "cleanup", "close"]);
  assert.deepEqual(
    result.manifest.map((e) => e.path),
    result.manifest.map((e) => e.path).sort(),
  );
  assert.ok(Object.isFrozen(result.manifest[0]));
  assert.equal(f.calls.includes("abort"), false);
});
test("bounded generator concurrency and draining in-flight work before cleanup", async () => {
  const f = fixture();
  let active = 0,
    peak = 0;
  for (const key of ["generateProgram", "generateAssets", "generateShaders"]) {
    const original = f.adapters[key];
    f.adapters[key] = async (context) => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return original(context);
    };
  }
  await runPackagingJob({ ...f, concurrency: 2 });
  assert.equal(peak, 2);
  assert.equal(active, 0);
});
test("original error preserved, cleanup errors sanitized, no arbitrary messages reported", async () => {
  const f = fixture(),
    original = new Error("SECRET KEY CONTENT");
  f.adapters.inspectContents = async () => {
    throw original;
  };
  f.adapters.openSecretSession = async () => ({
    async dispose() {
      throw new Error("SECRET DISPOSE");
    },
  });
  f.adapters.cleanup = async () => {
    throw new Error("SECRET CLEANUP");
  };
  await assert.rejects(runPackagingJob(f), (e) => {
    assert.ok(e instanceof PackagingJobError);
    assert.equal(e.cause, original);
    assert.deepEqual(e.report.cleanupCodes, ["SECRET_DISPOSAL_FAILED", "RESOURCE_CLEANUP_FAILED"]);
    assert.equal(JSON.stringify(e).includes("CONTENT"), false);
    assert.equal(e.report.stage, "inspection");
    return true;
  });
  assert.equal(f.calls.includes("create"), false);
});
test("failed generator cancels peers, waits for drain, and never creates output", async () => {
  const f = fixture();
  let settled = false;
  f.adapters.generateProgram = async () => {
    throw new Error("failure");
  };
  f.adapters.generateAssets = async () => {
    await new Promise((r) => setTimeout(r, 10));
    settled = true;
    return [];
  };
  f.adapters.cleanup = async () => {
    assert.equal(settled, true);
  };
  await assert.rejects(runPackagingJob(f));
  assert.equal(f.calls.includes("create"), false);
});
test("cancellation during extraction disposes session and does not generate", async () => {
  const f = fixture(),
    controller = new AbortController();
  f.adapters.extractSelected = async () => {
    controller.abort("SECRET");
    return {};
  };
  await assert.rejects(
    runPackagingJob({ ...f, signal: controller.signal }),
    (e) => e.report.code === "CANCELLED",
  );
  assert.ok(f.calls.includes("dispose"));
  assert.equal(f.calls.includes("program"), false);
});
test("validation and close failures prevent success and abort the staged output", async () => {
  for (const failing of ["validateGenerated", "validateArchive", "close", "cleanup"]) {
    const f = fixture();
    if (failing === "close")
      f.adapters.createOutput = async () => ({
        async write() {},
        async close() {
          throw new Error("close failed");
        },
        async abort() {
          f.calls.push("abort");
        },
      });
    else
      f.adapters[failing] = async () => {
        throw new Error("failure");
      };
    await assert.rejects(runPackagingJob(f), (e) => !e.report.committed);
    assert.equal(f.calls.includes("abort"), failing !== "validateGenerated");
  }
});
test("writes await sink backpressure and cancellation after close begins cannot undo commit", async () => {
  const f = fixture(),
    controller = new AbortController();
  let writing = false,
    writes = 0;
  f.adapters.createOutput = async () => ({
    async write() {
      assert.equal(writing, false);
      writing = true;
      await Promise.resolve();
      writes++;
      writing = false;
    },
    async close() {
      controller.abort();
    },
    async abort() {
      assert.fail("Committed output cannot be aborted");
    },
  });
  const result = await runPackagingJob({
    ...f,
    signal: controller.signal,
    onProgress() {
      throw new Error("observer secret");
    },
  });
  assert.equal(result.committed, true);
  assert.ok(writes > 0);
});
test("forged streamed shell inventory is rejected before output creation", async () => {
  const f = fixture(),
    load = f.adapters.loadShell;
  f.adapters.loadShell = async (context) => {
    const shell = await load(context);
    shell.entries = [...shell.entries, { path: "extra", size: 0, mode: 0o644 }];
    return shell;
  };
  await assert.rejects(runPackagingJob(f));
  assert.equal(f.calls.includes("create"), false);
});

test("every required generation stage and both explicit validation acknowledgments gate output", async () => {
  for (const key of ["generateProgram", "generateAssets", "generateShaders", "loadShell"]) {
    const f = fixture();
    f.adapters[key] = async () => {
      throw new Error("unsupported capability");
    };
    await assert.rejects(runPackagingJob(f));
    assert.equal(f.calls.includes("create"), false);
    assert.ok(f.calls.includes("dispose"));
  }
  for (const key of ["validateGenerated", "validateArchive"]) {
    const f = fixture();
    f.adapters[key] = async () => ({ valid: false });
    await assert.rejects(runPackagingJob(f));
    assert.equal(f.calls.includes("close"), false);
  }
});
test("cancellation during writes aborts once, keeps abort failures sanitized, and never closes", async () => {
  const f = fixture(),
    controller = new AbortController();
  let aborts = 0;
  f.adapters.createOutput = async () => ({
    async write() {
      controller.abort("SECRET REASON");
    },
    async close() {
      assert.fail("Must not close");
    },
    async abort(error) {
      aborts++;
      assert.equal(error.message, "PACKAGING_ABORTED");
      throw new Error("SECRET SINK");
    },
  });
  await assert.rejects(runPackagingJob({ ...f, signal: controller.signal }), (e) => {
    assert.equal(e.report.code, "CANCELLED");
    assert.deepEqual(e.report.cleanupCodes, ["OUTPUT_ABORT_FAILED"]);
    assert.equal(JSON.stringify(e.report).includes("SECRET REASON"), false);
    return true;
  });
  assert.equal(aborts, 1);
});
