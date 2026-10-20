/** Repository-backed inputs, NOT evidence that browser output ran on a device. */
export const PROGRAM_REWRITER_SOURCE =
  "d0bee134202bcc7c976c2713ffec2881f77b43bbfc24f4ebde17f0886c3dc22e";
export const REGISTERED_PROGRAM_RELEASE = Object.freeze({
  id: "switch-3.3.94012-touch-run-v4",
  gameVersion: "3.3.94012",
  titleId: "0100726014352000",
  ruleset: "touch-run-v4",
  sourceSha256: PROGRAM_REWRITER_SOURCE,
  realGameVerified: false,
  provenance: Object.freeze({
    inputHashes: "dm/tools/extract_game.sh:SUMS",
    moduleOrderAndRuleset: "dm/tools/d2rm_pack.py:MODS and patch",
    mainBuildId: "dm/tools/patch_nso.py:RULE_BUILD, CUTS, OBS, PARAMS",
  }),
  modules: Object.freeze([
    Object.freeze({
      name: "main",
      buildId: "db0507f36b84200ac05f75d76ed5026f",
      inputSha256: "55fd909bb7230b002357e5b0d8499c11f06888f345c49e69eb4734df44a27d0e",
    }),
    // No SDK build ID is invented: the repository supplies its complete file hash.
    Object.freeze({
      name: "sdk",
      buildId: null,
      inputSha256: "1c9f198a91c0bcfee5cf8f5b53fb941895e91334dfb766ce79fc68576797f017",
    }),
  ]),
});
export const REGISTERED_PROGRAM_CATALOG = Object.freeze({
  schemaVersion: 2,
  scope: "repository-registered",
  sourceSha256: PROGRAM_REWRITER_SOURCE,
  versions: Object.freeze([REGISTERED_PROGRAM_RELEASE]),
});
export const PROGRAM_REWRITE_LIMITS = Object.freeze({
  moduleInputBytes: 32 * 1024 * 1024,
  totalInputBytes: 64 * 1024 * 1024,
  segmentDecodedBytes: 64 * 1024 * 1024,
  imageBytes: 96 * 1024 * 1024,
  totalOutputBytes: 128 * 1024 * 1024,
});
