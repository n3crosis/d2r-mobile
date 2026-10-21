// Run the production packager against local inputs under Bun. No game files or
// keys are included in the repository or sent to the preview server.
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { basename, join, resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { gunzipSync } from "node:zlib";
import { prepareBrowserPackager } from "../browser-packager.mjs";
import { DirectoryHandle, storageAt } from "./bun-e2e-fs.mjs";

function usage() {
  throw new Error(
    "Usage: bun scripts/bun-e2e.mjs --preview-dir DIST --input-dir NSP_FOLDER " +
      "--nsp BASE.nsp --nsp UPDATE.nsp --output FILE.ipa [--export-resources]",
  );
}

function parseArgs(args) {
  const options = { nsps: [], exportResources: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--export-resources") options.exportResources = true;
    else if (["--preview-dir", "--input-dir", "--nsp", "--output"].includes(arg)) {
      const value = args[++index];
      if (!value) usage();
      if (arg === "--nsp") options.nsps.push(value);
      else
        options[{ "--preview-dir": "preview", "--input-dir": "input", "--output": "output" }[arg]] =
          value;
    } else usage();
  }
  if (!options.preview || !options.input || !options.output || !options.nsps.length) usage();
  if (options.nsps.some((name) => basename(name) !== name || !name.endsWith(".nsp"))) usage();
  return options;
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function packageReaderSource(preview) {
  const manifest = JSON.parse(
    await readFile(join(preview, "runtime/runtime-manifest.json"), "utf8"),
  );
  const asset = manifest.assets.find((item) => item.path === "sealed-workers/nsp-worker.mjs");
  const entry = manifest.transport.entries.find((item) => item.sha256 === asset?.sha256);
  if (!asset || !entry || entry.bytes !== asset.bytes) throw new Error("BUN_E2E_READER_MANIFEST");
  const compressed = await readFile(join(preview, "runtime", entry.file));
  const transport = manifest.transport.files.find((item) => item.path === entry.file);
  if (!transport || sha256(compressed) !== transport.sha256)
    throw new Error("BUN_E2E_READER_TRANSPORT");
  const decoded = gunzipSync(compressed);
  const source = decoded.subarray(entry.offset, entry.offset + entry.bytes);
  if (source.length !== asset.bytes || sha256(source) !== asset.sha256)
    throw new Error("BUN_E2E_READER_HASH");
  return source.toString("utf8");
}

function startPreview(preview) {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      if (request.method !== "GET") return new Response(null, { status: 405 });
      let pathname;
      try {
        pathname = decodeURIComponent(new URL(request.url).pathname);
      } catch {
        return new Response(null, { status: 400 });
      }
      if (pathname.includes("\\") || pathname.split("/").some((part) => part.startsWith(".")))
        return new Response(null, { status: 404 });
      const path = resolve(preview, pathname.replace(/^\/+/, "") || "index.html");
      if (!path.startsWith(preview + sep)) return new Response(null, { status: 404 });
      try {
        if (!(await stat(path)).isFile()) return new Response(null, { status: 404 });
        return new Response(Bun.file(path));
      } catch {
        return new Response(null, { status: 404 });
      }
    },
  });
}

async function checkArchive(path) {
  const checked = Bun.spawnSync(["unzip", "-tq", path], { stdout: "pipe", stderr: "pipe" });
  if (checked.exitCode !== 0) throw new Error("BUN_E2E_IPA_ZIP_INVALID");
  const listed = Bun.spawnSync(["unzip", "-Z1", path], { stdout: "pipe", stderr: "pipe" });
  if (
    listed.exitCode !== 0 ||
    !new TextDecoder().decode(listed.stdout).includes("Payload/DmIOS.app/DmIOS")
  )
    throw new Error("BUN_E2E_IPA_PAYLOAD_MISSING");
}

// 各项清理独立执行，保留原失败，不让关闭错误跳过后续释放。
// Run cleanup independently and preserve the primary failure instead of skipping later releases.
export async function cleanupBunE2e(releases, primary) {
  const failures = [];
  for (const release of releases) {
    try {
      await release();
    } catch (error) {
      failures.push(error);
    }
  }
  if (failures.length)
    throw new AggregateError(failures, "BUN_E2E_CLEANUP_FAILED", { cause: primary ?? failures[0] });
}

export async function run(options) {
  const preview = resolve(options.preview);
  const output = resolve(options.output);
  const manifestBytes = await readFile(join(preview, "runtime/runtime-manifest.json"));
  const { runtimeManifestSha256 } = await import(
    pathToFileURL(join(preview, "runtime/runtime-integrity.mjs")).href
  );
  if (sha256(manifestBytes) !== runtimeManifestSha256) throw new Error("BUN_E2E_MANIFEST_HASH");
  const readerSource = await packageReaderSource(preview);
  const prefix = await Bun.file(
    new URL("./bun-e2e-file-reader-prefix.mjs", import.meta.url),
  ).text();
  const readerUrl = URL.createObjectURL(
    new Blob([prefix, "\n", readerSource], { type: "text/javascript" }),
  );
  const server = startPreview(preview);
  const staging = await mkdtemp(join(tmpdir(), "d2r-bun-e2e-"));
  const NativeWorker = globalThis.Worker;
  let workers = 0;
  globalThis.Worker = class extends NativeWorker {
    constructor(url, workerOptions) {
      workers++;
      super(workers === 4 ? readerUrl : url, workerOptions);
    }
  };
  globalThis.isSecureContext = true;
  globalThis.location = server.url;
  Object.defineProperty(navigator, "storage", {
    configurable: true,
    value: await storageAt(staging),
  });
  let packager, primary;
  try {
    let last = "";
    const onProgress = (event) => {
      const label = `${event.stage ?? event.phase ?? ""}: ${event.label ?? event.state ?? ""}`;
      if (label !== last) console.log(`${new Date().toLocaleString()} ${label}`);
      last = label;
    };
    packager = await prepareBrowserPackager({
      manifestSha256: runtimeManifestSha256,
      skipContentHashes: true,
      onProgress,
    });
    if (!packager.ready || workers !== 6) throw new Error("BUN_E2E_WORKER_ORDER");
    const result = await packager.generate({
      input: new DirectoryHandle(resolve(options.input)),
      selectedNspNames: options.nsps,
      exportResources: options.exportResources,
      onProgress,
    });
    await Bun.write(output, result.download.blob);
    const size = (await stat(output)).size;
    if (size !== result.download.blob.size) throw new Error("BUN_E2E_IPA_SIZE");
    await checkArchive(output);
    console.log(`IPA complete: ${output} (${size} bytes)`);
    return { output, size, resources: result.resources };
  } catch (error) {
    primary = error;
    throw error;
  } finally {
    await cleanupBunE2e(
      [
        () => packager?.close(),
        () => {
          globalThis.Worker = NativeWorker;
        },
        () => URL.revokeObjectURL(readerUrl),
        () => server.stop(),
        () => rm(staging, { recursive: true, force: true }),
      ],
      primary,
    );
  }
}

if (import.meta.main) {
  try {
    await run(parseArgs(Bun.argv.slice(2)));
  } catch (error) {
    console.error(error.cause?.stack ?? error.stack ?? String(error));
    if (error.report) console.error(`Report: ${JSON.stringify(error.report)}`);
    process.exitCode = 1;
  }
}
