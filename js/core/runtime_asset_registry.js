import runtimeAssetRegistry from "../../data/runtime_asset_registry.json" with { type: "json" };

export const RUNTIME_ASSET_REGISTRY = Object.freeze(runtimeAssetRegistry);
export const RUNTIME_ASSET_URLS = Object.freeze(
  Object.fromEntries(
    Object.entries(RUNTIME_ASSET_REGISTRY?.assets || {})
      .map(([assetKey, assetSpec]) => [assetKey, String(assetSpec?.url || "").trim()])
      .filter(([, url]) => !!url)
  )
);
export const TRANSPORT_MANIFEST_ASSET_KEYS = Object.freeze({
  ...((RUNTIME_ASSET_REGISTRY?.transport_manifest_keys && typeof RUNTIME_ASSET_REGISTRY.transport_manifest_keys === "object")
    ? RUNTIME_ASSET_REGISTRY.transport_manifest_keys
    : {}),
});

function normalizeRuntimeAssetKey(key) {
  return String(key || "").trim();
}

export const THEMATIC_LAYER_INDEX_ASSET_KEY = normalizeRuntimeAssetKey(
  RUNTIME_ASSET_REGISTRY?.thematic_layer_index_key || "thematic_layer_catalog"
);
export const THEMATIC_LAYER_MANIFEST_ASSET_KEYS = Object.freeze({
  ...((RUNTIME_ASSET_REGISTRY?.thematic_layer_manifest_keys && typeof RUNTIME_ASSET_REGISTRY.thematic_layer_manifest_keys === "object")
    ? RUNTIME_ASSET_REGISTRY.thematic_layer_manifest_keys
    : {}),
});

export function resolveDataAssetUrl(key) {
  const normalizedKey = normalizeRuntimeAssetKey(key);
  const url = RUNTIME_ASSET_URLS[normalizedKey];
  if (!url) {
    throw new Error(`[runtime_asset_registry] Unknown runtime data asset key: ${normalizedKey || "<empty>"}.`);
  }
  return url;
}

export function resolveScenarioRegistryUrl() {
  const scenarioRegistryKey = normalizeRuntimeAssetKey(RUNTIME_ASSET_REGISTRY?.scenario_registry_key || "scenario_registry");
  return resolveDataAssetUrl(scenarioRegistryKey);
}

export function resolveTransportManifestUrl(familyId) {
  const normalizedFamilyId = normalizeRuntimeAssetKey(familyId);
  const assetKey = TRANSPORT_MANIFEST_ASSET_KEYS[normalizedFamilyId];
  if (!assetKey) {
    throw new Error(`[runtime_asset_registry] Unknown transport manifest family: ${normalizedFamilyId || "<empty>"}.`);
  }
  return resolveDataAssetUrl(assetKey);
}

export function resolveThematicLayerCatalogAssetKey() {
  if (!THEMATIC_LAYER_INDEX_ASSET_KEY) {
    throw new Error("[runtime_asset_registry] Thematic layer catalog asset key is not configured.");
  }
  return THEMATIC_LAYER_INDEX_ASSET_KEY;
}

export function resolveThematicLayerCatalogUrl() {
  return resolveDataAssetUrl(resolveThematicLayerCatalogAssetKey());
}

export function resolveThematicLayerManifestAssetKey(layerId) {
  const normalizedLayerId = normalizeRuntimeAssetKey(layerId);
  const assetKey = THEMATIC_LAYER_MANIFEST_ASSET_KEYS[normalizedLayerId];
  if (!assetKey) {
    throw new Error(`[runtime_asset_registry] Unknown thematic layer manifest: ${normalizedLayerId || "<empty>"}.`);
  }
  return assetKey;
}

export function resolveThematicLayerManifestUrl(layerId) {
  return resolveDataAssetUrl(resolveThematicLayerManifestAssetKey(layerId));
}
