// 浏览器诊断契约：验证固定标签、隐私边界及有界资源计数。
// Browser diagnostic contracts: verify fixed labels, privacy boundaries and bounded resource counts.
import test from "node:test";
import assert from "node:assert/strict";
import ts from "typescript";
import {
  packagingActivity,
  shaderProgressLabel,
  sanitizeShaderRecordProgress,
  packagingFailureMessage,
  packagingFailureSummary,
  shaderFailureDetails,
  sanitizeResourceOutcome,
  sanitizeResourceProgress,
  resourceProgressLabel,
} from "../packaging-diagnostics.mjs";

test("resource status projects safe counters without flooding activity logs", () => {
  const resourceProgress = sanitizeResourceProgress({
    filesWritten: 2,
    totalFiles: 3,
    bytesWritten: 4500000000n,
    totalBytes: 9000000000n,
    directoryName: "PRIVATE-PATH",
    private: "PRIVATE-KEY",
  });
  assert.deepEqual(resourceProgress, {
    filesWritten: 2,
    totalFiles: 3,
    bytesWritten: 4500000000,
    totalBytes: 9000000000,
  });
  assert.equal(Object.isFrozen(resourceProgress), true);
  assert.doesNotMatch(JSON.stringify(resourceProgress), /PRIVATE/);
  const event = { stage: "resources", state: "running", resourceProgress };
  assert.equal(resourceProgressLabel(event), "Saving game resources: 2/3 files; 4500.0/9000.0 MB");
  assert.equal(
    packagingActivity(event),
    packagingActivity({ ...event, resourceProgress: undefined }),
  );
  assert.equal(resourceProgressLabel({ ...event, state: "complete" }), null);
  assert.equal(resourceProgressLabel({ ...event, state: "failed" }), null);
  assert.equal(resourceProgressLabel({ ...event, stage: "archive" }), null);
  assert.equal(resourceProgressLabel({ ...event, resourceProgress: undefined }), null);
  assert.notEqual(packagingActivity({ ...event, state: "complete" }), packagingActivity(event));
});

test("resource counters reject unsafe values and inconsistent totals", () => {
  const valid = { filesWritten: 0, totalFiles: 1, bytesWritten: 0, totalBytes: 10 };
  for (const field of Object.keys(valid)) {
    for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null]) {
      assert.equal(sanitizeResourceProgress({ ...valid, [field]: count }), undefined);
    }
  }
  for (const bytesWritten of [-1n, BigInt(Number.MAX_SAFE_INTEGER) + 1n]) {
    assert.equal(sanitizeResourceProgress({ ...valid, bytesWritten }), undefined);
  }
  assert.equal(sanitizeResourceProgress({ ...valid, filesWritten: 2 }), undefined);
  assert.equal(sanitizeResourceProgress({ ...valid, bytesWritten: 11 }), undefined);
  assert.equal(sanitizeResourceProgress({ ...valid, totalFiles: 1n }), undefined);
  assert.equal(sanitizeResourceProgress(null), undefined);
  assert.equal(sanitizeResourceProgress({}), undefined);
  assert.deepEqual(
    sanitizeResourceProgress({
      ...valid,
      bytesWritten: BigInt(Number.MAX_SAFE_INTEGER),
      totalBytes: BigInt(Number.MAX_SAFE_INTEGER),
    }),
    { ...valid, bytesWritten: Number.MAX_SAFE_INTEGER, totalBytes: Number.MAX_SAFE_INTEGER },
  );
  assert.equal(
    resourceProgressLabel({
      stage: "resources",
      state: "running",
      resourceProgress: { filesWritten: 0, totalFiles: 0, bytesWritten: 0, totalBytes: 0 },
    }),
    "Saving game resources: 0/0 files; 0.0/0.0 MB",
  );
});

test("activity log accepts only fixed stages, bounded counts and public codes", () => {
  assert.equal(packagingActivity({ stage: "PRIVATE-PATH", label: "PRIVATE-KEY" }), null);
  assert.equal(
    packagingActivity({ stage: "secrets", label: "PRIVATE-KEY" }),
    "Verifying local keys and packages: running",
  );
  assert.equal(
    packagingActivity({
      stage: "secrets",
      diagnostic: { stage: "content-hash", completed: 1, total: 3, bytes: 2000000 },
    }),
    "Hashing package content (1/3); 2.0 MB",
  );
  assert.equal(
    packagingActivity({
      diagnostic: { stage: "content-hash", completed: 1, total: 3, bytes: 2, private: "CANARY" },
    }),
    null,
  );
  assert.doesNotMatch(
    packagingFailureSummary({ stage: "PRIVATE-PATH", detailCode: "PRIVATE-KEY" }),
    /PRIVATE/,
  );
  assert.equal(
    packagingActivity({
      stage: "extraction",
      diagnostic: { stage: "romfs-merged", completed: 50, total: 100, bytes: 4500000000 },
    }),
    "Verifying merged update RomFS: 50% (4500.0 MB verified)",
  );
});

test("resource recovery details stay out of activity logs and copied failure summaries", () => {
  const directoryName = "D2R-resources-12345678-1234-4123-8123-123456789abc";
  const resources = sanitizeResourceOutcome({
    status: "complete",
    directoryName,
    private: "PRIVATE-KEY",
  });
  assert.deepEqual(resources, { status: "complete", directoryName });
  assert.equal(Object.isFrozen(resources), true);
  const report = { stage: "archive", outputStarted: true, resources };
  assert.match(packagingFailureMessage(report), /Complete game resources remain in D2R-resources-/);
  assert.doesNotMatch(packagingFailureSummary(report), /D2R-resources|PRIVATE/);
  assert.doesNotMatch(packagingActivity({ stage: "archive", resources }), /D2R-resources|PRIVATE/);
  assert.doesNotMatch(
    packagingFailureMessage({
      ...report,
      resources: { status: "complete", directoryName: "PRIVATE-PATH" },
    }),
    /PRIVATE/,
  );
  const incomplete = {
    status: "incomplete",
    directoryName,
    cleanupComplete: false,
    incompleteMarkerPresent: true,
  };
  assert.match(
    packagingFailureMessage({ ...report, resources: incomplete }),
    /Do not use this as a finished resource set/,
  );
  assert.match(
    packagingFailureMessage({ ...report, resources: incomplete }),
    /warning marker remains/,
  );
  assert.match(
    packagingFailureMessage({
      ...report,
      resources: { ...incomplete, cleanupComplete: true, incompleteMarkerPresent: false },
    }),
    /no resource folder from this attempt remains/,
  );
  assert.equal(sanitizeResourceOutcome({ ...incomplete, cleanupComplete: "true" }), undefined);
});
test("early failure never suggests resource exports; key code is actionable", () => {
  const message = packagingFailureMessage({
    stage: "secrets",
    detailCode: "PROD_KEYS_UNREADABLE",
    outputStarted: false,
  });
  assert.match(message, /PROD_KEYS_UNREADABLE/);
  assert.match(message, /No resources were exported/);
  assert.doesNotMatch(message, /may have been saved/);
  assert.match(
    packagingFailureMessage({ stage: "output", outputStarted: true }),
    /may have been saved/,
  );
});

test("ticket diagnostics are specific and counters never expose input details", () => {
  for (const [stage, label] of [
    ["ticket-found", "Embedded tickets found"],
    ["ticket-key-added", "Title keys added from tickets"],
    ["ticket-key-reused", "Existing title keys reused"],
  ]) {
    assert.equal(
      packagingActivity({ diagnostic: { stage, completed: 2, total: 2, bytes: 0 } }),
      `${label}: 2`,
    );
    assert.equal(
      packagingActivity({
        diagnostic: { stage, completed: 2, total: 2, bytes: 0, filename: "PRIVATE" },
      }),
      null,
    );
  }
  for (const detailCode of [
    "TICKET_UNSUPPORTED",
    "TICKET_INVALID",
    "TICKET_RIGHTS_ID_MISMATCH",
    "TICKET_KEY_CONFLICT",
    "TICKET_LIMIT_EXCEEDED",
  ]) {
    const message = packagingFailureSummary({ stage: "secrets", detailCode });
    assert.match(message, new RegExp(`\\[${detailCode}\\]`));
    assert.doesNotMatch(message, /undefined/);
  }
  assert.doesNotMatch(
    packagingFailureSummary({ stage: "secrets", detailCode: "TITLE_KEY_REQUIRED" }),
    /does not import NSP tickets/,
  );
});

test("shader record labels remain bounded running counters without private fields", async () => {
  const { createShaderDiagnosticObserver } = await import("../browser-packager.mjs");
  const events = [];
  const observer = createShaderDiagnosticObserver((event) => events.push(event));
  observer({ completedRecords: 6927, totalRecords: 6927, name: "PRIVATE" });
  assert.equal(events.length, 1);
  assert.equal(events[0].state, "running");
  assert.equal(shaderProgressLabel(events[0]), "Generating shaders (6927/6927)");
  assert.doesNotMatch(JSON.stringify(events), /PRIVATE|name/);
  assert.equal(shaderProgressLabel({ ...events[0], state: "complete" }), null);
  assert.equal(shaderProgressLabel({ ...events[0], stage: "assets" }), null);
  for (const value of [
    { completedRecords: 2, totalRecords: 1 },
    { completedRecords: 0, totalRecords: 1 },
    { completedRecords: 1, totalRecords: 6928 },
    { completedRecords: NaN, totalRecords: 1 },
  ]) {
    assert.equal(sanitizeShaderRecordProgress(value), undefined);
    observer(value);
  }
  assert.equal(events.length, 1);
  const controller = new AbortController();
  controller.abort();
  createShaderDiagnosticObserver(
    () => assert.fail("cancelled"),
    controller.signal,
  )({ completedRecords: 1, totalRecords: 1 });
  createShaderDiagnosticObserver(() => {
    throw new Error("private");
  })({ completedRecords: 1, totalRecords: 1 });
  createShaderDiagnosticObserver(async () => {
    throw new Error("private");
  })({ completedRecords: 1, totalRecords: 1 });
  await new Promise((resolve) => setImmediate(resolve));
});

// 按语法选取进度声明及其条件分支，不依赖后续注释的文本或语言。
// Select the progress declaration and conditional by syntax, not a following comment's text or language.
function shaderStatusBranch(text) {
  const file = ts.createSourceFile(
    "App.tsx",
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const matches = [];
  function visit(node) {
    if (ts.isBlock(node) || ts.isSourceFile(node)) {
      for (let i = 1; i < node.statements.length; i++) {
        const previous = node.statements[i - 1];
        const branch = node.statements[i];
        if (
          !ts.isVariableStatement(previous) ||
          !ts.isIfStatement(branch) ||
          !ts.isIdentifier(branch.expression) ||
          branch.expression.text !== "shaderLabel" ||
          !ts.isBlock(branch.thenStatement)
        )
          continue;
        const declaration = previous.declarationList.declarations;
        if (declaration.length !== 1) continue;
        const { name, initializer } = declaration[0];
        if (
          !ts.isIdentifier(name) ||
          name.text !== "shaderLabel" ||
          !initializer ||
          !ts.isCallExpression(initializer) ||
          !ts.isIdentifier(initializer.expression) ||
          initializer.expression.text !== "shaderProgressLabel" ||
          initializer.arguments.length !== 1 ||
          !ts.isIdentifier(initializer.arguments[0]) ||
          initializer.arguments[0].text !== "event"
        )
          continue;
        matches.push(text.slice(previous.getStart(file), branch.thenStatement.end));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  assert.equal(matches.length, 1, "Expected one shader progress status branch");
  return matches[0];
}

test("shader status source selection is independent of following comments", () => {
  const branch =
    "const shaderLabel = shaderProgressLabel(event); if (shaderLabel) { pendingGenerationStatus.current = shaderLabel; appendActivity(null); return; }";
  for (const comment of [
    "// 补充包导出单独显示",
    "// Supplemental export status",
    "/* renamed */",
    "",
  ]) {
    const source = `function progress(event) { ${branch}\n${comment}\n unrelated(); }`;
    assert.equal(shaderStatusBranch(source), branch);
  }
  assert.throws(
    () =>
      shaderStatusBranch("// const shaderLabel = shaderProgressLabel(event); if (shaderLabel) {}"),
    /Expected one/,
  );
  assert.throws(
    () => shaderStatusBranch(`function progress(event) { ${branch} ${branch} }`),
    /Expected one/,
  );
});

test("production shader counters use coalesced UI status without record log spam", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const branch = shaderStatusBranch(app);
  assert.match(branch, /pendingGenerationStatus.current = shaderLabel/);
  assert.match(branch, /appendActivity\(null\)/);
  assert.match(branch, /return;/);
  assert.match(app, /cancellation.current\?\.abort\(\);\s*pendingGenerationStatus.current = null/);
  const packager = await readFile(new URL("../browser-packager.mjs", import.meta.url), "utf8");
  assert.match(
    packager,
    /onProgress: createShaderDiagnosticObserver\(onProgress, context.signal\)/,
  );
  const shaders = await readFile(new URL("../production-shaders.mjs", import.meta.url), "utf8");
  assert.ok(
    shaders.indexOf("reportRecords(pending.length)") >
      shaders.indexOf("budget.replace(0, base.length"),
  );
  assert.ok(
    shaders.indexOf("reportRecords(pending.length)") <
      shaders.indexOf("await pipeline.verifyCompleteSourceSet()"),
  );
});

test("IPA output failure preserves an explicitly skipped resource export", () => {
  for (const code of ["STAGE_FAILED", "CANCELLED"]) {
    const message = packagingFailureMessage({
      code,
      stage: "output",
      outputStarted: true,
      resources: { status: "skipped", reason: "user-requested" },
    });
    assert.match(message, /No resources were exported by this attempt/);
    assert.doesNotMatch(message, /Resources may have been saved/);
  }
  for (const resources of [
    undefined,
    { status: "skipped" },
    { status: "skipped", reason: "other" },
  ])
    assert.match(
      packagingFailureMessage({
        code: "STAGE_FAILED",
        stage: "output",
        outputStarted: true,
        resources,
      }),
      /Resources may have been saved/,
    );
});

test("shader reports display allowlisted AIR codes without raw compiler text", () => {
  const report = {
    stage: "shaders",
    code: "STAGE_FAILED",
    detailCode: "AIR_FRONTEND_FAILED",
    message: "PRIVATE-SOURCE-CANARY",
  };
  assert.match(packagingFailureSummary(report), /\[AIR_FRONTEND_FAILED\]/);
  assert.doesNotMatch(packagingFailureSummary(report), /PRIVATE/);
  assert.doesNotMatch(
    packagingFailureSummary({ ...report, stage: "assets" }),
    /AIR_FRONTEND_FAILED/,
  );
  assert.doesNotMatch(
    packagingFailureSummary({ ...report, detailCode: "AIR_PRIVATE-SOURCE-CANARY" }),
    /PRIVATE/,
  );
});

test("shader failure details show actionable local diagnostics without raw reports", () => {
  const report = {
    stage: "shaders",
    code: "STAGE_FAILED",
    message: "PRIVATE-RAW-REPORT",
    stack: "PRIVATE-STACK",
    shaderDiagnostic: {
      substep: "compilation",
      compilerPhase: "frontend",
      errorType: "Error",
      record: 1,
      variant: "b",
      shaderStage: "vertex",
      diagnostics: ["error: use of undeclared identifier 'reverse_bits'"],
      sourceSha256: "a".repeat(64),
      sourceDigest: "b".repeat(16),
      private: "PRIVATE-KEY",
      path: "/PRIVATE-PATH",
    },
  };
  const lines = shaderFailureDetails(report).join("\n");
  assert.match(lines, /compilation/);
  assert.match(lines, /#1/);
  assert.match(lines, /reverse_bits/);
  assert.match(lines, /SHA-256: a{64}/);
  assert.doesNotMatch(lines, /PRIVATE/);
  assert.deepEqual(shaderFailureDetails({ ...report, stage: "secrets" }), []);
  assert.deepEqual(shaderFailureDetails({ ...report, code: "CANCELLED" }), []);
  assert.deepEqual(shaderFailureDetails({ stage: "shaders" }), []);
});

test("UI appends sanitized shader detail lines after the failure summary", async () => {
  const { readFile } = await import("node:fs/promises");
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(
    app,
    /appendActivity\(packagingFailureSummary\(report\), true\);\s*for \(const detail of shaderFailureDetails\(report\)\) appendActivity\(detail, true\)/,
  );
});

test("shader progress exposes only a bounded actual compiler worker count", () => {
  for (const count of [1, 2, 4]) {
    const progress = sanitizeShaderRecordProgress({
      completedRecords: 2,
      totalRecords: 6927,
      compilerWorkers: count,
    });
    assert.equal(progress.compilerWorkers, count);
    assert.equal(
      shaderProgressLabel({
        stage: "shaders",
        state: "running",
        diagnostic: { kind: "shader-records", ...progress },
      }),
      `Generating shaders (2/6927) · compiler workers: ${count}`,
    );
  }
  for (const count of [0, 5, NaN, "4", "PRIVATE"]) {
    const progress = sanitizeShaderRecordProgress({
      completedRecords: 2,
      totalRecords: 6927,
      compilerWorkers: count,
    });
    assert.equal(progress.compilerWorkers, undefined);
  }
});
test("direct data reuse has checking progress and non-destructive collision instructions", () => {
  const progress = sanitizeResourceProgress({
    operation: "verify",
    filesWritten: 1,
    totalFiles: 2,
    bytesWritten: 3,
    totalBytes: 4,
  });
  assert.match(
    resourceProgressLabel({ stage: "resources", state: "running", resourceProgress: progress }),
    /^Checking existing resources:/,
  );
  assert.deepEqual(sanitizeResourceOutcome({ status: "complete", directoryName: "data" }), {
    status: "complete",
    directoryName: "data",
  });
  const message = packagingFailureMessage({
    stage: "output",
    outputStarted: true,
    resources: {
      status: "incomplete",
      directoryName: "data",
      cleanupComplete: true,
      incompleteMarkerPresent: false,
      existingDataPreserved: true,
      reason: "RESOURCE_EXISTING_DATA_UNVERIFIED",
    },
  });
  assert.match(message, /existing data folder could not be verified/);
  assert.match(message, /files were not changed/);
  assert.match(message, /Skip resource export/);
  assert.doesNotMatch(message, /export was removed|Complete game resources remain/);
  assert.doesNotMatch(
    JSON.stringify(
      sanitizeResourceOutcome({
        status: "incomplete",
        directoryName: "data",
        cleanupComplete: true,
        incompleteMarkerPresent: false,
        reason: "PRIVATE-PATH",
      }),
    ),
    /PRIVATE/,
  );
});
