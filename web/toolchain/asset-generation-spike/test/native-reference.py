"""独立原生参考：原始表命令行主体及标量图像参考。仅用自编合成输入，不导入浏览器 core 或已打包函数。
Independent native oracle: original table CLI body + scalar image reference.
Only authored synthetic inputs. Does not import browser core or packaged functions.
"""

import contextlib
import io
import json
from pathlib import Path
import runpy
import struct
import sys
import types

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
OUT = HERE / "test-results/reference"
OUT.mkdir(parents=True, exist_ok=True)
w, h, fw = 32, 16, 16
rgba = bytes(
    v
    for y in range(h)
    for x in range(w)
    for v in (
        (x * 19 + y * 7) % 256,
        (x * 3 + y * 13) % 256,
        (x + y * 11) % 256,
        (x * 17 + y * 5) % 256,
    )
)
header = b"SpA1" + struct.pack("<HHIIIIIIII", 31, fw, w, h, 0, 2, 0, 0, len(rgba), 4)
(OUT / "input.sprite").write_bytes(header + rgba)
expected = bytearray()
for y in range(h):
    for x in range(fw):
        i = (y * w + x + fw) * 4
        r, g, b, a = rgba[i : i + 4]
        red = r > 14 and ((r > g * 1.3 and g - b < 0.17 * r) or r > g * 1.7)
        if (
            red
            and round(h * 0.12) <= y < round(h * 0.88)
            and round(fw * 0.12) <= x < round(fw * 0.88)
        ):
            lum = r * 0.5 + g * 0.3 + b * 0.2
            r, g, b = [max(0, min(255, round(lum * k + 6))) for k in (0.42, 0.40, 0.38)]
        expected.extend((r, g, b, a))
(OUT / "frame.rgba").write_bytes(expected)
(OUT / "frame.sprite").write_bytes(
    b"SpA1" + struct.pack("<HHIIIIIIII", 31, fw, fw, h, 0, 1, 0, 0, len(expected), 4) + expected
)
table = "Level\tAmazon\tOther\nignored\t0\t0\n" + "".join(
    f"{i}\t{i * i * 123}\t{999 - i}\n" for i in range(101)
)
(OUT / "experience.tsv").write_text(table)
sys.modules["romfs_art"] = types.SimpleNamespace(read=lambda root, path: table.encode())
original = runpy.run_path(str(ROOT / "dm/ios/tools/gen_hud_exp.py"))
capture = io.StringIO()
with contextlib.redirect_stdout(capture):
    original["main"]("synthetic-only")
(OUT / "dm_hud_exp.h").write_text(capture.getvalue())
paths = [
    "data/global/ui/layouts/controller/hudpanelhd.json",
    "data/global/ui/layouts/controller/console/menu.json",
    "data/global/ui/layouts/controller/console/switch/inventory.json",
    "data/global/ui/layouts/controller/_profileconsolehd.json",
    "data/global/ui/layouts/controller/pc/test.json",
    "data/hd/global/ui/controller/controllerbuttons/switch/a.sprite",
    "data/hd/global/ui/controller/cursor/a.sprite",
    "data/other.txt",
]
targets = [
    "data/global/ui/layouts/xtouch_lay/hudpanelhd.json",
    "data/global/ui/layouts/ztouch_console_lay/menu.json",
    "data/global/ui/layouts/0touch_console_switch_lay/inventory.json",
    None,
    None,
    "data/hd/global/ui/ztouch_controller_buttons_ui/switch_a.sprite",
    "data/hd/global/ui/xtouch_cursor_lay/a.sprite",
    None,
]
(OUT / "paths.json").write_text(json.dumps(paths))
(OUT / "overlay-paths.json").write_text(
    json.dumps(
        [{"source": p, "target": t} for p, t in zip(paths, targets)],
        separators=(",", ":"),
    )
)
print("Authored fixtures and independent native references ready")
