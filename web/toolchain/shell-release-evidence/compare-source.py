#!/usr/bin/env python3
"""Read committed public source only; never authorize a production recipe.

Run from any directory. Optional --archive verifies the already-downloaded shell.
No native source/tool lock/header is executed or changed. No game inputs used.
"""

import argparse
import ast
import hashlib
import json
from pathlib import Path
import posixpath
import re
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[3]
RELEASE = "120fe55c02a5633476998a44f8c3c3c809fa48b0"
SYNCED = "53e7c5bb9ca3ea53e2160005be8fbe920cd9cb53"
HERE = Path(__file__).resolve().parent


def git(*args):
    return subprocess.check_output(["git", "-C", str(ROOT), *args])


def blob(ref, path):
    return git("show", f"{ref}:{path}")


def literal_assignment(source, name):
    for node in ast.parse(source).body:
        if isinstance(node, ast.Assign) and any(
            isinstance(t, ast.Name) and t.id == name for t in node.targets
        ):
            return ast.literal_eval(node.value)
    raise ValueError(f"Missing literal assignment: {name}")


def inspect(ref):
    source = blob(ref, "dm/gfx/tools/dmsh_chain.py")
    files = literal_assignment(source, "FILES")
    options = "debug=True reduced=True"
    h = hashlib.sha256()
    hashes = {}
    for name in files:
        path = posixpath.normpath("dm/gfx/" + name)
        data = blob(ref, path)
        h.update(name.encode() + b"\0" + data + b"\0")
        hashes[path] = hashlib.sha256(data).hexdigest()
    h.update(options.encode())
    header = (
        re.search(rb'#define DMSH_CHAIN "([a-f0-9]+)"', blob(ref, "dm/gfx/nvn/dmsh_chain.h"))
        .group(1)
        .decode()
    )
    return {
        "commit": ref,
        "options": options,
        "computedChain": h.hexdigest()[:12],
        "headerChain": header,
        "headerMatchesCommittedInputs": header == h.hexdigest()[:12],
        "chainInputSha256": hashes,
        "spirvCrossFlags": literal_assignment(blob(ref, "dm/gfx/tools/dmsh_build.py"), "XC"),
        "product": blob(ref, "dm/PRODUCT").decode().splitlines()[0],
        "committedToolLock": dict(
            line.split("\t", 1)
            for line in blob(ref, "dm/gfx/tools/dmsh_chain.lock").decode().splitlines()
            if "\t" in line and not line.startswith("#")
        ),
    }


def report(archive=None):
    evidence = json.loads((HERE / "v1.0.18.json").read_text())
    release, synced = inspect(RELEASE), inspect(SYNCED)
    shell = evidence["shellInfo"]
    result = {
        "schemaVersion": 1,
        "purpose": "Diagnostic comparison, not a trusted compatibility recipe",
        "release": release,
        "syncedMain": synced,
        "observedShellInfo": shell,
        "chainInputsIdentical": release["chainInputSha256"] == synced["chainInputSha256"],
        "releaseComputedChainMatchesShell": release["computedChain"] == shell["CHAIN"],
        "releaseHeaderMatchesShell": release["headerChain"] == shell["CHAIN"],
        "changedNativePaths": git("diff", "--name-only", RELEASE, SYNCED, "--", "dm")
        .decode()
        .splitlines(),
        "candidateCross": {
            "version": "1.4.363.0",
            "officialTag": "vulkan-sdk-1.4.363.0",
            "commit": "f11ba9f0b21ba8fc15153d50a2a1ae31ab1cf8f7",
            "tagVerifiedVia": "https://api.github.com/repos/KhronosGroup/SPIRV-Cross/git/ref/tags/vulkan-sdk-1.4.363.0",
            "publisherBinaryBuiltFromThisCommitVerified": False,
        },
        "productionCompatibilityEstablished": False,
        "limitations": [
            "Release tag is not a build attestation for the shell binary.",
            "A WASM compiler cannot reproduce locked native executable fingerprints.",
            "Full locally generated shader catalog is required to verify SHADER_SRC; synthetic shaders cannot establish it.",
            "Matched sources and SHADER_SRC do not prove first-launch Metal compilation or game runtime behavior.",
        ],
    }
    if archive:
        data = Path(archive).read_bytes()
        if hashlib.sha256(data).hexdigest() != evidence["sha256"]:
            raise ValueError("Shell archive SHA-256 differs from pinned publisher evidence")
        with zipfile.ZipFile(archive) as z:
            raw = z.read("Payload/DmIOS.app/dm/shell_info.txt").decode()
            info = dict(line.split("=", 1) for line in raw.splitlines() if "=" in line)
            if info != shell:
                raise ValueError("Shell info differs from pinned inspection")
        result["archiveSha256Verified"] = True
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--archive", help="Existing public shell archive; read only")
    args = parser.parse_args()
    print(json.dumps(report(args.archive), indent=2))
