// SPDX-License-Identifier: MIT
// Authored resource-object address-space fixture, not a supplied shader.
#include <metal_stdlib>
using namespace metal;
struct Resources {
  texture2d<float> color [[id(0)]];
  texture2d_array<float> depthLayers [[id(1)]];
  texturecube<float> depthCube [[id(2)]];
  sampler state [[id(3)]];
};
kernel void resource_method_spaces(constant Resources& resources [[buffer(0)]],
                                   device float4* output [[buffer(1)]]) {
  output[0] = resources.color.read(uint2(0));
  const float a = reinterpret_cast<constant const depth2d_array<float>&>(resources.depthLayers)
                      .sample_compare(resources.state, float2(0.25f), 1u, 0.3f);
  const float b = reinterpret_cast<constant const depthcube<float>&>(resources.depthCube)
                      .sample_compare(resources.state, float3(0.1f, 0.2f, 0.3f), 0.4f);
  output[1] = float4(a, b, 0.0f, 1.0f);
}
