import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

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
