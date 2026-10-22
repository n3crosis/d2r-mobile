# Local IPA shader check / 本地 IPA 着色器检查

Run from the repository root with Node.js 22.12+:

```sh
node web/scripts/validate-ipa-shaders.mjs "/path/to/generated.ipa"
```

If your matching reference contains 7,212 game libraries, add the optional count:

```sh
node web/scripts/validate-ipa-shaders.mjs "/path/to/generated.ipa" --expected-count 7212
```

`7212` is reference-specific, not assumed for every game version. You can replace `node` with `bun`. The utility needs no native compiler, simulator, device, credentials or network access. It does not extract or modify the IPA.

The JSON result has separate `libraries` (all `.metallib` files) and `gameLibraries` (files under `msl/b-*`) counts. `--expected-count` applies only to compiled game libraries. Success requires at least one game library, no source-text or malformed libraries, valid archive layout/CRCs and valid library containers/embedded SHA-256 digests. Game libraries must declare iOS 18.0 and Metal 3.2, matching the current build profile. Exit status is `0` on success and `1` on failure. Only the first 20 issues are listed; `issueCount` includes all issues.

This accepts this app's canonical STORE ZIP32/ZIP64 output, including its signed output. Recompressed/repacked ZIPs, ZIP comments and external signing tools that rewrite the ZIP layout are not supported. Check the original downloaded IPA. It reads the whole archive for CRC verification, but uses reads of at most 4 MiB and inspects one library at a time (16 MiB per-library limit); it never loads the entire IPA into memory. Keep the file unchanged until the check finishes. Ctrl+C cancels.

Passing proves archive and container integrity only. It does **not** prove real shader compilation merely from an MTLB header, authenticate compiler provenance, check AIR semantics, establish Xcode equivalence, validate signing, demonstrate iPhone/GPU acceptance, or eliminate device-specific pipeline creation. The first declared function supplies structural expectations; no external trusted reference is inferred. Full-corpus and semantic comparison remain separate work; this task does not require an iPhone or simulator.

## 中文

在仓库根目录运行上面的命令。需要 Node.js 22.12+，也可将 `node` 换成 `bun`。`--expected-count 7212` 是可选的，只在你的对应参考版本确实包含 7,212 个游戏着色器库时使用，不适用于所有版本。

输出 JSON 分别统计全部 `.metallib` 文件（`libraries`）和 `msl/b-*` 下的游戏库（`gameLibraries`）。成功要求至少存在一个游戏库，没有残留源码文本或损坏的库，并通过 ZIP 布局/CRC、MTLB 容器及内置 SHA-256 摘要检查。游戏库还必须声明当前配置的 iOS 18.0 / Metal 3.2。可选数量只对已编译的游戏库生效。成功退出码为 `0`，失败为 `1`。

仅支持本应用直接生成的 STORE ZIP32/ZIP64 IPA，包括本应用签名后的输出。不支持重新压缩、带 ZIP 注释或被外部签名工具改写 ZIP 布局的文件，请检查原始下载文件。全程本地只读，不上传、不解包、不修改文件，无需原生编译器、模拟器或设备。CRC 检查会流式读取整个归档，每次最多读取 4 MiB；每次只检查一个库，单库上限为 16 MiB，不会将整个 IPA 载入内存。检查期间不要修改文件，可按 Ctrl+C 取消。

通过只表示归档和容器完整性通过，不代表 AIR 语义正确、编译器来源可信、与 Xcode 等价、签名有效、iPhone/GPU 可加载或完全免除设备端管线创建。不能仅凭 MTLB 文件头判断真正编译成功，完整目录与语义比较属于独立工作；本任务不要求 iPhone 或模拟器验证。

## Authored smoke / 自编小样本

```sh
node web/scripts/validate-ipa-shaders-smoke.mjs
```

This smoke uses tiny synthetic, non-executable bitcode envelopes to check ZIP32/ZIP64 handling, source rejection, a corrupted embedded digest and count mismatch. It is a utility check, not compiler or game validation.

该小样本只使用合成、不可执行的位码容器，检查 ZIP32/ZIP64、源码拒绝、摘要损坏和数量不符，不是编译器或游戏验证。
