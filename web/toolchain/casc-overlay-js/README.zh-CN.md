# JavaScript CASC 覆盖层序列化

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

以下独立同步函数尚未接入生产工作线程：

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

现有运行时构建在密封资源准备前增加编解码器步骤。
生产与开发 worker 在进入 Python 前分派 CASC；准备后的清单不再包含
`casc_overlay.py` 或 `casc_overlay_original.py`，原始源码仍保留供构建与对照。

## 聚焦检查

在仓库根目录运行：

    node web/toolchain/casc-overlay-js/scripts/verify-source.mjs
    node web/toolchain/casc-overlay-js/test/parity.mjs
    node web/toolchain/casc-overlay-js/test/worker-routing.mjs

默认对照注入实际打包的 CPython 1.2.13 压缩器，单独验证 JavaScript 序列化，
与原始受限适配器逐字节比较完整数据档、配置和回执。
合成用例覆盖原样/zlib/BLTE、空数据、多块、路径树新增、共同前缀、同位置插入、任务顺序及错误输入。

现有 emsdk 4.0.20 构建产出编解码器后，可验证独立 WASM 的端到端结果：

    node web/toolchain/casc-overlay-js/test/parity.mjs --wasm

构建配方在来源/版本漂移或出现宿主导入时失败。
本地没有 emcc，未执行 WASM 构建；必须由现有同一 CI 构建在部署前证明该产物。
不把原生编解码器对照当作 WASM/浏览器结果，不宣称完整游戏或真机证据，不改 .NET。

尚有七个 Python 资源操作：image-default-frame、native-art、hud-v4、map-goal、
mercenary-art、remaining-art、overlay-recipe。

## 上游薄覆盖层审查

e3756f8 对原生 `casc_overlay.py` 的更新仅加入 `link_source`/`--thin` 文件系统
处理。浏览器序列化器原本就只输出配置和新增归档，不创建原资源符号链接；其使用
的纯 CASC 序列化函数均未改变。此次在审查语义后更新来源固定值，不代表重新执行
或通过了原生/WASM 对照测试。
