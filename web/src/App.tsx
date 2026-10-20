import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  const totalNspBytes = files.nsps.reduce(
    (total: bigint, file: File) => total + BigInt(file.size),
    0n,
  );
  return [
    "FOLDER LAYOUT CHECK ONLY",
    `Found ${files.nsps.length} NSP file(s) at the folder root (${totalNspBytes.toLocaleString()} bytes total).`,
    "Found prod.keys and title.keys at the folder root.",
    "Expected filenames are present. No file contents were read or validated.",
    "Base/update/DLC roles, key validity and supported game version: NOT verified.",
    "Conversion pipeline not ready. No IPA or other output was created.",
    "No uploads. This app does not store folder handles. Re-select the folder to check again.",
  ].join("\n");
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
  const [output, setOutput] = useState("Ready. No files selected.");
  const [failed, setFailed] = useState(false);
  useEffect(() => () => active.current?.abort(), []);

  async function run(task: (signal: AbortSignal) => Promise<string>, exporting = false) {
    if (active.current) return;
    const controller = new AbortController();
    active.current = controller;
    setBusy(true);
    setFailed(false);
    setOutput("Working locally…");
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
    <main className="mx-auto max-w-4xl space-y-8 px-6 py-12 sm:py-16">
      <header className="space-y-4">
        <p className="text-sm font-medium tracking-widest text-muted-foreground">
          D2R MOBILE · DEVELOPMENT PREVIEW
        </p>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          One folder.
          <br />
          Your files stay local.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Put your NSP files, prod.keys and title.keys together, then select that folder once. This
          preview checks the folder layout only. An unsigned IPA is the goal, not an available
          output yet.
        </p>
      </header>
      <Alert>
        <AlertTitle>Conversion pipeline not ready</AlertTitle>
        <AlertDescription>
          Finding the expected filenames does not validate keys, identify base/update/DLC content,
          confirm a supported game version or prove compatibility. This preview cannot decrypt or
          convert your NSPs, create an IPA, or run the game.
        </AlertDescription>
      </Alert>
      <Card>
        <CardHeader>
          <CardTitle>1. Put everything in one folder</CardTitle>
          <CardDescription>
            Use files you own and are authorized to use. Keep the original files unchanged.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <ol className="list-decimal space-y-3 pl-5 text-sm">
            <li>Create a folder on your computer, for example “D2R input”.</li>
            <li>
              Put your base-game .nsp directly inside it. If you have separate update or DLC NSPs,
              put those in the same folder too. You can include multiple NSPs; do not unpack them or
              put them in nested folders for this check.
            </li>
            <li>
              Add both key files directly inside that folder, named exactly prod.keys and
              title.keys. Make sure hidden extensions have not changed the names to prod.keys.txt or
              title.keys.txt. Do not paste key contents here or upload them to a chat.
            </li>
            <li>
              Choose “Select input folder” below and select the folder itself, not an individual
              file. The browser asks for read-only access to that folder.
            </li>
          </ol>
          <div
            className="rounded-md bg-muted p-4 font-mono text-sm"
            aria-label="Example folder contents"
          >
            <p>D2R input/</p>
            <ul className="space-y-1 pl-4">
              <li>base-game.nsp</li>
              <li>update.nsp (if you have one)</li>
              <li>dlc.nsp (if you have one)</li>
              <li>prod.keys</li>
              <li>title.keys</li>
            </ul>
          </div>
          <p className="text-sm text-muted-foreground">
            NSP names above are examples, not required names. Base, update and DLC roles cannot be
            determined from filenames alone. An update or DLC does not replace the base game; this
            preview cannot confirm that a base game is present or which titles are supported.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>2. Check your folder</CardTitle>
          <CardDescription>
            One selection, a metadata-only check. No file contents are read, uploaded or saved by
            this check.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Button disabled={busy || !canPick} onClick={() => void run(localInputs)}>
              Select input folder
            </Button>
            <Button variant="secondary" disabled={!busy} onClick={() => active.current?.abort()}>
              Cancel
            </Button>
            <Button variant="outline" disabled title="The conversion pipeline is not implemented.">
              Generate unsigned IPA · not available
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            {canPick
              ? "Select the folder containing your NSP(s), prod.keys and title.keys. Close the folder dialog to cancel selection; Cancel stops the subsequent check."
              : "Folder selection needs a supporting desktop Chromium browser and HTTPS or localhost. Open this page in a recent Chrome or Edge desktop browser; the synthetic preview below is still available without any files."}
          </p>
          <p className="text-sm text-muted-foreground">
            No ExeFS extraction, shell selection or separate file-by-file picking is required for
            this folder check. Re-select the folder to check again after changing its contents.
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>Results</CardTitle>
        </CardHeader>
        <CardContent>
          <pre
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-busy={busy}
            className={`overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-4 font-mono text-sm ${failed ? "text-destructive" : "text-foreground"}`}
          >
            {output}
          </pre>
        </CardContent>
      </Card>
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
              Test ZIP export needs the File System Access save API in a supporting desktop Chromium
              browser over HTTPS or localhost.
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
      <footer className="space-y-2 text-sm text-muted-foreground">
        <p>
          Current stage: local input preparation and developer checks. Real NSP processing,
          supported-version verification, conversion and unsigned IPA packaging are not implemented.
        </p>
        <p>
          No uploads, accounts or signing credentials. The production preview blocks network
          connections after loading its own assets. Folder and file handles are not persisted.
        </p>
      </footer>
    </main>
  );
}
