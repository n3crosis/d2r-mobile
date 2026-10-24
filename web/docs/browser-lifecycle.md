# Browser lifecycle / 浏览器生命周期

## English

### From bootstrap to output

[prepareBrowserPackager](../../web/browser-packager.mjs) verifies runtime bytes
against the build-bound HTML digest before private input. The UI's
`editableOptions: true` preloads both shell profiles and optional capability bytes;
core runtimes start immediately, ASTC/signing workers only when needed. Target,
preset and signing choices remain editable until generation without losing the
folder or downloading again. Generation snapshots the options. Direct API callers
can retain selected-only preload.

Input is mixed NSP/XCI packages with keys, or an already-merged extracted tree
without key reads. These routes have different trust guarantees: production skips
full base/update hashing and full RomFS scanning, and known Warlock Meta/PublicData
have a narrow unsigned-header exception. Do not describe this as complete content
authentication; see [input extraction](input-extraction.md).

The sequence is program rewrite → art/HUD/tables/overlays → full shader conversion
→ inventory checks → staged IPA. A session generates once; cancellation requires
reload. Private inputs are not uploaded, but the application has **no page-level
CSP network lockdown**. No-upload behavior is not browser-enforced isolation.

[Resource export](packaging-export.md) precedes the IPA download. Existing data
requires a complete bounded comparison; mismatch never overwrites it. Original
packages/keys stay unchanged. Mark incomplete exports; later IPA failure must not
invalidate completed resources. A separate Legacy Device Pack must match the run.
No-DLC shell derivation changes only the pinned ownership initializer under exact
hash/symbol/preimage/result checks, records the variant, and requires re-signing.
Neither selection nor this derivation proves ownership or gameplay.

### Ownership and failure handling

[packaging-job.mjs](../../web/packaging-job.mjs) checks capabilities before discovery,
key reads or output creation. Serial generation uses `secretLifetime: "archive"`;
generators never receive keys. Drain started work, dispose secrets, validate and
clean up before the sole commit boundary, `output.close()`. Cleanup failure
prevents commit; close rejection is not proof of rollback, and cancellation
cannot undo a committed output. Display only `PackagingJobError.report`, never
its raw cause. Synchronous native work cannot always be interrupted immediately.

[Shell loading](../../web/shell-loader.mjs) verifies independently pinned inventory,
actual Mach-O/plist targets and entries. Shader labels may align only after the
complete normalized source digest matches `SHADER_SRC`, never by label alone.
[Raw staging](../../web/raw-file-stage.mjs) requires explicit budgets and finalized
snapshots; await owned cleanup, with no RAM fallback or quota reservation.
[RomFS indexing](../../web/romfs-tree.mjs) does not upgrade the extraction mode's
trust. Exact bounds and lease rules remain in these modules and [runtime guide](sealed-runtime.md).

### Completed download retry

[createDownloadPreparation](../../web/download-preparation.mjs) retains the successful
Blob/filename separately from URL creation. `prepare` returns ready/retryable/
unavailable; retry prepares only the link, never conversion/export. Reuse URLs;
revoke the old one only after replacement succeeds, and dispose on unmount.
Automatic-click failures leave the visible link available. Never relabel a
completed IPA or resource pack as failed because URL preparation failed.

```sh
node --test web/tests/browser-lifecycle.test.mjs web/tests/packaging-export.test.mjs
```

Run from repository root. Synthetic tests do not replace actual browser downloads,
quota/crash recovery or installation; follow the [user guide](../../docs/WEB_IPA_PACKAGER.md).

## 简体中文

### 从引导到输出

prepareBrowserPackager 在读取私有输入前，以构建绑定的 HTML 摘要验证运行时字节。
界面通过 editableOptions 预加载两个外壳和可选能力；核心线程立即启动，ASTC/签名按需启动。
生成前可改目标、预设和签名，不丢失文件夹、不再下载；生成时固定选项。直接 API 可只加载所选内容。

输入支持带密钥的混合 NSP/XCI，或无需读取密钥的已合并提取目录，两者信任边界不同。
生产跳过基础/更新全量散列和整个 RomFS 扫描，已知 Warlock Meta/PublicData 有严格限定的
无签名头例外；不能称为完整内容认证，详细规则见输入提取指南。

顺序为程序重写、图像/HUD/表/覆盖、完整着色器转换、清单检查、暂存 IPA。每会话仅生成一次，
取消后需刷新。私有内容不上传，但**没有页面级 CSP 网络锁定**，不能把实现承诺说成浏览器强制隔离。

资源导出先于 IPA 下载。已有 data 必须完整有界比较才能复用，冲突不覆盖；原始包和密钥不变。
未完成导出明确标注，后续 IPA 失败不撤销已完成资源。Legacy Device Pack 独立且必须属于同次运行。
无 DLC 外壳派生只在精确摘要/符号/前像/结果校验下改固定初值并记录，必须重新签名；
内容选择或该派生都不证明购买所有权或游戏可玩。

### 所有权与失败

协调器先查能力，再发现输入、读密钥或创建输出。串行生成采用 secretLifetime: archive，
生成器无密钥。等待在途工作，释放秘密、验档和清理后才到唯一提交边界 output.close()。
清理失败阻止提交；close 拒绝不证明回滚，取消不能撤销已提交成果。只显示固定 report，不暴露原始 cause。
同步原生调用不一定能立即中断。

外壳加载核对独立固定清单、实际 Mach-O/plist 目标和条目。着色器链标签只能在完整规范化源码
摘要匹配 SHADER_SRC 后调整。原始暂存需要明确预算和已完成快照，等待自身清理，无 RAM 回退或配额预留。
RomFS 索引不提升所选提取模式的可信度。精确限制与租约规则见上方源码和运行时指南。

### 下载重试与验证

下载准备独立保留成功 Blob/文件名；prepare 返回 ready/retryable/unavailable，重试只准备链接，
不重复转换/导出。同一成果复用 URL，新 URL 成功后才释放旧 URL，卸载必须清理。
自动点击失败仍保留可见链接，不得因此把完成 IPA/资源包标为失败。
从仓库根目录运行上方测试；合成结果不能替代真实下载、配额/崩溃恢复或安装，操作见用户指南。
