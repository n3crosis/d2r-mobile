/** The production entry point. Bootstrap contains public bytes only. */
import { prepareSealedRuntime } from "./sealed-runtime/clients.mjs";
import { loadProductionProfile } from "./production-profile.mjs";
import {
  createExtractionJobAdapter,
  readAuthenticatedProgramModules,
} from "./extraction-job-adapter.mjs";
import { createProgramRewriterAdapter } from "./program-rewriter-adapter.mjs";
import { createProductionAssetAdapter } from "./production-assets.mjs";
import { createProductionShaderAdapter } from "./production-shaders.mjs";
import { createBrowserStagedOutputAdapters } from "./browser-staged-output.mjs";
import { runPackagingJob } from "./packaging-job.mjs";

function guestTarget(bytes) {
  const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength),
    u = (o) => v.getUint32(o, true);
  if (bytes.length < 32 || u(0) !== 0xfeedfacf || u(4) !== 0x0100000c || u(12) !== 6)
    throw new Error("GUEST_TARGET");
  const end = 32 + u(20);
  if (end > bytes.length || u(16) > 4096) throw new Error("GUEST_TARGET");
  let offset = 32,
    target;
  for (let i = 0; i < u(16); i++) {
    if (offset + 8 > end) throw new Error("GUEST_TARGET");
    const command = u(offset),
      size = u(offset + 4);
    if (size < 8 || size % 8 || offset + size > end) throw new Error("GUEST_TARGET");
    if (command === 0x32) {
      if (target || size < 24 || u(offset + 8) !== 2) throw new Error("GUEST_TARGET");
      const version = u(offset + 12);
      target = {
        platform: "ios",
        minimumVersion: `${version >>> 16}.${(version >>> 8) & 255}.${version & 255}`,
      };
    }
    offset += size;
  }
  if (!target || offset !== end) throw new Error("GUEST_TARGET");
  return target;
}
export async function prepareBrowserPackager({ manifestSha256, signal } = {}) {
  if (
    !globalThis.isSecureContext ||
    !navigator.storage?.getDirectory ||
    !globalThis.Worker ||
    !globalThis.crypto?.subtle
  )
    throw new Error("BROWSER_UNSUPPORTED");
  const runtime = await prepareSealedRuntime({ baseUrl: "./runtime/", manifestSha256, signal });
  let profile, program, assets, shaders;
  const close = () => {
    program?.dispose();
    assets?.dispose();
    shaders?.dispose();
    profile?.close();
    runtime.close();
  };
  try {
    profile = await loadProductionProfile(runtime, { signal });
    const extraction = createExtractionJobAdapter({ createWorker: runtime.createExtractionWorker });
    program = createProgramRewriterAdapter({
      verifyProvenance: readAuthenticatedProgramModules,
      createWorker: runtime.createProgramWorker,
    });
    assets = createProductionAssetAdapter({ runtime, profile });
    shaders = createProductionShaderAdapter({
      runtime,
      catalog: profile.catalog,
      trustedShell: profile.trustedShell,
    });
    let used = false;
    const allowed = (path) =>
      profile.trustedShell.trustedRecipe.requiredPaths.some((p) =>
        p.endsWith("/") ? path.startsWith(p) : path === p,
      );
    return Object.freeze({
      ready: true,
      realGameVerified: false,
      async generate({ input, destinationHandle, signal, onProgress }) {
        if (used) throw new Error("RELOAD_REQUIRED");
        used = true;
        const archiveFormat = "zip32";
        const output = createBrowserStagedOutputAdapters({ destinationHandle, archiveFormat });
        const adapters = {
          ...extraction,
          ...output,
          generateProgram: async (context) =>
            (await program.generateProgram(context)).filter((e) => allowed(e.path)),
          generateAssets: async (context) =>
            (await assets.generateAssets(context)).filter((e) => allowed(e.path)),
          generateShaders: (context) => shaders.generateShaders(context),
          loadShell: async () => profile.shell,
          async validateGenerated({ generatedEntries, signal }) {
            signal.throwIfAborted();
            const guest = generatedEntries.find(
              (e) => e.path === "Frameworks/Guest.framework/Guest",
            );
            if (!guest || guest.size > 128 * 1024 * 1024) throw new Error("GUEST_MISSING");
            const bytes = new Uint8Array(guest.size);
            let offset = 0;
            for await (const chunk of guest.chunks()) {
              if (offset + chunk.length > bytes.length) throw new Error("GUEST_SIZE");
              bytes.set(chunk, offset);
              offset += chunk.length;
            }
            try {
              if (offset !== bytes.length) throw new Error("GUEST_SIZE");
              return { valid: true, observedOutputTargetOS: guestTarget(bytes) };
            } finally {
              bytes.fill(0);
            }
          },
          async cleanup(context) {
            try {
              await extraction.cleanup(context);
            } finally {
              close();
            }
          },
        };
        const pack = new TextEncoder().encode(
          `PRODUCT=${profile.trustedShell.trustedRecipe.product}\n`,
        );
        const generateProgram = adapters.generateProgram;
        adapters.generateProgram = async (context) => [
          ...(await generateProgram(context)),
          {
            path: "dm/pack_info.txt",
            size: pack.length,
            mode: 0o644,
            async *chunks() {
              yield pack;
            },
          },
        ];
        return runPackagingJob({
          input,
          adapters,
          signal,
          onProgress,
          archiveFormat,
          secretLifetime: "archive",
          concurrency: 1,
        });
      },
      close,
    });
  } catch (error) {
    close();
    throw error;
  }
}
