"""仅打包已审计的纯函数，绝不导入或执行原生命令行模块。
Package only audited pure functions, never import/execute native CLI modules."""

import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
SOURCES = {
    "dm/ios/tools/romfs_art.py": [],
    "dm/ios/tools/gen_hud_v4.py": ["dflt"],
    "dm/ios/tools/gen_hud_exp.py": ["main"],
    "dm/ios/tools/gen_romfs_overlay.py": ["touch_path"],
    "dm/ios/tools/shell_stubs.py": ["unq", "paths", "parse", "data"],
}
manifest = json.loads((HERE / "source-provenance.json").read_text())
parts = [
    "import csv, io, os, re, struct, sys\nimport numpy as np\nfrom PIL import Image\n"
]
for path, names in SOURCES.items():
    raw = (ROOT / path).read_bytes()
    digest = hashlib.sha256(raw).hexdigest()
    if digest != manifest["sources"][path]:
        raise SystemExit(
            f"Native source drift: {path}. Review boundary before updating source-provenance.json."
        )
    tree = ast.parse(raw)
    for name in names:
        matches = [
            n
            for n in ast.walk(tree)
            if isinstance(n, ast.FunctionDef) and n.name == name
        ]
        if len(matches) != 1:
            raise SystemExit(f"Expected one {name} in {path}")
        node = matches[0]
        if name == "main":
            node.name = "native_experience_main"
        parts.append(ast.unparse(node))
    if path.endswith("gen_romfs_overlay.py"):
        for name in ("LAY", "UI", "TDIR"):
            matches = [
                n
                for n in ast.walk(tree)
                if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == name for t in n.targets)
            ]
            if len(matches) != 1:
                raise SystemExit(f"Expected one {name}")
            ast.literal_eval(
                matches[0].value
            )  # 若将来的赋值增加副作用则失败。 | Fail if a future assignment grows side effects.
            parts.append(ast.unparse(matches[0]))
    if path.endswith("shell_stubs.py"):
        constant = next(
            n
            for n in tree.body
            if isinstance(n, ast.Assign)
            and any(isinstance(t, ast.Name) and t.id == "CSTR" for t in n.targets)
        )
        ast.literal_eval(constant.value)
        parts.append(ast.unparse(constant))
output = HERE / "public/generated"
output.mkdir(parents=True, exist_ok=True)
(output / "native_functions.py").write_text("\n\n".join(parts) + "\n")
(output / "core.py").write_text((HERE / "src/core.py").read_text())
(output / "derived.py").write_text((HERE / "src/derived.py").read_text())
(output / "provenance.json").write_text(json.dumps(manifest, indent=2) + "\n")
