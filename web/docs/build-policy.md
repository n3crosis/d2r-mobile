# Build and runtime policy / 构建与运行时策略

## English

### Frontend and public-runtime build

Use Bun **1.4.3**, Node **22.12+**, Oxlint **1.89.0**, Oxfmt **0.74.0**.
[package.json](../../web/package.json) and [bun.lock](../../web/bun.lock) are the
frontend authority; toolchain packages keep their separate manifests/locks.
`bunfig.toml` disables implicit peer/runtime installs: missing imports must fail,
not download during execution. From repository root:

```sh
(cd web && bun install --frozen-lockfile)
(cd web && bun run lint && bun run format:check)
(cd web && bun run format:docs:check && bun run format:workflows:check)
(cd web && bun run build)
(cd web && bun run build:bundle) # Frontend only, without repeating checks.
(cd web && bun audit --audit-level=high)
node web/runtime-build/build.mjs --plan
node web/runtime-build/build.mjs
node --test web/tests/build-policy.test.mjs
```

`build` checks translations, lint, formatting and TypeScript before bundling;
unit tests are separate. Respect authored/vendor/generated exclusions, disabled
sorting and language-specific Ruff/clang-format/Bash/C# checks. Do not run the web
formatter over native/vendor trees. See [verification](e2e-tooling.md).

Runtime prerequisites: official Emscripten **4.0.20**, commit
`e4fe26ef59168ff44f4c23c466e497bf60b3411e`; .NET SDK/workload **10.0.402** with
`wasm-tools`; Rust **1.99.1**, Git, CMake, make, Python, Node and Bun on PATH.
The script checks versions, does not install SDKs or run browser proofs.
[AIR is imported](air-compiler.md), never built locally. Other components compile
from pinned sources, including SPIRV-Cross
`f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7`; asset runtime is JS/WASM, not Pyodide.

### Packaging and optional groups

[package.mjs](../../web/runtime-build/package.mjs) produces ignored
`web/runtime-build/out/` only after all components succeed. Keep exact allowlists,
source/compiler receipts and notices; exclude game inputs, keys, fixtures and
proof pages. Caps are 64 MiB/file, 512 MiB total and 4,096 files, rejecting symlinks
and collisions. The trusted manifest digest is passed separately into staging/
HTML, never accepted from its own untrusted artifact. Build receipts are not
cryptographic attestations. Exact [transport](../../web/runtime-build/transport.mjs)
checks cover physical payloads and logical slices, including bounded decompression.

[Optional groups](../../web/runtime-asset-groups.mjs) are absent or complete:
`legacy-astc` contains producer/ASTC/streaming-SHA assets; `ipa-signing` contains
signer/WASM and receipts/notices. Reuse common PNG bytes. Preserve common ownership
and separate optional-only transport partitions; selecting one group must not
fetch the other's unique bytes. Unknown/partial groups fail. Direct API selection
defaults to no optional groups; the editable UI preloads both and starts workers
on demand from verified bytes. Retain ASTC File leases through output commit;
prepare signing before credential reads. See [runtime](sealed-runtime.md) and
[signing](ipa-signing.md). `productionEnabled:false` is legacy inventory metadata,
not a UI enablement switch or proof of production acceptance.

### Reproducibility and release boundaries

Keep real revision/dirty/compiler provenance. Cross derives `SOURCE_DATE_EPOCH`
from the pinned commit and uses `TZ=UTC` ([CMake](https://cmake.org/cmake/help/latest/command/string.html#timestamp)).
[ShaderSpike.csproj](../../web/toolchain/shader-spike/ShaderSpike.csproj) sets
`IncludeSourceRevisionInInformationalVersion=false`, `EnableSourceLink=false`,
`DebugType=portable`, `DebugSymbols=true` ([Microsoft](https://learn.microsoft.com/en-us/dotnet/core/compatibility/sdk/8.0/source-link),
[SourceLink](https://github.com/dotnet/sourcelink/blob/main/docs/README.md#enablesourcelink)).
These remove specific metadata variation, not all nondeterminism.

One Linux Verify build assembles/stages manifest-checked `web-preview`, with a
180-minute ceiling; no extra matrix or proof job. Only `pr/web-ipa-packager` has
the documented deployment path, not PRs or `feature/web-review-consolidation`.
A successful build is not browser startup, private-input parity or device acceptance.

## 简体中文

### 前端与公开运行时

使用 Bun 1.4.3、Node 22.12+、Oxlint 1.89.0、Oxfmt 0.74.0。前端以 package.json/
bun.lock 为准，独立工具链保留自己的清单/锁；bunfig 禁用隐式 peer 和运行时安装，缺导入必须失败。
从仓库根目录运行上方命令。build 在打包前检查翻译、lint、格式和 TypeScript，单元测试另跑。
保留作者文件/供应商/生成物排除规则、禁用排序及各语言检查，不要把 web 格式器跑到原生/供应商树。

运行时要求官方 Emscripten 4.0.20 及上方精确提交、.NET SDK/workload 10.0.402 的 wasm-tools、
Rust 1.99.1，以及 Git/CMake/make/Python/Node/Bun。脚本核对版本，不安装 SDK 或运行浏览器证明。
AIR 从固定发布导入，不本地编译；其他组件依固定源码构建，包括上方 Cross 提交。资产运行时为 JS/WASM，非 Pyodide。

### 打包与可选组

所有组件成功后才生成忽略的 runtime-build/out。保留准确允许列表、来源/编译器回执及许可证，
排除游戏、密钥、夹具和证明页面。上限单文件 64 MiB、总计 512 MiB、4,096 文件，拒绝符号链接/冲突。
可信清单摘要独立传给暂存/HTML，不能从同一未可信产物取得；构建回执不是密码学证明。
传输源码负责物理载荷和逻辑切片验证，包括有界解压。

legacy-astc 和 ipa-signing 只能完整存在或缺席，前者含生成器/ASTC/流式 SHA，后者含签名器/
WASM/回执声明；共用 PNG 不重复。保留公共归属和独立可选分区，选一组不能夹带另一组独有字节。
未知/部分组拒绝。API 默认不选可选组；可编辑 UI 预载两组，按需从验证字节启动。
ASTC File 租约保留至提交，签名前先准备线程再读凭据。productionEnabled:false 只是旧清单元数据，
不是 UI 开关或生产验收证明。

### 可复现性与发布

保留真实修订、dirty 和编译器来源。Cross 的 SOURCE_DATE_EPOCH 来自固定提交并用 TZ=UTC。
ShaderSpike 禁用修订信息版本和 SourceLink，保留 portable 调试符号；上方官方依据与源码说明
精确开关。这只消除已知元数据变化，不保证全部确定性。

单个 Linux Verify 构建/暂存清单验证的 web-preview，限 180 分钟，无额外矩阵/证明任务。
只有 pr/web-ipa-packager 有现行部署路径，PR 和 feature/web-review-consolidation 不部署。
构建成功不代表浏览器启动、私有输入一致性或设备验收。
