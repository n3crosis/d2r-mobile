// 验证 packaging-job 的约定与边界；依据 ../packaging-job.mjs 及本文件的测试断言。
// Verify packaging-job contracts and boundaries against ../packaging-job.mjs and this file's assertions.
import test from "node:test";
import assert from "node:assert/strict";
import {
  runPackagingJob,
  REQUIRED_PACKAGING_ADAPTERS,
  PackagingJobError,
} from "../packaging-job.mjs";

// 仅为合成编排样例，不证明解密、转换、签名或 IPA 兼容性。
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
test("selected NSP names exclude an optional package before opening secrets", async () => {
  const f = fixture();
  f.input.push({
    name: "dlc.nsp",
    webkitRelativePath: "folder/dlc.nsp",
    size: 0,
    slice() {
      throw new Error("Excluded package must not be opened");
    },
  });
  f.adapters.openSecretSession = async ({ inputs }) => {
    assert.deepEqual(
      inputs.nsps.map((file) => file.name),
      ["game.nsp"],
    );
    return { async dispose() {} };
  };
  const result = await runPackagingJob({ ...f, selectedNspNames: ["game.nsp"] });
  assert.equal(result.status, "complete");
});
test("verified RomFS progress reaches the packaging observer", async () => {
  const f = fixture();
  f.adapters.extractSelected = async ({ onDiagnostic }) => {
    onDiagnostic({ stage: "romfs-base", completed: 50, total: 100, bytes: 4000000000 });
    return {};
  };
  await runPackagingJob(f);
  assert(
    f.progress.some(
      (event) =>
        event.stage === "extraction" &&
        event.label === "Verifying base RomFS: 50% (4000.0 MB verified)",
    ),
  );
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
// 提交前的快照与复制仍可取消；无关关闭错误不能被竞态取消掩盖。
// Snapshot and copy before commit remain cancellable; racing cancellation must not mask unrelated close errors.
for (const phase of ["snapshot", "copy", "close-failure"]) {
  test(`pre-commit ${phase} preserves the actual outcome`, async () => {
    const f = fixture(),
      controller = new AbortController();
    const diskFailure = new Error("synthetic close failure");
    let aborts = 0,
      committed = false;
    f.adapters.createOutput = async ({ signal }) => ({
      async write() {},
      async close() {
        // 与实际暂存适配器相同，组合信号保留调用方取消原因的身份。
        // Like the real staged adapter, a composed signal preserves the caller's abort-reason identity.
        const transferSignal = AbortSignal.any([signal, new AbortController().signal]);
        await Promise.resolve();
        if (phase === "copy") await Promise.resolve();
        controller.abort();
        if (phase === "close-failure") throw diskFailure;
        transferSignal.throwIfAborted();
        committed = true;
      },
      async abort() {
        aborts++;
      },
    });
    await assert.rejects(runPackagingJob({ ...f, signal: controller.signal }), (error) => {
      assert.equal(error.report.stage, "commit");
      assert.equal(error.report.commitStarted, true);
      assert.equal(error.report.committed, false);
      assert.equal(error.report.code, phase === "close-failure" ? "STAGE_FAILED" : "CANCELLED");
      if (phase === "close-failure") assert.equal(error.cause, diskFailure);
      return true;
    });
    assert.equal(committed, false);
    assert.equal(aborts, 1);
  });
}
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

test("ZIP64 opt-in requires a bounded budget before input or secrets", async () => {
  for (const maxOutputBytes of [undefined, 0, -1, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    const f = fixture();
    await assert.rejects(runPackagingJob({ ...f, archiveFormat: "zip64", maxOutputBytes }));
    assert.deepEqual(f.calls, []);
  }
});
test("ZIP64 keeps staged validation and cleanup before commit", async () => {
  const f = fixture();
  const result = await runPackagingJob({
    ...f,
    archiveFormat: "zip64",
    maxOutputBytes: 1024 * 1024,
  });
  assert.equal(result.committed, true);
  assert.equal(typeof result.bytesWritten, "bigint");
  assert.ok(f.calls.indexOf("archive") < f.calls.indexOf("close"));
  assert.ok(f.calls.indexOf("cleanup") < f.calls.indexOf("close"));
});
test("ZIP64 rejects an insufficient output budget before destination creation", async () => {
  const f = fixture();
  await assert.rejects(runPackagingJob({ ...f, archiveFormat: "zip64", maxOutputBytes: 1 }));
  assert.equal(f.calls.includes("create"), false);
});

test("explicit lazy mode retains isolated session through output reads and disposes before validation", async () => {
  const f = fixture();
  let alive = false;
  f.adapters.openSecretSession = async () => {
    alive = true;
    f.calls.push("open");
    return {
      async dispose() {
        alive = false;
        f.calls.push("dispose");
      },
    };
  };
  f.adapters.generateAssets = async (context) => {
    assert.equal(context.session, undefined);
    assert.equal(context.inputs, undefined);
    return [
      {
        path: "dm/assets",
        mode: 0o100644,
        size: 1,
        async *chunks() {
          assert.equal(alive, true);
          yield new Uint8Array([1]);
        },
      },
    ];
  };
  f.adapters.validateArchive = async () => {
    assert.equal(alive, false);
    f.calls.push("archive");
    return { valid: true };
  };
  await runPackagingJob({ ...f, secretLifetime: "archive" });
  assert.ok(f.calls.indexOf("write") < f.calls.indexOf("dispose"));
  assert.ok(f.calls.indexOf("dispose") < f.calls.indexOf("archive"));
  assert.ok(f.calls.indexOf("archive") < f.calls.indexOf("close"));
});
test("lazy-mode disposal failure prevents archive validation and commit", async () => {
  const f = fixture();
  f.adapters.openSecretSession = async () => ({
    async dispose() {
      f.calls.push("dispose");
      throw new Error("private key session cleanup failure");
    },
  });
  await assert.rejects(runPackagingJob({ ...f, secretLifetime: "archive" }), (e) => {
    assert.equal(e.report.stage, "disposal");
    return true;
  });
  assert.equal(f.calls.filter((x) => x === "dispose").length, 1);
  assert.equal(f.calls.includes("archive"), false);
  assert.equal(f.calls.includes("close"), false);
  assert.equal(f.calls.includes("abort"), true);
});
test("lazy mode still disposes when generation or writing fails", async () => {
  for (const which of ["generation", "writing"]) {
    const f = fixture();
    if (which === "generation")
      f.adapters.generateAssets = async () => {
        throw new Error("failed");
      };
    else
      f.adapters.createOutput = async () => ({
        write: async () => {
          throw new Error("failed");
        },
        close: async () => assert.fail("close"),
        abort: async () => {},
      });
    await assert.rejects(runPackagingJob({ ...f, secretLifetime: "archive" }));
    assert.equal(f.calls.filter((x) => x === "dispose").length, 1);
  }
});

test("safe input diagnoses survive packaging without exposing raw causes or implying output", async () => {
  const f = fixture();
  f.adapters.openSecretSession = async () => {
    const error = new Error("PRIVATE-KEY-PATH-CANARY");
    error.code = "PROD_KEYS_UNREADABLE";
    throw error;
  };
  await assert.rejects(runPackagingJob(f), (error) => {
    assert.equal(error.report.detailCode, "PROD_KEYS_UNREADABLE");
    assert.equal(error.report.outputStarted, false);
    assert.doesNotMatch(JSON.stringify(error.report), /PRIVATE/);
    return true;
  });
});

test("diagnostics from finished stages cannot overwrite current job progress", async () => {
  const f = fixture();
  const diagnostic = { stage: "keys-load", completed: 0, total: 0, bytes: 0 };
  let savedObserver;
  const open = f.adapters.openSecretSession;
  f.adapters.openSecretSession = async (context) => {
    savedObserver = context.onDiagnostic;
    savedObserver(diagnostic);
    return open(context);
  };
  const inspect = f.adapters.inspectContents;
  f.adapters.inspectContents = async (context) => {
    savedObserver(diagnostic);
    return inspect(context);
  };
  const events = [];
  await runPackagingJob({ ...f, onProgress: (event) => events.push(event) });
  savedObserver(diagnostic);
  assert.equal(events.filter((event) => event.diagnostic).length, 1);
});

// 合成观察者失败必须独立于任务结果，也不能延长任务生命周期。
// Synthetic observer failures stay independent of the job outcome and cannot extend its lifetime.
test("rejected async stage and extraction diagnostic observers preserve successful cleanup and commit", async () => {
  const f = fixture();
  let stages = 0,
    diagnostics = 0;
  f.adapters.extractSelected = async ({ onDiagnostic }) => {
    onDiagnostic({ stage: "romfs-base", completed: 50, total: 100, bytes: 64 });
    return {};
  };
  const result = await runPackagingJob({
    ...f,
    onProgress: async (event) => {
      if (event.diagnostic) diagnostics++;
      else stages++;
      throw new Error("synthetic async observer failure");
    },
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(result.committed, true);
  assert.ok(stages > 0);
  assert.equal(diagnostics, 1);
  assert.ok(f.calls.includes("dispose"));
  assert.ok(f.calls.includes("cleanup"));
});
test("rejected async observer cannot replace the underlying job failure", async () => {
  const f = fixture(),
    primary = new Error("synthetic extraction failure");
  f.adapters.extractSelected = async ({ onDiagnostic }) => {
    onDiagnostic({ stage: "romfs-base", completed: 50, total: 100, bytes: 64 });
    throw primary;
  };
  await assert.rejects(
    runPackagingJob({
      ...f,
      onProgress: async () => {
        throw new Error("synthetic async observer failure");
      },
    }),
    (error) => error instanceof PackagingJobError && error.cause === primary,
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(f.calls.includes("dispose"));
  assert.ok(f.calls.includes("cleanup"));
});
test("unsettled progress observers are never awaited before successful commit", async () => {
  const f = fixture();
  f.adapters.extractSelected = async ({ onDiagnostic }) => {
    onDiagnostic({ stage: "romfs-base", completed: 50, total: 100, bytes: 64 });
    return {};
  };
  const result = await runPackagingJob({ ...f, onProgress: () => new Promise(() => {}) });
  assert.equal(result.committed, true);
  assert.ok(f.calls.includes("cleanup"));
});

test("shader failures preserve only fixed AIR codes at the shader stage", async () => {
  for (const [method, code, expected] of [
    ["generateShaders", "AIR_FRONTEND_FAILED", "AIR_FRONTEND_FAILED"],
    ["generateShaders", "AIR_COMPILATION_TIMEOUT", "AIR_COMPILATION_TIMEOUT"],
    ["generateShaders", "PRIVATE-SOURCE-DIAGNOSTIC", null],
    ["generateAssets", "AIR_FRONTEND_FAILED", null],
  ]) {
    const f = fixture();
    f.adapters[method] = async () => {
      throw Object.assign(new Error("PRIVATE-SOURCE-CANARY"), { code });
    };
    await assert.rejects(runPackagingJob(f), (error) => {
      assert.equal(error.report.detailCode, expected);
      assert.equal(error.report.outputStarted, false);
      assert.doesNotMatch(JSON.stringify(error.report), /PRIVATE/);
      return true;
    });
  }
});

test("shader report exposes useful bounded diagnostics without original exception text", async () => {
  const f = fixture();
  f.adapters.generateShaders = async () => {
    throw Object.assign(new Error("/Users/private/prod.keys PRIVATE_RAW_CAUSE"), {
      code: "AIR_FRONTEND_FAILED",
      shaderDiagnostic: {
        substep: "compilation",
        record: 4,
        variant: "bf",
        shaderStage: "fragment",
        compilerPhase: "compiling",
        sourceSha256: "b".repeat(64),
        diagnostics: [
          "use of undeclared identifier 'texture_missing'",
          "error: password = PRIVATE_SECRET",
        ],
        path: "/Users/private/game.nsp",
      },
    });
  };
  await assert.rejects(runPackagingJob(f), (error) => {
    assert.equal(error.report.detailCode, "AIR_FRONTEND_FAILED");
    assert.equal(error.report.shaderDiagnostic.substep, "compilation");
    assert.equal(error.report.shaderDiagnostic.record, 4);
    assert.deepEqual(error.report.shaderDiagnostic.diagnostics, [
      "use of undeclared identifier 'texture_missing'",
    ]);
    assert.equal(error.report.shaderDiagnostic.sourceSha256, "b".repeat(64));
    assert.doesNotMatch(JSON.stringify(error.report), /PRIVATE|Users|prod.keys/);
    return true;
  });
});

// 程序阶段允许固定诊断；本地输入打开阶段仅允许版本及模块不匹配诊断。
// Program generation admits fixed codes; local input opening admits only version/tuple failures.
test("program compatibility reports enforce stage scope before extraction diagnostics", async () => {
  const known = [
    "PROGRAM_UNSUPPORTED_VERSION",
    "PROGRAM_MODULE_RELEASE_MISMATCH",
    "PROGRAM_SHELL_RELEASE_MISMATCH",
    "PROGRAM_INVALID_MODULE_SET",
    "PROGRAM_INPUT_DIGEST_MISMATCH",
    "PROGRAM_BUILD_ID_MISMATCH",
  ];
  const stages = [
    ["openSecretSession", "secrets"],
    ["inspectContents", "inspection"],
    ["selectContents", "selection"],
    ["extractSelected", "extraction"],
    ["generateProgram", "program"],
    ["generateAssets", "assets"],
    ["generateShaders", "shaders"],
    ["loadShell", "shell"],
    ["validateGenerated", "validation"],
    ["createOutput", "output"],
    ["validateArchive", "archive"],
    ["cleanup", "cleanup"],
  ];
  for (const code of [...known, "PRIVATE-KEY", "PROGRAM_UNSUPPORTED_VERSION /PRIVATE-PATH", null]) {
    for (const [method, stage] of stages) {
      const f = fixture();
      f.adapters[method] = async () => {
        if (method === "cleanup") f.calls.push("cleanup");
        throw Object.assign(new Error("PRIVATE-PATH PRIVATE-KEY"), {
          code,
          private: "PRIVATE-INPUT",
        });
      };
      await assert.rejects(runPackagingJob(f), (error) => {
        const allowed =
          (stage === "program" && known.includes(code)) ||
          (stage === "secrets" && known.slice(0, 2).includes(code));
        assert.equal(error.report.stage, stage);
        assert.equal(error.report.detailCode, allowed ? code : null, `${stage}: ${code}`);
        assert.doesNotMatch(JSON.stringify(error.report), /PRIVATE/);
        assert.equal(error.report.committed, false);
        if (!["output", "archive", "cleanup"].includes(stage))
          assert.equal(error.report.outputStarted, false);
        return true;
      });
      assert.ok(f.calls.includes("cleanup"));
      if (!["output", "archive", "cleanup"].includes(stage))
        assert.equal(f.calls.includes("create"), false);
    }
  }
});

test("public diagnostic retains only the single checked error code value", async () => {
  const f = fixture();
  let reads = 0;
  f.adapters.generateProgram = async () => {
    throw Object.defineProperty(new Error("PRIVATE-CAUSE"), "code", {
      get() {
        return ++reads === 1 ? "PROGRAM_UNSUPPORTED_VERSION" : "PRIVATE-UNCHECKED-CODE";
      },
    });
  };
  await assert.rejects(runPackagingJob(f), (error) => {
    assert.equal(error.report.detailCode, "PROGRAM_UNSUPPORTED_VERSION");
    assert.doesNotMatch(JSON.stringify(error.report), /PRIVATE/);
    return true;
  });
  assert.equal(reads, 1);
});

test("mixed package selection includes XCI names without reading excluded packages", async () => {
  const f = fixture();
  f.input.push({
    name: "base.xci",
    webkitRelativePath: "folder/base.xci",
    size: 0,
    slice() {
      throw Error("metadata only");
    },
  });
  const original = f.adapters.openSecretSession;
  f.adapters.openSecretSession = async (context) => {
    assert.deepEqual(
      context.inputs.nsps.map((file) => file.name),
      ["base.xci"],
    );
    return original(context);
  };
  await runPackagingJob({ ...f, selectedNspNames: ["base.xci"] });
});
test("extracted orchestration accepts a separate selection capability without fabricated CNMT", async () => {
  const f = fixture();
  const inputs = ["ExeFS/main", "ExeFS/sdk", "RomFS/data/build_manifest.psv"].map((path) =>
    Object.assign(new Blob(["synthetic"]), {
      name: path.split("/").at(-1),
      webkitRelativePath: `root/${path}`,
    }),
  );
  const selection = {
    inputKind: "extracted",
    dlcMetadata: "not-authenticated",
    contentMode: "base-update-only",
    dlc: [],
  };
  f.adapters.inspectContents = async () => ({ inputKind: "extracted" });
  f.adapters.selectContents = async ({ inputs: discovered }) => {
    assert.equal(discovered.inputMode, "extracted");
    assert.equal(Object.hasOwn(discovered, "prodKeys"), false);
    return selection;
  };
  f.adapters.extractSelected = async (context) => {
    assert.equal(context.selection, selection);
    return {};
  };
  await runPackagingJob({ ...f, input: inputs });
  await assert.rejects(
    runPackagingJob({ ...fixture(), input: inputs, inputMode: "extracted", selectedNspNames: [] }),
  );
});
