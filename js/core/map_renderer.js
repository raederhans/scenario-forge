// Hybrid canvas + SVG rendering engine.
import { state } from "./state.js";
import { ColorManager } from "./color_manager.js";
import { LegendManager } from "./legend_manager.js";
import { getTooltipText } from "../ui/i18n.js";

let mapContainer = null;
let mapCanvas = null;
let mapSvg = null;
let interactionRect = null;
let textureOverlay = null;
let tooltip = null;
let context = null;

let projection = null;
let pathSVG = null;
let pathCanvas = null;
let zoomBehavior = null;

let viewportGroup = null;
let specialZonesGroup = null;
let specialZoneEditorGroup = null;
let hoverGroup = null;
let legendGroup = null;
let legendItemsGroup = null;
let legendBackground = null;
let lastLegendKey = null;

const PROJECTION_PRECISION = 0.1;
const PATH_POINT_RADIUS = 2;
const VIEWPORT_CULL_OVERSCAN_PX = 96;
const MAP_PAN_PADDING_PX = 50;
const PROJECTION_FIT_PADDING_RATIO = 0.04;
const MIN_ZOOM_SCALE = 1;
const MAX_ZOOM_SCALE = 50;
const OCEAN_FILL_COLOR = "#aadaff";
const LAND_FILL_COLOR = "#f0f0f0";
const BORDER_FALLBACK_COLOR = "rgba(0, 0, 0, 0.2)";
const GIANT_FEATURE_CULL_RATIO = 0.95;
const GIANT_FEATURE_ALLOWLIST = new Set(["RU", "CA", "CN", "US", "AQ", "ATA"]);
const COUNTRY_CODE_ALIASES = {
  UK: "GB",
  EL: "GR",
};
const WRAP_ARTIFACT_WIDTH_RATIO = 0.9;
const WRAP_ARTIFACT_HEIGHT_RATIO = 0.3;
const WRAP_ARTIFACT_AREA_RATIO = 0.35;
const WRAP_ARTIFACT_ASPECT_MIN = 1.6;
const HIT_GRID_TARGET_COLS = 24;
const HIT_GRID_MIN_CELL_PX = 32;
const HIT_GRID_MAX_CELL_PX = 96;
const HIT_SNAP_RADIUS_PX = 8;
const HIT_MAX_CELLS_PER_ITEM = 400;
const COASTLINE_LOD_LOW_ZOOM_MAX = 1.8;
const COASTLINE_LOD_MID_ZOOM_MAX = 3.2;
const COASTLINE_SIMPLIFY_MID_EPSILON = 0.09;
const COASTLINE_SIMPLIFY_LOW_EPSILON = 0.22;
const COASTLINE_SIMPLIFY_MID_MIN_LENGTH = 0.2;
const COASTLINE_SIMPLIFY_LOW_MIN_LENGTH = 0.45;
const RENDER_PHASE_IDLE = "idle";
const RENDER_PHASE_INTERACTING = "interacting";
const RENDER_PHASE_SETTLING = "settling";
const RENDER_SETTLE_DURATION_MS = 200;
const INTERNAL_BORDER_PROVINCE_MIN_ALPHA = 0.30;
const INTERNAL_BORDER_LOCAL_MIN_ALPHA = 0.22;
const INTERNAL_BORDER_PROVINCE_MIN_WIDTH = 0.52;
const INTERNAL_BORDER_LOCAL_MIN_WIDTH = 0.36;
const PARENT_BORDER_MIN_COVERAGE = 0.70;
const PARENT_BORDER_MAX_DOMINANT_SHARE = 0.90;
const PARENT_BORDER_MIN_RENDERABLE_GROUPS = 2;
const GB_PARENT_MIN_GROUPS = 20;
const GB_ID_PATTERN_RE = /^[A-Z]{2}[A-Z0-9]{3}$/;
const DE_STATE_GROUP_MIN = 12;
const DE_STATE_GROUP_MAX = 20;
const DE_CITY_STATES = new Set(["Berlin", "Hamburg", "Bremen"]);
const OCEAN_PATTERN_BASE_SIZE = 160;
const OCEAN_ADVANCED_STYLES_ENABLED = false;
const OCEAN_MASK_MODE_TOPOLOGY = "topology_ocean";
const OCEAN_MASK_MODE_SPHERE_MINUS_LAND = "sphere_minus_land";
const OCEAN_MASK_MIN_QUALITY = 0.35;
const CONTEXT_LAYER_MIN_SCORE = 0.08;
const LAYER_DIAG_PREFIX = "[layer-resolver]";
const DEFAULT_SPECIAL_ZONE_TYPE = "custom";
const PHYSICAL_PATTERN_BASE_SIZE = 96;
// Keep this list empty by default. Polygon winding issues are repaired dynamically.
const KNOWN_BAD_FEATURE_IDS = new Set();
const DEBUG_MODES = new Set(["PROD", "GEOMETRY", "ARTIFACTS", "ISLANDS", "ID_HASH"]);
const COLOR_HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNC_RE = /^(?:rgb|rgba|hsl|hsla)\([^)]*\)$/i;
const COLOR_NAME_RE = /^[a-z]+$/i;
const RENDER_DIAG_PARAM = "render_diag";
let debugMode = "PROD";
let islandNeighborsCache = {
  topologyRef: null,
  objectRef: null,
  count: 0,
  neighbors: [],
};
const oceanPatternCache = new Map();
const physicalPatternCache = new Map();
const layerResolverCache = {
  primaryRef: null,
  detailRef: null,
  bundleMode: null,
};
const renderDiag = {
  enabled: false,
  seenKeys: new Set(),
  skippedByReason: new Map(),
  skippedByCountry: new Map(),
  sampleByReason: new Map(),
};
const rewoundFeatureLogKeys = new Set();

function readSearchParam(name) {
  const search = globalThis?.location?.search || "";
  if (!search || !globalThis.URLSearchParams) return "";
  try {
    const params = new globalThis.URLSearchParams(search);
    return String(params.get(name) || "").trim().toLowerCase();
  } catch (_error) {
    return "";
  }
}

function isRenderDiagEnabled() {
  const raw = readSearchParam(RENDER_DIAG_PARAM);
  return ["1", "true", "yes", "on"].includes(raw);
}

function resetRenderDiagnostics() {
  renderDiag.enabled = isRenderDiagEnabled();
  renderDiag.seenKeys = new Set();
  renderDiag.skippedByReason = new Map();
  renderDiag.skippedByCountry = new Map();
  renderDiag.sampleByReason = new Map();
  if (!renderDiag.enabled) {
    delete globalThis.__mapRenderDiag;
  } else {
    globalThis.__mapRenderDiag = {
      enabled: true,
      skippedTotal: 0,
      skippedByReason: {},
      skippedByCountry: {},
      sampleByReason: {},
    };
    console.info(`[map_renderer] ${RENDER_DIAG_PARAM}=1 enabled. Collecting skip diagnostics.`);
  }
}

function recordSkipDiagnostic(feature, decision) {
  if (!renderDiag.enabled || !decision?.skip) return;
  const featureId = decision.featureId || getFeatureId(feature) || "(unknown)";
  const reason = decision.reason || "unknown";
  const country = decision.countryCode || getFeatureCountryCodeNormalized(feature) || "UNK";
  const key = `${reason}::${featureId}`;
  if (renderDiag.seenKeys.has(key)) return;
  renderDiag.seenKeys.add(key);

  renderDiag.skippedByReason.set(reason, (renderDiag.skippedByReason.get(reason) || 0) + 1);
  renderDiag.skippedByCountry.set(country, (renderDiag.skippedByCountry.get(country) || 0) + 1);

  const reasonSamples = renderDiag.sampleByReason.get(reason) || [];
  if (reasonSamples.length < 30) {
    reasonSamples.push({
      id: featureId,
      country,
      name: String(feature?.properties?.name || "").trim(),
      bounds: decision.bounds || null,
    });
    renderDiag.sampleByReason.set(reason, reasonSamples);
  }

  globalThis.__mapRenderDiag = {
    enabled: true,
    skippedTotal: renderDiag.seenKeys.size,
    skippedByReason: Object.fromEntries(renderDiag.skippedByReason.entries()),
    skippedByCountry: Object.fromEntries(renderDiag.skippedByCountry.entries()),
    sampleByReason: Object.fromEntries(renderDiag.sampleByReason.entries()),
  };
}

function canonicalCountryCode(rawCode) {
  const code = String(rawCode || "").trim().toUpperCase().replace(/[^A-Z]/g, "");
  if (!code) return "";
  return COUNTRY_CODE_ALIASES[code] || code;
}

function getColorByCanonicalCountryCode(colorMap, canonicalCode) {
  if (!colorMap || !canonicalCode) return null;
  if (colorMap[canonicalCode]) return colorMap[canonicalCode];
  for (const [alias, canonical] of Object.entries(COUNTRY_CODE_ALIASES)) {
    if (canonical === canonicalCode && colorMap[alias]) {
      return colorMap[alias];
    }
  }
  return null;
}

function getFeatureId(feature) {
  const raw =
    feature?.properties?.id ??
    feature?.properties?.NUTS_ID ??
    feature?.id;
  if (raw === null || raw === undefined) return null;
  const text = String(raw).trim();
  return text.length > 0 ? text : null;
}

function extractCountryCodeFromId(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";

  const prefix = text.split(/[-_]/)[0];
  if (/^[A-Z]{2,3}$/.test(prefix)) {
    return prefix;
  }

  const alphaPrefix = prefix.match(/^[A-Z]{2,3}/);
  return alphaPrefix ? alphaPrefix[0] : "";
}

function getFeatureCountryCodeNormalized(feature) {
  const props = feature?.properties || {};
  const direct = (
    props.cntr_code ||
    props.CNTR_CODE ||
    props.iso_a2 ||
    props.ISO_A2 ||
    props.iso_a2_eh ||
    props.ISO_A2_EH ||
    props.adm0_a2 ||
    props.ADM0_A2 ||
    ""
  );
  const normalizedDirect = canonicalCountryCode(direct);
  if (/^[A-Z]{2,3}$/.test(normalizedDirect) && normalizedDirect !== "ZZ" && normalizedDirect !== "XX") {
    return normalizedDirect;
  }

  return canonicalCountryCode(
    extractCountryCodeFromId(props.id) ||
    extractCountryCodeFromId(props.NUTS_ID) ||
    extractCountryCodeFromId(feature?.id)
  );
}

function getFeatureCountryCode(feature) {
  return getFeatureCountryCodeNormalized(feature);
}

function getFeatureRegionTag(feature) {
  const props = feature?.properties || {};
  return (
    props.subregion ||
    props.SUBREGION ||
    props.mapcolor7 ||
    props.MAPCOLOR7 ||
    props.mapcolor8 ||
    props.MAPCOLOR8 ||
    props.mapcolor9 ||
    props.MAPCOLOR9 ||
    props.region_un ||
    props.REGION_UN ||
    props.region_wb ||
    props.REGION_WB ||
    props.continent ||
    props.CONTINENT ||
    props.cntr_code ||
    props.CNTR_CODE ||
    "Unknown"
  );
}

function getColorsHash() {
  const countryEntries = Object.entries(state.countryBaseColors || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const featureEntries = Object.entries(state.featureOverrides || {}).sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify([countryEntries, featureEntries]);
}

function isProbablyCanvasColor(value) {
  if (typeof value !== "string") return false;
  const candidate = value.trim();
  if (!candidate || candidate.includes("var(")) return false;
  if (COLOR_HEX_RE.test(candidate)) {
    return true;
  }
  if (!COLOR_FUNC_RE.test(candidate) && !COLOR_NAME_RE.test(candidate)) {
    return false;
  }
  if (globalThis.CSS?.supports) {
    return globalThis.CSS.supports("color", candidate);
  }
  return false;
}

function getSafeCanvasColor(value, fallback) {
  if (isProbablyCanvasColor(value)) {
    return String(value).trim();
  }
  return fallback;
}

function sanitizeColorMap(input) {
  const sanitized = {};
  if (!input || typeof input !== "object") return sanitized;

  for (const [rawId, rawColor] of Object.entries(input)) {
    const id = String(rawId || "").trim();
    if (!id) continue;
    const color = getSafeCanvasColor(rawColor, null);
    if (!color) continue;
    sanitized[id] = color;
  }

  return sanitized;
}

function sanitizeCountryColorMap(input) {
  const sanitized = {};
  if (!input || typeof input !== "object") return sanitized;

  for (const [rawCode, rawColor] of Object.entries(input)) {
    const code = canonicalCountryCode(rawCode);
    if (!code) continue;
    const color = getSafeCanvasColor(rawColor, null);
    if (!color) continue;
    sanitized[code] = color;
  }

  return sanitized;
}

function normalizeDebugMode(modeName) {
  const normalized = String(modeName || "PROD").trim().toUpperCase();
  return DEBUG_MODES.has(normalized) ? normalized : "PROD";
}

function stringHash(input) {
  const text = String(input || "");
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function hashToColor(token) {
  const hue = stringHash(token) % 360;
  return `hsl(${hue}, 70%, 58%)`;
}

function getIslandNeighborGraph() {
  const object = state.topology?.objects?.political;
  const geometries = object?.geometries || [];
  if (!object || !Array.isArray(geometries) || geometries.length === 0) {
    return [];
  }

  if (
    islandNeighborsCache.topologyRef === state.topology &&
    islandNeighborsCache.objectRef === object &&
    islandNeighborsCache.count === geometries.length &&
    Array.isArray(islandNeighborsCache.neighbors)
  ) {
    return islandNeighborsCache.neighbors;
  }

  let neighbors = [];
  if (
    Array.isArray(object.computed_neighbors) &&
    object.computed_neighbors.length === geometries.length
  ) {
    neighbors = object.computed_neighbors;
  } else if (globalThis.topojson?.neighbors) {
    try {
      neighbors = globalThis.topojson.neighbors(geometries) || [];
    } catch (error) {
      neighbors = [];
    }
  }

  if (!Array.isArray(neighbors) || neighbors.length !== geometries.length) {
    neighbors = new Array(geometries.length).fill(null).map(() => []);
  }

  islandNeighborsCache = {
    topologyRef: state.topology,
    objectRef: object,
    count: geometries.length,
    neighbors,
  };
  return neighbors;
}

function setDebugMode(modeName) {
  const nextMode = normalizeDebugMode(modeName);
  if (debugMode === nextMode) return;
  debugMode = nextMode;
  state.debugMode = nextMode;
  if (pathSVG) {
    buildSpatialIndex();
  }
  if (context) {
    render();
  }
}

function getLogicalCanvasDimensions() {
  const dpr = Math.max(state.dpr || 1, 1);
  const widthFromCanvas = context?.canvas?.width ? context.canvas.width / dpr : 0;
  const heightFromCanvas = context?.canvas?.height ? context.canvas.height / dpr : 0;
  const width = Math.max(state.width || 0, widthFromCanvas || 0, 1);
  const height = Math.max(state.height || 0, heightFromCanvas || 0, 1);
  return [width, height];
}

function nowMs() {
  if (globalThis.performance?.now) {
    return globalThis.performance.now();
  }
  return Date.now();
}

function ensureProjectedBoundsCache() {
  if (!(state.projectedBoundsById instanceof Map)) {
    state.projectedBoundsById = new Map();
  }
  return state.projectedBoundsById;
}

function clearProjectedBoundsCache() {
  ensureProjectedBoundsCache().clear();
}

function computeProjectedFeatureBounds(feature) {
  const pathRef = pathCanvas || pathSVG;
  if (!pathRef || !feature) return null;

  let bounds = null;
  try {
    bounds = pathRef.bounds(feature);
  } catch (error) {
    return null;
  }

  if (!bounds || bounds.length !== 2) return null;
  const minX = bounds[0][0];
  const minY = bounds[0][1];
  const maxX = bounds[1][0];
  const maxY = bounds[1][1];
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;

  const featureWidth = maxX - minX;
  const featureHeight = maxY - minY;
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: featureWidth,
    height: featureHeight,
    area: Math.max(0, featureWidth) * Math.max(0, featureHeight),
  };
}

function rebuildProjectedBoundsCache() {
  clearProjectedBoundsCache();
  if (!state.landData?.features?.length) return;

  const cache = ensureProjectedBoundsCache();
  state.landData.features.forEach((feature) => {
    const featureId = getFeatureId(feature);
    if (!featureId) return;
    const bounds = computeProjectedFeatureBounds(feature);
    if (!bounds) return;
    cache.set(featureId, bounds);
  });
}

function getProjectedFeatureBounds(feature, { featureId = null, allowCompute = true } = {}) {
  const resolvedFeatureId = featureId || getFeatureId(feature);
  if (resolvedFeatureId) {
    const cache = ensureProjectedBoundsCache();
    if (cache.has(resolvedFeatureId)) {
      return cache.get(resolvedFeatureId) || null;
    }
    if (!allowCompute) return null;
    const computed = computeProjectedFeatureBounds(feature);
    if (computed) {
      cache.set(resolvedFeatureId, computed);
    }
    return computed;
  }

  if (!allowCompute) return null;
  return computeProjectedFeatureBounds(feature);
}

function isKnownBadFeatureId(featureId) {
  if (!featureId) return false;
  return KNOWN_BAD_FEATURE_IDS.has(String(featureId));
}

function isAdmin0ShellFeature(feature, featureId) {
  const candidate = String(
    feature?.properties?.id ?? featureId ?? feature?.id ?? ""
  ).trim().toUpperCase();
  return /^[A-Z]{2,3}$/.test(candidate);
}

function isGiantFeature(feature, canvasWidth, canvasHeight, boundsOverride = null) {
  const bounds = boundsOverride || getProjectedFeatureBounds(feature);
  if (!bounds) return false;
  return (
    bounds.width > canvasWidth * GIANT_FEATURE_CULL_RATIO &&
    bounds.height > canvasHeight * GIANT_FEATURE_CULL_RATIO
  );
}

function isProjectedWrapArtifact(feature, canvasWidth, canvasHeight, boundsOverride = null) {
  const bounds = boundsOverride || getProjectedFeatureBounds(feature);
  if (!bounds) return false;
  if (canvasWidth <= 0 || canvasHeight <= 0) return false;

  const widthRatio = bounds.width / canvasWidth;
  const heightRatio = bounds.height / canvasHeight;
  const areaRatio = bounds.area / (canvasWidth * canvasHeight);
  const aspectRatio = bounds.width / Math.max(bounds.height, 1);

  if (
    widthRatio >= WRAP_ARTIFACT_WIDTH_RATIO &&
    heightRatio >= WRAP_ARTIFACT_HEIGHT_RATIO
  ) {
    return true;
  }

  return (
    widthRatio >= WRAP_ARTIFACT_WIDTH_RATIO * 0.92 &&
    areaRatio >= WRAP_ARTIFACT_AREA_RATIO &&
    aspectRatio >= WRAP_ARTIFACT_ASPECT_MIN
  );
}

function evaluateSkipFeature(feature, canvasWidth, canvasHeight, { forceProd = false } = {}) {
  if (!forceProd && debugMode !== "PROD") {
    return { skip: false, reason: null, featureId: getFeatureId(feature), countryCode: "" };
  }

  const featureId = getFeatureId(feature);
  if (isKnownBadFeatureId(featureId)) {
    return {
      skip: true,
      reason: "known_bad_id",
      featureId,
      countryCode: getFeatureCountryCodeNormalized(feature),
      bounds: null,
    };
  }

  const bounds = getProjectedFeatureBounds(feature, { featureId });
  if (!bounds) {
    return {
      skip: false,
      reason: null,
      featureId,
      countryCode: getFeatureCountryCodeNormalized(feature),
      bounds: null,
    };
  }

  const giant = isGiantFeature(feature, canvasWidth, canvasHeight, bounds);
  const wrapArtifact = isProjectedWrapArtifact(feature, canvasWidth, canvasHeight, bounds);
  if (!giant && !wrapArtifact) {
    return {
      skip: false,
      reason: null,
      featureId,
      countryCode: getFeatureCountryCodeNormalized(feature),
      bounds,
    };
  }

  const countryCode = getFeatureCountryCodeNormalized(feature);
  const isTrustedAdmin0Shell =
    GIANT_FEATURE_ALLOWLIST.has(countryCode) &&
    isAdmin0ShellFeature(feature, featureId);
  if (isTrustedAdmin0Shell) {
    return {
      skip: false,
      reason: null,
      featureId,
      countryCode,
      bounds,
    };
  }

  let reason = "skip_unknown";
  if (giant && wrapArtifact) reason = "giant_wrap_artifact";
  else if (giant) reason = "giant_feature";
  else if (wrapArtifact) reason = "wrap_artifact";

  return {
    skip: true,
    reason,
    featureId,
    countryCode,
    bounds,
  };
}

function shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd = false } = {}) {
  const decision = evaluateSkipFeature(feature, canvasWidth, canvasHeight, { forceProd });
  recordSkipDiagnostic(feature, decision);
  return Boolean(decision.skip);
}

function getRenderableLandFeatures(canvasWidth, canvasHeight, { forceProd = false } = {}) {
  if (!state.landData?.features?.length) return [];
  return state.landData.features.filter(
    (feature) => !shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd })
  );
}

function getPoliticalFeatureCollection(topology, sourceName) {
  if (!topology?.objects?.political || !globalThis.topojson) {
    return { type: "FeatureCollection", features: [] };
  }
  const collection = globalThis.topojson.feature(topology, topology.objects.political);
  const features = Array.isArray(collection?.features) ? collection.features : [];
  return {
    type: "FeatureCollection",
    features: features.map((feature) => {
      const normalizedFeature = normalizeFeatureGeometry(feature, { sourceLabel: sourceName });
      return {
        ...normalizedFeature,
        properties: {
          ...(normalizedFeature?.properties || {}),
          __source: sourceName,
        },
      };
    }),
  };
}

function parseReplaceFeatureIds(rawValue) {
  if (Array.isArray(rawValue)) {
    return rawValue
      .map((item) => String(item || "").trim())
      .filter(Boolean);
  }

  const text = String(rawValue || "").trim();
  if (!text) return [];
  return text
    .split(/[,\n;|]+/)
    .map((item) => String(item || "").trim())
    .filter(Boolean);
}

function reverseGeometryRings(geometry) {
  if (!geometry || !geometry.type || !geometry.coordinates) return null;
  if (geometry.type === "Polygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((ring) =>
        Array.isArray(ring) ? [...ring].reverse() : ring
      ),
    };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        Array.isArray(polygon)
          ? polygon.map((ring) => (Array.isArray(ring) ? [...ring].reverse() : ring))
          : polygon
      ),
    };
  }
  return null;
}

function normalizeFeatureGeometry(feature, { sourceLabel = "detail" } = {}) {
  if (!feature?.geometry || !globalThis.d3?.geoArea) {
    return feature;
  }

  let area = null;
  try {
    area = globalThis.d3.geoArea(feature);
  } catch (_error) {
    return feature;
  }
  if (!Number.isFinite(area) || area <= Math.PI * 2) {
    return feature;
  }

  const rewoundGeometry = reverseGeometryRings(feature.geometry);
  if (!rewoundGeometry) return feature;
  const rewoundFeature = {
    ...feature,
    geometry: rewoundGeometry,
  };

  try {
    const rewoundArea = globalThis.d3.geoArea(rewoundFeature);
    if (Number.isFinite(rewoundArea) && rewoundArea < area) {
      const featureId = getFeatureId(feature) || "(unknown)";
      const logKey = `${sourceLabel}::${featureId}`;
      if (renderDiag.enabled && !rewoundFeatureLogKeys.has(logKey)) {
        rewoundFeatureLogKeys.add(logKey);
        console.warn(
          `[map_renderer] Rewound ${sourceLabel} feature orientation for ${featureId}. area=${area.toFixed(5)} -> ${rewoundArea.toFixed(5)}`
        );
      }
      return rewoundFeature;
    }
  } catch (_error) {
    return feature;
  }
  return feature;
}

function mergeOverrideFeatures(baseFeatures, overrideCollection) {
  const order = [];
  const featureById = new Map();

  baseFeatures.forEach((feature) => {
    const featureId = getFeatureId(feature);
    if (!featureId || featureById.has(featureId)) return;
    order.push(featureId);
    featureById.set(featureId, feature);
  });

  let applied = 0;
  let replaced = 0;

  const overrides = Array.isArray(overrideCollection?.features)
    ? overrideCollection.features
    : [];
  overrides.forEach((feature) => {
    if (!feature?.geometry) return;
    const normalizedFeature = normalizeFeatureGeometry(feature, { sourceLabel: "ru_override" });
    const featureId = getFeatureId(normalizedFeature);
    if (!featureId) return;

    const replaceIds = parseReplaceFeatureIds(
      normalizedFeature?.properties?.replace_ids ??
      normalizedFeature?.properties?.replaceIds ??
      ""
    );
    replaceIds.forEach((replaceId) => {
      if (featureById.delete(replaceId)) {
        replaced += 1;
      }
    });

    const existing = featureById.has(featureId);
    featureById.set(featureId, {
      ...normalizedFeature,
      properties: {
        ...(normalizedFeature?.properties || {}),
        __source: "ru_override",
      },
    });
    if (!existing) {
      order.push(featureId);
    }
    applied += 1;
  });

  if (applied > 0) {
    console.info(
      `[map_renderer] Applied RU city overrides: injected=${applied}, replaced=${replaced}.`
    );
  }

  return order
    .filter((id) => featureById.has(id))
    .map((id) => featureById.get(id));
}

function composePoliticalFeatures(primaryTopology, detailTopology, overrideCollection = null) {
  const primaryCollection = getPoliticalFeatureCollection(primaryTopology, "primary");
  if (!detailTopology) {
    const baseFeatures = primaryCollection.features;
    const features = overrideCollection
      ? mergeOverrideFeatures(baseFeatures, overrideCollection)
      : baseFeatures;
    return {
      type: "FeatureCollection",
      features,
    };
  }

  const detailCollection = getPoliticalFeatureCollection(detailTopology, "detail");
  const detailCountries = new Set();
  detailCollection.features.forEach((feature) => {
    const code = getFeatureCountryCodeNormalized(feature);
    if (code) detailCountries.add(code);
  });

  const seen = new Set();
  const features = [];

  const pushIfUnique = (feature) => {
    const id = getFeatureId(feature);
    if (!id) return;
    if (seen.has(id)) return;
    seen.add(id);
    features.push(feature);
  };

  detailCollection.features.forEach(pushIfUnique);
  primaryCollection.features.forEach((feature) => {
    const code = getFeatureCountryCodeNormalized(feature);
    if (code && detailCountries.has(code)) return;
    pushIfUnique(feature);
  });

  const mergedFeatures = overrideCollection
    ? mergeOverrideFeatures(features, overrideCollection)
    : features;

  return {
    type: "FeatureCollection",
    features: mergedFeatures,
  };
}

function collectCountryCoverageStats(features = []) {
  const detailCountries = new Set();
  const primaryCountries = new Set();
  let detailFeatureCount = 0;
  let primaryFeatureCount = 0;

  features.forEach((feature) => {
    const countryCode = getFeatureCountryCodeNormalized(feature);
    if (!countryCode) return;
    const source = String(feature?.properties?.__source || "primary");
    if (source === "detail") {
      detailCountries.add(countryCode);
      detailFeatureCount += 1;
    } else {
      primaryCountries.add(countryCode);
      primaryFeatureCount += 1;
    }
  });

  const totalCountries = new Set([...detailCountries, ...primaryCountries]).size;
  return {
    totalCountries,
    detailCountries: detailCountries.size,
    primaryCountries: primaryCountries.size,
    totalFeatures: features.length,
    detailFeatures: detailFeatureCount,
    primaryFeatures: primaryFeatureCount,
  };
}

function clearRenderPhaseTimer() {
  if (state.renderPhaseTimerId) {
    globalThis.clearTimeout(state.renderPhaseTimerId);
    state.renderPhaseTimerId = null;
  }
}

function setRenderPhase(phase) {
  state.renderPhase = phase;
  state.phaseEnteredAt = nowMs();
  state.isInteracting = phase === RENDER_PHASE_INTERACTING;
}

function scheduleRenderPhaseIdle() {
  clearRenderPhaseTimer();
  state.renderPhaseTimerId = globalThis.setTimeout(() => {
    state.renderPhaseTimerId = null;
    setRenderPhase(RENDER_PHASE_IDLE);
    render();
  }, RENDER_SETTLE_DURATION_MS);
}

function getResolvedFeatureColor(feature, id) {
  const direct = getSafeCanvasColor(state.featureOverrides?.[id], null);
  if (direct) return direct;

  const code = getFeatureCountryCodeNormalized(feature);
  if (!code) return null;

  return getSafeCanvasColor(state.countryBaseColors?.[code], null);
}

function rebuildResolvedColors() {
  state.countryBaseColors = sanitizeCountryColorMap(state.countryBaseColors);
  state.featureOverrides = sanitizeColorMap(state.featureOverrides);

  const nextColors = {};
  if (!state.landData?.features?.length) {
    state.colors = nextColors;
    return nextColors;
  }

  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  state.landData.features.forEach((feature, index) => {
    const id = getFeatureId(feature) || `feature-${index}`;
    if (!id) return;
    if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) return;
    const resolved = getResolvedFeatureColor(feature, id);
    if (resolved) {
      nextColors[id] = resolved;
    }
  });

  state.colors = nextColors;
  return nextColors;
}

function refreshColorState({ renderNow = true } = {}) {
  rebuildResolvedColors();
  if (renderNow && context) {
    render();
  }
}

function pathBoundsInScreen(feature) {
  if (!pathSVG) return false;
  const bounds = getProjectedFeatureBounds(feature, { allowCompute: false }) || getProjectedFeatureBounds(feature);
  if (!bounds) return false;
  const minX = bounds.minX * state.zoomTransform.k + state.zoomTransform.x;
  const minY = bounds.minY * state.zoomTransform.k + state.zoomTransform.y;
  const maxX = bounds.maxX * state.zoomTransform.k + state.zoomTransform.x;
  const maxY = bounds.maxY * state.zoomTransform.k + state.zoomTransform.y;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return false;

  const overscan = Math.max(
    VIEWPORT_CULL_OVERSCAN_PX,
    Math.min(state.width, state.height) * 0.08
  );

  return !(
    maxX < -overscan ||
    maxY < -overscan ||
    minX > state.width + overscan ||
    minY > state.height + overscan
  );
}

function getLayerFeatureCollection(topology, layerName) {
  if (!topology?.objects || !globalThis.topojson) return null;
  const object = topology.objects[layerName];
  if (!object) return null;
  try {
    const collection = globalThis.topojson.feature(topology, object);
    if (!collection || !Array.isArray(collection.features)) return null;
    return collection;
  } catch (error) {
    console.warn(`${LAYER_DIAG_PREFIX} Failed to decode layer "${layerName}":`, error);
    return null;
  }
}

function computeLayerCoverageScore(collection) {
  if (!collection?.features?.length || !globalThis.d3?.geoBounds) return 0;
  try {
    const [[minLon, minLat], [maxLon, maxLat]] = globalThis.d3.geoBounds(collection);
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return 0;
    let width = maxLon - minLon;
    if (width < 0) width += 360;
    const height = Math.max(0, maxLat - minLat);
    const normalizedArea = clamp((width * height) / (360 * 180), 0, 1);
    const densityBoost = Math.min(1, Math.log10(collection.features.length + 1) / 4);
    return clamp(normalizedArea * 0.8 + densityBoost * 0.2, 0, 1);
  } catch (_error) {
    return 0;
  }
}

function pickBestLayerSource(primaryCollection, detailCollection, policy = {}) {
  const minScore = Number.isFinite(Number(policy.minScore))
    ? Number(policy.minScore)
    : CONTEXT_LAYER_MIN_SCORE;
  const preferDetailWhenPrimaryEmpty = !!policy.preferDetailWhenPrimaryEmpty;
  const primaryCount = Array.isArray(primaryCollection?.features) ? primaryCollection.features.length : 0;
  const detailCount = Array.isArray(detailCollection?.features) ? detailCollection.features.length : 0;
  const primaryScore = computeLayerCoverageScore(primaryCollection);
  const detailScore = computeLayerCoverageScore(detailCollection);

  if (!primaryCount && !detailCount) {
    return {
      collection: null,
      source: "none",
      primaryScore,
      detailScore,
      primaryCount,
      detailCount,
    };
  }

  if (!primaryCount && detailCount) {
    return {
      collection: detailCollection,
      source: "detail",
      primaryScore,
      detailScore,
      primaryCount,
      detailCount,
    };
  }

  if (primaryCount && !detailCount) {
    return {
      collection: primaryCollection,
      source: "primary",
      primaryScore,
      detailScore,
      primaryCount,
      detailCount,
    };
  }

  if (preferDetailWhenPrimaryEmpty && primaryCount === 0 && detailCount > 0) {
    return {
      collection: detailCollection,
      source: "detail",
      primaryScore,
      detailScore,
      primaryCount,
      detailCount,
    };
  }

  if (primaryScore >= minScore && primaryScore >= detailScore * 0.65) {
    return {
      collection: primaryCollection,
      source: "primary",
      primaryScore,
      detailScore,
      primaryCount,
      detailCount,
    };
  }

  if (detailScore > primaryScore || detailCount > primaryCount * 1.25) {
    return {
      collection: detailCollection,
      source: "detail",
      primaryScore,
      detailScore,
      primaryCount,
      detailCount,
    };
  }

  return {
    collection: primaryCollection,
    source: "primary",
    primaryScore,
    detailScore,
    primaryCount,
    detailCount,
  };
}

function resolveContextLayerData(layerName) {
  if (
    layerName === "special_zones" &&
    Array.isArray(state.specialZonesExternalData?.features)
  ) {
    if (!state.layerDataDiagnostics || typeof state.layerDataDiagnostics !== "object") {
      state.layerDataDiagnostics = {};
    }
    if (!state.contextLayerSourceByName || typeof state.contextLayerSourceByName !== "object") {
      state.contextLayerSourceByName = {};
    }
    state.contextLayerSourceByName[layerName] = "external";
    state.layerDataDiagnostics[layerName] = {
      source: "external",
      primaryCount: 0,
      detailCount: state.specialZonesExternalData.features.length,
      primaryScore: 0,
      detailScore: 1,
    };
    return state.specialZonesExternalData;
  }

  const primaryTopology = state.topologyPrimary || state.topology;
  const detailTopology = state.topologyDetail;
  const primaryCollection = getLayerFeatureCollection(primaryTopology, layerName);
  const detailCollection = getLayerFeatureCollection(detailTopology, layerName);
  const pick = pickBestLayerSource(primaryCollection, detailCollection, {
    minScore: layerName === "special_zones" ? 0 : CONTEXT_LAYER_MIN_SCORE,
    preferDetailWhenPrimaryEmpty: layerName === "special_zones",
  });

  if (!state.layerDataDiagnostics || typeof state.layerDataDiagnostics !== "object") {
    state.layerDataDiagnostics = {};
  }
  if (!state.contextLayerSourceByName || typeof state.contextLayerSourceByName !== "object") {
    state.contextLayerSourceByName = {};
  }

  state.contextLayerSourceByName[layerName] = pick.source;
  state.layerDataDiagnostics[layerName] = {
    source: pick.source,
    primaryCount: pick.primaryCount,
    detailCount: pick.detailCount,
    primaryScore: Number(pick.primaryScore.toFixed(3)),
    detailScore: Number(pick.detailScore.toFixed(3)),
  };

  return pick.collection;
}

function ensureLayerDataFromTopology() {
  const primaryTopology = state.topologyPrimary || state.topology;
  if (!primaryTopology || !globalThis.topojson) return;

  if (!state.manualSpecialZones || state.manualSpecialZones.type !== "FeatureCollection") {
    state.manualSpecialZones = { type: "FeatureCollection", features: [] };
  }
  if (!Array.isArray(state.manualSpecialZones.features)) {
    state.manualSpecialZones.features = [];
  }

  const sameSource =
    layerResolverCache.primaryRef === primaryTopology &&
    layerResolverCache.detailRef === state.topologyDetail &&
    layerResolverCache.bundleMode === state.topologyBundleMode;
  if (sameSource) {
    return;
  }

  state.oceanData = resolveContextLayerData("ocean");
  state.landBgData = resolveContextLayerData("land");
  state.riversData = resolveContextLayerData("rivers");
  state.urbanData = resolveContextLayerData("urban");
  state.physicalData = resolveContextLayerData("physical");
  state.specialZonesData = resolveContextLayerData("special_zones");

  const diag = state.layerDataDiagnostics || {};
  console.info(
    `${LAYER_DIAG_PREFIX} sources: ocean=${diag.ocean?.source || "none"}, `
      + `land=${diag.land?.source || "none"}, rivers=${diag.rivers?.source || "none"}, `
      + `urban=${diag.urban?.source || "none"}, physical=${diag.physical?.source || "none"}, `
      + `special_zones=${diag.special_zones?.source || "none"}`
  );

  // Composite mode owns state.landData and must not be overwritten by primary political-only data.
  if (state.topologyBundleMode !== "composite" && primaryTopology?.objects?.political) {
    const expectedCount = Array.isArray(primaryTopology.objects.political.geometries)
      ? primaryTopology.objects.political.geometries.length
      : 0;
    const currentCount = Array.isArray(state.landData?.features)
      ? state.landData.features.length
      : 0;
    if (currentCount !== expectedCount) {
      state.landData = globalThis.topojson.feature(primaryTopology, primaryTopology.objects.political);
    }
  }

  layerResolverCache.primaryRef = primaryTopology;
  layerResolverCache.detailRef = state.topologyDetail;
  layerResolverCache.bundleMode = state.topologyBundleMode;

  if (typeof state.updateSpecialZoneEditorUIFn === "function") {
    state.updateSpecialZoneEditorUIFn();
  }
}

function createCanvasElement() {
  const canvas = document.createElement("canvas");
  canvas.id = "map-canvas";
  canvas.className = "map-layer";
  canvas.style.position = "absolute";
  canvas.style.inset = "0";
  canvas.style.display = "block";
  canvas.style.zIndex = "0";
  return canvas;
}

function createSvgElement() {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("id", "map-svg");
  svg.classList.add("map-layer", "map-layer-top");
  svg.style.position = "absolute";
  svg.style.inset = "0";
  svg.style.display = "block";
  svg.style.zIndex = "1";
  svg.style.pointerEvents = "none";
  return svg;
}

function ensureHybridLayers() {
  const legacySpecialZones = document.getElementById("specialZonesSvg");
  if (legacySpecialZones) legacySpecialZones.remove();
  const legacyLegend = document.getElementById("legendSvg");
  if (legacyLegend) legacyLegend.remove();

  const legacyColorCanvas = document.getElementById("colorCanvas");
  const legacyLineCanvas = document.getElementById("lineCanvas");

  mapCanvas = mapContainer.querySelector("#map-canvas");
  if (!mapCanvas) {
    mapCanvas = createCanvasElement();
    const anchor = legacyColorCanvas || legacyLineCanvas || textureOverlay || null;
    if (anchor && mapContainer.contains(anchor)) {
      mapContainer.insertBefore(mapCanvas, anchor);
    } else {
      mapContainer.appendChild(mapCanvas);
    }
  }
  mapCanvas.style.display = "block";
  mapCanvas.style.zIndex = "0";

  if (legacyColorCanvas && legacyColorCanvas !== mapCanvas) {
    legacyColorCanvas.style.display = "none";
    legacyColorCanvas.style.pointerEvents = "none";
  }
  if (legacyLineCanvas) {
    legacyLineCanvas.style.display = "none";
    legacyLineCanvas.style.pointerEvents = "none";
  }

  mapSvg = mapContainer.querySelector("#map-svg");
  if (!mapSvg) {
    mapSvg = createSvgElement();
    if (textureOverlay && mapContainer.contains(textureOverlay)) {
      mapContainer.insertBefore(mapSvg, textureOverlay);
    } else {
      mapContainer.appendChild(mapSvg);
    }
  }
  mapSvg.style.display = "block";
  mapSvg.style.zIndex = "1";

  const svg = globalThis.d3.select(mapSvg);
  svg.style("pointer-events", "none");

  viewportGroup = svg.select("g.viewport-layer");
  if (viewportGroup.empty()) {
    viewportGroup = svg.append("g").attr("class", "viewport-layer");
  }
  viewportGroup.style("pointer-events", "none");

  specialZonesGroup = viewportGroup.select("g.special-zones-layer");
  if (specialZonesGroup.empty()) {
    specialZonesGroup = viewportGroup.append("g").attr("class", "special-zones-layer");
  }
  specialZonesGroup.style("pointer-events", "none");

  specialZoneEditorGroup = viewportGroup.select("g.special-zone-editor-layer");
  if (specialZoneEditorGroup.empty()) {
    specialZoneEditorGroup = viewportGroup.append("g").attr("class", "special-zone-editor-layer");
  }
  specialZoneEditorGroup.style("pointer-events", "none");

  hoverGroup = viewportGroup.select("g.hover-layer");
  if (hoverGroup.empty()) {
    hoverGroup = viewportGroup.append("g").attr("class", "hover-layer");
  }
  hoverGroup.style("pointer-events", "none");

  legendGroup = svg.select("g.legend-group");
  if (legendGroup.empty()) {
    legendGroup = svg.append("g").attr("class", "legend-group");
  }
  legendGroup.style("pointer-events", "none");

  legendBackground = legendGroup.select("rect.legend-bg");
  if (legendBackground.empty()) {
    legendBackground = legendGroup
      .append("rect")
      .attr("class", "legend-bg")
      .attr("fill", "rgba(255,255,255,0.85)")
      .attr("stroke", "#d1d5db")
      .attr("stroke-width", 1)
      .attr("rx", 8)
      .attr("ry", 8);
  }

  legendItemsGroup = legendGroup.select("g.legend-items");
  if (legendItemsGroup.empty()) {
    legendItemsGroup = legendGroup.append("g").attr("class", "legend-items");
  }

  interactionRect = svg.select("rect.interaction-layer");
  if (interactionRect.empty()) {
    interactionRect = svg
      .append("rect")
      .attr("class", "interaction-layer")
      .attr("fill", "transparent");
  }
  interactionRect.style("pointer-events", "all");
}

function setCanvasSize() {
  if (!mapCanvas || !mapSvg) return;

  state.dpr = globalThis.devicePixelRatio || 1;
  const rect = mapContainer?.getBoundingClientRect?.();
  const measuredWidth = rect?.width || mapContainer?.clientWidth || globalThis.innerWidth;
  const measuredHeight = rect?.height || mapContainer?.clientHeight || globalThis.innerHeight;

  state.width = Math.round(measuredWidth);
  state.height = Math.round(measuredHeight);

  if (state.width < 100) state.width = Math.max(100, globalThis.innerWidth - 580);
  if (state.height < 100) state.height = Math.max(100, globalThis.innerHeight);

  const scaledW = Math.floor(state.width * state.dpr);
  const scaledH = Math.floor(state.height * state.dpr);

  mapCanvas.width = scaledW;
  mapCanvas.height = scaledH;
  mapCanvas.style.width = `${state.width}px`;
  mapCanvas.style.height = `${state.height}px`;
  oceanPatternCache.clear();
  clearProjectedBoundsCache();

  const svg = globalThis.d3.select(mapSvg);
  svg.attr("width", state.width).attr("height", state.height);
  interactionRect.attr("x", 0).attr("y", 0).attr("width", state.width).attr("height", state.height);
}

function rebuildDynamicBorders() {
  state.cachedBorders = null;
  state.cachedColorsHash = getColorsHash();
}

function isUsableMesh(mesh) {
  return !!(mesh && Array.isArray(mesh.coordinates) && mesh.coordinates.length > 0);
}

function getAdmin1Group(entity) {
  const value = entity?.properties?.admin1_group;
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function asFeatureLike(entity) {
  if (!entity) return null;
  return {
    id: entity.id,
    properties: entity.properties || {},
  };
}

function getEntityFeatureId(entity) {
  const featureLike = asFeatureLike(entity);
  return featureLike ? getFeatureId(featureLike) : null;
}

function getEntityCountryCode(entity) {
  const featureLike = asFeatureLike(entity);
  return featureLike ? getFeatureCountryCodeNormalized(featureLike) : "";
}

function getCountryFeatureEntriesMap() {
  const byCountry = new Map();
  const features = Array.isArray(state.landData?.features) ? state.landData.features : [];
  features.forEach((feature) => {
    const id = getFeatureId(feature);
    const countryCode = getFeatureCountryCodeNormalized(feature);
    if (!id || !countryCode) return;
    const list = byCountry.get(countryCode) || [];
    list.push({ id, feature });
    byCountry.set(countryCode, list);
  });
  return byCountry;
}

function evaluateCountryGroupingCandidate(countryCode, source, featureEntries, featureToGroup) {
  if (!featureEntries?.length || !(featureToGroup instanceof Map) || !featureToGroup.size) return null;

  const groupCounts = new Map();
  let groupedCount = 0;
  featureEntries.forEach(({ id }) => {
    const group = featureToGroup.get(id);
    if (!group) return;
    groupedCount += 1;
    groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
  });

  if (!groupedCount || !groupCounts.size) return null;

  const totalCount = featureEntries.length;
  const groupSizes = Array.from(groupCounts.values());
  const renderableGroupCount = groupSizes.filter((count) => count >= 2).length;
  const coverage = totalCount > 0 ? groupedCount / totalCount : 0;
  const dominantShare = groupedCount > 0 ? Math.max(...groupSizes) / groupedCount : 1;

  return {
    countryCode,
    source,
    featureToGroup,
    groupCounts,
    totalCount,
    groupedCount,
    groupCount: renderableGroupCount,
    groupCountTotal: groupCounts.size,
    coverage,
    dominantShare,
    accepted:
      renderableGroupCount >= PARENT_BORDER_MIN_RENDERABLE_GROUPS &&
      coverage >= PARENT_BORDER_MIN_COVERAGE &&
      dominantShare <= PARENT_BORDER_MAX_DOMINANT_SHARE,
  };
}

function buildHierarchyGroupingCandidate(countryCode, featureEntries) {
  const groups = state.hierarchyData?.groups;
  if (!groups || typeof groups !== "object") return null;

  const idSet = new Set(featureEntries.map((entry) => entry.id));
  const featureToGroup = new Map();
  Object.entries(groups).forEach(([groupId, children]) => {
    const groupCountry = canonicalCountryCode(String(groupId || "").split("_")[0]);
    if (!groupCountry || groupCountry !== countryCode) return;
    if (!Array.isArray(children)) return;
    children.forEach((child) => {
      const childId = String(child || "").trim();
      if (!childId || !idSet.has(childId)) return;
      if (!featureToGroup.has(childId)) {
        featureToGroup.set(childId, groupId);
      }
    });
  });

  return evaluateCountryGroupingCandidate(countryCode, "hierarchy", featureEntries, featureToGroup);
}

function buildAdmin1GroupingCandidate(countryCode, featureEntries) {
  const featureToGroup = new Map();
  featureEntries.forEach(({ id, feature }) => {
    const group = getAdmin1Group(feature);
    if (!group) return;
    featureToGroup.set(id, group);
  });
  return evaluateCountryGroupingCandidate(countryCode, "admin1_group", featureEntries, featureToGroup);
}

function buildIdPrefixGroupingCandidate(countryCode, featureEntries, prefixLength) {
  const length = Number(prefixLength);
  if (!Number.isFinite(length) || length < 3) return null;

  const featureToGroup = new Map();
  let validIds = 0;
  featureEntries.forEach(({ id }) => {
    const text = String(id || "").trim().toUpperCase();
    if (!GB_ID_PATTERN_RE.test(text)) return;
    validIds += 1;
    featureToGroup.set(id, text.slice(0, length));
  });

  if (!featureToGroup.size || !featureEntries.length) return null;
  const idPatternCoverage = validIds / featureEntries.length;
  if (idPatternCoverage < 0.95) return null;

  const candidate = evaluateCountryGroupingCandidate(countryCode, "id_prefix", featureEntries, featureToGroup);
  if (!candidate) return null;
  return {
    ...candidate,
    prefixLength: length,
    idPatternCoverage,
  };
}

function isGermanStateLevelCandidate(candidate) {
  if (!candidate || candidate.source !== "admin1_group") return false;
  if (candidate.groupCountTotal < DE_STATE_GROUP_MIN || candidate.groupCountTotal > DE_STATE_GROUP_MAX) {
    return false;
  }
  const groups = new Set(candidate.groupCounts ? Array.from(candidate.groupCounts.keys()) : []);
  return Array.from(DE_CITY_STATES).every((name) => groups.has(name));
}

function resolveCountryParentGroupingCandidate(countryCode, featureEntries) {
  if (!countryCode || !featureEntries?.length) return null;

  const hierarchyCandidate = buildHierarchyGroupingCandidate(countryCode, featureEntries);
  const adminCandidate = buildAdmin1GroupingCandidate(countryCode, featureEntries);

  if (countryCode === "DE") {
    if (adminCandidate && isGermanStateLevelCandidate(adminCandidate)) {
      return {
        ...adminCandidate,
        accepted: true,
        forcedRule: "de_state_level",
      };
    }
    if (hierarchyCandidate?.accepted) return hierarchyCandidate;
    if (adminCandidate?.accepted) return adminCandidate;
    return null;
  }

  if (countryCode === "GB") {
    const hierarchyFineEnough =
      hierarchyCandidate?.accepted &&
      Math.max(hierarchyCandidate.groupCount, hierarchyCandidate.groupCountTotal) >= GB_PARENT_MIN_GROUPS;
    if (hierarchyFineEnough) return hierarchyCandidate;

    const idPrefixCandidate = [
      buildIdPrefixGroupingCandidate(countryCode, featureEntries, 4),
      buildIdPrefixGroupingCandidate(countryCode, featureEntries, 3),
    ].find(
      (candidate) =>
        candidate?.accepted &&
        Math.max(candidate.groupCount, candidate.groupCountTotal) >= GB_PARENT_MIN_GROUPS
    );
    if (idPrefixCandidate) return idPrefixCandidate;
    return null;
  }

  if (hierarchyCandidate?.accepted) return hierarchyCandidate;
  if (adminCandidate?.accepted) return adminCandidate;
  return null;
}

function syncParentBorderEnabledByCountry(supportedCountries) {
  const prev = state.parentBorderEnabledByCountry && typeof state.parentBorderEnabledByCountry === "object"
    ? state.parentBorderEnabledByCountry
    : {};
  const next = {};
  supportedCountries.forEach((countryCode) => {
    next[countryCode] = !!prev[countryCode];
  });
  state.parentBorderEnabledByCountry = next;
}

function refreshParentBorderSupport() {
  const byCountry = getCountryFeatureEntriesMap();
  const supported = [];
  const meta = {};
  const featureToGroup = new Map();

  byCountry.forEach((featureEntries, countryCode) => {
    const candidate = resolveCountryParentGroupingCandidate(countryCode, featureEntries);
    if (!candidate?.accepted) return;

    supported.push(countryCode);
    candidate.featureToGroup.forEach((group, featureId) => {
      featureToGroup.set(featureId, group);
    });
    meta[countryCode] = {
      source: candidate.source,
      groupCount: candidate.groupCountTotal,
      coverage: Number(candidate.coverage.toFixed(3)),
      dominantShare: Number(candidate.dominantShare.toFixed(3)),
      prefixLength: candidate.prefixLength || null,
      idPatternCoverage: Number.isFinite(candidate.idPatternCoverage)
        ? Number(candidate.idPatternCoverage.toFixed(3))
        : null,
    };
  });

  supported.sort((a, b) => a.localeCompare(b));
  state.parentGroupByFeatureId = featureToGroup;
  state.parentBorderMetaByCountry = meta;
  state.parentBorderSupportedCountries = supported;
  syncParentBorderEnabledByCountry(supported);

  if (typeof state.updateParentBorderCountryListFn === "function") {
    state.updateParentBorderCountryListFn();
  }
}

function getParentGroupForEntity(entity) {
  const featureId = getEntityFeatureId(entity);
  if (!featureId || !state.parentGroupByFeatureId) return "";
  const group = state.parentGroupByFeatureId.get(featureId);
  if (group === null || group === undefined) return "";
  return String(group).trim();
}

function buildCountryParentBorderMeshes(countryCode) {
  const normalizedCode = canonicalCountryCode(countryCode);
  if (!normalizedCode || !globalThis.topojson) return [];

  const sourceCountries = getSourceCountrySets();
  const sources = [
    { key: "detail", topology: state.topologyDetail },
    { key: "primary", topology: state.topologyPrimary || state.topology },
  ];
  const meshes = [];

  sources.forEach(({ key, topology }) => {
    if (!topology?.objects?.political) return;
    if (!sourceCountries[key]?.has(normalizedCode)) return;
    const object = topology.objects.political;
    const mesh = globalThis.topojson.mesh(
      topology,
      object,
      (a, b) => {
        if (!a || !b) return false;
        const codeA = getEntityCountryCode(a);
        const codeB = getEntityCountryCode(b);
        if (!codeA || !codeB || codeA !== normalizedCode || codeB !== normalizedCode) return false;
        const groupA = getParentGroupForEntity(a);
        const groupB = getParentGroupForEntity(b);
        return !!(groupA && groupB && groupA !== groupB);
      }
    );
    if (isUsableMesh(mesh)) meshes.push(mesh);
  });

  return meshes;
}

function getSourceCountrySets() {
  const sets = {
    primary: new Set(),
    detail: new Set(),
  };

  if (!state.landData?.features?.length) {
    return sets;
  }

  state.landData.features.forEach((feature) => {
    const source = String(feature?.properties?.__source || "primary");
    const countryCode = getFeatureCountryCodeNormalized(feature);
    if (!countryCode) return;
    if (source === "detail") {
      sets.detail.add(countryCode);
    } else {
      sets.primary.add(countryCode);
    }
  });

  return sets;
}

function buildSourceBorderMeshes(topology, includedCountries) {
  const object = topology?.objects?.political;
  if (!object || !globalThis.topojson || !includedCountries?.size) {
    return null;
  }

  const inScope = (entity) => {
    const code = getFeatureCountryCodeNormalized(entity);
    return code && includedCountries.has(code);
  };

  const isProvinceSplit = (a, b) => {
    const groupA = getAdmin1Group(a);
    const groupB = getAdmin1Group(b);
    return !!(groupA && groupB && groupA !== groupB);
  };

  const provinceMesh = globalThis.topojson.mesh(
    topology,
    object,
    (a, b) => {
      if (!a || !b) return false;
      if (!inScope(a) || !inScope(b)) return false;
      const codeA = getFeatureCountryCodeNormalized(a);
      const codeB = getFeatureCountryCodeNormalized(b);
      if (!codeA || !codeB || codeA !== codeB) return false;
      return isProvinceSplit(a, b);
    }
  );

  const localMesh = globalThis.topojson.mesh(
    topology,
    object,
    (a, b) => {
      if (!a || !b) return false;
      if (!inScope(a) || !inScope(b)) return false;
      const codeA = getFeatureCountryCodeNormalized(a);
      const codeB = getFeatureCountryCodeNormalized(b);
      if (!codeA || !codeB || codeA !== codeB) return false;
      return !isProvinceSplit(a, b);
    }
  );

  return {
    provinceMesh,
    localMesh,
  };
}

function buildGlobalCountryBorderMesh(primaryTopology) {
  const object = primaryTopology?.objects?.political;
  if (!object || !globalThis.topojson) return null;

  return globalThis.topojson.mesh(
    primaryTopology,
    object,
    (a, b) => {
      if (!a || !b) return false;
      const codeA = getFeatureCountryCodeNormalized(a);
      const codeB = getFeatureCountryCodeNormalized(b);
      return !!(codeA && codeB && codeA !== codeB);
    }
  );
}

function buildGlobalCoastlineMesh(primaryTopology) {
  if (!primaryTopology?.objects || !globalThis.topojson) return null;
  if (primaryTopology.objects.land) {
    return globalThis.topojson.mesh(primaryTopology, primaryTopology.objects.land);
  }
  if (primaryTopology.objects.political) {
    return globalThis.topojson.mesh(
      primaryTopology,
      primaryTopology.objects.political,
      (a, b) => !!(a && !b)
    );
  }
  return null;
}

function getLineLength(line) {
  if (!Array.isArray(line) || line.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < line.length; i += 1) {
    const prev = line[i - 1];
    const curr = line[i];
    if (!prev || !curr) continue;
    total += Math.hypot(curr[0] - prev[0], curr[1] - prev[1]);
  }
  return total;
}

function getSqPointToSegmentDistance(point, start, end) {
  const vx = end[0] - start[0];
  const vy = end[1] - start[1];
  const wx = point[0] - start[0];
  const wy = point[1] - start[1];
  const lengthSq = vx * vx + vy * vy;
  if (lengthSq <= 0) {
    return wx * wx + wy * wy;
  }
  let t = (wx * vx + wy * vy) / lengthSq;
  t = clamp(t, 0, 1);
  const projX = start[0] + t * vx;
  const projY = start[1] + t * vy;
  const dx = point[0] - projX;
  const dy = point[1] - projY;
  return dx * dx + dy * dy;
}

function simplifyPolylineRDP(points, epsilon) {
  if (!Array.isArray(points) || points.length <= 2) {
    return Array.isArray(points) ? points.slice() : [];
  }

  const eps = Math.max(0, Number(epsilon) || 0);
  if (eps <= 0) {
    return points.slice();
  }

  const sqEps = eps * eps;
  const keep = new Array(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;

  const stack = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [startIdx, endIdx] = stack.pop();
    let maxSqDist = -1;
    let splitIdx = -1;
    const start = points[startIdx];
    const end = points[endIdx];
    for (let i = startIdx + 1; i < endIdx; i += 1) {
      const sqDist = getSqPointToSegmentDistance(points[i], start, end);
      if (sqDist > maxSqDist) {
        maxSqDist = sqDist;
        splitIdx = i;
      }
    }

    if (splitIdx >= 0 && maxSqDist > sqEps) {
      keep[splitIdx] = true;
      stack.push([startIdx, splitIdx], [splitIdx, endIdx]);
    }
  }

  const result = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) {
      result.push(points[i]);
    }
  }
  return result.length >= 2 ? result : points.slice(0, 2);
}

function sanitizePolyline(line) {
  if (!Array.isArray(line)) return [];
  const result = [];
  line.forEach((point) => {
    if (!Array.isArray(point) || point.length < 2) return;
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const prev = result[result.length - 1];
    if (prev && prev[0] === x && prev[1] === y) return;
    result.push([x, y]);
  });
  return result;
}

function simplifyCoastlineMesh(mesh, { epsilon = 0, minLength = 0 } = {}) {
  if (!isUsableMesh(mesh)) return null;
  const simplifiedCoordinates = [];

  mesh.coordinates.forEach((line) => {
    const sanitized = sanitizePolyline(line);
    if (sanitized.length < 2) return;
    const simplified = simplifyPolylineRDP(sanitized, epsilon);
    if (simplified.length < 2) return;
    if (getLineLength(simplified) < Math.max(0, Number(minLength) || 0)) return;
    simplifiedCoordinates.push(simplified);
  });

  if (!simplifiedCoordinates.length) return null;
  return {
    type: "MultiLineString",
    coordinates: simplifiedCoordinates,
  };
}

function rebuildStaticMeshes() {
  state.cachedCountryBorders = [];
  state.cachedProvinceBorders = [];
  state.cachedLocalBorders = [];
  state.cachedCoastlines = [];
  state.cachedCoastlinesHigh = [];
  state.cachedCoastlinesMid = [];
  state.cachedCoastlinesLow = [];
  state.cachedParentBordersByCountry = new Map();
  state.cachedGridLines = [];
  state.parentGroupByFeatureId = new Map();
  state.parentBorderMetaByCountry = {};
  state.parentBorderSupportedCountries = [];
  if (!globalThis.topojson) {
    syncParentBorderEnabledByCountry([]);
    if (typeof state.updateParentBorderCountryListFn === "function") {
      state.updateParentBorderCountryListFn();
    }
    return;
  }

  refreshParentBorderSupport();

  const sourceCountries = getSourceCountrySets();
  const sources = [
    { key: "detail", topology: state.topologyDetail },
    { key: "primary", topology: state.topologyPrimary || state.topology },
  ];

  sources.forEach(({ key, topology }) => {
    if (!topology?.objects?.political) return;
    const includedCountries = sourceCountries[key] || new Set();
    if (!includedCountries.size) return;
    const meshes = buildSourceBorderMeshes(topology, includedCountries);
    if (!meshes) return;

    if (isUsableMesh(meshes.provinceMesh)) state.cachedProvinceBorders.push(meshes.provinceMesh);
    if (isUsableMesh(meshes.localMesh)) state.cachedLocalBorders.push(meshes.localMesh);
  });

  const primaryTopology = state.topologyPrimary || state.topology;
  const countryMesh = buildGlobalCountryBorderMesh(primaryTopology);
  if (isUsableMesh(countryMesh)) {
    state.cachedCountryBorders.push(countryMesh);
  }

  const coastlineMesh = buildGlobalCoastlineMesh(primaryTopology);
  if (isUsableMesh(coastlineMesh)) {
    state.cachedCoastlines.push(coastlineMesh);
    state.cachedCoastlinesHigh.push(coastlineMesh);

    const coastlineMid = simplifyCoastlineMesh(coastlineMesh, {
      epsilon: COASTLINE_SIMPLIFY_MID_EPSILON,
      minLength: COASTLINE_SIMPLIFY_MID_MIN_LENGTH,
    });
    const coastlineLow = simplifyCoastlineMesh(coastlineMesh, {
      epsilon: COASTLINE_SIMPLIFY_LOW_EPSILON,
      minLength: COASTLINE_SIMPLIFY_LOW_MIN_LENGTH,
    });

    if (isUsableMesh(coastlineMid)) {
      state.cachedCoastlinesMid.push(coastlineMid);
    } else {
      state.cachedCoastlinesMid.push(coastlineMesh);
    }
    if (isUsableMesh(coastlineLow)) {
      state.cachedCoastlinesLow.push(coastlineLow);
    } else if (isUsableMesh(coastlineMid)) {
      state.cachedCoastlinesLow.push(coastlineMid);
    } else {
      state.cachedCoastlinesLow.push(coastlineMesh);
    }
  }

  // Backward compatibility: expose local boundaries as "grid lines".
  state.cachedGridLines = [...(state.cachedLocalBorders || [])];
}

function invalidateBorderCache() {
  rebuildDynamicBorders();
}

function createHitResult(overrides = {}) {
  return {
    id: null,
    countryCode: null,
    viaSnap: false,
    strict: false,
    distancePx: Infinity,
    ...overrides,
  };
}

function getSpatialBucketKey(col, row) {
  return `${col},${row}`;
}

function getBBoxDistanceToPoint(item, px, py) {
  const dx = px < item.minX ? item.minX - px : px > item.maxX ? px - item.maxX : 0;
  const dy = py < item.minY ? item.minY - py : py > item.maxY ? py - item.maxY : 0;
  return Math.hypot(dx, dy);
}

function buildSpatialGrid(items, canvasWidth, canvasHeight) {
  const width = Math.max(1, canvasWidth || 1);
  const height = Math.max(1, canvasHeight || 1);
  const cellSize = clamp(
    Math.round(width / HIT_GRID_TARGET_COLS),
    HIT_GRID_MIN_CELL_PX,
    HIT_GRID_MAX_CELL_PX
  );
  const cols = Math.max(1, Math.ceil(width / cellSize));
  const rows = Math.max(1, Math.ceil(height / cellSize));
  const grid = new Map();
  const globals = [];
  const itemsById = new Map();

  const pushToCell = (col, row, item) => {
    const key = getSpatialBucketKey(col, row);
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key).push(item);
  };

  items.forEach((item) => {
    if (!item?.id) return;
    itemsById.set(item.id, item);
    const c0 = clamp(Math.floor(item.minX / cellSize), 0, cols - 1);
    const c1 = clamp(Math.floor(item.maxX / cellSize), 0, cols - 1);
    const r0 = clamp(Math.floor(item.minY / cellSize), 0, rows - 1);
    const r1 = clamp(Math.floor(item.maxY / cellSize), 0, rows - 1);
    const covered = (c1 - c0 + 1) * (r1 - r0 + 1);

    if (covered > HIT_MAX_CELLS_PER_ITEM) {
      globals.push(item);
      return;
    }

    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        pushToCell(col, row, item);
      }
    }
  });

  state.spatialGrid = grid;
  state.spatialGridMeta = {
    cellSize,
    cols,
    rows,
    width,
    height,
    globals,
  };
  state.spatialItemsById = itemsById;
}

function collectGridCandidates(px, py, radiusProj = 0) {
  const meta = state.spatialGridMeta;
  if (!meta || !state.spatialGrid) return [];
  const { cellSize, cols, rows, globals } = meta;
  if (!cellSize || cols <= 0 || rows <= 0) return [];

  const radius = Math.max(0, radiusProj || 0);
  const minX = px - radius;
  const maxX = px + radius;
  const minY = py - radius;
  const maxY = py + radius;
  const c0 = clamp(Math.floor(minX / cellSize), 0, cols - 1);
  const c1 = clamp(Math.floor(maxX / cellSize), 0, cols - 1);
  const r0 = clamp(Math.floor(minY / cellSize), 0, rows - 1);
  const r1 = clamp(Math.floor(maxY / cellSize), 0, rows - 1);

  const buckets = [];
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const key = getSpatialBucketKey(col, row);
      const bucket = state.spatialGrid.get(key);
      if (bucket?.length) {
        buckets.push(bucket);
      }
    }
  }

  const seen = new Set();
  const candidates = [];
  const strict = radius <= 0;

  const maybePush = (item) => {
    if (!item?.id || seen.has(item.id)) return;
    seen.add(item.id);
    const distanceProj = getBBoxDistanceToPoint(item, px, py);
    if (strict) {
      if (distanceProj > 0) return;
    } else if (distanceProj > radius) {
      return;
    }
    candidates.push({ item, distanceProj });
  };

  buckets.forEach((bucket) => {
    bucket.forEach(maybePush);
  });
  globals?.forEach(maybePush);

  return candidates;
}

function rankCandidates(candidates, lonLat) {
  if (!Array.isArray(candidates) || !candidates.length) return [];

  const ranked = candidates.map((candidate) => {
    const feature = candidate.item?.feature;
    let containsGeo = false;
    if (feature && lonLat && globalThis.d3?.geoContains) {
      try {
        containsGeo = !!globalThis.d3.geoContains(feature, lonLat);
      } catch (error) {
        containsGeo = false;
      }
    }
    const source = String(candidate.item?.source || feature?.properties?.__source || "primary");
    const sourceRank = source === "detail" ? 0 : 1;
    const bboxArea = Number.isFinite(candidate.item?.bboxArea)
      ? candidate.item.bboxArea
      : Math.max(0, (candidate.item.maxX - candidate.item.minX) * (candidate.item.maxY - candidate.item.minY));
    return {
      ...candidate,
      containsGeo,
      sourceRank,
      bboxArea,
    };
  });

  ranked.sort((a, b) => {
    if (a.containsGeo !== b.containsGeo) return a.containsGeo ? -1 : 1;
    if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
    if (a.bboxArea !== b.bboxArea) return a.bboxArea - b.bboxArea;
    if (a.distanceProj !== b.distanceProj) return a.distanceProj - b.distanceProj;
    return String(a.item?.id || "").localeCompare(String(b.item?.id || ""));
  });

  return ranked;
}

function getPointerProjectionPosition(event) {
  if (!mapSvg || !projection || !globalThis.d3) return null;
  const [sx, sy] = globalThis.d3.pointer(event, mapSvg);
  const transform = state.zoomTransform || globalThis.d3.zoomIdentity;
  const zoomK = Math.max(0.0001, transform?.k || 1);
  const px = (sx - (transform?.x || 0)) / zoomK;
  const py = (sy - (transform?.y || 0)) / zoomK;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;
  const lonLat = projection.invert([px, py]);
  if (!lonLat) return null;
  return {
    px,
    py,
    lonLat,
    zoomK,
  };
}

function toHitResult(candidate, { viaSnap = false, strict = false, zoomK = 1 } = {}) {
  if (!candidate?.item?.id) return createHitResult();
  return createHitResult({
    id: candidate.item.id,
    countryCode: candidate.item.countryCode || getFeatureCountryCodeNormalized(candidate.item.feature),
    viaSnap,
    strict,
    distancePx: candidate.distanceProj * zoomK,
  });
}

function buildIndex() {
  state.landIndex.clear();
  state.countryToFeatureIds.clear();
  state.idToKey.clear();
  state.keyToId.clear();

  if (!state.landData || !state.landData.features) return;
  state.landData.features.forEach((feature, index) => {
    const id = getFeatureId(feature) || `feature-${index}`;
    state.landIndex.set(id, feature);
    const countryCode = getFeatureCountryCodeNormalized(feature);
    if (countryCode) {
      const ids = state.countryToFeatureIds.get(countryCode) || [];
      ids.push(id);
      state.countryToFeatureIds.set(countryCode, ids);
    }
    const key = index + 1;
    state.idToKey.set(id, key);
    state.keyToId.set(key, id);
  });

  if (typeof state.renderCountryListFn === "function") {
    state.renderCountryListFn();
  }
  if (typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
}

function buildSpatialIndex() {
  state.spatialItems = [];
  state.spatialIndex = null;
  state.spatialGrid = new Map();
  state.spatialGridMeta = null;
  state.spatialItemsById = new Map();
  if (!state.landData || !state.landData.features || !pathSVG) return;
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();

  for (const feature of state.landData.features) {
    const id = getFeatureId(feature);
    if (!id) continue;
    if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) continue;
    const bounds = getProjectedFeatureBounds(feature, { featureId: id, allowCompute: false })
      || getProjectedFeatureBounds(feature, { featureId: id });
    if (!bounds) continue;

    state.spatialItems.push({
      id,
      feature,
      countryCode: getFeatureCountryCodeNormalized(feature),
      source: String(feature?.properties?.__source || "primary"),
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      bboxArea: bounds.area,
    });
  }

  buildSpatialGrid(state.spatialItems, canvasWidth, canvasHeight);
  state.spatialIndex = null;
}

function getHitFromEvent(
  event,
  { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown" } = {}
) {
  if (!state.landData || !state.spatialItems?.length) return createHitResult();
  const pointer = getPointerProjectionPosition(event);
  if (!pointer) return createHitResult();

  const strictCandidates = collectGridCandidates(pointer.px, pointer.py, 0);
  const strictRanked = rankCandidates(strictCandidates, pointer.lonLat);
  if (strictRanked.length > 0) {
    const strictContainsGeo = strictRanked.find((candidate) => candidate.containsGeo);
    if (!strictContainsGeo) return createHitResult();
    return toHitResult(strictContainsGeo, {
      viaSnap: false,
      strict: true,
      zoomK: pointer.zoomK,
    });
  }

  if (!enableSnap) return createHitResult();

  const snapRadiusPx = Number.isFinite(Number(snapPx))
    ? Math.max(0, Number(snapPx))
    : HIT_SNAP_RADIUS_PX;
  const radiusProj = snapRadiusPx / pointer.zoomK;
  if (radiusProj <= 0) return createHitResult();

  const snapCandidates = collectGridCandidates(pointer.px, pointer.py, radiusProj);
  const snapRanked = rankCandidates(snapCandidates, pointer.lonLat);
  if (!snapRanked.length) return createHitResult();

  const chosen = snapRanked.find((candidate) => candidate.containsGeo);
  if (!chosen) return createHitResult();
  const hit = toHitResult(chosen, {
    viaSnap: true,
    strict: false,
    zoomK: pointer.zoomK,
  });
  if (eventType === "click" && hit.id) {
    return hit;
  }
  return hit;
}

function getFeatureIdFromEvent(event) {
  const hit = getHitFromEvent(event, {
    enableSnap: true,
    snapPx: HIT_SNAP_RADIUS_PX,
    eventType: "compat",
  });
  return hit.id;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function drawMeshCollection(meshCollection, strokeStyle, lineWidth) {
  if (!meshCollection || !meshCollection.length) return;
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  meshCollection.forEach((mesh) => {
    if (!mesh) return;
    context.beginPath();
    pathCanvas(mesh);
    context.stroke();
  });
}

function drawHierarchicalBorders(k, { interactive = false } = {}) {
  const kEff = clamp(k, 1, 8);
  const t = (kEff - 1) / 7;
  const kDenom = Math.max(0.0001, k);
  const lowZoomDeclutter = k < COASTLINE_LOD_LOW_ZOOM_MAX ? 0.82 : 1;
  const lowZoomWidthScale = k < COASTLINE_LOD_LOW_ZOOM_MAX ? 0.92 : 1;
  const lowZoomInternalBoost = k < 1.45 ? 1.55 : 1;
  const internal = state.styleConfig?.internalBorders || {};
  const empire = state.styleConfig?.empireBorders || {};
  const coast = state.styleConfig?.coastlines || {};
  const parent = state.styleConfig?.parentBorders || {};

  const empireColor = getSafeCanvasColor(empire.color, "#666666");
  const internalColor = getSafeCanvasColor(internal.color, "#cccccc");
  const coastColor = getSafeCanvasColor(coast.color, "#333333");
  const parentColor = getSafeCanvasColor(parent.color, "#4b5563");

  const empireWidthBase = Number(empire.width) || 1;
  const internalWidthBase = Number(internal.width) || 0.5;
  const coastWidthBase = Number(coast.width) || 1.2;
  const parentWidthBase = Number(parent.width) || 1.1;
  const internalOpacity = Number.isFinite(Number(internal.opacity)) ? Number(internal.opacity) : 1;
  const parentOpacity = clamp(
    Number.isFinite(Number(parent.opacity)) ? Number(parent.opacity) : 0.85,
    0,
    1
  );

  if (interactive) {
    const countryWidth = (empireWidthBase * 0.95) / kDenom;
    const coastWidth = (coastWidthBase * 0.88) / kDenom;
    const coastlineLow = state.cachedCoastlinesLow?.length
      ? state.cachedCoastlinesLow
      : (state.cachedCoastlines?.length ? state.cachedCoastlines : state.cachedCoastlinesHigh);

    context.globalAlpha = 0.88;
    drawMeshCollection(state.cachedCountryBorders, empireColor, countryWidth);

    context.globalAlpha = 0.78;
    drawMeshCollection(coastlineLow, coastColor, coastWidth);

    context.globalAlpha = 1.0;
    return;
  }

  const countryAlpha = 0.90;
  const provinceAlpha = clamp(
    internalOpacity * (0.22 + 0.50 * t) * lowZoomDeclutter * lowZoomInternalBoost,
    INTERNAL_BORDER_PROVINCE_MIN_ALPHA,
    0.74
  );
  const localAlpha = clamp(
    internalOpacity * (0.08 + 0.34 * t) * lowZoomDeclutter * (lowZoomInternalBoost + 0.2),
    INTERNAL_BORDER_LOCAL_MIN_ALPHA,
    0.48
  );
  const parentAlpha = clamp(parentOpacity * (0.55 + 0.25 * t), 0.30, 0.90);
  const coastAlpha = clamp(0.74 + 0.12 * t, 0.74, 0.86);

  const countryWidth = (empireWidthBase * (0.95 + 0.40 * t)) / kDenom;
  const provinceWidth = Math.max(
    INTERNAL_BORDER_PROVINCE_MIN_WIDTH,
    internalWidthBase * (0.72 + 0.65 * t) * lowZoomWidthScale
  ) / kDenom;
  const localWidth = Math.max(
    INTERNAL_BORDER_LOCAL_MIN_WIDTH,
    internalWidthBase * 0.40 * (0.70 + 0.55 * t) * lowZoomWidthScale
  ) / kDenom;
  const parentWidth = (parentWidthBase * (0.90 + 0.35 * t)) / kDenom;
  const coastWidth = (coastWidthBase * (0.90 + 0.30 * t)) / kDenom;
  const coastlineCollection = k < COASTLINE_LOD_LOW_ZOOM_MAX
    ? (state.cachedCoastlinesLow?.length ? state.cachedCoastlinesLow : state.cachedCoastlines)
    : k < COASTLINE_LOD_MID_ZOOM_MAX
      ? (state.cachedCoastlinesMid?.length ? state.cachedCoastlinesMid : state.cachedCoastlines)
      : (state.cachedCoastlinesHigh?.length ? state.cachedCoastlinesHigh : state.cachedCoastlines);

  context.globalAlpha = localAlpha;
  drawMeshCollection(state.cachedLocalBorders, internalColor, localWidth);

  context.globalAlpha = provinceAlpha;
  drawMeshCollection(state.cachedProvinceBorders, internalColor, provinceWidth);

  const enabledParentCountries = (state.parentBorderSupportedCountries || []).filter(
    (countryCode) => !!state.parentBorderEnabledByCountry?.[countryCode]
  );
  if (enabledParentCountries.length > 0) {
    context.globalAlpha = parentAlpha;
    enabledParentCountries.forEach((countryCode) => {
      let meshes = state.cachedParentBordersByCountry?.get(countryCode);
      if (!meshes) {
        meshes = buildCountryParentBorderMeshes(countryCode);
        if (state.cachedParentBordersByCountry instanceof Map) {
          state.cachedParentBordersByCountry.set(countryCode, meshes);
        }
      }
      drawMeshCollection(meshes, parentColor, parentWidth);
    });
  }

  context.globalAlpha = countryAlpha;
  drawMeshCollection(state.cachedCountryBorders, empireColor, countryWidth);

  context.globalAlpha = coastAlpha;
  drawMeshCollection(coastlineCollection, coastColor, coastWidth);

  context.globalAlpha = 1.0;
}

function normalizeOceanPreset(value) {
  const candidate = String(value || "flat").trim().toLowerCase();
  if (
    candidate === "flat" ||
    candidate === "bathymetry_soft" ||
    candidate === "bathymetry_contours" ||
    candidate === "wave_hachure"
  ) {
    return candidate;
  }
  return "flat";
}

function getOceanStyleConfig() {
  const ocean = state.styleConfig?.ocean || {};
  return {
    preset: normalizeOceanPreset(ocean.preset),
    opacity: clamp(Number.isFinite(Number(ocean.opacity)) ? Number(ocean.opacity) : 0.72, 0, 1),
    scale: clamp(Number.isFinite(Number(ocean.scale)) ? Number(ocean.scale) : 1, 0.6, 2.4),
    contourStrength: clamp(
      Number.isFinite(Number(ocean.contourStrength)) ? Number(ocean.contourStrength) : 0.75,
      0,
      1
    ),
  };
}

function getOceanBaseFillColor() {
  return getSafeCanvasColor(state.styleConfig?.ocean?.fillColor, OCEAN_FILL_COLOR) || OCEAN_FILL_COLOR;
}

function getPathBounds(shape) {
  if (!pathCanvas || !shape) return null;
  try {
    const bounds = pathCanvas.bounds(shape);
    if (!bounds || bounds.length !== 2) return null;
    const minX = bounds[0][0];
    const minY = bounds[0][1];
    const maxX = bounds[1][0];
    const maxY = bounds[1][1];
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
    if (maxX <= minX || maxY <= minY) return null;
    return { minX, minY, maxX, maxY };
  } catch (error) {
    return null;
  }
}

function getBoundsArea(bounds) {
  if (!bounds) return 0;
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

function resolveOceanMask() {
  let mode = OCEAN_MASK_MODE_SPHERE_MINUS_LAND;
  let quality = 0;

  const sphereBounds = getPathBounds({ type: "Sphere" });
  const sphereArea = getBoundsArea(sphereBounds);

  if (state.oceanData) {
    const oceanBounds = getPathBounds(state.oceanData);
    const oceanArea = getBoundsArea(oceanBounds);
    if (sphereArea > 0 && oceanArea > 0) {
      quality = clamp(oceanArea / sphereArea, 0, 1);
    } else if (oceanArea > 0) {
      quality = 1;
    }
  }

  if (state.oceanData && quality >= OCEAN_MASK_MIN_QUALITY) {
    mode = OCEAN_MASK_MODE_TOPOLOGY;
  }

  state.oceanMaskMode = mode;
  state.oceanMaskQuality = quality;
  return { mode, quality };
}

function applyOceanClipMask(maskMode) {
  context.beginPath();
  if (maskMode === OCEAN_MASK_MODE_TOPOLOGY && state.oceanData) {
    pathCanvas(state.oceanData);
    context.clip();
    return;
  }

  pathCanvas({ type: "Sphere" });
  const landMask = Array.isArray(state.landData?.features) && state.landData.features.length
    ? state.landData
    : (Array.isArray(state.landBgData?.features) && state.landBgData.features.length ? state.landBgData : null);

  if (landMask) {
    pathCanvas(landMask);
    try {
      context.clip("evenodd");
    } catch (error) {
      context.clip();
    }
    return;
  }

  context.clip();
}

function createOceanPatternTile(preset, size, contourStrength) {
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const ctx = tile.getContext("2d");
  if (!ctx) return null;

  const strength = clamp(contourStrength, 0, 1);
  const xStep = Math.max(8, Math.round(size / 12));
  const yStepBase = Math.max(10, Math.round(size / (8 + strength * 7)));

  if (preset === "wave_hachure") {
    ctx.strokeStyle = `rgba(15, 60, 105, ${0.34 + 0.46 * strength})`;
    ctx.lineWidth = 1.1 + 1.2 * strength;
    const diagStep = Math.max(8, Math.round(size / (8 + strength * 5)));
    for (let offset = -size; offset <= size * 1.6; offset += diagStep) {
      ctx.beginPath();
      for (let x = 0; x <= size; x += xStep) {
        const y = offset + x * 0.45 + Math.sin((x / size) * Math.PI * 2) * (3 + 6 * strength);
        if (x === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    return tile;
  }

  const contourAlpha = preset === "bathymetry_soft"
    ? 0.2 + 0.34 * strength
    : 0.28 + 0.52 * strength;
  ctx.strokeStyle = `rgba(16, 65, 112, ${contourAlpha})`;
  ctx.lineWidth = preset === "bathymetry_soft" ? 0.85 + 0.5 * strength : 1.1 + 1.05 * strength;

  const yStep = preset === "bathymetry_soft" ? Math.round(yStepBase * 1.25) : yStepBase;
  const amp = preset === "bathymetry_soft"
    ? Math.max(2.2, size * (0.018 + strength * 0.02))
    : Math.max(3, size * (0.022 + strength * 0.028));

  for (let y = -yStep; y <= size + yStep; y += yStep) {
    ctx.beginPath();
    for (let x = 0; x <= size; x += xStep) {
      const phase = (x / size) * Math.PI * 2.2 + y * 0.06;
      const wave = Math.sin(phase) * amp + Math.sin(phase * 0.5 + 1.4) * amp * 0.35;
      const yy = y + wave;
      if (x === 0) ctx.moveTo(x, yy);
      else ctx.lineTo(x, yy);
    }
    ctx.stroke();
  }

  if (preset === "bathymetry_contours") {
    ctx.strokeStyle = `rgba(9, 36, 76, ${0.34 + 0.48 * strength})`;
    ctx.lineWidth = 1.35 + 1.15 * strength;
    const majorStep = yStep * 3;
    for (let y = 0; y <= size + majorStep; y += majorStep) {
      ctx.beginPath();
      for (let x = 0; x <= size; x += xStep) {
        const phase = (x / size) * Math.PI * 2 + y * 0.05;
        const yy = y + Math.sin(phase) * amp * 1.1;
        if (x === 0) ctx.moveTo(x, yy);
        else ctx.lineTo(x, yy);
      }
      ctx.stroke();
    }
  }

  return tile;
}

function getOceanPattern({ preset, scale, contourStrength }) {
  if (!context || preset === "flat") return null;
  const size = clamp(Math.round(OCEAN_PATTERN_BASE_SIZE * scale), 64, 512);
  const key = `${preset}:${size}:${contourStrength.toFixed(2)}`;
  const cached = oceanPatternCache.get(key);
  if (cached) return cached;

  const tile = createOceanPatternTile(preset, size, contourStrength);
  if (!tile) return null;
  const pattern = context.createPattern(tile, "repeat");
  if (!pattern) return null;
  oceanPatternCache.set(key, pattern);
  return pattern;
}

function drawOceanStyle() {
  if (!context || !pathCanvas) return;
  if (!OCEAN_ADVANCED_STYLES_ENABLED) {
    state.oceanMaskMode = OCEAN_MASK_MODE_TOPOLOGY;
    state.oceanMaskQuality = 0;
    return;
  }
  const oceanStyle = getOceanStyleConfig();
  if (oceanStyle.preset === "flat") return;
  const oceanMask = resolveOceanMask();

  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  const fillX = -canvasWidth * 2;
  const fillY = -canvasHeight * 2;
  const fillW = canvasWidth * 5;
  const fillH = canvasHeight * 5;

  context.save();
  applyOceanClipMask(oceanMask.mode);

  const gradient = context.createLinearGradient(
    0,
    -canvasHeight * 0.3,
    0,
    canvasHeight * 1.3
  );
  if (oceanStyle.preset === "wave_hachure") {
    gradient.addColorStop(0, "#9fe5fb");
    gradient.addColorStop(0.42, "#63c5e6");
    gradient.addColorStop(1, "#2d84be");
  } else if (oceanStyle.preset === "bathymetry_soft") {
    gradient.addColorStop(0, "#bfe9fb");
    gradient.addColorStop(0.5, "#78c6eb");
    gradient.addColorStop(1, "#3f95cb");
  } else {
    gradient.addColorStop(0, "#a5def8");
    gradient.addColorStop(0.45, "#4fa7d8");
    gradient.addColorStop(1, "#206fa7");
  }

  context.globalAlpha = clamp(oceanStyle.opacity * 0.98, 0, 1);
  context.fillStyle = gradient;
  context.fillRect(fillX, fillY, fillW, fillH);

  const pattern = getOceanPattern(oceanStyle);
  if (pattern) {
    const patternAlpha = oceanStyle.preset === "bathymetry_soft"
      ? clamp(oceanStyle.opacity * (0.48 + oceanStyle.contourStrength * 0.3), 0, 0.84)
      : clamp(oceanStyle.opacity * (0.62 + oceanStyle.contourStrength * 0.42), 0, 1);
    context.globalAlpha = patternAlpha;
    context.fillStyle = pattern;
    context.fillRect(fillX, fillY, fillW, fillH);
  }

  context.restore();
  context.globalAlpha = 1;
}

function getSafeBlendMode(value, fallback = "source-over") {
  const mode = String(value || fallback).trim();
  return mode || fallback;
}

function getDashPattern(styleName, baseWidth = 1) {
  const style = String(styleName || "solid").trim().toLowerCase();
  if (style === "dashed") {
    return [Math.max(2, baseWidth * 4), Math.max(2, baseWidth * 2.4)];
  }
  if (style === "dotted") {
    return [Math.max(1, baseWidth * 1.2), Math.max(2, baseWidth * 2.1)];
  }
  return [];
}

function estimateProjectedAreaPx(feature, zoomScale) {
  const bounds = getProjectedFeatureBounds(feature);
  if (!bounds) return 0;
  const area = Math.max(0, bounds.width * bounds.height);
  const scale = Math.max(0.1, Number(zoomScale) || 1);
  return area * scale * scale;
}

function getPhysicalPattern(config) {
  const spacing = clamp(Number(config.contourSpacing) || 18, 8, 36);
  const width = clamp(Number(config.contourWidth) || 0.7, 0.2, 2.5);
  const color = getSafeCanvasColor(config.contourColor, "#6f4e37");
  const key = `${spacing}|${width.toFixed(2)}|${color}`;
  const cached = physicalPatternCache.get(key);
  if (cached) return cached;

  const size = PHYSICAL_PATTERN_BASE_SIZE;
  const tile = document.createElement("canvas");
  tile.width = size;
  tile.height = size;
  const tileCtx = tile.getContext("2d");
  if (!tileCtx) return null;

  tileCtx.clearRect(0, 0, size, size);
  tileCtx.strokeStyle = color;
  tileCtx.lineWidth = width;

  for (let y = -size; y <= size * 2; y += spacing) {
    tileCtx.beginPath();
    tileCtx.moveTo(-8, y);
    tileCtx.lineTo(size + 8, y - size * 0.25);
    tileCtx.stroke();
  }

  const pattern = context?.createPattern(tile, "repeat") || null;
  if (pattern) {
    physicalPatternCache.set(key, pattern);
  }
  return pattern;
}

function drawPhysicalLayer(k, { interactive = false } = {}) {
  if (!state.showPhysical || !state.physicalData?.features?.length) return;
  const cfg = state.styleConfig?.physical || {};
  const preset = String(cfg.preset || "atlas_soft").trim().toLowerCase();
  const blendMode = getSafeBlendMode(cfg.blendMode, "multiply");
  const tintColor = getSafeCanvasColor(cfg.tintColor, "#8f6b4e");
  const tintOpacity = clamp(Number.isFinite(Number(cfg.opacity)) ? Number(cfg.opacity) : 0.24, 0, 1);
  const contourOpacity = clamp(
    Number.isFinite(Number(cfg.contourOpacity)) ? Number(cfg.contourOpacity) : 0.30,
    0,
    1
  );
  const contourColor = getSafeCanvasColor(cfg.contourColor, "#6f4e37");
  const contourWidth = clamp(Number.isFinite(Number(cfg.contourWidth)) ? Number(cfg.contourWidth) : 0.7, 0.2, 2.5);

  context.save();
  context.globalCompositeOperation = blendMode;

  if (preset !== "contour_only" && tintOpacity > 0) {
    context.globalAlpha = interactive ? Math.min(tintOpacity, 0.18) : tintOpacity;
    context.fillStyle = tintColor;
    state.physicalData.features.forEach((feature) => {
      context.beginPath();
      pathCanvas(feature);
      context.fill();
    });
  }

  if (preset !== "tint_only") {
    if (interactive) {
      context.globalAlpha = Math.min(contourOpacity, 0.2);
      context.strokeStyle = contourColor;
      context.lineWidth = contourWidth / Math.max(0.0001, k);
      state.physicalData.features.forEach((feature) => {
        context.beginPath();
        pathCanvas(feature);
        context.stroke();
      });
    } else {
      const pattern = getPhysicalPattern(cfg);
      if (pattern) {
        context.save();
        context.beginPath();
        state.physicalData.features.forEach((feature) => pathCanvas(feature));
        context.clip();
        context.globalAlpha = contourOpacity;
        context.fillStyle = pattern;
        context.fillRect(-4096, -4096, 8192, 8192);
        context.restore();
      } else {
        context.globalAlpha = contourOpacity;
        context.strokeStyle = contourColor;
        context.lineWidth = contourWidth / Math.max(0.0001, k);
        state.physicalData.features.forEach((feature) => {
          context.beginPath();
          pathCanvas(feature);
          context.stroke();
        });
      }
    }
  }

  context.restore();
}

function drawUrbanLayer(k, { interactive = false } = {}) {
  if (!state.showUrban || !state.urbanData?.features?.length) return;
  const cfg = state.styleConfig?.urban || {};
  const color = getSafeCanvasColor(cfg.color, "#4b5563");
  const opacity = clamp(Number.isFinite(Number(cfg.opacity)) ? Number(cfg.opacity) : 0.22, 0, 1);
  const minAreaPx = clamp(Number.isFinite(Number(cfg.minAreaPx)) ? Number(cfg.minAreaPx) : 8, 0, 80);
  const blendMode = getSafeBlendMode(cfg.blendMode, "multiply");

  context.save();
  context.globalCompositeOperation = blendMode;
  context.globalAlpha = interactive ? Math.min(opacity, 0.15) : opacity;
  context.fillStyle = color;

  state.urbanData.features.forEach((feature) => {
    if (minAreaPx > 0 && estimateProjectedAreaPx(feature, k) < minAreaPx) return;
    context.beginPath();
    pathCanvas(feature);
    context.fill();
  });

  context.restore();
}

function drawRiversLayer(k, { interactive = false } = {}) {
  if (!state.showRivers || !state.riversData?.features?.length) return;
  const cfg = state.styleConfig?.rivers || {};
  const color = getSafeCanvasColor(cfg.color, "#3b82f6");
  const opacity = clamp(Number.isFinite(Number(cfg.opacity)) ? Number(cfg.opacity) : 0.88, 0, 1);
  const widthBase = clamp(Number.isFinite(Number(cfg.width)) ? Number(cfg.width) : 1.1, 0.2, 4);
  const outlineColor = getSafeCanvasColor(cfg.outlineColor, "#e2efff");
  const outlineWidth = clamp(Number.isFinite(Number(cfg.outlineWidth)) ? Number(cfg.outlineWidth) : 0.9, 0, 3);
  const dashPattern = getDashPattern(cfg.dashStyle, widthBase);
  const scale = Math.max(0.0001, k);

  context.save();

  if (outlineWidth > 0) {
    context.globalAlpha = interactive ? Math.min(opacity * 0.7, 0.65) : Math.min(opacity, 0.95);
    context.strokeStyle = outlineColor;
    context.lineWidth = (widthBase + outlineWidth * 2) / scale;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.setLineDash([]);
    state.riversData.features.forEach((feature) => {
      context.beginPath();
      pathCanvas(feature);
      context.stroke();
    });
  }

  context.globalAlpha = interactive ? Math.min(opacity, 0.78) : opacity;
  context.strokeStyle = color;
  context.lineWidth = widthBase / scale;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash(dashPattern);
  state.riversData.features.forEach((feature) => {
    context.beginPath();
    pathCanvas(feature);
    context.stroke();
  });
  context.setLineDash([]);

  context.restore();
}

function drawCanvas() {
  if (!context || !pathCanvas) return;
  ensureLayerDataFromTopology();

  const width = context.canvas.width;
  const height = context.canvas.height;
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  const t = state.zoomTransform || globalThis.d3.zoomIdentity;
  const k = Math.max(0.0001, t.k || 1);
  const isInteractingFrame = state.renderPhase === RENDER_PHASE_INTERACTING;

  // 1. Clear + reset
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1.0;
  context.shadowBlur = 0;
  context.filter = "none";

  // 2. Apply zoom (with DPR scaling for crisp rendering)
  context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  context.translate(t.x, t.y);
  context.scale(k, k);

  // 3. Draw ocean
  const oceanFillColor = getOceanBaseFillColor();
  context.fillStyle = oceanFillColor;
  context.beginPath();
  pathCanvas({ type: "Sphere" });
  context.fill();

  if (state.oceanData) {
    context.fillStyle = oceanFillColor;
    context.beginPath();
    pathCanvas(state.oceanData);
    context.fill();
  }
  drawOceanStyle();

  // 4. Draw political land fill first.
  if (state.landData?.features?.length) {
    const islandNeighbors = debugMode === "ISLANDS" ? getIslandNeighborGraph() : null;

    state.landData.features.forEach((feature, index) => {
      const id = getFeatureId(feature) || `feature-${index}`;
      if (shouldSkipFeature(feature, canvasWidth, canvasHeight)) return;

      // 5. Fill strategy controlled by render mode.
      let fillColor = LAND_FILL_COLOR;
      if (debugMode === "PROD") {
        fillColor = getSafeCanvasColor(state.colors[id], null);
        if (!fillColor) {
          fillColor = LAND_FILL_COLOR;
        }
      } else if (debugMode === "GEOMETRY") {
        fillColor = index % 2 === 0 ? "pink" : "lightgreen";
      } else if (debugMode === "ARTIFACTS") {
        const bounds = pathCanvas.bounds(feature);
        let featureWidth = 0;
        if (bounds && bounds.length === 2) {
          const minX = bounds[0][0];
          const maxX = bounds[1][0];
          if ([minX, maxX].every(Number.isFinite)) {
            featureWidth = maxX - minX;
          }
        }
        fillColor = featureWidth > canvasWidth * 0.5 ? "red" : "#eee";
      } else if (debugMode === "ISLANDS") {
        const degree = islandNeighbors?.[index]?.length || 0;
        fillColor = degree === 0 ? "orange" : "lightgreen";
      } else if (debugMode === "ID_HASH") {
        fillColor = hashToColor(id);
      }

      context.beginPath();
      pathCanvas(feature);
      context.fillStyle = fillColor;
      context.fill();
    });
  }

  // 5. Draw context layers between land fill and borders.
  drawPhysicalLayer(k, { interactive: isInteractingFrame });
  drawUrbanLayer(k, { interactive: isInteractingFrame });
  drawRiversLayer(k, { interactive: isInteractingFrame });

  // 6. Draw border hierarchy (country > province > local) after fills.
  if (state.landData?.features?.length) {
    drawHierarchicalBorders(k, { interactive: isInteractingFrame });
  }
}

function ensureSpecialZoneEditorState() {
  if (!state.manualSpecialZones || state.manualSpecialZones.type !== "FeatureCollection") {
    state.manualSpecialZones = { type: "FeatureCollection", features: [] };
  }
  if (!Array.isArray(state.manualSpecialZones.features)) {
    state.manualSpecialZones.features = [];
  }
  if (!state.specialZoneEditor || typeof state.specialZoneEditor !== "object") {
    state.specialZoneEditor = {};
  }
  if (!Array.isArray(state.specialZoneEditor.vertices)) {
    state.specialZoneEditor.vertices = [];
  }
  if (!Number.isFinite(Number(state.specialZoneEditor.counter))) {
    state.specialZoneEditor.counter = 1;
  }
  if (!state.specialZoneEditor.zoneType) {
    state.specialZoneEditor.zoneType = DEFAULT_SPECIAL_ZONE_TYPE;
  }
  if (typeof state.specialZoneEditor.label !== "string") {
    state.specialZoneEditor.label = "";
  }
  if (state.specialZoneEditor.selectedId === undefined) {
    state.specialZoneEditor.selectedId = null;
  }
}

function getManualSpecialZoneFeatures() {
  ensureSpecialZoneEditorState();
  return state.manualSpecialZones.features || [];
}

function getEffectiveSpecialZonesFeatureCollection() {
  const topologyFeatures = Array.isArray(state.specialZonesData?.features)
    ? state.specialZonesData.features
    : [];
  const manualFeatures = getManualSpecialZoneFeatures();
  const features = [
    ...topologyFeatures.map((feature, index) => ({
      ...feature,
      properties: {
        ...(feature?.properties || {}),
        __source: "topology",
        id: String(feature?.properties?.id || `special_zone_topology_${index + 1}`),
      },
    })),
    ...manualFeatures.map((feature, index) => ({
      ...feature,
      properties: {
        ...(feature?.properties || {}),
        __source: "manual",
        id: String(feature?.properties?.id || `manual_sz_${index + 1}`),
      },
    })),
  ];
  return { type: "FeatureCollection", features };
}

function getSpecialZoneStyle(feature) {
  const config = state.styleConfig?.specialZones || {};
  const type = String(feature?.properties?.type || "").toLowerCase();
  const fillOpacity = clamp(Number.isFinite(Number(config.opacity)) ? Number(config.opacity) : 0.32, 0, 1);
  const strokeWidth = clamp(Number.isFinite(Number(config.strokeWidth)) ? Number(config.strokeWidth) : 1.3, 0.4, 4);
  const dashStyle = String(config.dashStyle || "dashed");
  const dash = getDashPattern(dashStyle, strokeWidth);

  if (type === "disputed") {
    return {
      fill: getSafeCanvasColor(config.disputedFill, "#f97316"),
      stroke: getSafeCanvasColor(config.disputedStroke, "#ea580c"),
      fillOpacity,
      strokeWidth,
      dash,
    };
  }
  if (type === "wasteland") {
    return {
      fill: getSafeCanvasColor(config.wastelandFill, "#dc2626"),
      stroke: getSafeCanvasColor(config.wastelandStroke, "#b91c1c"),
      fillOpacity,
      strokeWidth,
      dash,
    };
  }
  return {
    fill: getSafeCanvasColor(config.customFill, "#8b5cf6"),
    stroke: getSafeCanvasColor(config.customStroke, "#6d28d9"),
    fillOpacity,
    strokeWidth,
    dash,
  };
}

function updateSpecialZonesPaths() {
  if (!specialZonesGroup || !pathSVG) return;

  const features = getEffectiveSpecialZonesFeatureCollection().features;
  if (!features.length) {
    specialZonesGroup.selectAll("path.special-zone").remove();
    return;
  }

  const selectedId = String(state.specialZoneEditor?.selectedId || "");
  const selection = specialZonesGroup
    .selectAll("path.special-zone")
    .data(features, (d, i) => d?.properties?.id || `special-zone-${i}`);

  selection
    .enter()
    .append("path")
    .attr("class", "special-zone")
    .attr("vector-effect", "non-scaling-stroke")
    .merge(selection)
    .attr("d", pathSVG)
    .attr("fill", (d) => getSpecialZoneStyle(d).fill)
    .attr("fill-opacity", (d) => getSpecialZoneStyle(d).fillOpacity)
    .attr("stroke", (d) => getSpecialZoneStyle(d).stroke)
    .attr("stroke-width", (d) => {
      const base = getSpecialZoneStyle(d).strokeWidth;
      const id = String(d?.properties?.id || "");
      return id && id === selectedId ? base + 0.9 : base;
    })
    .attr("stroke-dasharray", (d) => getSpecialZoneStyle(d).dash.join(" "))
    .attr("opacity", 0.95);

  selection.exit().remove();
}

function renderSpecialZoneEditorOverlay() {
  if (!specialZoneEditorGroup || !pathSVG) return;
  ensureSpecialZoneEditorState();

  const vertices = state.specialZoneEditor.vertices || [];
  const isActive = !!state.specialZoneEditor.active;

  if (!isActive || vertices.length === 0) {
    specialZoneEditorGroup.selectAll("*").remove();
    return;
  }

  const lineFeature = {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: vertices,
    },
    properties: {},
  };
  const polygonFeature = vertices.length >= 3
    ? {
      type: "Feature",
      geometry: {
        type: "Polygon",
        coordinates: [[...vertices, vertices[0]]],
      },
      properties: {},
    }
    : null;

  const style = getSpecialZoneStyle({
    properties: { type: state.specialZoneEditor.zoneType || DEFAULT_SPECIAL_ZONE_TYPE },
  });

  const paths = [];
  if (polygonFeature) paths.push({ id: "draw-poly", feature: polygonFeature, fill: true });
  paths.push({ id: "draw-line", feature: lineFeature, fill: false });

  const pathSelection = specialZoneEditorGroup
    .selectAll("path.special-zone-editor-path")
    .data(paths, (d) => d.id);

  pathSelection
    .enter()
    .append("path")
    .attr("class", "special-zone-editor-path")
    .attr("vector-effect", "non-scaling-stroke")
    .merge(pathSelection)
    .attr("d", (d) => pathSVG(d.feature))
    .attr("fill", (d) => (d.fill ? style.fill : "none"))
    .attr("fill-opacity", (d) => (d.fill ? Math.min(style.fillOpacity * 0.85, 0.6) : 0))
    .attr("stroke", style.stroke)
    .attr("stroke-width", Math.max(1.2, style.strokeWidth + 0.5))
    .attr("stroke-dasharray", style.dash.join(" "));

  pathSelection.exit().remove();

  const points = vertices.map((coord, index) => ({ coord, key: `v-${index}` }));
  const pointSelection = specialZoneEditorGroup
    .selectAll("circle.special-zone-editor-point")
    .data(points, (d) => d.key);

  pointSelection
    .enter()
    .append("circle")
    .attr("class", "special-zone-editor-point")
    .merge(pointSelection)
    .attr("r", 3.4)
    .attr("cx", (d) => projection(d.coord)?.[0] ?? -9999)
    .attr("cy", (d) => projection(d.coord)?.[1] ?? -9999)
    .attr("fill", "#ffffff")
    .attr("stroke", style.stroke)
    .attr("stroke-width", 1.3);

  pointSelection.exit().remove();
}

function renderHoverOverlay() {
  if (!hoverGroup || !pathSVG) return;

  if (state.renderPhase !== RENDER_PHASE_IDLE) {
    hoverGroup.selectAll("path.hovered-feature").remove();
    return;
  }

  const feature = state.hoveredId ? state.landIndex.get(state.hoveredId) : null;
  const data = feature ? [feature] : [];

  const selection = hoverGroup
    .selectAll("path.hovered-feature")
    .data(data, (d) => getFeatureId(d) || "hover");

  selection
    .enter()
    .append("path")
    .attr("class", "hovered-feature")
    .attr("vector-effect", "non-scaling-stroke")
    .merge(selection)
    .attr("d", pathSVG)
    .attr("fill", "none")
    .attr("stroke", "#f1c40f")
    .attr("stroke-width", 2.0);

  selection.exit().remove();
}

function renderSpecialZones() {
  if (!specialZonesGroup || !specialZoneEditorGroup) return;
  updateSpecialZonesPaths();
  renderSpecialZoneEditorOverlay();
  const isDrawing = !!state.specialZoneEditor?.active;
  if (!state.showSpecialZones && !isDrawing) {
    specialZonesGroup.attr("display", "none");
    specialZoneEditorGroup.attr("display", "none");
    return;
  }
  specialZonesGroup.attr("display", state.showSpecialZones ? null : "none");
  specialZoneEditorGroup.attr("display", null);
}

export function renderLegend(uniqueColors = null, labels = null) {
  if (!legendGroup || !legendItemsGroup || !legendBackground) return;

  const colors = Array.isArray(uniqueColors)
    ? uniqueColors
    : LegendManager.getUniqueColors(state);
  const labelMap = labels || LegendManager.getLabels();
  const colorKey = colors.join("|");
  const normalizedLabels = colors.map((color) => {
    const key = String(color || "").toLowerCase();
    return labelMap?.[key] || "";
  });
  const legendKey = `${colorKey}::${normalizedLabels.join("|")}`;
  const shouldRebuild = legendKey !== lastLegendKey;

  if (!colors.length) {
    legendGroup.attr("display", "none");
    lastLegendKey = legendKey;
    return;
  }

  legendGroup.attr("display", null);

  if (shouldRebuild) {
    legendItemsGroup.selectAll("*").remove();
    const itemHeight = 18;
    const swatchSize = 12;
    const textOffset = swatchSize + 8;

    colors.forEach((color, index) => {
      const y = index * itemHeight;
      const normalized = String(color || "").toLowerCase();
      const label = labelMap?.[normalized] || `Category ${index + 1}`;

      legendItemsGroup
        .append("rect")
        .attr("x", 0)
        .attr("y", y)
        .attr("width", swatchSize)
        .attr("height", swatchSize)
        .attr("rx", 2)
        .attr("ry", 2)
        .attr("fill", color)
        .attr("stroke", "#1f2937")
        .attr("stroke-width", 0.4);

      legendItemsGroup
        .append("text")
        .attr("x", textOffset)
        .attr("y", y - 1)
        .attr("dominant-baseline", "hanging")
        .attr("font-size", 11)
        .attr("fill", "#111827")
        .text(label);
    });
  }

  const bbox = legendItemsGroup.node().getBBox();
  const padding = 8;
  const width = bbox.width + padding * 2;
  const height = bbox.height + padding * 2;

  legendBackground
    .attr("x", bbox.x - padding)
    .attr("y", bbox.y - padding)
    .attr("width", width)
    .attr("height", height);

  const margin = 14;
  const x = margin;
  const y = Math.max(margin, state.height - height - margin);
  legendGroup.attr("transform", `translate(${x},${y})`);

  lastLegendKey = legendKey;
}

function render() {
  drawCanvas();
  renderSpecialZones();
  renderHoverOverlay();
  if (state.renderPhase === RENDER_PHASE_IDLE) {
    renderLegend();
    if (typeof state.updateLegendUI === "function") {
      state.updateLegendUI();
    }
  }
}

function autoFillMap(mode = "region") {
  if (!state.landData?.features?.length) {
    console.warn("[autoFillMap] No land features available, aborting.");
    return;
  }

  const nextCountryBaseColors = {};
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();

  if (mode === "political" && (state.topologyPrimary || state.topology)?.objects?.political) {
    const computed = ColorManager.computePoliticalColors(state.topologyPrimary || state.topology, "political");
    const featureColors =
      computed && typeof computed === "object" && computed.featureColors
        ? computed.featureColors
        : (computed && typeof computed === "object" ? computed : {});
    const countryColors =
      computed && typeof computed === "object" && computed.countryColors
        ? computed.countryColors
        : {};

    state.landData.features.forEach((feature, index) => {
      const id = getFeatureId(feature) || `feature-${index}`;
      if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) return;
      const countryCode = getFeatureCountryCodeNormalized(feature);
      if (!countryCode || nextCountryBaseColors[countryCode]) return;
      const color =
        (countryCode && getColorByCanonicalCountryCode(countryColors, countryCode)) ||
        (countryCode && getColorByCanonicalCountryCode(featureColors, countryCode)) ||
        (countryCode && state.countryPalette && state.countryPalette[countryCode]) ||
        ColorManager.getPoliticalFallbackColor(countryCode || id, index);

      nextCountryBaseColors[countryCode] = getSafeCanvasColor(color, LAND_FILL_COLOR);
    });

  } else {
    // Region mode: assign one region-derived color per country to country base colors.
    const countryRegionTag = new Map();
    state.landData.features.forEach((feature, index) => {
      if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) return;
      const countryCode = getFeatureCountryCodeNormalized(feature);
      if (!countryCode) return;
      if (countryRegionTag.has(countryCode)) return;
      const tag = getFeatureRegionTag(feature);
      countryRegionTag.set(countryCode, tag);
    });
    countryRegionTag.forEach((tag, countryCode) => {
      nextCountryBaseColors[countryCode] = getSafeCanvasColor(
        ColorManager.getRegionColor(tag),
        LAND_FILL_COLOR
      );
    });
  }

  state.featureOverrides = {};
  state.countryBaseColors = sanitizeCountryColorMap(nextCountryBaseColors);
  refreshColorState({ renderNow: true });
  if (typeof state.renderCountryListFn === "function") {
    state.renderCountryListFn();
  }
}

function getMapLonLatFromEvent(event) {
  if (!projection || !interactionRect?.node || !globalThis.d3?.pointer) return null;
  const [sx, sy] = globalThis.d3.pointer(event, interactionRect.node());
  if (![sx, sy].every(Number.isFinite)) return null;
  const t = state.zoomTransform || globalThis.d3.zoomIdentity;
  const k = Math.max(0.0001, t.k || 1);
  const mapX = (sx - t.x) / k;
  const mapY = (sy - t.y) / k;
  const lonLat = projection.invert([mapX, mapY]);
  if (!Array.isArray(lonLat) || lonLat.length < 2) return null;
  const lon = Number(lonLat[0]);
  const lat = Number(lonLat[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  return [lon, clamp(lat, -90, 90)];
}

function updateSpecialZoneEditorUI() {
  if (typeof state.updateSpecialZoneEditorUIFn === "function") {
    state.updateSpecialZoneEditorUIFn();
  }
}

function ensureManualSpecialZoneCounter() {
  ensureSpecialZoneEditorState();
  const used = new Set(
    getManualSpecialZoneFeatures().map((feature) => String(feature?.properties?.id || ""))
  );
  let counter = Math.max(1, Number(state.specialZoneEditor.counter) || 1);
  while (used.has(`manual_sz_${counter}`)) {
    counter += 1;
  }
  state.specialZoneEditor.counter = counter;
}

function appendSpecialZoneVertexFromEvent(event) {
  ensureSpecialZoneEditorState();
  const coord = getMapLonLatFromEvent(event);
  if (!coord) return false;
  state.specialZoneEditor.vertices.push(coord);
  updateSpecialZoneEditorUI();
  renderSpecialZoneEditorOverlay();
  return true;
}

function startSpecialZoneDraw({ zoneType = DEFAULT_SPECIAL_ZONE_TYPE, label = "" } = {}) {
  ensureSpecialZoneEditorState();
  state.specialZoneEditor.active = true;
  state.specialZoneEditor.vertices = [];
  state.specialZoneEditor.zoneType = String(zoneType || DEFAULT_SPECIAL_ZONE_TYPE);
  state.specialZoneEditor.label = String(label || "");
  updateSpecialZoneEditorUI();
  if (context) render();
}

function undoSpecialZoneVertex() {
  ensureSpecialZoneEditorState();
  if (!state.specialZoneEditor.active || !state.specialZoneEditor.vertices.length) return;
  state.specialZoneEditor.vertices.pop();
  updateSpecialZoneEditorUI();
  if (context) render();
}

function cancelSpecialZoneDraw() {
  ensureSpecialZoneEditorState();
  state.specialZoneEditor.active = false;
  state.specialZoneEditor.vertices = [];
  updateSpecialZoneEditorUI();
  if (context) render();
}

function finishSpecialZoneDraw() {
  ensureSpecialZoneEditorState();
  const vertices = state.specialZoneEditor.vertices || [];
  if (!state.specialZoneEditor.active || vertices.length < 3) {
    cancelSpecialZoneDraw();
    return false;
  }

  ensureManualSpecialZoneCounter();
  const id = `manual_sz_${state.specialZoneEditor.counter}`;
  const zoneType = String(state.specialZoneEditor.zoneType || DEFAULT_SPECIAL_ZONE_TYPE);
  const labelText = String(state.specialZoneEditor.label || `${zoneType} zone`).trim() || `${zoneType} zone`;
  const feature = {
    type: "Feature",
    properties: {
      id,
      name: labelText,
      label: labelText,
      type: zoneType,
      claimants: [],
      cntr_code: "",
      __source: "manual",
    },
    geometry: {
      type: "Polygon",
      coordinates: [[...vertices, vertices[0]]],
    },
  };
  state.manualSpecialZones.features.push(feature);
  state.specialZoneEditor.counter += 1;
  state.specialZoneEditor.selectedId = id;
  state.specialZoneEditor.active = false;
  state.specialZoneEditor.vertices = [];
  updateSpecialZoneEditorUI();
  if (context) render();
  return true;
}

function selectSpecialZoneById(id) {
  ensureSpecialZoneEditorState();
  const next = String(id || "").trim();
  state.specialZoneEditor.selectedId = next || null;
  updateSpecialZoneEditorUI();
  if (context) render();
}

function deleteSelectedManualSpecialZone() {
  ensureSpecialZoneEditorState();
  const selectedId = String(state.specialZoneEditor.selectedId || "").trim();
  if (!selectedId) return false;
  const before = getManualSpecialZoneFeatures().length;
  state.manualSpecialZones.features = getManualSpecialZoneFeatures().filter(
    (feature) => String(feature?.properties?.id || "").trim() !== selectedId
  );
  const removed = before - state.manualSpecialZones.features.length;
  if (removed > 0) {
    state.specialZoneEditor.selectedId = null;
    updateSpecialZoneEditorUI();
    if (context) render();
    return true;
  }
  return false;
}

function handleMouseMove(event) {
  const now = performance.now();
  if (now - state.lastMouseMoveTime < state.MOUSE_THROTTLE_MS) return;
  state.lastMouseMoveTime = now;
  if (!state.landData) return;
  if (state.specialZoneEditor?.active) {
    state.hoveredId = null;
    renderHoverOverlay();
    if (tooltip) tooltip.style.opacity = "0";
    return;
  }

  const reducedHoverPhase = state.renderPhase !== RENDER_PHASE_IDLE;
  const hit = getHitFromEvent(event, {
    enableSnap: !reducedHoverPhase,
    snapPx: HIT_SNAP_RADIUS_PX,
    eventType: "hover",
  });
  const id = hit.id;
  if (id !== state.hoveredId) {
    state.hoveredId = id;
    if (!reducedHoverPhase) {
      renderHoverOverlay();
    }
  }

  if (!tooltip) return;
  if (id && state.landIndex.has(id)) {
    const feature = state.landIndex.get(id);
    tooltip.textContent = getTooltipText(feature);
    tooltip.style.left = `${event.clientX + 12}px`;
    tooltip.style.top = `${event.clientY + 12}px`;
    tooltip.style.opacity = "1";
  } else {
    tooltip.style.opacity = "0";
  }
}

function addRecentColor(color) {
  if (!color) return;
  state.recentColors = state.recentColors.filter((value) => value !== color);
  state.recentColors.unshift(color);
  if (state.recentColors.length > 5) {
    state.recentColors = state.recentColors.slice(0, 5);
  }
  if (typeof state.updateRecentUI === "function") {
    state.updateRecentUI();
  }
}

function resolveInteractionTargetIds(feature, id) {
  if (state.interactionGranularity !== "country") {
    return [id];
  }
  const countryCode = getFeatureCountryCodeNormalized(feature);
  if (!countryCode) {
    return [id];
  }
  const ids = state.countryToFeatureIds.get(countryCode) || [];
  return ids.length ? ids : [id];
}

function handleClick(event) {
  if (!state.landData) return;
  if (state.specialZoneEditor?.active) {
    appendSpecialZoneVertexFromEvent(event);
    return;
  }

  const hit = getHitFromEvent(event, {
    enableSnap: true,
    snapPx: HIT_SNAP_RADIUS_PX,
    eventType: "click",
  });
  const id = hit.id;
  if (!id) return;
  const feature = state.landIndex.get(id);
  if (!feature) return;
  const countryCode = hit.countryCode || getFeatureCountryCodeNormalized(feature);
  const targetIds = resolveInteractionTargetIds(feature, id);

  if (state.isEditingPreset) {
    if (typeof globalThis.togglePresetRegion === "function") {
      globalThis.togglePresetRegion(id);
    }
    return;
  }

  if (state.currentTool === "eraser") {
    const shouldRefreshCountryList = state.interactionGranularity === "country" && !!countryCode;
    if (state.interactionGranularity === "country" && countryCode) {
      delete state.countryBaseColors[countryCode];
    } else {
      targetIds.forEach((targetId) => {
        delete state.featureOverrides[targetId];
      });
    }
    refreshColorState({ renderNow: true });
    if (shouldRefreshCountryList && typeof state.renderCountryListFn === "function") {
      state.renderCountryListFn();
    }
    return;
  }

  if (state.currentTool === "eyedropper") {
    const picked =
      (state.interactionGranularity === "country" && countryCode
        ? getSafeCanvasColor(state.countryBaseColors?.[countryCode], null)
        : null) ||
      getSafeCanvasColor(state.colors[id], null);
    if (picked) {
      state.selectedColor = picked;
      if (typeof state.updateSwatchUIFn === "function") {
        state.updateSwatchUIFn();
      }
    }
    return;
  }

  const selectedColor = getSafeCanvasColor(state.selectedColor, LAND_FILL_COLOR);
  state.selectedColor = selectedColor;
  if (state.interactionGranularity === "country" && countryCode) {
    state.countryBaseColors[countryCode] = selectedColor;
  } else {
    targetIds.forEach((targetId) => {
      state.featureOverrides[targetId] = selectedColor;
    });
  }
  addRecentColor(selectedColor);
  refreshColorState({ renderNow: true });
  if (
    state.interactionGranularity === "country" &&
    countryCode &&
    typeof state.renderCountryListFn === "function"
  ) {
    state.renderCountryListFn();
  }
}

function handleDoubleClick(event) {
  if (!state.specialZoneEditor?.active) return;
  if (event?.preventDefault) event.preventDefault();
  finishSpecialZoneDraw();
}

function calculatePanExtent() {
  const fallback = [
    [-MAP_PAN_PADDING_PX, -MAP_PAN_PADDING_PX],
    [state.width + MAP_PAN_PADDING_PX, state.height + MAP_PAN_PADDING_PX],
  ];

  if (!pathSVG || !state.landData || !state.landData.features?.length) return fallback;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();

  for (const feature of state.landData.features) {
    if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) continue;
    const featureId = getFeatureId(feature);
    const bounds = getProjectedFeatureBounds(feature, { featureId, allowCompute: false })
      || getProjectedFeatureBounds(feature, { featureId });
    if (!bounds) continue;

    const featureMinX = bounds.minX;
    const featureMinY = bounds.minY;
    const featureMaxX = bounds.maxX;
    const featureMaxY = bounds.maxY;

    minX = Math.min(minX, featureMinX);
    minY = Math.min(minY, featureMinY);
    maxX = Math.max(maxX, featureMaxX);
    maxY = Math.max(maxY, featureMaxY);
  }

  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return fallback;

  return [
    [minX - MAP_PAN_PADDING_PX, minY - MAP_PAN_PADDING_PX],
    [maxX + MAP_PAN_PADDING_PX, maxY + MAP_PAN_PADDING_PX],
  ];
}

function updateZoomTranslateExtent() {
  if (!zoomBehavior || state.width <= 0 || state.height <= 0) return;
  zoomBehavior.scaleExtent([MIN_ZOOM_SCALE, MAX_ZOOM_SCALE]);
  zoomBehavior.extent([[0, 0], [state.width, state.height]]);
  zoomBehavior.translateExtent(calculatePanExtent());
}

function updateMap(transform) {
  state.zoomTransform = transform;
  if (viewportGroup) {
    viewportGroup.attr("transform", `translate(${transform.x},${transform.y}) scale(${transform.k})`);
  }
  drawCanvas();
}

function resetZoomToFit() {
  if (!zoomBehavior || !interactionRect || !globalThis.d3) return;
  const identity = globalThis.d3.zoomIdentity;
  state.zoomTransform = identity;
  globalThis.d3.select(interactionRect.node()).call(zoomBehavior.transform, identity);
}

function enforceZoomConstraints() {
  if (!zoomBehavior || !interactionRect || !globalThis.d3) return;
  globalThis.d3.select(interactionRect.node()).call(zoomBehavior.translateBy, 0, 0);
}

function fitProjection() {
  if (!state.landData?.features?.length || state.width <= 0 || state.height <= 0) {
    return;
  }
  const padding = Math.max(16, Math.round(Math.min(state.width, state.height) * PROJECTION_FIT_PADDING_RATIO));
  const x1 = Math.max(padding + 1, state.width - padding);
  const y1 = Math.max(padding + 1, state.height - padding);
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  const renderableFeatures = getRenderableLandFeatures(canvasWidth, canvasHeight, {
    forceProd: true,
  });
  const fitTarget = renderableFeatures.length
    ? { type: "FeatureCollection", features: renderableFeatures }
    : state.landData;
  projection.fitExtent([[padding, padding], [x1, y1]], fitTarget);
  rebuildProjectedBoundsCache();
  buildSpatialIndex();
  updateSpecialZonesPaths();
  renderSpecialZoneEditorOverlay();
  updateZoomTranslateExtent();
}

function handleResize() {
  setCanvasSize();
  fitProjection();
  resetZoomToFit();
  enforceZoomConstraints();
  render();
}

function initZoom() {
  zoomBehavior = globalThis.d3
    .zoom()
    .scaleExtent([MIN_ZOOM_SCALE, MAX_ZOOM_SCALE])
    .extent([[0, 0], [state.width, state.height]])
    .on("start", () => {
      clearRenderPhaseTimer();
      setRenderPhase(RENDER_PHASE_INTERACTING);
      renderHoverOverlay();
    })
    .on("zoom", (event) => {
      if (!state.zoomRenderScheduled) {
        state.zoomRenderScheduled = true;
        requestAnimationFrame(() => {
          updateMap(event.transform);
          state.zoomRenderScheduled = false;
        });
      }
    })
    .on("end", (event) => {
      setRenderPhase(RENDER_PHASE_SETTLING);
      updateMap(event.transform);
      scheduleRenderPhaseIdle();
    });

  updateZoomTranslateExtent();
  const zoomTarget = globalThis.d3.select(interactionRect.node());
  zoomTarget.call(zoomBehavior);
  zoomTarget.on("dblclick.zoom", null);
  resetZoomToFit();
  enforceZoomConstraints();
}

function bindEvents() {
  if (!interactionRect) return;
  interactionRect.on("mousemove", handleMouseMove);
  interactionRect.on("mouseleave", () => {
    state.hoveredId = null;
    renderHoverOverlay();
    if (tooltip) tooltip.style.opacity = "0";
  });
  interactionRect.on("click", handleClick);
  interactionRect.on("dblclick", handleDoubleClick);
  window.addEventListener("resize", handleResize);
}

function initMap({ containerId = "mapContainer" } = {}) {
  if (!globalThis.d3) {
    console.error("D3 is required for map renderer.");
    return;
  }

  mapContainer = document.getElementById(containerId);
  textureOverlay = document.getElementById("textureOverlay");
  tooltip = document.getElementById("tooltip");

  if (!mapContainer) {
    console.error("Map container not found.");
    return;
  }

  ensureHybridLayers();

  context = mapCanvas.getContext("2d");
  if (!context) {
    console.error("Canvas 2D context unavailable.");
    return;
  }

  projection = globalThis.d3.geoEqualEarth().precision(PROJECTION_PRECISION);
  projection.clipExtent(null);
  pathSVG = globalThis.d3.geoPath(projection).pointRadius(PATH_POINT_RADIUS);
  pathCanvas = globalThis.d3.geoPath(projection, context).pointRadius(PATH_POINT_RADIUS);
  layerResolverCache.primaryRef = null;
  layerResolverCache.detailRef = null;
  layerResolverCache.bundleMode = null;
  ensureLayerDataFromTopology();

  state.colorCanvas = mapCanvas;
  state.lineCanvas = null;
  state.colorCtx = context;
  state.lineCtx = null;
  state.countryBaseColors = sanitizeCountryColorMap(state.countryBaseColors);
  state.featureOverrides = sanitizeColorMap(state.featureOverrides);
  state.colors = sanitizeColorMap(state.colors);
  state.debugMode = debugMode;
  resetRenderDiagnostics();
  clearRenderPhaseTimer();
  state.renderPhase = RENDER_PHASE_IDLE;
  state.phaseEnteredAt = nowMs();
  state.renderPhaseTimerId = null;
  state.projectedBoundsById = new Map();

  mapCanvas.style.pointerEvents = "none";
  mapCanvas.style.touchAction = "none";
  if (textureOverlay) textureOverlay.style.pointerEvents = "none";

  setCanvasSize();
  buildIndex();
  rebuildStaticMeshes();
  invalidateBorderCache();
  fitProjection();
  initZoom();
  bindEvents();

  render();
}

function setMapData() {
  clearRenderPhaseTimer();
  setRenderPhase(RENDER_PHASE_IDLE);
  resetRenderDiagnostics();
  layerResolverCache.primaryRef = null;
  layerResolverCache.detailRef = null;
  layerResolverCache.bundleMode = null;
  ensureLayerDataFromTopology();
  const primaryTopology = state.topologyPrimary || state.topology;
  const detailTopology = state.topologyBundleMode === "composite" ? state.topologyDetail : null;
  const overrideCollection = state.topologyBundleMode === "composite" ? state.ruCityOverrides : null;
  if (primaryTopology?.objects?.political && globalThis.topojson) {
    state.landData = state.topologyBundleMode === "composite"
      ? composePoliticalFeatures(primaryTopology, detailTopology, overrideCollection)
      : getPoliticalFeatureCollection(primaryTopology, "primary");
  }

  if (state.topologyBundleMode === "composite" && Array.isArray(state.landData?.features)) {
    const coverage = collectCountryCoverageStats(state.landData.features);
    console.info(
      `[map_renderer] Composite coverage: countries detail=${coverage.detailCountries}, primaryFallback=${coverage.primaryCountries}, total=${coverage.totalCountries}; features detail=${coverage.detailFeatures}, primary=${coverage.primaryFeatures}, total=${coverage.totalFeatures}.`
    );
  }

  state.countryBaseColors = sanitizeCountryColorMap(state.countryBaseColors);
  state.featureOverrides = sanitizeColorMap(state.featureOverrides);
  islandNeighborsCache = {
    topologyRef: null,
    objectRef: null,
    count: 0,
    neighbors: [],
  };
  buildIndex();
  rebuildProjectedBoundsCache();
  rebuildStaticMeshes();
  invalidateBorderCache();
  fitProjection();
  rebuildResolvedColors();
  resetZoomToFit();
  enforceZoomConstraints();
  drawCanvas();
  render();
}

export {
  initMap,
  setMapData,
  render,
  autoFillMap,
  startSpecialZoneDraw,
  undoSpecialZoneVertex,
  finishSpecialZoneDraw,
  cancelSpecialZoneDraw,
  deleteSelectedManualSpecialZone,
  selectSpecialZoneById,
  rebuildStaticMeshes,
  invalidateBorderCache,
  refreshColorState,
  setDebugMode,
};
