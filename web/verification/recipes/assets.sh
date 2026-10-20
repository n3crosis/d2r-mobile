#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

step step3 'Install pinned build-only dependencies' web/toolchain/asset-generation-spike 0 <<'VERIFY_STEP'
npm ci --ignore-scripts
npx --no-install playwright install --with-deps chromium
python3 -m venv "$RUNNER_TEMP/asset-reference"
"$RUNNER_TEMP/asset-reference/bin/pip" install 'Pillow==11.1.0' 'numpy==2.0.2' 'fonttools==4.55.3'
VERIFY_STEP

step step4 'Package audited native core and self-hosted runtime' web/toolchain/asset-generation-spike 0 <<'VERIFY_STEP'
npm run prepare:core
npm run prepare:runtime
VERIFY_STEP

step step5 'Independent synthetic native reference' web/toolchain/asset-generation-spike 0 <<'VERIFY_STEP'
"$RUNNER_TEMP/asset-reference/bin/python" test/native-reference.py
python3 test/native-derived.py
"$RUNNER_TEMP/asset-reference/bin/python" test/native-art-reference.py
"$RUNNER_TEMP/asset-reference/bin/python" test/hud-reference.py --raqm
VERIFY_STEP

step step6 'Build separately scoped native Pillow BASIC reference' web/toolchain/asset-generation-spike 0 <<'VERIFY_STEP'
sudo apt-get update
sudo apt-get install -y libjpeg-dev zlib1g-dev
python3 test/build-hud-reference.py "$RUNNER_TEMP/hud-backend"
python3 -m venv "$RUNNER_TEMP/hud-reference"
"$RUNNER_TEMP/hud-reference/bin/pip" install 'setuptools==75.8.0' 'wheel==0.45.1' 'numpy==2.0.2' 'fonttools==4.55.3'
export PKG_CONFIG_PATH="$RUNNER_TEMP/hud-backend/lib/pkgconfig"
export LD_LIBRARY_PATH="$RUNNER_TEMP/hud-backend/lib:${LD_LIBRARY_PATH:-}"
"$RUNNER_TEMP/hud-reference/bin/pip" install --no-build-isolation --no-deps "$RUNNER_TEMP/hud-backend/pillow-10.2.0" -C raqm=disable -C freetype=True
"$RUNNER_TEMP/hud-reference/bin/python" test/hud-reference.py
"$RUNNER_TEMP/hud-reference/bin/python" test/map-goal-reference.py
VERIFY_STEP

step step7 'Execute real Chromium worker and demand exact parity' web/toolchain/asset-generation-spike 0 <<'VERIFY_STEP'
timeout --kill-after=5s 180s npm run test:browser
"$RUNNER_TEMP/asset-reference/bin/python" test/verify-png.py
timeout --kill-after=5s 180s node test/casc-overlay-browser.mjs
VERIFY_STEP

step step8 'Build pinned texture bridge for cross-adapter parity' web/toolchain/asset-generation-spike 0 <<'VERIFY_STEP'
git clone --depth 1 --branch 4.0.20 https://github.com/emscripten-core/emsdk.git "$RUNNER_TEMP/asset-texture-emsdk"
test "$(git -C "$RUNNER_TEMP/asset-texture-emsdk" rev-parse HEAD)" = e4fe26ef59168ff44f4c23c466e497bf60b3411e
"$RUNNER_TEMP/asset-texture-emsdk/emsdk" install 4.0.20
"$RUNNER_TEMP/asset-texture-emsdk/emsdk" activate 4.0.20
source "$RUNNER_TEMP/asset-texture-emsdk/emsdk_env.sh"
bash ../texture-spike/build-wasm.sh
python3 test/native-v61.py
VERIFY_STEP

step step9 'Verify actual v61 texture worker through asset and packaging adapters' web/toolchain/asset-generation-spike 0 <<'VERIFY_STEP'
timeout --kill-after=5s 180s node test/v61-browser.mjs
"$RUNNER_TEMP/asset-reference/bin/python" test/native-v61.py --verify
VERIFY_STEP

finish
