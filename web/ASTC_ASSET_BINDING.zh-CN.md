# 可选 ASTC 资源元数据绑定

English: [ASTC_ASSET_BINDING.md](ASTC_ASSET_BINDING.md)

`createProductionAssetAdapter` 和 `createAssetPipelineAdapter` 接受可选的受信任构造参数 `prebuiltPack: {pack,records}`。其格式与专用外部引用覆盖层元数据一致：`pack` 为 `{name,size,sha256}`，每个条目为 `{path,oldEkey,newEkey,encodedSize,decodedSize}`。不接受包字节、源句柄、任意载荷字段或调用方认证标志。导出的 `snapshotPrebuiltPackMetadata` 仅做有界不可变元数据验证与快照，不是内容真实性证明。实际路径/CFT 关联及归档位置/范围检查仍由生成器与专用 CASC 写入器负责。

快照最多 32,768 个引用，每个路径最多 4096 个 UTF-8 字节，路径总计最多 8 MiB；两个长度均为无符号 32 位，键是有界十六进制字符串。包大小必须为正。流水线使用时必须提供 `nativeOverlayGenerated`，不能默默把其他配方模式变为 ASTC 模式。省略该选项保持默认输出且不产生绑定。这是受信任内部接线，不是 UI 触发器或新的默认配置。

`generateAssets` 成功后，两个适配器均提供同步 `getAstcOutputBinding()`。它只返回冻结的 `{count,pack,overlayArchives:{base,item_notes}}` 快照。默认情况下、生成前或生成中、失败后和清理后均返回 `undefined`。流水线等客户端关闭及拥有的缓冲区清理完成才发布绑定；生产组合层还会等待自己的普通图像/派生资源后处理和客户端关闭。获取器不包含生成文件或完整引用列表。

生成器的可选 `.astc` 回执和 ASTC 前缀文件子集会与输入元数据及 `validateAstcOutputs` 核对：必须恰好有十一项额外文件，包括匹配的 `pack.json`、两个覆盖归档及物品注释功能边车文件。没有绑定、缺失或多出的 ASTC 文件均会拒绝。流水线现有总输出上限仍为 80 MiB，由默认和可选输出共同使用。额外十一项文件不获得独立字节额度；即使可选输出本身有效，只要超过共享预算也会失败且不发布绑定。生产层原有普通图像/HUD 输出处理不变。

验证使用引用生成器已有字节视图的十一项映射，不另行复制生成载荷。流水线输出保留现有单次所有权复制及擦除行为。生产层直接转交同一批条目对象，而非建立另一份文件映射或复制其字节。ASTC 条目迭代器产出自有副本，视图和底层缓冲区均最多 64 KiB；不会产出保留完整归档底层缓冲区的小型子视图。这符合有界流式检查器的 1 MiB 底层缓冲区上限。清理会清除元数据，并使保留的输出生产器失效。

运行：

```
node --test web/tests/asset-pipeline-adapter.test.mjs web/tests/production-assets-astc.test.mjs
```

六项现有流水线回归和六项隔离适配器案例通过。普通测试包装器在子 Node 进程中用所需标志执行模块替身，因此普通测试命令和 CI 无需新增标志。覆盖延后发布绑定、默认无绑定、元数据传递、精确十一项检查、不变的 80 MiB 上限、自有输出块、失败/清理失效、构造元数据拒绝及生产客户端关闭失败。这些是合成适配器契约验证，不是真实浏览器/WASM、完整资源生成或游戏安装证明。
