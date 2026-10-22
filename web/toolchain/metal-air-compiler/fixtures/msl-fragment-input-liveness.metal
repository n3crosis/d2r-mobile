#include <metal_stdlib>
using namespace metal;
#ifndef LIVENESS_KEEP_ALL
#define LIVENESS_KEEP_ALL 0
#endif
struct FragmentLivenessInput {
  float4 kept [[user(locn7), flat]];
  float4 optionalValue [[user(locn11), flat]];
  float4 position [[position]];
};
struct FragmentLivenessOutput {
  float4 color [[color(0)]];
};
fragment FragmentLivenessOutput fragment_input_liveness(
    FragmentLivenessInput input [[stage_in]],
    constant float4 *bias [[buffer(9)]],
    constant float4 *untouched [[buffer(13)]]) {
  FragmentLivenessOutput output;
  float4 color = input.kept + bias[0];
#if LIVENESS_KEEP_ALL
  color += input.optionalValue + input.position;
#else
  // This source computation has no observable use and must disappear from
  // the optimized module. The retained arguments still need descriptors.
  float4 discarded = input.optionalValue + input.position;
#endif
  output.color = color;
  return output;
}
