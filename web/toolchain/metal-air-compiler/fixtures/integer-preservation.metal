#include <metal_stdlib>
using namespace metal;
kernel void integer_ops(device uint *out [[buffer(0)]], constant uint *in [[buffer(1)]]) {
 out[0]=min(in[0],in[1]); out[1]=max(in[0],in[1]);
 out[2]=clamp(in[0],in[1],in[2]);
 out[3]=as_type<uint>(as_type<float>(in[0]));
}
