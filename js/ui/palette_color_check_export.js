const FIELDS = Object.freeze([
  "record_type", "scope", "rgb_threshold", "checked_countries", "checked_legend_entries",
  "skipped_invalid_colors", "entry_kind", "match_type", "first_name", "first_code", "first_hex",
  "second_name", "second_code", "second_hex", "rgb_distance", "review_note",
]);

function getText(language) {
  return String(language || "en").startsWith("zh") ? {
    scope: { all: "国家和图例", country: "国家", legend: "图例" },
    kind: { country: "国家", legend: "图例" },
    type: { duplicate: "重复", similar: "相近" },
    summary: (duplicate, similar) => `重复配对：${duplicate}；相近配对：${similar}。`,
    empty: "当前范围及 RGB 阈值下未发现重复或相近的颜色配对。",
    note: "建议人工检查；不会自动改色。范围仅为国家基础色和纯色图例，局部涂色及图案不在此范围。RGB 颜色相似性仅为实用提示，不是专业色觉诊断。",
  } : {
    scope: { all: "Countries and legend", country: "Countries", legend: "Legend" },
    kind: { country: "Country", legend: "Legend" },
    type: { duplicate: "Duplicate", similar: "Similar" },
    summary: (duplicate, similar) => `Duplicate pairs: ${duplicate}; similar pairs: ${similar}.`,
    empty: "No duplicate or similar color pairs in this scope at the selected RGB threshold.",
    note: "Review manually; country base colors and solid legend entries only. Local paint and patterns are outside this check. Colors are not automatically changed. RGB color similarity is a practical hint, not a professional color-vision diagnosis.",
  };
}

function csvCell(value) {
  let text = String(value ?? "");
  // Match the existing legend exporter: user names and codes stay cell values.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

const count = (value) => Number.isFinite(value) && value >= 0 ? value : 0;

/**
 * Serialize the complete detached findSimilarPaletteColors report, including
 * pairs outside the current UI page. Pass the scope used to build that report;
 * this helper neither filters pairs again nor changes the report or map colors.
 * The CSV uses UTF-8 BOM, quoted cells, CRLF records, and spreadsheet formula guards.
 */
export function buildPaletteColorCheckCsv(report, { scope = "all", language = "en" } = {}) {
  const text = getText(language);
  const resolvedScope = scope === "country" || scope === "legend" ? scope : "all";
  const pairs = Array.isArray(report?.pairs) ? report.pairs : [];
  const metadata = [text.scope[resolvedScope], Number.isFinite(report?.threshold) ? report.threshold : "",
    count(report?.countryCount), count(report?.legendCount), count(report?.skippedCount)];
  const summary = pairs.length
    ? text.summary(count(report?.duplicateCount), count(report?.similarCount)) : text.empty;
  const rows = [FIELDS, ["summary", ...metadata, "", "", "", "", "", "", "", "", "", `${summary} ${text.note}`]];
  for (const pair of pairs) {
    rows.push(["pair", ...metadata, text.kind[pair.left.kind] || pair.left.kind,
      text.type[pair.type] || pair.type, pair.left.name, pair.left.code, pair.left.color,
      pair.right.name, pair.right.code, pair.right.color,
      Number.isFinite(pair.distance) ? pair.distance.toFixed(2) : "", text.note]);
  }
  return `\uFEFF${rows.map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
