#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

step step3 'Install pinned official Emscripten SDK' . 0 <<'VERIFY_STEP'
git clone --depth 1 --branch 4.0.20 https://github.com/emscripten-core/emsdk.git "$RUNNER_TEMP/nsp-emsdk"
test "$(git -C "$RUNNER_TEMP/nsp-emsdk" rev-parse HEAD)" = e4fe26ef59168ff44f4c23c466e497bf60b3411e
"$RUNNER_TEMP/nsp-emsdk/emsdk" install 4.0.20
"$RUNNER_TEMP/nsp-emsdk/emsdk" activate 4.0.20
VERIFY_STEP

step step4 'Prove authenticated toy extraction with isolated test root' . 0 <<'VERIFY_STEP'
source "$RUNNER_TEMP/nsp-emsdk/emsdk_env.sh"
bash web/toolchain/synthetic-signed-nca/run-ci.sh
VERIFY_STEP

finish
