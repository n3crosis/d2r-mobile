#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

step step3 'Install exact official registry dependencies' web/toolchain/program-rewrite-spike 0 <<'VERIFY_STEP'
npm ci --ignore-scripts
python3 -m venv .venv
.venv/bin/pip install capstone==5.0.3 lz4==4.4.4
npx playwright install --with-deps chromium
VERIFY_STEP

step step4 'Build real ARM64 Capstone and LZ4 WASM with pinned official SDK' web/toolchain/program-rewrite-spike 0 <<'VERIFY_STEP'
bash build-wasm.sh
VERIFY_STEP

step step5 'Generate synthetic NSOs and original native Python oracle' web/toolchain/program-rewrite-spike 0 <<'VERIFY_STEP'
.venv/bin/python audit-source.py
.venv/bin/python make-fixtures.py
cp -r fixtures dist/
VERIFY_STEP

step step6 'Compare actual Chromium worker outputs byte for byte with native' web/toolchain/program-rewrite-spike 0 <<'VERIFY_STEP'
npm run test:browser
VERIFY_STEP

finish
