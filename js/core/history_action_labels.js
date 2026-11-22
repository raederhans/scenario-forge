import { t } from "./i18n.js";
import { getLocalizedScenarioCountryName } from "./scenario/scenario_country_display.js";
import { state } from "./state.js";

const paintKinds = new Set([
  "fill-feature-color", "fill-country-color", "fill-country-batch", "fill-parent-group", "brush-fill",
  "dev-batch-fill", "dev-fill-country", "dev-fill-parent-group", "dev-fill-owner-scope", "dev-fill-selection",
  "fill-water-region-color", "inspector-water-region-color", "batch-water-region-color", "river-cell-fill",
  "feature-apply-color", "hierarchy-apply-color", "preset-apply-color", "palette-library-apply-color",
  "scenario-country-visual-fill", "scenario-core-apply-visual", "scenario-hierarchy-apply-visual", "scenario-preset-apply-visual",
]);
const eraseKinds = new Set([
  "erase-feature-color", "erase-country-color", "brush-erase", "feature-clear-color",
  "dev-batch-fill-erase", "dev-fill-country-erase", "dev-fill-parent-group-erase", "dev-fill-owner-scope-erase", "dev-fill-selection-erase",
  "erase-water-region-color", "clear-water-region-color", "clear-batch-water-region-color", "river-cell-erase",
  "scenario-country-visual-clear", "scenario-core-clear-visual",
]);

const actionNames = {
  "merge-project-paint": "Merge project paint: {name}",
  "set-country-capital": "Set capital to {name}",
  "hide-country-capital": "Clear capital",
  "reset-country-capital": "Restore scenario capital",
  "place-project-capital": "Place capital",
  "remove-project-city": "Delete project city",
  "register-project-country": "Register new country {name}",
  "unregister-project-country": "Unregister {name}",
  "recolor-project-country": "Change {name} color",
  "rename-project-country": "Rename country to {name}",
  "interaction": "Edit map",
  "country-name": "Rename country",
  "city-name": "Rename city",
  "map-title": "Edit map title",
  "legend-appearance": "Change legend appearance",
  "annotation-visibility": "Change annotation visibility",
  "replace-color": "Replace color",
  "reset-country-overrides": "Reset country overrides",
  "country-override-reset": "Reset country overrides",
  "auto-fill": "Auto-fill map",
  "auto-fill-political": "Auto-Fill Countries",
  "auto-fill-region": "Auto-fill regions",
  "place-map-label": "Place map label",
  "edit-map-label": "Edit map label",
  "move-map-label": "Move map label",
  "delete-map-label": "Delete map label",
  "place-unit-counter": "Place unit counter",
  "update-unit-counter": "Edit unit counter",
  "move-unit-counter": "Move unit counter",
  "delete-unit-counter": "Delete unit counter",
  "add-scenario-defense-lines": "Add scenario defense lines",
  "create-operational-line": "Create operational line",
  "update-operational-line": "Edit operational line",
  "delete-operational-line": "Delete operational line",
  "finish-operation-graphic": "Draw operation graphic",
  "delete-operation-graphic": "Delete operation graphic",
  "update-operation-graphic": "Edit operation graphic",
  "delete-operation-graphic-vertex": "Delete graphic vertex",
  "insert-operation-graphic-vertex": "Insert graphic vertex",
  "move-operation-graphic-vertex": "Move graphic vertex",
  "appearance-preset-save": "Save appearance preset",
  "appearance-preset-select": "Select appearance preset",
  "appearance-preset-apply": "Apply appearance preset",
  "appearance-preset-delete": "Delete appearance preset",
  "appearance-preset-import": "Import appearance preset",
  "physical-intensity-point": "Place intensity point",
  "physical-intensity-brush": "Brush intensity field",
  "lake-style": "Edit lake style",
  "lake-link": "Change lake color link",
  "lake-outline": "Change lake outline",
  "lake-fill": "Change lake fill",
  "ocean-region-names": "Change ocean region names display",
  "special-zone-layer-add": "Add zone layer",
  "special-zone-layer-delete": "Delete zone layer",
  "special-zone-layer-duplicate": "Duplicate zone layer",
  "special-zone-layer-name": "Rename zone layer",
  "special-zone-layer-visible": "Change zone visibility",
  "special-zone-active-layer": "Select zone layer",
  "special-zone-layer-category": "Change zone category",
  "special-zone-layer-style": "Change zone style",
  "special-zone-layer-legend": "Change zone legend visibility",
  "special-zone-layer-reorder": "Reorder zone layers",
  "special-zone-layers": "Edit zone layers",
  "special-zone-members-clear": "Clear zone members",
  "special-zone-members-remove": "Remove zone members",
  "special-zone-membership-remove": "Remove zone members",
  "special-zone-membership-drag-remove": "Remove zone members",
  "special-zone-members-subtract": "Remove zone members",
  "special-zone-members-add-country": "Add zone members",
  "special-zone-members-add-group": "Add zone members",
  "special-zone-members-add-selection": "Add zone members",
  "special-zone-members-batch-add": "Add zone members",
  "special-zone-members-union": "Add zone members",
  "special-zone-membership-add": "Add zone members",
  "special-zone-membership-drag-add": "Add zone members",
  "special-zone-members-batch-replace": "Replace zone members",
  "special-zone-members-replace-selection": "Replace zone members",
  "special-zone-membership-replace": "Replace zone members",
  "special-zone-membership-toggle": "Toggle zone membership",
  "special-zone-members-intersect": "Intersect zone members",
  "special-zone-members-copy": "Copy zone members",
  "texture-mode": "Change texture style",
  "texture-style": "Change texture style",
  "texture-opacity": "Change texture opacity",
  "texture-paper-scale": "Change paper texture",
  "texture-paper-warmth": "Change paper texture",
  "texture-paper-grain": "Change paper texture",
  "texture-paper-wear": "Change paper texture",
  "texture-graticule-major": "Change graticule style",
  "texture-graticule-minor": "Change graticule style",
  "texture-graticule-label": "Change graticule style",
  "texture-graticule-color": "Change graticule style",
  "texture-graticule-label-color": "Change graticule style",
  "texture-graticule-label-size": "Change graticule style",
  "texture-graticule-major-width": "Change graticule style",
  "texture-graticule-minor-width": "Change graticule style",
  "texture-graticule-major-opacity": "Change graticule style",
  "texture-graticule-minor-opacity": "Change graticule style",
  "texture-draft-major": "Change drafting grid",
  "texture-draft-minor": "Change drafting grid",
  "texture-draft-longitude": "Change drafting grid",
  "texture-draft-latitude": "Change drafting grid",
  "texture-draft-roll": "Change drafting grid",
  "texture-draft-color": "Change drafting grid",
  "texture-draft-width": "Change drafting grid",
  "texture-draft-major-opacity": "Change drafting grid",
  "texture-draft-minor-opacity": "Change drafting grid",
  "texture-draft-dash": "Change drafting grid",
};

export function getHistoryActionLabel(direction, entry) {
  const kind = entry?.kind ?? entry?.meta?.kind;
  let action;
  if (paintKinds.has(kind) || eraseKinds.has(kind)) {
    let count = 0;
    for (const field of ["visualOverrides", "waterRegionOverrides", "riverPaintOverrides"]) {
      const before = entry.before[field] || {};
      const after = entry.after[field] || {};
      for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
        if ((before[id] ?? null) !== (after[id] ?? null)) count++;
      }
    }
    action = t(paintKinds.has(kind) ? "Paint {count} regions" : "Erase paint from {count} regions", "ui", { count });
  } else if (["inspector-country-color", "palette-country-color", "palette-library-apply-owner-color"].includes(kind)) {
    const [code] = Object.keys(entry.after.sovereignBaseColors);
    const country = getLocalizedScenarioCountryName(state.scenarioCountriesByTag?.[code], state.countryNames?.[code] || code, t);
    action = t("Change {country} color", "ui", { country });
  } else if (kind === "clear-map" || kind === "reset-country-colors") {
    action = t(kind === "clear-map" ? "Clear Map" : "Reset Country Colors", "ui");
  } else if (Object.hasOwn(actionNames, kind)) {
    action = t(actionNames[kind], "ui", entry.meta);
  } else if (entry?.label) {
    action = t(entry.label, "ui");
  }
  if (!direction) return action || t("Edit map", "ui");
  return action ? t(direction === "Undo" ? "Undo: {action}" : "Redo: {action}", "ui", { action }) : t(direction, "ui");
}
