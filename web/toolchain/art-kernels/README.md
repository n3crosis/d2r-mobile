# Browser art pixel kernels

Dependency-free typed-array ports of the pinned upstream NumPy pixel operations.
Pillow remains responsible for image codecs, fonts, drawing, filtering, resizing,
and compositing. This is not a fake NumPy implementation.

`provenance.json` pins all upstream numerical recipes. Production packaging must
check these hashes before substituting any function or statement. Existing
asset-generation provenance checks remain required too.

## Integration boundary

Before importing generated Python art modules, the sealed worker imports
`kernels.mjs` and registers its module namespace using
`pyodide.registerJsModule("art_kernel_bridge", kernels)`.
`art_pixels.py` passes only bounded byte buffers and numeric geometry across this
synchronous worker-local boundary; no network, filesystem discovery, shell, game
keys, or external worker messages are exposed by the kernels.

Each image is limited to 16,777,216 pixels. Byte lengths and channel counts must
match dimensions. Outputs own their storage and never mutate source buffers.
Kernel dispatch is via named exports, not eval or arbitrary property paths.

## Numerical behavior

- Default-state desaturation uses float64 and ties-to-even rounding.
- Silhouette RGB channels deliberately retain the source divide/multiply by 255
  instead of assuming byte identity; output conversion truncates.
- Metal glyph shading preserves NumPy roll wraparound, operation order, float64
  intermediate values, and source outline alpha rather than premultiplying it.
- Trove statistics use two-pass population standard deviation, channel-major
  accumulations in source pixel order, and float64 normalization.
- Vault seam blending rounds both products and their sum to float32 before
  truncating to uint8. Gold-box checks and geometry remain mandatory.
- Feather masks truncate to uint8; circle boundaries are strictly inside.

## Migration state

`migrate.py` runs at the end of `prepare:core`, checks upstream hashes, ports all
five generated callers, and rejects surviving `np` references. The sealed worker
registers the JS bridge before importing those modules. The runtime vendor closure
now contains Pillow only; the sealed packager rejects generated NumPy imports.
The excluded legacy BC3 developer fixture still uses NumPy, not the production
runtime. No original upstream source files are modified.

Six minimal numerical comparisons (default-state pixels, feather masks, trove
stone normalization, vault blending, metal shading, and skill silhouettes) match
source bytes. A local Node Pyodide
smoke loaded every production module with Pillow only and exercised the bridge.
These checks do not establish game-data, browser, or iOS validation.
