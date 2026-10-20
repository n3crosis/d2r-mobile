/** The production entry point. Bootstrap contains public bytes only. */
import { prepareSealedRuntime } from "./sealed-runtime/clients.mjs";
import { loadProductionProfile } from "./production-profile.mjs";
import {
  createExtractionJobAdapter,
  readAuthenticatedProgramModules,
  readAuthenticatedAssets,
} from "./extraction-job-adapter.mjs";
import { createProgramRewriterAdapter } from "./program-rewriter-adapter.mjs";
import { createProductionAssetAdapter } from "./production-assets.mjs";
import { createProductionShaderAdapter } from "./production-shaders.mjs";
import { createBrowserStagedOutputAdapters } from "./browser-staged-output.mjs";
import { planStagedZip } from "./staged-zip-validator.mjs";
import { exportRomfsResources } from "./resource-folder-export.mjs";
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
      async generate({ input, outputDirectoryHandle, signal, onProgress }) {
        if (used) throw new Error("RELOAD_REQUIRED");
        if (
          input?.kind !== "directory" ||
          outputDirectoryHandle?.kind !== "directory" ||
          (await input.resolve(outputDirectoryHandle)) !== null ||
          (await outputDirectoryHandle.resolve(input)) !== null ||
          (await outputDirectoryHandle.queryPermission({ mode: "readwrite" })) !== "granted"
        )
          throw new Error("OUTPUT_DIRECTORY_UNSAFE");
        // An empty user-chosen output folder prevents accidental replacement.
        for await (const _entry of outputDirectoryHandle.values())
          throw new Error("OUTPUT_DIRECTORY_NOT_EMPTY");
        used = true;
        let authenticated, selected, output, resources;
        const archiveFormat = "zip32";
        const adapters = {
          ...extraction,
          async extractSelected(context) {
            authenticated = await extraction.extractSelected(context);
            selected = context.selection;
            return authenticated;
          },
          async createOutput(context) {
            planStagedZip(context.manifest, { archiveFormat });
            const { romfs } = readAuthenticatedAssets(authenticated, selected, { signal });
            resources = await exportRomfsResources({
              romfs,
              outputDirectoryHandle,
              signal,
              onProgress: () =>
                onProgress?.({
                  stage: "resources",
                  state: "running",
                  label: "Saving game resources locally",
                }),
            });
            // No existing output is ever deliberately replaced.
            try {
              await outputDirectoryHandle.getFileHandle("D2RMobile-unsigned.ipa");
              throw new Error("OUTPUT_EXISTS");
            } catch (error) {
              if (error?.name !== "NotFoundError") throw error;
            }
            // Defer the named IPA until staged bytes have passed validation and
            // the coordinator reaches its commit boundary. No empty IPA on an
            // earlier conversion failure. Recheck collisions at that boundary.
            const destinationHandle = {
              kind: "file",
              queryPermission: (options) => outputDirectoryHandle.queryPermission(options),
              async createWritable(options) {
                try {
                  await outputDirectoryHandle.getFileHandle("D2RMobile-unsigned.ipa");
                  throw new Error("OUTPUT_EXISTS");
                } catch (error) {
                  if (error?.name !== "NotFoundError") throw error;
                }
                const file = await outputDirectoryHandle.getFileHandle("D2RMobile-unsigned.ipa", {
                  create: true,
                });
                return file.createWritable(options);
              },
            };
            output = createBrowserStagedOutputAdapters({ destinationHandle, archiveFormat });
            return output.createOutput(context);
          },
          validateArchive: (context) => output.validateArchive(context),
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
        const result = await runPackagingJob({
          input,
          adapters,
          signal,
          onProgress,
          archiveFormat,
          secretLifetime: "archive",
          concurrency: 1,
        });
        return { ...result, resources };
      },
      close,
    });
  } catch (error) {
    close();
    throw error;
  }
}
