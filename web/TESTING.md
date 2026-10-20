# Local-first testing

Run ordinary checks locally before a coherent commit. CI is a small independent
safety net, not the default development loop. These are contributor commands;
users of the hosted packager do not install Bun, Node, Python, or a toolchain.

## Everyday checks

Prerequisites: Bun 1.4.3, Node 22.12+ (24 recommended), and Python 3. The existing
synthetic tests use Node's test runner intentionally; Bun manages and bundles the
frontend, not a silent replacement test runtime.

```sh
cd web
bun install --frozen-lockfile
bun scripts/check-local.mjs
```

The shared entry point runs the production build (including Oxlint, Oxfmt and
TypeScript), synthetic unit/integration tests, and docs/workflow formatting. It
does not install tools, launch a browser, download game files, or use real keys.
Use `bun run test` or `node --test tests/<changed-area>.test.mjs` during iteration.
The large >4 GiB stream test stays explicitly opt-in, not a skipped coverage claim.

For authored Python/C/Bash changes, install the exact tools into an isolated
local environment once, then use the **same script** as CI from the repo root:

```sh
python3 -m venv /tmp/d2r-style-tools
/tmp/d2r-style-tools/bin/pip install --index-url https://pypi.org/simple --only-binary=:all: ruff==0.14.0 clang-format==21.1.2
PATH="/tmp/d2r-style-tools/bin:$PATH" bash web/scripts/check-authored-style.sh
```

The script checks only explicit authored files, never broadly formats native,
vendor, generated, downloaded runtime, or game files. C# format/analyzer checks
belong to the shader toolchain recipe because they require its pinned .NET SDK.

## What runs automatically

At most **two jobs** for a relevant ordinary push or pull request:

- `web-packager-checks.yml`: one Node 24 frontend job with Bun/Oxc, tests, build,
  dependency audit, and source-drift checks. No duplicate Node matrix or .NET build.
- `toolchain-style-checks.yml`: one short, path-filtered Python/C/Bash style job.

A manual dispatch of the frontend workflow can opt into Node 22 + 24 compatibility.
Concurrency cancellation still stops stale work on the same branch. Existing
heavy workflows have **no push or pull-request triggers**. Their tests, pinned
build dependencies, assertions and artifacts remain available; they are not
replaced by a passing dummy gate. Existing repository required-check settings
must be reconciled if they refer to retired automatic jobs; source files alone
cannot prove those settings.

## Targeted native/browser proofs

Run the relevant subsystem locally when its documented build prerequisites are
available. The linked workflow retains the exact setup, working directories,
commands, environment variables and pinned dependencies for a clean Linux run;
its corresponding `web/toolchain/*/README.md` describes the implementation.
Do not blindly execute workflow expressions as shell text. If the current local
environment cannot launch Chromium or lacks a required platform, explicitly
run only the relevant manual workflow instead. Never report a blocked local
browser run as a pass. Full Windows/macOS coverage belongs to release readiness,
not every frontend edit.

- Extraction/container/authentication changes: [NSP boundary](../.github/workflows/nsp-extraction-checks.yml), plus [isolated synthetic signature proof](../.github/workflows/synthetic-signed-nca.yml) when trust handling changes. The latter has a standalone local entry point, `bash web/toolchain/synthetic-signed-nca/run-ci.sh`, after its documented Emscripten prerequisites.
- Texture decode/BC3/swizzle changes: [texture proof](../.github/workflows/texture-browser-checks.yml).
- Native art/HUD/map-goal/CASC generator changes: [asset proof](../.github/workflows/browser-asset-checks.yml).
- ARM64 rewrite/Guest construction changes: [program proof](../.github/workflows/program-rewrite-checks.yml).
- Translator/C# changes: [shader runtime proof](../.github/workflows/shader-runtime-parity.yml), including authored C# format and analyzers.
- SPIRV-Cross changes: [Cross proof](../.github/workflows/spirv-cross-browser-checks.yml).
- Linked shader orchestration changes: [linked shader proof](../.github/workflows/shader-pipeline-browser-checks.yml).
- Offline runtime/bootstrap closure changes: relevant [Emscripten](../.github/workflows/offline-runtime-checks.yml), [Pyodide](../.github/workflows/offline-pyodide-checks.yml), or [.NET](../.github/workflows/offline-dotnet-checks.yml) sealed-network proof.
- OPFS/staging/commit changes: [staged output proof](../.github/workflows/staged-output-browser-checks.yml).
- ZIP64 arithmetic/CRC changes: [large stream proof](../.github/workflows/zip64-large-output-checks.yml), or locally from `web`: `ZIP64_LARGE_STREAM_TEST=1 NODE_OPTIONS=--max-old-space-size=256 node --test --test-timeout=240000 tests/zip64-writer.test.mjs`.
- Desktop API/platform changes and release readiness: [Windows/macOS Chromium proof](../.github/workflows/desktop-browser-checks.yml). Its Linux runtime build is shared between the two desktop jobs, not duplicated.

Manual runs must target the exact feature-branch commit under review. An older
passing artifact does not validate changed code. Manual dispatch availability
also depends on GitHub recognizing the workflow on the default branch; if the
feature-only workflow cannot be dispatched, use the local recipe or arrange an
explicit, reviewed workflow publication. Do not re-enable broad automatic
fan-out just to manufacture a check result.

Synthetic component checks do not establish a working real-game IPA, full-size
processing, shell compatibility, device installation, or game execution. Those
remain separate delivery gates in [the progress checklist](../docs/WEB_DELIVERY_PROGRESS.md).
