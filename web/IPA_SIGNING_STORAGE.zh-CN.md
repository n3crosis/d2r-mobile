# 可选本地签名存储

此存储适配器支持应用的可选本地签名流程。其合成检查不验证实际原生签名或设备安装，也不修改未签名外壳合同。这些检查没有使用凭据或私有游戏输入。

- `ipa-signing-zip.mjs` 中的 `inspectUnsignedSigningArchive(blob, { signal })` 从有界中央目录推导清单，然后通过 `validateStagedZip` 独立检查整个规范 STORE ZIP32。返回冻结的 `{ appRoot, entries }`，条目使用不可变 Blob 切片。上限：归档 512 MiB、单文件 256 MiB、20,000 个条目、ZIP 元数据 8 MiB。拒绝多个应用、已有签名文件、PlugIns 和 Watch 目录。有意不支持 ZIP64、压缩、符号链接和非规范归档。
- `ipa-signing-fs.mjs` 中的 `createSigningFileStore(archive, { readBlobSync })` 保持资源为 Blob。默认同步读取器是专用工作线程中的 `FileReaderSync`，不能在主线程使用。每次资源读取最多 64 KiB。经过魔数检查的 Mach-O 候选文件才允许修改，单个最多 128 MiB，原始可执行文件合计最多 256 MiB。可变后备数组容量合计最多 256 MiB；数组扩容期间，旧数组和替换数组可能暂时同时存在，直到垃圾回收。这些是逻辑存储上限，不是浏览器进程内存保证。
- 可写路径仅包括原始 Mach-O 文件、应用包 Info.plist、精确的包 `_CodeSignature/CodeResources`、主应用的 `embedded.mobileprovision` 以及严格命名的可执行文件临时同级文件。元数据文件上限为 8 MiB。临时文件只能重命名为对应的可执行文件。最终收集拒绝残留临时文件或缺失原始文件；资源内容不能覆盖。释放会擦除可变数组，已经收集的 Blob 快照保持独立。
- `ipa-signing-mount.mjs` 中的 `mountSigningArchive(module, archive, options)` 在 `/work` 实现普通 Emscripten FS 节点和流，内部将应用映射为 `/work/Payload/App.app`。返回 `{ collectEntries, dispose }`，收集时恢复原始路径。选定原生桥接必须使用有界 stdio，而不是 mmap。凭据位于此挂载之外，仍由工作线程负责。不需要将资源复制到 MEMFS。
- `createSignedSigningArchive(entries, { signal })` 使用现有规范 STORE 写入器，将块快照保存为 Blob，并在返回前重新独立验证清单、布局和 CRC。错误只包含封闭签名代码，不含文件名。这验证的是 ZIP 完整性，而不是证书信任、描述文件资格或加密签名语义。

已提交的未签名 IPA 必须保留为独立后备产物。签名是在独立、可销毁工作线程中的新提交后事务。这些模块不上传或发布任何内容。合成测试覆盖规范往返、CRC 损坏、禁止路径、取消、读写边界、不可变资源、修改条目快照、临时替换、释放以及带符号 WASM 堆字节视图。实际 Emscripten/原生互操作和签名仍是独立验证关卡。

重试编排与存储分离。`sealed-runtime/ipa-signing-factory.mjs` 中独立拥有的公开资源
工厂先准备每次使用的一次性工作线程，然后才读取凭据文件。首次尝试复用引导线程；
后续尝试从已验证的内存公开字节初始化全新线程，不访问网络。即使凭据文件读取失败，
也必须关闭该尝试。失败或取消保留相同的未签名 Blob，并要求重新选择凭据，不重复转换，
也不保留之前的凭据。显式关闭打包器或界面卸载会释放工厂及其保留的公开资源。这些
生命周期保证并不构成原生签名或设备信任验证。
