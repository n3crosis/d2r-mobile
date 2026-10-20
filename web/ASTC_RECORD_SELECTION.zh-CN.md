# 已认证 ASTC 记录选择

English: [ASTC_RECORD_SELECTION.md](ASTC_RECORD_SELECTION.md)

这是隔离的源码候选，不是 UI 接线或设备验证。

`enumerateAuthenticatedAstcRecords(extracted, selection, { signal })` 从
`readAuthenticatedAssets` 开始，检查私有提取身份、精确构建选择和有效会话。
返回冻结的 `{ textures, descriptor }`。每个贴图或描述缓存都是冻结的 `{ path }`
能力令牌，而非清单行。缺失描述缓存时返回 `null`；下游转换必须在发布完整包之前
要求其存在。副本、调用方 EKey、伪造行或认证标志都不能铸造令牌。

`openAuthenticatedAstcRecord(capability, { signal })` 向受信任解码器接线返回
`{ source, record }`。`source` 提供 BigInt 归档大小和
`readAt(BigInt offset, count, { signal })`；单次最多 64 KiB，范围限于所选编码
记录，每次读取前后检查会话。`record` 包含
`{ offset: bigint, encodedSize, decodedSize, encoding, ckey, ekey }`。
归档名称、块号、档号、偏移和大小只能来自绑定清单；大小须适合 uint32，范围须在
已认证归档内。这是元数据来源证明，不是载荷完整性证明：将此对直接交给有界流式
解码器，在发布暂存字节前验证 CKey/EKey。通用解码器也可接受合成底层输入，
绝不能把这种接受当成认证标志。

单独的 ASTC 扫描每次最多读取 64 KiB 已认证 `data/build_manifest.psv`。
遵循原生 ASTC 语义：去掉第一个冒号前缀、路径转小写，保留规范路径的首个匹配。
枚举 `.texture` 及 `data/hd/texture_desc_cache.json`，最多保留 32,768 条不同
记录和 8 MiB UTF-8 元数据。清单、行、路径和行数上限仍为 128 MiB、16 KiB、
4 KiB 和一百万。不缓存归档或解码内容。通用逻辑查询仍为最后一行优先，未改变。
额外扫描不会消除已有通用提取索引或其内存开销。

取消枚举会使保留令牌失效。打开及读取取消信号与该生命周期信号合并；会话释放
使未打开令牌和已打开源都失效。底层 `createCascAstcRecords` 导出仅供合成解析
测试使用，本身不授予认证。

测试命令：`node --test web/tests/astc-record-selection.test.mjs`。覆盖合成首行/
末行重复语义、描述缓存选择、元数据和读取上限、伪造身份、令牌副本、错误选择、
取消及撤销。未访问游戏、密钥、真实归档载荷或设备。
