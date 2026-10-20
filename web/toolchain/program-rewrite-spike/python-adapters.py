"""Minimal API surface consumed by the untouched patch_nso.py, not a decoder."""

import json
import struct
import sys
import types
import js


class Instruction:
    def __init__(self, data, raw):
        self.bytes = bytes(raw)
        self.__dict__.update(data)
        self.operands = [
            types.SimpleNamespace(reg=o["reg"], imm=int(o["imm"])) for o in data["operands"]
        ]

    def reg_name(self, register):
        return register or None

    def regs_access(self):
        if self.regs_error:
            raise RuntimeError("Capstone register access failed")
        return self.reads, self.writes


class Cs:
    def __init__(self, arch, mode):
        if arch != 1 or mode != 0:
            raise ValueError("Only ARM64 little-endian is bound")
        self.detail = True

    def disasm(self, data, address):
        for offset in range(0, len(data) - 3, 4):
            at = address + offset
            if not 0 <= at < 2**32:
                raise ValueError("NSO image address exceeds binding limit")
            item = json.loads(js.programDecode(struct.unpack_from("<I", data, offset)[0], at))
            if item is None:
                break  # Capstone default skipdata=False semantics
            if "error" in item:
                raise RuntimeError(item["error"])
            yield Instruction(item, data[offset : offset + 4])


def decompress(data, uncompressed_size):
    return bytes.fromhex(js.programLz4(bytes(data).hex(), uncompressed_size))


capstone = types.ModuleType("capstone")
capstone.Cs, capstone.CS_ARCH_ARM64, capstone.CS_MODE_ARM = Cs, 1, 0
sys.modules["capstone"] = capstone
lz4 = types.ModuleType("lz4")
lz4.block = types.ModuleType("lz4.block")
lz4.block.decompress = decompress
sys.modules["lz4"] = lz4
sys.modules["lz4.block"] = lz4.block
