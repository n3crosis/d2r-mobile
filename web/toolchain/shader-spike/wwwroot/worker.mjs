// Developer spike, not wired into the React packager.
import { dotnet } from "./_framework/dotnet.js";

const ready = dotnet
  .create()
  .then(async (runtime) => {
    return { exports: await runtime.getAssemblyExports(runtime.getConfig().mainAssemblyName) };
  })
  .catch((error) => ({ error }));
// Attach immediately: requests arriving during startup must not be lost.
globalThis.addEventListener("message", async ({ data }) => {
  const { requestId, job, code } = data ?? {};
  try {
    if (!(code instanceof Uint8Array) || !job || job.stage !== "cs") {
      throw new Error("Expected compute job and Uint8Array shader bytes.");
    }
    const startup = await ready;
    if (startup.error) throw startup.error;
    const exports = startup.exports;
    const result = JSON.parse(exports.ShaderBridge.Translate(JSON.stringify(job), code));
    globalThis.postMessage({ requestId, result });
  } catch (error) {
    globalThis.postMessage({ requestId, error: String(error?.message ?? error) });
  }
});
