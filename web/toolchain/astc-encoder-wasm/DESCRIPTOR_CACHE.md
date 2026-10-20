# Bounded texture descriptor-cache transform

`descriptor-cache.mjs` follows `dm/tools/astc_pack.py:desc_cache` without reading
files or creating a pack. Call `transformTextureDescriptorCache(bytes, converted,
{ signal, batchBlocks, encode })`; `converted` is a Map from lowercase ASCII
logical names to boolean sRGB flags. This map must describe textures actually
converted by the caller; it is not authentication or an ownership assertion.
The result contains `bytes`, `convertedEntries` and `thumbnailCount` only.

For selected entries, format 61 maps to 95 and 62 to 81. Format62 must agree with
the selected sRGB flag. Other formats and unselected entries remain unchanged.
Absent, null and empty thumbnails retain their shape. JSON metadata is preserved
semantically, not with original whitespace or numeric spelling.

Thumbnail interpretation matches native little-endian relative addressing:
count is u32 at0; table starts at4 + signed i32 at4; each table row has size u32
and a signed relative pointer measured from that pointer field itself. Every
payload range must lie after the complete table and within the thumbnail, and
have a nonzero multiple-of16 length. Table order determines conversion order,
not physical range order. Header, table, gaps, trailing bytes and all other
non-payload bytes are preserved exactly; pointers are not rewritten.

All selected metadata/layouts are checked before the first codec call. The
transform then retains at most one decoded thumbnail and calls the existing
`transcodeBC3Batches` serially for each mip. Its bounded source is a view into
that thumbnail, not a wholepack buffer. Input descriptor bytes are not modified.
No partial JSON output is returned after failure or cancellation. Errors contain
only fixed codes (`ASTC_DESCRIPTOR_INVALID`, `ASTC_DESCRIPTOR_TRANSCODE`) or a
fixed AbortError, never filenames, parser details or injected codec text.
Underlying codec cancellation/resource release remains its responsibility.

## Intentionally narrower acceptance

- UTF-8 JSON array, at most16MiB input,32MiB output,100,000 entries/map keys.
- At most4MiB per thumbnail,1–64 nonempty mips, no overlapping payload ranges.
- Table starts at or after byte8; no signed pointer may reach metadata or escape
  the thumbnail. Gaps and reverse physical order are supported.
- Canonical padded base64 only, without whitespace or alternate padding bits.
- Map keys are lowercase printable ASCII,1–1024 characters; record filenames
  are strings of at most1024 characters. Matching lowercases record names.
- Metadata traversal is capped at500,000 nodes and64 levels. Nonfinite numbers
  and integers outside JavaScript's safe range reject instead of corrupting
  metadata during serialization. Thumbnail fields other than strings, null or absent reject.
- Batch constraints remain those of `transcodeBC3Batches` (up to65,536 blocks).

Native groups all thumbnails by sRGB before encoding. This implementation runs
mips/entries serially for bounded memory. Descriptor layout/preservation behavior
is covered, but this grouping change is not claimed to produce native-identical
ASTC bytes. Genuine codec, complete-cache, image-fidelity, full pack, device and
gameplay parity remain unproved. No runtime/UI/CI integration is enabled.

## Focused validation

`node --test web/toolchain/astc-encoder-wasm/descriptor-cache.test.mjs`
uses authored JSON/thumbnails and injected fake codecs only. It covers format
mapping, sRGB mismatch, serialized calls, metadata preservation, relative
pointer/count/size/overlap rejection, reverse physical mip ordering, unchanged
non-payload bytes, input immutability, base64/budget failures, sanitized errors
and cancellation of a hung codec. No game files or filenames are fixtures.
