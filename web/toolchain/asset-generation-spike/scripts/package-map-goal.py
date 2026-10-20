"""Extract unchanged map-goal rendering functions and constants from pinned source."""

import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
pins = json.loads((HERE / "map-goal-provenance.json").read_text())
path = "dm/ios/tools/gen_map_goal_art.py"
raw = (ROOT / path).read_bytes()
if hashlib.sha256(raw).hexdigest() != pins[path]:
    raise SystemExit("Map-goal source drift")
tree = ast.parse(raw)
keep = []
for node in tree.body:
    if isinstance(node, ast.FunctionDef):
        keep.append(node)
    elif isinstance(node, ast.Assign):
        names = {
            n.id for target in node.targets for n in ast.walk(target) if isinstance(n, ast.Name)
        }
        if names & {"NPC", "OBJ", "LABELS", "TEXT_PX", "PAD_X", "PAD_Y", "BOX_A"}:
            keep.append(node)
out = HERE / "public/generated"
out.mkdir(parents=True, exist_ok=True)
(out / "map_goal_original.py").write_text(
    "import csv, json, os, struct\nfrom PIL import Image, ImageDraw, ImageFont\n"
    + "\n\n".join(ast.unparse(n) for n in keep)
    + "\n"
)
(out / "map_goal.py").write_text((HERE / "src/map_goal.py").read_text())
