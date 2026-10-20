"""Authored C-text fixtures, original shell_stubs.data oracle, no game data."""

import hashlib
import json
from pathlib import Path
import runpy

HERE = Path(__file__).resolve().parents[1]
ROOT = HERE.parents[2]
OUT = HERE / "test-results/derived"
DM = OUT / "native-input"
(DM / "host").mkdir(parents=True, exist_ok=True)
(DM / "ios/Sources").mkdir(parents=True, exist_ok=True)
sources = {
    "dm_hud_exp.h": "static const uint32_t k_exp[100] = {"
    + ",".join(str(i * i * 123) for i in range(100))
    + "};\n",
    "dm_vault_tab.h": """#define VT_NPART 2
static const char *const vt_part_name[VT_NPART] = { "Synthetic Head", "测试栏" };
static const vt_row vt_rows[] = {
    { 1, 0, 2, 5, 17, -1, "Authored Unique", "Items/armor/authored" },
    { 0, 1, 0, 6, 3, 0, "Authored Set Piece", "Items/misc/authored" },
};
static const char *const vt_set_key[] = { "Authored Set" };
""",
    "dm_touch_native_art.c": """static const struct { uint32_t id; int atlas,frame; } rows[]={
 {12,1,2},
 {21,-1,-1},
};
""",
}
for name, relative in [
    ("dm_hud_exp.h", "host"),
    ("dm_vault_tab.h", "host"),
    ("dm_touch_native_art.c", "ios/Sources"),
]:
    (DM / relative / name).write_text(sources[name], encoding="utf-8")
native = runpy.run_path(str(ROOT / "dm/ios/tools/shell_stubs.py"))
counts = native["data"](str(DM), str(OUT / "expected.tsv"))
options = {
    "expectedCounts": dict(zip(("EXP", "VTPART", "VTROW", "VTSET", "TAROW"), counts)),
    "expectedSourceSha256": {
        name: hashlib.sha256(text.encode()).hexdigest() for name, text in sources.items()
    },
}
(OUT / "sources.json").write_text(json.dumps(sources, ensure_ascii=False), encoding="utf-8")
(OUT / "options.json").write_text(json.dumps(options), encoding="utf-8")
print("Original shell_stubs.data produced full five-family synthetic derived.tsv oracle", counts)
