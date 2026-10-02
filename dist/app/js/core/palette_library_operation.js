import { normalizeHexColor } from "./palette_manager.js";

// The composition root supplies history, refresh, and synchronous paint selection.
// Recent-color feedback and the final render follow the applied result.
/**
 * Missing required services throw TypeError at construction, before any edits.
 * The returned operation reports invalid-color/no-target without side effects,
 * or applied after committing the existing synchronous color/history sequence.
 */
export function createPaletteLibraryOperation({
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
    const countryIds = explicitCountry ? getCountryFeatureIds(explicitCountry) : [];
    if (explicitCountry && !countryIds.length) return { status: "no-target" };
    const target = explicitCountry ? { type: "owner", ownerCode: explicitCountry } : getApplyTarget();
    if (!target) return { status: "no-target" };

    selectPaintColor(color);
    const isFeature = target.type === "feature";
    const featureIds = explicitCountry ? countryIds : isFeature
      ? target.featureIds
      : getOwnerFeatureIds(target.ownerCode);
    const historyScope = explicitCountry ? { featureIds, ownerCodes: [explicitCountry] } : isFeature
      ? { featureIds }
      : { ownerCodes: [target.ownerCode] };
    const kind = explicitCountry ? "palette-country-color" : isFeature ? "palette-library-apply-color" : "palette-library-apply-owner-color";
    const before = captureHistoryState(historyScope);
    if (isFeature) {
      applyFeatureColor(featureIds, color);
    } else {
      applyOwnerColor(target.ownerCode, color);
      if (explicitCountry) applyFeatureColor(featureIds, color);
    }

    if (featureIds.length) {
      refreshResolvedColorsForFeatures(featureIds, { renderNow: false });
    } else {
      refreshColorState({ renderNow: false });
    }
    markDirty(kind);
    pushHistoryEntry({
      kind,
      before,
      after: captureHistoryState(historyScope),
      meta: { affectsSovereignty: false },
    });
    return { status: "applied", color, target, ...(explicitCountry ? { featureCount: featureIds.length } : {}) };
  }
  return Object.freeze({ applyColor });
}
