// 浏览器本地打包界面：依据打包进度协议与共享多语文字表。
// Local browser packaging UI based on the packaging progress protocol and shared multilingual table.
import { t, browserLanguage } from "../i18n.mjs";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AppCustomizationFields,
  type AppCustomizationDraft,
} from "@/components/AppCustomizationFields";
import { normalizeAppCustomization, prepareAppCustomization } from "../app-customization.mjs";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prepareBrowserPackager, takeCommittedDownload } from "../browser-packager.mjs";
import { DEFAULT_SHELL_PROFILE_ID, IOS18_SHELL_PROFILE_ID } from "../shell-profiles.mjs";
import { discoverGameFolder } from "../game-input.mjs";
import { PROGRAM_COMPATIBILITY } from "../program-compatibility.mjs";
import { createDownloadPreparation, attemptAutomaticDownload } from "../download-preparation.mjs";
import { signWithLocalFiles } from "../signing-input.mjs";
import { IPA_SIGNING_LIMITS } from "../ipa-signing-contract.mjs";
import { createUiOperationGate } from "../ui-operation-gate.mjs";
import { readOpfsStorageAdvisory } from "../opfs-storage-advisory.mjs";
import {
  packagingActivity,
  packagingFailureMessage,
  packagingFailureSummary,
  shaderFailureDetails,
  committedCleanupWarning,
  resourceProgressLabel,
  shaderProgressLabel,
  gameFolderFailureMessage,
  appCustomizationFailureMessage,
} from "../packaging-diagnostics.mjs";

type LocalPickers = typeof globalThis & {
  showDirectoryPicker?: (options: {
    mode: "read" | "readwrite";
  }) => Promise<FileSystemDirectoryHandle>;
};
const browser = globalThis as LocalPickers;
type Packager = Awaited<ReturnType<typeof prepareBrowserPackager>>;
type LoadingProgress = {
  phase: string;
  loadedBytes: number;
  totalBytes: number;
  downloadedBytes: number;
  cachedBytes: number;
  completedFiles: number;
  totalFiles: number;
  label: string;
};
type InputMode = "packages" | "extracted";
type FolderProgress = {
  inputMode?: string;
  extractedFileCount?: number;
  nspCount: number;
  prodKeysFound: boolean;
  titleKeysFound: boolean;
};
type ActivityEntry = { id: number; text: string };
type RomfsProgress = { phase: "base" | "merged"; percent: number };
const folderSummary = (progress: FolderProgress) =>
  progress.inputMode === "extracted"
    ? t("dmWebExtractedSummary", progress.extractedFileCount ?? 0)
    : progress.inputMode === "packages"
      ? t(
          "dmWebFolderSummary",
          progress.nspCount,
          t(progress.prodKeysFound ? "dmWebFound" : "dmWebMissing"),
          t(progress.titleKeysFound ? "dmWebFoundOptional" : "dmWebNotProvided"),
        )
      : t("dmWebDetectingInput");
const megabytes = (bytes: number) => t("dmWebMegabytes", (bytes / 1_000_000).toFixed(1));
const loadingLabel = (phase: string) =>
  t(phase === "download" ? "dmWebDownloading" : "dmWebPreparing");
export default function App() {
  const [target] = useState(() =>
    new URLSearchParams(window.location.search).get("target") === "ios18" ? "ios18" : "ios26",
  );
  const [legacyAstc] = useState(
    () => new URLSearchParams(window.location.search).get("legacyAstc") === "1",
  );
  const [skipContentHashes] = useState(
    () => new URLSearchParams(window.location.search).get("skipContentHashes") !== "0",
  );
  const [astcPreset] = useState<"thorough" | "fast">(() =>
    new URLSearchParams(window.location.search).get("astcPreset") === "fast" ? "fast" : "thorough",
  );
  const [signing] = useState(
    () => new URLSearchParams(window.location.search).get("signing") === "1",
  );
  const [signingReady, setSigningReady] = useState(false);
  const [signingStatus, setSigningStatus] = useState("");
  const [signingRetryAvailable, setSigningRetryAvailable] = useState(false);
  const unsignedForSigning = useRef<{ blob: Blob; fileName: string } | null>(null);
  const identityInput = useRef<HTMLInputElement>(null);
  const profileInput = useRef<HTMLInputElement>(null);
  const passwordInput = useRef<HTMLInputElement>(null);
  const [credentialsSelected, setCredentialsSelected] = useState(false);
  const [legacyStatus, setLegacyStatus] = useState("");
  const [skipResources, setSkipResources] = useState(false);
  const [resourceOutcome, setResourceOutcome] = useState("");
  const [storageAdvisory, setStorageAdvisory] = useState("");
  const profileId = target === "ios18" ? IOS18_SHELL_PROFILE_ID : DEFAULT_SHELL_PROFILE_ID;
  const supportedVersions = PROGRAM_COMPATIBILITY.releases
    .filter((release) =>
      PROGRAM_COMPATIBILITY.shellProfiles
        .find((profile) => profile.id === profileId)
        ?.programReleaseIds.includes(release.id),
    )
    .map((release) => release.gameVersion)
    .join(", ");
  const [inputMode, setInputMode] = useState<InputMode | null>(null);
  const [appCustomization, setAppCustomization] = useState<AppCustomizationDraft>({});
  const [customizationError, setCustomizationError] = useState("");
  const customizationValidation = useMemo(() => {
    try {
      return { options: normalizeAppCustomization(appCustomization), error: "" };
    } catch (error) {
      return { options: undefined, error: appCustomizationFailureMessage(error) };
    }
  }, [appCustomization]);
  const [hasSelectedFolder, setHasSelectedFolder] = useState(false);
  useEffect(() => {
    document.documentElement.lang = browserLanguage();
    document.title = t("dmWebTitle");
  }, []);
  const [activity, setActivity] = useState<ActivityEntry[]>([]);
  const [copyStatus, setCopyStatus] = useState("");
  const lastActivity = useRef("");
  const activityBuffer = useRef<ActivityEntry[]>([]);
  const activityRevision = useRef(0);
  const renderedActivityRevision = useRef(0);
  const copiedActivityRevision = useRef<number | null>(null);
  const copyRequest = useRef(0);
  const activityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingGenerationStatus = useRef<string | null>(null);
  const pendingRomfsProgress = useRef<RomfsProgress | null | undefined>(undefined);
  const [loading, setLoading] = useState<LoadingProgress | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState(t("dmWebLoading"));
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [romfsProgress, setRomfsProgress] = useState<RomfsProgress | null>(null);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [nspNames, setNspNames] = useState<string[]>([]);
  const [download, setDownload] = useState<{ url: string; fileName: string } | null>(null);
  const signedDownload = download?.fileName === "D2RMobile-signed.ipa";
  const [finished, setFinished] = useState(false);
  const downloadPreparation = useRef(createDownloadPreparation());
  const [downloadPreparationFailed, setDownloadPreparationFailed] = useState(false);
  const [originalIdentityDownload, setOriginalIdentityDownload] = useState(false);
  const mounted = useRef(true);
  const operationGate = useRef(createUiOperationGate());
  const flushActivity = useCallback(() => {
    if (activityTimer.current !== null) {
      clearTimeout(activityTimer.current);
      activityTimer.current = null;
    }
    if (!mounted.current) return;
    if (renderedActivityRevision.current !== activityRevision.current) {
      renderedActivityRevision.current = activityRevision.current;
      setActivity([...activityBuffer.current]);
      if (copiedActivityRevision.current !== activityRevision.current) setCopyStatus("");
    }
    if (pendingGenerationStatus.current !== null) {
      setStatus(pendingGenerationStatus.current);
      pendingGenerationStatus.current = null;
    }
    if (pendingRomfsProgress.current !== undefined) {
      const next = pendingRomfsProgress.current;
      pendingRomfsProgress.current = undefined;
      setRomfsProgress((current) =>
        current?.phase === next?.phase && current?.percent === next?.percent ? current : next,
      );
    }
  }, []);
  const appendActivity = useCallback(
    (text: string | null, force = false) => {
      if (!mounted.current) return;
      if (text && (force || text !== lastActivity.current)) {
        lastActivity.current = text;
        activityRevision.current += 1;
        // 删除最旧记录时保留其他行的身份，避免按移动后的索引重新挂载。
        // Preserve surviving row identities when trimming, instead of remounting by shifted indexes.
        activityBuffer.current.push({
          id: activityRevision.current,
          text: `${new Date().toLocaleString()} ${text}`,
        });
        if (activityBuffer.current.length > 200) activityBuffer.current.shift();
      }
      // 保留有界日志中的每条记录，但合并短暂的界面更新。
      // 终止事件立即刷新此前的记录。
      // Preserve every bounded log entry, but coalesce transient UI updates.
      // Terminal events flush the preceding entries immediately.
      if (force) flushActivity();
      else if (activityTimer.current === null) {
        activityTimer.current = setTimeout(flushActivity, 250);
      }
    },
    [flushActivity],
  );
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (activityTimer.current !== null) clearTimeout(activityTimer.current);
      activityTimer.current = null;
      pendingGenerationStatus.current = null;
      pendingRomfsProgress.current = undefined;
    };
  }, []);
  const packager = useRef<Packager | null>(null),
    cancellation = useRef<AbortController | null>(null);
  useEffect(() => {
    const preparedDownload = downloadPreparation.current;
    const operations = operationGate.current;
    mounted.current = true;
    const controller = new AbortController();
    cancellation.current = controller;
    const digest = document.querySelector<HTMLMetaElement>(
      'meta[name="runtime-manifest-sha256"]',
    )?.content;
    if (!browser.showDirectoryPicker || !digest || !/^[a-f0-9]{64}$/.test(digest)) {
      setStatus(t("dmWebUnsupported"));
      return;
    }
    appendActivity(t("dmWebLoadingVerified"), true);
    appendActivity(t("dmWebManifest", digest), true);
    let previousPhase = "";
    void prepareBrowserPackager({
      manifestSha256: digest,
      profileId,
      legacyAstc,
      astcPreset,
      skipContentHashes,
      signing,
      signal: controller.signal,
      onProgress: (event: LoadingProgress) => {
        if (!controller.signal.aborted) {
          setLoading(event);
          setStatus(loadingLabel(event.phase));
          if (event.phase !== previousPhase) {
            previousPhase = event.phase;
            appendActivity(
              event.phase === "download" ? t("dmWebDownloading") : t("dmWebPreparing"),
              true,
            );
          }
        }
      },
    })
      .then((value) => {
        if (controller.signal.aborted) {
          value.close();
          return;
        }
        packager.current = value;
        setLoading(null);
        setReady(true);
        setSigningReady(value.signingReady);
        // 空间估计不预留空间，也不阻止继续；忽略取消或卸载后的结果。
        // Estimates neither reserve space nor block continuation; ignore cancelled or unmounted results.
        void readOpfsStorageAdvisory({ signal: controller.signal }).then((estimate) => {
          if (controller.signal.aborted || !mounted.current || estimate.status === "cancelled")
            return;
          setStorageAdvisory(
            estimate.status === "estimated" && estimate.availableBytes !== null
              ? t("dmWebStorageEstimate", megabytes(estimate.availableBytes))
              : t("dmWebStorageUnknown"),
          );
        });
        setStatus(t("dmWebReady"));
        appendActivity(t("dmWebApplicationReady"), true);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadFailed(true);
          appendActivity(t("dmWebSetupFailed"), true);
          setStatus(
            t(
              "dmWebSetupError",
              String(error instanceof Error ? error.message : error).slice(0, 1400),
            ),
          );
        }
      });
    return () => {
      mounted.current = false;
      controller.abort();
      operations.cancel();
      cancellation.current?.abort();
      packager.current?.close();
      preparedDownload.dispose();
      unsignedForSigning.current = null;
    };
  }, [appendActivity, profileId, legacyAstc, astcPreset, skipContentHashes, signing]);
  async function choose() {
    if (!ready || busy || !browser.showDirectoryPicker) return;
    const operation = operationGate.current.begin();
    if (!operation) return;
    const current = () => mounted.current && operation.isCurrent();
    const previousStatus = status;
    const jobPackager = packager.current;
    const controller = operation.controller;
    cancellation.current = controller;
    let selectedName = "";
    let progress: FolderProgress = {
      nspCount: 0,
      prodKeysFound: false,
      titleKeysFound: false,
    };
    setBusy(true);
    setCancelling(false);
    setStatus(t("dmWebWaitingFolder"));
    try {
      const selected = await browser.showDirectoryPicker({ mode: "readwrite" });
      controller.signal.throwIfAborted();
      if (!current()) return;
      setSkipResources(false);
      selectedName = selected.name;
      setFolder(null);
      setNspNames([]);
      setInputMode(null);
      setStatus(t("dmWebChecking", selected.name));
      const files = await discoverGameFolder(selected, {
        signal: controller.signal,
        onProgress: (event: FolderProgress) => {
          if (controller.signal.aborted || !current()) return;
          progress = event;
          setStatus(t("dmWebCheckingProgress", selected.name, folderSummary(event)));
        },
      });
      controller.signal.throwIfAborted();
      if (!current()) return;
      const names = files.nsps.map((file) => file.name);
      setNspNames(names);
      setInputMode(files.inputMode);
      // 仅成功检查输入后锁定配置；失败或取消仍可通过整页重载更改选项。
      // Lock configuration only after discovery succeeds; failed/cancelled selection can still reload with new options.
      setHasSelectedFolder(true);
      setFolder(selected);
      appendActivity(
        files.inputMode === "extracted"
          ? t("dmWebExtractedChecked")
          : t(
              "dmWebFolderChecked",
              progress.nspCount,
              t(progress.titleKeysFound ? "dmWebProvided" : "dmWebNotProvided"),
            ),
        true,
      );
      setStatus(
        t(
          files.inputMode === "extracted" ? "dmWebExtractedReady" : "dmWebPackagesReady",
          selected.name,
          folderSummary({ ...progress, inputMode: files.inputMode }),
        ),
      );
    } catch (error) {
      if (!current()) return;
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === "AbortError")
      ) {
        setStatus(controller.signal.aborted ? t("dmWebCancelledReload") : previousStatus);
      } else {
        setFolder(null);
        setNspNames([]);
        setInputMode(null);
        appendActivity(t("dmWebFolderFailed"), true);
        const code = (error as { code?: string })?.code;
        const permissionError =
          error instanceof DOMException &&
          ["NotAllowedError", "SecurityError"].includes(error.name);
        const reason = permissionError
          ? t("dmWebFolderPermission")
          : gameFolderFailureMessage(code);
        setStatus(`${selectedName ? `${selectedName}: ${folderSummary(progress)} ` : ""}${reason}`);
      }
    } finally {
      // 显式取消后必须重载，立即关闭已预加载的运行时；仅关闭选取器仍允许重试。
      // Explicit cancellation requires reload: release preloaded runtimes now; picker dismissal stays retryable.
      if (controller.signal.aborted && current()) {
        try {
          await jobPackager?.close();
        } catch {
          if (current()) appendActivity(t("dmWebCleanupWarning"), true);
        }
      }
      if (current()) {
        setBusy(false);
        setCancelling(false);
        if (controller.signal.aborted) setFinished(true);
      }
      operation.finish();
    }
  }
  function prepareDownload(automatic = !originalIdentityDownload) {
    const prepared = downloadPreparation.current.prepare();
    if (prepared.status !== "ready") {
      setDownloadPreparationFailed(true);
      appendActivity(t("dmWebDownloadPreparationFailed"), true);
      return;
    }
    setDownload({ url: prepared.url, fileName: prepared.fileName });
    setDownloadPreparationFailed(false);
    if (automatic) attemptAutomaticDownload(prepared);
  }
  function clearSigningInputs() {
    if (identityInput.current) identityInput.current.value = "";
    if (profileInput.current) profileInput.current.value = "";
    if (passwordInput.current) passwordInput.current.value = "";
    if (mounted.current) setCredentialsSelected(false);
  }
  async function runSigning(
    jobPackager: Packager,
    unsigned: { blob: Blob; fileName: string },
    controller: AbortController,
    current: () => boolean,
  ): Promise<boolean> {
    setSigningRetryAvailable(false);
    setSigningStatus(t("dmWebSigningWorking"));
    let attempt: Awaited<ReturnType<Packager["prepareSigning"]>> | undefined;
    try {
      // 先初始化独立线程，再读取凭据；重试不再运行转换或资源导出。
      // Initialize the independent worker before reading credentials; retries never rerun conversion or resource export.
      attempt = await jobPackager.prepareSigning({ signal: controller.signal });
      controller.signal.throwIfAborted();
      if (!current()) return false;
      const signed = await signWithLocalFiles({
        unsigned,
        sign: attempt.sign,
        identityFile: identityInput.current?.files?.[0],
        profileFile: profileInput.current?.files?.[0],
        password: passwordInput.current?.value ?? "",
        signal: controller.signal,
        onProgress: undefined,
      });
      if (!current()) return false;
      downloadPreparation.current.retain(signed);
      unsignedForSigning.current = null;
      setSigningStatus(t("dmWebSigningComplete"));
      setStatus(t("dmWebSigningComplete"));
      prepareDownload();
      return false;
    } catch (signingError) {
      if (!current()) return false;
      // 固定消息不包含凭据；失败不改变未签名 IPA 或已完成的资源导出。
      // Fixed messages contain no credentials; failure does not change the unsigned IPA or completed resource exports.
      const signingMessage = t(
        controller.signal.aborted
          ? "dmWebSigningCancelled"
          : signingError instanceof Error &&
              signingError.message === "SIGNING_APPLICATION_ID_TOO_LONG"
            ? "dmWebSigningApplicationIdTooLong"
            : signingError instanceof Error && signingError.message === "SIGNING_PROFILE_MISMATCH"
              ? "dmWebSigningProfileMismatch"
              : "dmWebSigningFailed",
      );
      setSigningStatus(signingMessage);
      appendActivity(signingMessage, true);
      setStatus(t("dmWebUnsignedReady"));
      setSigningRetryAvailable(true);
      prepareDownload(false);
      return true;
    } finally {
      attempt?.close();
      clearSigningInputs();
    }
  }
  async function retrySigning() {
    const unsigned = unsignedForSigning.current;
    if (
      !signingRetryAvailable ||
      !unsigned ||
      !packager.current ||
      !signingReady ||
      !identityInput.current?.files?.[0] ||
      !profileInput.current?.files?.[0]
    )
      return;
    const operation = operationGate.current.begin();
    if (!operation) return;
    const jobPackager = packager.current;
    const current = () => mounted.current && operation.isCurrent();
    cancellation.current = operation.controller;
    setBusy(true);
    setGenerating(true);
    setCancelling(false);
    pendingGenerationStatus.current = null;
    let keepSigningFactory = false;
    try {
      keepSigningFactory = await runSigning(jobPackager, unsigned, operation.controller, current);
    } finally {
      try {
        if (!keepSigningFactory || !current()) await jobPackager.close();
      } catch {
        if (current()) {
          const warning = t("dmWebCleanupWarning");
          appendActivity(warning, true);
          setStatus((previous: string) => `${previous} ${warning}`);
        }
      }
      if (current()) {
        setBusy(false);
        setGenerating(false);
        setCancelling(false);
      }
      operation.finish();
    }
  }
  async function generate() {
    if (
      !ready ||
      busy ||
      !folder ||
      !inputMode ||
      !packager.current ||
      customizationValidation.error ||
      customizationError ||
      (inputMode === "packages" && !nspNames.length)
    )
      return;
    if (
      signing &&
      (!signingReady || !identityInput.current?.files?.[0] || !profileInput.current?.files?.[0])
    )
      return;
    const operation = operationGate.current.begin();
    if (!operation) return;
    const jobPackager = packager.current;
    const current = () => mounted.current && operation.isCurrent();
    const controller = operation.controller;
    cancellation.current = controller;
    setBusy(true);
    setGenerating(true);
    setCustomizationError("");
    let preparedCustomization;
    try {
      // 先检查本地选项；验证失败不消耗一次性打包器，允许更正后重试。
      // Check local options first; invalid input does not consume the one-shot packager and can be corrected.
      setStatus(t("dmWebCustomChecking"));
      preparedCustomization = await prepareAppCustomization(customizationValidation.options, {
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      if (!current()) {
        operation.finish();
        return;
      }
    } catch (error) {
      if (current()) {
        if (controller.signal.aborted) {
          setReady(false);
          setFinished(true);
          setStatus(t("dmWebCancelledReload"));
          if (signing) clearSigningInputs();
          try {
            await jobPackager.close();
          } catch {
            if (current()) appendActivity(t("dmWebCleanupWarning"), true);
          }
        } else {
          setCustomizationError(appCustomizationFailureMessage(error));
          setStatus(t("dmWebCustomCorrect"));
        }
        if (current()) {
          setBusy(false);
          setGenerating(false);
          setCancelling(false);
        }
      }
      operation.finish();
      return;
    }
    setResourceOutcome("");
    setCancelling(false);
    pendingRomfsProgress.current = undefined;
    setRomfsProgress(null);
    setReady(false);
    setStatus(t("dmWebStarting"));
    if (legacyAstc) setLegacyStatus(t("dmWebLegacyPreparing"));
    appendActivity(t("dmWebGenerationStarted"), true);
    if (inputMode === "packages")
      appendActivity(t(skipContentHashes ? "dmWebSkipHashActive" : "dmWebFastMode"), true);
    else appendActivity(t("dmWebExtractedChecked"), true);
    let acceptingProgress = true;
    let generationCompleted = false;
    let keepSigningFactory = false;
    try {
      const result = await jobPackager.generate({
        input: folder,
        inputMode,
        ...(Object.keys(preparedCustomization).length
          ? { appCustomization: preparedCustomization }
          : {}),
        ...(inputMode === "packages" ? { selectedNspNames: nspNames } : {}),
        exportResources: !skipResources,
        signal: controller.signal,
        onProgress: (event: {
          label?: string;
          stage?: string;
          state?: string;
          bytesWritten?: number;
          totalBytes?: number;
          directoryName?: string;
          diagnostic?: {
            stage?: string;
            completed?: number;
            kind?: string;
            processedBytes?: number;
            completedBlocks?: number;
            completedRecords?: number;
            totalRecords?: number;
          };
          resourceProgress?: {
            filesWritten: number;
            totalFiles: number;
            bytesWritten: number;
            totalBytes: number;
          };
        }) => {
          if (!acceptingProgress || controller.signal.aborted || !current()) return;
          const shaderLabel = shaderProgressLabel(event);
          if (shaderLabel) {
            // 记录计数只更新合并后的状态行，不逐条写入活动日志。
            // Record counts update only the coalesced status line, not per-record activity logs.
            pendingGenerationStatus.current = shaderLabel;
            appendActivity(null);
            return;
          }
          // 补充包导出单独显示，不把它的完成状态当作 IPA 完成。
          // Show the supplemental export separately; its completion is not IPA completion.
          if (legacyAstc && event.stage === "assets" && event.diagnostic?.kind === "legacy-astc") {
            const blocks = event.diagnostic.completedBlocks;
            const bytes = event.diagnostic.processedBytes;
            if (
              typeof blocks === "number" &&
              Number.isSafeInteger(blocks) &&
              blocks >= 0 &&
              typeof bytes === "number" &&
              Number.isSafeInteger(bytes) &&
              bytes >= 0
            )
              setLegacyStatus(t("dmWebLegacyConverting", blocks, (bytes / 1_000_000).toFixed(1)));
            return;
          }
          if (legacyAstc && event.stage === "legacy-pack") {
            setLegacyStatus(
              event.state === "complete"
                ? t("dmWebLegacyComplete", event.directoryName ?? "")
                : t(
                    "dmWebLegacySaving",
                    megabytes(event.bytesWritten ?? 0),
                    megabytes(event.totalBytes ?? 0),
                  ),
            );
            return;
          }
          const activityLabel = packagingActivity(event);
          pendingGenerationStatus.current =
            resourceProgressLabel(event) ?? activityLabel ?? t("dmWebInProgress");
          const phase = event.diagnostic?.stage;
          const percent = event.diagnostic?.completed;
          pendingRomfsProgress.current =
            (phase === "romfs-base" || phase === "romfs-merged") &&
            event.state !== "failed" &&
            event.state !== "complete" &&
            typeof percent === "number" &&
            Number.isFinite(percent) &&
            percent >= 0 &&
            percent <= 100
              ? { phase: phase === "romfs-base" ? "base" : "merged", percent }
              : null;
          appendActivity(activityLabel, event.state === "failed" || event.state === "complete");
        },
      });
      if (!current()) return;
      generationCompleted = true;
      if (legacyAstc && result.legacyPack?.status === "complete")
        setLegacyStatus(t("dmWebLegacyComplete", result.legacyPack.directoryName));
      downloadPreparation.current.retain(result.download);
      appendActivity(t("dmWebUnsignedReady"), true);
      if (result.resources.status === "skipped") {
        setResourceOutcome(t("dmWebResourcesSkipped"));
        setStatus(t("dmWebUnsignedReady"));
      } else {
        setResourceOutcome(t("dmWebResourcesSaved", result.resources.directoryName));
        setStatus(t("dmWebDownloadReady", folder.name, result.resources.directoryName));
      }
      // 下载准备失败只提供重试，不重新运行转换或覆盖已完成导出状态。
      // Download preparation failures offer retry only, without rerunning conversion or overwriting completed exports.
      prepareDownload(!signing);
      if (signing) {
        acceptingProgress = false;
        pendingGenerationStatus.current = null;
        unsignedForSigning.current = result.download;
        keepSigningFactory = await runSigning(jobPackager, result.download, controller, current);
      }
    } catch (error) {
      if (!current()) return;
      if (generationCompleted) {
        setDownloadPreparationFailed(true);
        appendActivity(t("dmWebDownloadPreparationFailed"), true);
        return;
      }
      const report = (
        error as {
          report?: {
            stage?: string;
            code?: string;
            detailCode?: string;
            shaderDiagnostic?: unknown;
            outputStarted?: boolean;
            legacyPack?: { status?: string; directoryName?: string };
            resources?: { status?: string; directoryName?: string };
          };
        }
      )?.report;
      if (report?.resources?.status === "skipped") setResourceOutcome(t("dmWebResourcesSkipped"));
      if (legacyAstc)
        setLegacyStatus(
          report?.legacyPack?.status === "complete"
            ? t("dmWebLegacyComplete", report.legacyPack.directoryName ?? "")
            : t("dmWebLegacyIncomplete"),
        );
      const recovered = takeCommittedDownload(error);
      if (recovered) {
        if (report?.resources?.status === "complete")
          setResourceOutcome(t("dmWebResourcesSaved", report.resources.directoryName ?? ""));
        downloadPreparation.current.retain(recovered);
        // 生成成功返回前恢复的都是原始 IPA；清理也可能在自定义开始前失败。
        // Every recovery before successful generation is the original IPA; cleanup can fail before customization starts.
        const originalIdentity = Object.keys(preparedCustomization).length > 0;
        setOriginalIdentityDownload(originalIdentity);
        const warning = originalIdentity
          ? `${report?.stage === "customization" ? "" : `${committedCleanupWarning()} `}${t("dmWebCustomOriginalRetained")}`
          : committedCleanupWarning();
        appendActivity(warning, true);
        setStatus(warning);
        // 自定义失败只提供明确标注的原始下载，不自动下载或签名。
        // Customization failures offer a labeled original download, without automatic download or signing.
        prepareDownload(!originalIdentity);
        return;
      }
      appendActivity(packagingFailureSummary(report), true);
      for (const detail of shaderFailureDetails(report)) appendActivity(detail, true);
      setStatus(packagingFailureMessage(report));
    } finally {
      acceptingProgress = false;
      if (current()) {
        if (signing) clearSigningInputs();
        pendingGenerationStatus.current = null;
      }
      // 仅签名失败保留公开签名工厂；转换失败或签名成功关闭全部所有权。
      // Only signing failure retains the public signing factory; conversion failure or signing success closes every owner.
      try {
        if (!keepSigningFactory || !current()) await jobPackager.close();
      } catch {
        if (current()) {
          const warning = t("dmWebCleanupWarning");
          appendActivity(warning, true);
          setStatus((previous: string) => `${previous} ${warning}`);
        }
      }
      if (current()) {
        pendingGenerationStatus.current = null;
        pendingRomfsProgress.current = undefined;
        setRomfsProgress(null);
        setBusy(false);
        setGenerating(false);
        setCancelling(false);
        setFinished(true);
      }
      operation.finish();
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("dmWebTitle")}</CardTitle>
          <CardDescription>{t("dmWebAutoInstructions")}</CardDescription>
          <CardDescription>
            {t(
              "dmWebOutputCompatibility",
              t(target === "ios18" ? "dmWebTarget18" : "dmWebTarget26"),
              t(legacyAstc ? "dmWebLegacyTextures" : "dmWebBcTextures"),
            )}
          </CardDescription>
          <CardDescription>{t("dmWebOptionsBeforeFolder")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => void choose()} disabled={!ready || busy}>
              {t("dmWebChoose")}
            </Button>
            <Button
              onClick={() => void generate()}
              disabled={
                !ready ||
                !folder ||
                !inputMode ||
                Boolean(customizationValidation.error || customizationError) ||
                (inputMode === "packages" && !nspNames.length) ||
                busy ||
                (signing && (!signingReady || !credentialsSelected))
              }
              aria-busy={generating}
            >
              {generating && (
                <span
                  className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
                  aria-hidden="true"
                />
              )}
              {generating ? t("dmWebGenerating") : t("dmWebGenerate")}
            </Button>
            {busy && (
              <Button
                variant="outline"
                disabled={cancelling}
                onClick={() => {
                  setReady(false);
                  setCancelling(true);
                  cancellation.current?.abort();
                  pendingGenerationStatus.current = null;
                  pendingRomfsProgress.current = undefined;
                  setRomfsProgress(null);
                  setStatus(t("dmWebCancellingWait"));
                  appendActivity(t("dmWebCancellationRequested"), true);
                }}
              >
                {cancelling ? t("dmWebCancelling") : t("dmWebCancel")}
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {status}
          </p>
          {folder && (
            <div className="space-y-2">
              <p className="break-all text-sm font-medium">{folder.name}</p>
              {inputMode === "extracted" ? (
                <p className="text-xs text-muted-foreground">{t("dmWebExtractedInstructions")}</p>
              ) : (
                <details className="space-y-2 text-xs text-muted-foreground">
                  <summary className="cursor-pointer">
                    {t("dmWebIncludedPackages", nspNames.length)}
                  </summary>
                  <ul className="space-y-1 break-all">
                    {nspNames.map((name) => (
                      <li key={name}>{name}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}
          {signingStatus && (
            <p className="text-sm text-muted-foreground" role="status">
              {signingStatus}
            </p>
          )}
          {resourceOutcome && (
            <p className="text-sm text-muted-foreground" role="status">
              {resourceOutcome}
            </p>
          )}
          {downloadPreparationFailed && (
            <div className="space-y-2">
              <p className="text-sm text-muted-foreground" role="status">
                {t("dmWebDownloadPreparationFailed")}
              </p>
              <Button onClick={() => prepareDownload()}>
                {t("dmWebRetryDownloadPreparation")}
              </Button>
            </div>
          )}
          {signingRetryAvailable && (
            <Button onClick={retrySigning} disabled={busy || !credentialsSelected}>
              {t("dmWebRetrySigning")}
            </Button>
          )}
          {download && (
            <div className="space-y-2">
              <Button asChild>
                <a href={download.url} download={download.fileName}>
                  {t(
                    originalIdentityDownload
                      ? "dmWebCustomOriginalDownload"
                      : signedDownload
                        ? "dmWebSignedDownload"
                        : "dmWebDownload",
                  )}
                </a>
              </Button>
              <p className="text-xs text-muted-foreground">
                {t(
                  originalIdentityDownload
                    ? "dmWebCustomOriginalRetained"
                    : signedDownload
                      ? "dmWebSignedHelp"
                      : "dmWebDownloadHelp",
                )}
              </p>
            </div>
          )}
          {legacyAstc && legacyStatus && (
            <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
              {legacyStatus}
            </p>
          )}
          {generating && (
            <div className="space-y-2 rounded-md border bg-muted/50 p-3 text-sm">
              <p className="font-medium">
                {cancelling ? t("dmWebStopping") : t("dmWebInProgress")}
              </p>
              <progress
                className="h-2 w-full accent-primary"
                aria-label={
                  cancelling
                    ? t("dmWebStoppingAria")
                    : romfsProgress
                      ? t(
                          "dmWebVerification",
                          t(romfsProgress.phase === "base" ? "dmWebBase" : "dmWebMerged"),
                        )
                      : t("dmWebProgressAria")
                }
                value={cancelling ? undefined : romfsProgress?.percent}
                max={100}
              />
              <p className="text-xs text-muted-foreground">
                {cancelling
                  ? t("dmWebWaitCleanup")
                  : romfsProgress
                    ? t(
                        "dmWebVerificationPercent",
                        t(romfsProgress.phase === "base" ? "dmWebBase" : "dmWebMerged"),
                        romfsProgress.percent,
                      )
                    : t("dmWebLargePackages")}
              </p>
            </div>
          )}
          <details className="space-y-4 rounded-md border p-3">
            <summary className="cursor-pointer text-sm font-medium">
              {t("dmWebAdvancedOptions")}
            </summary>
            <div className="space-y-2">
              <label htmlFor="ios-target" className="text-sm font-medium">
                {t("dmWebTarget")}
              </label>
              <select
                id="ios-target"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                aria-describedby="ios-target-help"
                value={target}
                disabled={hasSelectedFolder || busy || generating || download !== null}
                onChange={(event) => {
                  const next = event.target.value;
                  if (
                    (next !== "ios18" && next !== "ios26") ||
                    next === target ||
                    operationGate.current.busy ||
                    hasSelectedFolder ||
                    busy ||
                    generating ||
                    download !== null
                  )
                    return;
                  // 密封运行时只初始化一次；选择输入之前用整页重载切换封闭目标。
                  // The sealed runtime initializes once; reload to switch closed targets before selecting inputs.
                  const url = new URL(window.location.href);
                  if (next === "ios18") url.searchParams.set("target", "ios18");
                  else url.searchParams.delete("target");
                  window.location.assign(url.href);
                }}
              >
                <option value="ios26">{t("dmWebTarget26")}</option>
                <option value="ios18">{t("dmWebTarget18")}</option>
              </select>
              <p id="ios-target-help" className="text-xs text-muted-foreground">
                {t("dmWebTargetReload")}
              </p>
              <p className="text-xs text-muted-foreground">
                {t("dmWebSupportedVersions", supportedVersions)}
              </p>
            </div>
            <div className="space-y-2">
              {inputMode !== "extracted" && (
                <>
                  <label className="flex items-start gap-2 text-sm">
                    <input
                      type="checkbox"
                      className="mt-1"
                      checked={!skipContentHashes}
                      aria-describedby="verify-content-hashes-help"
                      disabled={hasSelectedFolder || busy || generating || download !== null}
                      onChange={(event) => {
                        if (
                          operationGate.current.busy ||
                          hasSelectedFolder ||
                          busy ||
                          generating ||
                          download !== null
                        )
                          return;
                        const url = new URL(window.location.href);
                        if (event.target.checked) url.searchParams.set("skipContentHashes", "0");
                        else url.searchParams.delete("skipContentHashes");
                        window.location.assign(url.href);
                      }}
                    />
                    {t("dmWebVerifyHashOption")}
                  </label>
                  <p id="verify-content-hashes-help" className="text-xs text-muted-foreground">
                    {t("dmWebVerifyHashHelp")}
                  </p>
                </>
              )}
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={legacyAstc}
                  aria-describedby="legacy-option-help"
                  disabled={hasSelectedFolder || busy || generating || download !== null}
                  onChange={(event) => {
                    if (
                      operationGate.current.busy ||
                      hasSelectedFolder ||
                      busy ||
                      generating ||
                      download !== null
                    )
                      return;
                    // 在接触私有输入前重载，确保可选资源已预加载。
                    // Reload before private inputs so optional resources are preloaded.
                    const url = new URL(window.location.href);
                    if (event.target.checked) url.searchParams.set("legacyAstc", "1");
                    else url.searchParams.delete("legacyAstc");
                    window.location.assign(url.href);
                  }}
                />
                {t("dmWebLegacyOption")}
              </label>
              <p id="legacy-option-help" className="text-xs text-muted-foreground">
                {t("dmWebLegacyHelp")}
              </p>
              {legacyAstc && (
                <div className="space-y-2">
                  <label htmlFor="astc-preset" className="text-sm font-medium">
                    {t("dmWebAstcPreset")}
                  </label>
                  <select
                    id="astc-preset"
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm disabled:cursor-not-allowed disabled:opacity-50"
                    value={astcPreset}
                    aria-describedby="astc-preset-help"
                    disabled={hasSelectedFolder || busy || generating || download !== null}
                    onChange={(event) => {
                      if (
                        operationGate.current.busy ||
                        hasSelectedFolder ||
                        busy ||
                        generating ||
                        download !== null
                      )
                        return;
                      // 在选择私有输入前重载，使预设在整个作业期间保持固定。
                      // Reload before private input selection so the preset stays fixed for the entire job.
                      const url = new URL(window.location.href);
                      if (event.target.value === "fast") url.searchParams.set("astcPreset", "fast");
                      else url.searchParams.delete("astcPreset");
                      window.location.assign(url.href);
                    }}
                  >
                    <option value="thorough">{t("dmWebAstcThorough")}</option>
                    <option value="fast">{t("dmWebAstcFast")}</option>
                  </select>
                  <p id="astc-preset-help" className="text-xs text-muted-foreground">
                    {t("dmWebAstcPresetHelp")}
                  </p>
                </div>
              )}
            </div>
            {folder && (
              <div className="space-y-2">
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={skipResources}
                    disabled={!ready || busy}
                    aria-describedby={skipResources ? "skip-resources-help" : undefined}
                    onChange={(event) => {
                      if (operationGate.current.busy) return;
                      setSkipResources(event.target.checked);
                    }}
                  />
                  {t("dmWebSkipResources")}
                </label>
                {skipResources && (
                  <p id="skip-resources-help" className="text-xs text-muted-foreground">
                    {t(
                      inputMode === "extracted"
                        ? "dmWebExtractedSkipResourcesHelp"
                        : "dmWebSkipResourcesHelp",
                    )}
                    {legacyAstc ? ` ${t("dmWebSkipKeepsLegacy")}` : ""}
                  </p>
                )}
              </div>
            )}
          </details>
          <details
            className="space-y-2 rounded-md border p-3"
            open={signing || signingRetryAvailable}
          >
            <summary className="cursor-pointer text-sm font-medium">
              {t("dmWebSigningOptions")}
            </summary>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={signing}
                disabled={hasSelectedFolder || busy || generating || download !== null}
                onChange={(event) => {
                  if (
                    operationGate.current.busy ||
                    hasSelectedFolder ||
                    busy ||
                    generating ||
                    download !== null
                  )
                    return;
                  const url = new URL(window.location.href);
                  if (event.target.checked) url.searchParams.set("signing", "1");
                  else url.searchParams.delete("signing");
                  window.location.assign(url.href);
                }}
              />
              {t("dmWebSigningOption")}
            </label>
            <p className="text-xs text-muted-foreground">{t("dmWebSigningHelp")}</p>
            {signing && (
              <fieldset
                className="space-y-2 rounded-md border p-3"
                disabled={!signingReady || (!ready && !signingRetryAvailable) || busy}
              >
                <legend className="px-1 text-sm">{t("dmWebSigningCredentials")}</legend>
                <label className="block text-sm">
                  {t("dmWebSigningIdentity")}
                  <input
                    ref={identityInput}
                    type="file"
                    accept=".p12,.pfx"
                    className="block w-full text-sm"
                    onChange={() => {
                      if (!operationGate.current.busy)
                        setCredentialsSelected(
                          Boolean(
                            identityInput.current?.files?.[0] && profileInput.current?.files?.[0],
                          ),
                        );
                    }}
                  />
                </label>
                <label className="block text-sm">
                  {t("dmWebSigningPassword")}
                  <input
                    ref={passwordInput}
                    type="password"
                    autoComplete="off"
                    maxLength={IPA_SIGNING_LIMITS.passwordCharacters}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  />
                </label>
                <label className="block text-sm">
                  {t("dmWebSigningProfile")}
                  <input
                    ref={profileInput}
                    type="file"
                    accept=".mobileprovision"
                    className="block w-full text-sm"
                    onChange={() => {
                      if (!operationGate.current.busy)
                        setCredentialsSelected(
                          Boolean(
                            identityInput.current?.files?.[0] && profileInput.current?.files?.[0],
                          ),
                        );
                    }}
                  />
                </label>
              </fieldset>
            )}
          </details>
          <AppCustomizationFields
            value={appCustomization}
            disabled={!ready || busy || finished || download !== null}
            error={customizationValidation.error || customizationError}
            onChange={(value) => {
              if (operationGate.current.busy || !ready || busy || finished || download !== null)
                return;
              setAppCustomization(value);
              setCustomizationError("");
            }}
          />
          {storageAdvisory && <p className="text-xs text-muted-foreground">{storageAdvisory}</p>}
          <details className="space-y-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t("dmWebLogCount", activity.length)}</summary>
            <p>{t("dmWebLogHelp")}</p>
            <ol className="max-h-64 overflow-auto break-words space-y-1" aria-label={t("dmWebLog")}>
              {activity.map((line) => (
                <li key={line.id}>{line.text}</li>
              ))}
            </ol>
            <Button
              variant="outline"
              size="sm"
              onClick={async () => {
                const request = ++copyRequest.current;
                const revision = activityRevision.current;
                copiedActivityRevision.current = revision;
                setCopyStatus("");
                try {
                  await navigator.clipboard.writeText(
                    activityBuffer.current.map((line) => line.text).join("\n"),
                  );
                  if (!mounted.current || request !== copyRequest.current) return;
                  setCopyStatus(
                    revision === activityRevision.current ? t("dmWebCopied") : t("dmWebCopiedNew"),
                  );
                } catch {
                  if (mounted.current && request === copyRequest.current) {
                    setCopyStatus(t("dmWebCopyFailed"));
                  }
                }
              }}
            >
              {t("dmWebCopy")}
            </Button>
            {copyStatus && <p role="status">{copyStatus}</p>}
          </details>
          {loading && !loadFailed && (
            <div className="space-y-2 text-xs text-muted-foreground">
              {loading.phase === "download" && loading.totalBytes > 0 ? (
                <>
                  <progress
                    className="h-2 w-full accent-primary"
                    aria-label={t("dmWebFilesLoaded")}
                    value={loading.loadedBytes}
                    max={loading.totalBytes}
                  />
                  <p>
                    {t(
                      "dmWebFilesReady",
                      megabytes(loading.loadedBytes),
                      megabytes(loading.totalBytes),
                      loading.completedFiles,
                      loading.totalFiles,
                    )}
                  </p>
                  <p>
                    {t("dmWebDownloaded", megabytes(loading.downloadedBytes))}
                    {loading.cachedBytes > 0
                      ? t("dmWebCached", megabytes(loading.cachedBytes))
                      : ""}
                  </p>
                </>
              ) : (
                <progress
                  className="h-2 w-full accent-primary"
                  aria-label={loadingLabel(loading.phase)}
                />
              )}
            </div>
          )}
          {(loadFailed || finished) && (
            <Button variant="outline" onClick={() => window.location.reload()}>
              {loadFailed ? t("dmWebReloadRetry") : t("dmWebReload")}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">{t("dmWebPrivacy")}</p>
        </CardContent>
      </Card>
    </main>
  );
}
