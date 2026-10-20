import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { inspectNso, fileSource } from '../preflight.mjs'

type DirectoryPicker = (options: { mode: 'read' }) => Promise<FileSystemDirectoryHandle>
const picker = (globalThis as typeof globalThis & { showDirectoryPicker?: DirectoryPicker }).showDirectoryPicker?.bind(globalThis)
const canPick = globalThis.isSecureContext && typeof picker === 'function'

async function syntheticDemo(signal: AbortSignal) {
  const bytes = new Uint8Array(256), view = new DataView(bytes.buffer)
  let read = 0
  bytes.set([0x4e, 0x53, 0x4f, 0x30])
  for (let i = 0; i < 3; i++) {
    view.setUint32(0x10 + i * 16, 256 + i * 16, true)
    view.setUint32(0x14 + i * 16, i * 4096, true)
    view.setUint32(0x18 + i * 16, 16, true)
  }
  // Yield once so a pending cancellation can be handled without artificial progress.
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  signal.throwIfAborted()
  const result = await inspectNso({ size: 6 * 1024 ** 3, read: async (offset: number, length: number) => {
    read += length
    return bytes.slice(offset, offset + length)
  } }, signal)
  return `SYNTHETIC DEMO ONLY\nVirtual input: 6 GiB (not allocated)\nBytes requested: ${read}\nSegments described: ${result.segments.length}\nNo game data, uploads or output files.\nHeader structure passes. Supported game version: NOT verified.\nIPA generation: NOT implemented.`
}

async function localHeaders(signal: AbortSignal) {
  if (!picker) throw new Error('Directory selection is unavailable in this browser.')
  const root = await picker({ mode: 'read' })
  signal.throwIfAborted()
  const exefs = await root.getDirectoryHandle('ExeFS')
  const lines = ['LOCAL HEADER CHECK ONLY']
  for (const name of ['main', 'sdk', 'subsdk0']) {
    signal.throwIfAborted()
    const handle = await exefs.getFileHandle(name), file = await handle.getFile()
    const header = await inspectNso(fileSource(file), signal)
    lines.push(`${name}: header structure passes; module ID ${header.moduleId}`)
  }
  lines.push('Read 768 bytes total. Bulk resource files were not opened.',
    'Game version, content hashes and patch compatibility: NOT verified.',
    'No conversion, uploads or output files. IPA generation is NOT implemented.')
  return lines.join('\n')
}

export default function App() {
  const active = useRef<AbortController | null>(null)
  const [busy, setBusy] = useState(false)
  const [output, setOutput] = useState('Ready. No files selected.')
  const [failed, setFailed] = useState(false)
  useEffect(() => () => active.current?.abort(), [])

  async function run(task: (signal: AbortSignal) => Promise<string>) {
    if (active.current) return
    const controller = new AbortController()
    active.current = controller
    setBusy(true)
    setFailed(false)
    setOutput('Working locally…')
    try { setOutput(await task(controller.signal)) }
    catch (error) {
      const cancelled = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError')
      setFailed(!cancelled)
      setOutput(cancelled ? 'Cancelled. No files were written.' : `Stopped: ${error instanceof Error ? error.message : String(error)}`)
    } finally { active.current = null; setBusy(false) }
  }

  return <main className="mx-auto max-w-4xl space-y-8 px-6 py-12 sm:py-16">
    <header className="space-y-4">
      <p className="text-sm font-medium tracking-widest text-muted-foreground">D2R MOBILE · DEVELOPMENT PREVIEW</p>
      <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">Prepare locally.<br />Keep your files yours.</h1>
      <p className="max-w-2xl text-lg text-muted-foreground">A browser-based unsigned IPA packager for Windows and Mac is the goal. This preview is only a read-only preflight check.</p>
    </header>
    <Alert>
      <AlertTitle>Preflight only, not an IPA builder yet</AlertTitle>
      <AlertDescription>This preview does not convert files, verify a supported game version, create an IPA, or prove the game works.</AlertDescription>
    </Alert>
    <Card>
      <CardHeader>
        <CardTitle>Start without game data</CardTitle>
        <CardDescription>The synthetic demo uses a tiny generated header and a virtual 6 GiB file. No game content is included or downloaded.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-3">
          <Button disabled={busy} onClick={() => void run(syntheticDemo)}>Run synthetic demo</Button>
          <Button variant="outline" disabled={busy || !canPick} onClick={() => void run(localHeaders)}>Select local game folder</Button>
          <Button variant="secondary" disabled={!busy} onClick={() => active.current?.abort()}>Cancel</Button>
        </div>
        <p className="text-sm text-muted-foreground">{canPick
          ? 'Local folder access available. Direct-to-disk IPA output is planned, not implemented.'
          : 'Folder selection needs a supporting desktop Chromium browser and HTTPS or localhost. The synthetic demo is still available.'}</p>
        <p className="text-sm text-muted-foreground">Optional folder check: select the folder containing ExeFS. Only 256 bytes each from main, sdk and subsdk0 are read. Bulk RomFS archives are not opened. Close the browser’s folder dialog to cancel selection; Cancel stops subsequent reads.</p>
      </CardContent>
    </Card>
    <Card>
      <CardHeader><CardTitle>Results</CardTitle></CardHeader>
      <CardContent>
        <pre role="status" aria-live="polite" aria-atomic="true" aria-busy={busy}
          className={`overflow-x-auto whitespace-pre-wrap break-all rounded-md bg-muted p-4 font-mono text-sm ${failed ? 'text-destructive' : 'text-foreground'}`}>{output}</pre>
      </CardContent>
    </Card>
    <section className="space-y-3 text-sm text-muted-foreground" aria-labelledby="workflow">
      <h2 id="workflow" className="text-lg font-semibold text-foreground">The intended finished workflow</h2>
      <ol className="list-decimal space-y-2 pl-5">
        <li>Select your own game folder and a compatible shell.</li>
        <li>Validate versions and generate the missing program, art, data and shaders locally.</li>
        <li>Save an IPA to disk, then sign and install it with your chosen tool.</li>
        <li>Copy the large resource archives to the installed app separately.</li>
      </ol>
      <p>No account credentials, signing keys or uploads. The production preview blocks network connections after loading its own assets. Desktop Chromium on Windows/macOS is the initial target; API availability is checked rather than assumed.</p>
    </section>
  </main>
}
