"""打包未修改的原生美术生成器及已审计的非代码元数据。
Package the unchanged native-art generator and its audited non-code metadata."""

import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
PATHS = {
    "generator": "dm/ios/tools/native_art/generate.py",
    "implementation": "dm/ios/tools/native_art/implementation.c.inc",
    "manifest": "dm/ios/Sources/TouchArt/native_art_manifest.json",
    "geometry": "dm/ios/docs/native_art_v1_geometry.json",
    "binding": "dm/ios/docs/touch_layout_spec_native_binding_v5.json",
}
pins = json.loads((HERE / "native-art-provenance.json").read_text())
content = {}
for name, path in PATHS.items():
    raw = (ROOT / path).read_bytes()
    if hashlib.sha256(raw).hexdigest() != pins[path]:
        raise SystemExit("Native-art source drift: " + path)
    content[name] = raw.decode()
parts = ["import csv, hashlib, io, json\nfrom pathlib import Path\n"]
allowed = {"sha", "canonical", "classes", "codes", "classes_by_code", "COMMON_ICON"}
for node in ast.parse(content.pop("generator")).body:
    if isinstance(node, ast.FunctionDef) and node.name in {"main", "validate_rgba"}:
        parts.append(ast.unparse(node))
    elif isinstance(node, ast.Assign) and any(
        isinstance(t, ast.Name) and t.id in allowed for t in node.targets
    ):
        parts.append(ast.unparse(node))
out = HERE / "public/generated"
out.mkdir(parents=True, exist_ok=True)
(out / "native_art_original.py").write_text("\n\n".join(parts) + "\n")
(out / "native_art.py").write_text((HERE / "src/native_art.py").read_text())
(out / "native-art-metadata.json").write_text(json.dumps(content, ensure_ascii=False))

(out / "native-art-metadata-sha256.json").write_text(
    json.dumps(
        {k: hashlib.sha256(v.encode()).hexdigest() for k, v in content.items()},
        indent=2,
    )
    + "\n"
)
