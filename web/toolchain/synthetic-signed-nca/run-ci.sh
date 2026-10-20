#!/usr/bin/env bash
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
PRODUCTION=$(cd "$HERE/../nsp-extract-spike" && pwd)
# This scratch directory is never under the production dist tree or uploaded.
WORK=$(mktemp -d "${RUNNER_TEMP:-/tmp}/synthetic-signed-nca.XXXXXX")
trap 'rm -rf "$WORK"' EXIT
node --test "$HERE/generate.test.mjs"
node "$HERE/generate.mjs" "$WORK/fixtures"
NSP_BUILD_DIR="$WORK/prod-build" NSP_OUTPUT_DIR="$WORK/prod-dist" bash "$PRODUCTION/build-wasm.sh"
mkdir "$WORK/test-source"
# Copy source files only. No existing output or cached build can enter the test build.
find "$PRODUCTION" -maxdepth 1 -type f -exec cp {} "$WORK/test-source/" \;
cp "$HERE/inject-test-root.py" "$WORK/inject-test-root.py"
# Test-only preparation hook exists exclusively in this temporary build copy.
cat >> "$WORK/test-source/prepare-source.py" <<'PY'
import subprocess
subprocess.run([sys.executable, str(Path(__file__).parent.parent / 'inject-test-root.py'), str(root), str(Path(__file__).parent.parent / 'fixtures/test-root.bin')], check=True)
PY
NSP_BUILD_DIR="$WORK/test-build" NSP_OUTPUT_DIR="$WORK/test-dist" bash "$WORK/test-source/build-wasm.sh"
# Ensure the actual authenticated boundary and all upstream code except one modulus match.
cmp "$PRODUCTION/boundary.c" "$WORK/test-source/boundary.c"
cmp "$PRODUCTION/build-wasm.sh" "$WORK/test-source/build-wasm.sh"
python3 "$HERE/verify-build-isolation.py" "$WORK"
node "$HERE/prove.mjs" "$WORK/prod-dist/hactool-boundary.mjs" "$WORK/test-dist/hactool-boundary.mjs" "$WORK/fixtures"
