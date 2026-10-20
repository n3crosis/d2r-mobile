# Synthetic NSO validation scope

`nso-validation.mjs` materializes three independent segments and checks requested
SHA-256 hashes. It does not rewrite ARM64, build an executable image, authenticate
a game/version, generate an IPA, or prove runtime compatibility. No game data is
included or needed. `supportedGameBuild` and `versionVerified` are always false,
including for apparently familiar module IDs.

## Contract and evidence

- Repository `dm/tools/nso.py:3–13` and `dm/tools/patch_nso.py:28–39`
  read segment descriptors at `0x10 + 16*i`, compression flags at `0x0c`,
  stored lengths at `0x60 + 4*i`, and module ID at `0x40`. Compressed segments
  use Python `lz4.block.decompress(..., uncompressed_size=sz)`: raw blocks, not
  frames. These scripts do not establish segment-hash verification.
- [Atmosphère's NSO header](https://github.com/Atmosphere-NX/Atmosphere/blob/master/libraries/libstratosphere/include/stratosphere/ldr/ldr_types.hpp)
  defines a 256-byte header, compression bits 0–2, hash-check bits 3–5, and three
  32-byte hashes after offset `0xa0` (text), `0xc0` (rodata), `0xe0` (data).
  It also defines newer flags 6–7. This implementation deliberately preserves
  preflight's version-zero, flags-0–5 subset and rejects newer flags; rejection
  does not imply the newer file is corrupt.
- [hactool's original NSO implementation](https://github.com/SciresM/hactool/blob/master/nso.c)
  independently confirms raw `LZ4_decompress_safe`, exact decoded size, decoded-size
  reads for uncompressed segments, and SHA-256 over decoded bytes only when the
  corresponding hash flag is set. Header hashes are self-declared, not a trusted
  signature or game-build allowlist. A successful check proves consistency, not
  provenance.
- [LZ4's authoritative block specification](https://github.com/lz4/lz4/blob/dev/doc/lz4_Block_format.md)
  establishes literal/match length extensions, little-endian nonzero backward
  offsets, and forward copying for overlapping matches. The decoder also enforces
  the literal-only terminal sequence, at least five final literals after a match,
  and a final match starting at least twelve decoded bytes before the end.
  Short blocks and a single zero token for empty input are supported.

Sources inspected 2026-10-20. These are upstream implementation/specification
sources, not Nintendo certification or a claim of complete NSO-format support.
Optional module-name metadata, reserved fields, loader permissions/alignment,
relocations, dynamic tables and instruction semantics are outside this subset.

## Resource and cancellation boundaries

Defaults: each stored/decoded segment at most 64 MiB, decoded aggregate at most
128 MiB, conservative working allocation budget 256 MiB, declared image extent
including BSS at most 256 MiB. The budget includes retained decoded segments,
largest stored buffer, largest decoded buffer (for WebCrypto's input copy), one
read chunk, and the header. Limits are checked before any segment allocation or
payload read. Custom positive integral limits cannot exceed 256 MiB each.
This is a bound on explicitly accounted byte buffers, not a browser heap/RSS
promise: adapters, garbage collection, and WebCrypto have implementation overhead.
BSS has no allocated output, but its extent and overlap are checked.

All source I/O goes through preflight `readRange`; the header is snapshotted once
and payload reads default to 64 KiB, never exceeding its 4 MiB read maximum.
The caller must provide stable source content during validation. LZ4 counts
consumed input and produced output across sequences, checks cancellation in each
loop, and yields to the event loop only when accumulated work reaches the chunk
budget. Literal/match copying itself is chunk-bounded, so a long copy remains
responsive without scheduling a timer for every short sequence. A regression test
uses 1,000 short sequences and caps timer count by total byte work, not token count.
Payload I/O also yields between bounded reads.
WebCrypto digest is not internally abortable: cancellation rejects promptly and
ignores its eventual result, but cannot stop the underlying cryptographic work.
Callers must not accumulate unlimited concurrent validations or cancelled digests.

A successful return reports `structuralValidation: "legacy-segments-only"` and
per-segment `integrity: "verified"` or `"not-requested"`. The latter never means
verified. `requiredHashesVerified` means all flag-required hashes passed (possibly
none); `allSegmentsHashed` separately reports whether every segment requested one.
Any required hash mismatch rejects the operation without returning partial success.

## Independent synthetic evidence

The fixed blocks `1f61010007506161616161` and
`3f61626303003f506263616263` were produced and independently decoded using the
already-installed system `liblz4.so.1`, version 1.10.0, via Python ctypes
`LZ4_compress_default` and `LZ4_decompress_safe`. Their expected decoded payloads
are respectively 32 ASCII `a` bytes and 30 ASCII `abc` repetitions. There is no
project encoder whose mistakes could make these decoder tests pass circularly.
The literal-extension examples come directly from the LZ4 specification.
Python/liblz4 were developer-only oracle tools for capturing and checking these
fixed vectors. The Node suite consumes the committed literal vectors and needs
neither Python nor liblz4; it does not claim to rerun native parity on each CI
run. Browser users install nothing. No library-version check or new CI library
prerequisite is needed for this test suite.

NSO fixtures are small, test-authored header layouts with `abc` payloads; their
SHA-256 constants are the known `abc` and empty-string digests, not values generated
by the validator. All 64 legacy flag combinations, each hash field, malformed
ranges/overlap, zero-sized segments, resource rejection, chunked reads, unknown
module IDs, truncated LZ4 and cancellation during reads/decode/digest are covered.
This is not an independent full-NSO game fixture or native patcher parity test.

Run: `node --test web/tests/nso-validation.test.mjs` from the repository root.
