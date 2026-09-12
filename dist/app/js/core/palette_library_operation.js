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
  applyFeatureColor,
  applyOwnerColor,
  captureHistoryState,
  pushHistoryEntry,
  markLegacyColorStateDirty,
  refreshResolvedColorsForFeatures,
  refreshColorState,
  markDirty,
  selectPaintColor,
}) {
  for (const [name, service] of Object.entries({
    captureHistoryState,
    pushHistoryEntry,
    markLegacyColorStateDirty,
    refreshResolvedColorsForFeatures,
    refreshColorState,
    markDirty,
    selectPaintColor,
    getApplyTarget,
    getOwnerFeatureIds,
    applyFeatureColor,
    applyOwnerColor,
  })) {
    if (typeof service !== "function") {
      throw new TypeError(`[palette_library_operation] ${name} must be a function`);
    }
  }
  function applyColor(rawColor) {
    const color = normalizeHexColor(rawColor);
    if (!color) return { status: "invalid-color" };
    const target = getApplyTarget();
    if (!target) return { status: "no-target" };

    selectPaintColor(color);
    const isFeature = target.type === "feature";
    const featureIds = isFeature
      ? target.featureIds
      : getOwnerFeatureIds(target.ownerCode);
    const historyScope = isFeature
      ? { featureIds }
      : { ownerCodes: [target.ownerCode] };
    const kind = isFeature ? "palette-library-apply-color" : "palette-library-apply-owner-color";
    const before = captureHistoryState(historyScope);
    if (isFeature) {
      applyFeatureColor(featureIds, color);
    } else {
      applyOwnerColor(target.ownerCode, color);
    }
    markLegacyColorStateDirty();
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
    return { status: "applied", color, target };
  }
  return Object.freeze({ applyColor });
}
