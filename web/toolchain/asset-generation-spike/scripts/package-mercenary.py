"""提取原始佣兵合成，排除编解码及文件系统 I/O。
Extract original mercenary composition, excluding codec and filesystem I/O."""

import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
path = "dm/ios/tools/gen_merc_art.py"
pins = json.loads((HERE / "packager-source-pins.json").read_text())["mercenary"]
raw = (ROOT / path).read_bytes()
if hashlib.sha256(raw).hexdigest() != pins[path]:
    raise SystemExit("Mercenary source drift")
tree = ast.parse(raw)
constants = []
body = None
for node in tree.body:
    if isinstance(node, ast.Assign) and not any(isinstance(n, ast.Call) for n in ast.walk(node)):
        constants.append(node)
    if isinstance(node, ast.FunctionDef) and node.name == "main":
        body = []
        for statement in node.body:
            if isinstance(statement, ast.Assign) and any(
                isinstance(t, ast.Name) and t.id == "o" for t in statement.targets
            ):
                break
            body.append(statement)
        assert len(body) == 19, "Original composition structure drift"
        body.append(ast.Return(value=ast.Name(id="im", ctx=ast.Load())))
        node.body = body
        node.name = "compose"
        constants.append(node)
assert body is not None
out = HERE / "public/generated"
out.mkdir(parents=True, exist_ok=True)
(out / "mercenary_original.py").write_text(
    "import struct\n" + "\n\n".join(ast.unparse(n) for n in constants) + "\n"
)
(out / "mercenary.py").write_text((HERE / "src/mercenary.py").read_text())
