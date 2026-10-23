# 验证 verify-png 的约定与边界；依据 web/toolchain/asset-generation-spike/test 及本文件的测试断言。
# Verify verify-png contracts and boundaries against web/toolchain/asset-generation-spike/test and this file's assertions.
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parents[1] / "test-results"
with Image.open(root / "browser/frame.png") as im:
    assert im.size == (16, 16)
    assert (
        im.convert("RGBA").tobytes() == (root / "reference/frame.rgba").read_bytes()
    ), "PNG exact pixel parity failed"
print("Browser Pillow PNG decodes to exact independent native reference pixels")
