import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

const sourceUrl = new URL("../data/i18n/ui_copy.json", import.meta.url);
const catalogUrl = new URL("../js/core/i18n_catalog.js", import.meta.url);
const prefix = "// 由 tools/build_ui_copy.mjs 生成，勿手改\n\nexport const UI_COPY_CATALOG = Object.freeze(";

function placeholders(text) {
  return [...new Set([...text.matchAll(/\{([A-Za-z_][A-Za-z0-9_]*)\}/g)].map((match) => match[1]))].sort().join(",");
}

export function buildCatalog(source) {
  const catalog = {};
  for (const key of Object.keys(source).sort()) {
    const entry = source[key];
    if (!entry || typeof entry.zh !== "string") throw new Error(`${key}: 缺少 zh 或 zh 不是字符串`);
    const en = entry.en;
    const plural = en && typeof en === "object" && !Array.isArray(en)
      && typeof en.other === "string"
      && Object.keys(en).every((form) => ["one", "other"].includes(form) && typeof en[form] === "string");
    if (typeof en !== "string" && !plural) throw new Error(`${key}: 缺少 en 或 en 不是字符串/合法复数对象`);
    for (const value of plural ? Object.values(en) : [en]) {
      if (placeholders(value) !== placeholders(entry.zh)) throw new Error(`${key}: 中英占位符集合不一致`);
    }
    catalog[key] = { zh: entry.zh, en };
  }
  return catalog;
}

function main() {
  const catalog = buildCatalog(JSON.parse(readFileSync(sourceUrl, "utf8")));
  const output = `${prefix}${JSON.stringify(catalog, null, 2)});\n`;
  if (process.argv.includes("--check")) {
    const current = existsSync(catalogUrl) ? readFileSync(catalogUrl, "utf8") : "";
    if (current === output) return;
    const previous = current ? JSON.parse(current.slice(current.indexOf("Object.freeze(") + 14, current.lastIndexOf(");"))) : {};
    const keys = [...new Set([...Object.keys(previous), ...Object.keys(catalog)])].sort()
      .filter((key) => JSON.stringify(previous[key]) !== JSON.stringify(catalog[key]));
    console.error(`UI 文案产物与源不一致：${keys.length ? keys.join("\n") : "文件头、排序或格式不同"}`);
    process.exitCode = 1;
    return;
  }
  writeFileSync(catalogUrl, output);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
