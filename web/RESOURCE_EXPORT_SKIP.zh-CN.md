# 可选原始资源导出

[English](RESOURCE_EXPORT_SKIP.md)

`generate({exportResources: false, ...})` 在重建 IPA 时仅明确跳过原始 RomFS
资源目录复制。默认值为 `true`；其他类型在目录权限检查和消耗作业之前拒绝。

成功和失败结果均使用 `resources: {status: "skipped", reason: "user-requested"}`。
不发送资源完成事件。这不会检查、验证、复用任何已有目录，也不声称本次已经导出。
已有资源仍须独立满足游戏要求；调用方只是选择省略此次复制。

NSP 认证、认证资源读取、程序/资源/着色器生成、IPA 验证、目录权限和输出位置保持不变。
已启用的 Legacy Device Pack 导出仍然必需，不能被此选项跳过，其失败仍阻止 IPA 完成。
不修改源文件，不增加上传或签名。聚焦的合成策略和源码接线测试不构成浏览器证明。
