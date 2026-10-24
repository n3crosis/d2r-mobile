#ifdef NEGATIVE
[[compute_kernel, kernel_dim(3)]] void bad(__attribute__((global_as)) int *p [[buffer(-1)]]) { p[0] = 1; }
#endif
#ifdef RANGE
[[compute_kernel, kernel_dim(3)]] void bad(__attribute__((global_as)) int *p [[buffer(31)]]) { p[0] = 1; }
#endif
#ifdef TYPE
[[compute_kernel, kernel_dim(3)]] void bad(int p [[buffer(0)]]) {}
#endif
#ifdef DUPLICATE_ATTRIBUTE
[[compute_kernel, kernel_dim(3)]] void bad(__attribute__((global_as)) int *p [[buffer(0), buffer(1)]]) { p[0] = 1; }
#endif
#ifdef DUPLICATE_INDEX
[[compute_kernel, kernel_dim(3)]] void bad(__attribute__((global_as)) int *p [[buffer(3)]], __attribute__((global_as)) int *q [[buffer(3)]]) { p[0] = q[0]; }
#endif
#ifdef MIXED
[[compute_kernel, kernel_dim(3)]] void bad(__attribute__((global_as)) int *p [[buffer(3)]], __attribute__((global_as)) int *q) { p[0] = q[0]; }
#endif
#ifdef DYNAMIC
int index();
[[compute_kernel, kernel_dim(3)]] void bad(__attribute__((global_as)) int *p [[buffer(index())]]) { p[0] = 1; }
#endif
#ifdef PRIVATE
[[compute_kernel, kernel_dim(3)]] void bad(int *p [[buffer(0)]]) { p[0] = 1; }
#endif
