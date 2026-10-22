#include <metal_stdlib>
using namespace metal;
template<typename T, uint N> struct Array {
 T values[N];
 thread T& operator[](uint i) thread { return values[i]; }
 const thread T& operator[](uint i) const thread { return values[i]; }
 device T& operator[](uint i) device { return values[i]; }
 const device T& operator[](uint i) const device { return values[i]; }
 const constant T& operator[](uint i) const constant { return values[i]; }
 threadgroup T& operator[](uint i) threadgroup { return values[i]; }
 const threadgroup T& operator[](uint i) const threadgroup { return values[i]; }
};
kernel void members(device Array<float, 4>& dst [[buffer(0)]], constant Array<float, 4>& src [[buffer(1)]]) { Array<float, 4> local; local[0] = src[0]; dst[1] = local[0]; }
