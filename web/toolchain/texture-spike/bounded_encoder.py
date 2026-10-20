"""Bounded invocation of the original codec, not a replacement encoding algorithm."""

from PIL import Image
from original_bc3 import bc3

MAX_PIXELS = 4 * 1024 * 1024


def encode_rgba(payload, width, height):
    if (
        type(width) is not int
        or type(height) is not int
        or not (1 <= width <= 8192 and 1 <= height <= 8192)
    ):
        raise ValueError("Invalid encoder dimensions")
    if width * height > MAX_PIXELS or len(payload) != width * height * 4:
        raise ValueError("Encoder input length or pixel limit exceeded")
    image = Image.frombytes("RGBA", (width, height), bytes(payload))
    # Blocks are independent. Four-row bands preserve the original edge replication
    # and every floating-point operation within each block, without whole-image tensors.
    out = bytearray()
    for y in range(0, height, 4):
        out.extend(bc3(image.crop((0, y, width, min(y + 4, height)))))
    return bytes(out)
