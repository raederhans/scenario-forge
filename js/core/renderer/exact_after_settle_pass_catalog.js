import { normalizeIterableStringList as normalizeStringList } from "./string_list_normalizers.js";
export const EXACT_AFTER_SETTLE_DEFERRED_PASS_NAMES = new Set([
  "contextBase",
  "contextScenario",
  "contextMarkers",
  "textureLabels",
  "labels",
]);

export const EXACT_AFTER_SETTLE_ALWAYS_TARGET_PASSES = [
  "political",
  "populationHeatmap",
  "borders",
  "labels",
  "textureLabels",
];

export function getExactAfterSettleDprRestorePasses(renderPassNames = []) {
  return normalizeStringList(renderPassNames).filter((passName) => passName !== "political");
}
