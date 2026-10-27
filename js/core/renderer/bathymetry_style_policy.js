export const COASTLINE_LOD_LOW_ZOOM_MAX = 1.8;
export const COASTLINE_LOD_MID_ZOOM_MAX = 3.2;
export const COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW = 0.0016;
export const COASTLINE_ACCENT_DENSITY_THRESHOLD_MID = 0.0022;
const COASTLINE_OVERLAY_ATLANTROPA_ALPHA = 0.42;
const COASTLINE_OVERLAY_ATLANTROPA_ALPHA_INTERACTIVE = 0.30;
const COASTLINE_OVERLAY_DENSITY_ALPHA_LOW = 0.78;
const COASTLINE_OVERLAY_DENSITY_ALPHA_MID = 0.86;
const COASTLINE_ACCENT_MIN_WIDTH_PX = 0.85;
const COASTLINE_ACCENT_OVERLAY_MIN_WIDTH_PX = 0.95;
export function createBathymetryStylePolicy(runtimeState, {
  getFeatureProjectedDensity,
  getReliefOverlayKind,
}) {
  function getScenarioCoastalAccentLineWidth(k, { interactive = false, overlay = false } = {}) {
    const baseWidth = overlay
      ? 1.22 / Math.max(0.0001, k)
      : (interactive ? 1.05 : 1.28) / Math.max(0.0001, k);
    if (k < COASTLINE_LOD_MID_ZOOM_MAX) {
      return baseWidth;
    }
    return Math.max(baseWidth, (overlay ? COASTLINE_ACCENT_OVERLAY_MIN_WIDTH_PX : COASTLINE_ACCENT_MIN_WIDTH_PX) / Math.max(0.0001, k));
  }

  function isAtlantropaScenarioShorelineOverlay(feature) {
    if (getReliefOverlayKind(feature) !== "new_shoreline") return false;
    return String(feature?.properties?.parent_id || "").trim().toLowerCase().startsWith("atlantropa_");
  }

  function getScenarioCoastalAccentOverlayVisualConfig(feature, k, { interactive = false } = {}) {
    const isAtlantropa = isAtlantropaScenarioShorelineOverlay(feature);
    let alpha = interactive ? 0.38 : 0.62;
    if (isAtlantropa) {
      alpha = interactive
        ? COASTLINE_OVERLAY_ATLANTROPA_ALPHA_INTERACTIVE
        : COASTLINE_OVERLAY_ATLANTROPA_ALPHA;
      if (k < COASTLINE_LOD_MID_ZOOM_MAX) {
        const densityThreshold = k < COASTLINE_LOD_LOW_ZOOM_MAX
          ? COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW
          : COASTLINE_ACCENT_DENSITY_THRESHOLD_MID;
        const densityAlpha = k < COASTLINE_LOD_LOW_ZOOM_MAX
          ? COASTLINE_OVERLAY_DENSITY_ALPHA_LOW
          : COASTLINE_OVERLAY_DENSITY_ALPHA_MID;
        if (getFeatureProjectedDensity(feature) > densityThreshold) {
          alpha *= densityAlpha;
        }
      }
    }
    return {
      alpha,
      lineWidth: getScenarioCoastalAccentLineWidth(k, { interactive, overlay: true }),
    };
  }

  return Object.freeze({ getScenarioCoastalAccentLineWidth, getScenarioCoastalAccentOverlayVisualConfig });
}
