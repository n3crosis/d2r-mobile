// 依据生产配置、密封运行时及打包适配器契约组装浏览器入口。
// Assemble the browser entry point from production profiles, sealed runtimes and packaging adapter contracts.
/**
 * 生产入口点。引导过程仅包含公开字节。
 * The production entry point. Bootstrap contains public bytes only.
 */
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
import { exportRomfsResources, ResourceExportError } from "./resource-folder-export.mjs";
import { deriveD2rRuntimeContentMode } from "./d2r-runtime-content-mode.mjs";
import { runPackagingJob, PackagingJobError } from "./packaging-job.mjs";
import { sanitizeResourceOutcome } from "./packaging-diagnostics.mjs";
import { inspectGuestTarget } from "./guest-target-stream.mjs";
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
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    let failure,
      failed = false;
    // 即使某项清理失败，也继续释放其余运行时及输出缓冲区。
    // Release remaining runtimes and output buffers even if one cleanup fails.
    for (const release of [
      () => program?.dispose(),
      () => assets?.dispose(),
      () => shaders?.dispose(),
      () => profile?.close(),
      () => runtime.close(),
      () => shellVariantBytes?.fill(0),
    ]) {
      try {
        release();
      } catch (error) {
        if (!failed) {
          failure = error;
          failed = true;
        }
      }
    }
    shellVariantBytes = profile = program = assets = shaders = undefined;
    if (failed) throw failure;
  };
  try {
    profile = await loadProductionProfile(runtime, { signal });
    const extraction = createExtractionJobAdapter({
      createWorker: runtime.createExtractionWorker,
      contentMode: profile.contentMode,
      // 完整 NCA 摘要已按已认证 CNMT 检查。
      // 避免再次扫描两个数 GB 的 RomFS 视图。
      // Full NCA digests were already checked against authenticated CNMT.
      // Avoid scanning both multi-gigabyte RomFS views a second time.
      verifyRomfs: false,
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
      async generate({ input, selectedNspNames, signal, onProgress }) {
        if (closed || used) throw new Error("RELOAD_REQUIRED");
        if (
          input?.kind !== "directory" ||
          typeof input.queryPermission !== "function" ||
          (await input.queryPermission({ mode: "readwrite" })) !== "granted"
        )
          throw new Error("INPUT_FOLDER_WRITE_PERMISSION_REQUIRED");
        used = true;
        let authenticated, selected, output, resources, resourceOutcome;
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
            try {
              resources = await exportRomfsResources({
                romfs,
                // 仅根目录发现绝不遍历生成的资源文件夹。
                // 导出只写入新的 UUID 子目录，绝不写入源文件。
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
              resourceOutcome = sanitizeResourceOutcome(resources);
            } catch (error) {
              if (error instanceof ResourceExportError)
                resourceOutcome = sanitizeResourceOutcome(error.report);
              throw error;
            }
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
            // 选择来自独立认证的提取边界。
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
                          if (!shellVariantBytes) throw new Error("SHELL_CLOSED");
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
            return {
              valid: true,
              observedOutputTargetOS: await inspectGuestTarget(guest, { signal }),
            };
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
        let result;
        try {
          result = await runPackagingJob({
            input,
            selectedNspNames,
            adapters,
            signal,
            onProgress,
            archiveFormat,
            maxOutputBytes,
            selectionOptions: { contentMode: profile.contentMode },
            secretLifetime: "archive",
            concurrency: 1,
          });
        } catch (error) {
          if (error instanceof PackagingJobError && resourceOutcome)
            throw new PackagingJobError(
              error.cause,
              Object.freeze({ ...error.report, resources: resourceOutcome }),
            );
          throw error;
        }
        return { ...result, resources, download: output.getDownload() };
      },
      close,
    });
  } catch (error) {
    close();
    throw error;
  }
}
