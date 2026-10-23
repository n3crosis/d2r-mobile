# One verification entry point, local first

中文: [TESTING.zh-CN.md](TESTING.zh-CN.md)

The repository has one GitHub Actions workflow: **Verify**. Ordinary pushes/PRs
run one quick Linux browser-build job, and manual dispatch runs that same job.
There are no CI matrices, cross-platform jobs, or optional heavy CI profiles.
The shared browser-build verification runs locally through:

```sh
node web/verification/verify.mjs quick
```

Prerequisites: Bun 1.4.3, Node 22.12+ (24 recommended), Python 3 with venv/pip,
and Bash. The default build uses the frozen Bun lock, Oxlint/Oxfmt, TypeScript,
production frontend compilation, docs/workflow formatting and authored
Python/C/Bash formatting. It deliberately does not run unit tests, synthetic
regressions, fixture/oracle preparation, browser proofs or device matrices.
Those commands remain available below for later verification.

CI installs Ruff 0.14.0 and clang-format 21.1.2 into an isolated temporary
venv. Local runs reuse those exact versions from PATH rather than reinstalling
them each time. Set them up once if needed:

```sh
python3 -m venv /tmp/d2r-style-tools
/tmp/d2r-style-tools/bin/pip install --index-url https://pypi.org/simple --only-binary=:all: ruff==0.14.0 clang-format==21.1.2
export PATH="/tmp/d2r-style-tools/bin:$PATH"
```

`bun scripts/check-local.mjs` and `bun run test` remain explicitly requested
local verification commands, not automatic build prerequisites. No full proof
suite is required after every source change. Contributors install these tools;
hosted packager users do not.

Compiler source-review cases are skipped with an explicit reason by default;
local checker and fixture tests still run. To include the source-review cases,
point the existing test command at an already available, matching reviewed source tree:

```sh
cd web
D2R_AIR_SOURCE_REVIEW_DIR=/absolute/path/to/reviewed/floor_llvm bun run test
```

These checks never download or execute a compiler. An explicitly set but empty,
missing or invalid source directory fails, as do changed source digests.
Production release authentication and the strict compile canary are unchanged.

## Local proof profiles

These remain available for explicit local development only. GitHub does not run
them or upload their artifacts. The dispatcher rejects heavy profiles in Actions.

- `quick`: the shared browser-build verification.
- `extraction`: authenticated NSP boundary and actual Chromium Worker.
- `signed-nca`: isolated synthetic signing-root proof; production trust unchanged.
- `texture`: decode, BC3 encode, swizzle, and Chromium Worker parity.
- `assets`: native art, HUD, map-goal, CASC overlays, and v61 cross-adapter parity.
- `program`: original ARM64 rewrite and Guest framework parity.
- `shader`: native/browser translator parity plus C# formatting/analyzers.
- `spirv-cross`: native/WASM SPIRV-Cross parity.
- `shader-pipeline`: linked translator-to-MSL pipeline proof.
- `offline-wasm`, `offline-pyodide`, `offline-dotnet`: respective sealed-network proofs.
- `staged-output`: actual Chromium OPFS commit/cancel/integrity proof.
- `zip64`: real >4 GiB synthetic CRC stream with bounded memory.
- `desktop-build` / `desktop`: retained platform recipes for an appropriately
  prepared local environment, not coordinated or run by GitHub.
- `full`: quick and all Linux proof recipes, sequentially and explicitly opted in.
  This does not include Windows/macOS checks or a Node-version matrix.

## Local heavyweight verification

The concrete build/assertion commands live in `web/verification/recipes/*.sh`;
`profiles.json` pins each proof's runtime, timeout and artifact boundaries. No
workflow generator or hidden copy of old workflow files exists. One dispatcher
validates profile names. Only the quick recipe is shared with Actions; heavy
recipes are local-only.
Failures skip later normal steps, retain always-run diagnostics, and fail the
profile. Source isolation, exact hashes, assertions, and private-input exclusions
remain in the original proof commands.

Review the chosen recipe first. Heavy profiles fetch/install official pinned
SDKs and build tools; some Linux recipes use `sudo apt-get` and install a .NET
workload or Chromium system dependencies. Local invocation refuses those recipes
unless explicitly opted in:

```sh
node web/verification/verify.mjs texture --provision
node web/verification/verify.mjs full --provision
```

Use a suitable Linux development environment for these Linux recipes. Local
`full` explicitly excludes Windows/macOS and reports that boundary; it cannot
claim desktop coverage on Linux. Desktop recipes require the matching OS and
verified producer artifact/digest supplied by the developer. They are not a
GitHub pipeline. If a sandbox cannot launch Chromium, do not retry around the
restriction or report a pass. Record the proof as blocked until a supported
local environment is available.

Run local proofs against the exact commit under review. Do not restore CI
fan-out to manufacture results. Repository required-check settings are separate
and can change.

## Downloadable webpage

A successful GitHub quick job uploads **web-preview**, containing only `web/dist/`:
the built HTML, JavaScript, CSS, public static assets, and `build-manifest.json`.
The manifest records the commit (when built in GitHub), byte sizes, and SHA-256
hashes. Retention is seven days. It excludes source/toolchain directories, game
files, keys and IPA output; unexpected hidden/key/game files fail packaging.

Extract the artifact and serve its contents through HTTPS static hosting. Opening
`index.html` through `file://` is not a supported folder-picker/runtime setup.
This artifact contains the implemented packaging webpage and its public runtimes,
not a generated game IPA. Generation is enabled after runtime/capability checks;
on 2026-10-23, the maintainer reported successful generated-IPA execution on a real iOS device. The exact tested build, device/iOS version, input format and gameplay coverage were not specified. This report does not validate a fresh fork compiler release.
Uploading the artifact does not publish it to the private hosted Site.
Synthetic component results do not prove complete game processing, shell/device
compatibility, installation or execution; see the delivery checklist.

The same single GitHub job also builds the pinned public JavaScript/WASM/.NET/Cross
runtimes after frontend verification, then uploads the manifest-verified runtime
inventory under `web-preview/runtime/`. It adds no browser proof suite, matrix or
second job. See [runtime assembly](runtime-build/README.md) for exact prerequisites
and the distinction between built runtime files and a verified usable game IPA.
Pyodide remains available for explicitly invoked local proofs and parity oracles,
but it is not installed or packaged by the current public-runtime build.

For non-AIR SDK provisioning, CI caches only pinned Emscripten download archives,
not installed SDK tools. Separate AIR caches contain manifest-bound release artifacts
and installed outputs; release/source/receipt authentication and the strict canary
remain mandatory. See
[SDK download cache](verification/SDK_CACHE.md) for scope and validation limits.
