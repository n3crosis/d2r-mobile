// 浏览器本地打包界面：依据打包进度协议与共享多语文字表。
// Local browser packaging UI based on the packaging progress protocol and shared multilingual table.
import { t, browserLanguage } from "../i18n.mjs";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prepareBrowserPackager } from "../browser-packager.mjs";
import { discoverNspFolder } from "../nsp-input.mjs";
import {
  packagingActivity,
  packagingFailureMessage,
  packagingFailureSummary,
  resourceProgressLabel,
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
type FolderProgress = {
  nspCount: number;
  prodKeysFound: boolean;
  titleKeysFound: boolean;
};
type RomfsProgress = { phase: "base" | "merged"; percent: number };
const folderSummary = (progress: FolderProgress) =>
  t(
    "dmWebFolderSummary",
    progress.nspCount,
    t(progress.prodKeysFound ? "dmWebFound" : "dmWebMissing"),
    t(progress.titleKeysFound ? "dmWebFoundOptional" : "dmWebNotProvided"),
  );
const megabytes = (bytes: number) => t("dmWebMegabytes", (bytes / 1_000_000).toFixed(1));
const loadingLabel = (phase: string) =>
  t(phase === "download" ? "dmWebDownloading" : "dmWebPreparing");
export default function App() {
  useEffect(() => {
    document.documentElement.lang = browserLanguage();
    document.title = t("dmWebTitle");
  }, []);
  const [activity, setActivity] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState("");
  const lastActivity = useRef("");
  const activityBuffer = useRef<string[]>([]);
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
  const [selectedNsps, setSelectedNsps] = useState<Set<string>>(() => new Set());
  const [download, setDownload] = useState<{ url: string; fileName: string } | null>(null);
  const [finished, setFinished] = useState(false);
  const downloadUrl = useRef<string | null>(null);
  const mounted = useRef(true);
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
        activityBuffer.current.push(`${new Date().toLocaleString()} ${text}`);
        if (activityBuffer.current.length > 200) activityBuffer.current.shift();
        activityRevision.current += 1;
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
      cancellation.current?.abort();
      packager.current?.close();
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
    };
  }, [appendActivity]);
  async function choose() {
    if (!ready || busy || !browser.showDirectoryPicker) return;
    const previousStatus = status;
    const controller = new AbortController();
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
      selectedName = selected.name;
      setFolder(null);
      setNspNames([]);
      setSelectedNsps(new Set());
      setStatus(t("dmWebChecking", selected.name));
      const files = await discoverNspFolder(selected, {
        signal: controller.signal,
        onProgress: (event: FolderProgress) => {
          if (controller.signal.aborted || !mounted.current) return;
          progress = event;
          setStatus(t("dmWebCheckingProgress", selected.name, folderSummary(event)));
        },
      });
      const names = files.nsps.map((file) => file.name);
      const base = names.filter((name) => /\[0100726014352000\]/iu.test(name));
      const updates = names.filter((name) => /\[0100726014352800\]/iu.test(name));
      const selectedNames = base.length === 1 && updates.length > 0 ? [...base, ...updates] : names;
      setNspNames(names);
      setSelectedNsps(new Set(selectedNames));
      setFolder(selected);
      appendActivity(
        t(
          "dmWebFolderChecked",
          progress.nspCount,
          t(progress.titleKeysFound ? "dmWebProvided" : "dmWebNotProvided"),
        ),
        true,
      );
      setStatus(t("dmWebReviewSelection", selected.name, folderSummary(progress)));
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus(controller.signal.aborted ? t("dmWebCancelledReload") : previousStatus);
      } else {
        setFolder(null);
        setNspNames([]);
        setSelectedNsps(new Set());
        appendActivity(t("dmWebFolderFailed"), true);
        const code = (error as { code?: string })?.code;
        const permissionError =
          error instanceof DOMException &&
          ["NotAllowedError", "SecurityError"].includes(error.name);
        const reason =
          code === "MISSING_INPUT"
            ? t("dmWebMissingInput")
            : permissionError
              ? t("dmWebFolderPermission")
              : t("dmWebFolderUnreadable");
        setStatus(`${selectedName ? `${selectedName}: ${folderSummary(progress)} ` : ""}${reason}`);
      }
    } finally {
      setBusy(false);
      setCancelling(false);
      if (controller.signal.aborted && mounted.current) setFinished(true);
    }
  }
  async function generate() {
    if (!ready || busy || !folder || !packager.current || !selectedNsps.size) return;
    setBusy(true);
    setGenerating(true);
    setCancelling(false);
    pendingRomfsProgress.current = undefined;
    setRomfsProgress(null);
    setReady(false);
    setStatus(t("dmWebStarting"));
    appendActivity(t("dmWebGenerationStarted"), true);
    appendActivity(t("dmWebFastMode"), true);
    let acceptingProgress = true;
    try {
      const controller = new AbortController();
      cancellation.current = controller;
      const result = await packager.current.generate({
        input: folder,
        selectedNspNames: [...selectedNsps],
        signal: controller.signal,
        onProgress: (event: {
          label?: string;
          stage?: string;
          state?: string;
          diagnostic?: { stage?: string; completed?: number };
          resourceProgress?: {
            filesWritten: number;
            totalFiles: number;
            bytesWritten: number;
            totalBytes: number;
          };
        }) => {
          if (!acceptingProgress || controller.signal.aborted || !mounted.current) return;
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
      if (!mounted.current) return;
      const url = URL.createObjectURL(result.download.blob);
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = url;
      setDownload({ url, fileName: result.download.fileName });
      appendActivity(t("dmWebUnsignedReady"), true);
      setStatus(t("dmWebDownloadReady", folder.name, result.resources.directoryName));
      // 某些浏览器会阻止长时间异步操作后发起的下载。
      // 在可见的下载 IPA 链接中保留相同 URL 以供重试。
      // Some browsers suppress downloads initiated after lengthy async work.
      // Keep the same URL available in the visible Download IPA link for retry.
      const link = document.createElement("a");
      link.href = url;
      link.download = result.download.fileName;
      try {
        document.body.append(link);
        link.click();
      } catch {
        // 即使自动启动失败，可见链接仍然可用。
        // The visible link remains usable even if automatic initiation fails.
      } finally {
        link.remove();
      }
    } catch (error) {
      const report = (
        error as {
          report?: { stage?: string; code?: string; detailCode?: string; outputStarted?: boolean };
        }
      )?.report;
      appendActivity(packagingFailureSummary(report), true);
      setStatus(packagingFailureMessage(report));
    } finally {
      acceptingProgress = false;
      pendingGenerationStatus.current = null;
      pendingRomfsProgress.current = undefined;
      setRomfsProgress(null);
      setBusy(false);
      setGenerating(false);
      setCancelling(false);
      setFinished(true);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>{t("dmWebTitle")}</CardTitle>
          <CardDescription>{t("dmWebInstructions")}</CardDescription>
          <CardDescription>{t("dmWebCompatibility")}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => void choose()} disabled={!ready || busy}>
              {t("dmWebChoose")}
            </Button>
            <Button
              onClick={() => void generate()}
              disabled={!ready || !folder || !selectedNsps.size || busy}
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
          {nspNames.length > 0 && (
            <fieldset className="space-y-2 rounded-md border p-3" disabled={!ready || busy}>
              <legend className="px-1 text-sm font-medium">{t("dmWebPackages")}</legend>
              <p id="package-selection-help" className="text-xs text-muted-foreground">
                {t("dmWebSelectionHelp")}
              </p>
              {nspNames.map((name) => (
                <label key={name} className="flex items-start gap-2 text-sm break-all">
                  <input
                    type="checkbox"
                    className="mt-1"
                    aria-describedby="package-selection-help package-selection-count"
                    checked={selectedNsps.has(name)}
                    onChange={(event) => {
                      const checked = event.target.checked;
                      setSelectedNsps((current) => {
                        const next = new Set(current);
                        if (checked) next.add(name);
                        else next.delete(name);
                        return next;
                      });
                    }}
                  />
                  {name}
                </label>
              ))}
              <p
                id="package-selection-count"
                className="text-xs text-muted-foreground"
                role="status"
              >
                {t("dmWebSelectedCount", selectedNsps.size, nspNames.length)}
                {selectedNsps.size === 0 ? t("dmWebSelectOne") : ""}
              </p>
            </fieldset>
          )}
          {download && (
            <div className="space-y-2">
              <Button asChild>
                <a href={download.url} download={download.fileName}>
                  {t("dmWebDownload")}
                </a>
              </Button>
              <p className="text-xs text-muted-foreground">{t("dmWebDownloadHelp")}</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {status}
          </p>
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
          <details className="space-y-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">{t("dmWebLogCount", activity.length)}</summary>
            <p>{t("dmWebLogHelp")}</p>
            <ol className="max-h-64 overflow-auto break-words space-y-1" aria-label={t("dmWebLog")}>
              {activity.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
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
                  await navigator.clipboard.writeText(activityBuffer.current.join("\n"));
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
