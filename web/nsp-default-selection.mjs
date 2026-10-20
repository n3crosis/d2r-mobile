// 文件名仅用于预选提示；认证后的内容策略仍决定实际可接受的输入。
// Filenames are preselection hints only; authenticated content policy still decides accepted inputs.
import { D2R_APPLICATION_ID, D2R_PATCH_ID, D2R_WARLOCK_ID } from "./d2r-expansion-policy.mjs";

const titleMarker = (id) => `[${id.toString(16).padStart(16, "0")}]`;
const matchesTitle = (name, id) => name.toLowerCase().includes(titleMarker(id));

export function selectDefaultNspNames(names) {
  const base = names.filter((name) => matchesTitle(name, D2R_APPLICATION_ID));
  const updates = names.filter((name) => matchesTitle(name, D2R_PATCH_ID));
  // 保留原来的模糊文件名回退；仅在已识别的基础包与更新分支加入已知 DLC。
  // Preserve the existing ambiguous-name fallback; add known DLC only in the recognized base/update branch.
  if (base.length !== 1 || updates.length === 0) return [...names];
  // 新增的 DLC 预选要求唯一标题标记，避免把混合标题文件名误当作已知 DLC。
  // Newly added DLC preselection requires one title marker, avoiding mixed-title filename hints.
  const dlc = names.filter((name) => {
    const markers = name.toLowerCase().match(/\[[0-9a-f]{16}\]/gu) ?? [];
    return markers.length === 1 && markers[0] === titleMarker(D2R_WARLOCK_ID);
  });
  return [...base, ...updates, ...dlc];
}
