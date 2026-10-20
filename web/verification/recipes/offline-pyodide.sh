#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

step step3 'Install pinned official runtime and browser tools' web/toolchain/asset-generation-spike 0 <<'VERIFY_STEP'
npm ci --ignore-scripts
npx --no-install playwright install --with-deps chromium
python3 -m venv "$RUNNER_TEMP/offline-reference"
"$RUNNER_TEMP/offline-reference/bin/pip" install 'Pillow==11.1.0'
VERIFY_STEP

step step4 'Package original core and independently generated native references' web/toolchain/asset-generation-spike 0 <<'VERIFY_STEP'
npm run prepare:runtime
npm run prepare:core
"$RUNNER_TEMP/offline-reference/bin/python" test/native-reference.py
VERIFY_STEP

step step5 'Apply source-locked internal loader adaptation and hash public closure' . 0 <<'VERIFY_STEP'
node web/toolchain/offline-runtime-spike/pyodide-prepare.mjs
VERIFY_STEP

step step6 'Demand native byte parity with no post-seal HTTP receipts' . 0 <<'VERIFY_STEP'
PLAYWRIGHT_ENTRY="$GITHUB_WORKSPACE/web/toolchain/asset-generation-spike/node_modules/playwright/index.mjs" \
  timeout --kill-after=5s 180s node web/toolchain/offline-runtime-spike/pyodide-browser.mjs
VERIFY_STEP

finish
