import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const catalogUrl = new URL("../js/core/i18n_catalog.js", import.meta.url);

function placeholders(text) {
  return [...new Set([...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]))].sort().join(",");
}

export function validateCatalog(source) {
  for (const [key, entry] of Object.entries(source)) {
    if (!entry || typeof entry.zh !== "string") throw new Error(`${key}: 缺少 zh 或 zh 不是字符串`);
    const en = entry.en;
    const plural = en && typeof en === "object" && !Array.isArray(en)
      && typeof en.other === "string"
      && Object.keys(en).every((form) => ["one", "other"].includes(form) && typeof en[form] === "string");
    if (typeof en !== "string" && !plural) throw new Error(`${key}: 缺少 en 或 en 不是字符串/合法复数对象`);
    for (const value of plural ? Object.values(en) : [en]) {
      if (placeholders(value) !== placeholders(entry.zh)) throw new Error(`${key}: 中英占位符集合不一致`);
    }
  }
}

function main() {
  const source = readFileSync(catalogUrl, "utf8");
  const match = /^(?:\s*\/\/[^\n]*\n)*\s*export const UI_COPY_CATALOG = Object\.freeze\(\s*(\{.*\})\s*\);\s*$/s.exec(source);
  if (!match) throw new Error("i18n_catalog.js 缺少 UI_COPY_CATALOG 导出或 Object.freeze 外壳");
  validateCatalog(JSON.parse(match[1]));
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
