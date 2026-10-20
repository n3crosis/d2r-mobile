"""Generated instructions/NSO metadata only. Never reads game inputs."""

import hashlib
import json
import os
from pathlib import Path
import struct
import subprocess
import sys
import lz4.block

HERE = Path(__file__).resolve().parent
# HERE = repository/web/toolchain/program-rewrite-spike
SOURCE = HERE.parents[2] / "dm/tools/patch_nso.py"
OUT = HERE / "fixtures"
OUT.mkdir(exist_ok=True)


def nso(words, compressed=False, registered=False):
    text = bytearray(struct.pack("<I", 0xD503201F) * 64)
    struct.pack_into("<II", text, 0, 0x14000010, 0x100)
    for i, word in enumerate(words):
        struct.pack_into("<I", text, 0x40 + 4 * i, word)
    ro = bytearray(0x100)
    ro[:4] = b"MOD0"
    struct.pack_into("<i", ro, 16, 0x20)
    # eh_frame_hdr: version 1, absolute u32 pointer/count/table, one function.
    struct.pack_into("<4BIIII", ro, 0x20, 1, 3, 3, 3, 0, 1, 0x40, 0)
    segments = [bytes(text), bytes(ro), bytes(0x100)]
    payloads = [lz4.block.compress(s, store_size=False) if compressed else s for s in segments]
    header = bytearray(0x100)
    header[:4] = b"NSO0"
    struct.pack_into("<I", header, 0xC, 7 if compressed else 0)
    header[0x40:0x50] = (
        bytes.fromhex("db0507f36b84200ac05f75d76ed5026f")
        if registered
        else bytes.fromhex("534e5448455449430000000000000000")
    )
    offset = 0x100
    for i, payload in enumerate(payloads):
        struct.pack_into("<III", header, 0x10 + 0x10 * i, offset, i * 0x100, 0x100)
        struct.pack_into("<I", header, 0x60 + i * 4, len(payload))
        offset += len(payload)
    return bytes(header) + b"".join(payloads)


# Real ARM64 encodings: SVC, TPIDR read/write, TPIDRRO, physical/virtual counters,
# x18 add, load/store, cbz, adr, and ret. No game instructions/data are copied.
cases = [
    (
        "gates",
        [0xD4000541, 0xD53BD040, 0xD51BD041, 0xD53BD062, 0xD53BE023, 0xD53BE044, 0xD65F03C0],
        False,
        False,
        "native",
        True,
    ),
    (
        "x18",
        [0x91000652, 0xF9000012, 0xF9400012, 0xB4000052, 0x91000652, 0x10000012, 0xD65F03C0],
        False,
        False,
        "native",
        True,
    ),
    ("compressed", [0x91000652, 0xD4000541, 0xD65F03C0], True, False, "native", True),
    ("wrong-build-rule", [0xD65F03C0], False, False, "touch-run-v4", False),
    ("cut-preimage-mismatch", [0xD65F03C0], False, True, "native", False),
]
manifest = {"sourceSha256": hashlib.sha256(SOURCE.read_bytes()).hexdigest(), "cases": []}
for name, words, compressed, registered, ruleset, success in cases:
    data = nso(words, compressed, registered)
    path = OUT / f"{name}.nso"
    path.write_bytes(data)
    target = HERE / "oracle" / name
    result = subprocess.run(
        [sys.executable, str(SOURCE), str(path), str(target), "main"],
        env={**os.environ, "DM_RULESET": ruleset, "DM_PRIVATE_GATES": "1"},
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    expected_error = {
        "wrong-build-rule": "Run规则构建号不符",
        "cut-preimage-mismatch": "剪口原字节不符",
    }.get(name)
    if expected_error and expected_error not in result.stderr.decode():
        raise RuntimeError(f"{name}: expected upstream assertion was not reached")
    if (result.returncode == 0) != success:
        raise RuntimeError(f"{name}: unexpected native result: {result.stderr.decode()}")
    manifest["cases"].append(
        {
            "name": name,
            "sha256": hashlib.sha256(data).hexdigest(),
            "ruleset": ruleset,
            "success": success,
            "errorIncludes": expected_error,
        }
    )
(OUT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Generated {len(cases)} synthetic cases and independent native oracle outputs")
