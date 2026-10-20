import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prepareBrowserPackager } from "../browser-packager.mjs";
import { discoverNspFolder } from "../nsp-input.mjs";

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
  `${progress.nspCount} NSP file(s); prod.keys ${progress.prodKeysFound ? "found" : "missing"}; title.keys ${progress.titleKeysFound ? "found" : "missing"}.`;
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
export default function App() {
  const [loading, setLoading] = useState<LoadingProgress | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState("Loading application files…");
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
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
    void prepareBrowserPackager({
      manifestSha256: digest,
      signal: controller.signal,
      onProgress: (event: LoadingProgress) => {
        if (!controller.signal.aborted) {
          setLoading(event);
          setStatus(event.label);
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
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setLoadFailed(true);
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
  }, []);
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
    setStatus("Waiting for folder selection…");
    try {
      const selected = await browser.showDirectoryPicker({ mode: "readwrite" });
      controller.signal.throwIfAborted();
      selectedName = selected.name;
      setFolder(null);
      setStatus(`Checking ${selected.name}…`);
      await discoverNspFolder(selected, {
        signal: controller.signal,
        onProgress: (event: FolderProgress) => {
          progress = event;
          setStatus(`Checking ${selected.name}… ${folderSummary(event)}`);
        },
      });
      setFolder(selected);
      setStatus(`${selected.name}: ${folderSummary(progress)} Ready to generate.`);
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        if (!controller.signal.aborted) setStatus(previousStatus);
      } else {
        setFolder(null);
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
    }
  }
  async function generate() {
    if (!folder || !packager.current) return;
    setBusy(true);
    setReady(false);
    try {
      const controller = new AbortController();
      cancellation.current = controller;
      const result = await packager.current.generate({
        input: folder,
        signal: controller.signal,
        onProgress: (event: { label: string }) => setStatus(event.label),
      });
      if (!mounted.current) return;
      const url = URL.createObjectURL(result.download.blob);
      if (downloadUrl.current) URL.revokeObjectURL(downloadUrl.current);
      downloadUrl.current = url;
      setDownload({ url, fileName: result.download.fileName });
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
      const report = (error as { report?: { stage?: string; code?: string } })?.report;
      setStatus(
        report?.code === "CANCELLED"
          ? "Cancelled. Reload to start again."
          : `Could not finish${report?.stage ? ` (${report.stage})` : ""}. No completed IPA is available. Resources may already have been exported; check for a D2R-resources subfolder inside ${folder.name}. Reload to try again.`,
      );
    } finally {
      setBusy(false);
      setFinished(true);
    }
  }
  return (
    <main className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
      <Card className="w-full">
        <CardHeader>
          <CardTitle>D2R Mobile</CardTitle>
          <CardDescription>
            Put the base NSP, update NSP(s), prod.keys and title.keys in one folder. DLC is
            optional.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button variant="outline" onClick={() => void choose()} disabled={!ready || busy}>
              Choose folder
            </Button>
            <Button onClick={() => void generate()} disabled={!ready || !folder || busy}>
              Generate unsigned IPA
            </Button>
            {busy && (
              <Button
                variant="outline"
                onClick={() => {
                  setReady(false);
                  cancellation.current?.abort();
                  setStatus("Cancelled. Reload to start again.");
                }}
              >
                Cancel
              </Button>
            )}
          </div>
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
