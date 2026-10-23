# 固定来源的 JavaScript 素材配方

三个现有有界 Python 操作的可调用移植，尚未接入生产 worker：

- `image-default-frame`：校验 v31、裁出指定帧、应用已有默认态数值核，产出相同的 RGBA/PNG/v31 文件和回执。
- `native-art`：校验可信元数据、原件 SHA-256/MD5、v2 冻结 RGBA 的 SHA-256 和完整 PNG 编码的 SHA-256，随后生成九个职业图集、其他声明图集以及逐字节相同的 C 索引。没有把 PNG 字节哈希弱化成像素哈希。
- `map-goal`：裁出七个符号、向下取整减半十字透明度、默认绘制五语 155 张现行译名名牌，保留旧版 164 个文件与 JSON 布局；仅显式内部上游修订分支增加韩语，生成 186 张名牌及 195 个文件。文字使用精确 FreeType BASIC 直接绘制，不使用 Canvas 或普通 source-over。

`createArtRecipes({codec,kernels,defaultState,font,md5,sha256})` 返回异步 `execute(operation,payload,options)`。`payload` 是 `Uint8Array`；选项和回执保留现有操作契约。文件是普通的文件名到 `Uint8Array` 对象。`isArtRecipeOperation` 用于分派。依赖均显式注入，本模块不下载产物，也不初始化 Python：

- `codec`：`png-codec-exact/codec.mjs` 的 `createPngCodec`，固定 Pillow 使用的 zlib 1.3.1。`encodeRgba(raw,width,height)` 必须保留完整 PNG 字节。
- `kernels`：`image-kernels-rust/kernels.mjs` 的 `createImageKernels`，图像表示为 `{width,height,channels,data}`。
- `defaultState`：`art-kernels/kernels.mjs` 已有导出。
- `font`：`font-rasterizer-exact/font.mjs` 的 `createFontRasterizer`，固定 FreeType 2.6.0/Pillow 10.2.0 BASIC 语义。只有 map-goal 需要。调用以 48 像素打开字体，测量并用 `mm` 锚点绘制，最后在 `finally` 中关闭。
- `md5(bytes)`：已有 vendored SparkMD5 提供的同步或异步小写十六进制摘要。只有 native-art 需要。SHA-256 默认用 WebCrypto，也可注入相同语义的摘要函数。

入口校验 PNG 后端版本及各操作所需方法。缺少字体不影响 default-frame/native-art。依赖工厂另行校验 WASM 版本与零宿主导入。不要换成浏览器编解码器/字体，也不要升级 zlib/FreeType 固定版本。兼容回执里的 `pillow`/`freetype` 表示兼容目标，不表示仍依赖 Python。

保留操作的输入、输出、元数据、尺寸与哈希检查。精确后端另有文档说明的 8,192 单边和 4,194,304 像素限制；集成时必须确认已认证的布局适配这些边界。不声称兼容旧包装器允许的任意超大合成尺寸。JSON 数字词法类型被保留以对应 Python 仅整数尺寸；TSV 引号/跨行语义、规范化索引整数和 C 包含文本通用换行转换都显式处理。

## 定向验证

在仓库根目录运行：

    node web/toolchain/art-recipes-js/scripts/verify-source.mjs
    node web/toolchain/art-recipes-js/test/parity.mjs
    # 在实际固定版本 codec/font WASM 产物构建完成后：
    node web/toolchain/art-recipes-js/test/parity.mjs --wasm

v2 之前的历史定向证据：针对打包运行时的 **34 个案例全部通过**，覆盖三个默认帧成功案例、完整 map-goal 输出集、三个 native-art 成功案例和拒绝案例。入口版本、缺少字体和不支持操作的检查也通过。独立 codec/font WASM 模式尚未在本地运行。

运行器使用合成图像/表格与本机已有测试字体（`--font=/local/font.ttf` 可覆盖 DejaVuSans 默认值）。不读取、保存或分发游戏输入。通过 Node 加载实际打包且已校验 vendored 哈希的 Pillow，不启动浏览器。默认使用真实 Rust 像素 WASM，但注入预言机的 PNG/字体操作，以隔离验证配方控制流。因此这不构成独立 codec/font WASM 对照。`--wasm` 改用独立 codec/font 产物。逐字节比较全部输出和回执，包括完整 map-goal 清单；拒绝案例覆盖边界与哈希保护。

本目录不修改 worker、准备脚本或运行时构建。仅加入这些文件不会移除生产 Python。在分派操作前，必须构建并验证 codec/font 产物、将来源校验接入准备阶段，并在已验证运行时闭包内打包或解析这些本地 ESM 导入。保留已有依赖许可证。真实游戏字体/素材以及端到端设备一致性仍是单独检查，合成案例不能证明这些结果。

## 上游 v2 迁移

v2 增加原生图集 RGBA 哈希检查（保留 PNG 字节检查），同步 C 注释。地图目标默认保留旧版输出集；仅内部 `RELEASE_ART_REVISION`（b811）或 `UPSTREAM_ART_REVISION`（e375）分支增加韩语文件与 koKR 字段，与 overlay 共用修订标识。生产流程不选择该分支，也不提供用户开关；启用前需要匹配未来外壳并获得新的对照证据。上文完整运行时 / 字体 / WASM 对照是 v2 之前的历史证据，未在本次迁移重跑。源码核验与合成接口测试不等于渲染逐字节一致；详见 [v2 审查记录](../../UPSTREAM_V2_ART_REVIEW.md)。
