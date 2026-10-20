# 真实 WASM 编码冒烟测试框架

[English](WASM_SMOKE.md)

在 `bash build.sh` 生成隔离的 `dist/` 产物后，使用 Node 24 或更新版本执行 `node wasm-smoke.mjs`。这是仅供测试的 Node worker_threads 框架，不是生产浏览器工作线程或已部署运行时。不修改构建环境标志。

框架要求存在生成的模块、WASM 二进制、准确的 Arm 提交记录与 Emscripten 4.0.20 版本记录。读取前限制每个产物最多 32 MiB。它动态导入真实生成模块，通过 Emscripten 的 `wasmBinary` 工厂选项提供准确的本地 WASM 字节。Node 测试线程明确提供 `self` 与 `WorkerGlobalScope` 垫片；fetch 和 XMLHttpRequest 调用直接抛错，不进行网络加载。这是测试适配，不证明原生浏览器工作线程兼容性。

16 个微小确定性输入覆盖线性与 sRGB 配置、1×1、4×4、5×7、17×3 尺寸，以及不透明红色与 RGBA 渐变。每个输入经真实 WASM C ABI 编码两次，检查确定性。检查导出可用性、输出长度、非零数据、不同输入输出区别，以及无效尺寸、配置、长度与空指针。现有 `encodeWithModule` 包装器负责分配清理。没有 WASM 解码导出，因此不断言解码质量或原生字节对等。

唯一工作线程在成功、失败或父线程 30 秒期限到达时均被终止。缺失产物、测试失败、线程意外退出或超时均使父线程返回非零；缺失产物不被静默跳过。JSON 成功记录明确测试专用垫片 Node 环境、输入结果、产物哈希与观测到的最大堆长度。微小输入上的堆长度在配置范围内，不验证最大内存限制的强制执行，也不验证进程或浏览器总 RSS。Node JavaScript 堆资源限制也不限制 WebAssembly 线性内存。

本地验证：语法、限定范围 lint 与格式检查通过。没有 `dist/` 时显式报告缺失产物，退出码为 1。没有宣称本地执行过真实 WASM 编码；独立的 CI 结果见下方真实编码证据。浏览器加载、MIME/CSP、生产工作线程取消、网络行为与端到端转码对等仍未验证。

## CI 证据

[运行 39477410207](https://github.com/n3crosis/d2r-mobile/actions/runs/39477410207)，源码 f4f3326，以固定 Emscripten 4.0.20 编译，并在明确使用测试垫片的 Node 工作线程中通过 16 个样本、32 次真实 WASM 编码。小样本观测到 33,554,432 字节线性堆；这不是浏览器峰值内存或最大堆强制限制的测量。WASM SHA-256：`518e199e5fc29f743909093d478eb3d650c0398f3c0a17dfd25fcc27a115c2ee`。浏览器工作线程执行、原生/WASM 字节一致性、解码保真与完整游戏纹理包集成仍未验证。发布运行时载荷不包含 ASTC。

冒烟测试现通过不透明 `data:` URL 导入生成的 JavaScript，使用与生成器相同的 `wasmBinary`、准确 `locateFile` 及字节实例化钩子。这能发现未保护的相对 URL 初始化错误，但不能把 Node 测试当成浏览器 Blob 模块加载证据。固定 Emscripten 4.0.20 的 [shell.js](https://github.com/emscripten-core/emscripten/blob/4.0.20/src/shell.js) 捕获不透明基址目录解析错误，[preamble.js](https://github.com/emscripten-core/emscripten/blob/4.0.20/src/preamble.js) 在解析 WASM 文件名之前优先使用传入的实例化钩子。
