#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

step step3 'Verify synthetic archives and Python ZIP oracle' . 0 <<'VERIFY_STEP'
node --test web/tests/staged-zip-validator.test.mjs web/tests/browser-staged-output.test.mjs
VERIFY_STEP

step step4 'Install pinned browser proof tooling' . 0 <<'VERIFY_STEP'
npm install --prefix "$RUNNER_TEMP/staged-playwright" --no-audit --no-fund playwright@1.64.1
"$RUNNER_TEMP/staged-playwright/node_modules/.bin/playwright" install --with-deps chromium
VERIFY_STEP

step step5 'Exercise real Chromium OPFS staging and cancellation' . 0 <<'VERIFY_STEP'
PLAYWRIGHT_ENTRY="$RUNNER_TEMP/staged-playwright/node_modules/playwright/index.mjs" \
  node web/toolchain/staged-output-spike/browser-smoke.mjs
VERIFY_STEP

finish
