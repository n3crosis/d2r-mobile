import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { prepareBrowserPackager } from "../browser-packager.mjs";
import { discoverNspFolder } from "../nsp-input.mjs";

type LocalPickers = typeof globalThis & {
  showDirectoryPicker?: (options: { mode: "read" }) => Promise<FileSystemDirectoryHandle>;
  showSaveFilePicker?: (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }) => Promise<FileSystemFileHandle>;
};
const browser = globalThis as LocalPickers;
type Packager = Awaited<ReturnType<typeof prepareBrowserPackager>>;
export default function App() {
  const [status, setStatus] = useState("Loading application files…");
  const [ready, setReady] = useState(false),
    [busy, setBusy] = useState(false);
  const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
  const packager = useRef<Packager | null>(null),
    cancellation = useRef<AbortController | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    cancellation.current = controller;
    const digest = document.querySelector<HTMLMetaElement>(
      'meta[name="runtime-manifest-sha256"]',
    )?.content;
    if (
      !browser.showDirectoryPicker ||
      !browser.showSaveFilePicker ||
      !digest ||
      !/^[a-f0-9]{64}$/.test(digest)
    ) {
      setStatus(
        "This build is not ready, or this browser is unsupported. Use desktop Chrome or Edge.",
      );
      return;
    }
    void prepareBrowserPackager({ manifestSha256: digest, signal: controller.signal })
      .then((value) => {
        if (controller.signal.aborted) {
          value.close();
          return;
        }
        packager.current = value;
        setReady(true);
        setStatus("Ready. Files stay on this device.");
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setStatus("Application files could not be prepared. Reload to try again.");
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
  async function generate() {
    if (!folder || !packager.current || !browser.showSaveFilePicker) return;
    try {
      const destinationHandle = await browser.showSaveFilePicker({
        suggestedName: "D2RMobile-unsigned.ipa",
        types: [{ description: "Unsigned IPA", accept: { "application/octet-stream": [".ipa"] } }],
      });
      setBusy(true);
      setReady(false);
      const controller = new AbortController();
      cancellation.current = controller;
      await packager.current.generate({
        input: folder,
        destinationHandle,
        signal: controller.signal,
        onProgress: (event: { label: string }) => setStatus(event.label),
      });
      setStatus(
        "Unsigned IPA saved. Game compatibility has not been verified. Reload to make another.",
      );
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      const report = (error as { report?: { stage?: string; code?: string } })?.report;
      setStatus(
        report?.code === "CANCELLED"
          ? "Cancelled. Reload to start again."
          : `Could not finish${report?.stage ? ` (${report.stage})` : ""}. No completed IPA was saved. Reload to try again.`,
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
            Put all NSP files, prod.keys and title.keys in one folder.
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
              <Button variant="outline" onClick={() => cancellation.current?.abort()}>
                Cancel
              </Button>
            )}
          </div>
          <p className="text-sm text-muted-foreground" role="status" aria-live="polite">
            {status}
          </p>
          <p className="text-xs text-muted-foreground">
            Unsigned output. Game resources remain separate.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
