"""Reuse the exact source-pinned texture encoder in the sealed asset runtime."""

import os
from pathlib import Path
import runpy

HERE = Path(__file__).resolve().parents[1]
TEXTURE = HERE.parent / "texture-spike"
OUT = HERE / "public/generated"
OUT.mkdir(parents=True, exist_ok=True)
os.environ["TEXTURE_OUTPUT_DIR"] = str(OUT)
runpy.run_path(str(TEXTURE / "package-encoder.py"), run_name="__main__")
(OUT / "bounded_encoder.py").write_bytes((TEXTURE / "bounded_encoder.py").read_bytes())
