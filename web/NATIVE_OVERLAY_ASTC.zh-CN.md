# 可选 ASTC 覆盖层组装

English: [NATIVE_OVERLAY_ASTC.md](NATIVE_OVERLAY_ASTC.md)

内部 `generateNativeOverlay` 接受可选 `prebuiltPack: {pack,records}`，遵循
`writeCascPrebuiltOverlay` 元数据契约。不接受补充包来源或载荷。原始资源仍经
`readAuthenticatedAssets` 进入；元数据不是认证开关。受信任协调器必须提供
来自已完成生成包的记录及摘要，而非用户提交的声明。

异步操作之前复制选定元数据字段：最多 32768 条记录、8 MiB 路径字节及
16 MiB 序列化 JSON。每次宿主写入将旧键绑定到原始清单，在补充包位置之前
预留原始覆盖层位置，并检查返回的包回执。每个 ASTC 档名必须等于对应 BC
档名，以保持原生预取命名。

同一套 base 和 item_notes 配方生成 BC 与 ASTC 根目录，旁路文件原样复制。
仅在 `romfs_overlay_astc/` 写一份 `pack.json`，item_notes 变体不写。
绝不包含外部数据档本身。组合输出仍受原有 128 MiB 上限约束。

未提供选项时，现有 BC 文件、变体及返回形状不变。启用后返回额外字段：
`astc: {count,pack,overlayArchives:{base,item_notes}}`。
档名是从实际匹配输出对提取的裸文件名。组合 `files` 映射包含普通输出及
十一份 ASTC 文件；`variants` 保持 `["base","item_notes"]`。下游必须校验
精确 ASTC 清单且仅放行这些路径，另行导出补充包。本模块不接生产适配器、
UI 或导出流程。

窄范围组装检查：
`node --test web/tests/native-overlay-prebuilt.test.mjs`。
注入合成依赖检查默认字节保持、配方复用、十一条路径、回执/旁路文件及
不匹配拒绝。它们不证明提取认证、真实编解码/原生对照、浏览器行为或设备
兼容性。CASC 变换及宿主另有原生合成对照测试。
