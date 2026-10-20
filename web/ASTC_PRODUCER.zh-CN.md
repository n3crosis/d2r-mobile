# 已初始化 ASTC 生成器生命周期

[English](ASTC_PRODUCER.md)

父级客户端与专用工作线程连接有界记录 RPC、校验流式解码器、逐个纹理与描述任务、CASC 包写入器及固定编码器。这是内部基础设施；这些模块不启用 UI、不下载资产，也不认证调用方任意提供的元数据。

## 初始化与 API

密封加载器仅使用已验证的工作线程代码及四份公开字节调用 `await createAstcProducerClient({worker,assets,signal})`：`astc-encoder.mjs`、`astc-encoder.wasm`、`png-codec.wasm`、`sha256.wasm`。四个准确 ArrayBuffer 全部转移后，且真实 ASTC、PNG、SHA 初始化成功，才返回 `{initialized:true,produce,close}`。可选清单选择由加载器负责；默认初始化不得下载此可选闭包。

工作线程仅导入固定打包实现。ASTC 工厂从已验证字节 Blob 导入；`wasmBinary` 与显式字节实例化钩子提供模块。`locateFile` 仅接受准确 ASTC WASM 文件名并解析到已验证 Blob。临时 URL 在初始化后撤销。初始化前即阻止线程 fetch/XHR，并持续阻止。这不是针对恶意同源代码的沙箱。

`produce(extracted,selection,{root,maxEncodedBytes,maxDecodedBytes,maxPackBytes,batchBlocks=65536,signal,inactivityTimeoutMs=300000,overallTimeoutMs,onProgress})` 仅允许一次。编码与解码预算为不超过 uint32 的正安全整数；包预算为不超过 2^40 的正数；每批 1–65,536 块。调用方不能用自有行、文件名、CKey、EKey、TVFS 或包位置替代认证输入。

父级亲自枚举首匹配认证记录、打开原始 WeakMap 令牌、读取并复制有界认证 TVFS，并在预留默认覆盖层位置后预留包位置。每个 RPC 来源额外检查 `[record.offset,record.offset+encodedSize]`，同时保留绝对 BigInt 偏移及归档大小。工作线程元数据与随机描述符只来自此可信父级。CFT 查找、暂存、转换、压缩及最终 SHA 均在线程中运行。

## 进度与期限

初始化期限为 60 秒。生成默认使用五分钟不活动期限，最多可配置为两小时，而非隐含总运行时间截止。只有已验证且严格推进的工作计数可以续期：完成的 ASTC 批次、成功暂存写入或回填，以及成功 SHA 更新。不发送纯定时心跳。单次同步 ASTC 批次无法中途报告，因此应根据设备及批次大小选择不活动预算。只有明确提供 `overallTimeoutMs` 才设置总期限，最大 2,147,483,647 毫秒。

可选 `onProgress` 收到冻结的 `{phase,processedBytes,completedBlocks,completedRecords?}`，阶段为 `preparing`、`converting`、`complete`。转换通知最多每秒十次；忽略观察者抛出或异步拒绝。字节数表示已完成暂存、回填与散列工作，不代表原始数据百分比。块计数包含实际编码的拼图填充块。不报告路径或键。SHA 适配器可选 `hashFile(file,{signal,onProgress})` 仅在成功散列更新后报告 `{bytesHashed,totalBytes}`，并同样隔离观察者失败。

## 最终产物与所有权

成功返回 `{source,pack,records,index,count,dispose}`。`source` 包含结构化克隆的最终 File、准确大小及可取消的 `readAt(number,count,{signal})`，读取上限 64 KiB。文件分片读取期限为 30 秒。传输时从不把整个包转为 ArrayBuffer。父级检查 File 大小、预留归档名、摘要形式、有界且唯一的所选记录、连续偏移、匹配的位置字节、准确计数，以及包含 `# pack` 头的完整写入器索引。摘要由已初始化固定线程计算；单独结构校验不能认证外部 File 或哈希。

父级在线程获得目录句柄前创建并保留独立作业目录租约。成功后终止工作线程并关闭记录 RPC，但保留租约直到导出结束。调用 `result.dispose()` 或 `client.close()`；两者归并到同一可重试清理。取消或失败时先停止线程与 RPC，再清理。待完成或失败清理错误保留 `error.lease` 及内部 `cleanupCause`；调用方必须保留并重试租约，不应暴露内部诊断原因。目录删除错误不得静默视作成功。原生文件系统写入可能在线程终止后才结束，因此删除或锁定失败仍可观察，不宣称线程终止等于存储已静止。

## 证据与限制

合成测试验证认证提取样本经绑定来源 RPC、输出 File 所有权、畸形初始化、取消、进度续期与停滞及显式期限、清理重试，以及真实包写入器收据兼容性。线程、编码器与目录替身均明确为合成。既有真实 WASM 冒烟测试独立存在。浏览器线程 Blob 加载、终止时真实 OPFS 行为、完整可选运行时初始化及设备内存性能仍需浏览器验证。不使用游戏输入，不宣称完整原生转码等价。

工作线程失败只暴露经过验证的 `detailCode`：`STORAGE_QUOTA`、`SIZE_LIMIT`、`INTEGRITY_FAILED` 或兜底 `CODEC_FAILED`。原始错误文本、文件名及键不会跨越线程错误边界。内部清理诊断仍归租约所有，不面向用户显示。
