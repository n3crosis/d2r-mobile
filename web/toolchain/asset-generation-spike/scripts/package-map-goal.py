"""提取固定的地图目标渲染，显式区分旧版/上游清单分支。
Extract pinned map-goal rendering with explicit legacy/upstream inventory branches."""

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
# 默认保留已验证的旧清单。固定源码的 v2 main 仅新增一处韩语赋值、保存及清单项，对这些变化显式设门槛。
# Keep the proven legacy inventory by default. The source-pinned v2 main adds
# exactly one Korean assignment, save, and manifest entry; gate those explicitly.
main = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "main")
main.args.args.append(ast.arg(arg="_include_korean"))
main.args.defaults.append(ast.Constant(value=False))


class KoreanBranch(ast.NodeTransformer):
    changes = 0

    def visit_Assign(self, node):
        if any(isinstance(t, ast.Name) and t.id == "ko" for t in node.targets):
            self.changes += 1
            return ast.If(
                test=ast.Name(id="_include_korean", ctx=ast.Load()),
                body=[node],
                orelse=[],
            )
        return self.generic_visit(node)

    def visit_Expr(self, node):
        text = ast.unparse(node)
        if text.startswith("label(ko,"):
            self.changes += 1
            return ast.If(
                test=ast.Name(id="_include_korean", ctx=ast.Load()),
                body=[node],
                orelse=[],
            )
        return self.generic_visit(node)

    def visit_Dict(self, node):
        for i, key in enumerate(node.keys):
            if isinstance(key, ast.Constant) and key.value == "koKR":
                self.changes += 1
                value = node.values[i]
                node.keys[i] = None
                node.values[i] = ast.IfExp(
                    test=ast.Name(id="_include_korean", ctx=ast.Load()),
                    body=ast.Dict(keys=[key], values=[value]),
                    orelse=ast.Dict(keys=[], values=[]),
                )
        return node


branch = KoreanBranch()
branch.visit(main)
if branch.changes != 3:
    raise SystemExit("Map-goal Korean branch source drift")
ast.fix_missing_locations(tree)
keep = []
for node in tree.body:
    if isinstance(node, ast.FunctionDef):
        keep.append(node)
    elif isinstance(node, ast.Assign):
        names = {
            n.id
            for target in node.targets
            for n in ast.walk(target)
            if isinstance(n, ast.Name)
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
