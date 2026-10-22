// SPDX-License-Identifier: MIT
// Independently authored negative storage/interface fixture.
#include <metal_stdlib>
using namespace metal;
struct Record { float4 value [[attribute(0)]]; };
kernel void main0(device Record *input [[buffer(0), stage_in]]) {}
