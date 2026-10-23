# Bounded BC3 encoder

Production RGBA → linear BC3 uses this dependency-free Rust/WASM module, followed
by the existing C/WASM NVN block-linear sprite packer. It does not start Python,
use NumPy, fetch assets, or import host functions.

The algorithm ports `dm/ios/tools/gen_widestash_art.py::bc3` from source SHA-256
`f58435e650cc12e1472eb229a7eb5d4e08f7477f37f5d91376df5ad5af952c79`:
The v2 source update changes only the native library-loading helper; the extracted
`bc3` function remains byte-identical and is checked independently before packaging.

Algorithm: float64 covariance, eight normalized power iterations, first-index ties,
round-to-even 565 quantization, max/min interpolated alpha, and edge replication.
No fast-math or fused multiply-add is requested. A tiny development comparison
against the original covered random, constant and transparent images including
partial edge blocks; it is not a claim of testing user game data.

The ABI exports `memory`, `bc3_input`, `bc3_output`, `bc3_encode`, and `bc3_clear`.
A single worker serializes calls. Input is exact RGBA8, dimensions 1–8192 and at
most 4,194,304 pixels. Encode returns byte length, or zero for invalid dimensions
or byte length. Fixed buffers avoid per-image allocation. The bridge copies the
result and clears the used buffers in `finally`. Linear memory is capped at
32 MiB. Host code must never retain buffer views across another operation.

Build from the parent directory with `node build-bc3.mjs`. Rust 1.99.1 is pinned
from the official stable distribution manifest dated 2026-10-15. The build uses
release size optimization, LTO, one codegen unit, stripped output, and no crates.
Run `cargo fmt --check` and `cargo clippy --target wasm32-unknown-unknown -- -D warnings`
inside this directory when editing Rust. Do not commit `target/` or `dist/`.
