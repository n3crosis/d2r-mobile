import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { exportSyntheticArchive, SYNTHETIC_FILENAME } from "../synthetic-export.mjs";
import { inspectNso, fileSource, REQUIRED_NSO_MODULES } from "../preflight.mjs";
import { discoverNspFolder } from "../nsp-input.mjs";

type DirectoryPicker = (options: { mode: "read" }) => Promise<FileSystemDirectoryHandle>;
const picker = (
  globalThis as typeof globalThis & { showDirectoryPicker?: DirectoryPicker }
).showDirectoryPicker?.bind(globalThis);
const canPick = globalThis.isSecureContext && typeof picker === "function";

type SavePicker = (options: {
  suggestedName: string;
  types: { description: string; accept: Record<string, string[]> }[];
}) => Promise<FileSystemFileHandle>;
const savePicker = (
  globalThis as typeof globalThis & { showSaveFilePicker?: SavePicker }
).showSaveFilePicker?.bind(globalThis);
const canSave = globalThis.isSecureContext && typeof savePicker === "function";
const debug = new URLSearchParams(globalThis.location.search).get("debug") === "1";

async function syntheticDemo(signal: AbortSignal) {
  const bytes = new Uint8Array(256),
    view = new DataView(bytes.buffer);
  let read = 0;
  bytes.set([0x4e, 0x53, 0x4f, 0x30]);
  for (let i = 0; i < 3; i++) {
    view.setUint32(0x10 + i * 16, 256 + i * 16, true);
    view.setUint32(0x14 + i * 16, i * 4096, true);
    view.setUint32(0x18 + i * 16, 16, true);
  }
  // Yield once so a pending cancellation can be handled without artificial progress.
  await new Promise<void>((resolve) => setTimeout(resolve, 0));
  signal.throwIfAborted();
  const result = await inspectNso(
    {
      size: 6 * 1024 ** 3,
      read: async (offset: number, length: number) => {
        read += length;
        return bytes.slice(offset, offset + length);
      },
    },
    signal,
  );
  return `SYNTHETIC DEMO ONLY\nVirtual input: 6 GiB (not allocated)\nBytes requested: ${read}\nSegments described: ${result.segments.length}\nNo game data, uploads or output files.\nHeader structure passes. Supported game version: NOT verified.\nIPA generation: NOT implemented.`;
}

async function localInputs(signal: AbortSignal) {
  if (!picker) throw new Error("Directory selection is unavailable in this browser.");
  // The picker is invoked directly from the click-triggered task, before any await.
  const root = await picker({ mode: "read" });
  signal.throwIfAborted();
  const files = await discoverNspFolder(root, { signal });
  signal.throwIfAborted();
  return `Found ${files.nsps.length} NSP file(s), prod.keys and title.keys. File contents haven’t been checked.`;
}

async function localHeaders(signal: AbortSignal) {
  if (!picker) throw new Error("Directory selection is unavailable in this browser.");
  const root = await picker({ mode: "read" });
  signal.throwIfAborted();
  const exefs = await root.getDirectoryHandle("ExeFS");
  const lines = ["LOCAL HEADER CHECK ONLY"];
  for (const name of REQUIRED_NSO_MODULES) {
    signal.throwIfAborted();
    const handle = await exefs.getFileHandle(name),
      file = await handle.getFile();
    const header = await inspectNso(fileSource(file), signal);
    lines.push(`${name}: header structure passes; module ID ${header.moduleId}`);
  }
  lines.push(
    "Read 512 bytes total. Bulk resource files were not opened.",
    "Game version, content hashes and patch compatibility: NOT verified.",
    "No conversion, uploads or output files. IPA generation is NOT implemented.",
  );
  return lines.join("\n");
}

export default function App() {
  const active = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [output, setOutput] = useState("No folder selected.");
  const [failed, setFailed] = useState(false);
  useEffect(() => () => active.current?.abort(), []);

  async function run(task: (signal: AbortSignal) => Promise<string>, exporting = false) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setFailed(false);
    setOutput("Working…");
    try {
      setOutput(await task(controller.signal));
    } catch (error) {
      const cancelled =
        controller.signal.aborted || (error instanceof Error && error.name === "AbortError");
      setFailed(!cancelled);
      setOutput(
        cancelled
          ? exporting
            ? "Export cancelled. Staged writes were aborted where possible; the save dialog may leave an empty file. No installable IPA was produced."
            : "Cancelled. No files were written."
          : `Stopped: ${error instanceof Error ? error.message : String(error)}${exporting ? "\nNo completed archive was confirmed. Discard any incomplete destination file." : ""}`,
      );
    } finally {
      active.current = null;
      setBusy(false);
    }
  }

  function startExport() {
    const chooseDestination = savePicker;
    if (active.current || !chooseDestination) return;
    void run(async (signal) => {
      // Invoke the picker synchronously in the click gesture, before any await.
      const selected = chooseDestination({
        suggestedName: SYNTHETIC_FILENAME,
        types: [
          {
            description: "Synthetic test ZIP (not installable)",
            accept: { "application/zip": [".zip"] },
          },
        ],
      });
      const handle = await selected;
      signal.throwIfAborted();
      if (!handle.name.toLowerCase().endsWith(".zip"))
        throw new Error("Choose a .zip filename. Synthetic output must never be saved as an IPA.");
      const sink = await handle.createWritable();
      // The exporter owns cleanup even if cancellation arrived while opening.
      const result = await exportSyntheticArchive(sink, {
        signal,
        onProgress: ({ phase, bytesWritten }: { phase: string; bytesWritten: number }) => {
          setOutput(
            phase === "generating"
              ? "Generating a synthetic Guest framework locally…"
              : phase === "finishing"
                ? `Finishing save: ${bytesWritten.toLocaleString()} ZIP bytes written. Cancellation cannot undo a committed save.`
                : `Saving synthetic ZIP: ${bytesWritten.toLocaleString()} bytes written…`,
          );
        },
      });
      return `SYNTHETIC TEST ZIP SAVED\n${handle.name}\n${result.entries} entries; ${result.bytesWritten.toLocaleString()} bytes.\nNOT INSTALLABLE. No game content. This is not an IPA.\nGenerated Guest framework and ZIP stream completed locally.`;
    }, true);
  }

  return (
    <main className="mx-auto max-w-xl space-y-6 px-6 py-12 sm:py-20">
      <header className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight">D2R Mobile</h1>
        <p className="text-muted-foreground">Your files, one folder.</p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle>Choose your game files</CardTitle>
          <CardDescription>Put these together in one folder:</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ul className="list-disc space-y-2 pl-5 text-sm">
            <li>Your base-game .nsp, plus any update or DLC .nsp files.</li>
            <li>prod.keys</li>
            <li>title.keys</li>
          </ul>
          <p className="text-sm text-muted-foreground">
            Keep them directly inside the folder, not in subfolders. Use the exact key filenames
            above, with no .txt extension. Select the folder once, not each file.
          </p>
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy || !canPick} onClick={() => void run(localInputs)}>
              Select folder
            </Button>
            {busy && (
              <Button variant="secondary" onClick={() => active.current?.abort()}>
                Cancel
              </Button>
            )}
            <Button variant="outline" disabled>
              Generate unsigned IPA
            </Button>
          </div>
          {!canPick && (
            <p className="text-sm text-muted-foreground">
              Open this page in Chrome or Edge on your computer to select a folder.
            </p>
          )}
          <p
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-busy={busy}
            className={`whitespace-pre-wrap break-words text-sm ${failed ? "text-destructive" : "text-muted-foreground"}`}
          >
            {output}
          </p>
          <p className="text-sm">IPA generation is still being built.</p>
        </CardContent>
      </Card>
      <p className="text-center text-sm text-muted-foreground">Files stay on your device.</p>
      {debug && (
        <Card>
          <CardHeader>
            <CardTitle>Explore without NSPs</CardTitle>
            <CardDescription>
              Optional developer checks. Synthetic samples contain no game data and are not part of
              the NSP-to-IPA conversion pipeline.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-wrap gap-3">
              <Button variant="outline" disabled={busy} onClick={() => void run(syntheticDemo)}>
                Run synthetic header demo
              </Button>
              <Button variant="outline" disabled={busy || !canSave} onClick={startExport}>
                Export synthetic test ZIP
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              The header demo uses a tiny generated header and a virtual 6 GiB file. The export
              generates tiny synthetic modules and streams a test Guest framework ZIP to disk. It is
              NOT INSTALLABLE and is not an IPA. Neither reads your selected input folder.
            </p>
            {!canSave && (
              <p className="text-sm text-muted-foreground">
                Test ZIP export needs the File System Access save API in a supporting desktop
                Chromium browser over HTTPS or localhost.
              </p>
            )}
            <details className="space-y-3 text-sm">
              <summary className="cursor-pointer font-medium">
                Advanced: extracted ExeFS header check
              </summary>
              <p className="text-muted-foreground">
                Separate from the main folder check. Select a folder containing ExeFS/main and
                ExeFS/sdk. This reads 256 bytes from each module, not bulk RomFS archives. Header
                structure alone does not verify game version, hashes or patch compatibility.
              </p>
              <Button
                variant="outline"
                disabled={busy || !canPick}
                onClick={() => void run(localHeaders)}
              >
                Select extracted ExeFS parent folder
              </Button>
            </details>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
