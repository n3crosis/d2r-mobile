#!/usr/bin/env bash
# 运行 desktop-build 验证配方；依据同目录验证调度器的步骤约定。
# Run the desktop-build verification recipe under the sibling verification scheduler's step contract.

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

step step3 'Check transfer-integrity negative cases' . 0 <<'VERIFY_STEP'
node --test web/toolchain/desktop-browser-spike/verify-transfer.test.mjs
VERIFY_STEP

step step4 'Build public WASM once with pinned official SDK' . 0 <<'VERIFY_STEP'
git clone --depth 1 --branch 4.0.20 https://github.com/emscripten-core/emsdk.git "$RUNNER_TEMP/desktop-emsdk"
test "$(git -C "$RUNNER_TEMP/desktop-emsdk" rev-parse HEAD)" = e4fe26ef59168ff44f4c23c466e497bf60b3411e
"$RUNNER_TEMP/desktop-emsdk/emsdk" install 4.0.20
"$RUNNER_TEMP/desktop-emsdk/emsdk" activate 4.0.20
source "$RUNNER_TEMP/desktop-emsdk/emsdk_env.sh"
bash web/toolchain/texture-spike/build-wasm.sh
node web/toolchain/offline-runtime-spike/prepare-bundle.mjs
VERIFY_STEP

step seal 'Seal exact public runtime transfer tree' . 0 <<'VERIFY_STEP'
node web/toolchain/desktop-browser-spike/verify-transfer.mjs seal web/toolchain/offline-runtime-spike/dist
VERIFY_STEP

finish
