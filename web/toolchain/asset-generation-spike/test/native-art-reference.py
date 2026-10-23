"""在完全自编资源上运行原始原生美术 main，作为精确完整输出参考。
Original native-art main on wholly authored assets; exact complete-output oracle."""

import base64
import hashlib
import io
import json
from pathlib import Path
import runpy
import sys
import types

from PIL import Image

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
OUT = HERE / "test-results/native-art"
IOS = OUT / "native-ios"
(IOS / "Sources/TouchArt").mkdir(parents=True, exist_ok=True)
(IOS / "docs").mkdir(exist_ok=True)


def sha(b):
    return hashlib.sha256(b).hexdigest()


raw = {
    "global/excel/skills.txt": b"*Id\tcharclass\tskilldesc\n12\tama\tfirst\n21\tbad\tmissing\n357\t\tcommon\n",
    "global/excel/skilldesc.txt": b"skilldesc\tIconCel\nfirst\t0\ncommon\t2\n",
}
assets, images, rgba = [], {}, {}
for i in range(10):
    name = f"dm_native_skill_{i}.png" if i < 9 else "dm_native_authored.png"
    path = f"hd/synthetic/atlas{i}.sprite"
    w, h = 80, 3
    pixels = bytes((x * 13 + i * 17) % 256 for x in range(w * h * 4))
    image = Image.frombytes("RGBA", (w, h), pixels)
    png = io.BytesIO()
    image.save(png, "PNG")
    # 自编字节仅替代已测试的纹理解码器边界。
    # Authored bytes substitute only the already-tested texture decoder boundary.
    raw[path] = b"authored-atlas-" + bytes([i])
    images[path] = image
    rgba[name] = base64.b64encode(pixels).decode()
    assets.append(
        {
            "asset": name,
            "official_path": "data:data/" + path,
            "official_sprite_sha256": sha(raw[path]),
            "official_sprite_md5": hashlib.md5(raw[path]).hexdigest(),
            "decoded_png_sha256": sha(png.getvalue()),
            "decoded_rgba_sha256": sha(pixels),
            "atlas_px": [w, h],
            "frame_width": 1,
            "frame_pitch": 2,
            "frame_count": 40,
        }
    )
manifest = {
    "assets": assets,
    "official_tables": [
        {"file": name, "sha256": sha(raw["global/excel/" + name])}
        for name in ("skills.txt", "skilldesc.txt")
    ],
    "descriptor_index_sha256": sha(
        json.dumps(
            [[12, 0, 0], [21, -1, -1], [357, 8, 20]], separators=(",", ":")
        ).encode()
    ),
}
metadata = {
    "manifest": json.dumps(manifest),
    "geometry": "{}\n",
    "binding": "{}\n",
    "implementation": "/* Authored fixture implementation: no proprietary input. */\n",
}
(IOS / "Sources/TouchArt/native_art_manifest.json").write_text(metadata["manifest"])
(IOS / "docs/native_art_v1_geometry.json").write_text(metadata["geometry"])
(IOS / "docs/touch_layout_spec_native_binding_v5.json").write_text(metadata["binding"])
(IOS / "implementation.c.inc").write_text(metadata["implementation"])
previous = sys.modules.get("romfs_art")
sys.modules["romfs_art"] = types.SimpleNamespace(
    read=lambda _, p: raw[p], sprite=lambda _, p: images[p].copy()
)
try:
    module = runpy.run_path(str(ROOT / "dm/ios/tools/native_art/generate.py"))
    main = module["main"]
    main.__globals__["IOS"] = IOS
    main.__globals__["HERE"] = IOS
    main(None)
finally:
    if previous is None:
        del sys.modules["romfs_art"]
    else:
        sys.modules["romfs_art"] = previous
bundle = {
    "metadata": metadata,
    "raw": {p: base64.b64encode(v).decode() for p, v in raw.items()},
    "rgba": rgba,
}
(OUT / "bundle.json").write_text(json.dumps(bundle))
(OUT / "options.json").write_text(
    json.dumps({"metadataSha256": {k: sha(v.encode()) for k, v in metadata.items()}})
)
(OUT / "files.json").write_text(
    json.dumps([a["asset"] for a in assets] + ["dm_touch_native_art.c"])
)
print("Original native-art generator: all ten synthetic PNGs and complete C index")
