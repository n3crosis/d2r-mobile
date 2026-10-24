# Overlay generation / 覆盖层生成

## English

### Purpose and entry points

[overlay-recipe-js](../../web/toolchain/overlay-recipe-js/recipe.mjs) implements the bounded native overlay recipe without Python, filesystem access or asset fetching. [generateNativeOverlay](../../web/native-overlay-generator.mjs) supplies authenticated assets/generated artwork, then delegates archive serialization to [CASC storage](casc-storage.md). The recipe itself returns ordered files and separate base/item_notes variants, not an installed game.

`createOverlayRecipe({png,md5,sha1}).execute("overlay-recipe",payload,options)` consumes the existing UTF-8 JSON contract: manifest, base64 assets and the exact generated-art map. Dependencies must be trusted pinned implementations. Output byte arrays are independently owned; preserve file/variant order, sidecars, unchanged bytes and source hash guards. Do not substitute browser canvas, private annotation files or generated fallback assets.

### Revision selection

Both production v2.0.0 [shell profiles](shell-profiles.md) select release recipe `b811b90172f4eb40ec1bc89d903308e0c5ab88d0`: Korean/fifth language option and Xbox mapping, without later PlayStation behavior. Empty operation options retain legacy v1.0.18 data/output.

The internal `e3756f8942b40eba6c851e881828a5b1bda17fd6` revision adds later controller/language behavior; both it and the b811 release emit DM_OVERLAY_V1 manifests. No production profile selects it. Do not equate source availability with matching published shell behavior or relabel historical native parity as v2 proof. All revisions keep MOVIE_FFMPEG=0. Exact dependency closures, translation hashes and legacy projection are recorded in [release-contract-source.json](../../web/toolchain/overlay-recipe-js/release-contract-source.json), [contract-source.json](../../web/toolchain/overlay-recipe-js/contract-source.json) and [legacy-v1-data.json](../../web/toolchain/overlay-recipe-js/legacy-v1-data.json).

### Bounds and lifecycle

Recipe payload/output each cap at 128 MiB; individual files/manifest at 16 MiB. Map, row, asset-total and per-variant replacement bounds remain enforced in source. Canonical base64 and consumed-asset hashes are mandatory. Caller extraction provenance and final receipts remain independent gates. Optional ASTC metadata extends only the exact validated inventory; see [ASTC production](astc-production.md), never embed its external archive in the IPA.

[resolveLogicalAssetSuffixes](../../web/logical-asset-suffixes.mjs) supports a batch lookup with existing singular fallback. It preserves request order and ambiguity failures while scanning the manifest once, without retaining another catalog or decoded assets. Batches allow 4,096 requests/1 MiB ASCII suffix bytes; cancellation and live-session checks apply even to empty input. Duplicate normalized matches remain ambiguous, and each call scans afresh.

### Verify

```sh
node --test web/tests/asset-generation.test.mjs
node web/toolchain/overlay-recipe-js/scripts/verify-source.mjs
python3 web/toolchain/overlay-recipe-js/scripts/generate-contract-source.py --check
# Requires historical b811b901 locally:
python3 web/toolchain/overlay-recipe-js/scripts/generate-contract-source.py --check --release
# Independent native recipe gate, currently pending a reviewed aggregate pin:
node web/toolchain/overlay-recipe-js/test/recipe-parity.mjs
```

Run from repository root. Native parity requires Python/Pillow and the packaged native source; `--wasm` additionally exercises the built exact PNG codec. Never populate a pending native aggregate with a JS-only digest. Preserve original source attribution and dependency notices. Inert contracts and historical synthetic parity do not establish current full-title, browser or device compatibility.

## 简体中文

### 用途与入口

overlay-recipe-js 不依赖 Python、文件系统或资源下载，执行有界原生覆盖层配方。generateNativeOverlay 提供绑定来源的资源/生成图像，再交 CASC serializer 写档。配方返回有序文件和独立 base/item_notes 变体，不负责安装游戏。

createOverlayRecipe 的 overlay-recipe 操作消费现有 UTF-8 JSON：manifest、base64 assets 和精确生成图像映射。依赖必须可信且固定版本。输出数组独立拥有；保留文件/变体顺序、sidecar、未改动字节和来源散列守卫。不得换成 browser canvas、私有注释文件或合成回退资源。

### 配方版本

两个生产 v2.0.0 shell profile 都使用 b811b901 release 配方：韩语/第五语言和 Xbox 映射，不包含后来的 PlayStation 行为。空操作选项保留 legacy v1.0.18 数据/输出。

内部 e3756f8 配方增加后续控制器/语言行为；它与 b811 release 都生成 DM_OVERLAY_V1 清单，但没有生产配置选择它。源码存在不代表已发布 shell 支持，也不能把历史原生对照重新称为 v2 证明。所有版本保持 MOVIE_FFMPEG=0。精确依赖闭包、翻译散列和 legacy 投影见英文节链接的来源记录。

### 边界与生命周期

配方载荷/总输出各最多 128 MiB，单文件/manifest 16 MiB；映射、行、图像总量和每变体替换数仍按源码限制。规范 base64 和消费资源散列必须验证，调用方来源及最终收据是独立关卡。可选 ASTC 只扩展精确验证清单，不得把外部存档塞入 IPA。

逻辑后缀批量查找保留单项回退，按请求顺序返回或报告歧义，仅扫描一次，不保留第二份目录或解码资源。最多 4,096 请求/1 MiB ASCII 后缀；空批次仍检查取消和会话。规范化重复匹配仍是歧义，每次调用重新扫描。

### 验证

上方命令从仓库根运行；release 闭包检查要求本地有历史提交。原生配方 gate 需要 Python/Pillow 和打包原生源码，仍等待经审核的聚合 pin；不能用 JS 自算摘要填充。加 --wasm 可验证已构建的精确 PNG codec。保留原始来源和依赖声明。惰性合同及历史合成对照不证明当前完整游戏、浏览器或设备兼容性。
