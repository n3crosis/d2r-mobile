# 游戏软件包包含规则

English: [NSP_PRESELECTION.md](NSP_PRESELECTION.md)

选择文件夹，然后生成 IPA。文件夹选择器自动识别 NSP/XCI 软件包或完整、已合并的 ExeFS/RomFS 布局。存在软件包时始终优先使用软件包；缺少或无效的密钥不会触发已提取输入回退。

包含所有发现的软件包，包括提供的 DLC。不再提供软件包复选框或基于文件名的预选规则。若要排除软件包，请将它移出所选输入文件夹。切换文件夹会重置资源复用选项。

文件名不能证明真实性。接受的游戏、版本、更新和 DLC 仍由已认证的软件包元数据决定。不相关或含糊的软件包会验证失败，而不是被静默忽略。没有 DLC 时不要求提供。已提取输入仍仅限合并的基础游戏与更新内容，不认证 DLC 元数据。

惰性界面与状态测试：在 `web` 运行 `node --test tests/packager-features-ui.test.mjs tests/simple-packager-flow.test.mjs`。这不代表已通过浏览器、游戏或设备验证。
