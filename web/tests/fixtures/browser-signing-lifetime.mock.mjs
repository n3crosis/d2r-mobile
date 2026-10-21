// Synthetic orchestration tests; these never sign an IPA or execute browser/WASM code.
import test, { mock } from "node:test";
import assert from "node:assert/strict";
let state;
const unsigned = Object.freeze({ blob: new Blob([new Uint8Array(22)]), fileName: "unsigned.ipa" });
const signed = Object.freeze({ blob: new Blob([new Uint8Array(23)]), fileName: "signed.ipa" });
const signer = {
  close() {
    state.signerClosed = true;
  },
  async sign(options) {
    assert.equal(state.runtimeClosed, true);
    assert.equal(state.signerClosed, false);
    assert.equal(options.ipa, unsigned.blob);
    if (state.signFailure) throw new Error("SIGNING_FAILED");
    return signed;
  },
};
mock.module("../../sealed-runtime/clients.mjs", {
  namedExports: {
    async prepareSealedRuntime(options) {
      state.options = options;
      return {
        takeIpaSigningClient() {
          state.taken++;
          return signer;
        },
        close() {
          state.runtimeClosed = true;
          if (state.closeFailure) return Promise.reject(new Error("CLEANUP_FAILED"));
        },
      };
    },
  },
});
mock.module("../../production-profile.mjs", {
  namedExports: {
    async loadProductionProfile() {
      if (state.setupFailure) throw new Error("SETUP_FAILED");
      return {
        contentMode: "synthetic",
        trustedShell: { trustedRecipe: { requiredPaths: [], product: "synthetic" } },
        close() {},
      };
    },
    bindProductionAstcEntries() {},
    inspectProductionAstcEntries() {},
  },
});
mock.module("../../shell-profiles.mjs", {
  namedExports: {
    DEFAULT_SHELL_PROFILE_ID: "synthetic",
    resolveShellProfile: () => ({ id: "synthetic" }),
  },
});
mock.module("../../extraction-job-adapter.mjs", {
  namedExports: {
    createExtractionJobAdapter: () => ({
      extractSelected() {
        return {};
      },
      cleanup() {},
    }),
    readAuthenticatedProgramModules() {},
    readAuthenticatedAssets: () => ({ romfs: {} }),
  },
});
mock.module("../../program-rewriter-adapter.mjs", {
  namedExports: { createProgramRewriterAdapter: () => ({ dispose() {} }) },
});
mock.module("../../production-assets.mjs", {
  namedExports: { createProductionAssetAdapter: () => ({ dispose() {} }) },
});
mock.module("../../production-shaders.mjs", {
  namedExports: { createProductionShaderAdapter: () => ({ dispose() {} }) },
});
mock.module("../../browser-blob-output.mjs", {
  namedExports: {
    IPA_DOWNLOAD_LIMITS: { maxOutputBytes: 1024 },
    createBrowserBlobOutputAdapters: () => ({ createOutput() {}, getDownload: () => unsigned }),
  },
});
mock.module("../../staged-zip-validator.mjs", { namedExports: { planStagedZip() {} } });
mock.module("../../packaging-job.mjs", {
  namedExports: {
    PackagingJobError: class extends Error {},
    async runPackagingJob({ adapters }) {
      const context = { selection: {}, manifest: {} };
      await adapters.extractSelected(context);
      await adapters.createOutput(context);
      await adapters.cleanup(context);
      return { committed: true };
    },
  },
});
globalThis.isSecureContext = true;
globalThis.Worker = class {};
Object.defineProperty(globalThis, "navigator", {
  value: { storage: { getDirectory() {}, estimate() {} } },
  configurable: true,
});
const { prepareBrowserPackager } = await import("../../browser-packager.mjs");
function reset() {
  state = { taken: 0, signerClosed: false, runtimeClosed: false };
}
const generate = (packager) =>
  packager.generate({
    input: { kind: "directory", queryPermission: async () => "granted" },
    exportResources: false,
  });
test("unsigned default does not acquire or select a signer", async () => {
  reset();
  const packager = await prepareBrowserPackager();
  assert.deepEqual(state.options.optionalGroups, []);
  assert.equal(packager.signingReady, false);
  assert.equal(state.taken, 0);
  await assert.rejects(packager.sign({}), /SIGNING_CLOSED/);
  await packager.close();
});
test("generation cleanup preserves signer, sign preserves unsigned download, explicit close releases signer", async () => {
  reset();
  const packager = await prepareBrowserPackager({ signing: true });
  assert.deepEqual(state.options.optionalGroups, ["ipa-signing"]);
  assert.equal(packager.signingReady, true);
  assert.equal(state.taken, 1);
  const result = await generate(packager);
  assert.equal(state.runtimeClosed, true);
  assert.equal(state.signerClosed, false);
  assert.equal(await packager.sign({ ipa: result.download.blob }), signed);
  assert.equal(result.download, unsigned);
  await packager.close();
  assert.equal(state.signerClosed, true);
  await assert.rejects(packager.sign({ ipa: unsigned.blob }), /SIGNING_CLOSED/);
});
test("signing failure cannot remove the already returned unsigned result", async () => {
  reset();
  const packager = await prepareBrowserPackager({ signing: true });
  const result = await generate(packager);
  state.signFailure = true;
  await assert.rejects(packager.sign({ ipa: result.download.blob }), /SIGNING_FAILED/);
  assert.equal(result.download, unsigned);
  await packager.close();
});
test("later setup failure closes the claimed signer and conversion runtime", async () => {
  reset();
  state.setupFailure = true;
  await assert.rejects(prepareBrowserPackager({ signing: true }), /SETUP_FAILED/);
  assert.equal(state.taken, 1);
  assert.equal(state.signerClosed, true);
  assert.equal(state.runtimeClosed, true);
});
test("invalid signing options fail before public runtime bootstrap", async () => {
  for (const signing of [null, "true", 1, {}, []]) {
    reset();
    await assert.rejects(prepareBrowserPackager({ signing }), /SIGNING_OPTION/);
    assert.equal(state.options, undefined);
  }
});

test("whole-packager close is idempotent and keeps cleanup rejection observable", async () => {
  reset();
  const packager = await prepareBrowserPackager({ signing: true });
  state.closeFailure = true;
  const closing = packager.close();
  assert.equal(packager.close(), closing);
  await assert.rejects(closing, /PACKAGER_CLEANUP_FAILED/);
  assert.equal(state.signerClosed, true);
  assert.equal(state.runtimeClosed, true);
});
