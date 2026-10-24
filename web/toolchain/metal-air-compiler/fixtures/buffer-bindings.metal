// Compiler fixture, not a complete MSL compatibility test.
// The fork's existing stage/address-space spellings isolate the new binding path.
// Expected: AIR location_index 7 for input, 2 for output, not declaration 0/1.
[[compute_kernel, kernel_dim(3)]]
void sparse(__attribute__((constant_as)) int *input [[buffer(7)]],
            __attribute__((global_as)) int *output [[buffer(2)]]) {
  int total = 0;
  for (int i = 0; i < input[0]; ++i)
    total += input[i + 1] * 3;
  output[0] = total > 9 ? total : -total;
}
