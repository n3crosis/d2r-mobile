// 只保留版本差异，不复制整份字符串/布局表；测试按历史摘要验证恢复后的完整数据。
// Store only revision deltas, not duplicated tables; tests hash the complete restored historical data.
import delta from "./legacy-v1-data.json" with { type: "json" };
import annotations from "./annotation-data.json" with { type: "json" };
import touch from "./touch-data.json" with { type: "json" };

const excluded = new Set(delta.i18nExcludedKeys);
export const legacyI18n = {
  ...annotations.i18n,
  rows: annotations.i18n.rows.filter((row) => !excluded.has(row[0])).map((row) => row.slice(0, 6)),
};
export const legacyTouch = {
  ...annotations.touch,
  tables: Object.fromEntries(
    delta.touchLanguages.map((language) => [language, annotations.touch.tables[language]]),
  ),
};
const [page, changes] = touch.customPage,
  start = page.indexOf('        { "type": "TextBoxWidget", "name": "TouchCustom_lang_Text"'),
  end = page.indexOf('        { "type": "TextBoxWidget", "name": "TouchCustom_auto_mana_Text"');
const hint = / {8}\{ "type": "TextBoxWidget", "name": "TouchCustomLangHintKo"[^\n]+\n/g;
if (start < 0 || end <= start || [...page.matchAll(hint)].length !== 1)
  throw new Error("OVERLAY_LEGACY_LAYOUT_DELTA");
export const legacyCustomPage = [
  (page.slice(0, start) + delta.customLanguageRow + page.slice(end)).replace(hint, ""),
  changes,
];
