#!/usr/bin/env bash
# 运行 desktop 验证配方；依据同目录验证调度器的步骤约定。
# Run the desktop verification recipe under the sibling verification scheduler's step contract.

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

step step3 'Verify transfer against trusted producing-job digest' . 0 <<'VERIFY_STEP'
export EXPECTED_DIGEST="$EXPECTED_DIGEST"
node web/toolchain/desktop-browser-spike/verify-transfer.mjs verify web/toolchain/offline-runtime-spike/dist "$EXPECTED_DIGEST"
VERIFY_STEP

step step4 'Install pinned official Chromium proof tooling' . 0 <<'VERIFY_STEP'
npm install --prefix "$RUNNER_TEMP/desktop-playwright" --ignore-scripts --no-audit --no-fund playwright@1.64.1
node "$RUNNER_TEMP/desktop-playwright/node_modules/playwright/cli.js" install chromium
VERIFY_STEP

step step5 'Exercise real OPFS commit and cancellation' . 180 <<'VERIFY_STEP'
export PLAYWRIGHT_ENTRY="$RUNNER_TEMP/desktop-playwright/node_modules/playwright/index.mjs"
node web/toolchain/staged-output-spike/browser-smoke.mjs
VERIFY_STEP

step step6 'Exercise sealed Emscripten Worker and negative preload cases' . 180 <<'VERIFY_STEP'
export PLAYWRIGHT_ENTRY="$RUNNER_TEMP/desktop-playwright/node_modules/playwright/index.mjs"
node web/toolchain/offline-runtime-spike/browser-proof.mjs
VERIFY_STEP

always_step step7 'Record environment and evidence boundary' . 0 <<'VERIFY_STEP'
node web/toolchain/desktop-browser-spike/report-environment.mjs
VERIFY_STEP

finish
