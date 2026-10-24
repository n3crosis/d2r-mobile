# Verification and E2E tooling / 验证与端到端工具

## English

### Start with the shared quick check

The single **Verify** workflow runs one Linux browser-build job for ordinary
pushes/PRs and manual dispatch. Run its shared local entry point from repository root:

```sh
node web/verification/verify.mjs quick
(cd web && bun scripts/check-local.mjs)
(cd web && bun run test)
node --test web/tests/build-policy.test.mjs
```

`quick` needs Bun 1.4.3, Node 22.12+ (24 recommended), Python with venv/pip and
Bash. It checks the frozen install, frontend/types/lint/format and authored-language
style, **not unit tests, browser proofs or device matrices**. The next commands
are separate explicit local checks. Install exact style tools once if absent:

```sh
python3 -m venv /tmp/d2r-style-tools
/tmp/d2r-style-tools/bin/pip install --index-url https://pypi.org/simple --only-binary=:all: ruff==0.14.0 clang-format==21.1.2
export PATH="/tmp/d2r-style-tools/bin:$PATH"
(cd web && D2R_AIR_SOURCE_REVIEW_DIR=/absolute/path/to/reviewed/floor_llvm bun run test)
```

AIR source-review cases otherwise skip explicitly. A supplied empty/missing/wrong
source tree fails; tests neither download nor execute the compiler. Runtime
release authentication and canary remain mandatory.

### Explicit heavyweight proofs

Review [profiles](../../web/verification/profiles.json) and
[recipes](../../web/verification/recipes/) first. Supported local profiles include
`extraction`, `signed-nca`, `texture`, `program`, `shader`, `spirv-cross`,
`shader-pipeline`, `offline-wasm`, `offline-dotnet`, `staged-output`, `zip64`,
`desktop-build`, `desktop`, and `full`. Heavy profiles are rejected in Actions.
`full` runs Linux recipes sequentially, not Windows/macOS or a Node matrix.
Some recipes provision pinned tools, use sudo/apt or install workloads/Chromium dependencies:

```sh
node web/verification/verify.mjs texture --provision
node web/verification/verify.mjs full --provision
```

Use a suitable environment and exact review commit. Do not bypass sandbox Chromium
restrictions or label blocked proofs as passes. Desktop recipes require matching
OS and producer-verified artifacts/digests; preserve notices and exclude private
inputs/browser profiles.

The isolated [texture proof](../../web/toolchain/offline-runtime-spike/browser-proof.mjs)
uses strict CSP, sentinel positive controls and server receipts proving no requests
after sealing. Production does **not** have that lockdown. Its direct commands are:

```sh
bash web/toolchain/texture-spike/build-wasm.sh
node web/toolchain/offline-runtime-spike/prepare-bundle.mjs
PLAYWRIGHT_ENTRY=/absolute/path/to/playwright/index.mjs node web/toolchain/offline-runtime-spike/browser-proof.mjs
```

The .NET proof requires `-p:WasmInlineBootConfig=false` and a message listener via
`addEventListener`, not the loader-owned `onmessage` slot. Its
[worker](../../web/toolchain/offline-runtime-spike/dotnet-worker.mjs) preserves verified resource
hooks without broad eval fallback; [official loader APIs](https://github.com/dotnet/runtime/blob/v10.0.13/src/mono/browser/runtime/loader/run.ts)
remain the reference. Retired `assets`/`offline-pyodide` profiles are unavailable;
current JS parity checks do not claim identical historical proof coverage.

### Artifacts, cache and deployment

`web-preview` contains only built frontend/public runtimes and digest manifests,
retained seven days; not a game IPA. Serve over HTTPS, not file://. Staging rejects
unexpected/changed files. See [build policy](build-policy.md).

Non-AIR SDK caching covers only Emscripten download archives: fresh pinned SDK
checkout, exact OS/architecture/image/version/commit key, no fallback keys,
`EMSDK_KEEP_DOWNLOADS=1`; install/activate/source checks still run.
[actions/cache v6.1.0](https://github.com/actions/cache/tree/55cc8345863c7cc4c66a329aec7e433d2d1c52a9)
and [SDK behavior](https://github.com/emscripten-core/emsdk/blob/e4fe26ef59168ff44f4c23c466e497bf60b3411e/emsdk.py)
are pinned. AIR caches separately authenticate release/source/receipts and canary.
Cache hits are neither provenance nor measured speedup.

Pages must use GitHub Actions and allow only `pr/web-ipa-packager` in its environment.
Only successful pushes/manual runs on that branch deploy the existing artifact;
PRs and `feature/web-review-consolidation` do not. Configuration is not proof of a live site.

## 简体中文

### 先跑共用快速检查

唯一 Verify 工作流对普通推送/PR 和手动运行执行一个 Linux 构建。仓库根目录命令见上方。
quick 需 Bun 1.4.3、Node 22.12+（推荐 24）、带 venv/pip 的 Python 和 Bash；检查冻结安装、
前端/类型/lint/格式及作者代码样式，**不跑单元测试、浏览器证明或设备矩阵**。其余命令是显式本地检查。
缺样式工具时，用上方临时 venv 安装精确 Ruff/clang-format 版本。

AIR 源码审查用例默认明确跳过；显式指定源码目录必须存在且匹配摘要，空/错目录失败。
测试不下载或执行编译器；发布认证及 canary 不受影响。

### 显式重型验证

先查看 profiles 和 recipes。上方列表是支持的本地配置，Actions 拒绝重型配置。
full 顺序执行 Linux 方案，不含 Windows/macOS 或 Node 矩阵。部分方案安装固定工具、
使用 sudo/apt 或安装 workload/Chromium 依赖，必须显式 --provision。用适合环境及确切评审提交。
沙箱阻止 Chromium 时不得绕过或报告通过；桌面方案需对应系统和生产端验证的产物/摘要，
保留声明，不传私有输入或浏览器配置。

独立 texture 证明使用严格 CSP、可达性正控和服务端收据检查封闭后零请求；生产应用没有该锁定。
直接构建/准备/浏览器命令见上。独立 .NET 证明需外部 boot config 标志及 addEventListener，
不能占用加载器的 onmessage；资源钩子只给验证字节，不用宽泛 eval 回退，官方 API 链接见英文。
旧 assets/offline-pyodide 配置已移除，当前 JS 检查不声称保留全部旧证明覆盖。

### 产物、缓存与部署

web-preview 只包含构建网页、公开运行时和摘要清单，保留七天，不是游戏 IPA。通过 HTTPS 托管，
不能用 file://；暂存拒绝额外或变更文件。非 AIR 缓存只保存 Emscripten 下载归档，每次仍重新检出
固定 SDK，以精确系统/架构/镜像/版本/提交键恢复，无回退键，并重新安装、激活、核对来源。
EMSDK_KEEP_DOWNLOADS=1 保留归档；Action/SDK 来源见上。AIR 独立缓存仍认证发布、源码、回执并跑 canary。
命中不等于来源证明或实测加速。

Pages 选择 GitHub Actions，环境只允许 pr/web-ipa-packager。只有该分支成功推送/手动运行
部署同一产物，PR 和 feature/web-review-consolidation 不部署；配置好不代表站点已上线。
