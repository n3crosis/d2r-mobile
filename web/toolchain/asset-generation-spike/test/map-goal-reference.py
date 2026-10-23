"""以合成图集、字符串及字体输入运行未修改的原始地图目标脚本参考。
Untouched original map-goal script oracle, synthetic atlas/string/font inputs."""

import base64
import json
from pathlib import Path
import runpy
import struct
import sys
import types

from PIL import Image, features

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
OUT = HERE / "test-results/map-goal"
OUT.mkdir(parents=True, exist_ok=True)
backend = {
    "pillow": Image.__version__,
    "freetype": features.version("freetype2"),
    "raqm": features.check("raqm"),
}
assert backend == {"pillow": "10.2.0", "freetype": "2.6.0", "raqm": False}, backend
# 只复用新编字体字节，不复用预期图像或适配器渲染。
# Reuse only the newly authored font bytes, never expected images or adapter rendering.
font_path = HERE / "test-results/hud/authored-fixture.ttf"
font_bytes = font_path.read_bytes()
paths = {
    "symbols": "hd/global/ui/PANEL/Quest_Log/TalRashaSymbol.sprite",
    "units": "hd/global/ui/AUTOMAP/Units.sprite",
}
reads, decoded, images = {}, {}, {}
for index, (name, path) in enumerate(paths.items()):
    frames = 7 + index
    width, height, fw = frames * 12, 13, 9
    image = Image.new("RGBA", (width, height))
    image.putdata(
        [
            ((x * 13) % 256, (y * 29) % 256, (x // 12 * 31) % 256, (x + y * 3) % 256)
            for y in range(height)
            for x in range(width)
        ]
    )
    header = bytearray(40)
    header[:4] = b"SpA1"
    struct.pack_into("<HHII4xH", header, 4, 61, fw, width, height, frames)
    reads[path] = bytes(header)
    decoded[bytes(header)] = image
    images[name] = {
        "size": [width, height],
        "frameWidth": fw,
        "frames": frames,
        "rgba": base64.b64encode(image.tobytes()).decode(),
    }
stub = types.ModuleType("romfs_art")
stub.read = lambda _, path: reads[path]
stub.dxt5 = lambda data, w, h: decoded[data].copy()
stub.font = lambda _, name: str(font_path) if name == "BlizzardGlobal-V5_81.ttf" else None
sys.modules["romfs_art"] = stub
paths_module = types.ModuleType("gen_paths")
paths_module.gen_dir = lambda *args: str(OUT / "expected")
sys.modules["gen_paths"] = paths_module
native = runpy.run_path(
    str(ROOT / "dm/ios/tools/gen_map_goal_art.py"), run_name="native_map_goal_oracle"
)
# 隔离可选私有 oldnames.tsv；上游明确允许它不存在。
# Isolate optional private oldnames.tsv, absent as upstream explicitly permits.
g = native["main"].__globals__
g["HERE"] = str(OUT)
strings = {}
for table in sorted({name for name, _, _ in native["LABELS"]}):
    rows = []
    for i, (name, key, _) in enumerate(native["LABELS"]):
        if name == table:
            rows.append(
                {
                    "Key": key,
                    "zhCN": f"目标 {i}",
                    "enUS": f"Goal {i}",
                    "esES": f"Meta {i}",
                    "esMX": f"Destino {i}",
                    "ruRU": f"Цель {i}",
                    "koKR": f"목표 {i}",
                }
            )
    text = json.dumps(rows, ensure_ascii=False)
    strings[table] = text
    reads[f"local/lng/strings/{table}.json"] = text.encode()
native["main"]()
files = sorted(p.name for p in (OUT / "expected").iterdir())
assert len(files) == 195
(OUT / "files.json").write_text(json.dumps(files))
(OUT / "backend.json").write_text(json.dumps({**backend, "contract": "pyodide-matched-BASIC"}))
(OUT / "bundle.json").write_text(
    json.dumps(
        {
            "images": images,
            "font": base64.b64encode(font_bytes).decode(),
            "strings": strings,
        },
        ensure_ascii=False,
    )
)
(OUT / "options.json").write_text(
    json.dumps({"names": "current", "revision": "e3756f8942b40eba6c851e881828a5b1bda17fd6"})
)
print(
    "Original map-goal: 195 outputs, 31 labels x six languages, seven symbols and alpha-halved cross"
)
