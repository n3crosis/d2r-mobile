# Actual WASM encoding smoke harness

[简体中文](WASM_SMOKE.zh-CN.md)

Run `node wasm-smoke.mjs` with Node 24 or newer, immediately after `bash build.sh` produces the isolated `dist/` artifacts. This is a test-only Node worker_threads harness, not the production browser worker or a deployed runtime. It makes no changes to build environment flags.

The harness requires the generated module, WASM binary, exact Arm commit receipt, and Emscripten 4.0.20 version receipt. Each artifact is limited to 32 MiB before reading. It dynamically imports the actual generated module and supplies the exact local WASM bytes using Emscripten's `wasmBinary` factory option. The Node test worker explicitly defines `self` and `WorkerGlobalScope` shims; fetch and XMLHttpRequest calls throw instead of using network loading. This is an adaptation for testing, not proof of native browser-worker compatibility.

Sixteen tiny deterministic fixtures cover linear/sRGB profiles, 1×1, 4×4, 5×7, and 17×3 dimensions, and opaque red plus RGBA gradients. Each is encoded twice with the real WASM C ABI to check determinism. Checks cover export availability, output lengths, nonzero data, differing fixture outputs, invalid dimensions, profile, lengths, and null pointers. The existing `encodeWithModule` wrapper provides allocation cleanup. There is no WASM decode export, so this test does not assert decode quality or native byte equivalence.

One worker is terminated on success, failure, or a 30-second parent deadline. The parent returns nonzero on missing artifacts, test failure, unexpected worker exit, or timeout; missing artifacts are not silently skipped. A JSON success record identifies the test-only shimmed Node environment, fixture results, artifact hashes, and maximum observed heap length. Observing the heap within its configured range on tiny fixtures does not test maximum-memory enforcement or total process/browser RSS. Node's JavaScript heap resource limit also does not cap WebAssembly linear memory.

Local verification: syntax and scoped lint/format checks pass. Running without `dist/` fails explicitly with exit code 1 for the missing artifact. No local actual WASM encoding has been claimed; the generated artifacts must first be built in the existing CI environment. Browser fetching, MIME/CSP, production worker cancellation, network behavior, and end-to-end transcode parity remain unverified.
