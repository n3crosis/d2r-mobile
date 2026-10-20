#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

export DOTNET_CLI_TELEMETRY_OPTOUT=1

export DOTNET_NOLOGO=1

export DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE=true

export SDK_VERSION=10.0.402

export WORKLOAD_VERSION=10.0.402

step step8 'Pin SDK and workload (also applies to native commands from this cwd)' web/toolchain/shader-spike 0 <<'VERIFY_STEP'
printf '{"sdk":{"version":"%s","rollForward":"disable","allowPrerelease":false,"workloadVersion":"%s"}}\n' "$SDK_VERSION" "$WORKLOAD_VERSION" > global.json
test "$(dotnet --version)" = "$SDK_VERSION"
dotnet --info
git rev-parse HEAD
mkdir -p "$RUNNER_TEMP/shader-parity"
VERIFY_STEP

step step9 'Install official developer prerequisites on CI only' web/toolchain/shader-spike 0 <<'VERIFY_STEP'
dotnet workload install wasm-tools
dotnet workload --version
dotnet workload list
npm ci --ignore-scripts
npm audit --audit-level=high
npx --no-install playwright install --with-deps chromium
sudo apt-get update
apt-cache policy spirv-tools
sudo apt-get install --no-install-recommends -y spirv-tools
spirv-val --version
npx --no-install playwright --version
df -h .
VERIFY_STEP

step publish 'Publish actual browser WASM bundle' web/toolchain/shader-spike 0 <<'VERIFY_STEP'
dotnet restore ShaderSpike.csproj
dotnet format ShaderSpike.csproj --no-restore --verify-no-changes --include ShaderBridge.cs EmbeddedResources.cs --verbosity normal
dotnet build ShaderSpike.csproj -c Release --no-restore -p:EnableNETAnalyzers=true -p:AnalysisLevel=latest -p:TreatWarningsAsErrors=true
dotnet publish ShaderSpike.csproj -c Release --no-restore -p:EnableNETAnalyzers=true -p:AnalysisLevel=latest -p:TreatWarningsAsErrors=true
VERIFY_STEP

step native 'Prepare tiny authored fixture and build independent original native oracle' web/toolchain/shader-spike 0 <<'VERIFY_STEP'
node verify-parity.mjs prepare "$RUNNER_TEMP/shader-parity/fixture"
native_project="$GITHUB_WORKSPACE/dm/gfx/tools/dmsh_xlate/dmsh_xlate.csproj"
dotnet restore "$native_project"
dotnet build "$native_project" -c Release --no-restore
native_dll="$GITHUB_WORKSPACE/dm/gfx/tools/dmsh_xlate/bin/Release/net10.0/dmsh_xlate.dll"
test -f "$native_dll"
actual=$(dotnet "$native_dll" --source-sha)
expected=$(cat "$GITHUB_WORKSPACE/dm/gfx/tools/dmsh_xlate/Program.cs" "$native_project" | sha256sum | cut -c1-16)
test "$actual" = "$expected"
echo "Verified original native embedded source: $actual"
sha256sum "$GITHUB_WORKSPACE/dm/gfx/tools/dmsh_xlate/Program.cs" "$native_project" ShaderBridge.cs ShaderSpike.csproj EmbeddedResources.cs synthetic-fixture.mjs wwwroot/synthetic-fixture.mjs "$RUNNER_TEMP/shader-parity/fixture/synthetic-exit.bin" "$RUNNER_TEMP/shader-parity/fixture/jobs.json"
git rev-parse HEAD:dm/third_party/ryujinx
timeout --kill-after=5s 60s dotnet "$native_dll" "$RUNNER_TEMP/shader-parity/fixture/jobs.json" "$RUNNER_TEMP/shader-parity/native"
test -s "$RUNNER_TEMP/shader-parity/native/synthetic-exit.spv"
test -s "$RUNNER_TEMP/shader-parity/native/synthetic-exit.res.json"
VERIFY_STEP

step browser 'Execute published module worker in real Chromium and capture download' web/toolchain/shader-spike 0 <<'VERIFY_STEP'
timeout --kill-after=5s 120s node capture-browser.mjs bin/Release/net10.0/publish "$RUNNER_TEMP/shader-parity/browser"
VERIFY_STEP

step parity 'Require exact binary and complete sidecar parity' web/toolchain/shader-spike 0 <<'VERIFY_STEP'
node verify-parity.mjs compare "$RUNNER_TEMP/shader-parity/native" "$RUNNER_TEMP/shader-parity/browser/browser-result.json" | tee "$RUNNER_TEMP/shader-parity/parity.json"
VERIFY_STEP

step validation 'Validate both emitted SPIR-V files without target relaxation' web/toolchain/shader-spike 0 <<'VERIFY_STEP'
timeout --kill-after=5s 30s spirv-val --target-env vulkan1.1 "$RUNNER_TEMP/shader-parity/native/synthetic-exit.spv"
timeout --kill-after=5s 30s spirv-val --target-env vulkan1.1 "$RUNNER_TEMP/shader-parity/native/browser-synthetic-exit.spv"
VERIFY_STEP

always_step step15 'Record bounded evidence and scope (no artifacts uploaded)' web/toolchain/shader-spike 0 <<'VERIFY_STEP'
export VALIDATION="${VERIFY_OUTCOME_validation:-skipped}"
export PARITY="${VERIFY_OUTCOME_parity:-skipped}"
export BROWSER="${VERIFY_OUTCOME_browser:-skipped}"
export NATIVE="${VERIFY_OUTCOME_native:-skipped}"
export PUBLISH="${VERIFY_OUTCOME_publish:-skipped}"
{
  echo '### Synthetic EXIT runtime gate'
  echo "Publish: $PUBLISH; independent native: $NATIVE; Chromium worker: $BROWSER; exact parity: $PARITY; Vulkan 1.1 SPIR-V validation: $VALIDATION."
  echo 'This is synthetic Linux Chromium translation evidence only. Windows/macOS browsers, resource/arithmetic fixtures, graphics, GPU execution, games, Metal conversion and working unsigned IPA output remain unverified.'
  echo 'No credentials, game data, binary artifacts, runtime bundle or browser profile is uploaded.'
} >> "$GITHUB_STEP_SUMMARY"
node --input-type=module <<'JS'
import { stat, readFile } from 'node:fs/promises';
import { join } from 'node:path';
for (const name of ['browser/bundle-diagnostics.json', 'browser/browser-diagnostics.json', 'parity.json']) {
  const path = join(process.env.RUNNER_TEMP, 'shader-parity', name);
  try {
    if ((await stat(path)).size > 128 * 1024) throw new Error('Diagnostic exceeds cap');
    console.log(name, await readFile(path, 'utf8'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    console.log(name, 'not produced');
  }
}
JS
VERIFY_STEP

finish
