# Experimental authored math/header subset / 实验性数学与头文件子集

This is a native-validated addition to the experimental compiler, not a claim of full MSL support, browser completion, or Apple runtime acceptance. It does not contain Apple SDK headers or user shader material.

## Interface and provenance

- Existing `air_compile_v1` stays source/ABI-compatible and selects the conservative subset.
- New `air_compile_v2` takes an explicit final math-profile argument: `0` conservative, `1` fast-f32. Other values are rejected. Profile 1 sets fast-math/no-NaN/no-infinity/no-signed-zero flags and explicitly selects single-precision unsuffixed literals with Clang’s `-cl-single-precision-constant`; it must only be selected when the source's intended compilation profile permits them.
- The fixed header bundle is force-included before caller source and kept entirely in the in-memory filesystem. Source bytes are not rewritten; callers must continue hashing the original source separately.
- `air_compiler_header_bundle_version()` returns `2`. `air_compiler_header_sha256()` now fingerprints the complete bundle: SHA-256 of `d2r-air-header-bundle-v2\n`, followed by lexically sorted `relative-path:sha256\n` records. It is no longer the digest of a single header. Existing caches must be invalidated when this value changes. Cache identity must also include API version, selected math profile, target OS and original source digest. The browser adapter defaults to v1 and requires explicit v2 capability/profile selection. Its v2 ABI checks and real Node-hosted WASM execution pass; Chrome and full-game verification remain pending.
- Trusted AIR declarations are limited to exact float signatures and known symbols in the physical embedded math header. Caller assembly, fake `#line` filenames, user redeclarations and macro-defined assembly labels are rejected. No host includes are available.

## Implemented and tested

Authored float scalar/vector math wrappers emit real AIR calls for fma, sqrt, rsqrt, exp2, log2, floor, trunc, rint, abs, min, max and clamp. Standard fast wrappers require profile 1; `metal::fast` explicitly names the fast behavior. The subset includes integer min/max/clamp, equal-size bit casting, scalar select/isnan, and a vector-alias-only `simd/simd.h` shim.

Nine authored frontend fixtures and the API header/profile regression suite pass, alongside the original API smoke suite. The regression suite covers exact profile selection, forged filename rejection, assembly/redeclaration rejection, and repeated compilations. These execution results belong to the prior gzorin-based baseline. The migrated a2flo frontend selects `metal3.2` mode and retains AIR 2.7/MSL 3.2 output; it still needs its own CI build and validation, and does not imply complete MSL 3.2 language support.

The narrow `select(floatN, floatN, isnan(floatN))` path uses internal component masks for N=2,3,4; these are not MSL bool-vector storage or interface types. Scalar and vector NaN classification uses IEEE float-bit tests so fast-math cannot remove sanitization. See [NAN_CLASSIFICATION.md](NAN_CLASSIFICATION.md).

Unsupported types/operations remain errors, including general bool-vector storage/operations, accurate transcendental replacements, SIMD operations, textures and most MSL library functions. Do not substitute integer vectors for bool vectors or treat successful packaging as rendering equivalence.

Build the existing API CMake project with targets `d2r_air_api_smoke` and `d2r_air_header_smoke`, then run:

`node run-math-fixtures.mjs /path/to/clang /path/to/api-build`

## 中文说明

这是已经过原生编译验证的实验性子集，不代表完整 MSL、浏览器端流程或 Apple 设备兼容性已经完成。头文件为自行实现，不包含 Apple SDK 或用户提供的着色器。

保留原有 v1 接口；新增 v2 接口显式选择数学配置。配置 1 会启用快速浮点假设，只有与源代码预期编译配置一致时才可使用。头文件摘要升级为版本 2 的完整、排序后的头文件集合摘要，原始着色器摘要仍需独立保存，不能用注入头文件后的文本替代。

验证覆盖真实 AIR 数学调用、整数精度保持、非法类型诊断、伪造文件名与汇编符号拒绝，以及重复编译。尚未支持的接口必须报错，不能用空实现、错误的向量类型或重新打包冒充编译成功。WASM 集成和完整游戏着色器覆盖仍需后续验证。
