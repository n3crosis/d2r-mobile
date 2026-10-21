# NSP 文件名预选

English: [NSP_PRESELECTION.md](NSP_PRESELECTION.md)

当恰好一个文件名包含方括号包围的 D2R 基础包标准标题 ID，且至少一个包含更新标题 ID 时，文件夹选择器只预选这些基础包和更新文件。Warlock DLC 仍留在文件夹中，但在用户显式选择前不会勾选。标题 ID 与 `d2r-expansion-policy.mjs` 共用。多个更新候选仍须经过认证后的版本与歧义检查。

现有回退行为不变：没有上述可识别的基础包与更新组合时，初始选中所有发现的 NSP 名称。复选框仍可修改。更换文件夹或修改复选框选择会重置原始资源复用选项。

文件名仅是选择提示，不是认证。给无关包改名不能绕过已认证的元数据、内容摘要、标题、版本或可执行文件检查。未提供 DLC 时不要求 DLC。

合成测试：在 `web` 运行 `node --test tests/nsp-default-selection.test.mjs`。这不代表已通过游戏或设备验证。
