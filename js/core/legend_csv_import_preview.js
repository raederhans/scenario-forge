import { normalizeHexColor } from "./color_hex_utils.js";
import { SPECIAL_ZONE_PATTERN_IDS } from "./special_zone_layers.js";

export const LEGEND_CSV_MAX_BYTES = 1024 * 1024;
export const LEGEND_CSV_MAX_ROWS = 2000;
export const LEGEND_CSV_FIELDS = Object.freeze([
  "kind", "label", "color", "pattern", "stroke", "fillOpacity", "strokeOpacity", "patternOpacity",
]);

function csvError(code, record = 0) {
  const error = new Error(code);
  error.code = code;
  error.record = record;
  return error;
}

// Only the project's eight-column export dialect is supported. Never repair a
// broken file or infer identity from a label, position, or style.
export function parseLegendCsv(text) {
  if (typeof text !== "string") throw csvError("invalid-input");
  if (text.length > LEGEND_CSV_MAX_BYTES || new TextEncoder().encode(text).length > LEGEND_CSV_MAX_BYTES) {
    throw csvError("file-too-large");
  }
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  const records = [];
  let row = [];
  let field = "";
  let mode = "start";
  const finishField = () => { row.push(field); field = ""; mode = "start"; };
  const finishRow = () => {
    finishField();
    records.push(row);
    row = [];
    if (records.length > LEGEND_CSV_MAX_ROWS + 1) throw csvError("too-many-rows");
  };
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (mode === "quoted") {
      if (character === '"') {
        if (source[index + 1] === '"') { field += '"'; index += 1; }
        else mode = "closed";
      } else field += character;
      continue;
    }
    if (character === ",") { finishField(); continue; }
    if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] !== "\n") {
        throw csvError("invalid-line-ending", records.length + 1);
      }
      if (character === "\r") index += 1;
      finishRow();
      continue;
    }
    if (mode === "closed") throw csvError("invalid-quotes", records.length + 1);
    if (character === '"') {
      if (mode !== "start") throw csvError("invalid-quotes", records.length + 1);
      mode = "quoted";
    } else { field += character; mode = "unquoted"; }
  }
  if (mode === "quoted") throw csvError("invalid-quotes", records.length + 1);
  if (mode !== "start" || row.length) finishRow();
  const headers = records.shift();
  if (!headers || headers.length !== LEGEND_CSV_FIELDS.length
    || new Set(headers).size !== LEGEND_CSV_FIELDS.length
    || headers.some(header => !LEGEND_CSV_FIELDS.includes(header))) {
    throw csvError("invalid-header", 1);
  }
  return { headers, records };
}

function validOpacity(value) {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(value)
    && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
}

/**
 * Comparisons use kind + normalized fill color only. They are informational,
 * never safe update targets: this export has no stable IDs or source identity.
 * Formula-protection apostrophes are deliberately preserved as file content.
 */
export function buildLegendCsvImportPreview(text, currentEntries = []) {
  const { headers, records } = parseLegendCsv(text);
  const candidatesByColor = new Map();
  for (const entry of currentEntries) {
    const color = normalizeHexColor(entry.color);
    if (!color || !["color", "special-zone"].includes(entry.kind)) continue;
    const key = `${entry.kind}:${color}`;
    const candidates = candidatesByColor.get(key) || [];
    candidates.push(String(entry.label ?? ""));
    candidatesByColor.set(key, candidates);
  }
  const duplicateGroups = new Map();
  const rows = records.map((cells, index) => {
    const entry = Object.fromEntries(headers.map((header, column) => [header, cells[column] ?? ""]));
    const issues = [];
    if (cells.length !== headers.length) issues.push("field-count");
    if (!["color", "special-zone"].includes(entry.kind)) issues.push("invalid-kind");
    const color = normalizeHexColor(entry.color);
    if (!color) issues.push("invalid-color");
    if (!normalizeHexColor(entry.stroke)) issues.push("invalid-stroke");
    if (!SPECIAL_ZONE_PATTERN_IDS.includes(entry.pattern)) issues.push("invalid-pattern");
    for (const field of ["fillOpacity", "strokeOpacity", "patternOpacity"]) {
      if (!validOpacity(entry[field])) issues.push(`invalid-${field}`);
    }
    const candidates = candidatesByColor.get(`${entry.kind}:${color}`) || [];
    const comparison = candidates.length === 1 ? "matched" : candidates.length > 1 ? "ambiguous" : "unmatched";
    // Repeated color categories compete for one label key. Special zones may
    // legitimately share a fill; only identical exported rows are duplicates.
    const duplicateKey = entry.kind === "color" && color
      ? `color:${color}` : JSON.stringify(LEGEND_CSV_FIELDS.map(field => entry[field]));
    const group = duplicateGroups.get(duplicateKey) || [];
    group.push(index + 2);
    duplicateGroups.set(duplicateKey, group);
    return { record: index + 2, entry, comparison, candidates: [...candidates], issues, duplicateKey };
  });
  const resultRows = rows.map(({ duplicateKey, ...row }) => ({
    ...row, duplicateRecords: duplicateGroups.get(duplicateKey).length > 1 ? [...duplicateGroups.get(duplicateKey)] : [],
  }));
  return {
    readOnly: true,
    limitation: "missing-stable-id",
    rows: resultRows,
    counts: {
      total: resultRows.length,
      matched: resultRows.filter(row => row.comparison === "matched").length,
      unmatched: resultRows.filter(row => row.comparison === "unmatched").length,
      ambiguous: resultRows.filter(row => row.comparison === "ambiguous").length,
      duplicates: resultRows.filter(row => row.duplicateRecords.length).length,
      invalid: resultRows.filter(row => row.issues.length).length,
      invalidColors: resultRows.filter(row => row.issues.includes("invalid-color") || row.issues.includes("invalid-stroke")).length,
    },
  };
}
