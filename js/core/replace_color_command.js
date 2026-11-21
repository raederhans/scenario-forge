import { normalizeHexColor } from "./color_hex_utils.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import { markDirty } from "./dirty_state.js";
import { state } from "./state.js";
import { callRuntimeHook } from "./state/index.js";
import { migrateLegendColorState } from "./state/actions/legend_actions.js";
import { restoreRiverPaintOverridesState } from "./state/actions/river_paint_actions.js";
import { t } from "./i18n.js";
import { getLocalizedScenarioCountryName } from "./scenario/scenario_country_display.js";

function matchingIds(overrides, color) {
  return Object.keys(overrides || {}).filter(id => normalizeHexColor(overrides[id]) === color);
}

function replacementScope(target, oldColor) {
  return {
    featureIds: matchingIds(target.visualOverrides, oldColor),
    riverCellIds: matchingIds(target.riverPaint?.overrides, oldColor),
    legend: !!(target.legendLabels?.[oldColor] || target.legendColorOrder?.includes(oldColor)),
  };
}

// 核心层不能导入 UI；没有注册弹框时按"不替换"处理。
function showRuntimeDialog(options) {
  return Promise.resolve(callRuntimeHook(state, "showAppDialogFn", options) ?? false);
}

export function withCountryColorReplacement(target, country, oldColor, newColor, commit, dialog = showRuntimeDialog, countryIds = []) {
  if (!oldColor || oldColor === newColor) return commit(null);
  const scope = replacementScope(target, oldColor);
  if (countryIds.length && scope.featureIds.length) {
    const members = new Set(countryIds);
    scope.featureIds = scope.featureIds.filter(id => !members.has(id));
  }
  if (!scope.featureIds.length) return commit(null);
  const message = t("Also update {count} regions painted in {country}'s old color?", "ui", {
    count: scope.featureIds.length,
    country: getLocalizedScenarioCountryName(target.scenarioCountriesByTag?.[country], target.countryNames?.[country] || country, t),
  });
  return dialog({ message }).then(confirmed => commit(confirmed ? scope : null));
}

export function applyColorReplacement(target, scope, oldColor, newColor) {
  for (const id of scope.featureIds) target.visualOverrides[id] = newColor;
  if (scope.riverCellIds.length) {
    restoreRiverPaintOverridesState(target, Object.fromEntries(scope.riverCellIds.map(id => [id, newColor])));
  }
  if (scope.legend) migrateLegendColorState(target, oldColor, newColor);
}

export function replaceFeatureColor(oldHex, newHex) {
  const oldColor = normalizeHexColor(oldHex);
  const color = normalizeHexColor(newHex);
  if (!oldColor || !color || oldColor === color) return;
  const scope = replacementScope(state, oldColor);
  if (!scope.featureIds.length && !scope.riverCellIds.length && !scope.legend) return;
  const before = captureHistoryState(scope);
  applyColorReplacement(state, scope, oldColor, color);
  callRuntimeHook(state, "refreshColorStateFn", { renderNow: true });
  markDirty("replace-color");
  pushHistoryEntry({ kind: "replace-color", before, after: captureHistoryState(scope), meta: { affectsSovereignty: false } });
}
