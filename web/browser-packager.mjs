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
import { createBrowserBlobOutputAdapters, IPA_DOWNLOAD_LIMITS } from "./browser-blob-output.mjs";
import { planStagedZip } from "./staged-zip-validator.mjs";
import { exportRomfsResources } from "./resource-folder-export.mjs";
import { deriveD2rRuntimeContentMode } from "./d2r-runtime-content-mode.mjs";
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
export async function prepareBrowserPackager({ manifestSha256, signal, onProgress } = {}) {
  if (
    !globalThis.isSecureContext ||
    !navigator.storage?.getDirectory ||
    !globalThis.Worker ||
    !globalThis.crypto?.subtle
  )
    throw new Error("BROWSER_UNSUPPORTED");
  const runtime = await prepareSealedRuntime({
    baseUrl: "./runtime/",
    manifestSha256,
    signal,
    onProgress,
  });
  let profile, program, assets, shaders, shellVariantBytes;
  const close = () => {
    program?.dispose();
    assets?.dispose();
    shaders?.dispose();
    profile?.close();
    runtime.close();
    shellVariantBytes?.fill(0);
  };
  try {
    profile = await loadProductionProfile(runtime, { signal });
    const extraction = createExtractionJobAdapter({
      createWorker: runtime.createExtractionWorker,
      contentMode: profile.contentMode,
    });
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
      async generate({ input, signal, onProgress }) {
        if (used) throw new Error("RELOAD_REQUIRED");
        if (
          input?.kind !== "directory" ||
          typeof input.queryPermission !== "function" ||
          (await input.queryPermission({ mode: "readwrite" })) !== "granted"
        )
          throw new Error("INPUT_FOLDER_WRITE_PERMISSION_REQUIRED");
        used = true;
        let authenticated, selected, output, resources;
        const archiveFormat = "zip32";
        const maxOutputBytes = IPA_DOWNLOAD_LIMITS.maxOutputBytes;
        const adapters = {
          ...extraction,
          async extractSelected(context) {
            authenticated = await extraction.extractSelected(context);
            selected = context.selection;
            return authenticated;
          },
          async createOutput(context) {
            planStagedZip(context.manifest, { archiveFormat, maxOutputBytes });
            const { romfs } = readAuthenticatedAssets(authenticated, selected, { signal });
            resources = await exportRomfsResources({
              romfs,
              // Root-only discovery never traverses generated resource folders.
              // Export writes only to a fresh UUID child, never the source files.
              outputDirectoryHandle: input,
              signal,
              onProgress: () =>
                onProgress?.({
                  stage: "resources",
                  state: "running",
                  label: "Saving game resources locally",
                }),
            });
            output = createBrowserBlobOutputAdapters({ archiveFormat, maxOutputBytes });
            return output.createOutput(context);
          },
          validateArchive: (context) => output.validateArchive(context),
          generateProgram: async (context) =>
            (await program.generateProgram(context)).filter((e) => allowed(e.path)),
          generateAssets: async (context) =>
            (await assets.generateAssets(context)).filter((e) => allowed(e.path)),
          generateShaders: (context) => shaders.generateShaders(context),
          async loadShell({ signal }) {
            // Selection came from the independently authenticated extraction boundary.
            readAuthenticatedAssets(authenticated, selected, { signal });
            const path = "Payload/DmIOS.app/DmIOS";
            const original = profile.shell.entries.find((entry) => entry.path === path);
            if (!original) throw new Error("SHELL_EXECUTABLE_MISSING");
            const bytes = new Uint8Array(original.size);
            let offset = 0;
            try {
              for await (const chunk of original.chunks()) {
                if (offset + chunk.length > bytes.length) throw new Error("SHELL_SIZE");
                bytes.set(chunk, offset);
                offset += chunk.length;
              }
              if (offset !== bytes.length) throw new Error("SHELL_SIZE");
              const variant = await deriveD2rRuntimeContentMode(bytes, {
                contentMode: selected.dlc.length === 0 ? "base-update-only" : "warlock",
              });
              shellVariantBytes = variant.bytes;
              return {
                ...profile.shell,
                contentModeReceipt: variant.receipt,
                entries: profile.shell.entries.map((entry) =>
                  entry.path !== path
                    ? entry
                    : {
                        ...entry,
                        sha256: variant.receipt.sha256,
                        async *chunks() {
                          signal.throwIfAborted();
                          yield shellVariantBytes;
                        },
                      },
                ),
              };
            } finally {
              bytes.fill(0);
            }
          },
          async validateGenerated({ generatedEntries, shell, signal }) {
            signal.throwIfAborted();
            if (!shell.contentModeReceipt) throw new Error("SHELL_CONTENT_MODE_UNBOUND");
            const receiptBytes = new TextEncoder().encode(
              JSON.stringify(shell.contentModeReceipt) + "\n",
            );
            generatedEntries.push({
              path: "dm/content_mode.json",
              size: receiptBytes.length,
              mode: 0o644,
              async *chunks() {
                yield receiptBytes;
              },
            });
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
          maxOutputBytes,
          selectionOptions: { contentMode: profile.contentMode },
          secretLifetime: "archive",
          concurrency: 1,
        });
        return { ...result, resources, download: output.getDownload() };
      },
      close,
    });
  } catch (error) {
    close();
    throw error;
  }
}
