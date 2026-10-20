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
