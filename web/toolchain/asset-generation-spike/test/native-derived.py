"""自编 C 文本样例，以原始 shell_stubs.data 为参考，不使用游戏数据。
Authored C-text fixtures, original shell_stubs.data oracle, no game data."""

import hashlib
import json
from pathlib import Path
import runpy
import sys
import types

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
print(
    "Original shell_stubs.data produced full five-family synthetic derived.tsv oracle",
    counts,
)

# 测试实际有界接收端，不导入生成的 NumPy/Pillow 模块；仅替换原生解析器绑定，不替换待测代码。
# Exercise the actual bounded sink without importing the generated NumPy/Pillow module.
# Only its native parser binding is substituted, not the code under test.
previous = sys.modules.get("native_functions")
sys.modules["native_functions"] = types.ModuleType("native_functions")
try:
    bounded = runpy.run_path(str(HERE / "src/derived.py"))["BoundedOutput"]
    sink = bounded(limit=6)
    assert sink.write("测试") == 2
    assert bytes(sink.buffer) == "测试".encode("utf-8")
    try:
        sink.write("x")
    except ValueError as error:
        assert str(error) == "DERIVED_OUTPUT_LIMIT"
    else:
        raise AssertionError("UTF-8 byte overflow accepted")
    assert len(sink.buffer) == 6
    sink.close()
    sink.close()
    try:
        sink.write("")
    except ValueError:
        pass
    else:
        raise AssertionError("closed sink accepted write")
    sink = bounded(limit=4097)
    try:
        sink.write("界" * 100_000)
    except ValueError as error:
        assert str(error) == "DERIVED_OUTPUT_LIMIT"
    else:
        raise AssertionError("large write accepted")
    assert len(sink.buffer) <= 4097
finally:
    if previous is None:
        del sys.modules["native_functions"]
    else:
        sys.modules["native_functions"] = previous
print("Bounded UTF-8 sink rejects overflow during writes, including multibyte and large writes")
