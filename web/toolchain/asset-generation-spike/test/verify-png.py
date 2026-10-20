from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / "test-results"
with Image.open(root / "browser/frame.png") as im:
    assert im.size == (16, 16)
    assert im.convert("RGBA").tobytes() == (root / "reference/frame.rgba").read_bytes(), (
        "PNG exact pixel parity failed"
    )
print("Browser Pillow PNG decodes to exact independent native reference pixels")
