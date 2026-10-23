"""对未修改原生 main 执行一次本地合成冒烟检查，不声称编解码一致性。
One local composition smoke against untouched native main; no codec parity claim."""

import base64
import io
import json
from pathlib import Path
import runpy
import struct
import sys
import tempfile
import types

from PIL import Image, ImageDraw

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE / "public/generated"))
from mercenary import INPUTS, generate  # noqa: E402

images, headers, bundle = {}, {}, {}
for i, (name, size) in enumerate(INPUTS.items()):
    image = Image.new("RGBA", size, (10 + i * 30, 80, 160, 255))
    draw = ImageDraw.Draw(image)
    for y in range(0, size[1], 19):
        draw.rectangle(
            (y % 67, y, size[0] - 1, y + 8), fill=(y % 256, i * 90, 40, 71 + y % 185)
        )
    header = bytearray(40)
    header[:4] = b"SpA1"
    struct.pack_into("<HHII", header, 4, 61, size[0], *size)
    struct.pack_into("<H", header, 20, 1)
    headers[name] = bytes(header)
    images[bytes(header)] = image
    bundle[name] = {
        "header": base64.b64encode(header).decode(),
        "rgba": base64.b64encode(image.tobytes()).decode(),
    }
with tempfile.TemporaryDirectory(prefix="mercenary-oracle-") as tmp:
    gw = types.ModuleType("gen_widestash_art")
    gw.lib = lambda: None
    gw.orig = lambda _, name: headers[name]
    gw.decode = lambda _, header: images[header].copy()
    # 在编解码边界捕获原始合成像素。编码由现有独立 BC3/重排测试验证，此处不假称已验证。
    # Capture original composed pixels at its codec boundary. Encoding is tested
    # by the separate existing BC3/swizzle suite, not faked as verified here.
    captured = []
    gw.bc3 = lambda image: captured.append(image.tobytes()) or b"codec-placeholder"
    gw.pack = lambda *args: b"codec-placeholder"
    paths = types.ModuleType("gen_paths")
    paths.gen_dir = lambda *args: tmp
    sys.modules["gen_widestash_art"] = gw
    sys.modules["gen_paths"] = paths
    original = runpy.run_path(str(ROOT / "dm/ios/tools/gen_merc_art.py"))
    original["main"](None)
    result = generate(json.dumps(bundle).encode(), {})
    assert result["files"]["mercenary.rgba"] == captured[0]
    assert (
        result["files"]["HirelingInventoryBG.png"]
        == Path(tmp, "HirelingInventoryBG.png").read_bytes()
    )
    assert Image.open(io.BytesIO(result["files"]["HirelingInventoryBG.png"])).size == (
        652,
        704,
    )
print(
    "Original mercenary RGBA/PNG composition parity: passed; codec/browser/real-game parity not asserted."
)
