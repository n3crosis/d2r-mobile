# Asset generation / 资源生成

## English

### Purpose and entry points

Generate art, HUD, tables, map labels and overlays from validated local game resources under the [input/extraction trust policy](input-extraction.md). Production uses JavaScript/WASM; Python remains a build/parity reference. Start with [production composition](../../web/production-assets.mjs), [sealed runtime](sealed-runtime.md) and [shell profiles](shell-profiles.md).

- [Production composition](../../web/production-assets.mjs): native art → Switch-upscaled HUD → derived tables → frontend panel → map-goal, mercenary/remaining art and native overlay. Generated counts must match trusted shell capacities.
- [Image adapter](../../web/asset-generator-adapter.mjs): single-use `image-default-frame` subset, not a complete pipeline. Only `frame.png`/`frame.sprite` are packageable. Explicit `enableV61Png` supports v61 PNG only, never v61 sprite output.
- [Linked adapter](../../web/asset-pipeline-adapter.mjs): trusted texture transforms, real BC3 encoding and CASC serialization. Native overlay mode requires named HUD/panel prerequisites and rejects concurrent ad-hoc replacements.
- Recipe APIs: [art](../../web/toolchain/art-recipes-js/recipes.mjs), [HUD](../../web/toolchain/hud-recipes-js/recipe.mjs), [remaining/mercenary](../../web/toolchain/remaining-art-js/recipes.mjs), [tables](../../web/toolchain/asset-transforms-js/transforms.mjs). Inputs and returned files are bounded byte arrays; see source for signatures and validators.

### Contracts that must remain

The authenticated-object API binds private capability identity and selection, not complete-content hashing; copied objects and disposed sessions fail. Source validation follows the input/extraction policy. Recipes, metadata hashes and capacities come from trusted configuration. Supply sealed workers; never invent missing assets or substitute fonts.

Verify source and complete encoded-PNG hashes, including paired release/browser digests. Decode complete atlases with real padded-frame layouts. HUD uses archive fonts and exact glyph inventories. Both supported revisions emit the complete 195-file map-goal inventory including Korean. Revision selection belongs to the shell profile.

Vault art must consume the personal sprite after its BC3 round trip. MainPanel preserves native block-copy geometry. Generated C texts feed `dm/derived.tsv`; never execute, compile or package them. Mercenary background generation does not replace overlay layout changes. See [overlay generation](overlay-generation.md) and [CASC storage](casc-storage.md).

Keep `secretLifetime: "archive"`. Consume output streams before disposal; propagate cancellation, terminate synchronous raster workers and clear owned intermediates/late results. These are bounded in-memory outputs, not OPFS image streams or secure heap erasure. Small adapters use copied 64-KiB chunks and reject unsafe/colliding paths. Final shell/assembly validation still applies.

Budgets are operation-specific, not total-memory guarantees. The small adapter allows 32 recipes; HUD permits 512 files/32 MiB. Inspect entry-point constants and backend limits before extending an inventory.

## 简体中文

### 用途与入口

按[输入/提取信任策略](input-extraction.md)使用经过验证的本地游戏资源生成图像、HUD、表格、地图标签和覆盖层。生产使用 JavaScript/WASM；Python 仅作构建/对照来源。入口及运行时、外壳文档见上方链接。

- 生产顺序：原生图像 → Switch 放大 HUD → 派生表 → 前端面板 → 地图目标、佣兵/剩余图像及覆盖层。派生数量必须符合可信外壳容量。
- 小图像适配器只处理单次默认态配方，不是完整流水线；仅 PNG/精灵结果可打包。显式 v61 支持只输出 PNG，不能冒充 v61 游戏精灵。
- 联接适配器执行可信变换、真实 BC3 编码和 CASC 序列化；原生覆盖模式必须具备前序 HUD/面板输入，不能混入临时替换。
- 图像、HUD、剩余图像/佣兵和表格 API 见源码链接。输入和文件结果均有字节预算，具体签名/校验器以代码为准。

### 不可放宽的契约

authenticated-object API 只绑定私有能力对象身份和对应选择，不代表已对全部内容求哈希认证；复制对象及失效会话会被拒绝。来源验证遵循输入/提取策略。配方、元数据摘要和容量来自可信配置；使用密封 worker，不虚构资源或替换字体。

检查源文件和完整 PNG 哈希，保留发布/浏览器摘要配对；完整图集必须保留真实填充步距。HUD 使用归档字体及完整字形清单。两个支持版本的地图目标均包含韩语，共 195 文件；版本由外壳选择，不是用户开关。

Vault 必须使用个人背景经 BC3 编解码后的像素；MainPanel 保留原生块复制几何。生成 C 文本只用于产生 dm/derived.tsv，不执行、编译或打包。佣兵背景不能代替覆盖层布局修改。

保留归档级密钥生命周期，所有输出流消费后再释放。取消要传入读取器，终止同步渲染 worker，并清理中间/迟到字节。这里是有界内存输出，不是 OPFS 图像流，也不保证堆安全擦除。小适配器采用 64-KiB 副本块并拒绝危险/冲突路径；最终外壳校验不可省略。

预算按操作分别限制，不保证总内存占用。小适配器最多 32 配方，HUD 最多 512 文件/32 MiB；扩展清单前检查入口常量及后端限制。

## Build and checks / 构建与验证

Repository-root commands; build tools: Node ≥22, Rust **1.99.1**, emsdk **4.0.20**. / 仓库根目录命令；工具仅用于构建。

```sh
npm --prefix web/toolchain/asset-generation-spike ci --ignore-scripts
npm --prefix web/toolchain/asset-generation-spike run prepare:core
npm --prefix web/toolchain/asset-generation-spike run prepare:runtime
node web/toolchain/image-kernels-rust/build.mjs
node web/toolchain/font-rasterizer-exact/build.mjs
node web/toolchain/art-recipes-js/scripts/verify-source.mjs
node web/toolchain/asset-transforms-js/scripts/verify-source.mjs
node web/toolchain/hud-recipes-js/verify-sources.mjs
node web/toolchain/remaining-art-js/scripts/verify-sources.mjs
node --test web/tests/asset-generation.test.mjs web/tests/casc-storage.test.mjs
node web/toolchain/asset-transforms-js/test/parity.mjs
# After building pinned PNG/font WASM / 固定 PNG/字体 WASM 构建后
node web/toolchain/art-recipes-js/test/parity.mjs --wasm
node web/toolchain/remaining-art-js/test/parity.mjs --wasm
```

PNG build: [archive codecs](archive-codecs.md). Without `--wasm`, parity uses oracle codecs; neither mode proves full-game/browser/device compatibility. Additional checks: [font](../../web/toolchain/font-rasterizer-exact/test/), [pixels](../../web/toolchain/image-kernels-rust/test/), [HUD](../../web/toolchain/hud-recipes-js/test/).

PNG 构建见归档编解码文档。非 WASM 模式借用参考编解码器；两种测试都不能证明真实游戏、浏览器或设备兼容性。更多验证见测试目录。

## Pins and notices / 固定来源与声明

- Pins: Pillow **10.2.0**, FreeType **2.6.0**, PNG/CASC zlib **1.3.1/1.2.13**, reference Pyodide **0.27.7**. Legacy FreeType requires security review and an upgrade plan. / 版本不可静默替换；旧 FreeType 上线前须安全审查和升级计划。
- Preserve all recipe/source manifests, guards and [native references](../../web/toolchain/asset-generation-spike/); [release bindings](../../web/toolchain/art-recipes-js/release-source-compatibility.json) reject drift. / 保留来源清单、检查器及原生参考，来源变化须重新验证。
- Preserve Pillow HPND notices: [pixels](../../web/toolchain/image-kernels-rust/reference/LICENSE), [fonts](../../web/toolchain/font-rasterizer-exact/reference/LICENSE). This software is based in part on the work of the FreeType Team. Use [FreeType License](../../web/toolchain/font-rasterizer-exact/reference/LICENSE-FreeType), not GPL; retain applicable [BDF](../../web/toolchain/font-rasterizer-exact/reference/LICENSE-bdf), [PCF](../../web/toolchain/font-rasterizer-exact/reference/LICENSE-pcf), [zlib](../../web/toolchain/font-rasterizer-exact/reference/LICENSE-FreeType-zlib) notices. / 保留 Pillow HPND；本软件部分基于 FreeType 团队成果，采用 FreeType 许可而非 GPL，并保留适用声明。
- Retain dependency metadata/repository licenses. No proprietary fonts/images are supplied; local resource use needs appropriate rights. / 保留依赖元数据及仓库许可；项目不提供专有字体/图像，用户资源用途须获适当授权。
