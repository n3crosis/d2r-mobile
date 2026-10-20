// Exact public shell capacities, recovered from compiled bounds and equality checks.
// Evidence and interpretation: DERIVED_CAPACITIES.md. No generic fallback counts.
const record = {
  schemaVersion: 1,
  shellSha256: "a383552871851ddb5923033639358e2a3c205ae411676e6538cd098743bbe37b",
  counts: {
    EXP: 100,
    VTPART: 11,
    VTROW: 562,
    VTSET: 35,
    TAROW: 429,
  },
  evidence: {
    method:
      "Read-only Mach-O LC_SYMTAB symbol lookup and ARM64 instruction/control-flow inspection; no execution, installation, game inputs, array spacing, padding, or generated-input counts used.",
    executablePath: "Payload/DmIOS.app/DmIOS",
    executableSha256: "2d4b0299ff5d4856e12e14948da369ca35c27d2d0afd78dfed44cf4f6442b9ba",
    architecture: "arm64",
    disassembler: "Capstone 5.0.6",
    sourceCommit: "120fe55c02a5633476998a44f8c3c3c809fa48b0",
    sourcePath: "dm/ios/tools/shell_stubs.py",
    sourceSha256: "dad67b19195fa94eafc3db5737378e05b0fa3e29a8e6e0c42b5053d6a54ee41a",
    sourceUrl:
      "https://github.com/jhaizhou-ops/d2r-mobile/blob/120fe55c02a5633476998a44f8c3c3c809fa48b0/dm/ios/tools/shell_stubs.py",
    scope:
      "Derived table capacities only; not proof of content correctness, shader compatibility, or game execution.",
    bindings: [
      {
        tag: "EXP",
        symbol: "_k_exp_load",
        symbolVirtualAddress: "0x1000705e0",
        functionFileOffset: 460256,
        functionBytes: 568,
        functionSha256: "f53e85683fe1feccf58c95d3cbb5e0456c3c8ccc13a19b66e4bfeee6c4d52f2b",
        instructions: [
          {
            fileOffset: 460680,
            virtualAddress: "0x100070788",
            bytes: "ff9201f1",
            disassembly: "cmp x23, #0x64",
          },
          {
            fileOffset: 460684,
            virtualAddress: "0x10007078c",
            bytes: "880c8052",
            disassembly: "mov w8, #0x64",
          },
          {
            fileOffset: 460688,
            virtualAddress: "0x100070790",
            bytes: "fbc2889a",
            disassembly: "csel x27, x23, x8, gt",
          },
          {
            fileOffset: 460696,
            virtualAddress: "0x100070798",
            bytes: "7f0317eb",
            disassembly: "cmp x27, x23",
          },
          {
            fileOffset: 460700,
            virtualAddress: "0x10007079c",
            bytes: "80010054",
            disassembly: "b.eq #0x1000707cc",
          },
          {
            fileOffset: 460724,
            virtualAddress: "0x1000707b4",
            bytes: "407b37b8",
            disassembly: "str w0, [x26, x23, lsl #2]",
          },
        ],
      },
      {
        tag: "VTPART",
        symbol: "_vt_part_cb",
        symbolVirtualAddress: "0x1000d8c04",
        functionFileOffset: 887812,
        functionBytes: 76,
        functionSha256: "d925562f3175fe5d1298c6efee0b08d3ae84a72b2f214defa1529541cf2958ff",
        instructions: [
          {
            fileOffset: 887840,
            virtualAddress: "0x1000d8c20",
            bytes: "9f2a0071",
            disassembly: "cmp w20, #0xa",
          },
          {
            fileOffset: 887844,
            virtualAddress: "0x1000d8c24",
            bytes: "0c010054",
            disassembly: "b.gt #0x1000d8c44",
          },
          {
            fileOffset: 887872,
            virtualAddress: "0x1000d8c40",
            bytes: "007934f8",
            disassembly: "str x0, [x8, x20, lsl #3]",
          },
          {
            fileOffset: 887256,
            virtualAddress: "0x1000d89d8",
            bytes: "7f2e0071",
            disassembly: "cmp w19, #0xb",
          },
          {
            fileOffset: 887260,
            virtualAddress: "0x1000d89dc",
            bytes: "41feff54",
            disassembly: "b.ne #0x1000d89a4",
          },
        ],
      },
      {
        tag: "VTROW",
        symbol: "_vt_row_cb",
        symbolVirtualAddress: "0x1000d8c50",
        functionFileOffset: 887888,
        functionBytes: 232,
        functionSha256: "a0f32e52c2091d9375a8f21f8868d28ee7e6bdff06a32d2eeddb1022e2e2b831",
        instructions: [
          {
            fileOffset: 887900,
            virtualAddress: "0x1000d8c5c",
            bytes: "1fc50871",
            disassembly: "cmp w8, #0x231",
          },
          {
            fileOffset: 887904,
            virtualAddress: "0x1000d8c60",
            bytes: "ac060054",
            disassembly: "b.gt #0x1000d8d34",
          },
          {
            fileOffset: 887956,
            virtualAddress: "0x1000d8c94",
            bytes: "3b15088b",
            disassembly: "add x27, x9, x8, lsl #5",
          },
          {
            fileOffset: 887264,
            virtualAddress: "0x1000d89e0",
            bytes: "1fc90871",
            disassembly: "cmp w8, #0x232",
          },
          {
            fileOffset: 887268,
            virtualAddress: "0x1000d89e4",
            bytes: "01feff54",
            disassembly: "b.ne #0x1000d89a4",
          },
        ],
      },
      {
        tag: "VTSET",
        symbol: "_vt_set_cb",
        symbolVirtualAddress: "0x1000d8d38",
        functionFileOffset: 888120,
        functionBytes: 76,
        functionSha256: "f49200fb695addbb4fd583e07861684f09cd234c5f25a4ca18eb3f90304848db",
        instructions: [
          {
            fileOffset: 888148,
            virtualAddress: "0x1000d8d54",
            bytes: "9f8a0071",
            disassembly: "cmp w20, #0x22",
          },
          {
            fileOffset: 888152,
            virtualAddress: "0x1000d8d58",
            bytes: "0c010054",
            disassembly: "b.gt #0x1000d8d78",
          },
          {
            fileOffset: 888180,
            virtualAddress: "0x1000d8d74",
            bytes: "007934f8",
            disassembly: "str x0, [x8, x20, lsl #3]",
          },
          {
            fileOffset: 887272,
            virtualAddress: "0x1000d89e8",
            bytes: "9f8e0071",
            disassembly: "cmp w20, #0x23",
          },
          {
            fileOffset: 887276,
            virtualAddress: "0x1000d89ec",
            bytes: "c1fdff54",
            disassembly: "b.ne #0x1000d89a4",
          },
        ],
      },
      {
        tag: "TAROW",
        symbol: "_ta_load",
        symbolVirtualAddress: "0x10001c854",
        functionFileOffset: 116820,
        functionBytes: 672,
        functionSha256: "dd4b1eeb6742194cdfd6717e0f2138d9cf8fe3498565f46fb9378b25e53e6436",
        instructions: [
          {
            fileOffset: 117344,
            virtualAddress: "0x10001ca60",
            bytes: "ffb20671",
            disassembly: "cmp w23, #0x1ac",
          },
          {
            fileOffset: 117348,
            virtualAddress: "0x10001ca64",
            bytes: "ec010054",
            disassembly: "b.gt #0x10001caa0",
          },
          {
            fileOffset: 117376,
            virtualAddress: "0x10001ca80",
            bytes: "600300b9",
            disassembly: "str w0, [x27]",
          },
          {
            fileOffset: 117404,
            virtualAddress: "0x10001ca9c",
            bytes: "f7060011",
            disassembly: "add w23, w23, #1",
          },
          {
            fileOffset: 117436,
            virtualAddress: "0x10001cabc",
            bytes: "ffb60671",
            disassembly: "cmp w23, #0x1ad",
          },
          {
            fileOffset: 117440,
            virtualAddress: "0x10001cac0",
            bytes: "2bf0ff54",
            disassembly: "b.lt #0x10001c8c4",
          },
          {
            fileOffset: 117444,
            virtualAddress: "0x10001cac4",
            bytes: "c1f1ff54",
            disassembly: "b.ne #0x10001c8fc",
          },
        ],
      },
    ],
  },
};

function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}

export const SHELL_DERIVED_CAPACITIES = freeze(record);
