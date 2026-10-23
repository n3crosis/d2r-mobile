#!/usr/bin/env bash
# 运行 zip64 验证配方；依据同目录验证调度器的步骤约定。
# Run the zip64 verification recipe under the sibling verification scheduler's step contract.

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

step step3 'Confirm independent Python oracle prerequisite' web 0 <<'VERIFY_STEP'
python3 --version
VERIFY_STEP

step step4 'Stream real large payload without retaining output' web 300 <<'VERIFY_STEP'
export NODE_OPTIONS="--max-old-space-size=256"
export ZIP64_LARGE_STREAM_TEST="1"
node --test --test-timeout=240000 tests/zip64-writer.test.mjs
VERIFY_STEP

always_step step5 'Record validation boundary' web 0 <<'VERIFY_STEP'
{
  echo '### ZIP64 bounded stream validation'
  echo 'The test processes 4 GiB + 4 MiB of synthetic zero bytes through the real CRC loop, with one reused 4 MiB input buffer and a discard/count sink. Python zlib independently checks CRC; a second entry verifies a central-directory offset above 4 GiB.'
  echo 'Small real archives are independently extracted with Python zipfile. Metadata-only tests cover exact offsets above 2^53.'
  echo 'No multi-gigabyte archive is retained or independently extracted. Browser destination quotas, game data, resource-export integration, IPA installation and device compatibility are not established by this job.'
} >> "$GITHUB_STEP_SUMMARY"
VERIFY_STEP

finish
