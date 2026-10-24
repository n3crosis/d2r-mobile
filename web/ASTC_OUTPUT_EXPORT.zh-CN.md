# ASTC 输出验证与老机型补充包导出

[English](ASTC_OUTPUT_EXPORT.md)

## 范围

这些独立原语尚未接入浏览器打包、生产配置、生成器或界面；默认 BC 生成保持不变。布局依据 `dm/ios/tools/gen_romfs_overlay.py`、`dm/tools/astc_pack.py finalize` 与 `dm/ios/Sources/main.m`。

## 精确生成输出验证

`validateAstcOutputs({ files, pack, overlayArchives: { base, item_notes } })` 接收生成的路径到 `Uint8Array` 映射，返回冻结的清单摘要。`pack` 是内部可信最终补充包的 `{ name, size, sha256 }`；两种覆盖层归档名来自可信生成器。接口不接受调用者自行声明的认证标志。

完整集合恰好为以下十一个文件：

- `romfs_overlay_astc/data/.build.config`
- `romfs_overlay_astc/data/<基础归档名>`
- `romfs_overlay_astc/ctrl_touch`
- `romfs_overlay_astc/touch_strings.tsv`
- `romfs_overlay_astc/pack.json`
- `romfs_overlay_astc_variants/item_notes/data/.build.config`
- `romfs_overlay_astc_variants/item_notes/data/<item_notes 归档名>`
- `romfs_overlay_astc_variants/item_notes/ctrl_touch`
- `romfs_overlay_astc_variants/item_notes/touch_strings.tsv`
- `romfs_overlay_astc_variants/item_notes/dm_textbox_plain.tsv`
- `romfs_overlay_astc_variants/item_notes/features.txt`

集合不接受目录、额外变体、BC 路径、外部补充包归档、索引 TSV 或任意额外文件。两种覆盖层归档名不能与补充包归档名相同。归档名必须是规范十进制格式，两个 CASC 位置分量均为 0–255。数据文件和 `ctrl_touch` 不得为空；特性文本必须以 `item_notes\n` 开头。pack JSON 不得超过 512 字节，只能包含各一次且未转义的 `name`、`size`、`sha256`，必须与可信 pack 元数据相同；拒绝未知、重复和转义键。

单文件及底层缓冲区上限均为 64 MiB，全部可见字节总量上限为 128 MiB；拒绝共享或可调整大小的缓冲区。pack 大小允许不超过 2^40 的非负安全整数，SHA-256 必须为小写。结构验证不证明实际字节匹配哈希、CFT 引用指向该归档、原位置未被占用或纹理可用。调用者整合这组 ASTC 输出时不得向 IPA 加入外部补充包数据或索引。现有 BC 输出既不属于这组集合，也不会被更改。

## 独立本地导出

`exportLegacyDevicePack({ finalizedPack: { source, pack }, outputDirectoryHandle, signal?, onProgress?, secureContext?, randomUUID? })` 使用仍有效的可信最终暂存源，包含 `file`、数字 `size` 与有界 `readAt`。可注入环境值仅面向可信宿主和测试，不用于绕过权限。调用者必须此前通过获准的用户手势取得目标目录；模块只检查现有读写权限，不弹窗或请求权限。

导出器在目标下创建 `Legacy Device Pack-<UUID>`，内容为：

- `data/<pack.name>`：暂存源的精确字节，以最多 64 KiB 的独立块读取，按最多 1 MiB 的串行批次写入。
- `manifest.json`：原生 `{ "files": [pack] }` 结构。
- `.d2rm-legacy-pack-export.json`：未完成/完成标记及计数，明确独立于 IPA 状态。

原生 iOS 宿主会在改名目录及其下一层查找 `data/<name>`，并依据包内 ASTC `pack.json` 验证大小和 SHA-256，因此 UUID 目录无需固定命名为 `Legacy Device Pack`。导出器使用最终元数据，不重新计算哈希，也不声称认证。原生宿主加载时会自行校验；暂存源完整性和位置分配仍是内部调用者的责任。

不覆盖、不上传、不修改源文件夹、不生成 ZIP、不回退到内存、不缓冲整个补充包。源仍归调用者所有，导出器不会释放它。调用者应在导出期间保留源，并在合适时机释放。输入块必须是独立的普通不可调整大小 `Uint8Array` 缓冲区，最大 64 KiB；复制到固定 1 MiB 写缓冲后清零。读取与包大小上限不变，详见[写入合并约定](RESOURCE_WRITE_BATCHING.zh-CN.md)。

## 完成、取消与清理

未完成标记先关闭，再写载荷。归档及 manifest 的关闭和大小检查都先于最终完成标记。最终标记成功关闭即提交边界；之后的取消不会把完整输出重新归类为失败。进度仅供参考，除阶段变化外每 100 ms 至多通知一次；观察者错误不影响结果。计数为安全整数，字节数只计归档内容，不含 manifest 和标记开销。

失败抛出 `LegacyPackExportError`，包含冻结的未完成报告：目录、字节/文件计数、取消代码、清理是否完成、未完成标记是否存在和清理代码。清理先中止活动写入流，再逐项删除当前句柄仍与原句柄一致的已跟踪条目。不递归删除，保留未知新增或替换条目。清理失败会尽可能保留未完成标记并明确报告。不得把部分目录当作完整输出，也不得仅凭目录名递归删除它。

与现有资源导出器相同，取消检查发生在等待文件系统操作之前和之后，不能强制取消挂起的浏览器调用。OPFS/File System Access 没有独占创建原语；加密随机 UUID 与存在性检查假设不存在恶意并发写入者。崩溃可能遗留未完成输出；模块不自动清扫。

## 证据与限制

定向测试使用合成清单、暂存字节源及文件系统替身，覆盖精确文件集合、JSON 绑定、有界复制、权限/冲突失败、取消、提交时点、部分报告与未知/替换条目保护。这不构成真实浏览器、设备、游戏、哈希或端到端安装证明。

## 可选编码来源说明

内部最终暂存源可以包含严格的 `encoding: { format: "astc", preset: "thorough" | "fast" }`。存在时，导出器验证并保存其快照，将其放在 `manifest.json` 的 `files` 旁，并在成功导出报告中返回。不会向原生包元数据添加字段。省略该项的现有调用方保留原清单结构。未知格式、预设或额外编码字段会在创建输出前拒绝。此来源说明不认证外部导入的补充包。
