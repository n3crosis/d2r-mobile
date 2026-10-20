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

step step5 'Generate native synthetic oracle and validate bounded C' . 0 <<'VERIFY_STEP'
python3 web/toolchain/texture-spike/native-fixtures.py
VERIFY_STEP

step step6 'Compare native and WASM layout, mip decoding and malformed inputs' . 0 <<'VERIFY_STEP'
node --test web/toolchain/texture-spike/texture.test.mjs
VERIFY_STEP

step step7 'Generate original BC3 encoding and packing oracle' . 0 <<'VERIFY_STEP'
python3 -m venv "$RUNNER_TEMP/texture-reference"
"$RUNNER_TEMP/texture-reference/bin/pip" install 'numpy==2.0.2' 'Pillow==11.1.0'
"$RUNNER_TEMP/texture-reference/bin/python" web/toolchain/texture-spike/native-encoder-fixtures.py
node --test web/toolchain/texture-spike/encoder.test.mjs
VERIFY_STEP

step step8 'Install browser test tools from official npm package' . 0 <<'VERIFY_STEP'
npm install --prefix "$RUNNER_TEMP/texture-playwright" --no-audit --no-fund playwright@1.64.1
"$RUNNER_TEMP/texture-playwright/node_modules/.bin/playwright" install --with-deps chromium
VERIFY_STEP

step step9 'Exercise WASM in Chromium dedicated Worker' . 0 <<'VERIFY_STEP'
PLAYWRIGHT_ENTRY="$RUNNER_TEMP/texture-playwright/node_modules/playwright/index.mjs" \
  node web/toolchain/texture-spike/browser-smoke.mjs
VERIFY_STEP

step step10 'Prepare pinned self-hosted original Python codec runtime' web/toolchain/asset-generation-spike 0 <<'VERIFY_STEP'
npm ci --ignore-scripts --no-audit --no-fund
npm run prepare:runtime
VERIFY_STEP

step step11 'Verify original BC3 encoding, packing and cancellation in Chromium' . 0 <<'VERIFY_STEP'
PLAYWRIGHT_ENTRY="$RUNNER_TEMP/texture-playwright/node_modules/playwright/index.mjs" \
  timeout --kill-after=5s 240s node web/toolchain/texture-spike/encoder-browser-smoke.mjs
VERIFY_STEP

finish
