import { resolve, sep, extname } from "node:path";
import { stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const outputDirectory = fileURLToPath(new URL("../dist/", import.meta.url));
const contentTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export function assetPath(pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (
    decoded.includes("\\") ||
    decoded.includes("\0") ||
    decoded.split("/").some((part) => part.startsWith("."))
  )
    return null;
  const relative = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const path = resolve(outputDirectory, relative);
  return path.startsWith(resolve(outputDirectory) + sep) ? path : null;
}

export function serve() {
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 4173,
    async fetch(request) {
      if (request.method !== "GET" && request.method !== "HEAD")
        return new Response("Method not allowed", { status: 405 });
      const path = assetPath(new URL(request.url).pathname);
      if (!path) return new Response("Not found", { status: 404 });
      try {
        if (!(await stat(path)).isFile()) return new Response("Not found", { status: 404 });
        const headers = {
          "Content-Type": contentTypes[extname(path)] ?? "application/octet-stream",
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff",
        };
        return new Response(request.method === "HEAD" ? null : Bun.file(path), { headers });
      } catch {
        return new Response("Not found", { status: 404 });
      }
    },
  });
}

if (import.meta.main) {
  const server = serve();
  console.log(`Static preview: ${server.url}`);
}
