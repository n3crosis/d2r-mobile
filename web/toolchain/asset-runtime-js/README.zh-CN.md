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

初始化保留 `{id:0,type:'initialize',assets:[[basename,ArrayBuffer],...]}`，仅在三个精确产物均初始化且 12 个现有配方操作及专用外部引用 CASC 操作各有唯一完整路由之后，返回 `{id:0,ok:true,result:{initialized:true,...}}`。编译前重新对照可信构建内嵌记录计算资产摘要。现有已验证外层清单/预加载仍然必需，内层检查不能替代它。新初始化回执如实报告 `version:'asset-runtime-js/1'` 和 `packages:{pillow:false}`；生产客户端只要求 `initialized:true`。

作业保留 `{id,type:'run',operation,payload:ArrayBuffer,options}`。PNG、像素和字体后端拥有可复用固定内存，因此必须保留串行队列。初始化结束前收到的作业立即拒绝。初始化为一次性，失败也不重试。每个输出文件复制为独立可转移 `ArrayBuffer`，其余配方元数据不变。私有作业错误保持脱敏，有限长度的启动错误只说明公开运行时来源/产物。

保留现有边界限制：初始化最多 32 个资产，各自非空且不超过 32 MiB，总计不超过 96 MiB；作业默认 20 MiB，HUD/CASC 为 64 MiB，overlay 为 128 MiB；序列化选项默认 4,096 字符，CASC 为 1,048,576。客户端另行限制 UTF-8 字节数。不宣称支持过时的 `encode-linear-bc3` 回退：生产已使用独立 Rust BC3 纹理运行时。

## 生产选择

生产选择整体更新如下：

- `sealed-runtime/clients.mjs`：资产入口/闭包改为 `toolchain/asset-runtime-js/dist`，保持已验证预加载、传输和会话归属不变。
- `runtime-build/build.mjs`：在 codec 构建后加入像素/字体构建与本组装器；从发布链移除资产 Pyodide 安装、vendor 生成和准备。仅构建时的一致性预言机可以单独保留 Python。
- `runtime-build/package.mjs`：选择精确四文件的新组件并更新入口/清单；移除 Pyodide 闭包及 loader-provenance 复制。此组件的证明用 `bootstrap.mjs` 改为可选，不发布虚假或不用的证明入口。显式发布策略拒绝 Python 模块、wheel、libpython 和 Pyodide 路径。
- 纳入 `licenses/` 中的全部依赖声明和来源。即使没有 CPython/Pillow 二进制，来自 Pillow 的像素/PNG/字体代码仍需声明。保留两个 zlib 版本：PNG 1.3.1，CASC 1.2.13。

组件不包含游戏图像、字体、密钥、夹具输出、浏览器测试、证明 HTML、本机库、缓存或 source map。完整端到端/游戏字体一致性和部署启动仍是不同门槛。`.NET` 不变。

## 专用外部引用 CASC 操作

`casc-prebuilt-overlay` 是独立内部操作，与保持不变的 `casc-overlay` 区分。它登记在密封客户端允许列表与 JS/WASM 运行时路由中，但 UI、生产配置及资源生成器尚未调用。原有普通覆盖层字节一致性测试仍然通过。

宿主 API 为 `web/casc-overlay-writer.mjs` 中的 `writeCascPrebuiltOverlay({romfs,replacements:[],external:{pack,records},worker,signal})`。`pack` 为 `{name,size,sha256}`；条目为现有规范化路径的 `{path,oldEkey,newEkey,encodedSize,decodedSize}`。宿主检查原始清单路径到键的关联、重复项、普通与外部路径重叠、无符号 32 位条目长度、8/8/40 位置及声明包大小内的范围（包大小必须为正且最多 `2**40`）。工作线程独立解析原始 CFT 位置并在修改前拒绝 CFT 重叠。这里的包哈希与 EKey 是引用元数据，不是对外部归档字节的认证；本操作既不读取也不复制补充归档。

生成补充包之前调用 `reserveCascPackLocations(romfs,{packLocation?})`。它先从源清单中预留普通覆盖层的首个空闲归档位置，再选择或检查独立且未使用的补充位置，返回冻结的 `{overlayLocation,packLocation,packName}`。这样不会仅因加入外部包就改变普通覆盖层位置与偏移。应用引用时，宿主再次依据实际清单和 `getFile` 核查；不接受调用方提供的可用性标志。这是确定性的快照检查，不是文件系统锁：调用方必须保持清单稳定并协调其他计划输出。

工作线程接收 `{parts,jobs,location}` 选项以及 `[config,originalVfs,root,...ordinaryReplacementBytes,externalJson]` 载荷分段。`externalJson` 为 UTF-8 JSON `{pack,records}`，具有独立 16 MiB 上限；最多支持 32,768 个引用及总计 8 MiB 的路径字节。引用不会放进 1 MiB 选项对象。总载荷仍最多 64 MiB，普通任务仍最多 4096 项，普通替换内容仍每项最多 16 MiB，输出仍最多 64 MiB。元数据使用现有总预算的一部分，不扩大总预算。只有本专用操作在存在引用时允许普通任务列表为空。响应为 `{files,inventory,external:{count,pack}}`，清单仅含普通条目，不回传完整引用列表；宿主核查回执，并只接受更改后的配置与预留覆盖层归档。

运行 `node --test web/tests/casc-overlay-writer.test.mjs web/tests/casc-prebuilt-routing.test.mjs`。六项原有原生覆盖层回归与七项专用宿主/契约测试通过。专用测试使用合成源数据及注入的 Node 压缩，不是真实浏览器/WASM 执行；覆盖位置冲突预留、仅外部引用任务、元数据载荷路由、声明位置/范围/关联拒绝、独立引用预算、不变的传输上限及回执不匹配。真实组装运行时启动与端到端安装仍是独立门槛。
