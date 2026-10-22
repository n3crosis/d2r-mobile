#include <metal_stdlib>
using namespace metal;
kernel void classify(device uint *out [[buffer(0)]], constant float *in [[buffer(1)]]) {
 out[0]=isnan(in[0]);
}
kernel void sanitize(device float2 *out [[buffer(0)]], constant float2 *in [[buffer(1)]]) {
 out[0]=select(in[0],float2(0.0f),isnan(in[0]));
}
