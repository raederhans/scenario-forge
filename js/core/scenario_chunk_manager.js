const DEFAULT_RENDER_BUDGET_HINTS = Object.freeze({
  max_required_chunks: 6,
  max_optional_chunks: 3,
  detail_zoom_threshold: 1.7,
});

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function normalizeBounds(rawBounds) {
  if (Array.isArray(rawBounds) && rawBounds.length >= 4) {
    const [minLon, minLat, maxLon, maxLat] = rawBounds.map((value) => Number(value));
    if ([minLon, minLat, maxLon, maxLat].every(Number.isFinite)) {
      return [
        Math.max(-180, Math.min(180, minLon)),
        Math.max(-90, Math.min(90, minLat)),
        Math.max(-180, Math.min(180, maxLon)),
        Math.max(-90, Math.min(90, maxLat)),
      ];
    }
  }
  return [-180, -90, 180, 90];
}

function boundsIntersect(leftBounds, rightBounds) {
  const [leftMinLon, leftMinLat, leftMaxLon, leftMaxLat] = normalizeBounds(leftBounds);
  const [rightMinLon, rightMinLat, rightMaxLon, rightMaxLat] = normalizeBounds(rightBounds);
  return !(
    leftMaxLon < rightMinLon
    || rightMaxLon < leftMinLon
    || leftMaxLat < rightMinLat
    || rightMaxLat < leftMinLat
  );
}

function getBoundsOverlapArea(leftBounds, rightBounds) {
  const [leftMinLon, leftMinLat, leftMaxLon, leftMaxLat] = normalizeBounds(leftBounds);
  const [rightMinLon, rightMinLat, rightMaxLon, rightMaxLat] = normalizeBounds(rightBounds);
  const overlapMinLon = Math.max(leftMinLon, rightMinLon);
  const overlapMinLat = Math.max(leftMinLat, rightMinLat);
  const overlapMaxLon = Math.min(leftMaxLon, rightMaxLon);
  const overlapMaxLat = Math.min(leftMaxLat, rightMaxLat);
  if (overlapMaxLon <= overlapMinLon || overlapMaxLat <= overlapMinLat) {
    return 0;
  }
  return (overlapMaxLon - overlapMinLon) * (overlapMaxLat - overlapMinLat);
}

function getBoundsArea(bounds) {
  const [minLon, minLat, maxLon, maxLat] = normalizeBounds(bounds);
  if (maxLon <= minLon || maxLat <= minLat) {
    return 0;
  }
  return (maxLon - minLon) * (maxLat - minLat);
}

function getBoundsCenterDistance(bounds, viewportBbox) {
  const [minLon, minLat, maxLon, maxLat] = normalizeBounds(bounds);
  const [viewMinLon, viewMinLat, viewMaxLon, viewMaxLat] = normalizeBounds(viewportBbox);
  const centerLon = (minLon + maxLon) / 2;
  const centerLat = (minLat + maxLat) / 2;
  const viewportCenterLon = (viewMinLon + viewMaxLon) / 2;
  const viewportCenterLat = (viewMinLat + viewMaxLat) / 2;
  return Math.hypot(centerLon - viewportCenterLon, centerLat - viewportCenterLat);
}

function normalizeChunkEntry(rawChunk = {}) {
  const chunkId = String(rawChunk.id || rawChunk.chunk_id || "").trim();
  const chunkUrl = String(rawChunk.url || rawChunk.chunk_url || "").trim();
  const layerKey = String(rawChunk.layer || rawChunk.layer_key || "").trim().toLowerCase();
  if (!chunkId || !chunkUrl || !layerKey) return null;
  return {
    id: chunkId,
    url: chunkUrl,
    layer: layerKey,
    lod: String(rawChunk.lod || "detail").trim().toLowerCase(),
    bounds: normalizeBounds(rawChunk.bounds),
    minZoom: clampNumber(rawChunk.min_zoom ?? rawChunk.minZoom, 0, 99, 0),
    maxZoom: clampNumber(rawChunk.max_zoom ?? rawChunk.maxZoom, 0, 99, 99),
    priority: clampNumber(rawChunk.priority, -999, 999, 0),
    featureCount: Math.max(0, Number(rawChunk.feature_count || rawChunk.featureCount || 0) || 0),
    dataFormat: String(rawChunk.data_format || rawChunk.dataFormat || "geojson").trim().toLowerCase(),
    countryCodes: Array.isArray(rawChunk.country_codes || rawChunk.countryCodes)
      ? rawChunk.country_codes || rawChunk.countryCodes
      : [],
    globalCoverage: rawChunk.global_coverage === true || rawChunk.globalCoverage === true,
  };
}

function sortChunksForSelection(chunks, focusCountry = "", viewportBbox = [-180, -90, 180, 90], loadedChunkIds = []) {
  const normalizedFocusCountry = String(focusCountry || "").trim().toUpperCase();
  const normalizedViewportBbox = normalizeBounds(viewportBbox);
  const loadedChunkIdSet = new Set((Array.isArray(loadedChunkIds) ? loadedChunkIds : []).map((value) => String(value || "").trim()));
  return [...chunks].sort((left, right) => {
    const leftFocus = normalizedFocusCountry && left.countryCodes.includes(normalizedFocusCountry) ? 1 : 0;
    const rightFocus = normalizedFocusCountry && right.countryCodes.includes(normalizedFocusCountry) ? 1 : 0;
    const leftFocusDetail = leftFocus && left.lod === "detail" ? 1 : 0;
    const rightFocusDetail = rightFocus && right.lod === "detail" ? 1 : 0;
    if (leftFocusDetail !== rightFocusDetail) return rightFocusDetail - leftFocusDetail;
    if (leftFocus !== rightFocus) return rightFocus - leftFocus;
    const leftLoaded = loadedChunkIdSet.has(left.id) ? 1 : 0;
    const rightLoaded = loadedChunkIdSet.has(right.id) ? 1 : 0;
    if (leftLoaded !== rightLoaded) return rightLoaded - leftLoaded;
    const leftOverlapArea = getBoundsOverlapArea(left.bounds, normalizedViewportBbox);
    const rightOverlapArea = getBoundsOverlapArea(right.bounds, normalizedViewportBbox);
    const leftOverlapRatio = leftOverlapArea / Math.max(1, getBoundsArea(left.bounds));
    const rightOverlapRatio = rightOverlapArea / Math.max(1, getBoundsArea(right.bounds));
    if (Math.abs(leftOverlapRatio - rightOverlapRatio) > 0.0001) return rightOverlapRatio - leftOverlapRatio;
    const leftCenterDistance = getBoundsCenterDistance(left.bounds, normalizedViewportBbox);
    const rightCenterDistance = getBoundsCenterDistance(right.bounds, normalizedViewportBbox);
    if (Math.abs(leftCenterDistance - rightCenterDistance) > 0.0001) return leftCenterDistance - rightCenterDistance;
    if (Math.abs(leftOverlapArea - rightOverlapArea) > 0.0001) return rightOverlapArea - leftOverlapArea;
    if (left.priority !== right.priority) return right.priority - left.priority;
    if (left.lod !== right.lod) {
      if (left.lod === "detail") return -1;
      if (right.lod === "detail") return 1;
    }
    if (left.featureCount !== right.featureCount) return left.featureCount - right.featureCount;
    return left.id.localeCompare(right.id);
  });
}

export function normalizeScenarioRenderBudgetHints(rawHints = {}) {
  return {
    max_required_chunks: clampNumber(
      rawHints.max_required_chunks,
      1,
      24,
      DEFAULT_RENDER_BUDGET_HINTS.max_required_chunks
    ),
    max_optional_chunks: clampNumber(
      rawHints.max_optional_chunks,
      0,
      12,
      DEFAULT_RENDER_BUDGET_HINTS.max_optional_chunks
    ),
    detail_zoom_threshold: clampNumber(
      rawHints.detail_zoom_threshold,
      1,
      32,
      DEFAULT_RENDER_BUDGET_HINTS.detail_zoom_threshold
    ),
  };
}

export function normalizeScenarioChunkManifest(payload = {}) {
  const chunks = Array.isArray(payload?.chunks)
    ? payload.chunks.map((rawChunk) => normalizeChunkEntry(rawChunk)).filter(Boolean)
    : [];
  const byLayer = {};
  chunks.forEach((chunk) => {
    if (!byLayer[chunk.layer]) {
      byLayer[chunk.layer] = [];
    }
    byLayer[chunk.layer].push(chunk);
  });
  return {
    version: Number(payload?.version || 1) || 1,
    scenarioId: String(payload?.scenario_id || payload?.scenarioId || "").trim(),
    chunks,
    byLayer,
  };
}

export function normalizeScenarioContextLodManifest(payload = {}) {
  const layers = {};
  Object.entries(payload?.layers && typeof payload.layers === "object" ? payload.layers : {}).forEach(([layerKey, rawEntries]) => {
    const normalizedLayerKey = String(layerKey || "").trim().toLowerCase();
    if (!normalizedLayerKey || !Array.isArray(rawEntries)) return;
    layers[normalizedLayerKey] = rawEntries
      .map((entry) => ({
        lod: String(entry?.lod || "detail").trim().toLowerCase(),
        minZoom: clampNumber(entry?.min_zoom ?? entry?.minZoom, 0, 99, 0),
        maxZoom: clampNumber(entry?.max_zoom ?? entry?.maxZoom, 0, 99, 99),
        chunkIds: Array.isArray(entry?.chunk_ids || entry?.chunkIds)
          ? [...new Set((entry.chunk_ids || entry.chunkIds).map((value) => String(value || "").trim()).filter(Boolean))]
          : [],
      }))
      .filter((entry) => entry.chunkIds.length > 0);
  });
  return {
    version: Number(payload?.version || 1) || 1,
    scenarioId: String(payload?.scenario_id || payload?.scenarioId || "").trim(),
    layers,
  };
}

export function getVisibleScenarioChunkLayers({
  includePoliticalCore = false,
  showWaterRegions = false,
  showScenarioSpecialRegions = false,
  showScenarioReliefOverlays = false,
  showCityPoints = false,
} = {}) {
  return [
    includePoliticalCore ? "political" : "",
    showWaterRegions ? "water" : "",
    showScenarioSpecialRegions ? "special" : "",
    showScenarioReliefOverlays ? "relief" : "",
    showCityPoints ? "cities" : "",
  ].filter(Boolean);
}

export function buildViewportGeoBounds({
  projection = null,
  transform = null,
  width = 0,
  height = 0,
} = {}) {
  if (!projection || typeof projection.invert !== "function") {
    return [-180, -90, 180, 90];
  }
  const currentTransform = transform && typeof transform === "object"
    ? {
      x: Number(transform.x || 0),
      y: Number(transform.y || 0),
      k: Math.max(0.0001, Number(transform.k || 1)),
    }
    : { x: 0, y: 0, k: 1 };
  const points = [
    [0, 0],
    [Number(width || 0), 0],
    [0, Number(height || 0)],
    [Number(width || 0), Number(height || 0)],
    [Number(width || 0) * 0.5, Number(height || 0) * 0.5],
  ];
  const longitudes = [];
  const latitudes = [];
  points.forEach(([screenX, screenY]) => {
    try {
      const mapX = (screenX - currentTransform.x) / currentTransform.k;
      const mapY = (screenY - currentTransform.y) / currentTransform.k;
      const inverted = projection.invert([mapX, mapY]);
      if (!Array.isArray(inverted) || inverted.length < 2) return;
      const [lon, lat] = inverted.map((value) => Number(value));
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      longitudes.push(Math.max(-180, Math.min(180, lon)));
      latitudes.push(Math.max(-90, Math.min(90, lat)));
    } catch (_error) {
      // Ignore failed inversion and continue with other sample points.
    }
  });
  if (!longitudes.length || !latitudes.length) {
    return [-180, -90, 180, 90];
  }
  return [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
}

function resolveLayerChunksForZoom({
  chunkRegistry,
  contextLodManifest,
  layerKey,
  zoom,
}) {
  const registryChunks = Array.isArray(chunkRegistry?.byLayer?.[layerKey])
    ? chunkRegistry.byLayer[layerKey]
    : [];
  const lodEntries = Array.isArray(contextLodManifest?.layers?.[layerKey])
    ? contextLodManifest.layers[layerKey]
    : [];
  if (!lodEntries.length) {
    return registryChunks.filter((chunk) => zoom >= chunk.minZoom && zoom < chunk.maxZoom);
  }
  const activeLodEntries = lodEntries.filter((entry) => zoom >= entry.minZoom && zoom < entry.maxZoom);
  if (!activeLodEntries.length) {
    return registryChunks.filter((chunk) => zoom >= chunk.minZoom && zoom < chunk.maxZoom);
  }
  const activeChunkIds = new Set(activeLodEntries.flatMap((entry) => entry.chunkIds));
  return registryChunks.filter((chunk) => activeChunkIds.has(chunk.id));
}

export function selectScenarioChunks({
  scenarioId = "",
  chunkRegistry = null,
  contextLodManifest = null,
  zoom = 1,
  viewportBbox = [-180, -90, 180, 90],
  focusCountry = "",
  renderBudgetHints = {},
  visibleLayers = [],
  loadedChunkIds = [],
} = {}) {
  const hints = normalizeScenarioRenderBudgetHints(renderBudgetHints);
  const normalizedFocusCountry = String(focusCountry || "").trim().toUpperCase();
  const required = [];
  const optional = [];
  const visibleLayerSet = new Set((Array.isArray(visibleLayers) ? visibleLayers : []).map((value) => String(value || "").trim().toLowerCase()));
  visibleLayerSet.forEach((layerKey) => {
    const requiredBudget = layerKey === "political"
      ? Math.min(hints.max_required_chunks * 2, 12)
      : hints.max_required_chunks;
    const optionalBudget = layerKey === "political" ? 0 : hints.max_optional_chunks;
    const candidates = resolveLayerChunksForZoom({
      chunkRegistry,
      contextLodManifest,
      layerKey,
      zoom,
    }).filter((chunk) => chunk.globalCoverage || boundsIntersect(chunk.bounds, viewportBbox));
    const ordered = sortChunksForSelection(candidates, focusCountry, viewportBbox, loadedChunkIds);
    const focusDetailChunks = normalizedFocusCountry
      ? ordered.filter((chunk) => chunk.lod === "detail" && chunk.countryCodes.includes(normalizedFocusCountry))
      : [];
    const prioritizedRequired = [];
    const seenRequired = new Set();
    focusDetailChunks.forEach((chunk) => {
      if (seenRequired.has(chunk.id)) return;
      seenRequired.add(chunk.id);
      prioritizedRequired.push(chunk);
    });
    ordered.forEach((chunk) => {
      if (seenRequired.has(chunk.id)) return;
      seenRequired.add(chunk.id);
      prioritizedRequired.push(chunk);
    });
    required.push(...prioritizedRequired.slice(0, requiredBudget));
    if (ordered.length > requiredBudget && optionalBudget > 0) {
      optional.push(...ordered.slice(requiredBudget, requiredBudget + optionalBudget));
    }
  });
  const uniqueRequired = Array.from(new Map(required.map((chunk) => [chunk.id, chunk])).values());
  const uniqueOptional = Array.from(new Map(optional.map((chunk) => [chunk.id, chunk])).values())
    .filter((chunk) => !uniqueRequired.some((requiredChunk) => requiredChunk.id === chunk.id));
  const retainedIds = new Set([...uniqueRequired, ...uniqueOptional].map((chunk) => chunk.id));
  const evictableChunkIds = Array.isArray(loadedChunkIds)
    ? loadedChunkIds
      .map((value) => String(value || "").trim())
      .filter(Boolean)
      .filter((chunkId) => !retainedIds.has(chunkId))
    : [];
  return {
    scenarioId: String(scenarioId || "").trim(),
    requiredChunks: uniqueRequired,
    optionalChunks: uniqueOptional,
    evictableChunkIds,
    zoom,
    viewportBbox: normalizeBounds(viewportBbox),
  };
}

function getChunkFeatureId(feature, fallbackIndex = 0) {
  const rawValue = feature?.id ?? feature?.properties?.id ?? feature?.properties?.feature_id ?? fallbackIndex;
  const normalized = String(rawValue ?? "").trim();
  return normalized || `chunk-feature-${fallbackIndex}`;
}

function mergeFeatureCollections(payloads = []) {
  const features = [];
  const seen = new Set();
  payloads.forEach((payload) => {
    const nextFeatures = Array.isArray(payload?.features) ? payload.features : [];
    nextFeatures.forEach((feature, index) => {
      const featureId = getChunkFeatureId(feature, index);
      if (seen.has(featureId)) return;
      seen.add(featureId);
      features.push(feature);
    });
  });
  return {
    type: "FeatureCollection",
    features,
  };
}

function mergeCityOverridePayloads(payloads = []) {
  const cities = {};
  const capitalsByTag = {};
  const capitalCityHints = {};
  const featureCollections = [];
  payloads.forEach((payload) => {
    Object.assign(cities, payload?.cities && typeof payload.cities === "object" ? payload.cities : {});
    Object.assign(
      capitalsByTag,
      payload?.capitals_by_tag && typeof payload.capitals_by_tag === "object" ? payload.capitals_by_tag : {}
    );
    Object.assign(
      capitalCityHints,
      payload?.capital_city_hints && typeof payload.capital_city_hints === "object" ? payload.capital_city_hints : {}
    );
    if (Array.isArray(payload?.featureCollection?.features)) {
      featureCollections.push(payload.featureCollection);
    }
  });
  return {
    type: "city_overrides",
    version: 1,
    scenario_id: "",
    generated_at: "",
    cities,
    capitals_by_tag: capitalsByTag,
    capital_city_hints: capitalCityHints,
    audit: null,
    featureCollection: featureCollections.length ? mergeFeatureCollections(featureCollections) : null,
  };
}

export function mergeScenarioChunkPayloads(layerKey, payloads = []) {
  const normalizedLayerKey = String(layerKey || "").trim().toLowerCase();
  const filteredPayloads = (Array.isArray(payloads) ? payloads : []).filter(Boolean);
  if (!filteredPayloads.length) return null;
  if (normalizedLayerKey === "cities") {
    return mergeCityOverridePayloads(filteredPayloads);
  }
  return mergeFeatureCollections(filteredPayloads);
}
