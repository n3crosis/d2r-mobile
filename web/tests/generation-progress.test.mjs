// 合成阶段与 Blob 测试，不运行编译器、WASM、浏览器、设备或私有输入。
// Synthetic stage/Blob tests only: no compiler, WASM, browser, device or private input execution.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createGenerationProgress } from "../generation-progress.mjs";
import { createDownloadPreparation } from "../download-preparation.mjs";
import { createUiOperationGate } from "../ui-operation-gate.mjs";

const output = () => ({ blob: new Blob([new Uint8Array(22)]), fileName: "synthetic.ipa" });
const result = () => ({
  download: output(),
  resources: { status: "complete" },
  legacyPack: { status: "complete" },
});
const stages = [
  "extraction",
  "program",
  "assets",
  "shaders",
  "assembly",
  "resources",
  "legacy-pack",
  "commit",
  "output",
];

test("the equal-stage plan freezes optional exports and signing at job start", () => {
  for (const legacyAstc of [false, true])
    for (const signing of [false, true])
      for (const exportResources of [false, true]) {
        const options = { legacyAstc, signing, exportResources };
        const tracker = createGenerationProgress(options);
        options.legacyAstc = !legacyAstc;
        options.signing = !signing;
        options.exportResources = !exportResources;
        assert.equal(tracker.plan.includes("legacy-pack"), legacyAstc);
        assert.equal(tracker.plan.includes("signing"), signing);
        assert.equal(tracker.plan.includes("resources"), exportResources);
        assert.equal(
          tracker.snapshot().totalStages,
          8 + Number(legacyAstc) + Number(signing) + Number(exportResources),
        );
        assert.ok(Object.isFrozen(tracker.plan));
        assert.ok(Object.isFrozen(tracker.included));
        assert.ok(tracker.plan.every((stage) => !["install", "copy-resources"].includes(stage)));
      }
});

test("stage events are monotonic and cannot claim download readiness", () => {
  const tracker = createGenerationProgress({ legacyAstc: true });
  tracker.prepared();
  let previous = tracker.snapshot().percent;
  for (const stage of stages) {
    tracker.observe({ stage, state: "running", label: "PRIVATE-FILENAME" });
    tracker.observe({ stage, state: "complete" });
    const next = tracker.snapshot();
    assert.ok(next.percent >= previous && next.percent < 100);
    previous = next.percent;
    tracker.observe({ stage, state: "running" });
    assert.equal(tracker.snapshot().percent, previous);
  }
  tracker.downloadPrepared(true);
  assert.ok(tracker.snapshot().percent < 100);
  assert.equal(tracker.generated(result()), true);
  assert.ok(tracker.snapshot().percent < 100);
  tracker.downloadPrepared(true);
  assert.equal(tracker.snapshot().status, "complete");
  assert.equal(tracker.snapshot().percent, 100);
  tracker.observe({ stage: "assets", state: "failed" });
  assert.equal(tracker.snapshot().status, "complete");
});

test("measured counters remain stage-local and omit private labels, paths and arbitrary fields", () => {
  const tracker = createGenerationProgress({ legacyAstc: true });
  for (const event of [
    {
      stage: "shaders",
      diagnostic: {
        kind: "shader-records",
        completedRecords: 4,
        totalRecords: 4,
        secret: "PRIVATE-KEY",
      },
    },
    {
      stage: "resources",
      resourceProgress: {
        filesWritten: 2,
        totalFiles: 2,
        bytesWritten: 32n,
        totalBytes: 32n,
        directoryName: "PRIVATE-PATH",
      },
    },
    {
      stage: "assets",
      diagnostic: {
        kind: "legacy-astc",
        completedBlocks: 500,
        processedBytes: 4096,
        private: "PRIVATE-KEY",
      },
    },
    { stage: "legacy-pack", bytesWritten: 32, totalBytes: 32, directoryName: "PRIVATE-PATH" },
    {
      stage: "extraction",
      diagnostic: { stage: "romfs-merged", completed: 100, total: 100, bytes: 32 },
    },
  ]) {
    tracker.observe({ ...event, state: "running", label: "PRIVATE-FILENAME" });
    const view = tracker.snapshot();
    assert.ok(view.detail);
    assert.equal(view.completedStages, 0);
    assert.equal(view.percent, 0);
    assert.doesNotMatch(JSON.stringify(view), /PRIVATE/);
    assert.ok(Object.isFrozen(view.detail));
  }
  tracker.observe({ stage: "program", state: "running" });
  assert.equal(tracker.snapshot().detail, null);
  for (const number of [NaN, Infinity, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    tracker.observe({
      stage: "legacy-pack",
      state: "running",
      bytesWritten: number,
      totalBytes: 32,
    });
    assert.equal(tracker.snapshot().detail, null);
  }
});

test("full record or byte counts do not finish stages before terminal markers", () => {
  const tracker = createGenerationProgress();
  tracker.observe({
    stage: "resources",
    state: "running",
    resourceProgress: { filesWritten: 1, totalFiles: 1, bytesWritten: 10, totalBytes: 10 },
  });
  assert.equal(tracker.snapshot().completedStages, 0);
  tracker.observe({ stage: "resources", state: "complete" });
  assert.equal(tracker.snapshot().completedStages, 1);
  tracker.observe({ stage: "resources", state: "complete" });
  assert.equal(tracker.snapshot().completedStages, 1);
});

test("missing requested exports or a missing Blob cannot unlock completion", () => {
  for (const invalid of [
    { ...result(), download: undefined },
    { ...result(), download: { blob: new Blob([]) } },
    { ...result(), resources: { status: "skipped" } },
    { ...result(), legacyPack: { status: "incomplete" } },
  ]) {
    const tracker = createGenerationProgress({ legacyAstc: true });
    assert.equal(tracker.generated(invalid), false);
    tracker.downloadPrepared(true);
    assert.ok(tracker.snapshot().percent < 100);
  }
  const skipped = createGenerationProgress({ exportResources: false });
  assert.equal(skipped.generated({ download: output(), resources: { status: "skipped" } }), true);
});

test("download URL failure stays below 100 and retries the retained output only", () => {
  const tracker = createGenerationProgress();
  let unavailable = true;
  const downloads = createDownloadPreparation({
    createObjectURL: () => {
      if (unavailable) throw new Error("Synthetic URL failure");
      return "blob:synthetic";
    },
  });
  const generated = result();
  tracker.generated(generated);
  downloads.retain(generated.download);
  tracker.downloadPrepared(downloads.prepare().status === "ready");
  assert.equal(tracker.snapshot().status, "download-pending");
  assert.ok(tracker.snapshot().percent < 100);
  unavailable = false;
  tracker.downloadPrepared(downloads.prepare().status === "ready");
  assert.equal(tracker.snapshot().percent, 100);
});

test("signing fallback and cancellation keep the requested signed output incomplete until retry succeeds", () => {
  for (const cancelled of [false, true]) {
    const tracker = createGenerationProgress({ signing: true });
    tracker.generated(result());
    const total = tracker.snapshot().totalStages;
    tracker.downloadPrepared(true); // Unsigned link is usable, not the requested signed output.
    assert.ok(tracker.snapshot().percent < 100);
    tracker.startSigning();
    for (const stage of ["inspect", "sign", "package", "verify"])
      tracker.observeSigning({ stage, completed: 1, total: 1 });
    tracker.signingFailed(cancelled);
    const stopped = tracker.snapshot();
    tracker.downloadPrepared(true);
    tracker.observeSigning({ stage: "verify", completed: 1, total: 1 });
    assert.deepEqual(tracker.snapshot(), stopped);
    assert.equal(stopped.status, cancelled ? "signing-cancelled" : "signing-failed");
    assert.ok(stopped.percent < 100);
    assert.equal(tracker.startSigning(), true);
    assert.equal(tracker.snapshot().totalStages, total);
    assert.equal(tracker.snapshot().percent, stopped.percent);
    assert.equal(tracker.signed(output()), true);
    tracker.downloadPrepared(true);
    assert.equal(tracker.snapshot().percent, 100);
  }
});

test("cancellation and recovered-original failures reject late stage completion", () => {
  for (const cancelled of [true, false]) {
    const tracker = createGenerationProgress();
    tracker.prepared();
    tracker.cancel();
    const stopping = tracker.snapshot();
    tracker.observe({ stage: "shaders", state: "complete" });
    assert.deepEqual(tracker.snapshot(), stopping);
    tracker.fail(cancelled);
    tracker.generated(result()); // A separately recovered original is not a successful requested generation.
    tracker.downloadPrepared(true);
    assert.equal(tracker.snapshot().status, cancelled ? "cancelled" : "failed");
    assert.ok(tracker.snapshot().percent < 100);
  }
});

test("old signing observers cannot affect a newer operation or a replacement job", () => {
  const gate = createUiOperationGate();
  const tracker = createGenerationProgress({ signing: true });
  tracker.generated(result());
  const old = gate.begin();
  tracker.startSigning();
  const late = () => {
    if (old.isCurrent()) tracker.observeSigning({ stage: "verify", completed: 1, total: 1 });
  };
  tracker.signingFailed();
  old.finish();
  const retry = gate.begin();
  tracker.startSigning();
  late();
  assert.equal(tracker.snapshot().detail, null);
  const replacement = createGenerationProgress();
  tracker.signed(output());
  assert.equal(replacement.snapshot().percent, 0);
  retry.finish();
});

test("the UI uses actual Radix values, fixed copy and guarded/coalesced job updates", async () => {
  const [app, component, primitive] = await Promise.all(
    [
      "../src/App.tsx",
      "../src/components/GenerationProgress.tsx",
      "../src/components/ui/progress.tsx",
    ].map((name) => readFile(new URL(name, import.meta.url), "utf8")),
  );
  assert.match(primitive, /<ProgressPrimitive.Root[\s\S]*?value=\{value\}/);
  assert.match(component, /<Progress[\s\S]*?value=\{progress.percent\}/);
  assert.match(component, /aria-valuetext=/);
  assert.match(component, /dmWebOverallEstimate/);
  assert.match(component, /dmWebOverallUnmeasured/);
  assert.match(component, /role="status"/);
  assert.match(component, /motion-reduce:transition-none/);
  assert.match(app, /const jobOptions = Object.freeze\(/);
  assert.match(app, /generationTracker.current === tracker/);
  assert.match(app, /generationTracker.current === pendingProgress.tracker/);
  assert.match(
    app,
    /if \(!acceptingProgress \|\| controller.signal.aborted \|\| !current\(\)\) return;\s+if \(event.phase === "cache"\) \{[\s\S]*?return;\s+\}\s+tracker.observe\(event\)/,
  );
  assert.match(
    app,
    /if \(!acceptingSigningProgress \|\| !current\(\) \|\| controller.signal.aborted\) return;\s+tracker\?\.observeSigning\(event\)/,
  );
  assert.doesNotMatch(component, /setInterval|setTimeout|Date.now/);
  assert.equal((app.match(/<GenerationProgress\b/g) ?? []).length, 1);
});

test("official Progress renders correct determinate, complete and indeterminate accessibility states", async () => {
  const { default: ts } = await import("typescript");
  const { default: vm } = await import("node:vm");
  const { createRequire } = await import("node:module");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const require = createRequire(import.meta.url);
  const source = await readFile(
    new URL("../src/components/ui/progress.tsx", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) =>
      name === "@/lib/utils"
        ? { cn: (...values) => values.filter(Boolean).join(" ") }
        : require(name),
  });
  for (const [value, state] of [
    [37, "loading"],
    [100, "complete"],
    [null, "indeterminate"],
  ]) {
    const markup = renderToStaticMarkup(
      createElement(exports.Progress, { value, "aria-label": "Synthetic progress" }),
    );
    assert.match(markup, /role="progressbar"/);
    assert.match(markup, new RegExp(`data-state="${state}"`));
    if (value === null) assert.doesNotMatch(markup, /aria-valuenow/);
    else assert.match(markup, new RegExp(`aria-valuenow="${value}"`));
  }
});

// 在服务端渲染状态容器以确认签名消息只出现一次；不启动浏览器或运行时。
// Render the status container on the server to prove signing messages appear once; no browser or runtime startup.
test("job status and signing completion stay inside one progress box without duplicate outside lines", async () => {
  const { default: ts } = await import("typescript");
  const { default: vm } = await import("node:vm");
  const { createRequire } = await import("node:module");
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const require = createRequire(import.meta.url);
  const component = await readFile(
    new URL("../src/components/GenerationProgress.tsx", import.meta.url),
    "utf8",
  );
  const compiled = ts.transpileModule(component, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require: (name) => {
      if (name === "@/components/ui/progress")
        return { Progress: () => createElement("div", { role: "progressbar" }) };
      if (name === "../../i18n.mjs") return { t: (key) => key };
      if (name === "../../packaging-diagnostics.mjs") return { compilerWorkerLabel: () => "" };
      return require(name);
    },
  });
  const tracker = createGenerationProgress({ signing: true });
  tracker.generated(result());
  tracker.startSigning();
  tracker.signed(output());
  tracker.downloadPrepared(true);
  const markup = renderToStaticMarkup(
    createElement(exports.GenerationProgress, {
      progress: tracker.snapshot(),
      statusId: "packager-status",
      statusMessages: ["signed completion detail", "signed completion detail", "resource result"],
    }),
  );
  assert.equal((markup.match(/signed completion detail/g) ?? []).length, 1);
  assert.match(
    markup,
    /<section[\s\S]*id="packager-status"[^>]*role="status"[^>]*aria-live="polite"[\s\S]*signed completion detail[\s\S]*<\/section>/,
  );
  assert.equal(
    renderToStaticMarkup(
      createElement(exports.GenerationProgress, { progress: null, statusMessages: ["startup"] }),
    ),
    "",
  );
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(app, /statusMessages=\{\[status, signingStatus, resourceOutcome\]\}/);
  assert.match(app, /!overallProgress && \(\s*<p\s+id="packager-status"/);
  assert.match(app, /!overallProgress && signingStatus &&/);
  assert.match(app, /!overallProgress && resourceOutcome &&/);
});

test("actual App progress publication rejects old jobs and clears queued snapshots at terminal updates", async () => {
  const { default: ts } = await import("typescript");
  const { default: vm } = await import("node:vm");
  const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile(
    "App.tsx",
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const callbacks = new Map();
  function visit(node) {
    if (
      ts.isVariableDeclaration(node) &&
      ["publishProgress", "flushActivity"].includes(node.name.getText(parsed))
    )
      callbacks.set(node.name.getText(parsed), node.initializer.arguments[0].getText(parsed));
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  const current = createGenerationProgress(),
    old = createGenerationProgress();
  const published = [];
  const scope = {
    mounted: { current: true },
    generationTracker: { current },
    pendingOverallProgress: { current: { tracker: old, snapshot: old.snapshot() } },
    setOverallProgress: (snapshot) => published.push(snapshot),
    activityTimer: { current: null },
    renderedActivityRevision: { current: 0 },
    activityRevision: { current: 0 },
    pendingGenerationStatus: { current: null },
  };
  const invoke = (name) =>
    vm.runInNewContext(
      ts.transpileModule(`(${callbacks.get(name)})`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022 },
      }).outputText,
      scope,
    );
  const publish = invoke("publishProgress"),
    flush = invoke("flushActivity");
  publish(old);
  assert.equal(published.length, 0);
  flush();
  assert.equal(published.length, 0);
  scope.pendingOverallProgress.current = { tracker: current, snapshot: current.snapshot() };
  current.fail();
  publish(current);
  flush();
  assert.equal(published.length, 1);
  assert.equal(published[0].status, "failed");
  scope.mounted.current = false;
  publish(current);
  assert.equal(published.length, 1);
});

test("bootstrap uses shadcn for bounded bytes and truly indeterminate initialization", async () => {
  const { default: ts } = await import("typescript");
  const { default: vm } = await import("node:vm");
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const parsed = ts.createSourceFile(
    "App.tsx",
    app,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const bars = [];
  function visit(node) {
    if (ts.isJsxSelfClosingElement(node) && node.tagName.getText(parsed) === "Progress")
      bars.push(node);
    ts.forEachChild(node, visit);
  }
  visit(parsed);
  assert.equal(bars.length, 2);
  assert.doesNotMatch(app, /<progress\b/);
  const values = bars.map((bar) =>
    bar.attributes.properties
      .find((attribute) => attribute.name.getText(parsed) === "value")
      .initializer.expression.getText(parsed),
  );
  for (const [loadedBytes, totalBytes, expected] of [
    [0, 200, 0],
    [50, 200, 25],
    [200, 200, 100],
    [250, 200, 100],
    [-5, 200, 0],
  ])
    assert.equal(vm.runInNewContext(values[0], { loading: { loadedBytes, totalBytes } }), expected);
  assert.equal(vm.runInNewContext(values[1]), null);
  assert.match(app, /Number.isFinite\(loading.loadedBytes\)/);
  assert.match(app, /Number.isFinite\(loading.totalBytes\)/);
  assert.match(app, /loading.totalBytes > 0/);
  assert.match(bars[0].getText(parsed), /aria-describedby="runtime-loading-details"/);
  assert.match(
    app,
    /<p id="runtime-loading-details">[\s\S]*?"dmWebFilesReady",\s*megabytes\(loading.loadedBytes\),\s*megabytes\(loading.totalBytes\),\s*loading.completedFiles,\s*loading.totalFiles/,
  );
  assert.match(bars[1].getText(parsed), /motion-safe:animate-pulse/);
  assert.match(bars[1].getText(parsed), /aria-label=\{loadingLabel\(loading.phase\)\}/);
});
