#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

export DOTNET_CLI_TELEMETRY_OPTOUT=1

export DOTNET_NOLOGO=1

export DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE=true

step step6 'Pin native and browser translator SDK and validate adapter' web/toolchain/shader-pipeline-spike 0 <<'VERIFY_STEP'
printf '{"sdk":{"version":"10.0.402","rollForward":"disable","allowPrerelease":false,"workloadVersion":"10.0.402"}}\n' > "$GITHUB_WORKSPACE/global.json"
test "$(dotnet --version)" = 10.0.402
node --test ../../tests/shader-pipeline.test.mjs
dotnet workload install wasm-tools
dotnet workload --version
npm ci --ignore-scripts --prefix ../shader-spike
(cd ../shader-spike && npx --no-install playwright install --with-deps chromium)
sudo apt-get update
sudo apt-get install --no-install-recommends -y spirv-tools
spirv-val --version
VERIFY_STEP

step step7 'Build original translator and unchanged browser spike' web/toolchain/shader-pipeline-spike 0 <<'VERIFY_STEP'
dotnet publish ../shader-spike/ShaderSpike.csproj -c Release -p:EnableNETAnalyzers=true -p:AnalysisLevel=latest -p:TreatWarningsAsErrors=true
native_project="$GITHUB_WORKSPACE/dm/gfx/tools/dmsh_xlate/dmsh_xlate.csproj"
dotnet build "$native_project" -c Release
native_dll="$GITHUB_WORKSPACE/dm/gfx/tools/dmsh_xlate/bin/Release/net10.0/dmsh_xlate.dll"
actual=$(dotnet "$native_dll" --source-sha)
expected=$(cat "$GITHUB_WORKSPACE/dm/gfx/tools/dmsh_xlate/Program.cs" "$native_project" | sha256sum | cut -c1-16)
test "$actual" = "$expected"
node capture-browser.mjs prepare "$RUNNER_TEMP/linked-shader/fixture"
timeout --kill-after=5s 60s dotnet "$native_dll" "$RUNNER_TEMP/linked-shader/fixture/jobs.json" "$RUNNER_TEMP/linked-shader/native"
for key in 0000000000000001 0000000000000002 0000000000000003; do
  spirv-val --target-env vulkan1.1 "$RUNNER_TEMP/linked-shader/native/$key.spv"
done
VERIFY_STEP

step step8 'Build pinned native and WASM SPIRV-Cross with existing recipe' web/toolchain/shader-pipeline-spike 0 <<'VERIFY_STEP'
git clone --depth 1 --branch vulkan-sdk-1.4.363.0 https://github.com/KhronosGroup/SPIRV-Cross.git "$RUNNER_TEMP/linked-cross"
test "$(git -C "$RUNNER_TEMP/linked-cross" rev-parse HEAD)" = f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7
git clone --depth 1 --branch 4.0.20 https://github.com/emscripten-core/emsdk.git "$RUNNER_TEMP/linked-emsdk"
test "$(git -C "$RUNNER_TEMP/linked-emsdk" rev-parse HEAD)" = e4fe26ef59168ff44f4c23c466e497bf60b3411e
"$RUNNER_TEMP/linked-emsdk/emsdk" install 4.0.20
"$RUNNER_TEMP/linked-emsdk/emsdk" activate 4.0.20
bash ../spirv-cross-spike/build.sh native "$RUNNER_TEMP/linked-cross" "$RUNNER_TEMP/linked-cross-native"
source "$RUNNER_TEMP/linked-emsdk/emsdk_env.sh"
bash ../spirv-cross-spike/build.sh wasm "$RUNNER_TEMP/linked-cross" "$RUNNER_TEMP/linked-cross-wasm"
VERIFY_STEP

step step9 'Independent native Metal and upstream reflection oracle' web/toolchain/shader-pipeline-spike 0 <<'VERIFY_STEP'
native="$RUNNER_TEMP/linked-shader/native"
for key in 0000000000000001 0000000000000002 0000000000000003; do
  "$RUNNER_TEMP/linked-cross-native/spirv-cross" --msl --msl-version 20300 --msl-argument-buffers --msl-texture-buffer-native --msl-pad-fragment-output "$native/$key.spv" --output "$native/${key}_b.metal"
  "$RUNNER_TEMP/linked-cross-native/spirv-cross" --reflect json "$native/$key.spv" --output "$native/$key.cross.json"
done
VERIFY_STEP

step step10 'Real Chromium linked pipeline versus original native outputs' web/toolchain/shader-pipeline-spike 0 <<'VERIFY_STEP'
timeout --kill-after=5s 180s node capture-browser.mjs capture ../shader-spike/bin/Release/net10.0/publish "$RUNNER_TEMP/linked-shader/native" "$RUNNER_TEMP/linked-shader/browser"
sha256sum graphics-fixtures.mjs capture-browser.mjs ../../shader-pipeline.mjs ../shader-spike/ShaderBridge.cs ../spirv-cross-spike/wwwroot/*.mjs ../spirv-cross-spike/wwwroot/*.wasm "$RUNNER_TEMP/linked-shader/native/"* > "$RUNNER_TEMP/linked-shader/browser/source-chain.sha256"
VERIFY_STEP

finish
