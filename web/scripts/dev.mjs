import { watch } from "node:fs";
import { build, root } from "./build.mjs";
import { serve } from "./serve.mjs";

await build();
const server = serve();
console.log(`Development preview: ${server.url} (refresh after rebuild; strict production CSP)`);
let running = false;
let pending = false;
let timer;
async function rebuild() {
  pending = true;
  if (running) return;
  running = true;
  while (pending) {
    pending = false;
    try {
      await build();
    } catch (error) {
      console.error(error);
    }
  }
  running = false;
}
function scheduleRebuild() {
  clearTimeout(timer);
  timer = setTimeout(rebuild, 100);
}
// 不递归监视下载的工具链、node_modules 或构建输出。
// Do not recursively watch downloaded toolchains, node_modules or build output.
const watchers = [
  watch(`${root}/src`, { recursive: true }, scheduleRebuild),
  watch(`${root}/vendor`, { recursive: true }, scheduleRebuild),
  watch(root, (_event, filename) => {
    if (/^(?:index\.html|[^/]+\.mjs)$/.test(String(filename ?? ""))) scheduleRebuild();
  }),
];
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    clearTimeout(timer);
    for (const watcher of watchers) watcher.close();
    server.stop();
  });
}
