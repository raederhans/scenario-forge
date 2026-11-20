import { t } from "./i18n.js";
import { getLocalizedScenarioCountryName } from "./scenario/scenario_country_display.js";
import { state } from "./state.js";

const paintKinds = new Set([
  "fill-feature-color", "fill-country-color", "fill-country-batch", "fill-parent-group", "brush-fill",
  "feature-apply-color", "hierarchy-apply-color", "preset-apply-color", "palette-library-apply-color",
  "scenario-country-visual-fill", "scenario-core-apply-visual", "scenario-hierarchy-apply-visual", "scenario-preset-apply-visual",
]);
const eraseKinds = new Set([
  "erase-feature-color", "erase-country-color", "brush-erase", "feature-clear-color",
  "scenario-country-visual-clear", "scenario-core-clear-visual",
]);

export function getHistoryActionLabel(direction, entry) {
  const kind = entry?.kind;
  let action;
  if (paintKinds.has(kind) || eraseKinds.has(kind)) {
    const before = entry.before.visualOverrides || {};
    const after = entry.after.visualOverrides || {};
    const ids = new Set([...Object.keys(before), ...Object.keys(after)]);
    let count = 0;
    for (const id of ids) {
      if ((before[id] ?? null) !== (after[id] ?? null)) count++;
    }
    action = t(paintKinds.has(kind) ? "Paint {count} regions" : "Erase paint from {count} regions", "ui", { count });
  } else if (["inspector-country-color", "palette-country-color", "palette-library-apply-owner-color"].includes(kind)) {
    const [code] = Object.keys(entry.after.sovereignBaseColors);
    const country = getLocalizedScenarioCountryName(state.scenarioCountriesByTag?.[code], state.countryNames?.[code] || code, t);
    action = t("Change {country} color", "ui", { country });
  } else if (kind === "clear-map" || kind === "reset-country-colors") {
    action = t(kind === "clear-map" ? "Clear Map" : "Reset Country Colors", "ui");
  }
  return action ? t(direction === "Undo" ? "Undo: {action}" : "Redo: {action}", "ui", { action }) : t(direction, "ui");
}
