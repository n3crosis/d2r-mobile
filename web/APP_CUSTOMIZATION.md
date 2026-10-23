# Local app identity customization

[简体中文](APP_CUSTOMIZATION.zh-CN.md) | English

Optional advanced fields customize the generated **unsigned IPA**, then the existing
optional signer signs that final archive. Blank fields preserve the original pinned
shell. An entirely blank request returns the original Blob without parsing or
rewriting it. This does not update the game, executable, shell or deployment target.

Supported fields:

- Display name: 1–80 Unicode characters, without controls or surrounding whitespace.
  Changes `CFBundleDisplayName`, `CFBundleName`, and an existing `CFBundleSpokenName`.
  The app folder and executable name do not change.
- Bundle identifier: at most 255 ASCII letters, digits, hyphens and periods, with at
  least two nonempty dot-separated segments. No wildcards. A different identifier
  can create a different app container; existing saves and settings are not migrated.
- Release version: exactly three canonical decimal components, for example `2.1.0`,
  at most 32 characters. Changes only `CFBundleShortVersionString`.
- Build version: an optional separate stable `CFBundleVersion`, with one to three
  components. First component is 1–9999; subsequent components are 0–99. Development
  suffixes and leading zeros are unsupported. A release-version edit never silently
  changes the build version. Existing unchanged shell versions remain untouched.
- Icon: a local PNG of at most 4 MiB, square dimensions from 256 to 1024 pixels,
  non-interlaced, 8-bit RGB or RGBA. Every RGBA pixel must be fully opaque. APNG,
  palettes, transparency, SVG, JPEG, malformed checksums and oversized decoded data
  are rejected. Input metadata is discarded; no color-profile conversion is done.

## Icon limits

The local bounded decoder generates 14 ordinary RGB PNG files for common iPhone and
iPad sizes. Both `CFBundleIcons` primary-icon dictionaries reference the generated
files, and stale catalog/alternate icon declarations are removed. Original loose
icons and **Assets.car remain byte-identical**. No asset-catalog compiler, Canvas,
remote image service or runtime image decoder is used.

This is **loose-PNG customization only**, not a rebuilt asset catalog. Modern iOS
catalog variants, tinted/dark/layered appearances and actual Home Screen display
have not been validated. The feature must not be presented as guaranteeing every
icon surface or App Store eligibility.

## Integrity, signing and recovery

Binary and strict UTF-8 XML root plists are read with 1 MiB input/output, 32-level
and 4,096-node limits, plus an aggregate binary reference-expansion budget.
Duplicate keys, cycles, entity declarations and unsupported representations fail
closed. Root localized `InfoPlist.strings` overrides reject name/version changes
rather than silently retaining a different localized identity.

Customization occurs after normal pinned-shell, assembly and shader verification.
Only the root Info.plist and newly generated icon files change. Immutable game
resources, executables, Guest framework plist, shader receipts and Assets.car are
carried through as Blob slices. Canonical ZIP validation reads at most 4 MiB per
resource chunk; serialization uses 64 KiB payload slices. The existing central
metadata limit is 8 MiB and the full IPA limit is 512 MiB. No whole-IPA ArrayBuffer
or resource-tree copy is introduced. Repacking adds CRC passes and may take time.

The signer receives the customized unsigned archive and reads its actual root
bundle identifier. Its existing certificate/profile/team/application-ID checks,
concrete-entitlement restrictions, fixed paths and empty native-edit options remain
unchanged. A profile for the original ID does not authorize a different ID unless
its supported wildcard grant matches it. No arbitrary entitlements or profile
rewrites are accepted. Signing failure retains the customized unsigned IPA.

Customization failure after assembly retains the **original, uncustomized unsigned
IPA** with an explicit recovery label; it is not silently signed or reported as a
customized success. Private inputs stay local and are not persisted by this feature.

## Verification boundary

The focused Node suite uses authored XML/binary plists, inert ZIP resources and PNGs.
Python's standard plist parser independently verifies typed round-trips. Tests cover
all PNG filters, opacity/geometry/decompression bounds, default byte identity,
immutable payloads, reference expansion, cancellation, unsafe archives and signing
source guards. The actual two pinned public shell plists were read-only checked
against their release digests and successfully parsed/serialized. No native/WASM
build, real credentials, signing, browser, simulator, GPU or device test was run.

Apple references: [bundle identifier](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleidentifier),
[release version](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleshortversionstring),
[build version](https://developer.apple.com/documentation/bundleresources/information-property-list/cfbundleversion),
and [icon-file declarations](https://developer.apple.com/library/archive/documentation/General/Reference/InfoPlistKeyReference/Articles/CoreFoundationKeys.html).
The accepted forms above are intentionally narrower than all forms Apple tooling may accept.
