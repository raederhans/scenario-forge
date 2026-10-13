import { normalizeHexColor } from "./color_hex_utils.js";
import { SPECIAL_ZONE_PATTERN_IDS } from "./special_zone_layers.js";
import { LEGEND_CSV_FIELDS, LEGEND_CSV_V2_FIELDS, decodeLegendCsvValue, getLegendCsvEntryId,
  getLegendCsvCategorySignature, getLegendCsvZoneSignature } from "./legend_csv_schema.js";
export { LEGEND_CSV_FIELDS, LEGEND_CSV_V2_FIELDS } from "./legend_csv_schema.js";

export const LEGEND_CSV_MAX_BYTES = 1024 * 1024;
export const LEGEND_CSV_MAX_ROWS = 2000;

function csvError(code, record = 0) {
  const error = new Error(code);
  error.code = code;
  error.record = record;
  return error;
}

// Only the project's legacy/v2 export dialects are supported. Never repair a
// broken file or infer identity from a label, position, or style.
export function parseLegendCsv(text) {
  if (typeof text !== "string") throw csvError("invalid-input");
  if (text.length > LEGEND_CSV_MAX_BYTES || new TextEncoder().encode(text).length > LEGEND_CSV_MAX_BYTES) {
    throw csvError("file-too-large");
  }
  const source = text.startsWith("\uFEFF") ? text.slice(1) : text;
  if (source.startsWith("\uFEFF")) throw csvError("invalid-header", 1);
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
  const fields = headers?.length === LEGEND_CSV_V2_FIELDS.length ? LEGEND_CSV_V2_FIELDS : LEGEND_CSV_FIELDS;
  if (!headers || headers.length !== fields.length
    || new Set(headers).size !== fields.length || headers.some(header => !fields.includes(header))) {
    throw csvError("invalid-header", 1);
  }
  return { headers, records, formatVersion: fields === LEGEND_CSV_V2_FIELDS ? 2 : 1 };
}

function validOpacity(value) {
  return /^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/iu.test(value)
    && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 1;
}

/**
 * Legacy comparisons use kind + color and remain read-only. V2 uses exact
 * canonical IDs within a nonempty scenario/baseline scope. Changed valid rows
 * still require explicit confirmation and target revalidation by the transaction.
 */
export function buildLegendCsvImportPreview(text, currentEntries = [], scope = {}) {
  const { headers, records, formatVersion } = parseLegendCsv(text);
  const candidatesByColor = new Map();
  const candidatesById = new Map();
  for (const entry of currentEntries) {
    const color = normalizeHexColor(entry.color);
    if (!color || !["color", "special-zone"].includes(entry.kind)) continue;
    const key = `${entry.kind}:${color}`;
    const candidates = candidatesByColor.get(key) || [];
    candidates.push(String(entry.label ?? ""));
    candidatesByColor.set(key, candidates);
    if (entry.entryId) {
      const idKey = `${entry.kind}:${entry.entryId}`;
      const targets = candidatesById.get(idKey) || [];
      targets.push(entry);
      candidatesById.set(idKey, targets);
    }
  }
  const duplicateGroups = new Map();
  const rows = records.map((cells, index) => {
    const entry = Object.fromEntries(headers.map((header, column) => [header,
      formatVersion === 2 ? decodeLegendCsvValue(cells[column] ?? "") : cells[column] ?? ""]));
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
    const targets = candidatesById.get(`${entry.kind}:${entry.entryId}`) || [];
    const currentEntry = targets.length === 1 ? targets[0] : null;
    const candidates = formatVersion === 2 ? targets.map(target => String(target.label ?? ""))
      : candidatesByColor.get(`${entry.kind}:${color}`) || [];
    const comparison = candidates.length === 1 ? "matched" : candidates.length > 1 ? "ambiguous" : "unmatched";
    if (formatVersion === 2) {
      if (entry.schemaVersion !== "2") issues.push("unsupported-version");
      if (!entry.scenarioId || !scope.scenarioId) issues.push("missing-scenario-scope");
      else if (entry.scenarioId !== scope.scenarioId) issues.push("scenario-mismatch");
      if (!entry.scenarioBaselineHash || !scope.scenarioBaselineHash) issues.push("missing-baseline-hash");
      else if (entry.scenarioBaselineHash !== scope.scenarioBaselineHash) issues.push("baseline-mismatch");
      if (!entry.entryId || !entry.entryId.startsWith(entry.kind === "color" ? "category:" : "special-zone:")) issues.push("invalid-entry-id");
      if (!/^(?:\d+\.?\d*|\.\d+)$/u.test(entry.strokeWidth)
        || Number(entry.strokeWidth) < 0.4 || Number(entry.strokeWidth) > 8) issues.push("invalid-strokeWidth");
      if (entry.kind === "color" && (entry.entryId !== getLegendCsvEntryId("color", color)
        || (currentEntry && !sameStyle(entry, currentEntry)))) issues.push("category-style-unsupported");
      if (entry.kind === "special-zone" && !entry.label.trim()) issues.push("empty-zone-name");
    }
    // Repeated color categories compete for one label key. Special zones may
    // legitimately share a fill; only identical exported rows are duplicates.
    const duplicateKey = formatVersion === 2 && entry.entryId ? `id:${entry.entryId}` : entry.kind === "color" && color
      ? `color:${color}` : JSON.stringify(LEGEND_CSV_FIELDS.map(field => entry[field]));
    const group = duplicateGroups.get(duplicateKey) || [];
    group.push(index + 2);
    duplicateGroups.set(duplicateKey, group);
    const hasChanges = !!currentEntry && (entry.label.trim() !== String(currentEntry.label ?? "").trim()
      || (entry.kind === "special-zone" && !sameStyle(entry, currentEntry)));
    return { record: index + 2, entry, comparison, candidates: [...candidates], issues, duplicateKey,
      currentEntry: currentEntry ? { ...currentEntry } : null, hasChanges,
      targetSignature: currentEntry?.targetSignature || (currentEntry?.kind === "color"
        ? getLegendCsvCategorySignature(currentEntry.color, currentEntry.label)
        : currentEntry ? getLegendCsvZoneSignature({ id: currentEntry.entryId.slice("special-zone:".length),
          name: currentEntry.label, style: { fill: currentEntry.color, ...currentEntry } }) : "") };
  });
  const resultRows = rows.map(({ duplicateKey, ...row }) => ({
    ...row, duplicateRecords: duplicateGroups.get(duplicateKey).length > 1 ? [...duplicateGroups.get(duplicateKey)] : [],
    canApply: formatVersion === 2 && row.comparison === "matched" && !row.issues.length
      && duplicateGroups.get(duplicateKey).length === 1 && row.hasChanges,
  }));
  return {
    readOnly: !resultRows.some(row => row.canApply),
    limitation: formatVersion === 1 ? "missing-stable-id" : "scoped-confirmation-required",
    formatVersion, sourceText: text,
    scope: { scenarioId: String(scope.scenarioId || ""), scenarioBaselineHash: String(scope.scenarioBaselineHash || "") },
    rows: resultRows,
    counts: {
      total: resultRows.length,
      matched: resultRows.filter(row => row.comparison === "matched").length,
      unmatched: resultRows.filter(row => row.comparison === "unmatched").length,
      ambiguous: resultRows.filter(row => row.comparison === "ambiguous").length,
      duplicates: resultRows.filter(row => row.duplicateRecords.length).length,
      invalid: resultRows.filter(row => row.issues.length).length,
      invalidColors: resultRows.filter(row => row.issues.includes("invalid-color") || row.issues.includes("invalid-stroke")).length,
      applicable: resultRows.filter(row => row.canApply).length,
      noChanges: formatVersion === 2 ? resultRows.filter(row => row.comparison === "matched" && !row.hasChanges && !row.issues.length).length : 0,
    },
  };
}

function sameStyle(incoming, current) {
  return normalizeHexColor(incoming.color) === normalizeHexColor(current.color)
    && normalizeHexColor(incoming.stroke) === normalizeHexColor(current.stroke)
    && incoming.pattern === current.pattern
    && ["fillOpacity", "strokeOpacity", "patternOpacity", "strokeWidth"].every(field => Number(incoming[field]) === Number(current[field]));
}
