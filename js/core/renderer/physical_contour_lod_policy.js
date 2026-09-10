import { normalizePhysicalStyleConfig } from "../state_defaults.js";

const MINOR_ZOOM_BY_PRESET = Object.freeze({
  balanced: 3.2,
  terrain_rich: 4,
  political_clean: 2.6,
});

export function resolveContourLodRequest(state = {}) {
  const k = Number(state.zoomTransform?.k) || 1;
  const physical = normalizePhysicalStyleConfig(state.styleConfig?.physical || {});
  const preset = String(physical.preset || "balanced").trim().toLowerCase();
  const minorZoom = Number(MINOR_ZOOM_BY_PRESET[preset] ?? 3.2);
  if (k < 1.4) return ["physical_contours_low_major"];
  if (k < 4) {
    const requestedMinorInterval = Number(physical.contourMinorIntervalM ?? 200);
    const canUseMidMinor = Number.isFinite(requestedMinorInterval)
      && requestedMinorInterval >= 200
      && requestedMinorInterval % 200 === 0;
    return physical.contourMinorVisible === true && k >= minorZoom
      ? (canUseMidMinor
        ? ["physical_contours_mid_major", "physical_contours_mid_minor"]
        : ["physical_contours_mid_major", "physical_contours_minor"])
      : ["physical_contours_mid_major"];
  }
  const includeMinor = physical.contourMinorVisible === true && k >= minorZoom;
  return includeMinor
    ? ["physical_contours_major", "physical_contours_minor"]
    : ["physical_contours_major"];
}
