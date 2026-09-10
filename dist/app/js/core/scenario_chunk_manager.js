import { getFeatureId } from "./feature_identity.js";

const DEFAULT_RENDER_BUDGET_HINTS = Object.freeze({
  max_required_chunks: 6,
  max_optional_chunks: 3,
  min_required_chunks: 1,
  max_required_estimated_path_cost: 520000,
  max_required_byte_size: 0,
  detail_zoom_threshold: 1.7,
});

function clampNumber(value, min, max, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function clampNonNegativeNumber(value, fallback = 0) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(0, parsed);
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

function inflateBounds(bounds, paddingLon = 0, paddingLat = 0) {
  const [minLon, minLat, maxLon, maxLat] = normalizeBounds(bounds);
  return [
    Math.max(-180, minLon - Math.max(0, Number(paddingLon || 0))),
    Math.max(-90, minLat - Math.max(0, Number(paddingLat || 0))),
    Math.min(180, maxLon + Math.max(0, Number(paddingLon || 0))),
    Math.min(90, maxLat + Math.max(0, Number(paddingLat || 0))),
  ];
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

function normalizeFeatureBoundsList(rawBoundsList = []) {
  if (!Array.isArray(rawBoundsList)) return [];
  return rawBoundsList
    .map((bounds) => {
      if (!Array.isArray(bounds) || bounds.length < 4) return null;
      const values = bounds.slice(0, 4).map((value) => Number(value));
      if (!values.every(Number.isFinite)) return null;
      return normalizeBounds(values);
    })
    .filter((bounds) => Array.isArray(bounds));
}

function getChunkSelectionBounds(chunk) {
  return Array.isArray(chunk?.featureBounds) && chunk.featureBounds.length
    ? chunk.featureBounds
    : [chunk?.bounds || [-180, -90, 180, 90]];
}

function getChunkFeatureBoundsForCount(chunk, expectedFeatureCount = null) {
  const featureBounds = Array.isArray(chunk?.featureBounds) ? chunk.featureBounds : [];
  if (!featureBounds.length) return null;
  const expected = Math.floor(clampNonNegativeNumber(
    expectedFeatureCount ?? chunk?.featureCount,
    0,
  ));
  if (expected > 0 && featureBounds.length !== expected) return null;
  return featureBounds;
}

function getChunkVisibleFeatureIndexes(chunk, viewportBbox, { expectedFeatureCount = null } = {}) {
  const featureBounds = getChunkFeatureBoundsForCount(chunk, expectedFeatureCount);
  if (!featureBounds) return null;
  const normalizedViewportBbox = normalizeBounds(viewportBbox);
  const indexes = [];
  featureBounds.forEach((bounds, index) => {
    if (boundsIntersect(bounds, normalizedViewportBbox)) {
      indexes.push(index);
    }
  });
  return indexes;
}

function getChunkVisibleFeatureCount(chunk, viewportBbox) {
  const visibleIndexes = getChunkVisibleFeatureIndexes(chunk, viewportBbox);
  if (Array.isArray(visibleIndexes)) return visibleIndexes.length;
  return Math.max(0, Number(chunk?.featureCount || 0));
}

function getChunkVisibleFeatureIndexSignature(chunk, viewportBbox) {
  const visibleIndexes = getChunkVisibleFeatureIndexes(chunk, viewportBbox);
  if (!Array.isArray(visibleIndexes)) return "*";
  return visibleIndexes.join(".");
}

function getVisibleFeatureSubsetSignature(chunks, viewportBbox) {
  return (Array.isArray(chunks) ? chunks : [])
    .map((chunk) => `${String(chunk?.id || "").trim()}:${getChunkVisibleFeatureIndexSignature(chunk, viewportBbox)}`)
    .join("|");
}

function chunkIntersectsViewport(chunk, viewportBbox) {
  return getChunkSelectionBounds(chunk).some((bounds) => boundsIntersect(bounds, viewportBbox));
}

function getChunkOverlapArea(chunk, viewportBbox) {
  return getChunkSelectionBounds(chunk)
    .reduce((sum, bounds) => sum + getBoundsOverlapArea(bounds, viewportBbox), 0);
}

function getChunkSelectionArea(chunk) {
  return getChunkSelectionBounds(chunk)
    .reduce((sum, bounds) => sum + getBoundsArea(bounds), 0);
}

function getChunkCenterDistance(chunk, viewportBbox) {
  const boundsList = getChunkSelectionBounds(chunk);
  if (!boundsList.length) return Number.POSITIVE_INFINITY;
  return Math.min(...boundsList.map((bounds) => getBoundsCenterDistance(bounds, viewportBbox)));
}

function normalizeChunkEntry(rawChunk = {}) {
  const chunkId = String(rawChunk.id || rawChunk.chunk_id || "").trim();
  const chunkUrl = String(rawChunk.url || rawChunk.chunk_url || "").trim();
  const layerKey = String(rawChunk.layer || rawChunk.layer_key || "").trim().toLowerCase();
  if (!chunkId || !chunkUrl || !layerKey) return null;
  const featureCount = Math.floor(clampNonNegativeNumber(rawChunk.feature_count ?? rawChunk.featureCount, 0));
  const byteSize = Math.floor(clampNonNegativeNumber(
    rawChunk.byte_size ?? rawChunk.byteSize ?? rawChunk.byte_count ?? rawChunk.byteCount ?? rawChunk.bytes,
    0,
  ));
  const coordCount = Math.floor(clampNonNegativeNumber(
    rawChunk.coord_count ?? rawChunk.coordCount ?? rawChunk.coordinate_count ?? rawChunk.coordinateCount,
    0,
  ));
  const partCount = Math.floor(clampNonNegativeNumber(rawChunk.part_count ?? rawChunk.partCount, 0));
  const estimatedPathCost = clampNonNegativeNumber(
    rawChunk.estimated_path_cost ?? rawChunk.estimatedPathCost,
    featureCount,
  );
  return {
    id: chunkId,
    url: chunkUrl,
    layer: layerKey,
    lod: String(rawChunk.lod || "detail").trim().toLowerCase(),
    bounds: normalizeBounds(rawChunk.bounds),
    minZoom: clampNumber(rawChunk.min_zoom ?? rawChunk.minZoom, 0, 99, 0),
    maxZoom: clampNumber(rawChunk.max_zoom ?? rawChunk.maxZoom, 0, 99, 99),
    priority: clampNumber(rawChunk.priority, -999, 999, 0),
    featureCount,
    byteSize,
    coordCount,
    partCount,
    estimatedPathCost,
    dataFormat: String(rawChunk.data_format || rawChunk.dataFormat || "geojson").trim().toLowerCase(),
    sha256: String(rawChunk.sha256 || rawChunk.content_sha256 || rawChunk.contentHash || "").trim(),
    featureBounds: normalizeFeatureBoundsList(rawChunk.feature_bounds || rawChunk.featureBounds),
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
    const leftOverlapArea = getChunkOverlapArea(left, normalizedViewportBbox);
    const rightOverlapArea = getChunkOverlapArea(right, normalizedViewportBbox);
    const leftOverlapRatio = leftOverlapArea / Math.max(1, getChunkSelectionArea(left));
    const rightOverlapRatio = rightOverlapArea / Math.max(1, getChunkSelectionArea(right));
    if (Math.abs(leftOverlapRatio - rightOverlapRatio) > 0.0001) return rightOverlapRatio - leftOverlapRatio;
    const leftCenterDistance = getChunkCenterDistance(left, normalizedViewportBbox);
    const rightCenterDistance = getChunkCenterDistance(right, normalizedViewportBbox);
    if (Math.abs(leftCenterDistance - rightCenterDistance) > 0.0001) return leftCenterDistance - rightCenterDistance;
    if (Math.abs(leftOverlapArea - rightOverlapArea) > 0.0001) return rightOverlapArea - leftOverlapArea;
    if (left.priority !== right.priority) return right.priority - left.priority;
    if (left.lod !== right.lod) {
      if (left.lod === "detail") return -1;
      if (right.lod === "detail") return 1;
    }
    if (Math.abs(left.estimatedPathCost - right.estimatedPathCost) > 0.0001) {
      return left.estimatedPathCost - right.estimatedPathCost;
    }
    if (left.byteSize !== right.byteSize) return left.byteSize - right.byteSize;
    if (left.coordCount !== right.coordCount) return left.coordCount - right.coordCount;
    if (left.partCount !== right.partCount) return left.partCount - right.partCount;
    if (left.featureCount !== right.featureCount) return left.featureCount - right.featureCount;
    return left.id.localeCompare(right.id);
  });
}

export function normalizeScenarioRenderBudgetHints(rawHints = {}) {
  const maxRequiredChunks = clampNumber(
    rawHints.max_required_chunks,
    1,
    24,
    DEFAULT_RENDER_BUDGET_HINTS.max_required_chunks
  );
  const minRequiredChunks = clampNumber(
    rawHints.min_required_chunks,
    1,
    24,
    DEFAULT_RENDER_BUDGET_HINTS.min_required_chunks
  );
  const maxPoliticalRequiredChunks = clampNumber(
    rawHints.max_required_political_chunks ?? rawHints.political_max_required_chunks,
    1,
    64,
    Math.min(maxRequiredChunks * 2, 12)
  );
  const minPoliticalRequiredChunks = clampNumber(
    rawHints.min_required_political_chunks ?? rawHints.political_min_required_chunks,
    1,
    64,
    Math.max(1, maxRequiredChunks, minRequiredChunks)
  );
  return {
    max_required_chunks: maxRequiredChunks,
    max_optional_chunks: clampNumber(
      rawHints.max_optional_chunks,
      0,
      12,
      DEFAULT_RENDER_BUDGET_HINTS.max_optional_chunks
    ),
    min_required_chunks: minRequiredChunks,
    max_required_estimated_path_cost: clampNumber(
      rawHints.max_required_estimated_path_cost ?? rawHints.max_required_path_cost,
      0,
      5000000,
      DEFAULT_RENDER_BUDGET_HINTS.max_required_estimated_path_cost
    ),
    max_required_byte_size: clampNumber(
      rawHints.max_required_byte_size ?? rawHints.max_required_bytes,
      0,
      200000000,
      DEFAULT_RENDER_BUDGET_HINTS.max_required_byte_size
    ),
    max_required_political_chunks: maxPoliticalRequiredChunks,
    min_required_political_chunks: minPoliticalRequiredChunks,
    max_required_political_estimated_path_cost: clampNumber(
      rawHints.max_required_political_estimated_path_cost ?? rawHints.political_max_required_path_cost,
      0,
      5000000,
      rawHints.max_required_estimated_path_cost ?? rawHints.max_required_path_cost ?? DEFAULT_RENDER_BUDGET_HINTS.max_required_estimated_path_cost
    ),
    max_required_political_byte_size: clampNumber(
      rawHints.max_required_political_byte_size ?? rawHints.political_max_required_bytes,
      0,
      200000000,
      rawHints.max_required_byte_size ?? rawHints.max_required_bytes ?? DEFAULT_RENDER_BUDGET_HINTS.max_required_byte_size
    ),
    detail_zoom_threshold: clampNumber(
      rawHints.detail_zoom_threshold,
      1,
      32,
      DEFAULT_RENDER_BUDGET_HINTS.detail_zoom_threshold
    ),
  };
}

function takeRequiredChunksWithinCostBudget(orderedChunks = [], {
  countBudget = 0,
  minCount = 1,
  estimatedPathCostBudget = 0,
  byteSizeBudget = 0,
} = {}) {
  const countLimit = Math.max(0, Math.floor(Number(countBudget || 0)));
  if (!countLimit) return [];
  const minimum = Math.max(0, Math.min(countLimit, Math.floor(Number(minCount || 0))));
  const costLimit = Math.max(0, Number(estimatedPathCostBudget || 0));
  const byteLimit = Math.max(0, Number(byteSizeBudget || 0));
  const selected = [];
  let selectedCost = 0;
  let selectedBytes = 0;

  orderedChunks.forEach((chunk) => {
    if (selected.length >= countLimit) return;
    const nextCost = Math.max(0, Number(chunk?.estimatedPathCost || chunk?.featureCount || 0));
    const nextBytes = Math.max(0, Number(chunk?.byteSize || 0));
    const overCostBudget = costLimit > 0 && selected.length >= minimum && selectedCost + nextCost > costLimit;
    const overByteBudget = byteLimit > 0 && selected.length >= minimum && selectedBytes + nextBytes > byteLimit;
    if (overCostBudget || overByteBudget) return;
    selected.push(chunk);
    selectedCost += nextCost;
    selectedBytes += nextBytes;
  });

  orderedChunks.forEach((chunk) => {
    if (selected.length >= Math.min(minimum, orderedChunks.length)) return;
    if (selected.some((entry) => entry.id === chunk.id)) return;
    selected.push(chunk);
    selectedCost += Math.max(0, Number(chunk?.estimatedPathCost || chunk?.featureCount || 0));
    selectedBytes += Math.max(0, Number(chunk?.byteSize || 0));
  });

  return selected;
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
  showScenarioAtlantropa = false,
  showScenarioReliefOverlays = false,
  showCityPoints = false,
  requiredSemanticLayers = [],
} = {}) {
  return Array.from(new Set([
    includePoliticalCore ? "political" : "",
    showWaterRegions ? "water" : "",
    showScenarioSpecialRegions ? "special" : "",
    showScenarioAtlantropa ? "scenario_atlantropa" : "",
    showScenarioReliefOverlays ? "relief" : "",
    showCityPoints ? "cities" : "",
    ...(Array.isArray(requiredSemanticLayers) ? requiredSemanticLayers : []),
  ]
    .map((layerKey) => String(layerKey || "").trim().toLowerCase())
    .filter(Boolean)));
}

const DEFAULT_REQUIRED_SEMANTIC_LAYERS_BY_SCENARIO = Object.freeze({
  tno_1962: Object.freeze(["scenario_atlantropa", "water", "relief"]),
});

function normalizeRequiredSemanticLayerList(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  ));
}

export function resolveRequiredScenarioSemanticLayers({
  scenarioId = "",
  manifest = null,
} = {}) {
  const normalizedScenarioId = String(
    scenarioId || manifest?.scenario_id || manifest?.scenarioId || ""
  ).trim().toLowerCase();
  const defaults = normalizeRequiredSemanticLayerList(
    DEFAULT_REQUIRED_SEMANTIC_LAYERS_BY_SCENARIO[normalizedScenarioId] || []
  );
  const rawManifestLayers = manifest?.required_semantic_layers;
  if (Array.isArray(rawManifestLayers)) {
    return normalizeRequiredSemanticLayerList(rawManifestLayers);
  }
  if (rawManifestLayers && typeof rawManifestLayers === "object") {
    const mode = String(rawManifestLayers.mode || "extend").trim().toLowerCase();
    const layers = normalizeRequiredSemanticLayerList(rawManifestLayers.layers);
    if (mode === "replace" || mode === "override") {
      return layers;
    }
    return normalizeRequiredSemanticLayerList([...defaults, ...layers]);
  }
  return defaults;
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
  const viewportWidth = Number(width || 0);
  const viewportHeight = Number(height || 0);
  // Curved projections can place the geographic extrema along screen edges.
  // Sampling a small grid keeps edge chunks eligible during zoom/pan.
  const sampleFractions = [0, 0.25, 0.5, 0.75, 1];
  const points = [];
  sampleFractions.forEach((xFraction) => {
    sampleFractions.forEach((yFraction) => {
      points.push([viewportWidth * xFraction, viewportHeight * yFraction]);
    });
  });
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
  const sampledBounds = [
    Math.min(...longitudes),
    Math.min(...latitudes),
    Math.max(...longitudes),
    Math.max(...latitudes),
  ];
  const lonPadding = Math.min(2.5, Math.max(0.25, (sampledBounds[2] - sampledBounds[0]) * 0.03));
  const latPadding = Math.min(2.5, Math.max(0.25, (sampledBounds[3] - sampledBounds[1]) * 0.03));
  return inflateBounds(sampledBounds, lonPadding, latPadding);
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

export function isScenarioPoliticalBaseChunk(chunk) {
  return chunk?.layer === "political" && chunk.globalCoverage === true && chunk.lod === "coarse";
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
    // Detail budgets govern extra precision, never the existence of countries.
    const baseChunks = (chunkRegistry?.byLayer?.[layerKey] || []).filter(isScenarioPoliticalBaseChunk);
    required.push(...baseChunks);
    const requiredBudget = layerKey === "political"
      ? hints.max_required_political_chunks
      : hints.max_required_chunks;
    const optionalBudget = layerKey === "political" ? 0 : hints.max_optional_chunks;
    const candidates = resolveLayerChunksForZoom({
      chunkRegistry,
      contextLodManifest,
      layerKey,
      zoom,
    }).filter((chunk) => !isScenarioPoliticalBaseChunk(chunk)
      && (chunk.globalCoverage || chunkIntersectsViewport(chunk, viewportBbox)));
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
    const requiredForLayer = takeRequiredChunksWithinCostBudget(prioritizedRequired, {
      countBudget: requiredBudget,
      minCount: layerKey === "political"
        ? Math.min(requiredBudget, hints.min_required_political_chunks)
        : Math.min(requiredBudget, hints.min_required_chunks),
      estimatedPathCostBudget: layerKey === "political"
        ? hints.max_required_political_estimated_path_cost
        : hints.max_required_estimated_path_cost,
      byteSizeBudget: layerKey === "political"
        ? hints.max_required_political_byte_size
        : hints.max_required_byte_size,
    });
    required.push(...requiredForLayer);
    if (optionalBudget > 0) {
      const requiredIdSet = new Set(requiredForLayer.map((chunk) => chunk.id));
      optional.push(...ordered.filter((chunk) => !requiredIdSet.has(chunk.id)).slice(0, optionalBudget));
    }
  });
  const uniqueRequired = Array.from(new Map(required.map((chunk) => [chunk.id, chunk])).values());
  const uniqueOptional = Array.from(new Map(optional.map((chunk) => [chunk.id, chunk])).values())
    .filter((chunk) => !uniqueRequired.some((requiredChunk) => requiredChunk.id === chunk.id));
  const selectedFeatureCountSum = uniqueRequired.reduce((sum, chunk) => sum + Math.max(0, Number(chunk.featureCount || 0)), 0);
  const selectedVisibleFeatureCountSum = uniqueRequired.reduce((sum, chunk) => sum + getChunkVisibleFeatureCount(chunk, viewportBbox), 0);
  const selectedPoliticalChunks = uniqueRequired.filter((chunk) => chunk.layer === "political");
  const selectedPoliticalFeatureCountSum = selectedPoliticalChunks
    .reduce((sum, chunk) => sum + Math.max(0, Number(chunk.featureCount || 0)), 0);
  const selectedPoliticalVisibleFeatureCountSum = selectedPoliticalChunks
    .reduce((sum, chunk) => sum + getChunkVisibleFeatureCount(chunk, viewportBbox), 0);
  const selectedByteCountSum = uniqueRequired.reduce((sum, chunk) => sum + Math.max(0, Number(chunk.byteSize || 0)), 0);
  const selectedCoordCountSum = uniqueRequired.reduce((sum, chunk) => sum + Math.max(0, Number(chunk.coordCount || 0)), 0);
  const selectedPartCountSum = uniqueRequired.reduce((sum, chunk) => sum + Math.max(0, Number(chunk.partCount || 0)), 0);
  const selectedEstimatedPathCostSum = uniqueRequired.reduce((sum, chunk) => sum + Math.max(0, Number(chunk.estimatedPathCost || 0)), 0);
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
    selectedFeatureCountSum,
    selectedVisibleFeatureCountSum,
    selectedPoliticalFeatureCountSum,
    selectedPoliticalVisibleFeatureCountSum,
    selectedByteCountSum,
    selectedCoordCountSum,
    selectedPartCountSum,
    selectedEstimatedPathCostSum,
    visibleFeatureSubsetSignature: getVisibleFeatureSubsetSignature(uniqueRequired, viewportBbox),
    politicalVisibleFeatureSubsetSignature: getVisibleFeatureSubsetSignature(selectedPoliticalChunks, viewportBbox),
  };
}

function getChunkFeatureId(feature, fallbackIndex = 0) {
  const rawValue = getFeatureId(feature) || feature?.properties?.feature_id || fallbackIndex;
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

export function mergeScenarioChunkPayloadsForViewport(layerKey, chunkPayloadEntries = [], viewportBbox = [-180, -90, 180, 90]) {
  const normalizedLayerKey = String(layerKey || "").trim().toLowerCase();
  const entries = (Array.isArray(chunkPayloadEntries) ? chunkPayloadEntries : [])
    .map((entry) => ({
      chunk: entry?.chunk || null,
      payload: entry?.payload || null,
    }))
    .filter((entry) => entry.payload);
  if (normalizedLayerKey === "political") {
    // The feature merger keeps the first ID. Precision must win independently
    // of network completion order, with the base filling every remaining ID.
    entries.sort((left, right) => Number(right.chunk?.lod === "detail") - Number(left.chunk?.lod === "detail"));
  }
  if (!entries.length || normalizedLayerKey !== "political") {
    const fullPayload = mergeScenarioChunkPayloads(
      normalizedLayerKey,
      entries.map((entry) => entry.payload),
    );
    const featureCount = Array.isArray(fullPayload?.features) ? fullPayload.features.length : 0;
    return {
      payload: fullPayload,
      stats: {
        visibleFeatureCount: featureCount,
        totalFeatureCount: featureCount,
        clippedChunkCount: 0,
        fullChunkCount: entries.length,
        unboundedChunkCount: 0,
      },
    };
  }

  let visibleFeatureCount = 0;
  let totalFeatureCount = 0;
  let clippedChunkCount = 0;
  let fullChunkCount = 0;
  let unboundedChunkCount = 0;
  const filteredPayloads = entries.map(({ chunk, payload }) => {
    const features = Array.isArray(payload?.features) ? payload.features : [];
    totalFeatureCount += features.length;
    const visibleIndexes = isScenarioPoliticalBaseChunk(chunk) ? null : getChunkVisibleFeatureIndexes(chunk, viewportBbox, {
      expectedFeatureCount: features.length,
    });
    if (!Array.isArray(visibleIndexes)) {
      visibleFeatureCount += features.length;
      unboundedChunkCount += 1;
      fullChunkCount += 1;
      return payload;
    }
    const visibleFeatures = visibleIndexes
      .map((index) => features[index])
      .filter(Boolean);
    visibleFeatureCount += visibleFeatures.length;
    if (visibleFeatures.length < features.length) {
      clippedChunkCount += 1;
    } else {
      fullChunkCount += 1;
    }
    return {
      ...payload,
      features: visibleFeatures,
    };
  });

  return {
    payload: mergeFeatureCollections(filteredPayloads),
    stats: {
      visibleFeatureCount,
      totalFeatureCount,
      clippedChunkCount,
      fullChunkCount,
      unboundedChunkCount,
    },
  };
}
