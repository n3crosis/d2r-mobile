# Shader output memory bounds

[简体中文](SHADER_MEMORY_BOUNDS.zh-CN.md)

Production shader output retains the existing 512 MiB ceiling. Base and fetch
source bytes count once. Compact replay JSON reserves interim budget; after the
full source digest proof, actual post-chain formatted JSON replaces that
reservation. The final c1 index also counts. Failure occurs before retaining an
output that exceeds the ceiling. Output formatting, source digest checks and
noMetal/on-device compilation remain unchanged.

Each output replay yields owned copies with at most 64 KiB backing buffers and
checks cancellation/disposal before every chunk. Concatenated bytes remain
identical. This bounds a replay copy, not the total retained shader outputs.

Entering embedded shaders wipes and drops any previous physical pack and resets
its cache identity. The main image remains until all embedded records have fully
completed, even if their ordering is noncontiguous; its last completion wipes and
drops it. Later physical-pack revisits reload rather than reuse stale bytes.
Failure/final cleanup wipes remaining sources. Existing per-source limits remain
256 MiB; no caps increase.

Focused synthetic tests establish accounting, chunk backing sizes, cancellation
and cache lifetime behavior. They do not measure browser RAM savings or establish
real-game validation.
