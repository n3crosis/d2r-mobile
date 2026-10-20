# Public SDK download cache

[简体中文](SDK_CACHE.zh-CN.md)

The single Verify job caches only `$RUNNER_TEMP/browser-emsdk/downloads`, containing
public Emscripten SDK archives. Each run first clones SDK 4.0.20 afresh and checks
commit `e4fe26ef59168ff44f4c23c466e497bf60b3411e`, then restores downloads with an
exact key containing the runner OS/architecture, Ubuntu image, SDK version and
source commit. No fallback restore keys are configured.

`EMSDK_KEEP_DOWNLOADS=1` preserves downloaded archives for reuse. The pinned
[SDK implementation](https://github.com/emscripten-core/emsdk/blob/e4fe26ef59168ff44f4c23c466e497bf60b3411e/emsdk.py)
otherwise removes them after successful installation. Install, activate, the
explicit compiler-version check and all project source/build/receipt checks still
run on cache hits. Cache misses use the existing official SDK download path.

The action is pinned to
[`actions/cache` v6.1.0](https://github.com/actions/cache/releases/tag/v6.1.0),
commit `55cc8345863c7cc4c66a329aec7e433d2d1c52a9`; its
[action definition](https://github.com/actions/cache/blob/55cc8345863c7cc4c66a329aec7e433d2d1c52a9/action.yml)
uses Node 24. The cache excludes SDK scripts, installed tools, Rust/.NET caches,
project build directories, runtime payloads, private inputs and credentials.
No job, matrix or build-skip path is added. Every runtime is rebuilt.

This can reduce repeated upstream downloads, not compilation or archive
extraction. No timing improvement is measured or guaranteed. Repository wiring
is not proof of a successful cache restore/save in CI; inspect the exact run's
cache log. Caches are not source authentication or build attestations, and never
replace the existing compiler/source checks or manifest-verified staging.

Local checks: workflow formatting, YAML parsing, Bash syntax of every `run` block,
and `node --test web/tests/ci-policy.test.mjs`. These do not execute the hosted
cache service, install SDKs or demonstrate browser/device behavior.

Hosted evidence: [run 39492925067](https://github.com/n3crosis/d2r-mobile/actions/runs/39492925067)
passed on 2026-10-20. The exact SDK download key initially missed and was saved
successfully after the build. A later cache hit and timing savings are not yet
established by that first run.
