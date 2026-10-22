cmake_minimum_required(VERSION 3.20)
project(d2r_experimental_air_api LANGUAGES C CXX)
# Configure with -DLLVM_DIR=<fork-build>/lib/cmake/llvm
#                -DClang_DIR=<fork-build>/lib/cmake/clang.
find_package(LLVM 14 CONFIG REQUIRED)
find_package(Clang CONFIG REQUIRED)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/include/metal_stdlib")
file(READ "${CMAKE_CURRENT_SOURCE_DIR}/include/metal_stdlib" AIR_COMPAT_CONTENT)
file(SHA256 "${CMAKE_CURRENT_SOURCE_DIR}/include/metal_stdlib" AIR_COMPAT_SHA256)
if(AIR_COMPAT_CONTENT MATCHES "\\)D2R_HEADER\"")
  message(FATAL_ERROR "Compatibility header contains the reserved embed delimiter")
endif()
configure_file(compat_header.inc.in compat_header.inc @ONLY)
add_library(d2r_air_api STATIC air_compiler.cpp)
target_compile_features(d2r_air_api PRIVATE cxx_std_17)
# Match the LLVM build's ABI: its default static libraries omit RTTI.
if(NOT LLVM_ENABLE_RTTI)
  if(MSVC)
    target_compile_options(d2r_air_api PRIVATE /GR-)
  else()
    target_compile_options(d2r_air_api PRIVATE -fno-rtti)
  endif()
endif()
target_include_directories(d2r_air_api PRIVATE ${LLVM_INCLUDE_DIRS} ${CLANG_INCLUDE_DIRS} ${CMAKE_CURRENT_BINARY_DIR})
target_compile_definitions(d2r_air_api PRIVATE ${LLVM_DEFINITIONS})
target_include_directories(d2r_air_api PUBLIC ${CMAKE_CURRENT_SOURCE_DIR})
target_link_libraries(d2r_air_api PRIVATE clangCodeGen clangFrontend LLVMMetalLib LLVMBitWriter50 LLVMBitWriter140)
add_executable(d2r_air_api_smoke smoke.cpp)
target_link_libraries(d2r_air_api_smoke PRIVATE d2r_air_api)
if(EMSCRIPTEN)
  add_executable(d2r_air_wasm wasm_entry.cpp)
  target_link_libraries(d2r_air_wasm PRIVATE d2r_air_api)
  set_target_properties(d2r_air_wasm PROPERTIES SUFFIX ".mjs")
  target_link_options(d2r_air_wasm PRIVATE
    "--no-entry"
    "-sMODULARIZE=1" "-sEXPORT_ES6=1" "-sENVIRONMENT=worker"
    "-sALLOW_MEMORY_GROWTH=1" "-sINITIAL_MEMORY=67108864"
    "-sMAXIMUM_MEMORY=2147483648" "-sSTACK_SIZE=8388608"
    "-sFILESYSTEM=0" "-sERROR_ON_UNDEFINED_SYMBOLS=1"
    "-sEXPORTED_FUNCTIONS=['_malloc','_free','_air_compile_v1','_air_result_status','_air_result_data','_air_result_size','_air_result_diagnostics','_air_result_diagnostics_size','_air_result_free','_air_compiler_header_sha256']"
  )
endif()
