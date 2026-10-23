"""Package pinned original HUD computations, not CLI setup or filesystem discovery."""

import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
paths = json.loads((HERE / "hud-provenance.json").read_text())
source = {}
for path, expected in paths.items():
    raw = (ROOT / path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise SystemExit("HUD source drift: " + path)
    source[path] = raw.decode()
out = HERE / "public/generated"
out.mkdir(parents=True, exist_ok=True)
tree = ast.parse(source["dm/ios/tools/gen_hud_v4.py"])
# CLI/environment setup ends immediately before load(). Computations remain unchanged.
start = next(
    i for i, n in enumerate(tree.body) if isinstance(n, ast.FunctionDef) and n.name == "load"
)
body = []
for node in tree.body[start:]:
    if isinstance(node, ast.If) and ast.unparse(node.test) == "args.tuning_json is not None":
        continue  # No arbitrary developer tuning in the browser release path.
    if isinstance(node, ast.If) and ast.unparse(node.test) == "not args.overlay_only":
        body.extend(node.body)  # The browser iOS recipe always includes skill silhouettes.
        continue
    if isinstance(node, ast.Import) and any(n.name == "dm_i18n" for n in node.names):
        continue  # Supplied isolated source-pinned module, no filesystem import discovery.
    body.append(node)
if any(isinstance(n, ast.Name) and n.id in {"args", "sys"} for node in body for n in ast.walk(node)):
    raise SystemExit("Unexpected CLI dependency in packaged HUD recipe")
wrapper = ast.parse("def generate(ROMFS, OUT, HERE, SRC):\n    pass\n").body[0]
wrapper.body = body
(out / "hud_original.py").write_text(
    "import json, re, os\nimport numpy as np\nfrom PIL import Image\n"
    + ast.unparse(ast.fix_missing_locations(wrapper))
    + "\n"
)
design = ast.parse(source["dm/ios/tools/hud_v4_design.py"])
keep = [
    n
    for n in design.body
    if isinstance(n, ast.FunctionDef)
    and n.name == "load"
    or isinstance(n, ast.Assign)
    and any(isinstance(t, ast.Name) and t.id == "ART" for t in n.targets)
]
(out / "hud_design_original.py").write_text(
    "import numpy as np\nfrom PIL import Image, ImageDraw, ImageFont, ImageFilter\n"
    + "\n\n".join(ast.unparse(n) for n in keep)
    + "\n"
)
parts = ["import csv, json, re\n"]
for path, functions, constants in [
    ("dm/ios/tools/layout_patch.py", {"apply", "load_text"}, set()),
    ("dm/ios/tools/dm_i18n.py", {"rows"}, {"PROPER", "FMT", "EN_LIMITS", "EN_HAS_ZH"}),
]:
    for n in ast.parse(source[path]).body:
        if (
            isinstance(n, ast.FunctionDef)
            and n.name in functions
            or isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id in constants for t in n.targets)
        ):
            parts.append(ast.unparse(n))
(out / "hud_support_original.py").write_text("\n\n".join(parts) + "\n")
(out / "hud.py").write_text((HERE / "src/hud.py").read_text())
metadata = {
    "patch": source["dm/ios/tools/touchrectv1_patch.json"],
    "i18n": source["dm/i18n/ui_text.tsv"],
    "manifest": source["dm/ios/Sources/TouchArt/native_art_manifest.json"],
}
(out / "hud-metadata.json").write_text(json.dumps(metadata, ensure_ascii=False))
(out / "hud-metadata-sha256.json").write_text(
    json.dumps({k: hashlib.sha256(v.encode()).hexdigest() for k, v in metadata.items()})
)
