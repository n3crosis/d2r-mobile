# Local generated-output cache

The browser packager may save disposable generated outputs in `D2R-cache/v1/`
inside the selected input folder. The cache is optional: permission, quota,
corruption, unsupported browser storage, and storage timeouts fall back to normal
generation. A fixed nonfatal notice is emitted once; raw paths/errors are not
shown. Cancellation still cancels generation.

“Ignore saved build cache” skips cached-output reads for that run. Fresh accepted
outputs may refresh the cache. This does not disable the separate verified public
runtime-download cache. No account credentials, game keys, signing keys,
certificates, passwords, or provisioning profiles belong in this cache.

## Trust and invalidation

Folder files and neighboring JSON are never proof of compiler provenance. A
separate same-origin browser Cache Storage ledger records the size and SHA-256
of outputs that the app has actually generated and validated. The random folder
marker only selects a ledger; it does not authenticate its files. Cache readers
check an owned file snapshot against that independent ledger and the current
output validator. Clearing browser storage or moving to another browser/origin
therefore requires rebuilding, even if the folder files remain.

Shader keys include normalized exact MSL SHA-256, shader key/variant/entry/stage,
expected source-set digest, the full compiler identity (including WASM, factory,
headers, ABI, language and math profile), target/options, and the pinned public
runtime manifest digest. The manifest conservatively invalidates cache entries
when any runtime component changes. Every hit still regenerates translation and
reflection from current inputs and participates in the complete 6,927-key source
digest proof. Only AIR compilation is skipped. No partial source proof or
source-only output becomes acceptable.

Asset callers bind freshly read input payload hashes, recipe/options, profile,
and the same runtime pin. Only outputs accepted by their existing validators are
stored. The cache is not an extraction/input-authentication bypass.

## Bounds and lifecycle

- Each blob is at most 16 MiB. Callers may impose tighter limits.
- The trusted ledger is bounded to 32,768 entries and 2 GiB of committed records.
  This is not a hard filesystem quota: crash or externally modified leftovers
  can occupy additional disk space, and no recursive cleanup is performed.
- Each read or write operates on one bounded output. Shader reads may overlap
  within the [bounded compiler window](SHADER_PARALLELISM.md); cache commits are
  serialized. Shader output still uses its existing 512 MiB combined retained-
  output/replay budget; caching does not promise reduced peak memory.
- Each storage operation has a 10-second deadline. Late reads are discarded and
  wiped, late created files are cleaned up when ownership can be checked, and
  the ledger is published only after the output file closes successfully.
- A nonblocking exclusive Web Lock permits one cache session per origin. A
  concurrent tab continues generating without using the cache rather than
  racing ledger accounting. Close/cancel retains that lock in the background
  until already-started storage operations and cleanup settle; generation does
  not wait indefinitely for them.
- A successful refresh removes only the superseded ledger-listed leaf after
  checking its size, hash and handle identity. Unknown or modified leaves are
  preserved. File System Access has no exclusive-create/compare-and-delete
  primitive; concurrent external modification of cache files is unsupported.

The entire `D2R-cache` folder is disposable and can be deleted manually after a
job has ended. Missing files become misses. Cache statistics, an automatic cache
clear button, portable signed cache manifests, translation caching, disk-backed
shader output, and browser/device timing proof are not implemented here.

Older `.d2r-cache` folders are left untouched and are not read or automatically
migrated. A fresh `D2R-cache` gets a new marker identity and therefore a separate
trusted ledger; existing hidden-cache records cannot become hits in the new folder.

## Verification

Synthetic storage and production-loop mocks cover cold/warm reuse, key changes,
independent-ledger enforcement, tampering, ignore/refresh, proof-first output,
quota/storage failures, concurrency, close/cancel races and late cleanup. They do
not execute private game inputs, a compiler, WASM, a browser, or a device.

## 简体中文

可重复使用的生成结果保存在所选输入目录的 `D2R-cache/v1/` 中。
旧的 `.d2r-cache` 文件夹不会被读取、自动迁移或删除。新的 `D2R-cache` 使用新的
标记身份与独立可信账本，不会误用旧隐藏缓存的记录。
“忽略已保存的构建缓存”会跳过本次读取，但新生成且校验通过的结果仍可更新缓存；
它不关闭公开运行时下载缓存。目录中的文件或 JSON 不能自行证明可信性，必须与
当前浏览器同源存储的独立摘要记录一致，并重新通过输出校验。清除浏览器数据或
更换浏览器后需要重新生成。着色器仍会重新翻译、重建反射并检查完整源码集合摘要，
只跳过已匹配结果的 AIR 编译。不会缓存密钥、密码、证书或签名配置。

缓存错误不应中止正常生成，取消操作仍然有效。单文件上限为 16 MiB，已登记记录
上限为 32,768 个、2 GiB；这不是包含崩溃残留文件的硬磁盘配额。不会递归删除目录。
任务结束后可以手动删除整个 `D2R-cache` 文件夹。现有验证仅使用合成数据与模块模拟，
没有执行私有输入、真实编译器、WASM、浏览器或设备验证。
