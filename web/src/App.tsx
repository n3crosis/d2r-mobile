import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prepareBrowserPackager } from "../browser-packager.mjs";
import { discoverNspFolder } from "../nsp-input.mjs";
import {
  packagingActivity,
  packagingFailureMessage,
  packagingFailureSummary,
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
const folderSummary = (progress: FolderProgress) =>
  `${progress.nspCount} NSP file(s); prod.keys ${progress.prodKeysFound ? "found" : "missing"}; title.keys ${progress.titleKeysFound ? "found (optional)" : "not provided (optional)"}.`;
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
export default function App() {
  const [activity, setActivity] = useState<string[]>([]);
  const [copyStatus, setCopyStatus] = useState("");
  const lastActivity = useRef("");
  const appendActivity = useCallback((text: string | null, force = false) => {
    if (!text) return;
    if (!force && text === lastActivity.current) return;
    lastActivity.current = text;
    const line = `${new Date().toISOString()} ${text}`;
    setActivity((previous) => [...previous, line].slice(-200));
  }, []);
  const [loading, setLoading] = useState<LoadingProgress | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState("Loading application files…");
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [nspNames, setNspNames] = useState<string[]>([]);
  const [selectedNsps, setSelectedNsps] = useState<Set<string>>(() => new Set());
  const [download, setDownload] = useState<{ url: string; fileName: string } | null>(null);
  const [finished, setFinished] = useState(false);
  const downloadUrl = useRef<string | null>(null);
  const mounted = useRef(true);
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
      setStatus(
        "This build is not ready, or this browser is unsupported. Use desktop Chrome or Edge.",
      );
      return;
    }
    appendActivity("Loading verified application files", true);
    appendActivity(`Runtime manifest: ${digest}`, true);
    let previousPhase = "";
    void prepareBrowserPackager({
      manifestSha256: digest,
      signal: controller.signal,
      onProgress: (event: LoadingProgress) => {
        if (!controller.signal.aborted) {
          setLoading(event);
          setStatus(event.label);
          if (event.phase !== previousPhase) {
            previousPhase = event.phase;
            appendActivity(
              event.phase === "download"
                ? "Downloading application files"
                : "Preparing isolated application runtimes",
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
        setStatus("Ready. Files stay on this device.");
        appendActivity("Application ready", true);
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadFailed(true);
          appendActivity("Application setup failed before local inputs were opened", true);
          setStatus(
            `Application setup failed: ${String(error instanceof Error ? error.message : error).slice(0, 1400)}. Reload to retry. No game files have been opened.`,
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
    setStatus("Waiting for folder selection…");
    try {
      const selected = await browser.showDirectoryPicker({ mode: "readwrite" });
      controller.signal.throwIfAborted();
      selectedName = selected.name;
      setFolder(null);
      setNspNames([]);
      setSelectedNsps(new Set());
      setStatus(`Checking ${selected.name}…`);
      const files = await discoverNspFolder(selected, {
        signal: controller.signal,
        onProgress: (event: FolderProgress) => {
          if (controller.signal.aborted || !mounted.current) return;
          progress = event;
          setStatus(`Checking ${selected.name}… ${folderSummary(event)}`);
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
        `Folder checked: ${progress.nspCount} NSP files; prod.keys found; title.keys ${progress.titleKeysFound ? "provided" : "not provided (optional)"}`,
        true,
      );
      setStatus(
        `${selected.name}: ${folderSummary(progress)} Review the package selection before generating.`,
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setStatus(controller.signal.aborted ? "Cancelled. Reload to start again." : previousStatus);
      } else {
        setFolder(null);
        setNspNames([]);
        setSelectedNsps(new Set());
        appendActivity("Folder check failed; check the status message", true);
        const code = (error as { code?: string })?.code;
        const permissionError =
          error instanceof DOMException &&
          ["NotAllowedError", "SecurityError"].includes(error.name);
        const reason =
          code === "MISSING_INPUT"
            ? "Put the missing files directly inside this folder, not in a subfolder."
            : permissionError
              ? "Choose the folder again and allow access to read inputs and save the resource subfolder."
              : code && error instanceof Error
                ? error.message
                : "The folder could not be read. Check access and choose it again.";
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
    setReady(false);
    setStatus("Starting IPA generation…");
    appendActivity("Generation started; private inputs remain local", true);
    try {
      const controller = new AbortController();
      cancellation.current = controller;
      const result = await packager.current.generate({
        input: folder,
        selectedNspNames: [...selectedNsps],
        signal: controller.signal,
        onProgress: (event: { label: string; stage?: string; state?: string }) => {
          if (controller.signal.aborted || !mounted.current) return;
          setStatus(event.label);
          appendActivity(packagingActivity(event), event.state === "failed");
        },
      });
      if (!mounted.current) return;
      const url = URL.createObjectURL(result.download.blob);
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = url;
      setDownload({ url, fileName: result.download.fileName });
      appendActivity("Unsigned IPA ready; resources saved locally", true);
      setStatus(
        `IPA ready to download. Resources saved in ${folder.name}/${result.resources.directoryName}. Copy that resource folder into the app’s Files folder after signing and installing the IPA. Game compatibility is not yet verified.`,
      );
      // Some browsers suppress downloads initiated after lengthy async work.
      // Keep the same URL available in the visible Download IPA link for retry.
      const link = document.createElement("a");
      link.href = url;
      link.download = result.download.fileName;
      try {
        document.body.append(link);
        link.click();
      } catch {
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
          <CardTitle>D2R Mobile</CardTitle>
          <CardDescription>
            Put the base NSP, update NSP(s), and prod.keys in one folder. DLC and title.keys are
            optional; some rights-managed packages need matching title keys.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => void choose()} disabled={!ready || busy}>
              Choose folder
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
              {generating ? "Generating IPA…" : "Generate unsigned IPA"}
            </Button>
            {busy && (
              <Button
                variant="outline"
                disabled={cancelling}
                onClick={() => {
                  setReady(false);
                  setCancelling(true);
                  cancellation.current?.abort();
                  setStatus("Cancelling… Waiting for the current operation to stop.");
                  appendActivity("Cancellation requested", true);
                }}
              >
                {cancelling ? "Cancelling…" : "Cancel"}
              </Button>
            )}
          </div>
          {nspNames.length > 0 && (
            <fieldset className="space-y-2 rounded-md border p-3" disabled={!ready || busy}>
              <legend className="px-1 text-sm font-medium">Packages to use</legend>
              <p id="package-selection-help" className="text-xs text-muted-foreground">
                Base and updates are preselected when filenames identify one base and its updates;
                otherwise all packages are selected. Review your selection. Include DLC for Warlock
                content; excluded files stay untouched.
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
                {selectedNsps.size} of {nspNames.length} package(s) selected.
                {selectedNsps.size === 0 ? " Select at least one package to generate an IPA." : ""}
              </p>
            </fieldset>
          )}
          {download && (
            <div className="space-y-2">
              <Button asChild>
                <a href={download.url} download={download.fileName}>
                  Download IPA
                </a>
              </Button>
              <p className="text-xs text-muted-foreground">
                Your browser controls where the IPA is saved. If the download did not start, use
                this button.
              </p>
            </div>
          )}
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {status}
          </p>
          {generating && (
            <div className="space-y-2 rounded-md border bg-muted/50 p-3 text-sm">
              <p className="font-medium">
                {cancelling ? "Stopping generation" : "Generation in progress"}
              </p>
              <progress
                className="h-2 w-full accent-primary"
                aria-label={cancelling ? "Stopping IPA generation" : "IPA generation in progress"}
              />
              <p className="text-xs text-muted-foreground">
                {cancelling
                  ? "Waiting for cancellation and cleanup to finish."
                  : "Large packages can take several minutes to verify, even when the activity log is quiet."}
              </p>
            </div>
          )}
          <details className="space-y-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer">Activity log ({activity.length})</summary>
            <p>
              Only stages, counts and safe error codes. No key contents or selected filenames. Kept
              in this tab, not uploaded.
            </p>
            <ol className="max-h-64 overflow-auto break-words space-y-1" aria-label="Activity log">
              {activity.map((line, index) => (
                <li key={`${index}-${line}`}>{line}</li>
              ))}
            </ol>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void navigator.clipboard.writeText(activity.join("\n")).then(
                  () => setCopyStatus("Log copied."),
                  () => setCopyStatus("Copy failed. Select the log text and copy it manually."),
                );
              }}
            >
              Copy log
            </Button>
            {copyStatus && <p role="status">{copyStatus}</p>}
          </details>
          {loading && !loadFailed && (
            <div className="space-y-2 text-xs text-muted-foreground">
              {loading.phase === "download" && loading.totalBytes > 0 ? (
                <>
                  <progress
                    className="h-2 w-full accent-primary"
                    aria-label="Application files loaded"
                    value={loading.loadedBytes}
                    max={loading.totalBytes}
                  />
                  <p>
                    {megabytes(loading.loadedBytes)} / {megabytes(loading.totalBytes)} ·{" "}
                    {loading.completedFiles} / {loading.totalFiles} files ready
                  </p>
                  <p>
                    {megabytes(loading.downloadedBytes)} downloaded
                    {loading.cachedBytes > 0
                      ? ` · ${megabytes(loading.cachedBytes)} from cache`
                      : ""}
                  </p>
                </>
              ) : (
                <progress className="h-2 w-full accent-primary" aria-label={loading.label} />
              )}
            </div>
          )}
          {(loadFailed || finished) && (
            <Button variant="outline" onClick={() => window.location.reload()}>
              {loadFailed ? "Reload and retry" : "Reload to start again"}
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            The IPA downloads normally. Large game resources stream to a new subfolder inside your
            selected folder. Existing NSPs and keys are not changed. Files never leave this device.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
