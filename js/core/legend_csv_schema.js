import { normalizeHexColor } from "./color_hex_utils.js";
import { createSpecialZoneLayerStyle } from "./special_zone_layers.js";
import { getUniqueLegendColors } from "./legend_state_normalizers.js";

// Shared CSV/history metadata; canonical action modules export writes only.
export const SPECIAL_ZONE_LEGEND_STYLE_KEYS = Object.freeze([
  "fill", "stroke", "pattern", "fillOpacity", "strokeOpacity", "patternOpacity", "strokeWidth", "revision",
]);

export const LEGEND_CSV_FIELDS = Object.freeze([
  "kind", "label", "color", "pattern", "stroke", "fillOpacity", "strokeOpacity", "patternOpacity",
]);
export const LEGEND_CSV_V2_FIELDS = Object.freeze([
  "schemaVersion", "scenarioId", "scenarioBaselineHash", "entryId", ...LEGEND_CSV_FIELDS, "strokeWidth",
]);

export function getLegendCsvEntryId(kind, value) {
  if (kind === "color") {
    const color = normalizeHexColor(value);
    return color ? `category:${color}` : "";
  }
  // Only explicit canonical IDs qualify; never synthesize one from position.
  return kind === "special-zone" && typeof value === "string" && value && value === value.trim()
    ? `special-zone:${value}` : "";
}

export function encodeLegendCsvValue(value, reversible = false) {
  const text = String(value ?? "");
  return (/^[\s\u0000-\u001f]*[=+@-]/u.test(text) || (reversible && text.startsWith("'"))) ? `'${text}` : text;
}

export function decodeLegendCsvValue(value) {
  return value.startsWith("'") ? value.slice(1) : value;
}

export function getLegendCsvCategorySignature(color, label, present = true) {
  return JSON.stringify([getLegendCsvEntryId("color", color), present, typeof label, label]);
}

export function getLegendCsvZoneSignature(layer) {
  const keys = ["fill", "stroke", "pattern", "fillOpacity", "strokeOpacity", "patternOpacity", "strokeWidth", "revision"];
  return JSON.stringify([layer.id, layer.name ?? null, layer.source ?? null, layer.presetId ?? null,
    layer.visible ?? null, layer.legendVisible ?? null, layer.memberFeatureIds ?? null,
    keys.map(key => Object.hasOwn(layer.style || {}, key) ? layer.style[key] : null)]);
}

/** Read raw canonical identities before any layer normalizer can deduplicate them. */
export function buildLegendCsvCurrentModel(target) {
  const entries = getUniqueLegendColors(target).map(color => {
    const rawLabel = target.legendLabels?.[color];
    const label = String(rawLabel ?? "");
    return { kind: "color", entryId: getLegendCsvEntryId("color", color), label,
      color, stroke: "#64748b", pattern: "solid", fillOpacity: 1, strokeOpacity: 1, patternOpacity: 1, strokeWidth: 1,
      targetSignature: getLegendCsvCategorySignature(color, rawLabel, Object.hasOwn(target.legendLabels || {}, color)) };
  });
  for (const layer of target.specialZoneLayers?.layers || []) {
    if (!layer || typeof layer !== "object") continue;
    const style = createSpecialZoneLayerStyle(layer.style);
    entries.push({ kind: "special-zone", entryId: getLegendCsvEntryId("special-zone", layer.id),
      label: String(layer.name ?? ""), color: style.fill, stroke: style.stroke, pattern: style.pattern,
      fillOpacity: style.fillOpacity, strokeOpacity: style.strokeOpacity, patternOpacity: style.patternOpacity,
      strokeWidth: style.strokeWidth, targetSignature: getLegendCsvZoneSignature(layer) });
  }
  return { entries, scenarioId: String(target.activeScenarioId || ""),
    scenarioBaselineHash: String(target.scenarioBaselineHash || ""), language: target.currentLanguage };
}
