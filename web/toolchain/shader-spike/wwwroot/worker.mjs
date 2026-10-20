// Developer compiler boundary; linked synthetic stages are tested in separate CI.
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
    if (
      !(code instanceof Uint8Array) ||
      !job ||
      !["cs", "vs", "ps", "hs", "ds"].includes(job.stage)
    ) {
      throw new Error(
        "Expected supported stage job and Uint8Array shader bytes; other stages are unsupported.",
      );
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
