"""打包固定的原生覆盖语义，仅替换文件系统/CASC 边界。
Package pinned native overlay semantics; replace only filesystem/CASC boundaries."""

import ast
import base64
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
pins = json.loads((HERE / "overlay-recipe-provenance.json").read_text())
sources = {}
for path, expected in pins.items():
    raw = (ROOT / path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != expected:
        raise SystemExit(f"Overlay source drift: {path}")
    sources[path] = base64.b64encode(raw).decode()
script = ast.parse((ROOT / "dm/ios/tools/gen_romfs_overlay.py").read_text())
# 清单在真实 CASC 字节产生后由浏览器边界封装；捕获器不能替假归档签清单。
# Finalize manifests after real CASC bytes at the browser boundary, never over captured placeholders.
footer = next(
    i
    for i, node in enumerate(script.body)
    if isinstance(node, ast.Import) and any(name.name == "overlay_contract" for name in node.names)
)
if len(script.body[footer:]) != 5 or not isinstance(script.body[footer + 3], ast.For):
    raise SystemExit("Overlay manifest finalization boundary drift")
script.body = script.body[:footer]
emit = next(n for n in ast.walk(script) if isinstance(n, ast.FunctionDef) and n.name == "emit")
# 保留原始 to_touch、继承重写及两项精确布局集合门槛。
# Keep original to_touch, inheritance rewrites and both exact layout-set gates.
cut = next(
    i for i, n in enumerate(emit.body) if isinstance(n, ast.With) and "repl.tsv" in ast.unparse(n)
)
emit.body = emit.body[:cut] + ast.parse("return __browser_capture(repl, dst, tag, TS)").body
temporary_calls = [
    n
    for n in ast.walk(script)
    if isinstance(n, ast.Call) and ast.unparse(n.func) == "tempfile.TemporaryDirectory"
]
if len(temporary_calls) != 1 or temporary_calls[0].args or temporary_calls[0].keywords:
    raise SystemExit("Overlay temporary-directory boundary drift")
temporary_calls[0].keywords = [
    ast.keyword(arg="dir", value=ast.Name(id="__browser_temp_root", ctx=ast.Load()))
]
ast.fix_missing_locations(script)
out = HERE / "public/generated"
out.mkdir(parents=True, exist_ok=True)
(out / "overlay_recipe_sources.py").write_text(
    "SOURCES = " + repr(sources) + "\nRECIPE = " + repr(ast.unparse(script)) + "\n"
)
(out / "overlay_recipe.py").write_text((HERE / "src/overlay_recipe.py").read_text())
