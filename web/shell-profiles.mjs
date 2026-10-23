// 封闭的公开外壳配置，依据发布摘要及独立的宿主二进制检查。
// Closed public shell profiles, based on release digests and independent host inspection.
import {
  REGISTERED_PROGRAM_RELEASE,
  findRegisteredProgramRelease,
} from "./program-release-catalog.mjs";
import defaultEvidence from "./toolchain/shell-release-evidence/v1.0.18.json" with { type: "json" };
import legacyEvidence from "./toolchain/shell-release-evidence/v1.0.18-ios18.json" with { type: "json" };
import { SHELL_DERIVED_CAPACITIES } from "./toolchain/shell-release-evidence/v1.0.18-derived-capacities.mjs";
import legacyCapacities from "./toolchain/shell-release-evidence/v1.0.18-ios18-derived-capacities.json" with { type: "json" };

export const DEFAULT_SHELL_PROFILE_ID = "v1.0.18-ios26";
function freeze(value) {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
const profiles = freeze({
  [DEFAULT_SHELL_PROFILE_ID]: {
    id: DEFAULT_SHELL_PROFILE_ID,
    releaseId: "v1.0.18",
    programReleaseIds: [REGISTERED_PROGRAM_RELEASE.id],
    evidence: defaultEvidence,
    capacities: SHELL_DERIVED_CAPACITIES,
    archivePath: "profile/shell.zip",
    guestTarget: { platform: "ios", minimumVersion: "26.0.0", sdkVersion: "26.0.0" },
    contentPin: {
      release: "v1.0.18",
      executablePath: "DmIOS",
      size: 2327536,
      originalSha256: "2d4b0299ff5d4856e12e14948da369ca35c27d2d0afd78dfed44cf4f6442b9ba",
      noDlcSha256: "0d6bae055ea5ee0571ff592ece73b90e9f3e7399fa8c59216f70a8f3707988fa",
      symbol: "_aoc_owned.v",
      address: 0x10018ef78n,
      fileOffset: 0x18ef78,
    },
  },
  "v1.0.18-ios18": {
    id: "v1.0.18-ios18",
    releaseId: "v1.0.18-ios18",
    programReleaseIds: [REGISTERED_PROGRAM_RELEASE.id],
    evidence: legacyEvidence,
    capacities: legacyCapacities,
    archivePath: "profile/shell-ios18.zip",
    // SDK 字段沿用现有手写 Guest 格式契约；不是苹果 SDK 构建声明。
    // SDK retains the existing handwritten Guest format contract, not an Apple SDK build claim.
    guestTarget: { platform: "ios", minimumVersion: "18.0.0", sdkVersion: "26.0.0" },
    contentPin: {
      release: "v1.0.18",
      executablePath: "DmIOS",
      size: 2323616,
      originalSha256: "62fabe715bf88a488470554b7d01c3b261e55ac0ab2b0e8b9053e3d8615a0e01",
      noDlcSha256: "b84ddbf50ff9d3ec29e5e64b5f57e3462068aa1007c73d9e65f17f330460189d",
      symbol: "_aoc_owned.v",
      address: 0x10018ede8n,
      fileOffset: 0x18ede8,
    },
  },
});
export const SHELL_PROFILE_IDS = Object.freeze(Object.keys(profiles));
for (const profile of Object.values(profiles)) {
  const executable = profile.evidence.entries.find(
    (entry) => entry.path === profile.capacities.evidence.executablePath,
  );
  if (
    !profile.programReleaseIds.length ||
    new Set(profile.programReleaseIds).size !== profile.programReleaseIds.length ||
    profile.programReleaseIds.some((id) => !findRegisteredProgramRelease(id)) ||
    profile.capacities.shellSha256 !== profile.evidence.sha256 ||
    !executable ||
    executable.sha256 !== profile.capacities.evidence.executableSha256 ||
    executable.sha256 !== profile.contentPin.originalSha256 ||
    executable.size !== profile.contentPin.size ||
    profile.capacities.evidence.executablePath !==
      `Payload/DmIOS.app/${profile.contentPin.executablePath}` ||
    profile.evidence.machOBuildVersions.length !== 1 ||
    profile.evidence.machOBuildVersions[0].platformId !== 2 ||
    profile.evidence.machOBuildVersions[0].minimumVersion !== profile.guestTarget.minimumVersion
  )
    throw new Error("SHELL_PROFILE_BINDING");
}

/**
 * 只接受内置配置标识；调用方不能提供摘要、偏移或目标版本。
 * Accept only built-in profile IDs; callers cannot supply hashes, offsets or target versions.
 */
export function resolveShellProfile(profileId = DEFAULT_SHELL_PROFILE_ID) {
  if (typeof profileId !== "string" || !Object.hasOwn(profiles, profileId))
    throw new Error("SHELL_PROFILE_UNKNOWN");
  return profiles[profileId];
}
