import { createHash } from "node:crypto";
import process from "node:process";
import { spawnSync } from "node:child_process";
import { mkdir, writeFile, readFile, appendFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { assembleRuntime } from "./package.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const workspace = resolve(root, "web/runtime-build/.build");
const sdk = "10.0.402";
const crossCommit = "f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7";
const stages = [
  [
    "program dependencies",
    "web/toolchain/program-rewrite-spike",
    "npm",
    ["ci", "--ignore-scripts"],
  ],
  ["texture decoder and BC3 encoder", ".", "bash", ["web/toolchain/texture-spike/build-wasm.sh"]],
  ["Rust BC3 encoder", ".", "node", ["web/toolchain/texture-spike/build-bc3.mjs"]],
  ["Pinned PNG and CASC zlib codec", ".", "node", ["web/toolchain/png-codec-exact/build.mjs"]],
  ["Rust image kernels", ".", "node", ["web/toolchain/image-kernels-rust/build.mjs"]],
  ["Pinned font rasterizer", ".", "node", ["web/toolchain/font-rasterizer-exact/build.mjs"]],
  ["authenticated extraction", ".", "bash", ["web/toolchain/nsp-extract-spike/build-wasm.sh"]],
  ["ARM64 rewrite runtime", ".", "bash", ["web/toolchain/program-rewrite-spike/build-wasm.sh"]],
  [
    "sealed texture closure",
    ".",
    "node",
    ["web/toolchain/offline-runtime-spike/prepare-bundle.mjs"],
  ],
  ["JavaScript asset closure", ".", "bun", ["web/toolchain/asset-runtime-js/build.mjs"]],
  ["shader restore", "web/toolchain/shader-spike", "dotnet", ["restore", "ShaderSpike.csproj"]],
  [
    "shader browser publish",
    "web/toolchain/shader-spike",
    "dotnet",
    [
      "publish",
      "ShaderSpike.csproj",
      "-c",
      "Release",
      "--no-restore",
      "-p:WasmInlineBootConfig=false",
      "-p:EnableNETAnalyzers=true",
      "-p:AnalysisLevel=latest",
      "-p:TreatWarningsAsErrors=true",
    ],
  ],
  [
    "sealed shader closure",
    "web/toolchain/shader-spike",
    "node",
    ["../offline-runtime-spike/dotnet-prepare.mjs", "bin/Release/net10.0/publish"],
  ],
];
function run(command, args, cwd = root, capture = false) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: capture ? "pipe" : "inherit",
    timeout: 45 * 60_000,
    env: {
      ...process.env,
      DOTNET_CLI_TELEMETRY_OPTOUT: "1",
      DOTNET_NOLOGO: "1",
      D2R_EMSCRIPTEN_ENVIRONMENT: "worker",
      RUSTUP_TOOLCHAIN: "1.99.1",
    },
  });
  if (result.error || result.status !== 0)
    throw new Error(
      `${command} failed: ${result.error?.message || result.stderr || result.status}`,
    );
  return result.stdout?.trim();
}
const option = process.argv[2];
if (option === "--plan") {
  console.log(
    JSON.stringify(
      {
        prerequisites: {
          emscripten: "4.0.20",
          rust: "1.99.1",
          dotnet: sdk,
          workload: "wasm-tools 10.0.402",
          bun: "1.4.3",
          commands: ["git", "cmake", "make", "python3", "node", "npm", "bun"],
        },
        crossCommit,
        stages,
        output: "web/runtime-build/out/",
        productionEnabled: false,
      },
      null,
      2,
    ),
  );
} else if (option === undefined) {
  // Prerequisites are installed separately by the contributor or CI. No sudo,
  // SDK installation, browser launch, tests, game inputs or signing credentials.
  if (!run("emcc", ["--version"], root, true).split("\n")[0].includes("4.0.20"))
    throw new Error("Expected Emscripten 4.0.20");
  if (run("dotnet", ["--version"], resolve(root, "web/toolchain/shader-spike"), true) !== sdk)
    throw new Error(`Expected .NET SDK ${sdk}`);
  await mkdir(workspace, { recursive: true });
  const checkout = resolve(workspace, "spirv-cross");
  // An isolated exact revision, never a branch tip or a user's checkout.
  run("git", ["init", "-q", checkout]);
  run(
    "git",
    ["fetch", "--depth", "1", "https://github.com/KhronosGroup/SPIRV-Cross.git", crossCommit],
    checkout,
  );
  run("git", ["checkout", "--detach", "FETCH_HEAD"], checkout);
  if (run("git", ["rev-parse", "HEAD"], checkout, true) !== crossCommit)
    throw new Error("Cross source pin mismatch");
  run("bash", [
    "web/toolchain/spirv-cross-spike/build.sh",
    "wasm",
    checkout,
    resolve(workspace, "cross-wasm"),
  ]);
  await writeFile(
    resolve(root, "web/toolchain/shader-spike/global.json"),
    JSON.stringify({
      sdk: { version: sdk, rollForward: "disable", allowPrerelease: false, workloadVersion: sdk },
    }) + "\n",
  );
  for (const [name, directory, command, args] of stages) {
    console.log(`Build runtime: ${name}`);
    run(command, args, resolve(root, directory));
  }
  const shell = JSON.parse(
    await readFile(resolve(root, "web/toolchain/shell-release-evidence/v1.0.18.json"), "utf8"),
  );
  if (
    shell.sourceUrl !==
      "https://github.com/jhaizhou-ops/d2r-mobile/releases/download/v1.0.18/D2RMobile-shell-build-input.zip" ||
    shell.archiveBytes !== 4884778 ||
    shell.sha256 !== "a383552871851ddb5923033639358e2a3c205ae411676e6538cd098743bbe37b"
  )
    throw new Error("Pinned public shell registry drift");
  const response = await globalThis.fetch(shell.sourceUrl, { signal: AbortSignal.timeout(120000) });
  if (!response.ok || !response.body) throw new Error("Public shell download failed");
  const reader = response.body.getReader(),
    shellBytes = new Uint8Array(shell.archiveBytes);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (offset + value.length > shellBytes.length) throw new Error("Public shell size limit");
      shellBytes.set(value, offset);
      offset += value.length;
    }
  } finally {
    await reader.cancel();
  }
  if (
    offset !== shell.archiveBytes ||
    createHash("sha256").update(shellBytes).digest("hex") !== shell.sha256
  )
    throw new Error("Public shell digest mismatch");
  await writeFile(resolve(workspace, "shell.zip"), shellBytes);
  run("bun", ["web/runtime-sealing/build-workers.mjs"]);
  await assembleRuntime({
    build: {
      emscripten: "4.0.20",
      dotnet: sdk,
      crossCommit,
      sourceRevision: run("git", ["rev-parse", "HEAD"], root, true),
      sourceDirty: Boolean(
        run("git", ["status", "--porcelain", "--untracked-files=no"], root, true),
      ),
    },
  });
  const digest = createHash("sha256")
    .update(await readFile(resolve(root, "web/runtime-build/out/runtime-manifest.json")))
    .digest("hex");
  if (process.env.GITHUB_OUTPUT)
    await appendFile(process.env.GITHUB_OUTPUT, `manifest_sha256=${digest}\n`);
} else {
  throw new Error("Usage: node web/runtime-build/build.mjs [--plan]");
}
