// SPDX-License-Identifier: MIT
// Independently authored negative storage/interface fixture.
#include <metal_stdlib>
using namespace metal;
struct Record { float4 value [[attribute(0)]]; };
fragment float4 main0(threadgroup Record *scratch [[threadgroup(0)]]) { return scratch[0].value; }
