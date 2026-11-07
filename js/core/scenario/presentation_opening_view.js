import {
  focusGeoBounds as rendererFocusGeoBounds,
  resetZoomToFit as rendererResetZoomToFit,
} from "../map_renderer/public.js";

export function applyScenarioOpeningView(manifest, {
  animate = false,
  focusGeoBounds = rendererFocusGeoBounds,
  resetZoomToFit = rendererResetZoomToFit,
} = {}) {
  if (manifest?.opening_view === undefined) {
    return resetZoomToFit({ animate });
  }
  const bounds = manifest.opening_view?.bounds;
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every(Number.isFinite)) return;
  const [west, south, east, north] = bounds;
  if (west < -180 || east > 180 || south < -90 || north > 90 || west >= east || south >= north) return;
  return focusGeoBounds(bounds, { animate });
}
