#!/usr/bin/env python3
"""Build-only: ship exact original bc3 function, never its filesystem/ctypes entrypoints."""

import ast
import hashlib
import json
import os
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
SOURCE = ROOT / "dm/ios/tools/gen_widestash_art.py"
PIN = "5c3a4b1985625ba5ba7f727e0fd77afc1b835b1f9b3ca6337dbdc36626bea073"
data = SOURCE.read_bytes()
if hashlib.sha256(data).hexdigest() != PIN:
    raise SystemExit("gen_widestash_art.py source drift; review and revalidate encoder")
module = ast.parse(data)
node = next(n for n in module.body if isinstance(n, ast.FunctionDef) and n.name == "bc3")
source = ast.get_source_segment(data.decode(), node)
output = Path(os.environ.get("TEXTURE_OUTPUT_DIR", HERE / "dist"))
output.mkdir(exist_ok=True)
(output / "original_bc3.py").write_text(
    "import struct\nimport numpy as np\nfrom PIL import Image\n\n" + source + "\n"
)
(output / "encoder-provenance.json").write_text(
    json.dumps(
        {
            "source": str(SOURCE.relative_to(ROOT)),
            "sha256": PIN,
            "function": "bc3",
            "method": "Unmodified AST source segment; bounded independent four-row bands",
        },
        indent=2,
    )
    + "\n"
)
