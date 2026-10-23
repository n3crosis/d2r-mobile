// Internal source revisions only; production stays on the proven legacy shell contract.
export {
  LEGACY_OVERLAY_REVISION as LEGACY_ART_REVISION,
  RELEASE_OVERLAY_REVISION as RELEASE_ART_REVISION,
  UPSTREAM_OVERLAY_REVISION as UPSTREAM_ART_REVISION,
  requireOverlayRevision as requireArtRevision,
} from "../overlay-recipe-js/revision.mjs";
