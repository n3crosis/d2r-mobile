// 开发者工具按 CMake 声明的固定头文件集合计算指纹，不执行 CMake 代码。
// Developer tools fingerprint the fixed header list declared by CMake without executing it.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

export async function readAirHeaderIdentity(apiSource, apiVersion) {
  if (apiVersion === 1) return hash(await readFile(resolve(apiSource, "include/metal_stdlib")));
  if (apiVersion !== 2) throw new Error("Unsupported compiler header ABI");
  const cmake = await readFile(resolve(apiSource, "CMakeLists.txt"), "utf8");
  const declarations = [...cmake.matchAll(/set\(AIR_HEADER_PATHS\s+([^)]*)\)/g)];
  if (declarations.length !== 1) throw new Error("Fixed compiler header list unavailable");
  const paths = declarations[0][1].trim().split(/\s+/).sort();
  if (
    !paths.length ||
    paths.length > 16 ||
    new Set(paths).size !== paths.length ||
    paths.some(
      (path) =>
        !/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(path) ||
        path.split("/").some((part) => part === "." || part === ".."),
    )
  )
    throw new Error("Invalid compiler header list");
  let fingerprint = "d2r-air-header-bundle-v2\n";
  for (const path of paths)
    fingerprint += `${path}:${hash(await readFile(resolve(apiSource, "include", path)))}\n`;
  return hash(fingerprint);
}
