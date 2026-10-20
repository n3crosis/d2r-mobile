// 浏览器文字桥接：依据共享表生成的目录，中文浏览器使用简体中文，其余使用英语。
// Browser text bridge based on the generated shared-table catalog: Chinese locales use Simplified Chinese; others use English.
import { catalog } from "./i18n-catalog.mjs";

export function browserLanguage() {
  return /^zh(?:-|$)/i.test(globalThis.navigator?.language ?? "") ? "zh-CN" : "en";
}

// 仅替换表中有序的 %s/%d 和 %%；参数永远不会被再次解析为格式串。
// Replace only ordered %s/%d and %% from the table; arguments are never reparsed as format strings.
export function t(key, ...values) {
  const row = catalog[key];
  if (!row) throw new Error(`Unknown browser text key: ${key}`);
  let index = 0;
  return row[browserLanguage() === "zh-CN" ? 1 : 0].replace(/%[sd%]/g, (token) =>
    token === "%%" ? "%" : String(values[index++] ?? ""),
  );
}
