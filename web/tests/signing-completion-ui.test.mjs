// 执行真实界面处理器的隔离片段；签名、打包及 URL 均为合成替身，不运行编译器。
// Execute isolated real UI handlers with synthetic signing, packaging and URLs; no compiler execution.
import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import ts from "typescript";
import { createGenerationProgress } from "../generation-progress.mjs";
import { createDownloadPreparation } from "../download-preparation.mjs";
import { createUiOperationGate } from "../ui-operation-gate.mjs";
import { signWithLocalFiles } from "../signing-input.mjs";
import { createPostGenerationGuide } from "../post-generation-guide.mjs";
import { catalog } from "../i18n-catalog.mjs";

const source = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
const parsed = ts.createSourceFile(
  "App.tsx",
  source,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);
const functions = new Map(),
  callbacks = new Map();
function visit(node) {
  if (ts.isFunctionDeclaration(node) && node.name)
    functions.set(node.name.text, node.getText(parsed));
  if (
    ts.isVariableDeclaration(node) &&
    ["publishProgress", "flushActivity"].includes(node.name.getText(parsed))
  )
    callbacks.set(node.name.getText(parsed), node.initializer.arguments[0].getText(parsed));
  ts.forEachChild(node, visit);
}
visit(parsed);
const transpile = (text) =>
  ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};
const signedOutput = () => ({
  blob: new Blob(["synthetic signed IPA"]),
  fileName: "D2RMobile-signed.ipa",
});
function harness({ signing = true, urlFails = false } = {}) {
  const unsigned = { blob: new Blob(["synthetic unsigned IPA"]), fileName: "unsigned.ipa" };
  const result = {
    download: unsigned,
    resources: { status: "complete", directoryName: "resources" },
  };
  const writes = [],
    automatic = [],
    urls = [],
    attempts = [];
  let nextAttempt = deferred(),
    started = deferred(),
    packageObserver;
  const context = {
    Blob,
    Error,
    AbortController,
    DOMException,
    ready: true,
    busy: false,
    generating: false,
    finished: false,
    signing,
    signingReady: true,
    signingRetryAvailable: false,
    status: "folder checked",
    signingStatus: "",
    download: null,
    downloadPreparationFailed: false,
    customizationValidation: { options: {}, error: "" },
    generationReadiness: { canGenerate: true },
    profileId: "v2.0.0-ios26",
    legacyAstc: false,
    astcPreset: "thorough",
    ignoreCache: false,
    skipResources: false,
    inputMode: "packages",
    folder: { name: "inert folder" },
    nspNames: ["inert.nsp"],
    originalIdentityDownload: false,
    appCustomizationDefaults: { displayName: "App" },
    mounted: { current: true },
    cancellation: { current: null },
    operationGate: { current: createUiOperationGate() },
    generationTracker: { current: null },
    unsignedForSigning: { current: null },
    pendingGenerationStatus: { current: null },
    pendingOverallProgress: { current: null },
    activityTimer: { current: null },
    renderedActivityRevision: { current: 0 },
    activityRevision: { current: 0 },
    identityInput: { current: { files: [new Blob(["inert certificate"])], value: "" } },
    profileInput: { current: { files: [new Blob(["inert profile"])], value: "" } },
    passwordInput: { current: { value: "" } },
    createGenerationProgress,
    createPostGenerationGuide,
    signWithLocalFiles,
    prepareAppCustomization: async () => ({}),
    t: (key) => key,
    packagingActivity: () => "inert earlier packaging status",
    shaderProgressLabel: () => null,
    resourceProgressLabel: () => null,
    takeCommittedDownload: () => null,
    packagingFailureSummary: () => "unexpected packaging failure",
    packagingFailureMessage: () => "unexpected packaging failure",
    shaderFailureDetails: () => [],
    attemptAutomaticDownload: (value) => automatic.push(value),
    appendActivity: (text, force) => {
      if (text) writes.push(["activity", text]);
      if (force) context.flushActivity();
    },
    downloadPreparation: {
      current: createDownloadPreparation({
        createObjectURL: (blob) => {
          if (urlFails) throw new Error("synthetic URL failure");
          urls.push(blob);
          return `blob:synthetic-${urls.length}`;
        },
        revokeObjectURL: () => {},
      }),
    },
    packager: {
      current: {
        async generate({ onProgress }) {
          packageObserver = onProgress;
          onProgress({ stage: "output", state: "running" });
          return result;
        },
        async prepareSigning() {
          const pending = nextAttempt;
          const entered = started;
          return {
            sign: (options) => {
              attempts.push(options);
              entered.resolve();
              return pending.promise;
            },
            close: () => {},
          };
        },
        close: async () => {},
      },
    },
  };
  for (const name of [
    "Busy",
    "Generating",
    "Cancelling",
    "Ready",
    "Finished",
    "Status",
    "SigningStatus",
    "SigningRetryAvailable",
    "SigningFiles",
    "CustomizationError",
    "ResourceOutcome",
    "LegacyStatus",
    "Download",
    "DownloadPreparationFailed",
    "CompletedOutput",
    "OverallProgress",
  ])
    context[`set${name}`] = (value) => {
      const field = name[0].toLowerCase() + name.slice(1);
      context[field] = typeof value === "function" ? value(context[field]) : value;
      writes.push([field, context[field]]);
    };
  const scope = vm.createContext(context);
  for (const [name, callback] of callbacks)
    context[name] = vm.runInContext(transpile(`(${callback})`), scope);
  for (const name of [
    "prepareDownload",
    "clearSigningInputs",
    "runSigning",
    "retrySigning",
    "generate",
  ])
    vm.runInContext(transpile(functions.get(name)), scope);
  return {
    context,
    writes,
    automatic,
    urls,
    attempts,
    unsigned,
    start: () => context.generate(),
    started: () => started.promise,
    resolve: () => nextAttempt.resolve(signedOutput()),
    reject: () => nextAttempt.reject(new Error("SIGNING_PROFILE_MISMATCH")),
    allowUrls: () => {
      urlFails = false;
    },
    next: () => {
      nextAttempt = deferred();
      started = deferred();
    },
    latePackage: () => packageObserver({ stage: "output", state: "running" }),
  };
}

test("requested signing publishes neither unsigned URL nor ready text while step 3/4 is pending", async () => {
  const h = harness();
  const generation = h.start();
  await h.started();
  h.attempts[0].onProgress({ stage: "package", completed: 1, total: 1 });
  h.context.flushActivity();
  assert.equal(h.context.overallProgress.percent, 80);
  assert.equal(h.context.overallProgress.detail.step, 3);
  assert.equal(h.context.status, "dmWebSigningWorking");
  assert.equal(h.context.download, null);
  assert.equal(h.urls.length, 0);
  assert.equal(h.automatic.length, 0);
  assert.equal(h.context.unsignedForSigning.current, h.unsigned);
  assert.equal(
    h.writes.some(
      ([key, text]) =>
        ["status", "activity"].includes(key) &&
        /UnsignedReady|DownloadReady|SigningComplete/.test(text),
    ),
    false,
  );
  h.resolve();
  await generation;
  assert.equal(h.context.download.fileName, "D2RMobile-signed.ipa");
  assert.equal(h.context.status, "dmWebSigningComplete");
  assert.equal(h.context.overallProgress.percent, 100);
  assert.equal(h.automatic.length, 1);
  assert.equal(h.automatic[0].fileName, "D2RMobile-signed.ipa");
  const completed = h.context.overallProgress,
    status = h.context.status;
  h.latePackage();
  h.attempts[0].onProgress({ stage: "package", completed: 1, total: 1 });
  h.context.flushActivity();
  assert.equal(h.context.overallProgress, completed);
  assert.equal(h.context.status, status);
});

test("signing failure keeps a manual unsigned fallback and retry never republishes it while running", async () => {
  const h = harness();
  const generation = h.start();
  await h.started();
  h.reject();
  await generation;
  assert.equal(h.context.status, "dmWebSigningProfileMismatch");
  assert.equal(h.context.signingRetryAvailable, true);
  assert.equal(h.context.download.fileName, "unsigned.ipa");
  assert.equal(h.context.overallProgress.status, "signing-failed");
  assert.ok(h.context.overallProgress.percent < 100);
  assert.equal(h.automatic.length, 0);
  h.context.prepareDownload();
  assert.equal(h.automatic.length, 0, "retrying fallback URL preparation does not auto-download");
  h.next();
  const retry = h.context.retrySigning();
  await h.started();
  assert.equal(h.context.download, null);
  assert.equal(h.context.status, "dmWebSigningWorking");
  assert.equal(h.attempts[1].ipa, h.unsigned.blob);
  h.attempts[0].onProgress({ stage: "verify", completed: 1, total: 1 });
  assert.equal(h.context.overallProgress.detail, null);
  h.resolve();
  await retry;
  assert.equal(h.context.overallProgress.percent, 100);
  assert.equal(h.context.download.fileName, "D2RMobile-signed.ipa");
  assert.equal(h.context.signingRetryAvailable, false);
  assert.equal(h.automatic.length, 1);
});

test("a late signed result after cancellation remains an error with manual unsigned recovery", async () => {
  const h = harness();
  const generation = h.start();
  await h.started();
  h.context.cancellation.current.abort();
  h.resolve();
  await generation;
  assert.equal(h.context.status, "dmWebSigningCancelled");
  assert.equal(h.context.overallProgress.status, "signing-cancelled");
  assert.ok(h.context.overallProgress.percent < 100);
  assert.equal(h.context.download.fileName, "unsigned.ipa");
  assert.equal(h.context.signingRetryAvailable, true);
  assert.equal(h.automatic.length, 0);
});

test("signed bytes are not called ready or 100 percent until a download URL is prepared", async () => {
  const h = harness({ urlFails: true });
  const generation = h.start();
  await h.started();
  h.resolve();
  await generation;
  assert.equal(h.context.overallProgress.status, "download-pending");
  assert.equal(h.context.overallProgress.percent, 90);
  assert.equal(h.context.download, null);
  assert.equal(h.context.status, "dmWebDownloadPreparationFailed");
  assert.equal(h.context.signingStatus, "");
  assert.equal(h.context.signingRetryAvailable, false);
  h.allowUrls();
  h.context.prepareDownload();
  assert.equal(h.context.overallProgress.percent, 100);
  assert.equal(h.context.status, "dmWebSigningComplete");
  assert.equal(h.context.download.fileName, "D2RMobile-signed.ipa");
});

test("default unsigned generation still completes and downloads without entering signing", async () => {
  const h = harness({ signing: false });
  await h.start();
  assert.equal(h.attempts.length, 0);
  assert.equal(h.context.overallProgress.percent, 100);
  assert.equal(h.context.download.fileName, "unsigned.ipa");
  assert.equal(h.automatic.length, 1);
});

test("manual unsigned recovery is clearly labeled and never shows signed-job installation steps", () => {
  assert.match(source, /download && !busy &&/);
  assert.match(
    source,
    /signedDownload[\s\S]*?"dmWebSignedDownload"[\s\S]*?signing[\s\S]*?"dmWebUnsignedFallbackDownload"/,
  );
  assert.match(
    source,
    /signedDownload[\s\S]*?"dmWebSignedHelp"[\s\S]*?signing[\s\S]*?"dmWebUnsignedFallbackHelp"/,
  );
  assert.match(source, /download && completedOutput && !busy && \(!signing \|\| signedDownload\)/);
  assert.match(catalog.dmWebUnsignedFallbackDownload[0], /unsigned IPA instead/);
  assert.match(catalog.dmWebUnsignedFallbackDownload[1], /未签名/);
  assert.match(
    catalog.dmWebUnsignedFallbackHelp[0],
    /not finish.*Retry signing.*not ready to install/,
  );
  assert.match(catalog.dmWebUnsignedFallbackHelp[1], /尚未完成.*重试签名.*尚不能直接安装/);
});
