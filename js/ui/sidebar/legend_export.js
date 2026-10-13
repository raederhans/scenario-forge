import { normalizeHexColor } from "../../core/color_hex_utils.js";
import { createSpecialZoneLayerStyle } from "../../core/special_zone_layers.js";

function getText(language) {
  return String(language || "en").startsWith("zh") ? {
    title: "图例", zones: "特殊区域", category: "类别", svg: "导出 SVG", csv: "导出 CSV",
    hint: "导出全部 {count} 项：SVG 用于排版，CSV 用于表格。",
    empty: "填色或生成图例后即可导出。", started: "{format} 下载已开始（{count} 项）。",
    failed: "图例导出失败，请重试。",
  } : {
    title: "Legend", zones: "Special zones", category: "Category", svg: "Export SVG", csv: "Export CSV",
    hint: "Export all {count} entries: SVG for layouts, CSV for spreadsheets.",
    empty: "Paint or generate a legend to export it.", started: "{format} download started ({count} entries).",
    failed: "Legend export failed. Please try again.",
  };
}

export function buildLegendExportEntries({ colors = [], labels = {}, specialZones = [], language = "en" } = {}) {
  const text = getText(language);
  const entries = [];
  const seen = new Set();
  for (const value of colors) {
    const color = normalizeHexColor(value);
    if (!color || seen.has(color)) continue;
    seen.add(color);
    entries.push({ kind: "color", label: String(labels[color] || "").trim() || `${text.category} ${entries.length + 1}`,
      color, stroke: "#64748b", pattern: "solid", fillOpacity: 1, strokeOpacity: 1, patternOpacity: 1, strokeWidth: 1 });
  }
  for (const layer of specialZones) {
    if (!layer || layer.visible === false || layer.legendVisible === false) continue;
    const style = createSpecialZoneLayerStyle(layer.style);
    entries.push({ kind: "special-zone", label: String(layer.name || layer.id || text.zones),
      color: style.fill, stroke: style.stroke, pattern: style.pattern, fillOpacity: style.fillOpacity,
      strokeOpacity: style.strokeOpacity, patternOpacity: style.patternOpacity, strokeWidth: style.strokeWidth });
  }
  return entries;
}

function csvCell(value) {
  let text = String(value ?? "");
  // Keep a user-entered label a cell value when opened in a spreadsheet.
  if (/^[\s\u0000-\u001f]*[=+@-]/u.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

export function buildLegendCsv(entries) {
  const fields = ["kind", "label", "color", "pattern", "stroke", "fillOpacity", "strokeOpacity", "patternOpacity"];
  return `\uFEFF${[fields, ...entries.map(entry => fields.map(field => entry[field]))]
    .map(row => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}

function xml(value) {
  return String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/gu, "")
    .replace(/[&<>"']/gu, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);
}

function wrapLabel(value, maxUnits = 34) {
  const lines = [];
  const characterUnits = character => character.codePointAt(0) > 255 || /[MWmw@%]/u.test(character) ? 2 : 1;
  for (const paragraph of String(value).split(/\r?\n/u)) {
    let line = "";
    let units = 0;
    for (const character of paragraph) {
      const width = characterUnits(character);
      if (units + width > maxUnits) {
        const wordBreak = line.lastIndexOf(" ");
        lines.push(wordBreak > 0 ? line.slice(0, wordBreak) : line);
        line = wordBreak > 0 ? line.slice(wordBreak + 1) : "";
        units = Array.from(line).reduce((total, value) => total + characterUnits(value), 0);
      }
      if (!line && character === " ") continue;
      line += character;
      units += width;
    }
    lines.push(line);
  }
  return lines;
}

function patternDefinition(entry, id) {
  const { pattern, stroke, strokeWidth: width } = entry;
  const paths = {
    diagonalHatch: "M -4 14 L 14 -4 M 0 18 L 18 0",
    crossHatch: "M -4 14 L 14 -4 M 0 18 L 18 0 M 0 -4 L 18 14 M -4 0 L 14 18",
    horizontalLines: "M 0 4 H 14 M 0 10 H 14",
    wavyLines: "M 0 5 C 3 2, 5 8, 8 5 S 12 2, 14 5 M 0 11 C 3 8, 5 14, 8 11 S 12 8, 14 11",
    chevrons: "M 1 9 L 7 4 L 13 9 M 1 14 L 7 9 L 13 14",
  };
  let shape = "";
  if (paths[pattern]) {
    shape = `<path d="${paths[pattern]}" fill="none" stroke="${xml(stroke)}" stroke-width="${width * (["crossHatch", "wavyLines"].includes(pattern) ? 0.75 : 1)}" stroke-linejoin="round"/>`;
  } else if (["dots", "denseDots"].includes(pattern)) {
    const dense = pattern === "denseDots";
    shape = [dense ? 2 : 4, dense ? 6 : 10].map(position => `<circle cx="${position}" cy="${position}" r="${dense ? 1.1 : 1.35}" fill="${xml(stroke)}"/>`).join("");
  } else if (pattern === "concentric") {
    shape = [[2.2, 0.7], [5.4, 0.55]].map(([radius, factor]) => `<circle cx="7" cy="7" r="${radius}" fill="none" stroke="${xml(stroke)}" stroke-width="${width * factor}"/>`).join("");
  }
  if (!shape) return "";
  const size = pattern === "denseDots" ? 8 : 14;
  return `<pattern id="${id}" width="${size}" height="${size}" patternUnits="userSpaceOnUse">${shape}</pattern>`;
}

export function buildLegendSvg(entries, { language = "en" } = {}) {
  const text = getText(language);
  const definitions = [];
  const rows = [];
  let y = 64;
  let zonesStarted = false;
  entries.forEach((entry, index) => {
    if (entry.kind === "special-zone" && !zonesStarted) {
      zonesStarted = true;
      rows.push(`<text x="24" y="${y + 6}" font-size="13" font-weight="600" fill="#475569">${xml(text.zones)}</text>`);
      y += 30;
    }
    const lines = wrapLabel(entry.label);
    const height = lines.length * 19 + 29;
    const id = `legend-pattern-${index}`;
    const definition = patternDefinition(entry, id);
    if (definition) definitions.push(definition);
    const swatch = `x="24" y="${y}" width="30" height="24" rx="3"`;
    rows.push(`<g><title>${xml(entry.label)}</title><rect ${swatch} fill="${entry.pattern === "outlineOnly" ? "none" : xml(entry.color)}" fill-opacity="${entry.fillOpacity}"/>`);
    if (definition) rows.push(`<rect ${swatch} fill="url(#${id})" fill-opacity="${entry.patternOpacity}"/>`);
    rows.push(`<rect ${swatch} fill="none" stroke="${xml(entry.stroke)}" stroke-opacity="${entry.strokeOpacity}" stroke-width="${Math.min(3, entry.strokeWidth)}"/>`);
    rows.push(`<text x="66" y="${y + 16}" font-size="14" fill="#0f172a">${lines.map((line, lineIndex) => `<tspan x="66" dy="${lineIndex ? 19 : 0}">${xml(line)}</tspan>`).join("")}</text>`);
    rows.push(`<text x="66" y="${y + lines.length * 19 + 14}" font-size="11" font-family="monospace" fill="#64748b">${xml(entry.color)}</text></g>`);
    y += height;
  });
  const height = y + 12;
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="412" height="${height}" viewBox="0 0 412 ${height}" role="img" aria-labelledby="legend-title" font-family="Arial, sans-serif"><title id="legend-title">${xml(text.title)}</title><defs>${definitions.join("")}</defs><rect width="412" height="${height}" rx="12" fill="#ffffff"/><text x="24" y="36" font-size="21" font-weight="700" fill="#0f172a">${xml(text.title)}</text>${rows.join("")}</svg>\n`;
}

export function createLegendExportControls({ documentRef, getModel, download, showToast = () => {} }) {
  const model = getModel();
  const text = getText(model.language);
  const count = buildLegendExportEntries(model).length;
  const shell = documentRef.createElement("div");
  shell.className = "legend-export-controls";
  const actions = documentRef.createElement("div");
  actions.className = "legend-export-actions";
  const status = documentRef.createElement("p");
  status.className = "legend-export-status";
  status.setAttribute("role", "status");
  status.setAttribute("aria-live", "polite");
  status.textContent = count ? text.hint.replace("{count}", String(count)) : text.empty;
  const buttons = [];
  for (const format of ["svg", "csv"]) {
    const button = documentRef.createElement("button");
    button.type = "button";
    button.id = `legendExport${format === "svg" ? "Svg" : "Csv"}Btn`;
    button.className = "legend-export-btn";
    button.textContent = text[format];
    button.disabled = !count;
    button.addEventListener("click", async () => {
      buttons.forEach(node => { node.disabled = true; });
      try {
        // Read at click time so edits to labels are included without rebuilding the panel.
        const current = getModel();
        const entries = buildLegendExportEntries(current);
        if (!entries.length) { status.textContent = text.empty; return; }
        const content = format === "svg" ? buildLegendSvg(entries, current) : buildLegendCsv(entries);
        const stem = String(current.fileStem || "map").replace(/[^a-z0-9_-]+/gi, "-").slice(0, 80) || "map";
        const blob = new Blob([content], { type: format === "svg" ? "image/svg+xml;charset=utf-8" : "text/csv;charset=utf-8" });
        const downloaded = await download(blob, `${stem}-legend.${format}`);
        if (downloaded !== false) status.textContent = text.started.replace("{format}", format.toUpperCase()).replace("{count}", String(entries.length));
      } catch {
        status.textContent = text.failed;
        showToast(text.failed, { tone: "error" });
      } finally {
        const empty = !buildLegendExportEntries(getModel()).length;
        buttons.forEach(node => { node.disabled = empty; });
      }
    });
    buttons.push(button);
    actions.appendChild(button);
  }
  shell.append(actions, status);
  return shell;
}
