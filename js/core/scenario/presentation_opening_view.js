import { isRegionalScenario, isValidScenarioBounds } from "./scenario_region.js";
import {
  focusGeoBounds as rendererFocusGeoBounds,
  resetZoomToFit as rendererResetZoomToFit,
} from "../map_renderer/public.js";

export function applyScenarioOpeningView(manifest, {
  animate = false,
  suppressRender = false,
  focusGeoBounds = rendererFocusGeoBounds,
  resetZoomToFit = rendererResetZoomToFit,
} = {}) {
  if (manifest?.opening_view === undefined) {
    return resetZoomToFit({ animate });
  }
  const bounds = manifest.opening_view?.bounds;
  if (!isValidScenarioBounds(bounds, isRegionalScenario(manifest))) return;
  return focusGeoBounds(bounds, suppressRender ? { animate, suppressRender } : { animate });
}

export function applyGlobalScenarioOpeningView(manifest, options) {
  if (!isRegionalScenario(manifest)) return applyScenarioOpeningView(manifest, options);
}
