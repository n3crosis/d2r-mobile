// SPDX-License-Identifier: MIT
// Independently authored negative storage/interface fixture.
#include <metal_stdlib>
using namespace metal;
struct Record { float4 value [[attribute(0)]]; };
kernel void main0(constant Record *input [[buffer(0)]], device Record *output [[buffer(0)]]) { output[0].value = input[0].value; }
