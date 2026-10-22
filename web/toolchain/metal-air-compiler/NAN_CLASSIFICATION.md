# NaN classification correction / NaN 分类修正

The experimental header now classifies float NaNs with an IEEE-754 bit test, rather than a builtin that the selected fast-math profile can optimize away. The generated comparison is `absBits > 0x7f800000`, matching the operation observed in the supplied reference compiler output. This preserves the source's explicit NaN sanitization.

Float2/3/4 `isnan` and `select` use internal per-component boolean masks. These helper structs are not MSL bool-vector storage or shader-interface ABI types. General bool-vector constructors, conversions and operations remain unsupported.

The source-driven test checks that dynamic classification and vector selection survive the selected fast profile. Ten constant-pattern cases check positive/negative zero, finite values, infinity, quiet NaN and signaling NaN. These inspect generated/constant-folded IR; they do not execute shaders or prove Apple runtime equivalence.

Run `node run-nan-fixtures.mjs /path/to/clang`. The normal header-bundle digest changes automatically, so previous cached compiler output must not be reused with the new header fingerprint.

实验性头文件改用 IEEE-754 位分类，避免快速数学优化删除显式 NaN 检测。float2/3/4 的检测与选择逐分量实现；内部布尔掩码不是 MSL 布尔向量的存储或着色器接口 ABI。测试检查动态 IR 和十种常量位模式，不代表设备执行验证。头文件集合摘要会随修正更新，旧缓存不能沿用。
