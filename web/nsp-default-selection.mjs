// 文件名仅用于预选提示；认证后的内容策略仍决定实际可接受的输入。
// Filenames are preselection hints only; authenticated content policy still decides accepted inputs.
import { D2R_APPLICATION_ID, D2R_PATCH_ID } from "./d2r-expansion-policy.mjs";

const titleMarker = (id) => `[${id.toString(16).padStart(16, "0")}]`;
const matchesTitle = (name, id) => name.toLowerCase().includes(titleMarker(id));

export function selectDefaultNspNames(names) {
  const base = names.filter((name) => matchesTitle(name, D2R_APPLICATION_ID));
  const updates = names.filter((name) => matchesTitle(name, D2R_PATCH_ID));
  // 可识别基础包和更新时只预选它们；DLC 需由用户显式选中。
  // Preselect only recognized base and updates; DLC requires an explicit choice.
  if (base.length !== 1 || updates.length === 0) return [...names];
  return [...base, ...updates];
}
