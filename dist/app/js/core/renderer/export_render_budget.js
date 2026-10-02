import {
  RENDER_PASS_OVERSCAN_RATIO_PER_SIDE,
  TRANSFORMED_FRAME_PASS_NAMES,
} from "../map_renderer/render_pass_catalog.js";

// Pass canvases coexist until the user-selected layer order has been composited.
// Leave room for the source, adjusted image, SVG working copy, and scenario layers.
export const EXPORT_RENDER_BUDGET_BYTES = 640 * 1024 * 1024;

export function estimateExportRenderBytes({ width, height, pixelRatio, passNames = [], physicalIntensity = false, bathymetryCoverage = false, riverInternalContours = false } = {}) {
  const logicalWidth = Math.max(1, Number(width) || 1);
  const logicalHeight = Math.max(1, Number(height) || 1);
  const ratio = Math.max(1, Number(pixelRatio) || 1);
  const targetPixels = Math.round(logicalWidth * ratio) * Math.round(logicalHeight * ratio);
  let passPixels = 0;
  let physicalPixels = 0;
  let bathymetryPixels = 0;
  let riverContourPixels = 0;
  for (const passName of new Set(passNames)) {
    const overscan = TRANSFORMED_FRAME_PASS_NAMES.includes(passName)
      ? RENDER_PASS_OVERSCAN_RATIO_PER_SIDE
      : 0;
    const passWidth = Math.floor((logicalWidth + 2 * Math.ceil(logicalWidth * overscan)) * ratio);
    const passHeight = Math.floor((logicalHeight + 2 * Math.ceil(logicalHeight * overscan)) * ratio);
    passPixels += passWidth * passHeight;
    if (passName === "background") bathymetryPixels = passWidth * passHeight;
    if (passName === "borders") riverContourPixels = passWidth * passHeight;
    if (passName === "physicalBase" || passName === "contextBase") physicalPixels = Math.max(physicalPixels, passWidth * passHeight);
  }
  // Context scenario can retain separate water, special-region, and relief canvases.
  const scenarioPixels = passNames.includes("contextScenario")
    ? 3 * Math.floor((logicalWidth + 2 * Math.ceil(logicalWidth * RENDER_PASS_OVERSCAN_RATIO_PER_SIDE)) * ratio)
      * Math.floor((logicalHeight + 2 * Math.ceil(logicalHeight * RENDER_PASS_OVERSCAN_RATIO_PER_SIDE)) * ratio)
    : 0;
  const physicalScratchBytes = physicalIntensity ? physicalPixels * 8 + (physicalPixels <= 2_000_000 ? physicalPixels * 8 : 0) : 0;
  const bathymetryScratchBytes = bathymetryCoverage ? bathymetryPixels * 8 : 0;
  const riverContourScratchBytes = riverInternalContours ? riverContourPixels * 4 : 0;
  return (passPixels + scenarioPixels + 3 * targetPixels) * 4 + physicalScratchBytes + bathymetryScratchBytes + riverContourScratchBytes;
}
