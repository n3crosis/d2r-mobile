"""Build a distinct native BASIC backend matching Pyodide's pinned Pillow/FreeType.

This does NOT replace or establish parity with the preserved RAQM reference.
Official source downloads occur only in CI; no end-user toolchain is required.
"""

import ast
import hashlib
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import urllib.request
import zipfile

PREFIX = Path(sys.argv[1]).resolve()
PREFIX.mkdir(parents=True, exist_ok=True)


def fetch(url, name, algorithm, expected):
    target = PREFIX / name
    with urllib.request.urlopen(url, timeout=60) as response:
        raw = response.read(32 * 1024 * 1024 + 1)
    if len(raw) > 32 * 1024 * 1024 or hashlib.new(algorithm, raw).hexdigest() != expected:
        raise SystemExit("Pinned backend source mismatch: " + name)
    target.write_bytes(raw)
    return target


recipe = fetch(
    "https://raw.githubusercontent.com/emscripten-core/emscripten/3.1.58/tools/ports/freetype.py",
    "freetype-port.py",
    "sha256",
    "e9e20092e392bde3307f80296c78b56794a2089bfd990db54e52b4e1a76803dd",
)
archive = fetch(
    "https://github.com/emscripten-ports/FreeType/archive/version_1.zip",
    "freetype.zip",
    "sha512",
    "0d0b1280ba0501ad0a23cf1daa1f86821c722218b59432734d3087a89acd22aabd5c3e5e1269700dcd41e87073046e906060f167c032eb91a3ac8c5808a02783",
)
with zipfile.ZipFile(archive) as source:
    for name in source.namelist():
        if not (PREFIX / name).resolve().is_relative_to(PREFIX):
            raise SystemExit("Unsafe official archive path")
    source.extractall(PREFIX)
root = PREFIX / "FreeType-version_1"
tree = ast.parse(recipe.read_text())
assignments = {
    t.id: n.value
    for n in ast.walk(tree)
    if isinstance(n, ast.Assign)
    for t in n.targets
    if isinstance(t, ast.Name)
}
sources = ast.literal_eval(assignments["srcs"])
# Identical port configuration and C source list, native compiler instead of Emscripten.
(root / "include/ftconfig.h").write_text(ast.literal_eval(assignments["ftconf_h"]))
lib = PREFIX / "lib"
lib.mkdir(exist_ok=True)
subprocess.run(
    [
        "cc",
        "-shared",
        "-fPIC",
        "-O2",
        "-pthread",
        "-DFT2_BUILD_LIBRARY",
        "-I" + str(root / "include"),
        *[str(root / p) for p in sources],
        "-o",
        str(lib / "libfreetype.so"),
    ],
    check=True,
)
include = PREFIX / "include/freetype2"
shutil.copytree(root / "include", include, dirs_exist_ok=True)
pc = lib / "pkgconfig"
pc.mkdir(exist_ok=True)
(pc / "freetype2.pc").write_text(
    f"prefix={PREFIX}\nlibdir=${{prefix}}/lib\nincludedir=${{prefix}}/include/freetype2\n"
    "Name: FreeType 2\nDescription: Pinned Emscripten port native reference\nVersion: 2.6.0\n"
    "Libs: -L${libdir} -lfreetype\nCflags: -I${includedir}\n"
)
pillow = fetch(
    "https://files.pythonhosted.org/packages/f8/3e/32cbd0129a28686621434cbf17bb64bf1458bfb838f1f668262fefce145c/pillow-10.2.0.tar.gz",
    "pillow.tar.gz",
    "sha256",
    "e87f0b2c78157e12d7686b27d63c070fd65d994e8ddae6f328e0dcf4a0cd007e",
)
with tarfile.open(pillow) as source:
    source.extractall(PREFIX, filter="data")
print("Pinned native FreeType2.6.0 built; Pillow10.2.0 source verified, BASIC contract only")
