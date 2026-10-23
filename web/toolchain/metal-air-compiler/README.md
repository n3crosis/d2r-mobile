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

## Real-device report / 真机测试报告

On 2026-10-23, the maintainer reported that the generated IPA works and explicitly confirmed testing on a real device. The report did not identify an exact artifact, device/iOS version or gameplay test matrix. This records that successful user test without attributing it to every compiler fixture or claiming Xcode-equivalent numerical behavior.

2026-10-23，维护者报告生成的 IPA 可用，并明确确认已进行真机测试。报告未注明具体产物、设备/iOS 版本或游戏测试矩阵。此处记录该次用户测试成功，不把它扩展为每个编译器测试项均通过设备验证，也不宣称与 Xcode 的数值行为等效。

## Historical evidence

The previous authenticated compiler-only 7,212-shader result and user-reported device success are historical evidence, not validation of a new fork release. The new release has independently authenticated source and artifact provenance, but does not inherit the historical corpus or device results. No fresh browser corpus, GPU numerical or full-game equivalence claim is made.

[Historical README](history/PRE_FORK_README.md), [corpus fixes](CORPUS_FIXES.md), [math profile](MATH_SUPPORT.md) and [NaN checks](NAN_CLASSIFICATION.md) retain the original scope and limitations. Raw original receipt and source manifest remain in `web/tests/fixtures/air-release-history/`; Git history retains the original source/patch recipe. [Historical build procedure](history/PRE_FORK_WASM_BUILD.md) is archival, not an active build route.

See [WASM_BUILD.md](WASM_BUILD.md) for current release consumption and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for source/notice distribution.
