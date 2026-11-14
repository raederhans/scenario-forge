export const PACK_MODE_PREVIEW = "preview";
export const PACK_MODE_FULL = "full";
export const DATA_ROW_LIMIT = 240;

export function normalizeTransportWorkbenchPointNumber(value, fallback = 0) {
  const next = Number(value);
  return Number.isFinite(next) ? next : fallback;
}

export function resolveTransportWorkbenchPointVariantId(manifest, definition, config) {
  if (typeof definition.resolveVariantId === "function") {
    return String(definition.resolveVariantId(config, manifest) || "").trim();
  }
  return "";
}

export function getTransportWorkbenchPointVariantMeta(manifest, definition, variantId) {
  if (typeof definition.getVariantMeta === "function") {
    return definition.getVariantMeta(manifest, variantId) || null;
  }
  return null;
}

export function getTransportWorkbenchPointPackCacheKey(mode, variantId = "") {
  const normalizedMode = String(mode || PACK_MODE_PREVIEW).trim() || PACK_MODE_PREVIEW;
  const normalizedVariantId = String(variantId || "").trim();
  return normalizedVariantId ? `${normalizedVariantId}:${normalizedMode}` : normalizedMode;
}

export function getTransportWorkbenchPointPackPath(manifest, mode, key, definition, variantId = "") {
  const variantMeta = getTransportWorkbenchPointVariantMeta(manifest, definition, variantId);
  const variantModePaths = variantMeta?.paths?.[mode];
  if (variantModePaths && typeof variantModePaths === "object") {
    return variantModePaths[key] || "";
  }
  if (variantMeta?.paths?.[key]) {
    return variantMeta.paths[key] || "";
  }
  const modePaths = manifest?.paths?.[mode];
  if (modePaths && typeof modePaths === "object") {
    return modePaths[key] || "";
  }
  return manifest?.paths?.[key] || "";
}

export function isTransportWorkbenchPointSinglePackPath(manifest, key, definition, variantId = "") {
  const previewPath = getTransportWorkbenchPointPackPath(manifest, PACK_MODE_PREVIEW, key, definition, variantId);
  const fullPath = getTransportWorkbenchPointPackPath(manifest, PACK_MODE_FULL, key, definition, variantId);
  return !!previewPath && previewPath === fullPath;
}

export function getTransportWorkbenchPointThresholdRank(config, definition) {
  if (typeof definition.getThresholdRank === "function") {
    return normalizeTransportWorkbenchPointNumber(definition.getThresholdRank(config), 1);
  }
  return definition.importanceOrder?.[String(config?.importanceThreshold || "").trim()] || 1;
}

export function shouldUseTransportWorkbenchPointFullPack(config, definition, scale) {
  if (typeof definition.shouldUseFullPack === "function") {
    return !!definition.shouldUseFullPack(config, scale);
  }
  const threshold = definition.importanceOrder?.[String(config?.importanceThreshold || "").trim()] || 1;
  if (threshold <= 1) return true;
  return scale >= normalizeTransportWorkbenchPointNumber(definition.fullPackScaleThreshold, 1.26);
}

export function createTransportWorkbenchPointFeature(rawFeature, definition, variantId = "", options = {}) {
  const projectPoint = typeof options.projectPoint === "function" ? options.projectPoint : null;
  if (!projectPoint) return null;
  const properties = rawFeature?.properties || {};
  const coordinates = rawFeature?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const projected = projectPoint(coordinates[0], coordinates[1]);
  if (!projected) return null;
  const featureId = typeof definition.getFeatureId === "function"
    ? definition.getFeatureId(rawFeature)
    : String(properties.id || rawFeature.id || properties.stable_key || "").trim();
  const featureName = typeof definition.getFeatureName === "function"
    ? definition.getFeatureName(rawFeature)
    : String(properties.name || "").trim();
  const featureLabel = typeof definition.getFeatureLabel === "function"
    ? definition.getFeatureLabel(rawFeature)
    : featureName;
  const importanceRank = typeof definition.getFeatureImportanceRank === "function"
    ? normalizeTransportWorkbenchPointNumber(definition.getFeatureImportanceRank(rawFeature), 1)
    : normalizeTransportWorkbenchPointNumber(properties.importance_rank, 1);
  return {
    id: String(featureId || "").trim(),
    name: String(featureName || "").trim(),
    importance: String(properties.importance || "").trim(),
    importanceRank,
    x: projected.x,
    y: projected.y,
    lon: normalizeTransportWorkbenchPointNumber(coordinates[0]),
    lat: normalizeTransportWorkbenchPointNumber(coordinates[1]),
    properties,
    label: String(featureLabel || "").trim(),
    kind: definition.selectionType,
    variant: String(variantId || "").trim(),
    editOverlay: !!properties.edit_overlay,
  };
}

export function createTransportWorkbenchPointEditOverlayRawFeature(entry, definition) {
  const raw = entry && typeof entry === "object" ? entry : {};
  const lon = normalizeTransportWorkbenchPointNumber(raw.lon, NaN);
  const lat = normalizeTransportWorkbenchPointNumber(raw.lat, NaN);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const properties = raw.properties && typeof raw.properties === "object" ? { ...raw.properties } : {};
  properties.id = String(raw.id || properties.id || "").trim();
  properties.name = String(raw.name || properties.name || "").trim();
  properties.source = "user_overlay";
  properties.source_label = "User overlay";
  properties.edit_overlay = true;
  properties.importance = properties.importance || "local_connector";
  properties.importance_rank = normalizeTransportWorkbenchPointNumber(properties.importance_rank, 1);
  if (definition.familyId === "airport") {
    properties.airport_type = String(properties.airport_type || "other").trim() || "other";
    properties.status_category = String(properties.status_category || "active").trim() || "active";
  } else if (definition.familyId === "port") {
    properties.legal_designation = String(properties.legal_designation || "local").trim() || "local";
    properties.manager_type_code = String(properties.manager_type_code || "5").trim() || "5";
  }
  return {
    type: "Feature",
    id: properties.id,
    properties,
    geometry: {
      type: "Point",
      coordinates: [lon, lat],
    },
  };
}

export function buildTransportWorkbenchPointEditOverlayRawFeatures(config, definition) {
  const entries = Array.isArray(config?.editOverlay?.created)
    ? config.editOverlay.created
    : (Array.isArray(config?.editOverlay?.features) ? config.editOverlay.features : []);
  return entries
    .map((entry) => createTransportWorkbenchPointEditOverlayRawFeature(entry, definition))
    .filter(Boolean);
}

export function createTransportWorkbenchUpdatedPointFeature(sourceFeature, entry, definition, variantId = "", projectFeature) {
  if (!sourceFeature || !entry || typeof entry !== "object" || typeof projectFeature !== "function") return null;
  const lon = normalizeTransportWorkbenchPointNumber(entry.lon, sourceFeature.lon);
  const lat = normalizeTransportWorkbenchPointNumber(entry.lat, sourceFeature.lat);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  const sourceProperties = sourceFeature.properties && typeof sourceFeature.properties === "object"
    ? sourceFeature.properties
    : {};
  const patchProperties = entry.properties && typeof entry.properties === "object"
    ? entry.properties
    : {};
  const properties = {
    ...sourceProperties,
    ...patchProperties,
    id: sourceFeature.id,
    name: String(entry.name || sourceProperties.name || sourceFeature.name || "").trim(),
    edit_overlay: true,
    edit_overlay_mode: "updated",
  };
  return projectFeature({
    type: "Feature",
    id: sourceFeature.id,
    properties,
    geometry: {
      type: "Point",
      coordinates: [lon, lat],
    },
  }, definition, variantId);
}

export function createTransportWorkbenchEffectivePointPack(sourcePack, config, definition, options = {}) {
  const projectFeature = typeof options.projectFeature === "function" ? options.projectFeature : null;
  const deletedIds = new Set(
    Array.isArray(config?.editOverlay?.deleted)
      ? config.editOverlay.deleted.map((id) => String(id || "").trim()).filter(Boolean)
      : []
  );
  const updatedEntriesById = new Map(
    (Array.isArray(config?.editOverlay?.updated) ? config.editOverlay.updated : [])
      .map((entry) => [String(entry?.id || "").trim(), entry])
      .filter(([id]) => !!id)
  );
  const sourceFeatures = (Array.isArray(sourcePack?.features) ? sourcePack.features : [])
    .filter((feature) => !deletedIds.has(feature.id))
    .map((feature) => (
      updatedEntriesById.has(feature.id)
        ? (createTransportWorkbenchUpdatedPointFeature(
          feature,
          updatedEntriesById.get(feature.id),
          definition,
          sourcePack?.variantId || "",
          projectFeature
        ) || feature)
        : feature
    ));
  const overlayFeatures = buildTransportWorkbenchPointEditOverlayRawFeatures(config, definition)
    .map((feature) => (projectFeature ? projectFeature(feature, definition, sourcePack?.variantId || "") : null))
    .filter(Boolean);
  if (!deletedIds.size && !updatedEntriesById.size && !overlayFeatures.length) return sourcePack;
  const features = [...sourceFeatures, ...overlayFeatures];
  return {
    ...sourcePack,
    features,
    featureById: new Map(features.map((feature) => [feature.id, feature])),
  };
}

export function buildTransportWorkbenchPointVisibilityState(feature, config, definition, scale) {
  const hiddenReason = definition.getHiddenReason?.(feature, config, scale) || null;
  return {
    visible: !hiddenReason,
    hiddenReason,
    showLabel: !hiddenReason && !!definition.shouldShowLabel?.(feature, config, scale),
  };
}

export function createTransportWorkbenchPointViewRenderSignature(mode, scale) {
  return [
    String(mode || ""),
    Number(scale || 1).toFixed(1),
  ].join(":");
}

export function createTransportWorkbenchPointAggregateSelection(aggregateEntry, definition) {
  const dominantFeature = aggregateEntry.sampleFeature || {};
  return {
    id: aggregateEntry.id,
    name: aggregateEntry.label,
    aggregateCount: aggregateEntry.aggregateCount,
    dominantCategory: aggregateEntry.dominantCategory,
    dominantCategoryLabel: aggregateEntry.dominantCategoryLabel,
    properties: {
      aggregate_count: aggregateEntry.aggregateCount,
      dominant_category: aggregateEntry.dominantCategory,
      dominant_category_label: aggregateEntry.dominantCategoryLabel,
    },
    x: aggregateEntry.x,
    y: aggregateEntry.y,
    lon: aggregateEntry.lon,
    lat: aggregateEntry.lat,
    kind: `${definition.selectionType}_aggregate`,
    sampleFeatureId: dominantFeature.id || "",
    variant: String(dominantFeature.variant || "").trim(),
  };
}

export function getActiveTransportWorkbenchPointPack(runtime) {
  if (runtime.activePack) return runtime.activePack;
  const activeCacheKey = getTransportWorkbenchPointPackCacheKey(runtime.activePackMode, runtime.activeVariantId);
  return runtime.projectedPacks.get(activeCacheKey)
    || runtime.projectedPacks.get(getTransportWorkbenchPointPackCacheKey(PACK_MODE_FULL, runtime.activeVariantId))
    || runtime.projectedPacks.get(getTransportWorkbenchPointPackCacheKey(PACK_MODE_PREVIEW, runtime.activeVariantId))
    || Array.from(runtime.projectedPacks.values()).find(Boolean)
    || null;
}

export function createTransportWorkbenchPointDataRow(feature, runtime, config, scale) {
  const visibility = buildTransportWorkbenchPointVisibilityState(feature, config, runtime.definition, scale);
  return {
    id: feature.id,
    family: runtime.definition.familyId,
    kind: feature.kind,
    name: feature.name || feature.label || feature.id,
    source: String(feature.properties?.source || feature.properties?.data_source || feature.properties?.source_label || "").trim(),
    visible: visibility.visible,
    hiddenReason: visibility.hiddenReason,
    lon: feature.lon,
    lat: feature.lat,
    variant: feature.variant || "",
    selected: runtime.selectedFeature?.id === feature.id,
    properties: feature.properties || {},
  };
}

export function buildTransportWorkbenchPointDataRows(runtime, options = {}) {
  const pack = getActiveTransportWorkbenchPointPack(runtime);
  const config = runtime.lastRenderedConfig || {};
  const scale = normalizeTransportWorkbenchPointNumber(options.scale, 1);
  const features = Array.isArray(pack?.features) ? pack.features : [];
  return features
    .map((feature) => createTransportWorkbenchPointDataRow(feature, runtime, config, scale))
    .sort((left, right) => {
      if (left.visible !== right.visible) return left.visible ? -1 : 1;
      return String(left.name || left.id).localeCompare(String(right.name || right.id), "ja");
    })
    .slice(0, DATA_ROW_LIMIT);
}

export function buildTransportWorkbenchPointSnapshot(runtime, options = {}) {
  const audit = runtime.loadState.audit;
  const manifest = runtime.loadState.manifest;
  const activePackStatus = runtime.activePackMode === PACK_MODE_FULL
    ? runtime.loadState.fullStatus
    : runtime.loadState.previewStatus;
  const baseStatus = activePackStatus && activePackStatus !== "idle"
    ? activePackStatus
    : runtime.loadState.status;
  const resolvedStatus = (
    baseStatus === "ready" && !runtime.renderedConfigSignature
  ) ? "loading" : baseStatus;
  return {
    status: resolvedStatus,
    error: runtime.loadState.error,
    manifest,
    audit,
    activeVariant: runtime.activeVariantId,
    subtypeCatalog: runtime.loadState.subtypeCatalog,
    packMode: runtime.activePackMode,
    singlePack: !!runtime.loadState.singlePack,
    previewStatus: runtime.loadState.previewStatus,
    fullStatus: runtime.loadState.fullStatus,
    stats: {
      renderMode: runtime.renderStats.renderMode,
      totalFeatures: runtime.renderStats.totalFeatures,
      visibleFeatures: runtime.renderStats.visibleFeatures,
      filteredFeatures: runtime.renderStats.filteredFeatures,
      visibleLabels: runtime.renderStats.visibleLabels,
      aggregateUnits: runtime.renderStats.aggregateUnits,
    },
    renderedConfigSignature: runtime.renderedConfigSignature || "",
    selected: runtime.selectedFeature,
    dataRows: buildTransportWorkbenchPointDataRows(runtime, options),
    dataRowCount: getActiveTransportWorkbenchPointPack(runtime)?.features?.length || 0,
    dataRowLimit: DATA_ROW_LIMIT,
  };
}
