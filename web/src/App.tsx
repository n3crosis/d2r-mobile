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
const megabytes = (bytes: number) => `${(bytes / 1_000_000).toFixed(1)} MB`;
export default function App() {
  const [loading, setLoading] = useState<LoadingProgress | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [status, setStatus] = useState("Loading application files…");
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const [outputFolder, setOutputFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const packager = useRef<Packager | null>(null),
    cancellation = useRef<AbortController | null>(null);
  useEffect(() => {
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
      controller.abort();
      packager.current?.close();
    };
  }, []);
  async function choose() {
    if (!ready || !browser.showDirectoryPicker) return;
    try {
      const selected = await browser.showDirectoryPicker({ mode: "read" });
      setBusy(true);
      const inputs = await discoverNspFolder(selected, { signal: cancellation.current?.signal });
      setFolder(selected);
      setStatus(`${inputs.nsps.length} NSP file(s) found with both key files.`);
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setStatus("Choose one folder containing the NSP files, prod.keys and title.keys.");
    } finally {
      setBusy(false);
    }
  }
  async function chooseOutput() {
    if (!ready || !browser.showDirectoryPicker) return;
    try {
      const selected = await browser.showDirectoryPicker({ mode: "readwrite" });
      if (
        folder &&
        ((await folder.resolve(selected)) !== null || (await selected.resolve(folder)) !== null)
      )
        throw new Error("OUTPUT_OVERLAP");
      setOutputFolder(selected);
      setStatus("Output folder selected. Use an empty folder with enough free space for the game.");
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError"))
        setStatus("Choose a separate empty output folder, outside the input folder.");
    }
  }
  async function generate() {
    if (!folder || !outputFolder || !packager.current) return;
    setBusy(true);
    setReady(false);
    try {
      const controller = new AbortController();
      cancellation.current = controller;
      const result = await packager.current.generate({
        input: folder,
        outputDirectoryHandle: outputFolder,
        signal: controller.signal,
        onProgress: (event: { label: string }) => setStatus(event.label),
      });
      setStatus(
        `Unsigned IPA and game resources saved. Copy ${result.resources.directoryName} into the app’s Files folder after signing and installing the IPA. Game compatibility is not yet verified.`,
      );
    } catch (error) {
      const report = (error as { report?: { stage?: string; code?: string } })?.report;
      setStatus(
        report?.code === "CANCELLED"
          ? "Cancelled. Reload to start again."
          : `Could not finish${report?.stage ? ` (${report.stage})` : ""}. No completed IPA was saved. Resources may already have been exported; check the output folder. Reload to try again.`,
      );
    } finally {
      setBusy(false);
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
            <Button variant="outline" onClick={() => void chooseOutput()} disabled={!ready || busy}>
              Choose output folder
            </Button>
            <Button
              onClick={() => void generate()}
              disabled={!ready || !folder || !outputFolder || busy}
            >
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
          {loadFailed && (
            <Button variant="outline" onClick={() => window.location.reload()}>
              Reload and retry
            </Button>
          )}
          <p className="text-xs text-muted-foreground">
            Unsigned IPA plus a separate game-resource folder. Files never leave this device.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
