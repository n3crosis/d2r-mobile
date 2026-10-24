# JavaScript CASC 覆盖层序列化

[English](README.md)

`overlay.mjs` 移植原始受限 `casc-overlay` 操作，包括 TVFS/CFT 布局、压缩路径树、
插入顺序、BLTE 块头、MD5 校验/EKey、配置别名和数据档命名。
输入保持原有拼接格式：配置、解码后的 TVFS 表、按调用顺序排列的替换数据，
以及可信的 `parts`、`jobs`、`location` 选项。无合成生产数据回退。

- `createCascOverlayTransform({md5, compress})` 提供纯字节序列化。
- `createPinnedCascOverlayTransform({codec, SparkMD5})` 绑定生产实现，要求通用压缩器版本为 `1.2.13`。
- 输入/输出上限仍为 64 MiB，单表/替换上限为 16 MiB，最多 4,096 个任务。
  校验路径深度、编码规格、数据范围、CFT 唯一匹配与原有路径偏移不变。
  返回文件名和回执字段保持一致。
- `scripts/verify-source.mjs` 锁定原始函数、边界适配器和 SparkMD5；运行时字节仍使用现有 SHA 清单。

## 补充包元数据原语

以下独立同步函数检查存储规格并修改引用。
独立的 worker 操作见[资产运行时](../asset-runtime-js/README.zh-CN.md#专用外部引用-casc-操作)：

- `inspectCascPackStorageSpecs(vfs, entries)` 接受解码的 TVFS 字节和有序
  `{path, oldEkey}` 请求，返回冻结数组，其中每个冻结记录为
  `{path, oldEkey, specIndex, spec, encodedSize, decodedSize}`。
  规格仅为 `n`、`z` 或 `b:256K*=z`；旧键以小写十六进制返回。
- `patchCascPrebuiltReferences(vfs, records)` 接受
  `{path, oldEkey, newEkey, encodedSize, decodedSize}` 记录并返回新的 TVFS 字节数组。
  它先解析全部旧引用并验证全部修改，再复制一次 TVFS。仅修改选中的 EKey 及编码、
  解码长度；原规格序号、路径表和所有无关字节均不变。

`CASC_PACK_METADATA_LIMITS` 允许 32,768 条请求、总计 8 MiB 的 UTF-8 路径字节，
单路径最多 4,096 字节，表大小仍受现有 16 MiB 上限约束。这些只是元数据预算，
不改变覆盖层的 4,096 任务或 64 MiB 载荷上限。
请求必须使用规范化的小写安全路径；拒绝重复路径或旧键、缺失或歧义键、未对齐的
CFT 命中及任何 `add` 字段。替换长度必须是无符号 32 位整数。不会修改输入 TVFS，
全部查找基于原表，因此交换两个键不会让后续查找错误定位到已修改的记录。

这些函数只验证元数据结构。调用方必须从已认证输入流程取得路径到旧 EKey 的关联；
函数不建立该关联，不认证外部包，不验证其字节范围或校验和，不预留归档位置，
也不证明替换载荷符合保留的编码规格。这些均是独立的调用方责任。
函数不接受载荷，也不插入新路径。精确唯一匹配沿用现有 CFT 搜索语义，
包括第二次未对齐命中也会拒绝。每次调用只构造一次 CFT 搜索字符串，
但每个请求键仍需要扫描；大请求应在 UI 线程之外运行。

运行 `node --test web/tests/casc-pack-metadata.test.mjs` 可检查合成规格与长度、
输入不变、交换键、拒绝情形及 27,000 条请求。原序列化对照套件仍是独立回归检查。

## 压缩版本不可随意替换

打包的 CPython 使用 zlib 1.2.13，Pillow 使用 zlib 1.3.1。
`../png-codec-exact` 将两套锁定来源的版本编入一个小型独立 WASM，并对 1.2.13 压缩器符号加前缀。
CASC 仅调用其 1.2.13、级别 9、默认参数的压缩流，中间不刷新；PNG 仍使用独立的 1.3.1 后端。
不替换为浏览器 CompressionStream 或任意 zlib 版本。
SparkMD5 只用于旧格式校验，不用于安全或用户数据认证。

生产路由、后端组装与运行时清单见 [JavaScript/WASM 资产运行时](../asset-runtime-js/README.zh-CN.md)。
旧证明 worker 与开发 worker 也在不进入 Python 的情况下分派 CASC。
上游 Python 源码仍保留供构建与对照。

## 聚焦检查

在仓库根目录运行：

    node web/toolchain/casc-overlay-js/scripts/verify-source.mjs
    node web/toolchain/casc-overlay-js/test/parity.mjs

默认对照注入实际打包的 CPython 1.2.13 压缩器，单独验证 JavaScript 序列化，
与原始受限适配器逐字节比较完整数据档、配置和回执。
合成用例覆盖原样/zlib/BLTE、空数据、多块、路径树新增、共同前缀、同位置插入、任务顺序及错误输入。

现有 emsdk 4.0.20 构建产出编解码器后，可验证独立 WASM 的端到端结果：

    node web/toolchain/casc-overlay-js/test/parity.mjs --wasm

构建配方在来源/版本漂移或出现宿主导入时失败。
原生编解码器对照不是 WASM/浏览器结果，这两种检查也都不能证明完整游戏或真机兼容性。

## 上游薄覆盖层审查

e3756f8 对原生 `casc_overlay.py` 的更新仅加入 `link_source`/`--thin` 文件系统
处理。浏览器序列化器原本就只输出配置和新增归档，不创建原资源符号链接；其使用
的纯 CASC 序列化函数均未改变。此次在审查语义后更新来源固定值，不代表重新执行
或通过了原生/WASM 对照测试。

## 外部引用覆盖层变换

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

### 可复用存储查询

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

## 有界 CFT 存储查询

`createCascPackStorageLookup(vfs, { expectedQueries = 0 })` 对有界 TVFS 只建立一次快照。
可选提示必须是 0 至 32,768 的整数。只有 CFT 记录数与预期查询数均至少为 2,048，
才选择紧凑索引；省略提示或较小批量保留原字符串查询路径。
ASTC 协调器传入已有的所选令牌数量（包括描述符），不复制另一份清单，也不提前打开记录。
提示不授予信任，不改变元数据上限或输出字节。

索引保留两个 Uint32 数组和一个 Uint8 数组，每条 CFT 记录共 9 字节。
27,000 条记录占 243,000 字节；在现有 16 MiB TVFS 上限内小于 6 MiB。
这些数字不含共用的不可变快照、对象开销或排序临时空间。
索引路径不保留重复的 CFT 搜索字符串或路径清单；默认路径保留与 CFT 等长的字符串，
实际内存占用取决于引擎。

对齐键先按 32 位滚动指纹、再按完整的 16 字节键排序。
二分查找沿用同一顺序处理碰撞，不线性扫描碰撞桶或重复键组。
索引检查 CFT 内每个可能的 16 字节窗口，包括非对齐和跨记录位置；出现次数最多计为二。
只有恰好唯一且对齐的键才被接受。指纹不是完整性或认证证明。
已有路径、键、大小、范围、请求重复和快照检查保持不变。
构建索引的有界工作量为 O(B log N + N log N)，查询为 O(log N)，
其中 B 是 CFT 字节数，N 是记录数；完整键比较长度固定为 16 字节。

### Node 合成样本

仓库外原型在开发主机上的样本包含构建和查询时间。
27,000 条记录、675,000 字节 CFT 时，字符串与索引的总耗时分别约为：
单次查询 1 与 181 ms；512 次查询 96 与 161 ms；2,048 次查询 377 与 155 ms；
全部 27,000 次查询 5,023 与 166 ms。
128 条记录全部查询为 0.12 与 0.52 ms；2,048 条记录全部查询为 20 与 9 ms。
这些样本支持保守的双 2,048 门槛，但不构成浏览器或设备性能保证，也不是游戏测试。

另一次单独的合成样本在 Node 24.19.0 上使用实际修改后的工厂函数，
对相同的 27,000 条记录执行 27,000 次逐条查询。
默认路径构建耗时 26.8 ms（包括快照与验证），查询及回执处理耗时 5,160.9 ms，
合计 5,187.6 ms；索引路径构建耗时 195.6 ms，查询及回执处理耗时 253.3 ms，
合计 448.9 ms。两条路径执行相同的 JSON 序列化和回执散列，输出回执完全一致。
这是实际生产工厂函数的 Node 测量，不是上文原型耗时，也不是浏览器或设备保证。
小批量的权衡与保守门槛保持不变。

聚焦差分测试比较两条路径：有效和缺失键、对齐/非对齐/跨记录重复、全部相同键、
真实指纹碰撞、源数据修改、无效提示和两个门槛边界：

    node --test web/tests/casc-pack-metadata.test.mjs
