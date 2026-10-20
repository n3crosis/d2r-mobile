"""Whole original HUD script oracle using authored images/layout/TrueType outlines."""

import base64
import hashlib
import json
from pathlib import Path
import runpy
import shutil
import sys
import types

from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from PIL import Image

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
OUT = HERE / "test-results/hud"
IOS = OUT / "native/ios"
TOOLS = IOS / "tools"
ART = IOS / "Sources/TouchArt"
for p in (TOOLS, ART, OUT / "native/i18n", OUT / "expected"):
    p.mkdir(parents=True, exist_ok=True)
for name in (
    "gen_hud_v4.py",
    "hud_v4_design.py",
    "layout_patch.py",
    "dm_i18n.py",
    "gen_paths.py",
    "touchrectv1_patch.json",
):
    shutil.copyfile(ROOT / "dm/ios/tools" / name, TOOLS / name)
shutil.copyfile(ROOT / "dm/i18n/ui_text.tsv", OUT / "native/i18n/ui_text.tsv")
# The font is newly authored geometry, not a renamed installed/proprietary font.
font = FontBuilder(1000, isTTF=True)
font.setupGlyphOrder([".notdef", "space", "authored"])
empty = TTGlyphPen(None).glyph()
pen = TTGlyphPen(None)
pen.moveTo((60, 0))
pen.lineTo((440, 0))
pen.lineTo((440, 700))
pen.lineTo((60, 700))
pen.closePath()
font.setupGlyf({".notdef": empty, "space": empty, "authored": pen.glyph()})
font.setupHorizontalMetrics({".notdef": (500, 0), "space": (250, 0), "authored": (500, 60)})
font.setupHorizontalHeader(ascent=800, descent=-200)
codepoints = set(range(33, 127)) | set(range(160, 1024)) | set(range(0x4E00, 0xA000)) | {0xB7}
font.setupCharacterMap({32: "space", **{c: "authored" for c in codepoints}})
font.setupNameTable(
    {
        "familyName": "Authored Synthetic HUD Fixture",
        "styleName": "Regular",
        "uniqueFontIdentifier": "AuthoredHUD1",
        "fullName": "Authored Synthetic HUD Fixture",
        "psName": "AuthoredHUDFixture",
    }
)
font.setupOS2(sTypoAscender=800, sTypoDescender=-200, usWinAscent=800, usWinDescent=200)
font.setupPost()
font.setupMaxp()
font_path = OUT / "authored-fixture.ttf"
font.save(font_path)
font_bytes = font_path.read_bytes()
# Construct only the structural fields requested by the original patch. Values are synthetic.
patch = json.loads((TOOLS / "touchrectv1_patch.json").read_text())


def skeleton(p):
    if p is None:
        return {"name": "Authored", "fields": {}}
    if "value" in p:
        return p["value"]
    if "dict" in p:
        return {k: skeleton(p["dict"][k]) if k in p["dict"] else 0 for k in p["order"]}
    if "list" in p:
        result = [{} for _ in range(1 + max((x.get("base", -1) for x in p["list"]), default=-1))]
        for x in p["list"]:
            if "base" in x:
                result[x["base"]] = skeleton(x["patch"])
        return result
    raise AssertionError("unknown patch")


layout = skeleton(patch)
names = {
    0: "ExpBar",
    1: "HealthBall",
    2: "ManaBall",
    3: "Overlay",
    4: "AuthoredUnused",
    16: "Belt",
    17: "LevelUpFlourish",
    18: "LevelUpButton",
    **{i: f"SkillButton{i - 9}" for i in range(10, 16)},
}
for i, name in names.items():
    layout["children"][i]["name"] = name
for i in (1, 2):
    layout["children"][i]["children"][0]["name"] = "ValueDisplay"
layout["children"][16]["children"][0]["name"] = "HotkeyLabelTemplate"
layout_text = json.dumps(layout)
images = {}
for i, name in enumerate(("front_panel", "levelupbutton", "greater_healing_potion")):
    w, h = (128, 64) if i == 0 else (32, 24)
    pixels = bytes(
        v
        for y in range(h)
        for x in range(w)
        for v in ((x * 7 + i * 41) % 256, (y * 11 + 71) % 256, (x + y + 39) % 256, 255)
    )
    images[name] = Image.frombytes("RGBA", (w, h), pixels)
assets = []
for i in range(9):
    name = f"dm_native_skill_{i}.png"
    im = Image.new("RGBA", (16, 8), (180 + i * 4, 180, 180, 255))
    im.save(ART / name)
    assets.append(
        {
            "asset": name,
            "atlas_px": [16, 8],
            "frame_width": 7,
            "frame_pitch": 8,
            "frame_count": 2,
            "decoded_png_sha256": hashlib.sha256((ART / name).read_bytes()).hexdigest(),
        }
    )
manifest = json.dumps({"assets": assets})
(ART / "native_art_manifest.json").write_text(manifest)
metadata = {
    "patch": (TOOLS / "touchrectv1_patch.json").read_text(),
    "i18n": (OUT / "native/i18n/ui_text.tsv").read_text(),
    "manifest": manifest,
}
paths = {
    "hd/global/ui/PANEL/HUD_02/front_panel.sprite": "front_panel",
    "hd/global/ui/Controller/HUD/LevelUpButton.sprite": "levelupbutton",
    "hd/global/ui/items/misc/potion/greater_healing_potion.sprite": "greater_healing_potion",
}
module = types.SimpleNamespace(
    sprite=lambda _, p: images[paths[p]].copy(),
    font=lambda _, n: str(font_path),
    read=lambda _, p: layout_text.encode()
    if p == "global/ui/Layouts/Controller/HUDPanelHD.json"
    else (_ for _ in ()).throw(AssertionError(p)),
)
old = sys.modules.get("romfs_art")
argv = sys.argv
sys.modules["romfs_art"] = module
sys.argv = [str(TOOLS / "gen_hud_v4.py"), "authored-only", str(OUT / "expected")]
try:
    runpy.run_path(str(TOOLS / "gen_hud_v4.py"), run_name="__main__")
finally:
    sys.argv = argv
    if old is None:
        del sys.modules["romfs_art"]
    else:
        sys.modules["romfs_art"] = old


def b64(b):
    return base64.b64encode(b).decode()


bundle = {
    "metadata": metadata,
    "layout": layout_text,
    "fonts": {
        n: b64(font_bytes) for n in ("blizzardglobal-v5_81.ttf", "exocetblizzardot-medium.otf")
    },
    "images": {n: {"size": list(im.size), "rgba": b64(im.tobytes())} for n, im in images.items()},
    "atlases": {a["asset"]: b64((ART / a["asset"]).read_bytes()) for a in assets},
}
(OUT / "bundle.json").write_text(json.dumps(bundle, ensure_ascii=False))
(OUT / "options.json").write_text(
    json.dumps(
        {
            "mode": "switch-upscaled",
            "metadataSha256": {
                k: hashlib.sha256(v.encode()).hexdigest() for k, v in metadata.items()
            },
        }
    )
)
files = sorted(
    str(p.relative_to(OUT / "expected")) for p in (OUT / "expected").rglob("*") if p.is_file()
)
(OUT / "files.json").write_text(json.dumps(files))
print(
    "Original complete HUD inventory",
    len(files),
    "files; fonts are newly authored synthetic outlines",
)
