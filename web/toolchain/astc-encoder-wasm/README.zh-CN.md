# 有界 ASTC WASM 基元

[English](README.md)

仅为隔离的实验源码。不是生产选项、完整纹理转换器，也不表示浏览器与原生功能已经对等。不包含游戏资源、密钥、生成的二进制文件或上游源码副本。

## 来源

- 官方 [Arm astc-encoder 5.0.0](https://github.com/ARM-software/astc-encoder/releases/tag/5.0.0)，固定提交 `2ff200e08c98a61775351687ea2b5d38e455ad8b`。这是特意选择的稳定版本，不宣称为最新版本。
- [固定版本 API](https://github.com/ARM-software/astc-encoder/blob/2ff200e08c98a61775351687ea2b5d38e455ad8b/Source/astcenc.h)、[构建配置](https://github.com/ARM-software/astc-encoder/blob/2ff200e08c98a61775351687ea2b5d38e455ad8b/Source/cmake_core.cmake)、[Apache-2.0 许可证](https://github.com/ARM-software/astc-encoder/blob/2ff200e08c98a61775351687ea2b5d38e455ad8b/LICENSE.txt)。源码保留上游声明，构建时复制许可证到产物旁；未来分发必须保留。
- 原生基线：`dm/tools/astc_pack.py` 的 `encode_batch()` 使用 `-cl` 或 `-cs`、`4x4`、默认 `-thorough`、原样 RGBA，不加法线图或透明度加权标志。本基元映射到 `ASTCENC_PRF_LDR` / `ASTCENC_PRF_LDR_SRGB`、`ASTCENC_PRE_THOROUGH`、标志 0 与原样通道映射。

## 契约与限制

`encodeAstc4x4({ rgba, width, height, profile }, { signal, timeoutMs })` 接口返回原始 ASTC 块的 ArrayBuffer，而非 ASTC 文件。输入为一个独占、固定长度、紧密行优先排列的 RGBA8 ArrayBuffer。配置为默认 `linear` 或 `srgb`。RGB 值原样传递，编码解释由所选配置决定。透明度保持线性；不进行预乘、伽马转换、通道重排、垂直翻转或法线重建。输出大小为 `ceil(width/4) * ceil(height/4) * 16`，边缘不足整块时使用上游处理。

最多 1,048,576 像素，单边最多 4096，同一模块环境仅允许一个任务，编码使用单线程。限制仅描述该基元，不代表支持完整游戏纹理。输入转移后调用者缓冲区分离；失败或取消不会返还。每个结果、取消、错误或最长 120 秒期限都会终止一次性工作线程。取消无需等待同步编码主动让出。不同标签页或独立模块副本没有全局协调。

WASM 初始内存为 32 MiB，线性内存上限 128 MiB，在支持时 malloc 失败可返回错误。输入最多 4 MiB；原始输出的保守上限为 4 MiB（结合尺寸限制后的实际最大值更小）。复制一次进入 WASM，再复制紧凑结果输出。此上限不是浏览器总 RSS 上限：引擎与模块开销、转移输入、输出副本、增长与垃圾回收的临时分配不包含在内。丢弃工作线程可释放堆，但浏览器回收时机不保证。不需要文件系统、PNG 暂存、线程池或 SharedArrayBuffer。

## 构建与检查

使用已安装的官方 Emscripten 4.0.20 SDK、Git 和 CMake 执行 `bash build.sh`。配方仅获取官方源码，验证准确且无修改的提交，构建启用浮点不变性的标量后端，将产物、编译器版本与许可证写入被忽略的 `dist/`。不运行 SDK 安装器或下载的可执行文件。配方在获取源码前要求准确的 Emscripten 4.0.20 版本，并保留版本记录。原生与 WASM 保真度验证仍是后续关卡。审查和测试完成前不要提交二进制产物或接入生产。

执行 `node --test synthetic.test.mjs` 可轻量验证 JS 输入、分配清理、所有权转移、取消、期限与错误处理。测试使用模拟编码器与工作线程，不证明真实 ASTC 编码、WASM 构建正确性、质量、速度或游戏对等性。本阶段尚未编译 WASM 或执行浏览器编码器测试。

后续管线仍需实现 BC3 解码与取整对等、块网格拼接与顺序、mip 与缩略图重写、描述缓存更新、质量验证、CASC 写入、浏览器执行证据及独立自有输入的端到端验证。标量源码配方是正确性优先的起点，并非已测量的性能提升。

## 原生冒烟证据（不是 WASM）

`bash native-smoke.sh` 使用已有 C++ 编译器，检出相同的准确官方 Arm 提交，读取其包含 22 个文件的静态库源文件清单，并仅在被忽略的 `.build/` 中构建标量原生冒烟程序。它使用 `-ffp-contract=off` 对应启用浮点不变性的后端配置。不安装编译器或 SDK，不获取可执行文件。测试不使用游戏资源。

使用 GCC 14.2.0 执行：线性与 sRGB 配置、1×1、4×4、5×7、17×3 尺寸、纯色 RGBA 与自造颜色及透明度渐变共 16 次真实编码解码往返全部通过。纯色不透明红色精确往返；非平凡渐变的四通道 PSNR 范围为 20.83 到 35.12 dB（仅为冒烟阈值，不是游戏质量目标）。无效尺寸、溢出尺寸、配置、缓冲区长度与空输入均被拒绝。编译器记录与结果保留在被忽略的 `.build/` 下。

这验证了真实 C ABI 能够针对固定上游核心编译链接，并产生可解码的 ASTC。源码检查确认上游存在 `astcenc-none-static` 目标和所选 CMake 选项。已检查环境没有安装 Emscripten 或 CMake：CMake 配置、Emscripten 4.0.20 参数、堆行为、真实工作线程取消与浏览器执行仍未验证。原生成功不得表述为 WASM 或完整管线对等。
