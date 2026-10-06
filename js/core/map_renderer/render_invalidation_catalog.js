function normalizeStringList(values = []) {
  return Array.from(
    new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
}

export const PASS_RESOURCE_MAP = Object.freeze({
  background: Object.freeze(["backgroundBuffer"]),
  physicalBase: Object.freeze(["physicalBaseBuffer"]),
  political: Object.freeze(["politicalBaseBuffer", "hitIndex"]),
  populationHeatmap: Object.freeze(["populationHeatmapBuffer"]),
  hgoPreview: Object.freeze(["hgoPreviewBuffer"]),
  contextBase: Object.freeze(["contextBaseBuffer"]),
  contextScenario: Object.freeze(["contextScenarioBuffer"]),
  effects: Object.freeze(["effectsBuffer"]),
  lineEffects: Object.freeze(["lineEffectsBuffer"]),
  contextMarkers: Object.freeze(["contextMarkersBuffer"]),
  dayNight: Object.freeze(["dayNightBuffer"]),
  borders: Object.freeze(["borderBuffer", "interactionOverlay"]),
  textureLabels: Object.freeze(["textureLabelBuffer"]),
  labels: Object.freeze(["labelBuffer"]),
});

export const RESOURCE_PASS_MAP = Object.freeze(Object.entries(PASS_RESOURCE_MAP).reduce((acc, [passName, resourceNames]) => {
  resourceNames.forEach((resourceName) => {
    if (!acc[resourceName]) acc[resourceName] = [];
    acc[resourceName].push(passName);
  });
  return acc;
}, {}));

export const DEFAULT_RENDER_INVALIDATION_PASSES = ["political", "borders", "labels"];

export const FIRST_FRAME_BASE_TARGET_RESOURCES = Object.freeze([
  "backgroundBuffer",
  "physicalBaseBuffer",
  "politicalBaseBuffer",
  "hitIndex",
  "borderBuffer",
  "interactionOverlay",
]);

export const FIRST_FRAME_HGO_TARGET_RESOURCES = Object.freeze([
  "hgoPreviewBuffer",
]);

export const UNSUPPORTED_RENDER_PASS_INPUT_KEYS = Object.freeze([
  "targetPasses",
  "legacyTargetPasses",
]);

export function getTargetResourcesForPasses(targetPasses = []) {
  return normalizeStringList((Array.isArray(targetPasses) ? targetPasses : []).flatMap((passName) => (
    PASS_RESOURCE_MAP[String(passName || "").trim()] || []
  )));
}

export function getTargetPassesForResources(targetResources = []) {
  return normalizeStringList((Array.isArray(targetResources) ? targetResources : []).flatMap((resourceName) => (
    RESOURCE_PASS_MAP[String(resourceName || "").trim()] || []
  )));
}

export function hasAnyTargetResource(targetResources = [], resourceNames = []) {
  const targetResourceSet = new Set(normalizeStringList(targetResources));
  return (Array.isArray(resourceNames) ? resourceNames : []).some((resourceName) => (
    targetResourceSet.has(String(resourceName || "").trim())
  ));
}

export function getFirstFrameTargetResources({
  hgoPreviewDirty = false,
} = {}) {
  return normalizeStringList([
    ...FIRST_FRAME_BASE_TARGET_RESOURCES,
    ...(hgoPreviewDirty ? FIRST_FRAME_HGO_TARGET_RESOURCES : []),
  ]);
}

export function resolveFirstFrameTargetResources(targetResources = [], {
  hgoPreviewDirty = false,
} = {}) {
  const allowlist = new Set(getFirstFrameTargetResources({ hgoPreviewDirty }));
  const filteredTargetResources = normalizeStringList(targetResources).filter((resourceName) => allowlist.has(resourceName));
  return normalizeStringList([
    ...FIRST_FRAME_BASE_TARGET_RESOURCES,
    ...filteredTargetResources,
    ...(hgoPreviewDirty ? FIRST_FRAME_HGO_TARGET_RESOURCES : []),
  ]);
}
