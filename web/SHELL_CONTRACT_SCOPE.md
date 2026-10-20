# Shell and assembly inventory contract

Pure metadata-only validation before real inputs. No ZIP decompression, byte
inspection, filesystem operations, keys, downloads, native execution, packaging,
UI integration or signing. Synthetic fixtures only. Passing is not installability,
signature verification, game compatibility or game-content validation.

## API and trust boundary

`validateShellContract({ entries, shellInfoText, shellManifestText, trustedRecipe,
observedTargetOS })` accepts already-read metadata. Each entry is `{ path, size,
mode }`, with numeric UNIX mode (permission-only ZIP modes accepted). Directories
end in `/`. Optional signature metadata is `{ kind: "ad-hoc", offset, size }`.
This module bounds its range and preserves it, not verifies Mach-O bytes or hashes.
The upstream parser must establish metadata from actual bytes and bind supplied
text to its ZIP entry.

The caller must select `trustedRecipe` from an independently trusted registry,
never trusting shell self-claims. No production registry is shipped here.
`schemaVersion` is exactly 1: this API's version, not an invented native version.
Required fields are `product`, `chain`, `kind` (`ios` or `mac`), `shaderDigest`
(native 16 lowercase hex characters), `targetOS`, and `requiredPaths`. Optional
`extraFiles` narrowly authorizes other generated paths. Matching does not itself
make a recipe trusted.

`targetOS` is `{ platform: "ios" | "mac", minimumVersion: "16.0" }` (example
only). `observedTargetOS` and `observedOutputTargetOS` must be independently parsed
from shell/output Mach-O/plist bytes. Exact version agreement is required, with
missing patch zero normalized. This module does not inspect an installed device.

`validateAssemblyInventory({ shell, generatedEntries, observedOutputTargetOS })`
revalidates the shell. Generated paths are app-relative. Every manifest file and
nonempty required directory must exist. Generated paths are allowlisted, then
combined with shell entries to reject duplicate entries and collisions. Guest
must retain executable mode and bounded structural ad-hoc signature metadata.
Relevant returned entry metadata is detached; there is no signature removal.

## Native source evidence

`dm/ios/tools/shell_build.sh` writes PRODUCT, CHAIN, KIND, SHADER_SRC and
SPIRV_CROSS, plus relative required paths (trailing `/` means directory).
There is no native shell format version or target OS minimum in shell_info.
The script excludes provisioning, external signing resources and extensions.
`dm/tools/d2rm_pack.py::read_shell` identifies one Payload app and reads these
texts. Its final loop checks manifest completeness, copies shell entries and
appends generated entries, assigning Guest 0755. This validator adds collision
checks, strict recipe matching and independent target observations; it changes
neither script.

## Bounds and limitations

20,000 entries and 4 GiB declared uncompressed bytes per inventory, at most
1,024 required or extra paths per list, 512 ASCII
characters per path and 256 KiB per supplied text. Unsafe or unsupported paths,
case collisions including implicit ancestor directories, special files, symlinks,
set-ID/sticky modes, known signing/provisioning paths, credentials, Switch
containers, RomFS/ExeFS trees and native bulk archive filename patterns fail.
This conservative subset is not a complete ZIP/Apple filename implementation.
Name checks cannot detect renamed secrets, archives or embedded game content.
External `_CodeSignature` resources are forbidden; embedded Mach-O ad-hoc
signature metadata is preserved, not confused with these external resources.
