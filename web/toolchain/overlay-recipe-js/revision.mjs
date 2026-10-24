// 生产默认保持已验证旧外壳；新配方按源码提交命名，不把主版本当成能力证据。
// Production retains the verified legacy shell; new recipes name source commits, not assumed major-version capabilities.
export const LEGACY_OVERLAY_REVISION = "v1.0.18";
export const RELEASE_OVERLAY_REVISION = "b811b90172f4eb40ec1bc89d903308e0c5ab88d0";
export const UPSTREAM_OVERLAY_REVISION = "e3756f8942b40eba6c851e881828a5b1bda17fd6";
export function requireOverlayRevision(revision) {
  if (
    ![LEGACY_OVERLAY_REVISION, RELEASE_OVERLAY_REVISION, UPSTREAM_OVERLAY_REVISION].includes(
      revision,
    )
  )
    throw new Error("OVERLAY_RECIPE_REVISION");
  return revision !== LEGACY_OVERLAY_REVISION;
}
