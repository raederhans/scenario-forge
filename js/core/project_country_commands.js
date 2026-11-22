import { normalizeHexColor } from "./color_hex_utils.js";
import { getCountryNameOverride, setCountryNameOverride } from "./country_name_overrides.js";
import { markDirty } from "./dirty_state.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import { t } from "./i18n.js";
import { allocateProjectCountryTag, isProjectCountry, registerProjectCountryState, unregisterProjectCountryState } from "./project_countries.js";
import { flushRenderBoundary } from "./render_boundary.js";
import { applyColorReplacement, replacementScope } from "./replace_color_command.js";
import { getRiverPartitionIndex } from "./river_paint/partition_model.js";
import { getRiverPaintRuntime } from "./river_paint/runtime.js";
import { getLocalizedScenarioCountryName } from "./scenario/scenario_country_display.js";
import { state } from "./state.js";
import { commitChange } from "./state/changes.js";
import { callRuntimeHook } from "./state/index.js";

function displayName(tag) {
  return getCountryNameOverride(state, tag) || getLocalizedScenarioCountryName(state.scenarioCountriesByTag[tag]);
}

function finishEdit(kind, name, scope, before) {
  pushHistoryEntry({ kind, before, after: captureHistoryState(scope), meta: { scenarioId: state.activeScenarioId, name } });
  markDirty(kind);
  commitChange({ domains: ["countryList", "inspector", "legend", "presetTree", "strategicOverlays", "activeSovereign"], reason: kind });
}

export function registerColorAsProjectCountry(color, { name } = {}) {
  const hex = normalizeHexColor(color);
  if (!state.activeScenarioId || !hex) return false;
  const paint = replacementScope(state, hex);
  const matches = (id, feature) => callRuntimeHook(state, "resolveBorderIdentityFn", id, feature) === `color:${hex}`;
  if (!paint.featureIds.some(id => matches(id, state.landIndex?.get(id)))
    && !paint.riverCellIds.some(id => matches(id, getRiverPaintRuntime(state).getCellFeature(id)))) return false;
  const tag = allocateProjectCountryTag(state);
  if (!tag) return false;
  const countryName = name?.trim() || state.legendLabels?.[hex] || t("New country {n}", "ui", {
    n: Number(tag.slice(1)) + (tag.startsWith("Q") ? 99 : 0),
  });
  const scope = { ownerCodes: [tag], projectCountries: [tag] };
  const before = captureHistoryState(scope);
  registerProjectCountryState(state, { tag, color: hex, name: countryName });
  const cells = getRiverPartitionIndex(state.riverPaint?.pack)?.cells;
  const featureIds = [...new Set([...paint.featureIds, ...paint.riverCellIds.map(id => cells.get(id).parentId)])];
  callRuntimeHook(state, "refreshColorStateFn", { renderNow: true, ...(paint.featureIds.length ? { featureIds } : {}) });
  finishEdit("register-project-country", countryName, scope, before);
  state.selectedInspectorCountryCode = tag;
  return tag;
}

export function unregisterProjectCountry(tag) {
  if (!state.activeScenarioId || !isProjectCountry(state, tag)) return false;
  const name = displayName(tag);
  const scope = { ownerCodes: [tag], projectCountries: [tag] };
  const before = captureHistoryState(scope);
  unregisterProjectCountryState(state, tag);
  callRuntimeHook(state, "refreshColorStateFn", { renderNow: true });
  finishEdit("unregister-project-country", name, scope, before);
  return true;
}

export function recolorProjectCountry(tag, nextColor) {
  if (!state.activeScenarioId || !isProjectCountry(state, tag)) return false;
  const color = normalizeHexColor(nextColor);
  const oldColor = state.sovereignBaseColors[tag];
  if (!color || color === oldColor || Object.keys(state.scenarioCountriesByTag).some(other =>
    other !== tag && normalizeHexColor(state.sovereignBaseColors[other]) === color)) return false;
  const scope = { ...replacementScope(state, oldColor), ownerCodes: [tag], projectCountries: [tag] };
  const before = captureHistoryState(scope);
  registerProjectCountryState(state, { tag, color, name: state.scenarioCountriesByTag[tag].display_name });
  applyColorReplacement(state, scope, oldColor, color);
  callRuntimeHook(state, "refreshColorStateFn", { renderNow: true });
  finishEdit("recolor-project-country", displayName(tag), scope, before);
  return true;
}

export function renameProjectCountry(tag, name) {
  if (!state.activeScenarioId || !isProjectCountry(state, tag)) return false;
  const oldName = displayName(tag);
  const scope = { countryNameOverrides: true, legend: true };
  const before = captureHistoryState(scope);
  if (!setCountryNameOverride(state, tag, state.currentLanguage, name)) return false;
  const next = displayName(tag);
  const color = state.sovereignBaseColors[tag];
  if (state.legendLabels?.[color] === oldName) state.legendLabels = { ...state.legendLabels, [color]: next };
  flushRenderBoundary("rename-project-country");
  finishEdit("rename-project-country", next, scope, before);
  return true;
}
