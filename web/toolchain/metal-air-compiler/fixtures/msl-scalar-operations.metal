// SPDX-License-Identifier: MIT
// Independent fixed CI input, not an SDK or application shader.
#include <metal_stdlib>
using namespace metal;
kernel void main0(constant float *input [[buffer(0)]],
                  constant int *bits [[buffer(1)]],
                  device float *math_output [[buffer(2)]],
                  device int *integer_output [[buffer(3)]],
                  device uint *vote_output [[buffer(4)]],
                  device MTLQuadTessellationFactorsHalf *tess_output [[buffer(5)]]) {
  // Runtime inputs and distinct stores keep all five operations observable.
  math_output[0] = sin(input[0]);
  math_output[1] = cos(input[1]);
  math_output[2] = ceil(input[2]);
  integer_output[0] = reverse_bits(bits[0]);
  vote_output[0] = simd_all(bits[1] != 0) ? 1u : 0u;
  // The standard umbrella alone must expose the existing barrier subset.
  threadgroup_barrier(mem_flags::mem_threadgroup);
  // Populate both complete half arrays through the standard umbrella type.
  for (uint i = 0; i < 4; ++i)
    tess_output[0].edgeTessellationFactor[i] = half(input[i + 3]);
  for (uint i = 0; i < 2; ++i)
    tess_output[0].insideTessellationFactor[i] = half(input[i + 7]);
}
