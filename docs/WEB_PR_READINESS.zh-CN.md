# 浏览器改动：PR 准备清单

English: [WEB_PR_READINESS.md](WEB_PR_READINESS.md)

本清单补充但不替代或放宽[参与开发要求](../CONTRIBUTING.zh-CN.md)
与 [PR 模板](../.github/PULL_REQUEST_TEMPLATE.md)，不代表已经可以提交 PR。
只有在检查准确的改动并记录版本、平台和实际输出后才能勾选。仅下文明示记录的源码检查报告为已执行。
155fd76 的完整浏览器构建与发布已通过；后续修改仍需各自检查。
游戏/设备测试和截图仍待补充。本次工作没有创建 PR。

## 已发布检查点与待验证工作

已发布 `155fd764add607adf9070fafd5fdf58e40296408`，
[Verify 39549460300](https://github.com/n3crosis/d2r-mobile/actions/runs/39549460300) 成功。
产物、摘要与 2026-10-21 05:32:00 UTC 部署凭据见[交付状态](WEB_DELIVERY_PROGRESS.zh-CN.md)。

默认输出仍为未签名 IPA。可选的本地 zsign WASM 签名接受 P12/PFX 证书和描述文件，
不上传凭据。兼容性检查不证明证书信任、吊销状态或设备资格。
签名失败或取消后，可重新选择凭据，基于保留的未签名 Blob 重试，
无需重复 NSP 转换或资源导出；已完成的未签名下载和资源结果仍可使用。

本次发布包含签名堆及可变文件系统的提前释放、来源 Blob 复用，
以及用户的提取进度和 Pillow 兼容 BC3 修复。这些属于实现改进，
不代表已测得浏览器 RAM 或速度收益。浏览器运行时保留 .NET，但不含 Python
运行时、包或脚本；Python 构建及参考工具另行区分。
构建和合成检查不证明真实游戏转换、真实凭据签名、安装或运行。

历史双构建证据仅适用于 `e93a15a` / `32e9717`：该产物对的全部 297 个逻辑资源和
33 个运行时载荷相同，包括 .NET 启动/主程序集与 SPIRV；仅外层 `build.sourceRevision`
改变。这一观察不证明普遍构建确定性，也不为后续构建提供认证。

## 改了什么 / 为什么

浏览器文字正在对齐统一的中英字符串表约定；浏览器文档现在有内容对应的简体中文版。
文档将浏览器移除 Python、保留 .NET 着色器、可选 title keys/票据，以及
单目录/资源子目录/Blob IPA 行为，与部署状态和真实游戏证据明确分开。

浏览器专用键在 `dm/i18n/ui_text.tsv` 中使用 `dmWeb*` 前缀。
浏览器支持英文和简体中文：浏览器语言为 `zh*` 时选择中文，否则使用英文。
TSV 必填的西班牙语/俄语字段明确回退到英文；这不代表浏览器已提供西班牙语或俄语本地化。
原生覆盖层生成排除浏览器键，避免改动游戏文字。修改统一表后，应重新生成两个派生产物：

```sh
python3 web/scripts/generate-i18n.py
python3 dm/ios/tools/dm_i18n.py --header > dm/host/dm_i18n_tab.h
```

生成不是编译，也不能证明下面的检查通过。提交前审查生成差异。
本次工作不能证明所有历史浏览器实验、注释或文档均已实现双语覆盖。

## 未改动的 PR 模板中的检查

以下已勾选源码结果是 2026-10-20 的历史记录，包括当时的 553 条字符串数量，
不是当前字符串表清单。

不需要游戏文件（下列为历史记录输出，本次文档更新未重新运行）：

- [x] `python3 dm/i18n/scan_literals.py` — `I18N OK：中文字面量 459 条全在白名单（105 行），其余走中英表`
- [x] `python3 dm/ios/tools/dm_i18n.py --check` — `dm_i18n OK 553 条`

需要游戏文件与经 `./setup.sh` 准备的工作区：

- [ ] `make -C dm/host/tests run`
- [ ] `make -C dm/gfx/tests run`
- [ ] `make -C dm/ios/tests test`
- [ ] `dm/verify/regress.sh`（若修改了 `dm/tools/patch_nso.py`，加 `--fresh`）
- [ ] `cd dm/ios && ./run.sh build`
- [ ] `dm/ios/tools/smoke_mac.sh 1`
- [ ] `dm/ios/tools/check_hud_gen.sh`

本工作树还执行并通过一项只读源码检查：`python3 web/scripts/generate-i18n.py --check` — `Browser i18n catalog is current`。这些源码检查于 2026-10-20 通过；它们不代表游戏或构建验收。

其他检查单独记录准确命令和结果，包括源码风格检查、浏览器测试与运行时验证。
不要从文字生成或静态审查推断这些结果。

## 可见改动、内容与注释

- [ ] 附上浏览器可见改动之后的两种语言截图。
- [ ] 确认新增/修改的屏上文字已登记到 `dm/i18n/ui_text.tsv`，两个生成表与它一致；审查剩余的写死文字，包括错误信息。
- [ ] 确认没有包含游戏文件、游戏派生产物、密钥或构建后的安装包。
- [ ] 确认没有包含 `./setup.sh` 对 `dm/gfx/tools/dmsh_chain.lock`、`dm/gfx/nvn/dmsh_chain.h` 或 `dm/gfx/nvn/c1_full.tsv` 的本地改写。
- [ ] 审查所有新增/修改注释及源码文件头，确保中英内容对应，并说明用途与实现依据。
- [ ] 审查对应文档与跨语言链接；宣称完整合规前，列明仍缺少中文对应版本的历史文件。

本次可见界面改动不适用“屏上没有变化”选项，不得用它代替截图。
完整验收还需要真实输入、私下进行的原生/浏览器对比、存储/网络失败测试，
以及另行签名后的设备/游戏验证，见[实现与验收](WEB_IPA_PACKAGER.zh-CN.md)。
不得用私有输入、密钥或生成的安装包作附件证据。
