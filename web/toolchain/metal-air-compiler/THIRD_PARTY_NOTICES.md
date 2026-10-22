# Third-party notices

Upstream: https://github.com/gzorin/floor_llvm/tree/758f59eefe5db70f6e8719be8ca1beb939c38adb

- LLVM and Clang files carry their upstream Apache License 2.0 with LLVM exceptions notices. Full text is in `licenses/LLVM-LICENSE.txt`; file-specific notices remain in the fetched source.
- Flo's Open libRary transforms, including `MetalImage.cpp` and `MetalFinal.cpp`, identify copyright 2004–2025 Florian Ziesche and GNU GPL version 2 only. Full text is in `licenses/GPL-2.txt`. Patches to those files retain the corresponding obligations; they are not relicensed by this package.
- The fetched source can contain additional third-party components and file-specific licenses. Preserve its notices and review applicable distribution obligations before shipping compiler binaries/WASM.
- `api/include/metal_stdlib` is an authored compatibility subset with its own MIT SPDX notice, not Apple's Metal SDK header. Its license does not change the licenses of the compiler it calls.

This source package intentionally does not include Apple SDK headers, proprietary compiler binaries, user game sources or reference libraries.
