# D2R AIR compiler integration / AIR 编译器集成

Compiler implementation, compatibility headers and LLVM fixes belong to the reusable [floor_llvm fork](https://github.com/n3crosis/floor_llvm), not this directory. D2R retains its adapters, authored fixtures, strict 31-call canary and output/reflection checks. No local LLVM build or patch application is supported here.

`release-pin.json` binds the authenticated [v0.1.0 release](https://github.com/n3crosis/floor_llvm/releases/tag/v0.1.0) to its actual build commit `1bd8db2f0fefbd13636e51c209ef09292675dff5` and exact manifest SHA-256. It does not follow the fork default branch. Missing pins, missing corresponding source, stale caches or mismatched receipts fail closed. CI must pass the unchanged strict 31-call D2R canary before publishing a runtime; release authentication alone is not application, browser or GPU validation.

编译器实现、兼容头文件和 LLVM 修复由独立 fork 维护；本目录保留 D2R 集成及严格测试。缺少经过审查的发布版本锁定或完整对应源码时，导入会失败，不会回退到本地编译。

## Release integration

- `node web/runtime-build/build-air-compiler.mjs` imports the pinned release and runs the unchanged strict 31-call canary. It does not build LLVM.
- `node web/runtime-build/prepare-air-compiler-source.mjs --output EMPTY_DIRECTORY` mirrors the exact release source archive, including artifact-only notices and installed Emscripten runtime sources, plus unchanged receipt/lock and authenticated metadata.
- Release `air_wasm.mjs` and `air_wasm.wasm` are installed under the existing two `d2r_air_wasm.*` runtime paths without changing a byte. The original generic receipt is not rewritten.
- ABI-v2 exports, header-bundle-v2 handshake, runtime capabilities, sealing and game/source digests remain mandatory. A generic fork smoke test cannot replace D2R's canary or application validation.

`fixtures/` and `ci-compile-canary.mjs` remain D2R-owned. Four native API smoke inputs live in `fixtures/native-api/`. Optional native test drivers require explicit external fork clang/header paths; they do not download or build a compiler. Source invariant tests authenticate exact built fork inputs instead of reading local patch text.

See [WASM_BUILD.md](WASM_BUILD.md) for release consumption and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for corresponding-source and notice requirements. Compiler implementation and math support are maintained in the linked fork.
