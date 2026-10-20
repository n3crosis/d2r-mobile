// 依据生产配置、密封运行时及打包适配器契约组装浏览器入口。
// Assemble the browser entry point from production profiles, sealed runtimes and packaging adapter contracts.
/**
 * 生产入口点。引导过程仅包含公开字节。
 * The production entry point. Bootstrap contains public bytes only.
 */
import { prepareSealedRuntime } from "./sealed-runtime/clients.mjs";
import {
  loadProductionProfile,
  bindProductionAstcEntries,
  inspectProductionAstcEntries,
} from "./production-profile.mjs";
import { resolveShellProfile } from "./shell-profiles.mjs";
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
import { exportLegacyDevicePack, LegacyPackExportError } from "./legacy-device-pack-export.mjs";
import { deriveD2rRuntimeContentMode } from "./d2r-runtime-content-mode.mjs";
import { runPackagingJob, PackagingJobError } from "./packaging-job.mjs";
import {
  sanitizeResourceOutcome,
  sanitizeResourceProgress,
  resourceProgressLabel,
  packagingActivity,
  isLegacyAstcDiagnosticCode,
} from "./packaging-diagnostics.mjs";
import { inspectGuestTarget, inspectGuestPlist } from "./guest-target-stream.mjs";
/**
 * 可选补充包在公开引导阶段选择，私有输入开始后不再联网。
 * Select the optional pack during public bootstrap; no networking after private inputs begin.
 * @param {{manifestSha256?: string, signal?: AbortSignal, onProgress?: (event: any) => void, profileId?: string, legacyAstc?: boolean}} [options]
 */
export async function prepareBrowserPackager({
  manifestSha256,
  signal,
  onProgress,
  profileId,
  legacyAstc = false,
} = {}) {
  if (typeof legacyAstc !== "boolean") throw new Error("LEGACY_ASTC_OPTION");
  const selectedProfile = resolveShellProfile(profileId);
  if (
    !globalThis.isSecureContext ||
    !navigator.storage?.getDirectory ||
    !globalThis.Worker ||
    !globalThis.crypto?.subtle
  )
    throw new Error("BROWSER_UNSUPPORTED");
  const runtime = await prepareSealedRuntime({
    baseUrl: "./runtime/",
    profileId: selectedProfile.id,
    manifestSha256,
    ...(legacyAstc ? { optionalGroups: ["legacy-astc"] } : {}),
    signal,
    onProgress,
  });
  let profile, program, assets, shaders, shellVariantBytes;
  let closed = false;
  let deferRuntimeClose = false;
  let closePromise;
  const close = () => {
    if (closed) return closePromise;
    closed = true;
    let failure,
      failed = false;
    const pending = [];
    // 即使某项清理失败，也继续释放其余运行时及输出缓冲区。
    // Release remaining runtimes and output buffers even if one cleanup fails.
    for (const release of [
      () => program?.dispose(),
      () => assets?.dispose(),
      () => shaders?.dispose(),
      () => profile?.close(),
      () => {
        if (!deferRuntimeClose) return runtime.close();
      },
      () => shellVariantBytes?.fill(0),
    ]) {
      try {
        const released = release();
        if (released && typeof released.then === "function") pending.push(released);
      } catch (error) {
        if (!failed) {
          failure = error;
          failed = true;
        }
      }
    }
    shellVariantBytes = profile = program = assets = shaders = undefined;
    if (pending.length) {
      closePromise = Promise.allSettled(pending).then((outcomes) => {
        const failures = [
          ...(failed ? [failure] : []),
          ...outcomes.filter((value) => value.status === "rejected").map((value) => value.reason),
        ];
        if (failures.length) throw new AggregateError(failures, "PACKAGER_CLEANUP_FAILED");
      });
      closePromise.catch(() => undefined);
      return closePromise;
    }
    if (failed) throw failure;
  };
  try {
    if (legacyAstc && typeof runtime.createAstcProducerClient !== "function")
      throw new Error("LEGACY_ASTC_UNAVAILABLE");
    profile = await loadProductionProfile(runtime, { signal, profileId: selectedProfile.id });
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
      profileId: profile.profileId,
      verifyProvenance: readAuthenticatedProgramModules,
      createWorker: runtime.createProgramWorker,
    });
    if (!legacyAstc) assets = createProductionAssetAdapter({ runtime, profile });
    shaders = createProductionShaderAdapter({
      runtime,
      catalog: profile.catalog,
      trustedShell: profile.trustedShell,
    });
    let used = false;
    const allowed = (path) =>
      profile.trustedShell.trustedRecipe.requiredPaths.some((p) =>
        p.endsWith("/") ? path.startsWith(p) : path === p,
      ) || profile.astcOutput?.paths.includes(path);
    return Object.freeze({
      ready: true,
      realGameVerified: false,
      /**
       * 仅允许明确跳过原始资源导出；验证及补充包导出保持不变。
       * Allow only explicit original-resource export skipping; validation and supplemental export stay unchanged.
       * @param {{input: any, selectedNspNames: any, signal?: AbortSignal, onProgress?: (event: any) => void, exportResources?: boolean}} options
       */
      async generate({ input, selectedNspNames, signal, onProgress, exportResources = true }) {
        validateResourceExportOption(exportResources);
        if (closed || used) throw new Error("RELOAD_REQUIRED");
        if (
          input?.kind !== "directory" ||
          typeof input.queryPermission !== "function" ||
          (await input.queryPermission({ mode: "readwrite" })) !== "granted"
        )
          throw new Error("INPUT_FOLDER_WRITE_PERMISSION_REQUIRED");
        used = true;
        let authenticated,
          selected,
          output,
          resources,
          resourceOutcome,
          finalizedPack,
          legacyPack,
          legacyPackOutcome;
        if (!exportResources) resources = resourceOutcome = RESOURCE_EXPORT_SKIPPED;
        const producer = legacyAstc ? runtime.createAstcProducerClient() : undefined;
        deferRuntimeClose = legacyAstc;
        const producerLease = producer
          ? {
              async close() {
                const failures = [];
                try {
                  await producer.close();
                } catch (error) {
                  failures.push(error);
                }
                try {
                  await runtime.close();
                } catch (error) {
                  failures.push(error);
                }
                if (failures.length)
                  throw new AggregateError(failures, "LEGACY_ASTC_RELEASE_FAILED");
              },
            }
          : undefined;
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
              resources = await runOptionalResourceExport(exportResources, () =>
                exportRomfsResources({
                  romfs,
                  // 仅根目录发现绝不遍历生成的资源文件夹。
                  // 导出只写入新的 UUID 子目录，绝不写入源文件。
                  // Root-only discovery never traverses generated resource folders.
                  // Export writes only to a fresh UUID child, never the source files.
                  outputDirectoryHandle: input,
                  signal,
                  onProgress: (progress) => {
                    const event = {
                      stage: "resources",
                      // 只有导出器完成标记写入后才报告完成，不能仅依据字节计数。
                      // Completion follows the exporter's marker write, not merely the byte count.
                      state: progress.state === "complete" ? "complete" : "running",
                      resourceProgress: sanitizeResourceProgress(progress),
                    };
                    return onProgress?.(
                      Object.freeze({
                        ...event,
                        label: resourceProgressLabel(event) ?? packagingActivity(event),
                      }),
                    );
                  },
                }),
              );
              resourceOutcome = exportResources ? sanitizeResourceOutcome(resources) : resources;
            } catch (error) {
              if (error instanceof ResourceExportError)
                resourceOutcome = sanitizeResourceOutcome(error.report);
              throw error;
            }
            if (finalizedPack) {
              try {
                legacyPack = await exportLegacyDevicePack({
                  finalizedPack,
                  outputDirectoryHandle: input,
                  signal,
                  onProgress: (progress) => onProgress?.({ stage: "legacy-pack", ...progress }),
                });
                legacyPackOutcome = legacyPack;
              } catch (error) {
                if (error instanceof LegacyPackExportError) legacyPackOutcome = error.report;
                throw error;
              }
            }
            output = createBrowserBlobOutputAdapters({ archiveFormat, maxOutputBytes });
            return output.createOutput(context);
          },
          validateArchive: (context) => output.validateArchive(context),
          generateProgram: async (context) =>
            (await program.generateProgram(context)).filter((e) => allowed(e.path)),
          async generateAssets(context) {
            if (producer) {
              const root = await navigator.storage.getDirectory();
              context.signal.throwIfAborted();
              finalizedPack = await producer.produce(context.extracted, context.selection, {
                root,
                ...LEGACY_ASTC_PRODUCTION_LIMITS,
                signal: context.signal,
                onProgress: createLegacyAstcDiagnosticObserver(onProgress, context.signal),
              });
              context.signal.throwIfAborted();
              assets = createProductionAssetAdapter({
                runtime,
                profile,
                prebuiltPack: { pack: finalizedPack.pack, records: finalizedPack.records },
              });
            }
            const entries = await assets.generateAssets(context);
            const binding = assets.getAstcOutputBinding?.();
            const astcEntries = selectProductionAstcEntries(entries, binding);
            if (binding !== undefined)
              profile = await bindProductionAstcEntries(profile, astcEntries, binding, {
                signal: context.signal,
              });
            return entries.filter((entry) => allowed(entry.path));
          },
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
                profileId: profile.profileId,
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
            const astcEntries = selectProductionAstcEntries(generatedEntries, profile.astcOutput);
            if (profile.astcOutput)
              await inspectProductionAstcEntries(astcEntries, profile.astcOutput, { signal });
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
              observedOutputTargetOS: await inspectGuestTarget(guest, {
                signal,
                expectedSdkVersion: profile.guestTarget.sdkVersion,
                minimumOSVersion: (
                  await inspectGuestPlist(
                    generatedEntries.find(
                      (e) => e.path === "Frameworks/Guest.framework/Info.plist",
                    ),
                    { profileId: profile.profileId, signal },
                  )
                ).minimumVersion,
              }),
            };
          },
          async cleanup(context) {
            try {
              await extraction.cleanup(context);
            } finally {
              await close();
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
          result = await withLegacyAstcProducerLease(producerLease, () =>
            runPackagingJob({
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
            }),
          );
        } catch (error) {
          if (
            error instanceof PackagingJobError &&
            (resourceOutcome || legacyPackOutcome || legacyAstc)
          ) {
            const reported = new PackagingJobError(
              error.cause,
              Object.freeze({
                ...error.report,
                ...(legacyAstc && legacyAstcFailureDetailCode(error)
                  ? { detailCode: legacyAstcFailureDetailCode(error) }
                  : {}),
                ...(resourceOutcome ? { resources: resourceOutcome } : {}),
                ...(legacyPackOutcome ? { legacyPack: legacyPackOutcome } : {}),
              }),
            );
            if (error.cleanupErrors) reported.cleanupErrors = error.cleanupErrors;
            throw reported;
          }
          throw error;
        }
        return {
          ...result,
          resources,
          ...(legacyPack ? { legacyPack } : {}),
          download: output.getDownload(),
        };
      },
      close,
    });
  } catch (error) {
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError([error, cleanup], "PACKAGER_SETUP_CLEANUP_FAILED", { cause: error });
    }
    throw error;
  }
}

// 不允许过滤器悄悄丢弃未绑定 ASTC、补充包数据或索引；这些不是 IPA 文件。
// Never let filtering silently drop unbound ASTC, external supplemental data or index files; those are not IPA entries.
export function selectProductionAstcEntries(entries, binding) {
  if (!Array.isArray(entries)) throw new Error("PRODUCTION_ASTC_INVENTORY");
  const selected = [];
  for (const entry of entries) {
    const path = entry?.path;
    if (typeof path !== "string" || path.length > 512) throw new Error("PRODUCTION_ASTC_PATH");
    const basename = path.split("/").at(-1);
    if (
      basename === "pack_index.tsv" ||
      /^data\/.*\.data$/.test(path) ||
      path.startsWith("Legacy Device Pack") ||
      (binding?.pack?.name && basename === binding.pack.name)
    )
      throw new Error("PRODUCTION_EXTERNAL_PACK_IN_IPA");
    if (path.startsWith("romfs_overlay_astc")) selected.push(entry);
  }
  if (binding === undefined && selected.length) throw new Error("PRODUCTION_ASTC_UNBOUND");
  if (binding !== undefined && (!binding || selected.length !== 11))
    throw new Error("PRODUCTION_ASTC_INVENTORY");
  return selected;
}

// 显式限制单记录和暂存包大小；补充包始终独立于 IPA。
// Explicit per-record and staged-pack limits; supplemental data always stays outside the IPA.
export const LEGACY_ASTC_PRODUCTION_LIMITS = Object.freeze({
  maxEncodedBytes: 256 * 1024 * 1024,
  maxDecodedBytes: 256 * 1024 * 1024,
  maxPackBytes: 8 * 1024 * 1024 * 1024,
  batchBlocks: 4096,
});

// 作业清理结束后才释放文件租约；清理错误不能掩盖原始失败。
// Release the File lease only after job cleanup; cleanup failures must not hide the primary failure.
export async function withLegacyAstcProducerLease(producer, operation) {
  let result, primary;
  let failed = false;
  try {
    result = await operation();
  } catch (error) {
    primary = error;
    failed = true;
  }
  try {
    await producer?.close();
  } catch (cleanup) {
    if (!failed) {
      const error = new PackagingJobError(
        cleanup,
        Object.freeze({
          status: "failed",
          code: "STAGE_FAILED",
          stage: "cleanup",
          committed: result?.committed === true,
          cleanupCodes: Object.freeze(["LEGACY_ASTC_CLEANUP_FAILED"]),
        }),
      );
      error.cleanupErrors = Object.freeze([cleanup]);
      throw error;
    }
    const combined = new AggregateError([primary, cleanup], "LEGACY_ASTC_CLEANUP_FAILED", {
      cause: primary,
    });
    if (primary instanceof PackagingJobError) {
      const error = new PackagingJobError(
        primary.cause,
        Object.freeze({
          ...primary.report,
          cleanupCodes: Object.freeze([
            ...(primary.report.cleanupCodes ?? []),
            "LEGACY_ASTC_CLEANUP_FAILED",
          ]),
        }),
      );
      error.cleanupErrors = Object.freeze([cleanup]);
      throw error;
    }
    throw combined;
  }
  if (failed) throw primary;
  return result;
}

// 只转发封闭阶段及实际工作计数；多遍处理字节不是总进度，观察者不能改变转换结果。
// Forward only closed phases and actual work counts; multi-pass bytes are not total progress and observers cannot affect conversion.
export function createLegacyAstcDiagnosticObserver(onDiagnostic, signal) {
  return (progress) => {
    if (signal?.aborted || typeof onDiagnostic !== "function") return;
    if (!progress || !["preparing", "converting", "complete"].includes(progress.phase)) return;
    const count = (value) => Number.isSafeInteger(value) && value >= 0;
    if (
      !count(progress.processedBytes) ||
      !count(progress.completedBlocks) ||
      (progress.completedRecords !== undefined && !count(progress.completedRecords))
    )
      return;
    const diagnostic = Object.freeze({
      kind: "legacy-astc",
      phase: progress.phase,
      processedBytes: progress.processedBytes,
      completedBlocks: progress.completedBlocks,
      ...(progress.completedRecords === undefined
        ? {}
        : { completedRecords: progress.completedRecords }),
    });
    try {
      Promise.resolve(
        onDiagnostic(Object.freeze({ stage: "assets", state: "running", diagnostic })),
      ).catch(() => undefined);
    } catch {
      /* 观察者错误不影响任务。 | Observer failures do not affect the job. */
    }
  };
}

// 只从生产器的直接原因提升封闭诊断，不递归搜索或渲染原始错误。
// Promote closed diagnostics only from the producer's direct cause; never recursively search or render raw errors.
export function legacyAstcFailureDetailCode(error) {
  return error instanceof PackagingJobError && isLegacyAstcDiagnosticCode(error.cause?.detailCode)
    ? error.cause.detailCode
    : undefined;
}

// 跳过不表示已有资源经过验证，也不表示本次导出完成。
// Skipping neither verifies existing resources nor claims an export completed this run.
const RESOURCE_EXPORT_SKIPPED = Object.freeze({ status: "skipped", reason: "user-requested" });
function validateResourceExportOption(value) {
  if (typeof value !== "boolean") throw new Error("RESOURCE_EXPORT_OPTION");
}
export async function runOptionalResourceExport(exportResources = true, exportOriginalResources) {
  validateResourceExportOption(exportResources);
  return exportResources ? await exportOriginalResources() : RESOURCE_EXPORT_SKIPPED;
}
