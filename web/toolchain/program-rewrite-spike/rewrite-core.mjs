// Same admission interface; source-pinned rewriting now uses JS + Capstone/LZ4 WASM.
export { createJavaScriptProgramRewriter as createProgramRewriter } from "./js/rewrite.mjs";
