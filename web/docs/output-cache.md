# Generated-output cache / 生成输出缓存

## English

### Use and invalidation

The optional cache stores disposable results in `D2R-cache/v1/` under the selected
input folder. Permission, quota, corruption, unavailable storage and timeout
fall back to generation with one fixed nonfatal notice; cancellation still cancels.
“Ignore saved build cache” bypasses reads, while fresh validated results may refresh
entries. Public runtime-download caching is separate. Never cache keys, passwords,
certificates/profiles, extraction state, raw fonts/textures or decoded pixels.

Folder files and neighboring JSON are not provenance. The independent same-origin
Cache Storage ledger records size/SHA-256 of outputs actually generated and
validated by the app. The random folder marker merely selects that ledger.
Every hit checks the owned snapshot against both ledger and current validator.
Clearing browser storage or changing browser/origin requires rebuilding even if
the folder remains. Old `.d2r-cache` is not read, migrated or deleted.

Shader keys bind exact normalized MSL, shader identity, complete source-set digest,
full compiler identity, target/options and runtime-manifest digest. A hit still
translates current inputs, regenerates reflection and participates in the complete
6,927-key source proof: **only AIR compilation is skipped**. Art keys bind freshly
read payload hashes, options, profile and recipe revisions to the runtime digest.
Native-art/HUD/map-goal hits skip rendering, not authentication, source decoding,
other generators or export. Missing runtime identity disables art reuse.

### Maintenance and deletion

[local-output-cache.mjs](../../web/local-output-cache.mjs) owns independent-ledger
trust, storage deadlines, serialization and Web Lock lifecycle;
[asset-output-cache.mjs](../../web/asset-output-cache.mjs) owns art result/index
validation. Publish indexes only after validated files close. Corrupt/partial
entries recompute; cancellation wipes owned bytes. Preserve exact budget and
late-cleanup checks rather than trusting a folder receipt.

Each blob is ≤16 MiB; the ledger allows 32,768 records / 2 GiB, not a hard disk
quota including crash leftovers. Art sets have tighter aggregate caps. A
nonblocking origin lock allows one cache session; other tabs generate uncached.
Storage operations have 10-second deadlines. Close/cancel retains the lock until
started I/O settles without indefinitely blocking generation. Remove only verified
owned superseded leaves; concurrent external edits are unsupported.

After the job ends, deleting **D2R-cache only** is safe. Do not delete inputs,
resource folders, Legacy Device Packs or IPAs. Resource completion markers lack
source-bound per-file proofs: caching neither certifies those folders nor tells
what is installed on a phone. No timing or reduced-memory claim is made.

### OPFS advisory and checks

[readOpfsStorageAdvisory](../../web/opfs-storage-advisory.mjs) only queries
`navigator.storage.estimate()`, never requests persistence/permissions or reserves
space. Unknown capacity is not zero. `requiredBytes` must be independently known;
NSP size and an ASTC 8 GiB upper cap are not allocation requirements. Estimates
concern browser-origin staging, not physical disk or selected-folder free space.
Keep them nonblocking; real write failures remain authoritative. Cancellation of
an advisory does not revive a cancelled job. Exact result types/options remain
in the module.

```sh
node --test web/tests/browser-lifecycle.test.mjs
```

Run from repository root. Synthetic tests cover trust, invalidation, storage
failure/races and advisory limits, not real browser/device timing or compiler output.

## 简体中文

### 使用与失效

可选缓存把可丢弃结果放在所选输入目录的 D2R-cache/v1/。权限、配额、损坏、API 不可用或超时
只显示一次固定非致命提示并回退生成，取消仍终止任务。“忽略构建缓存”只绕过读取，新验证结果
仍可更新；公开运行时下载缓存独立。不得缓存密钥、密码、证书/描述文件、提取状态、原始字体/纹理或解码像素。

目录文件和旁边 JSON 不证明来源。同源 Cache Storage 独立账本记录应用实际生成且校验的大小/
SHA-256，随机标记只选择账本。命中须同时核对持有的文件快照、账本和当前验证器。清除浏览器
数据或换浏览器/源后必须重建，即使目录还在；旧 .d2r-cache 不读取、迁移或删除。

着色器键绑定精确规范化 MSL、着色器身份、完整源码摘要、编译器身份、目标选项和运行时摘要。
命中仍翻译当前输入、重建反射和完成 6,927 键源码证明，**只跳过 AIR 编译**。图像键包含刚读取
负载摘要、选项、外壳、配方及运行时身份。原生图像/HUD/地图目标命中只跳过渲染，不跳过认证、
源解码、其他生成器或导出；无运行时身份不复用。

### 维护与删除

local-output-cache 负责独立账本、期限、串行提交和 Web Lock；asset-output-cache 负责图像
结果/索引校验。文件验证并关闭后才发布索引，损坏或部分结果重算，取消擦除持有字节。精确预算
和迟到清理规则见上方模块，不能改为信任目录回执。

每文件 ≤16 MiB，账本最多 32,768 项/2 GiB，不是包含崩溃残留的硬磁盘配额；图像组另有限制。
非阻塞源锁只允许一个缓存会话，其他标签页正常生成但不缓存。存储操作限 10 秒，关闭/取消后
仍等在途 I/O 结束才释锁，但不无限阻塞生成。只删核验过的自身旧叶文件，不支持外部并发修改。

任务结束可删除 **D2R-cache 本身**，不可删除输入、资源目录、Legacy Device Pack 或 IPA。
资源完成标记缺少绑定来源的逐文件证明，缓存不能认证这些目录或判断手机已安装内容；不承诺耗时/内存收益。

### OPFS 建议与测试

容量建议仅调用 storage.estimate，不申请持久化/权限或预留空间。未知不是零；requiredBytes
必须独立已知，不能由 NSP 大小或 ASTC 8 GiB 上限推算。它表示浏览器源暂存估算，不是物理磁盘
或所选目录余量，不应阻断生成，真实写入错误才是依据；查询取消不恢复已取消任务。
精确选项与结果类型见源码。从仓库根目录运行上方测试，合成结果不证明真实浏览器/设备性能或编译输出。
