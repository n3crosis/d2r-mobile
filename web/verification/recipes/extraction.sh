#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

step step3 'Install pinned official Emscripten SDK' . 0 <<'VERIFY_STEP'
git clone --depth 1 --branch 4.0.20 https://github.com/emscripten-core/emsdk.git "$RUNNER_TEMP/nsp-emsdk"
test "$(git -C "$RUNNER_TEMP/nsp-emsdk" rev-parse HEAD)" = e4fe26ef59168ff44f4c23c466e497bf60b3411e
"$RUNNER_TEMP/nsp-emsdk/emsdk" install 4.0.20
"$RUNNER_TEMP/nsp-emsdk/emsdk" activate 4.0.20
VERIFY_STEP

step step4 'Build pinned upstream and bounded WASM API' . 0 <<'VERIFY_STEP'
source "$RUNNER_TEMP/nsp-emsdk/emsdk_env.sh"
bash web/toolchain/nsp-extract-spike/build-wasm.sh
VERIFY_STEP

step step5 'Run synthetic container tests' . 0 <<'VERIFY_STEP'
node --test web/toolchain/nsp-extract-spike/*.test.mjs web/tests/extraction-worker-client.test.mjs web/tests/extraction-job-adapter.test.mjs web/tests/d2r-expansion-policy.test.mjs
VERIFY_STEP

step step6 'Install browser test tools from official npm package' . 0 <<'VERIFY_STEP'
npm install --prefix "$RUNNER_TEMP/nsp-playwright" --no-audit --no-fund playwright@1.64.1
"$RUNNER_TEMP/nsp-playwright/node_modules/.bin/playwright" install --with-deps chromium
VERIFY_STEP

step step7 'Exercise WASM in Chromium dedicated Worker' . 0 <<'VERIFY_STEP'
PLAYWRIGHT_ENTRY="$RUNNER_TEMP/nsp-playwright/node_modules/playwright/index.mjs" \
  node web/toolchain/nsp-extract-spike/browser-smoke.mjs
VERIFY_STEP

finish
