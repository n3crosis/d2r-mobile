// SPDX-License-Identifier: MIT
#include <metal_stdlib>
#include <metal_tessellation>
using namespace metal;
struct ControlPoint {
  float4 position [[attribute(3)]];
  float4 uv [[attribute(0)]];
};
struct PatchInput { patch_control_point<ControlPoint> points; };
struct PatchOutput {
  float4 position [[position]];
  float2 uv [[user(locn0)]];
};
[[patch(triangle, 3)]] vertex PatchOutput domain_triangle(
    PatchInput input [[stage_in]], float3 coord [[position_in_patch]]) {
  PatchOutput output;
  output.position = input.points[uint(coord.x > coord.y)].position;
  output.position.z += coord.z;
  output.uv = input.points[1].uv.xy * float(input.points.size());
  return output;
}
