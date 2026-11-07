// Scenario-only urban supplements. They never compete in urban source
// selection; the active scenario's supplement is appended after the chosen
// base collection while the land it sits on is visible.
const SCENARIO_URBAN_OVERLAYS = Object.freeze({
  tno_1962: Object.freeze({
    layerName: "urban_tno_atlantropa",
    // Atlantropa patches sit on land that only exists while that layer shows.
    isHostVisible: (state) => state?.showScenarioAtlantropa !== false
      && Array.isArray(state?.scenarioAtlantropaData?.features)
      && state.scenarioAtlantropaData.features.length > 0,
  }),
});

export const SCENARIO_URBAN_OVERLAY_LAYER_NAMES = Object.freeze(
  Object.values(SCENARIO_URBAN_OVERLAYS).map((entry) => entry.layerName),
);

const mergedByBase = new WeakMap();
const overlayByMerged = new WeakMap();

export function isScenarioUrbanOverlayLayerName(layerName) {
  return SCENARIO_URBAN_OVERLAY_LAYER_NAMES.includes(String(layerName || "").trim().toLowerCase());
}

// Name of the supplement the current scenario wants shown, or "".
export function getActiveScenarioUrbanOverlayLayerName(state) {
  const entry = SCENARIO_URBAN_OVERLAYS[String(state?.activeScenarioId || "").trim()];
  return entry && entry.isHostVisible(state) ? entry.layerName : "";
}

export function getActiveScenarioUrbanOverlay(state) {
  const layerName = getActiveScenarioUrbanOverlayLayerName(state);
  const collection = layerName ? state?.contextLayerExternalDataByName?.[layerName] : null;
  return Array.isArray(collection?.features) && collection.features.length ? collection : null;
}

// Returns the base collection untouched when there is nothing to append.
// The merged collection is reused while both inputs keep their identity.
export function appendScenarioUrbanOverlay(baseCollection, overlayCollection) {
  if (!Array.isArray(baseCollection?.features) || !baseCollection.features.length
    || !Array.isArray(overlayCollection?.features) || !overlayCollection.features.length) {
    return baseCollection;
  }
  const cached = mergedByBase.get(baseCollection);
  if (cached && cached.overlay === overlayCollection
    && cached.baseFeatures === baseCollection.features
    && cached.baseCount === baseCollection.features.length
    && cached.overlayFeatures === overlayCollection.features
    && cached.overlayCount === overlayCollection.features.length) {
    return cached.merged;
  }
  const merged = {
    type: "FeatureCollection",
    features: [...baseCollection.features, ...overlayCollection.features],
  };
  mergedByBase.set(baseCollection, {
    overlay: overlayCollection,
    baseFeatures: baseCollection.features,
    baseCount: baseCollection.features.length,
    overlayFeatures: overlayCollection.features,
    overlayCount: overlayCollection.features.length,
    merged,
  });
  overlayByMerged.set(merged, overlayCollection);
  return merged;
}

// Supplement features inside a collection built by appendScenarioUrbanOverlay.
// They sit on scenario land painted after the base context pass, so the
// renderer draws them with that land instead of with the base urban layer.
export function getAppendedScenarioUrbanOverlayFeatures(collection) {
  const overlay = collection && typeof collection === "object" ? overlayByMerged.get(collection) : null;
  return Array.isArray(overlay?.features) ? overlay.features : [];
}
