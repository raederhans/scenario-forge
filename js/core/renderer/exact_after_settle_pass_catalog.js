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

function normalizeStringList(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : Array.from(values || []))
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

export function getExactAfterSettleDprRestorePasses(renderPassNames = []) {
  return normalizeStringList(renderPassNames).filter((passName) => passName !== "political");
}
