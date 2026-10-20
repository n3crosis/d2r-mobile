#!/usr/bin/env bash

set -euo pipefail

source "$(dirname "$0")/../steps.sh"

step step3 'Verify pure byte boundary and native replay reflection' web/toolchain/spirv-cross-spike 0 <<'VERIFY_STEP'
node --test test.mjs
VERIFY_STEP

step step4 'Fetch exact official upstream sources and SDK' web/toolchain/spirv-cross-spike 0 <<'VERIFY_STEP'
git clone --depth 1 --branch vulkan-sdk-1.4.363.0 https://github.com/KhronosGroup/SPIRV-Cross.git "$RUNNER_TEMP/spirv-cross"
test "$(git -C "$RUNNER_TEMP/spirv-cross" rev-parse HEAD)" = f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7
git clone --depth 1 --branch 4.0.20 https://github.com/emscripten-core/emsdk.git "$RUNNER_TEMP/spirv-emsdk"
test "$(git -C "$RUNNER_TEMP/spirv-emsdk" rev-parse HEAD)" = e4fe26ef59168ff44f4c23c466e497bf60b3411e
"$RUNNER_TEMP/spirv-emsdk/emsdk" install 4.0.20
"$RUNNER_TEMP/spirv-emsdk/emsdk" activate 4.0.20
VERIFY_STEP

step step5 'Build original CLI natively and as browser WASM' web/toolchain/spirv-cross-spike 0 <<'VERIFY_STEP'
bash build.sh native "$RUNNER_TEMP/spirv-cross" "$RUNNER_TEMP/spirv-native"
source "$RUNNER_TEMP/spirv-emsdk/emsdk_env.sh"
bash build.sh wasm "$RUNNER_TEMP/spirv-cross" "$RUNNER_TEMP/spirv-wasm"
VERIFY_STEP

step step6 'Install CI-only synthetic assembly and browser tools' web/toolchain/spirv-cross-spike 0 <<'VERIFY_STEP'
sudo apt-get update
sudo apt-get install --no-install-recommends -y spirv-tools
spirv-as --version
npm ci --ignore-scripts --prefix ../shader-spike
(cd ../shader-spike && npx --no-install playwright install --with-deps chromium)
VERIFY_STEP

step step7 'Assemble authored fixtures and run original native oracle' web/toolchain/spirv-cross-spike 0 <<'VERIFY_STEP'
mkdir -p results
python3 provenance.py > results/native-chain-observed.json
for fixture in fixture fragment storage; do
  spirv-as --target-env spv1.0 "$fixture.spvasm" -o "wwwroot/$fixture.spv"
  spirv-val --target-env spv1.0 "wwwroot/$fixture.spv"
  "$RUNNER_TEMP/spirv-native/spirv-cross" --msl --msl-version 20300 --msl-argument-buffers --msl-texture-buffer-native --msl-pad-fragment-output "wwwroot/$fixture.spv" --output "results/$fixture.native.metal"
  "$RUNNER_TEMP/spirv-native/spirv-cross" --reflect json "wwwroot/$fixture.spv" --output "results/$fixture.native.json"
done
sha256sum toolchain-lock.json build.sh *.spvasm wwwroot/*.mjs wwwroot/*.wasm wwwroot/*.spv "$GITHUB_WORKSPACE/dm/gfx/tools/dmsh_build.py" "$GITHUB_WORKSPACE/dm/gfx/tools/dmsh_chain.py" "$GITHUB_WORKSPACE/dm/gfx/tools/nometal_run.py" > results/source-chain.sha256
VERIFY_STEP

step step8 'Compare actual browser worker to native source and reflection' web/toolchain/spirv-cross-spike 0 <<'VERIFY_STEP'
node capture-browser.mjs results
VERIFY_STEP

finish
