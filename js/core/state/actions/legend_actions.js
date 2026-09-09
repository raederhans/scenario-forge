// Canonical legend writes. Pure normalization is shared with LegendManager;
// palette-owned fields continue to delegate to their existing owner.
import { patchLegendPaletteState } from "./scenario_palette_actions.js";
import { normalizeLabels, normalizeLegendConfig, normalizeLegendControl, normalizeColorOrder,
  DEFAULT_LEGEND_CONFIG, DEFAULT_LEGEND_CONTROL } from "../../legend_state_normalizers.js";

export function ensureLegendState(target) {
  if (!target) return null;
  patchLegendState(target, {
    legendLabels: normalizeLabels(Object.hasOwn(target, "legendLabels") ? target.legendLabels : {}),
    legendConfig: normalizeLegendConfig(Object.hasOwn(target, "legendConfig") ? target.legendConfig : DEFAULT_LEGEND_CONFIG),
    legendControl: normalizeLegendControl(Object.hasOwn(target, "legendControl") ? target.legendControl : DEFAULT_LEGEND_CONTROL),
    legendColorOrder: normalizeColorOrder(target.legendColorOrder),
  });
}

export function patchLegendState(target, patch = {}) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[legend_actions] target must be an object");
  }
  patchLegendPaletteState(target, Object.fromEntries(Object.entries(patch)));
  if (Object.hasOwn(patch, "legendControl")) target.legendControl = { ...patch.legendControl };
  if (Object.hasOwn(patch, "legendColorOrder")) target.legendColorOrder = [...patch.legendColorOrder];
}

export function setLegendLabelState(target, color, text) {
  const labels = Object.fromEntries(Object.entries(target.legendLabels || {}));
  if (text) labels[color] = text;
  else delete labels[color];
  patchLegendState(target, { legendLabels: labels });
}
