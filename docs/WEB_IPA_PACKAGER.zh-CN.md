# 本地浏览器 IPA 打包器：实现与验收

English: [WEB_IPA_PACKAGER.md](WEB_IPA_PACKAGER.md)

## 状态与边界

当前源码实现了面向 Windows 和 macOS 桌面 Chromium 的本地输入打包流程。
移除浏览器 Python 运行时的改动目前只是源码改动，不代表已经完成新的构建或部署。
历史上的 [158d6cf Verify 运行](https://github.com/n3crosis/d2r-mobile/actions/runs/39415236827)
只能证明该版本，不能证明这些新改动。本次文档对齐没有执行编译、构建、测试、截图、
真实游戏转换或设备验证。见[交付状态](WEB_DELIVERY_PROGRESS.zh-CN.md)。

这不是让游戏在浏览器里运行。产物经过另行签名和安装后，在兼容的 Apple 设备上原生运行。
最终用户无需安装 Python、.NET、编译器、Xcode 或 Bun。当前生产浏览器运行路径已移除
Python；着色器翻译仍保留 .NET WASM。开发工具和原生参考工具仍可能需要 Python 和 .NET。

## 输入与输出

1. 把本体 NSP、兼容的更新 NSP 和 `prod.keys` 直接放在同一个文件夹里。
   已知兼容 DLC 和 `title.keys` 均为可选。内嵌的通用票据可以提供 title key；
   受权限管理的输入若没有可用票据或匹配密钥，仍会失败。可选不等于所有包都能在
   没有 `title.keys` 时处理。仓库不分发游戏文件或密钥。
2. 在安全上下文中使用唯一的目录选择器，授予读写权限。仅扫描根目录，忽略生成的
   资源子目录。应用不得覆盖原始 NSP 或密钥文件。
3. 在选择私有输入之前，流程会校验并预加载固定版本、同源的公共运行时和应用模板；
   随后认证内容，通过元数据而非文件名选择兼容的本体、更新和可选 DLC。
4. 转换包括提取、程序改写、Guest.framework 生成、原生美术/HUD 与数据表生成、
   覆盖层和着色器翻译。应用模板是预构建的 iOS 构建输入，不是命令行 shell，
   也不是可直接使用的 IPA。
5. 大体积资源以流式方式写入输入目录下新的 `D2R-resources-<UUID>` 子目录。
   已校验 IPA 通过有大小上限的 Blob 供浏览器下载，不直接写进输入目录。
   可见的下载链接支持重试，下载位置由浏览器控制。IPA 不包含全部资源。
6. 另行签名、安装 IPA，再把完整资源目录复制到应用的 Files 目录。
   此浏览器流程没有实现老 GPU 所需的 ASTC 贴图包生成。真实游戏和设备兼容性仍未验证。

## 有源码依据的架构

| 项目           | 当前源码 / 约定                                                                                                                                                                          |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 界面与目录访问 | [`web/src/App.tsx`](../web/src/App.tsx)、[`web/nsp-input.mjs`](../web/nsp-input.mjs)：单一读写选择器、可选 title keys、根目录扫描                                                        |
| 调度           | [`web/browser-packager.mjs`](../web/browser-packager.mjs)：认证后的各阶段、校验、资源导出和 IPA 提交                                                                                     |
| 程序转换       | [`web/runtime-sealing/program-worker.mjs`](../web/runtime-sealing/program-worker.mjs)：JavaScript 改写器与 Capstone/LZ4 WASM，不使用浏览器 Python                                        |
| 美术与数据表   | [`web/production-assets.mjs`](../web/production-assets.mjs)、[`web/production-derived.mjs`](../web/production-derived.mjs)：认证后的本地资源与浏览器转换                                 |
| 着色器         | [`web/production-shaders.mjs`](../web/production-shaders.mjs)、[`web/sealed-runtime/dotnet-worker.mjs`](../web/sealed-runtime/dotnet-worker.mjs)：保留的 .NET 着色器运行时与 SPIRV-Cross |
| 资源           | [`web/resource-folder-export.mjs`](../web/resource-folder-export.mjs)：新建子目录、流式分块和未完成标记                                                                                  |
| IPA            | [`web/browser-blob-output.mjs`](../web/browser-blob-output.mjs)、[`web/browser-staged-output.mjs`](../web/browser-staged-output.mjs)：暂存校验与有上限的最终 Blob                        |
| 公共运行时构建 | [`web/runtime-build/README.md`](../web/runtime-build/README.md)：开发者组装、固定清单与部署产物                                                                                          |

完整的规范化着色器源码摘要必须匹配模板的 `SHADER_SRC`。只替换着色器链名称，
不能让不兼容源码通过。固定的模板哈希、清单和实际 Mach-O 目标仍是校验条件。
Guest.framework 可能带有链接器风格的 ad-hoc 结构签名；这不代表用户的签名身份，
也不授权安装。限定范围的无 DLC 可执行文件变体同样需要重新签名，见
[内容模式](../web/D2R_RUNTIME_CONTENT_MODE.md)。

## 隐私、限制与失败处理

私有游戏内容与密钥保留在本地，不使用远程转换服务，也不提供运行时 CDN 回退。
公共资源下载不是上传私有输入。原型没有强制 CSP 网络封锁。仍需在构建产物上验证
不上传行为以及失败、取消路径的网络请求；源码意图不等于已实测的网络审计。
不要把密钥内容放入日志、URL 或持久缓存。JavaScript 内存清理是尽力而为，不能保证安全擦除。

报告成功前必须校验边界、校验和、归档路径、输入真实性和输出清单。
ZIP32、阶段内存限制、OPFS 配额及输出 Blob 上限可能拒绝体积很大的合法输入。
大体积资源单独流式导出，但最终 IPA 不是通过文件选择器流式写出。不得宣称容量无限
或已通过生产规模耐久验证。取消会关闭一次性会话，必须刷新后再试。
未完成资源有明确标记；后续 IPA 失败不会使已经独立完成的资源目录失效。

Windows/macOS 上的 Chromium 是目标桌面平台，不代表所有浏览器或版本都已通过验证。
能力检测和真实目标目录、配额行为仍需按平台验证。不得悄悄改用上传处理，也不得把合成产物称为可玩版本。

## 尚待完成的验收

- 构建当前不含 Python 的源码，部署前验证完整运行时清单、许可证、固定哈希和 worker 初始化。
- 执行仓库与浏览器检查，记录准确版本、平台和结果；历史通过不能证明新改动。
- 获取改动后的界面截图，核对中英文文字与注释，并满足统一字符串表要求。
- 测试 Windows/macOS Chromium 完整流程、取消、内存/配额/磁盘限制、浏览器下载和私有数据网络行为。
- 私下将认证后的真实本体/更新/可选 DLC 输出与匹配的原生参考比较，包括完整着色器摘要和资源。
- 另行签名、安装并测试支持的设备、实际游戏及存读档。不得把游戏输入、密钥或生成的安装包上传为 PR 证据。

[PR 准备清单](WEB_PR_READINESS.zh-CN.md) 记录待办检查，不替代或放宽
[参与开发要求](../CONTRIBUTING.zh-CN.md)或 [PR 模板](../.github/PULL_REQUEST_TEMPLATE.md)。
操作细节见[前端概览](../web/README.md)、[生产流程](../web/PRODUCTION_FLOW.md)
和[测试说明](../web/TESTING.md)。
