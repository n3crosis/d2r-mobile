# 浏览器交付状态与历史验收

English: [WEB_DELIVERY_PROGRESS.md](WEB_DELIVERY_PROGRESS.md)

## 最近一次已验证的发布

[提交 26e4da7](https://github.com/n3crosis/d2r-mobile/commit/26e4da79b111d27afff781f1f77c0bae7ff3d6ac)
通过[完整 Verify 构建](https://github.com/n3crosis/d2r-mobile/actions/runs/39487373613)，
并于 2026-10-20 20:00 UTC 发布到既有的私有
[预览站点](https://d2r-ipa-packager.nicekrill34.chatgpt.site)。
已验证产物为 22,015,812 字节（压缩 ZIP 约 21.0 MiB，包含两种外壳目标），包含 .NET，
不含 Python 运行时、包或脚本。这是归档大小，不是浏览器内存测量。

该版本实现单目录本体/更新/可选 DLC 转换、可选 `title.keys` 与内嵌通用票据处理、
资源子目录输出和有上限的 Blob IPA 下载。目标为 Windows/macOS 桌面 Chromium。
页面可选择 iOS 26 或 iOS 18；两者仍要求 BC 纹理支持。
每次仅下载所选外壳及通用运行时：iOS 26 为 16,972,563 字节，iOS 18 为
16,968,646 字节（约 16.19 MiB，不含前端文件）。ASTC 补充包集成仍是独立工作。
见[实现与验收](WEB_IPA_PACKAGER.zh-CN.md)。

构建与发布成功不等于真实游戏输入转换、另行签名后的设备运行、实际游戏或内存/速度收益已验证。
后续源码修改仍需各自构建与发布；这里不宣称新的完成百分比。

## 历史基线：42 / 100

已停用的台账于 2026-10-20 审阅，覆盖到
[`664790f0b4d3cbe1082f174f0f1196164828d7f4`](https://github.com/n3crosis/d2r-mobile/commit/664790f0b4d3cbe1082f174f0f1196164828d7f4)。
42 分是规划权重，不是功能可用比例、剩余时间或成功概率。
下表摘要保留历史证据，不把已被后续工作替代的失败说成当前构建阻塞。

| 历史验收项                            | 权重 | 历史结果     | 得分 |
| ------------------------------------- | ---: | ------------ | ---: |
| I1 元数据、选择与 CASC 基础能力       |    3 | PASS         |    3 |
| I2 提取边界与生命周期                 |    5 | PASS         |    5 |
| I3 完整认证后的本体/更新/DLC 提取     |    4 | OPEN         |    0 |
| P1 合成程序/Guest 一致性              |    6 | PASS         |    6 |
| P2 真实程序改写与来源证明             |    4 | OPEN         |    0 |
| A1 原生美术与派生表                   |    4 | PASS         |    4 |
| A2 贴图/图集/PNG 组合                 |    3 | PASS         |    3 |
| A3 完整归档字体 HUD 一致性            |    4 | BLOCKED      |    0 |
| A4 剩余美术/覆盖层与清单              |    5 | OPEN         |    0 |
| S1 合成着色器链路一致性               |    5 | PASS         |    5 |
| S2 完整游戏着色器目录/摘要            |    7 | OPEN         |    0 |
| R1 应用模板解析与目标检查             |    3 | PASS         |    3 |
| R2 认证且与源码对齐的模板/目录        |    5 | BLOCKED      |    0 |
| O1 暂存输出与取消                     |    5 | PASS         |    5 |
| O2 生产规模输出/存储耐久验证          |    3 | OPEN         |    0 |
| J1 合成调度器失败时关闭               |    3 | PASS         |    3 |
| J2 从界面到导出的完整集成             |    9 | OPEN         |    0 |
| N1 封闭贴图/Python 组件证明           |    3 | PASS         |    3 |
| N2 封闭 .NET/提取运行时依赖闭合       |    5 | OPEN         |    0 |
| V1 真实输入原生/浏览器对比            |    6 | OPEN         |    0 |
| V2 签名后设备/游戏验收                |    4 | OPEN         |    0 |
| D1 小范围 Windows/macOS Chromium 探测 |    2 | PASS         |    2 |
| D2 托管发布/浏览器验收                |    2 | OPEN         |    0 |
| 合计                                  |  100 | 仅为历史记录 |   42 |

各项采用二值评分：PASS 得到全部权重，OPEN/BLOCKED 得零分。
合成证明不能计入真实输入或设备得分。N1 的 Python 证明属于历史，不能证明替代它的
无 Python 运行时。后续实现不追改这些权重，也不自动赋予未验证的验收分数。

## 历史证据登记

以下结果沿用此前台账，本次文档工作没有重新运行或独立复核。
每个链接只对应其自身版本和有限的验证范围。

| 编号 | 运行                                                                           | 版本     | 记录的结果与限制                                                                                                                                                     |
| ---- | ------------------------------------------------------------------------------ | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| W    | [39401602236](https://github.com/n3crosis/d2r-mobile/actions/runs/39401602236) | ad20d13  | PASS：较早的 Web、Node 22/24 和 C# 检查                                                                                                                              |
| W2   | [39403162062](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162062) | 664790f0 | FAIL：前端 JSON 格式；Node 的 284 项通过、1 项跳过不代表整个流程通过                                                                                                 |
| P    | [39403162102](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162102) | 664790f0 | PASS：合成 main/sdk 与 Guest 一致性                                                                                                                                  |
| H    | [39403162408](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162408) | 664790f0 | FAIL：32 MiB 下载上限截断 Pillow 源码，未进入一致性检查；较早的 [39401602167](https://github.com/n3crosis/d2r-mobile/actions/runs/39401602167) 在 HUD 一致性检查失败 |
| Y    | [39403161920](https://github.com/n3crosis/d2r-mobile/actions/runs/39403161920) | 664790f0 | PASS：封闭 Pyodide/Pillow/NumPy 子集，不含 HUD 任务                                                                                                                  |
| E    | [39403162222](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162222) | 664790f0 | PASS：封闭贴图子集                                                                                                                                                   |
| D    | [39403162155](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162155) | 664790f0 | PASS：小范围 Windows/macOS Chromium 探测                                                                                                                             |
| X    | [39403162100](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162100) | 664790f0 | PASS：提取边界与已知 DLC 集成，不是真实已签名游戏输入                                                                                                                |
| A    | [39400065001](https://github.com/n3crosis/d2r-mobile/actions/runs/39400065001) | ff42f2f  | PASS：HUD 之前的美术；b90743b 的 [39399152831](https://github.com/n3crosis/d2r-mobile/actions/runs/39399152831) 也覆盖原生美术/图集                                  |
| C    | [39403162096](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162096) | 664790f0 | PASS：SPIRV-Cross 1.4.363.0 原生/浏览器一致性，不是完整模板兼容性                                                                                                    |
| S    | [39403162064](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162064) | 664790f0 | PASS：合成着色器链路，不是完整游戏目录/摘要                                                                                                                          |
| O    | [39399152890](https://github.com/n3crosis/d2r-mobile/actions/runs/39399152890) | b90743b  | PASS：暂存输出完整性                                                                                                                                                 |
| N    | [39403162461](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162461) | 664790f0 | FAIL：.NET 发布/原生参考通过；打包准备错误地要求独立启动配置而非内嵌配置                                                                                             |
| T    | [39403162332](https://github.com/n3crosis/d2r-mobile/actions/runs/39403162332) | 664790f0 | PASS：自有工具链风格检查，不额外增加里程碑得分                                                                                                                       |

## 接下来需要的证据

使用未改动的 [PR 模板](../.github/PULL_REQUEST_TEMPLATE.md)和
[PR 准备清单](WEB_PR_READINESS.zh-CN.md)。新源码需要自己的检查结果、
中英文文字与注释审查，以及改动后的截图。发布验收还需要完整运行时组装/初始化、
Windows/macOS 浏览器验证、输出/存储/网络失败测试、私下进行的真实输入原生对比，
以及另行签名后的设备/游戏结果。不能仅因实现存在，就把检查标为完成。
