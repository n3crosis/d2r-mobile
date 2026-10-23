# 统一验证入口，本地优先

English: [TESTING.md](TESTING.md)

本仓库只有一个 GitHub Actions 工作流：**Verify**。常规推送/PR
运行一个快速的 Linux 浏览器构建任务，手动触发时也运行同一任务。
没有 CI 矩阵、跨平台任务或可选的重型 CI 验证配置。
共用的浏览器构建验证可通过以下命令在本地运行：

```sh
node web/verification/verify.mjs quick
```

前置要求：Bun 1.4.3、Node 22.12+（推荐 24）、带 venv/pip 的 Python 3，
以及 Bash。默认构建使用冻结的 Bun 锁文件，并执行 Oxlint/Oxfmt、TypeScript、
生产前端编译、文档/工作流格式检查，以及自行编写的
Python/C/Bash 代码的格式检查。它明确不运行单元测试、合成
回归验证、测试夹具/参考结果准备、浏览器验证或设备矩阵。
这些命令仍保留在下文中，可供后续验证使用。

CI 会将 Ruff 0.14.0 和 clang-format 21.1.2 安装到隔离的临时
venv 中。本地运行则复用 PATH 中完全相同的版本，而不会每次重新安装。
如有需要，请一次性完成以下配置：

```sh
python3 -m venv /tmp/d2r-style-tools
/tmp/d2r-style-tools/bin/pip install --index-url https://pypi.org/simple --only-binary=:all: ruff==0.14.0 clang-format==21.1.2
export PATH="/tmp/d2r-style-tools/bin:$PATH"
```

`bun scripts/check-local.mjs` 和 `bun run test` 仍是需要明确请求才执行的
本地验证命令，并非自动构建的前置步骤。每次源码变更后不要求运行完整验证
套件。这些工具由贡献者安装；使用托管打包网页的用户无需安装。

编译器源码审查用例默认跳过，并显示明确原因；本地检查器和测试样例仍会运行。
如需包含源码审查用例，请让现有测试命令指向已准备好的、与审查摘要匹配的源码目录：

```sh
cd web
D2R_AIR_SOURCE_REVIEW_DIR=/absolute/path/to/reviewed/floor_llvm bun run test
```

这些检查不会下载或执行编译器。显式设置为空、不存在或无效的源码目录会失败，
源码摘要不匹配也会失败。生产发布身份验证和严格编译 canary 保持不变。

## 本地验证配置

以下配置仅保留用于明确选择的本地开发验证。GitHub 不会运行
它们，也不会上传它们的产物。调度器会拒绝在 Actions 中运行重型配置。

- `quick`：共用的浏览器构建验证。
- `extraction`：经过身份验证的 NSP 边界与实际 Chromium Worker。
- `signed-nca`：隔离的合成签名根验证；生产信任机制不变。
- `texture`：解码、BC3 编码、swizzle 与 Chromium Worker 一致性。
- `assets`：原生美术资源、HUD、地图目标、CASC 覆盖层，以及 v61 跨适配器一致性。
- `program`：原始 ARM64 重写与 Guest 框架一致性。
- `shader`：原生/浏览器转换器一致性，以及 C# 格式检查/分析器。
- `spirv-cross`：原生/WASM SPIRV-Cross 一致性。
- `shader-pipeline`：串联转换器到 MSL 的流水线验证。
- `offline-wasm`、`offline-pyodide`、`offline-dotnet`：各自的封闭网络验证。
- `staged-output`：实际 Chromium OPFS 提交/取消/完整性验证。
- `zip64`：内存用量受限的真实 >4 GiB 合成 CRC 数据流。
- `desktop-build` / `desktop`：保留的平台执行方案，供准备适当的
  本地环境使用，不由 GitHub 协调或运行。
- `full`：依次运行 quick 与全部 Linux 验证方案，需明确选择。
  不包含 Windows/macOS 检查或 Node 版本矩阵。

## 本地重型验证

具体的构建/断言命令位于 `web/verification/recipes/*.sh`；
`profiles.json` 固定每项验证的运行时、超时与产物边界。不存在
工作流生成器或旧工作流文件的隐藏副本。由统一调度器
校验配置名称。只有 quick 方案与 Actions 共用；重型
方案仅供本地使用。
失败时会跳过后续常规步骤，保留始终运行的诊断步骤，并将该
配置判定为失败。源码隔离、精确哈希、断言与私有输入排除规则
仍保留在原有验证命令中。

请先审阅所选方案。重型配置会获取/安装官方固定版本的
SDK 与构建工具；部分 Linux 方案会使用 `sudo apt-get`，并安装 .NET
工作负载或 Chromium 系统依赖。本地调用会拒绝运行这些方案，
除非明确选择允许配置环境：

```sh
node web/verification/verify.mjs texture --provision
node web/verification/verify.mjs full --provision
```

请在适当的 Linux 开发环境中运行这些 Linux 方案。本地
`full` 明确排除 Windows/macOS，并报告该边界；它不能
声称在 Linux 上获得了桌面平台覆盖。桌面方案要求使用匹配的操作系统，
并由开发者提供经过验证的上游构建产物及其摘要。它们不是
GitHub 流水线。如果沙箱无法启动 Chromium，不要重试绕过
限制，也不要报告通过。在有受支持的
本地环境之前，应将该验证记录为受阻。

请针对正在评审的确切提交运行本地验证。不要恢复 CI
多任务并行分发来制造结果。仓库的必需检查设置是独立配置，
可能发生变化。

## 可下载的网页

GitHub quick 任务成功后会上传 **web-preview**，其中仅包含 `web/dist/`：
构建后的 HTML、JavaScript、CSS、公开静态资源与 `build-manifest.json`。
清单记录提交（在 GitHub 中构建时）、字节大小与 SHA-256
哈希。保留期为七天。不包含源码/工具链目录、游戏
文件、密钥或 IPA 输出；发现意外的隐藏文件/密钥/游戏文件时，打包会失败。

解压产物后，通过 HTTPS 静态托管提供其内容。通过 `file://` 打开
`index.html` 并不是受支持的文件夹选择器/运行时使用方式。
该产物包含已实现的打包网页及其公开运行时，
而不是生成的游戏 IPA。运行时/能力检查通过后才启用生成；
维护者于 2026-10-23 报告生成的 IPA 已在真实 iOS 设备上运行成功。报告未注明具体构建、设备/iOS 版本、输入格式或游戏覆盖范围；不能据此验证新的 fork 编译器发布版本。
上传该产物不会将其发布到私有托管 Site。
合成组件的验证结果不能证明完整游戏处理、外壳/设备
兼容性、安装或执行；请参阅交付清单。

同一个 GitHub 任务还会在前端验证后构建固定版本的公开 JavaScript/WASM/.NET/Cross
运行时，然后将通过清单验证的运行时文件集合上传至
`web-preview/runtime/`。这不会增加浏览器验证套件、矩阵或
第二个任务。确切的前置要求，以及构建好的运行时文件与经过验证可用的游戏 IPA
之间的区别，请参阅[运行时组装](runtime-build/README.md)。
Pyodide 仍可用于明确调用的本地验证与一致性参考，
但当前的公开运行时构建不会安装或打包它。

非 AIR 运行时的 SDK 配置只缓存固定版本 Emscripten 下载归档，不缓存已安装的工具。
独立的 AIR 缓存包含受发布清单约束的发布资产和已安装输出；发布版本、完整源码、构建凭据验证及严格 canary 始终必需。缓存范围与验证限制见
[SDK 下载缓存](verification/SDK_CACHE.md)。
