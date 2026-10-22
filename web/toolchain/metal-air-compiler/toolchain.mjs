import process from "node:process";
// Build-time developer tooling only. Never imported by the browser application.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, mkdir, readdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
const root = dirname(fileURLToPath(import.meta.url));
const manifest = JSON.parse(await readFile(join(root, "manifest.json"), "utf8"));
const [command, ...args] = process.argv.slice(2);
function option(name, fallback) {
  const i = args.indexOf(name);
  if (i < 0) return fallback;
  if (!args[i + 1] || args[i + 1].startsWith("--")) throw Error(`Missing ${name} value`);
  return args[i + 1];
}
const work = resolve(option("--work", join(root, "work")));
const jobs = Number(option("--jobs", "2"));
if (!Number.isSafeInteger(jobs) || jobs < 1 || jobs > 16) throw Error("jobs must be 1..16");
const source = join(work, "source");
const build = join(work, "build");
const apiBuild = join(work, "api-build");
async function digest(path) {
  const hash = createHash("sha256");
  for await (const part of createReadStream(path)) hash.update(part);
  return hash.digest("hex");
}
function run(binary, argv, extra = {}) {
  const result = spawnSync(binary, argv, { stdio: "inherit", ...extra });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error(`${binary} failed: ${result.status ?? result.signal}`);
}
async function checkPatches() {
  for (const patch of manifest.patches)
    if ((await digest(join(root, patch.path))) !== patch.sha256)
      throw Error(`Patch integrity mismatch: ${patch.path}`);
}
async function checkSource() {
  await checkPatches();
  const marker = JSON.parse(await readFile(join(work, "prepared.json"), "utf8"));
  if (marker.commit !== manifest.commit || marker.archiveSha256 !== manifest.archiveSha256)
    throw Error("Prepared source pin does not match manifest");
  for (const [path, expected] of Object.entries(manifest.patchedFiles))
    if ((await digest(join(source, path))) !== expected)
      throw Error(`Patched source mismatch: ${path}`);
}
if (command === "prepare") {
  const archive = option("--archive");
  if (!archive) throw Error(`Provide --archive downloaded from ${manifest.archiveUrl}`);
  await checkPatches();
  if ((await digest(resolve(archive))) !== manifest.archiveSha256)
    throw Error("Source archive SHA256 mismatch");
  await mkdir(work, { recursive: true });
  if ((await readdir(work)).length)
    throw Error("prepare requires a new empty work directory; existing data is never overwritten");
  await mkdir(source);
  run("tar", ["-xzf", resolve(archive), "--strip-components=1", "-C", source]);
  for (const patch of manifest.patches) {
    run("git", ["apply", "--check", join(root, patch.path)], { cwd: source });
    run("git", ["apply", join(root, patch.path)], { cwd: source });
  }
  await writeFile(
    join(work, "prepared.json"),
    JSON.stringify({ commit: manifest.commit, archiveSha256: manifest.archiveSha256 }),
  );
  await checkSource();
} else if (command === "build") {
  await checkSource();
  run("cmake", [
    "-S",
    join(source, "llvm"),
    "-B",
    build,
    "-G",
    "Ninja",
    "-DCMAKE_BUILD_TYPE=Release",
    "-DCMAKE_C_FLAGS_RELEASE=-O1 -DNDEBUG",
    "-DCMAKE_CXX_FLAGS_RELEASE=-O1 -DNDEBUG",
    "-DLLVM_ENABLE_PROJECTS=clang",
    "-DLLVM_TARGETS_TO_BUILD=",
    "-DLLVM_ENABLE_ASSERTIONS=ON",
    "-DLLVM_INCLUDE_TESTS=OFF",
    "-DLLVM_INCLUDE_EXAMPLES=OFF",
    "-DLLVM_INCLUDE_BENCHMARKS=OFF",
    "-DLLVM_ENABLE_ZLIB=OFF",
    "-DLLVM_ENABLE_ZSTD=OFF",
    "-DLLVM_ENABLE_LIBXML2=OFF",
    "-DLLVM_ENABLE_TERMINFO=OFF",
    "-DLLVM_ENABLE_CURL=OFF",
    "-DCLANG_ENABLE_ARCMT=OFF",
    "-DCLANG_ENABLE_STATIC_ANALYZER=OFF",
    "-DCLANG_FLOOR_ENABLE_SPIRV=OFF",
    `-DLLVM_PARALLEL_COMPILE_JOBS=${jobs}`,
    "-DLLVM_PARALLEL_LINK_JOBS=1",
  ]);
  run("cmake", ["--build", build, "--target", "clang", "--parallel", String(jobs)]);
  run("cmake", [
    "-S",
    join(root, "api"),
    "-B",
    apiBuild,
    "-G",
    "Ninja",
    "-DCMAKE_BUILD_TYPE=Release",
    `-DLLVM_DIR=${join(build, "lib/cmake/llvm")}`,
    `-DClang_DIR=${join(build, "lib/cmake/clang")}`,
  ]);
  run("cmake", ["--build", apiBuild, "--target", "d2r_air_api_smoke", "--parallel", "1"]);
} else if (command === "test") {
  const clang = resolve(option("--clang", join(build, "bin/clang")));
  const smoke = resolve(option("--smoke", join(apiBuild, "d2r_air_api_smoke")));
  const output = join(work, "test-results");
  await mkdir(output, { recursive: true });
  for (const script of ["run-fixtures.mjs", "run-msl-fixtures.mjs"])
    run(process.execPath, [join(root, script), clang], {
      env: { ...process.env, AIR_TEST_OUTPUT_DIR: join(output, script.replace(".mjs", "")) },
    });
  run(smoke, []);
} else if (command === "check") {
  await checkPatches();
  console.log(`Verified ${manifest.patches.length} ordered patch hashes for ${manifest.commit}`);
} else {
  console.log(
    "Usage: node toolchain.mjs prepare --archive FILE [--work DIR]\n       node toolchain.mjs build [--work DIR] [--jobs 2]\n       node toolchain.mjs test [--work DIR] [--clang FILE --smoke FILE]\n       node toolchain.mjs check",
  );
  if (command && command !== "help") process.exitCode = 1;
}
