import { ContentSelectionError, resolveContentSelection } from "./content-selection.mjs";

export const D2R_APPLICATION_ID = 0x0100726014352000n;
export const D2R_PATCH_ID = 0x0100726014352800n;
export const D2R_WARLOCK_ID = 0x0100726014353001n;

/**
 * Local package-input policy, not legal ownership or ticket verification.
 * The caller MUST supply retained, authenticated Meta-NCA records and independently
 * measured whole-NCA inventory from its trusted extraction boundary. This pure
 * function cannot authenticate arbitrary JS objects or authorize runtime behavior.
 * Returns the unchanged selection shape; DLC remains in requiredContents but is
 * never a Program RomFS overlay. Exact executable allowlisting remains mandatory.
 */
export function resolveD2rExpansionSelection(records, inventory, options = {}) {
  const selection = resolveContentSelection(records, inventory, options);
  const reject = (code, message) => {
    throw new ContentSelectionError(code, message);
  };
  if (selection.applicationId !== D2R_APPLICATION_ID || selection.base.patchId !== D2R_PATCH_ID)
    reject("D2R_APPLICATION_REQUIRED", "The supported D2R application is required.");
  if (!selection.patch || selection.patch.titleId !== D2R_PATCH_ID)
    reject("D2R_UPDATE_REQUIRED", "The supported D2R update input is required.");
  if (!selection.dlc.length)
    reject("D2R_EXPANSION_REQUIRED", "Your Reign of the Warlock package input is required.");
  if (selection.dlc.length !== 1 || selection.dlc[0].titleId !== D2R_WARLOCK_ID)
    reject("D2R_UNKNOWN_EXPANSION", "Only the known Reign of the Warlock add-on is supported.");
  // Conservative accepted shape, not a claim that a real package was measured.
  // Expand only after reviewing authenticated metadata and runtime dependencies.
  const contents = selection.dlc[0].contents;
  if (
    contents.length !== 1 ||
    contents[0].type !== 2 ||
    contents[0].idOffset !== 0 ||
    contents[0].attributes !== 0 ||
    contents[0].size === 0n
  )
    reject("D2R_EXPANSION_LAYOUT_UNSUPPORTED", "The add-on content layout is unsupported.");
  return selection;
}
