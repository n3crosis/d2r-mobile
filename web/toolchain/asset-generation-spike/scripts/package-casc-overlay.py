"""Package source-pinned pure CASC functions only; no native filesystem emulation."""

import ast
import hashlib
import json
from pathlib import Path

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
path = "dm/tools/casc_overlay.py"
raw = (ROOT / path).read_bytes()
expected = json.loads((HERE / "casc-overlay-provenance.json").read_text())[path]
if hashlib.sha256(raw).hexdigest() != expected:
    raise SystemExit("CASC overlay source drift")
names = {
    "die",
    "norm_path",
    "blte_encode",
    "replace_config",
    "path_entry",
    "walk_paths",
    "trie_bytes",
    "offset_field_size",
    "add_paths",
    "set_cft_sizes",
    "cft_position",
    "encode_by_espec",
    "ekey_for",
}
nodes = [n for n in ast.parse(raw).body if isinstance(n, ast.FunctionDef) and n.name in names]
if {n.name for n in nodes} != names:
    raise SystemExit("Missing CASC pure function")
out = HERE / "public/generated"
out.mkdir(parents=True, exist_ok=True)
# Exact source segments, not reimplemented encoders.
(out / "casc_overlay_original.py").write_text(
    "import hashlib, struct, zlib\n\n"
    + "\n\n".join(ast.get_source_segment(raw.decode(), n) for n in nodes)
    + "\n"
)
(out / "casc_overlay.py").write_text((HERE / "src/casc_overlay.py").read_text())
