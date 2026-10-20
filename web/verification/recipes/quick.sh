#!/usr/bin/env bash
set -euo pipefail
cd "$VERIFY_ROOT/web"
bun install --frozen-lockfile
bun audit --audit-level=high
bun run build
bun run format:docs:check
bun run format:workflows:check
if [[ "${GITHUB_ACTIONS:-}" == true ]]; then
  python3 -m venv "$RUNNER_TEMP/style-tools"
  "$RUNNER_TEMP/style-tools/bin/pip" install --index-url https://pypi.org/simple --only-binary=:all: ruff==0.14.0 clang-format==21.1.2
  export PATH="$RUNNER_TEMP/style-tools/bin:$PATH"
else
  if [[ "$(ruff --version 2>/dev/null || true)" != "ruff 0.14.0" ]] || [[ "$(clang-format --version 2>/dev/null || true)" != "clang-format version 21.1.2" ]]; then
    echo "Install ruff==0.14.0 and clang-format==21.1.2 into an isolated environment and add its bin directory to PATH; see web/TESTING.md." >&2
    exit 1
  fi
fi
bash scripts/check-authored-style.sh
node verification/preview-manifest.mjs
