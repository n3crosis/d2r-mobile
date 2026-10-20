# 隔离的已认证 ASTC 包任务

English: [ASTC_PACK_JOBS.md](ASTC_PACK_JOBS.md)

仅源码候选；不声称已接入 UI、生产运行时或验证设备。

`createAuthenticatedAstcPackJobs(extracted, selection, options)` 返回
`{ jobs, maxEntries, dispose }`。必需选项为调用方拥有的暂存 `root`、正 uint32
`maxEncodedBytes`/`maxDecodedBytes`、1–65536 的 `batchBlocks` 和受信任 `encode`
函数。可选 `signal` 与 `createStage` 支持取消和暂存接线。认证入口固定且不可注入：
外观枚举原始 WeakMap 绑定的首行令牌，`readAuthenticatedCascVfs` 读取
`data/.build.config` 并通过已有有界 TVFS 解码器验证 `vfs-1`。
公开 API 不接受调用方 VFS、清单行、EKey 或认证标志。

将 `jobs` 与 `maxEntries` 交给包写入器的有界未知数量模式。每个任务为
`{ path, spec, decodedSize, source }`，source 为单次异步字节迭代器；必须完全消费
后再请求下一任务。提前推进会失败，返回外层迭代器会清理当前暂存。所有者应在
finally 中调用 `dispose()`，包括尚未开始迭代的情况。

每张纹理只解码一次，得到单个已验证完整性的私有暂存，之后才检查头部；不支持
格式直接跳过，无第二次解码。转换由包写入器背压驱动。源消费后先释放暂存，再
打开下一记录。描述缓存必须存在并最后输出，只使用成功转换的路径及 sRGB 标志。
JSON 保留已有 16 MiB 输入、32 MiB 输出上限；输入输出缓冲用后清零。不提高原有
归档或纹理限制。原始 CFT 存储规格和大小通过单个可复用有界查询快照验证，不为
每张纹理重建完整表字符串。

取消即使在外层迭代器暂停时也关闭当前暂存。清理幂等，每次等待最多一秒，不覆盖
已知转换错误。父级仍须拥有全新 OPFS 任务目录，以便在线程终止或文件系统挂起后
清理。在包写入器消费所有任务并验证完整包之前，不得发布最终产物。纹理部分输出
仅是内部包暂存，不是已验证最终产物。

## 工作线程边界

`createAstcPackJobsCore({ selected, vfs, openRecord, ...options }, dependencies)`
是内部、不授予认证的内核。selected 包含有界纹理和最后描述缓存句柄；openRecord
仅解析受信任父级签发句柄，返回 `{ source, record }`。在线程中，源必须是绑定的
反向读取 RPC 能力；记录元数据来自父级初始化，不来自用户 EKey 或线程路径请求。
内核接管 VFS 字节，完成、取消或释放后清零；它本身不建立来源证明，不能把合成
执行成功称为提取认证。

固定公开外观目前可同步用于测试。重型 CFT、解码、纹理及描述缓存处理最终必须
在独立线程中执行；原始 WeakMap 令牌留在父级，不可克隆。暂存和转换依赖注入仅
供受信任代码。模块尚不实现该线程生命周期或 UI 集成。

`node --test web/tests/astc-pack-jobs.test.mjs` 使用合成 RomFS/config/TVFS、
真实记录校验和转换结构，搭配模拟 ASTC 编码器及内存暂存。覆盖单暂存峰值、每条
记录仅一次解码、跳过、描述缓存顺序与格式、提前返回/推进、取消、清理和伪造身份
拒绝。不构成浏览器、真实 ASTC 质量或游戏验证。
