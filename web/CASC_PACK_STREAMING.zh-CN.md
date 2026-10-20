# 有界补充 CASC 数据档原语

English: [CASC_PACK_STREAMING.md](CASC_PACK_STREAMING.md)

`casc-pack-writer.mjs` 是独立内部原语，尚未连接浏览器 UI、壳加载器、资源转换、导出流程或安装。它实现 `dm/tools/casc_overlay.py` 的 `write_pack`、`blte_encode`、`ekey_for` 序列化规则，以及 `dm/tools/astc_pack.py finalize` 的 `{name,size,sha256}` 元数据形状。没有包含或访问任何游戏文件或密钥。

## 契约

`writeCascPack({jobs, location, locationAvailable, root, maxPackBytes, expectedEntries, codec, hashFile, signal?})` 串行消费异步任务序列。每项为 `{path,spec,decodedSize,source}`：

- `path` 是已存在且规范化的小写逻辑路径，不支持 `+` 新增。拒绝以 `#` 开头的路径，因为原生 `read_prebuilt` 会把该 TSV 行视为注释。拒绝重复、不合法以及 UTF-8 超过 4096 字节的路径。在分配规范化/验证中间结果之前，先以低开销检查 4096 个代码单元上限。写入器不解析或认证路径。先对有界原始 TVFS 使用 `inspectCascPackStorageSpecs`，沿用其 `spec`；`decodedSize` 是替换内容的长度，不是原条目长度。
- `spec` 必须恰为 `n`、`z` 或 `b:256K*=z`。保留原规格，不默默转换。
- `source` 是普通、不可调整大小的 `Uint8Array` 块组成的异步可迭代对象，完整底层缓冲区最多 1 MiB。在消费推进前，生产者不得修改已产出的缓冲区。即使视图很小，底层缓冲区超限也会拒绝。输入消费量必须恰好等于无符号 32 位的 `decodedSize`。
- `location` 为 `[chunk,archive]`，两者都是 0 到 255 的整数，符合原生 8/8/40 EKey 布局。`locationAvailable(name,{signal})` 只有在核查原始归档及计划输出均无重名后才能返回严格的 `true`。这个受信任宿主回调不是原子预留或认证边界，必须使用实际源清单，而非未经验证的用户声明。
- `maxPackBytes` 是显式安全整数，最大 `2**40`；每个条目的偏移必须小于 `2**40`。编码和解码条目长度均保持无符号 32 位。`expectedEntries` 必须与实际任务数一致，最多 32,768 项；路径字节总数最多 8 MiB。现有覆盖层上限不变。
- `codec` 必须是受信任、固定来源的编解码器，提供 `genericZlibVersion === "1.2.13"` 和 `compressZlibStream`。版本属性是契约检查，不是来源证明。压缩使用级别 9、有界输入输出预算，并且一次只运行一个编解码流。
- `root` 是调用方提供的 OPFS 根目录。默认的 `createRawFileStage` 仅创建并拥有自己的唯一临时子目录。没有内存回退、源目录写入或网络操作。可选的 `createStage` 参数用于依赖注入和测试；注入实现必须遵守相同的有界所有权契约。
- `hashFile(file,{signal,chunkBytes})` 是显式的受信任宿主依赖。它必须增量计算最终 File 的 SHA-256，每次读取不超过 `chunkBytes`（1 MiB），遵守取消信号，并返回 `{sha256,bytesHashed}`。写入器在返回前检查小写 64 字符摘要和精确字节数，但无法证明注入回调确实读取或哈希了字节。生成的哈希仅描述本次输出，不能认证外部提供的内容。这里没有新增密码学实现。

## 输出与内存

结果为 `{source,index,records,pack,dispose}`。`source` 是已完成且可重放的原始暂存源（`file`、`size`、有界 `readAt`）；`index` 是兼容原生的 `pack_index.tsv` 文本，以 `# pack\t<name>\n` 开头；每个冻结条目为 `{path,newEkey,encodedSize,decodedSize}`。`pack` 为 `{name,size,sha256}`。调用 `patchCascPrebuiltReferences` 前，将条目与原有 `oldEkey` 关联合并。本模块不修改 TVFS、不创建 ASTC 变体，也不发布或安装数据档。只有在下游消费者完成后才调用 `dispose()`；它会删除拥有的临时暂存。

不拼接完整条目或完整数据档。原样/zlib 流通过串行背压追加。BLTE 使用一个 256 KiB 解码块、一个有界编码块，以及最多 393,228 字节的预留后回填头部。空 BLTE 采用原生单个 `N` 块表示。EKey 使用 BLTE 头部或原始编码字节的 MD5 加上位置。即使 `n` 条目以 `BLTE` 开头，也保留原生按魔数判定的行为，包括零长度哈希前缀。索引文本和条目/路径集合是有界元数据，而非常量内存结构；最终合并索引时，它会与各行字符串短暂并存。输入生产者、编解码器及哈希回调的内存属于独立受信任职责。

暴露结果前会检查任务完成、输入耗尽、编码长度、暂存快照大小和最终哈希字节数。取消会与迭代器推进、位置检查、暂存获取/操作、编解码输出和最终哈希的等待竞争，因此挂起的等待不会无限阻止拒绝结果。它请求关闭迭代器并清理拥有的暂存；清理也失败时，以 `cause` 保留主错误。清理等待上限为 1000 ms；若仍未完成，`AggregateError` 包含 `CASC_PACK_CLEANUP_PENDING` 和一个返回全部结算结果的 `cleanup` Promise。这报告的是清理未完成，而不是取消已完成。即使已经拒绝，迟到获取的暂存仍保留清理处理器。不同的迟到获取失败（包括获取时的清理失败）仍在聚合错误或挂起的 `cleanup` 结算结果中可见；仅与主错误为同一对象的错误会去重。原始暂存清理仍会先等进行中的文件系统操作结束再删除；写入器不会抢在挂起写入之前删除。外部回调与源必须配合才能真正释放资源。此机制不能中断同步阻塞的 JavaScript。成功返回后，调用方仍须等待 `dispose()`；其原始暂存排空语义不变。

## 验证与限制

运行可移植的合成序列化测试：

```
node --test web/tests/casc-pack-writer.test.mjs
```

默认编解码器明确为使用宿主 Python zlib 的测试替身，其预期版本字段是模拟值。内存暂存也为测试替身。这些测试证明所测输入上的原生序列化、索引和 EKey 一致性，不是固定版本编解码器或浏览器内存证明。

已有原生编解码器库构建完成时，可通过其真正固定版本的流式 C ABI 运行同一组测试：

```
CASC_PACK_NATIVE_CODEC="$PWD/web/toolchain/png-codec-exact/dist/png_codec_native.so" node --test web/tests/casc-pack-writer.test.mjs
```

可选桥接会断言库报告 zlib 1.2.13，并按 64 KiB 分块调用 `zlib_begin`/`zlib_push`。开发时两种模式均通过全部十六项测试。固定版本库的编码字节与宿主 Python zlib 1.3.2 下未经修改的原生 `casc_overlay.py` 一致，但仅限这些合成样本。覆盖 n/z/多块 BLTE/空条目、按魔数生成 EKey、精确索引和 SHA-256 元数据、位置冲突预检、计数/预算检查、底层缓冲区上限、串行写入、取消清理、各类失败以及编解码器未完整消费输入。桥接自身会缓冲小型测试样本，不是生产代码。

未测试真实浏览器、OPFS 配额/设备行为、本写入器的 WASM 集成、大包性能、游戏加载或端到端补充包安装。原始 CFT 解析、资源转换、受信任流式 SHA-256、原始位置清单、导出集成及浏览器/设备验证仍属于调用方或集成工作。
