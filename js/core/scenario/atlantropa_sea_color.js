import { getSafeCanvasColor } from "../renderer/canvas_color_helpers.js";
import { normalizeScenarioOceanFillColor } from "./pure_helpers.js";

export function resolveAtlantropaSeaFillColor(manifest, oceanFillColor) {
  const defaultOcean = normalizeScenarioOceanFillColor(manifest?.style_defaults?.ocean?.fillColor, "");
  if (!defaultOcean || normalizeScenarioOceanFillColor(oceanFillColor, "") !== defaultOcean) {
    return oceanFillColor;
  }
  return getSafeCanvasColor(manifest?.style_defaults?.atlantropa_sea?.fillColor, oceanFillColor);
}
