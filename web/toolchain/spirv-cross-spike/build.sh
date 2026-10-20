#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mode=${1:?Usage: build.sh native|wasm upstream-source build-directory}
source_dir=$(realpath "${2:?}")
build_dir=$(realpath -m "${3:?}")
test "$(git -C "$source_dir" rev-parse HEAD)" = 6c09849fe88c48eaed08413aa022aaa136a3a057
options=(-DCMAKE_BUILD_TYPE=Release -DSPIRV_CROSS_ENABLE_TESTS=OFF -DSPIRV_CROSS_CLI=ON -DSPIRV_CROSS_ENABLE_C_API=OFF)
if [[ $mode == native ]]; then
  cmake -S "$source_dir" -B "$build_dir" "${options[@]}"
elif [[ $mode == wasm ]]; then
  emcc --version | head -1 | grep -F '4.0.20'
  emcmake cmake -S "$source_dir" -B "$build_dir" "${options[@]}" \
    '-DCMAKE_CXX_FLAGS=-fexceptions' \
    '-DCMAKE_EXE_LINKER_FLAGS=-sMODULARIZE=1 -sEXPORT_ES6=1 -sINVOKE_RUN=0 -sEXIT_RUNTIME=0 -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=2147483648 -sDISABLE_EXCEPTION_CATCHING=0 -sENVIRONMENT=web,worker,node -sEXPORTED_RUNTIME_METHODS=FS,callMain'
else
  echo "Unknown mode: $mode" >&2; exit 2
fi
cmake --build "$build_dir" --target spirv-cross --parallel 2
if [[ $mode == wasm ]]; then
  cp "$build_dir/spirv-cross.js" wwwroot/spirv-cross.mjs
  cp "$build_dir/spirv-cross.wasm" wwwroot/spirv-cross.wasm
  cp "$source_dir/LICENSE" wwwroot/SPIRV-Cross-LICENSE.txt
  if [[ -f "$source_dir/NOTICE" ]]; then cp "$source_dir/NOTICE" wwwroot/SPIRV-Cross-NOTICE.txt; fi
fi
