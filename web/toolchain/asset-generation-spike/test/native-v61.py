"""真实原生 NVN 重排/BC 解码及独立标量图像转换参考。
Real native NVN swizzle/BC decode + independent scalar image-transform oracle."""

import ctypes as C
from pathlib import Path
import runpy
import struct
import sys

HERE = Path(__file__).resolve().parents[1]
OUT = HERE / "test-results/v61"
OUT.mkdir(parents=True, exist_ok=True)
if "--verify" in sys.argv:
    from PIL import Image

    with Image.open(OUT / "browser.png") as image:
        assert image.size == (16, 16)
        assert image.convert("RGBA").tobytes() == (OUT / "expected.rgba").read_bytes()
    print(
        "v61 NVN/BC worker -> Pyodide -> packaging adapter: exact native pixel parity"
    )
    sys.exit(0)

native = runpy.run_path(str(HERE.parent / "texture-spike/native-fixtures.py"))
lib, Desc, Layout = native["lib"], native["Desc"], native["Layout"]
w, h, fw = 32, 16, 16
desc = Desc(1, 0x44, 0, 0, w, h, 1, 1, 0, 2)
layout = Layout()
lib.nvn_tex_layout(C.byref(desc), C.byref(layout))
pitch = ((w + 3) // 4) * 16
raw = bytes((i * 31 + 0x44 * 7) & 255 for i in range(pitch * ((h + 3) // 4)))
linear = C.create_string_buffer(raw, len(raw))
storage = C.create_string_buffer(layout.size)
assert lib.nvn_swizzle(C.byref(desc), 0, 0, linear, pitch, storage) == 0
pixels = C.create_string_buffer(w * h * 4)
assert lib.nvn_bc_decode(0x44, linear, pitch, w, h, pixels, w * 4) == 0
header = bytearray(40)
struct.pack_into("<4sHHII", header, 0, b"SpA1", 61, fw, w, h)
header[23] = 1
(OUT / "input.sprite").write_bytes(header + storage.raw)
expected = bytearray()
for y in range(h):
    for x in range(fw):
        offset = (y * w + x + fw) * 4
        r, g, b, a = pixels.raw[offset : offset + 4]
        red = r > 14 and ((r > g * 1.3 and g - b < 0.17 * r) or r > g * 1.7)
        if (
            red
            and round(h * 0.12) <= y < round(h * 0.88)
            and round(fw * 0.12) <= x < round(fw * 0.88)
        ):
            lum = r * 0.5 + g * 0.3 + b * 0.2
            r, g, b = [max(0, min(255, round(lum * k + 6))) for k in (0.42, 0.40, 0.38)]
        expected.extend((r, g, b, a))
(OUT / "expected.rgba").write_bytes(expected)
print("Authored two-frame v61 fixture and independent native pixel oracle prepared")

# 整图集证明：填充帧不是连续的帧宽裁剪。
# Whole-atlas proof: padded frames are not contiguous frame-width crops.
w, h, fw, frames = 136, 65, 65, 2
desc = Desc(1, 0x44, 0, 0, w, h, 1, 1, 0, 2)
layout = Layout()
lib.nvn_tex_layout(C.byref(desc), C.byref(layout))
pitch = ((w + 3) // 4) * 16
raw = bytes((i * 19 + 71) & 255 for i in range(pitch * ((h + 3) // 4)))
linear = C.create_string_buffer(raw, len(raw))
storage = C.create_string_buffer(layout.size)
assert lib.nvn_swizzle(C.byref(desc), 0, 0, linear, pitch, storage) == 0
pixels = C.create_string_buffer(w * h * 4)
assert lib.nvn_bc_decode(0x44, linear, pitch, w, h, pixels, w * 4) == 0
header = bytearray(40)
struct.pack_into("<4sHHII", header, 0, b"SpA1", 61, fw, w, h)
struct.pack_into("<H", header, 20, frames)
header[23] = 1
(OUT / "atlas.sprite").write_bytes(header + storage.raw)
(OUT / "atlas.rgba").write_bytes(pixels.raw)
print("Independent native padded-atlas oracle: width136, frame65, pitch68, frames2")
