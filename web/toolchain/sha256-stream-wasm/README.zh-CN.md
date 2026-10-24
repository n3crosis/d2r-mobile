# 有界流式 SHA-256 原语

English: [README.md](README.md)

此原语对暂存的本地 File/Blob 进行散列，无需将整个文件读入内存。它在可选 `legacy-astc` 工作线程中复用固定版本的 hactool/mbedTLS 源码。浏览器界面预加载经过校验的字节并按需启动线程；直接调用 API 时需明确选择该可选组。参阅[可选运行时资源](../../runtime-build/OPTIONAL_ASSETS.zh-CN.md)和[生成器生命周期](../../ASTC_PRODUCER.zh-CN.md)。

## 来源与边界

`source-pin.json` 独立固定已有 hactool 的准确提交、mbedTLS 2.6.1 SHA-256 实现与头文件、Apache 许可证以及最小配置。显式源码检出目录必须同时匹配提交和逐文件字节长度/SHA-256。不下载、不安装、不猜测缓存目录。未修改的上游源码使用独特命名的 `sha256_config.h` 编译，仅定义 `MBEDTLS_SHA256_C`；不包含上游默认配置、TLS、通用摘要分派、替代实现或自检 I/O。

`bridge.c` 保留一个 SHA-256 上下文、一个 64 KiB 输入缓冲区和 32 字节结果。生命周期仅为 begin → 零或多个有界 update → finish，或 abort。忙碌时 begin 失败。每个操作都要求当前非零代次令牌，令牌不回绕或复用；过期所有者不能清除新散列。超长更新只使其有效所有者失效。成功更新后擦除输入；finish/abort 清理上游上下文及输入。abort 也擦除结果；完成的结果暂留供适配器复制，下次 begin 时清除。不使用解析器状态、密钥 API、动态分配或文件系统。

独立 WASM 配方使用已有 emsdk 4.0.20，固定 256 KiB 线性内存、16 KiB 栈、不允许内存增长且要求零宿主导入。这些是构建门槛，不是浏览器验证证据。产物大小必须实测，不能估算。`dist/build-report.json` 记录准确编译器文本、来源固定值、本地源码摘要、规范化参数、原始/gzip 字节大小及产物 SHA-256。许可证随产物提供。其中现有的编解码器局部字段 `productionEnabled: false` 是遗留的独立构建元数据，不表示可选清单的选择状态；它既不会禁用已接线的可选路径，也不认证该路径可用于生产。外层运行时的独立发布门槛保持不变。

## JavaScript API

`await createSha256FileHasher(wasmBytesOrModule)` 返回 `{ hashFile }`。调用方发布加载器必须认证 WASM 来源及预期摘要；工厂本身在读取私有内容前检查导入闭包、内存大小以及拒绝内存增长。`createSha256FileHasherFromAbi` 是显式的低层模拟测试接缝，不是来源认证。

`await hashFile(file, { signal?, onProgress? })` 返回冻结的 `{ sha256, bytesHashed }`，复制摘要后立即擦除原生结果缓冲区；仅接受大小为安全整数的 File/Blob。适配器通过 `file.slice(offset, offset + length).arrayBuffer()` 逐片读取不可变快照，每片最多 65,536 字节，并检查实际返回大小。不会调用整个文件的 `arrayBuffer()` 或拼接输入。每次 update 完成后才读下一片，每 16 片让出一次任务以处理取消。同一实例拒绝并发调用。可选 `onProgress` 仅在一次有界散列更新成功后收到冻结的 `{ bytesHashed, totalBytes }`。它报告已完成的工作，而不是定时心跳；观察者抛错或 Promise 拒绝都不会影响散列或所有权。

取消可抢先结束等待中的读取并立即释放原生所有权。旧的已取消请求迟到的结果或清理不能写入或释放后来的请求。浏览器 API 已开始的文件读取无法强制停止，其最终结果会被丢弃。读取/update/finish 失败会清理当前所有者，不回显输入内容。不要仅丢弃进行中的操作，应使用其 AbortSignal 取消。

对于需要回填头部的 CASC 数据档，应散列完成且已关闭的暂存快照，而非未完成的流。内容摘要只提供完整性证据，不证明来源真实性或权限。现有提取工作线程刻意保持不变：它只能取得一次，当前整输入散列会关闭解析器状态。

## 检查与构建

使用已有的准确检出目录，例如：

    node web/toolchain/sha256-stream-wasm/native-test.mjs --source /tmp/hactool-source-probe
    node --test web/toolchain/sha256-stream-wasm/adapter.test.mjs

原生测试使用已安装的 `cc`（或 `CC`）及 Python 标准库，创建隔离临时共享库，结束后删除。它验证三个已知答案向量、39 个与 hashlib 对照的填充/分块用例、所有权、长度拒绝及擦除。模拟 ABI 的 JavaScript 检查另行覆盖有界读取、准确计数、复用、挂起读取取消、过期完成及失败；它们不是 WASM 执行证据。

已有编译器环境可用时：

    node web/toolchain/sha256-stream-wasm/build.mjs --source /explicit/pinned/hactool-checkout
    node web/toolchain/sha256-stream-wasm/wasm-smoke.mjs

这些命令不安装编译器。独立 WASM 冒烟检查验证构建回执，并与 Node crypto 对照小文件摘要。现有提取构建已将其固定的 `$SRC` 直接传给该构建与冒烟检查，无需另取源码或新增 CI 作业。运行时组装先验证回执及本地源码摘要，再将 WASM、许可证和报告纳入可选组。选择该组时，初始化会在私有输入之前校验并初始化这些公共字节；工作线程之后不会再获取编解码器。

**超过 4 GiB 的字节计数器进位验证仍待完成。** 原生与 WASM 冒烟报告将 `greaterThan4GiBCarryVerified` 保持为 false；小文件测试不能覆盖此边界。验证整包散列时必须保留这一限制。
