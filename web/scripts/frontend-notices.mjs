// 根据实际打包模块保留第三方声明；依据 Bun 构建元数据及原始许可证文件。
// Preserve third-party notices from actual bundled modules using Bun metadata and original licenses.
import { readFile, writeFile, realpath, readdir } from "node:fs/promises";
import { resolve, dirname, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

export const FRONTEND_NOTICES_FILE = "third-party-notices.txt";
const root = fileURLToPath(new URL("../", import.meta.url));

// 只读取有输出贡献的包，不执行包代码，也不遍历开发依赖。
// Read only packages contributing output bytes; never execute packages or traverse dev dependencies.
export async function writeFrontendNotices(outputDirectory, metafile, inputDirectory = root) {
  if (!metafile || !metafile.outputs || typeof metafile.outputs !== "object")
    throw new Error("Frontend notices require Bun output metadata");
  const modules = new Set();
  for (const output of Object.values(metafile.outputs)) {
    if (!output.inputs || typeof output.inputs !== "object")
      throw new Error("Frontend output lacks input contribution metadata");
    for (const [path, contribution] of Object.entries(output.inputs)) {
      if (!Number.isFinite(contribution.bytesInOutput) || contribution.bytesInOutput < 0)
        throw new Error("Invalid frontend input contribution");
      if (contribution.bytesInOutput > 0) modules.add(path);
    }
  }
  if (!modules.size) throw new Error("Frontend metadata has no contributing inputs");
  const installed = await realpath(resolve(root, "node_modules"));
  const packages = new Map();
  for (const path of modules) {
    if (!path.replaceAll("\\", "/").includes("node_modules/")) continue;
    const source = await realpath(resolve(inputDirectory, path));
    const inside = relative(installed, source);
    if (inside === ".." || inside.startsWith(`..${sep}`) || inside.startsWith(sep))
      throw new Error("Frontend package input is outside installed dependencies");
    let directory = dirname(source);
    while (directory !== installed) {
      try {
        const metadata = JSON.parse(await readFile(resolve(directory, "package.json"), "utf8"));
        if (typeof metadata.name === "string" && typeof metadata.version === "string") {
          packages.set(directory, metadata);
          break;
        }
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
      directory = dirname(directory);
    }
    if (directory === installed) throw new Error("Frontend package metadata is missing");
  }
  // Tailwind 转换把 CSS 来源折叠为本地入口；其显式样式导入仍随页面分发。
  // Tailwind collapses CSS origins into the local entry; its explicit stylesheet import still ships.
  for (const path of modules) {
    if (resolve(inputDirectory, path) !== resolve(root, "src/index.css")) continue;
    const css = await readFile(resolve(root, "src/index.css"), "utf8");
    if (!/@import\s+["']tailwindcss["']/.test(css))
      throw new Error("Frontend stylesheet provenance changed");
    const directory = resolve(installed, "tailwindcss");
    packages.set(directory, JSON.parse(await readFile(resolve(directory, "package.json"), "utf8")));
  }
  if (!packages.size) throw new Error("Frontend metadata has no runtime packages");
  const sections = ["Frontend third-party notices\n"];
  for (const [directory, metadata] of [...packages].sort(([a], [b]) => a.localeCompare(b))) {
    const files = (await readdir(directory))
      .filter((name) => /^(?:licen[sc]e|notice)(?:[.-].*)?$/i.test(name))
      .sort();
    if (!files.some((name) => /^licen[sc]e(?:[.-].*)?$/i.test(name))) {
      // 部分 Radix 辅助包未携带根许可证；仅同一仓库、明确 MIT 的包共用原文。
      // Some Radix helpers omit the root license; share its original only for the same MIT repository.
      const upstream = "git+https://github.com/radix-ui/primitives.git";
      if (
        !metadata.name.startsWith("@radix-ui/") ||
        metadata.license !== "MIT" ||
        metadata.repository?.url !== upstream
      )
        throw new Error(`Missing frontend license: ${metadata.name}@${metadata.version}`);
      const shared = JSON.parse(
        await readFile(resolve(installed, "radix-ui/package.json"), "utf8"),
      );
      if (shared.license !== "MIT" || shared.repository?.url !== upstream)
        throw new Error("Radix shared license provenance changed");
      sections.push(
        `${metadata.name}@${metadata.version} (shared upstream ${upstream}; radix-ui@${shared.version}/LICENSE)\n\n${await readFile(resolve(installed, "radix-ui/LICENSE"), "utf8")}`,
      );
    }
    for (const file of files)
      sections.push(
        `${metadata.name}@${metadata.version} (${file})\n\n${await readFile(resolve(directory, file), "utf8")}`,
      );
  }
  // 本地复制的组件和校验模块也属于产物；逐字保留其许可证。
  // Locally copied components and checksum modules also ship; preserve their licenses verbatim.
  for (const [name, path] of [
    ["shadcn/ui", "SHADCN_LICENSE.md"],
    ["SparkMD5 3.0.2 (MIT alternative)", "vendor/spark-md5-3.0.2/LICENSE2"],
  ])
    sections.push(`${name}\n\n${await readFile(resolve(root, path), "utf8")}`);
  await writeFile(resolve(outputDirectory, FRONTEND_NOTICES_FILE), sections.join("\n\n"));
}
