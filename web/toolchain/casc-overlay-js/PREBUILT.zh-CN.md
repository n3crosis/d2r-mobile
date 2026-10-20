# 外部引用覆盖层变换

English: [PREBUILT.md](PREBUILT.md)

`createCascPrebuiltOverlayTransform({md5,compress})` 与固定内核包装器
`createPinnedCascPrebuiltOverlayTransform({codec,SparkMD5})` 提供独立内部入口。
默认变换的 API、限制与字节不变。此处不提供 UI、导出或来源认证能力。

返回函数接收 `(payload,{parts,jobs,location})`。分段顺序为
`[config, 原始 TVFS, 根 TVFS, ...普通替换字节, 外部 JSON]`。
`parts.length === 4 + jobs.length`，普通任务可为空。外部 JSON 为 UTF-8
`{pack:{name,size,sha256},records:[{path,oldEkey,newEkey,encodedSize,decodedSize}]}`。
它最多 16 MiB，计入不变的 64 MiB 总载荷限制。普通任务仍最多 4096；外部记录
1–32768 条，规范路径字节合计最多 8 MiB。不接受外部新增路径。

包文件名为规范十进制 `<块号>-<档号>.data`，最小宽度分别为 2 和 8，各分量
0–255，且不得与覆盖层档名相同。大小为正安全整数且不超过 2^40；SHA-256
为 64 位小写十六进制。每个新 EKey 必须编码该位置及 40 位偏移，编码区间
须完全落在包内。记录大小为无符号 32 位，允许零长度记录。摘要文本及范围检查
不能认证包字节。宿主必须绑定已认证原始清单的路径/旧键、验证最终包摘要，并
针对原档及计划输出预留位置。

所有原始 CFT 位置在修改前解析。重复外部路径/键，以及普通/外部路径或位置重叠
均拒绝；与原生覆盖优先规则不同，此实现有意不支持重叠。修改顺序为普通替换、
外部引用、新增项、TVFS 与根索引序列化。普通编码字节的顺序和偏移保持不变，
不复制补充包载荷。返回 `{files,inventory,external:{count,pack}}`；inventory
仅含普通任务，回执不重复大规模外部记录。

验证命令：`node --test web/toolchain/casc-overlay-js/test/prebuilt.mjs`。
使用合成数据及未修改原生 `make_overlay` 作逐字节对照，两边均使用宿主 Python
zlib。覆盖普通/新增/外部输出、普通任务为空、重叠/位置/范围/元数据/数量拒绝，
以及默认入口拒绝新载荷形状。默认逐字节对照另行执行。这些测试不证明固定 WASM
流式集成、浏览器性能、真实游戏覆盖、包来源、画质或设备兼容性。

## 可复用存储查询

`createCascPackStorageLookup(vfs)` 返回冻结的 `lookup(entries)` 函数，结果
与 `inspectCascPackStorageSpecs` 的冻结存储记录一致。每条流水线构造一次，
随后查询有界单条记录，无需重复建立整张 CFT 搜索字符串。内部仅复制一次最多
16 MiB 的 VFS，解析一次布局，并构造一个不可变 CFT 二进制字符串。调用方
后来修改原始缓冲区不会改变结果。不暴露可变快照或无界缓存。保留内存为一份
VFS 副本、一份 CFT 字符串及解析布局元数据，受现有 16 MiB 表上限约束；
字符串实际存储大小取决于引擎。

每次请求保留数量/路径字节、缺失键、唯一字节出现及 25 字节 CFT 对齐检查。
第二次出现即使不对齐也会拒绝。每次查询仍执行相对于 CFT 大小的线性子串搜索；
此改动消除重复整表分配，不代表消除全部查询 CPU 成本。默认序列化及单次查询
API 均不变。元数据测试覆盖重复查询、Buffer 修改隔离及非对齐重复拒绝。
