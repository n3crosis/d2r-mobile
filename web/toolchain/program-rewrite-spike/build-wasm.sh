#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p deps dist/licenses dist/runtime
fetch() {
  local name="$1" repo tag commit
  read -r repo tag commit < <(python3 -c 'import json,sys; d=json.load(open("toolchain-lock.json"))[sys.argv[1]]; print(d["repository"], d["tag"], d["commit"])' "$name")
  if [ ! -d "deps/$name/.git" ]; then git clone --depth 1 --branch "$tag" "$repo" "deps/$name"; fi
  test "$(git -C "deps/$name" rev-parse HEAD)" = "$commit"
}
fetch capstone
fetch lz4
if ! command -v emcc >/dev/null; then
  fetch emsdk
  deps/emsdk/emsdk install 4.0.20
  deps/emsdk/emsdk activate 4.0.20
  source deps/emsdk/emsdk_env.sh
fi
emcc --version | head -1 | grep -F '4.0.20'
emcmake cmake -S deps/capstone -B deps/capstone-build \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DCAPSTONE_BUILD_TESTS=OFF -DCAPSTONE_BUILD_CSTOOL=OFF \
  -DCAPSTONE_ARCHITECTURE_DEFAULT=OFF -DCAPSTONE_ARM64_SUPPORT=ON
cmake --build deps/capstone-build --parallel 2
emcc --no-entry -O2 -I deps/capstone/include bridge.c \
  deps/capstone-build/libcapstone.a deps/lz4/lib/lz4.c \
  -sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker \
  -sALLOW_MEMORY_GROWTH=1 -sMAXIMUM_MEMORY=536870912 \
  -sEXPORTED_FUNCTIONS='["_decode_word","_LZ4_decompress_safe","_malloc","_free"]' \
  -sEXPORTED_RUNTIME_METHODS='["ccall","UTF8ToString"]' \
  -o dist/capstone-lz4.mjs
(cd ../../.. && sha256sum -c web/toolchain/program-rewrite-spike/upstream-source.sha256)
cp ../../../dm/tools/patch_nso.py dist/patch_nso.py
cp python-adapters.py worker.mjs dist/
cp node_modules/pyodide/{pyodide.mjs,pyodide.asm.js,pyodide.asm.wasm,python_stdlib.zip,pyodide-lock.json} dist/runtime/
cp deps/capstone/LICENSE.TXT dist/licenses/capstone.txt
cp deps/lz4/lib/LICENSE dist/licenses/lz4.txt
cp PYODIDE_LICENSE dist/licenses/pyodide.txt
cp toolchain-lock.json dist/
