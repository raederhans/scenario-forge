export const RENDER_PASS_NAMES = [
  "background",
  "physicalBase",
  "political",
  "populationHeatmap",
  "hgoPreview",
  "contextBase",
  "contextScenario",
  "effects",
  "lineEffects",
  "contextMarkers",
  "dayNight",
  "borders",
  "textureLabels",
  "labels",
];

export const TRANSFORM_REUSED_RENDER_PASS_NAMES = new Set([
  "background",
  "physicalBase",
  "political",
  "populationHeatmap",
  "hgoPreview",
  "contextBase",
  "contextScenario",
  "effects",
  "lineEffects",
  "contextMarkers",
  "dayNight",
]);

export const VIEWPORT_STABLE_RENDER_PASS_SIGNATURE_NAMES = new Set([
  "contextBase",
]);

export const INTERACTION_COMPOSITE_PASS_NAMES = [
  "background",
  "physicalBase",
  "political",
  "populationHeatmap",
  "contextBase",
  "contextScenario",
  "effects",
  "lineEffects",
  "contextMarkers",
  "dayNight",
];

export const TRANSFORMED_FRAME_PASS_NAMES = [
  "background",
  "physicalBase",
  "political",
  "populationHeatmap",
  "hgoPreview",
  "contextBase",
  "contextScenario",
  "effects",
  "lineEffects",
  "contextMarkers",
  "dayNight",
  "textureLabels",
  "labels",
];

export const RENDER_PASS_OVERSCAN_RATIO_PER_SIDE = 0.15;

export { filterEnabledRenderPassNames } from "./render_pass_visibility_policy.js";
