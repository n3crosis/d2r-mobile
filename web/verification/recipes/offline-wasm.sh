#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

step step3 'Install pinned official Emscripten SDK' . 0 <<'VERIFY_STEP'
git clone --depth 1 --branch 4.0.20 https://github.com/emscripten-core/emsdk.git "$RUNNER_TEMP/texture-emsdk"
test "$(git -C "$RUNNER_TEMP/texture-emsdk" rev-parse HEAD)" = e4fe26ef59168ff44f4c23c466e497bf60b3411e
"$RUNNER_TEMP/texture-emsdk/emsdk" install 4.0.20
"$RUNNER_TEMP/texture-emsdk/emsdk" activate 4.0.20
VERIFY_STEP

step step4 'Build bounded texture WASM API' . 0 <<'VERIFY_STEP'
source "$RUNNER_TEMP/texture-emsdk/emsdk_env.sh"
bash web/toolchain/texture-spike/build-wasm.sh
VERIFY_STEP

step step5 'Prepare hashed offline runtime bundle' . 0 <<'VERIFY_STEP'
node web/toolchain/offline-runtime-spike/prepare-bundle.mjs
VERIFY_STEP

step step6 'Install browser proof tooling' . 0 <<'VERIFY_STEP'
npm install --prefix "$RUNNER_TEMP/offline-playwright" --no-audit --no-fund playwright@1.64.1
"$RUNNER_TEMP/offline-playwright/node_modules/.bin/playwright" install --with-deps chromium
VERIFY_STEP

step step7 'Prove sealed worker conversion and blocked network without request interception' . 0 <<'VERIFY_STEP'
PLAYWRIGHT_ENTRY="$RUNNER_TEMP/offline-playwright/node_modules/playwright/index.mjs" \
  node web/toolchain/offline-runtime-spike/browser-proof.mjs
VERIFY_STEP

finish
