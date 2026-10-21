import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// 不下载工具、不启动浏览器，也不使用游戏文件或密钥输入；请在冻结锁文件安装后运行。
// No tool downloads, browser launch, game files, or key inputs. Run after frozen install.
const cwd = fileURLToPath(new URL("../", import.meta.url));
const bun = process.env.BUN_EXECUTABLE || "bun";
const checks = ["build", "test", "format:docs:check", "format:workflows:check"];
for (const check of checks) {
  console.log(`\nLocal check: ${check}`);
  const result = spawnSync(bun, ["run", check], { cwd, stdio: "inherit" });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log("\nLocal fast checks passed. Browser/native/release proofs are separate, not implied.");
