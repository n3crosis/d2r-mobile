#include <metal_stdlib>
#include <simd/simd.h>
using namespace metal;
kernel void vector_math(device float4 *out [[buffer(0)]], constant float4 *in [[buffer(1)]]) {
 simd::float4 x=in[0], y=in[1], z=in[2];
 out[0]=fma(x,y,z); out[1]=fast::sqrt(x); out[2]=fast::rsqrt(x);
 out[3]=fast::exp2(x); out[4]=fast::log2(x); out[5]=fast::floor(x);
 out[6]=fast::trunc(x); out[7]=fast::rint(x); out[8]=fast::abs(x);
 out[9]=fast::min(x,y); out[10]=fast::max(x,y); out[11]=fast::clamp(x,y,z);
}
