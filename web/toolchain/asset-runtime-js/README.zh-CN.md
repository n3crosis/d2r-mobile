# 完整 JavaScript/WASM 资产运行时

本目录提供不依赖 Python 的资产 worker 与仅构建时使用的组装器。生产客户端、运行时构建和打包已改为选择本闭包，不再选择 Pyodide/Pillow。部署仍须通过同一 CI 作业内精确 WASM 后端的成功构建。已冻结的 CASC 来源及 `.NET` 保持不变。

## 阶段与当前门槛

1. 全部 12 个现有操作已有固定来源的可调用 JS 流程。定向配方一致性包括 34 个 art 案例、完整 96 文件 HUD 输出及完整 263 文件 overlay 输出与回执；独立 codec/font WASM 证明仍是单独的产物门槛。
2. 在现有编译 CI 作业内构建 `image-kernels-rust`、`png-codec-exact` 和 `font-rasterizer-exact`。复用 Rust 1.99.1、emsdk 4.0.20、Bun 1.4.3。本目录不增加 CI 作业或包依赖。
3. 运行 `bun web/toolchain/asset-runtime-js/build.mjs`。它执行所有配方来源检查、对照构建回执校验 WASM 字节、检查零宿主导入和必需导出，并实际初始化每个后端以核定版本。随后打包完整导入图、嵌入三个 WASM 的 SHA-256/尺寸记录，生成闭合的组件清单。
4. 客户端/构建/打包选择已整体接通。缺少产物、操作不完整、来源校验或打包失败均会阻止发布；不存在 Python 回退。

`node web/toolchain/asset-runtime-js/build.mjs --plan` 只打印阶段、操作列表与来源/产物路径，不进行构建。本地尚未运行完整组装：环境有像素 WASM，但没有 `bun` 命令及 PNG/字体 WASM 产物。语法、仓库格式/lint、少量协议/传输检查和已有像素 WASM ABI 检查可独立运行；它们不是完整运行时或游戏输入验证。

## 运行时契约

输出四个组件资产：`worker.mjs`、`image-kernels.wasm`、`png-codec.wasm`、`font-rasterizer.wasm`，以及 `manifest.json` 和平铺 `licenses/`。JS 配方、数值核、摘要实现与后端包装器全部打包进 worker，不依赖 Blob 相对导入。代码不下载运行时依赖、不动态导入代码，也不安装网络/CSP 拦截。非空的旧环回证明探针会被拒绝；生产初始化不发送这些探针。

初始化保留 `{id:0,type:'initialize',assets:[[basename,ArrayBuffer],...]}`，仅在三个精确产物均初始化且 12 个操作各有唯一完整路由之后，返回 `{id:0,ok:true,result:{initialized:true,...}}`。编译前重新对照可信构建内嵌记录计算资产摘要。现有已验证外层清单/预加载仍然必需，内层检查不能替代它。新初始化回执如实报告 `version:'asset-runtime-js/1'` 和 `packages:{pillow:false}`；生产客户端只要求 `initialized:true`。

作业保留 `{id,type:'run',operation,payload:ArrayBuffer,options}`。PNG、像素和字体后端拥有可复用固定内存，因此必须保留串行队列。初始化结束前收到的作业立即拒绝。初始化为一次性，失败也不重试。每个输出文件复制为独立可转移 `ArrayBuffer`，其余配方元数据不变。私有作业错误保持脱敏，有限长度的启动错误只说明公开运行时来源/产物。

保留现有边界限制：初始化最多 32 个资产，各自非空且不超过 32 MiB，总计不超过 96 MiB；作业默认 20 MiB，HUD/CASC 为 64 MiB，overlay 为 128 MiB；序列化选项默认 4,096 字符，CASC 为 1,048,576。客户端另行限制 UTF-8 字节数。不宣称支持过时的 `encode-linear-bc3` 回退：生产已使用独立 Rust BC3 纹理运行时。

## 生产选择

生产选择整体更新如下：

- `sealed-runtime/clients.mjs`：资产入口/闭包改为 `toolchain/asset-runtime-js/dist`，保持已验证预加载、传输和会话归属不变。
- `runtime-build/build.mjs`：在 codec 构建后加入像素/字体构建与本组装器；从发布链移除资产 Pyodide 安装、vendor 生成和准备。仅构建时的一致性预言机可以单独保留 Python。
- `runtime-build/package.mjs`：选择精确四文件的新组件并更新入口/清单；移除 Pyodide 闭包及 loader-provenance 复制。此组件的证明用 `bootstrap.mjs` 改为可选，不发布虚假或不用的证明入口。显式发布策略拒绝 Python 模块、wheel、libpython 和 Pyodide 路径。
- 纳入 `licenses/` 中的全部依赖声明和来源。即使没有 CPython/Pillow 二进制，来自 Pillow 的像素/PNG/字体代码仍需声明。保留两个 zlib 版本：PNG 1.3.1，CASC 1.2.13。

组件不包含游戏图像、字体、密钥、夹具输出、浏览器测试、证明 HTML、本机库、缓存或 source map。完整端到端/游戏字体一致性和部署启动仍是不同门槛。`.NET` 不变。
