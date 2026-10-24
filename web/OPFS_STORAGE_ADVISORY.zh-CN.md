# 浏览器源存储建议

English: [OPFS_STORAGE_ADVISORY.md](OPFS_STORAGE_ADVISORY.md)

`readOpfsStorageAdvisory({ storage, requiredBytes, timeoutMs, signal })` 默认只查询
`navigator.storage.estimate()`。不申请持久化、不改变权限、不枚举目录、不读取
用户文件，也不预留磁盘。可选 storage 对象是测试/集成接口；显式 `null` 表示
不可用。默认超时 1000 ms，可显式指定 1–30000 ms。

冻结结果包含：

- `status`：`estimated`、`unavailable`、`invalid`、`timeout` 或 `cancelled`。
- `quotaBytes`、`usageBytes`、`availableBytes`：有效估算时为非负安全整数，
  否则为 `null`。可用量为 `max(0, quota - usage)`。
- `requiredBytes`：调用方提供的已知暂存需求，否则为 `null`。
- `sufficiency`：`unknown`、`estimated-sufficient` 或 `estimated-insufficient`。
- `advisoryOnly`：始终为 `true`。

API 缺失/拒绝、数值无效、超时和取消都返回未知容量，不抛出操作阻断。没有估算
表示未知，不是零可用空间；有效零估算与未知不同。缺失、负数、小数、非有限值、
不安全整数、字符串及 BigInt 均为无效估算，不强制转换类型。错误调用参数抛出
TypeError，避免把配置错误默认为可信需求。平台估算不能真正取消；迟到结果或
拒绝仍被观察，但不会改变已经返回的结果。

`requiredBytes` 必须是独立已知的暂存需求。没有它，即使 quota/usage 可用，
sufficiency 仍为未知。不得由 NSP 输入大小推算所需空间。ASTC `maxPackBytes`
包括 8 GiB 上限，只是容量限制，不是必需分配或预留；不能要求启动前整个上限
都可用。

UI 应标注估算的浏览器源暂存容量，不是物理磁盘剩余空间，也不是所选外部输出
目录的剩余空间。配额可能包含其他同源存储且会在作业期间变化。即使结果为
`estimated-sufficient` 也不保证写入成功。正常模式中此建议不应阻断操作；真实
写入失败才是实际依据。建议查询取消本身不授权继续已取消的打包任务。不需要
新选择器、保留文件句柄、持久化弹窗或权限变更。

`node --test web/tests/opfs-storage-advisory.test.mjs` 用合成替身覆盖容量计算、
已知需求、API 不可用、无效数值、有界超时、迟到拒绝、取消，以及不调用持久化
或文件 API。
