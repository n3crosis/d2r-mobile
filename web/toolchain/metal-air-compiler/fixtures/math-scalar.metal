#include <metal_stdlib>
#include <simd/simd.h>
using namespace metal;
kernel void scalar_math(device float *out [[buffer(0)]], constant float *in [[buffer(1)]]) {
 float x=in[0], y=in[1], z=in[2];
 out[0]=fma(x,y,z); out[1]=sqrt(x); out[2]=rsqrt(x);
 out[3]=exp2(x); out[4]=log2(x); out[5]=floor(x);
 out[6]=trunc(x); out[7]=rint(x); out[8]=abs(x);
 out[9]=fast::min(x,y); out[10]=fast::max(x,y); out[11]=fast::clamp(x,y,z);
 out[12]=select(x,y,isnan(z));
 out[13]=sin(x); out[14]=cos(y); out[15]=ceil(z);
}
