"""打包固定的原始仓库/宝箱/储藏库/袋子图像语句，不包含 I/O。
Package pinned original stash/trove/vault/pouch image statements, without I/O."""

import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
PINS = json.loads((HERE / "remaining-art-provenance.json").read_text())
for path, digest in PINS.items():
    if hashlib.sha256((ROOT / path).read_bytes()).hexdigest() != digest:
        raise SystemExit("Remaining art source drift: " + path)


def nodes(name):
    return ast.parse((ROOT / "dm/ios/tools" / name).read_text()).body


def constants(tree):
    return [
        node
        for node in tree
        if isinstance(node, ast.Assign)
        and not any(isinstance(child, ast.Call) for child in ast.walk(node))
    ]


def composition(filename, start, stop, result, rename):
    tree = nodes(filename)
    main = next(n for n in tree if isinstance(n, ast.FunctionDef) and n.name == "main")
    body = main.body[start:stop]
    main.name = rename
    main.args = ast.arguments(
        posonlyargs=[],
        args=[ast.arg(arg="im")],
        kwonlyargs=[],
        kw_defaults=[],
        defaults=[],
    )
    main.body = body + [ast.Return(value=ast.Name(id=result, ctx=ast.Load()))]
    return constants(tree) + [main]


wide = nodes("gen_widestash_art.py")
wide = (
    constants(wide)
    + [
        n
        for n in wide
        if isinstance(n, ast.Assign)
        and any(isinstance(t, ast.Name) and t.id == "SPEC" for t in n.targets)
    ]
    + [n for n in wide if isinstance(n, ast.FunctionDef) and n.name == "widen_bg"]
)
trove = [n for n in nodes("gen_trove_art.py") if isinstance(n, (ast.Assign, ast.FunctionDef))]
# 语句切片由源码哈希固定，并由下方无 I/O 的 AST 检查断言。
# Statement slices are source-hash pinned, and asserted by the I/O-free AST check below.
vault = composition("gen_vault_cover.py", 5, -3, "crop", "vault_cover")
pouch = composition("gen_pouch_art.py", 4, -3, "out", "pouch_box")
for tree in [wide, trove, vault, pouch]:
    ast.fix_missing_locations(ast.Module(body=tree, type_ignores=[]))
    for node in ast.walk(ast.Module(body=tree, type_ignores=[])):
        if isinstance(node, ast.Name) and node.id in {"open", "G", "dmx", "sys", "os"}:
            raise SystemExit("Unexpected I/O or codec dependency in extracted composition")
out = HERE / "public/generated"
out.mkdir(parents=True, exist_ok=True)
for name, tree in [
    ("remaining_art_original", wide + vault + pouch),
    ("trove_original", trove),
]:
    (out / (name + ".py")).write_text(
        "import numpy as np\nfrom PIL import Image, ImageDraw\n"
        + "\n\n".join(ast.unparse(n) for n in tree)
        + "\n"
    )
(out / "remaining_art.py").write_text((HERE / "src/remaining_art.py").read_text())
