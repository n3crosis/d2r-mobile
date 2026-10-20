"""Extract original vault table functions and literal constants from pinned source."""

import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
path = "dm/ios/tools/gen_vault_table.py"
raw = (ROOT / path).read_bytes()
if (
    hashlib.sha256(raw).hexdigest()
    != json.loads((HERE / "vault-provenance.json").read_text())[path]
):
    raise SystemExit("Vault source drift")
keep = []
for node in ast.parse(raw).body:
    if isinstance(node, ast.FunctionDef):
        keep.append(node)
    elif isinstance(node, ast.Assign) and any(
        isinstance(t, ast.Name) and t.id in {"PARTS", "PART_OF"} for t in node.targets
    ):
        ast.literal_eval(node.value)
        keep.append(node)
out = HERE / "public/generated"
out.mkdir(parents=True, exist_ok=True)
(out / "vault_original.py").write_text(
    "import json, os, re\n" + "\n\n".join(ast.unparse(n) for n in keep) + "\n"
)
(out / "vault.py").write_text((HERE / "src/vault.py").read_text())
