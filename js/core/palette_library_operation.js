import { applyColorReplacement, withCountryColorReplacement } from "./replace_color_command.js";
import { normalizeHexColor } from "./palette_manager.js";
import { getLegendPaintColors } from "./legend_state_normalizers.js";
import { getMapDataBoundary } from "./map_data_boundary.js";
import { migrateLegendColorState } from "./state/actions/legend_actions.js";
import { createPaletteOwnerResolver } from "./palette_country_targets.js";
import { isProjectCountry } from "./project_countries.js";
import { recolorProjectCountry } from "./project_country_commands.js";
import { getCountryLocateIds } from "./country_override_reset_command.js";

// The composition root supplies history, refresh, and synchronous paint selection.
// Recent-color feedback and the final render follow the applied result.
/**
 * Missing required services throw TypeError at construction, before any edits.
 * The returned operation reports invalid-color/no-target without side effects,
 * or applied after committing the color/history sequence.
 */
export function createPaletteLibraryOperation({
  state,
  dialog,
  getApplyTarget,
  getOwnerFeatureIds,
  getCountryFeatureIds = getOwnerFeatureIds,
  applyFeatureColor,
  applyOwnerColor,
  captureHistoryState,
  pushHistoryEntry,

  refreshResolvedColorsForFeatures,
  refreshColorState,
  markDirty,
  selectPaintColor,
}) {
  for (const [name, service] of Object.entries({
    captureHistoryState,
    pushHistoryEntry,

    refreshResolvedColorsForFeatures,
    refreshColorState,
    markDirty,
    selectPaintColor,
    getApplyTarget,
    getOwnerFeatureIds,
    getCountryFeatureIds,
    applyFeatureColor,
    applyOwnerColor,
  })) {
    if (typeof service !== "function") {
      throw new TypeError(`[palette_library_operation] ${name} must be a function`);
    }
  }
  function applyColor(rawColor, { countryCode = "" } = {}) {
    const color = normalizeHexColor(rawColor);
    if (!color) return { status: "invalid-color" };
    const explicitCountry = String(countryCode || "").trim().toUpperCase();
    const target = explicitCountry ? { type: "owner", ownerCode: explicitCountry } : getApplyTarget();
    if (!target) return { status: "no-target" };
    if (target.type === "owner" && isProjectCountry(state, target.ownerCode)) {
      if (!recolorProjectCountry(target.ownerCode, color)) return { status: "no-target" };
      selectPaintColor(color);
      return { status: "applied", color, target, ...(explicitCountry
        ? { featureCount: getCountryLocateIds(state, explicitCountry).length, preservedCount: 0 } : {}) };
    }
    const countryIds = explicitCountry ? getCountryFeatureIds(explicitCountry) : [];
    if (explicitCountry && !countryIds.length) return { status: "no-target" };

    selectPaintColor(color);
    const isFeature = target.type === "feature";
    const resolveOwner = explicitCountry && createPaletteOwnerResolver(state);
    const featureIds = explicitCountry ? countryIds.filter(id => resolveOwner(id) === explicitCountry) : isFeature
      ? target.featureIds
      : getOwnerFeatureIds(target.ownerCode);
    const oldColor = !isFeature && normalizeHexColor(state.sovereignBaseColors?.[target.ownerCode]
      || state.countryPalette?.[target.ownerCode]
      || state.resolvedDefaultCountryPalette?.[target.ownerCode]
      || state.colors?.[featureIds[0]]);
    return withCountryColorReplacement(state, target.ownerCode, oldColor, color, commit, dialog, countryIds);

    function commit(replacement) {
      const historyScope = { ...replacement };
      if (!isFeature) historyScope.ownerCodes = [target.ownerCode];
      if (explicitCountry || isFeature) {
        historyScope.featureIds = replacement ? [...new Set([...featureIds, ...replacement.featureIds])] : featureIds;
      }
      const kind = replacement ? "replace-color" : explicitCountry ? "palette-country-color"
        : isFeature ? "palette-library-apply-color" : "palette-library-apply-owner-color";
      const before = captureHistoryState(historyScope);
      if (isFeature) {
        applyFeatureColor(featureIds, color);
      } else {
        applyOwnerColor(target.ownerCode, color);
        if (explicitCountry) applyFeatureColor(featureIds, color);
      }

      if (replacement) {
        applyColorReplacement(state, replacement, oldColor, color);
        refreshColorState({ renderNow: false });
      } else if (featureIds.length) {
        refreshResolvedColorsForFeatures(featureIds, { renderNow: false });
      } else {
        refreshColorState({ renderNow: false });
      }
      if (!replacement && oldColor && oldColor !== color && (state.legendLabels?.[oldColor] || state.legendColorOrder?.includes(oldColor))) {
        const boundary = getMapDataBoundary(state);
        const used = getLegendPaintColors(state).has(oldColor) || boundary.reference.getScenarioFeatureIds().some(id =>
          !Object.hasOwn(state.colors || {}, id) && boundary.paint.resolveFeatureColor(id).color === oldColor);
        if (!used) {
          Object.assign(before, captureHistoryState({ legend: true }));
          historyScope.legend = true;
          migrateLegendColorState(state, oldColor, color);
        }
      }
      markDirty(kind);
      pushHistoryEntry({
        kind,
        before,
        after: captureHistoryState(historyScope),
        meta: { affectsSovereignty: false },
      });
      return { status: "applied", color, target, ...(explicitCountry ? { featureCount: featureIds.length, preservedCount: countryIds.length - featureIds.length } : {}) };
    }
  }
  return Object.freeze({ applyColor });
}
