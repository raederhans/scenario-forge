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
const KNOWN_BAD_FEATURE_IDS = new Set([
  "RU_RAY_50074027B10564453072266",
  "RU_RAY_50074027B19237962816289",
  "RU_RAY_50074027B45979560927325",
]);
const DEBUG_MODES = new Set(["PROD", "GEOMETRY", "ARTIFACTS", "ISLANDS", "ID_HASH"]);
const COLOR_HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNC_RE = /^(?:rgb|rgba|hsl|hsla)\([^)]*\)$/i;
const COLOR_NAME_RE = /^[a-z]+$/i;
let debugMode = "PROD";
let islandNeighborsCache = {
  topologyRef: null,
  objectRef: null,
  count: 0,
  neighbors: [],
};

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

function getProjectedFeatureBounds(feature) {
  const pathRef = pathCanvas || pathSVG;
  if (!pathRef || !feature) return null;
  const bounds = pathRef.bounds(feature);
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

function shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd = false } = {}) {
  if (!forceProd && debugMode !== "PROD") {
    return false;
  }

  const featureId = getFeatureId(feature);
  if (isKnownBadFeatureId(featureId)) {
    return true;
  }

  const bounds = getProjectedFeatureBounds(feature);
  if (!bounds) {
    return false;
  }

  const giant = isGiantFeature(feature, canvasWidth, canvasHeight, bounds);
  const wrapArtifact = isProjectedWrapArtifact(feature, canvasWidth, canvasHeight, bounds);
  if (!giant && !wrapArtifact) {
    return false;
  }

  const countryCode = getFeatureCountryCodeNormalized(feature);
  const isTrustedAdmin0Shell =
    GIANT_FEATURE_ALLOWLIST.has(countryCode) &&
    isAdmin0ShellFeature(feature, featureId);
  return !isTrustedAdmin0Shell;
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
    features: features.map((feature) => ({
      ...feature,
      properties: {
        ...(feature?.properties || {}),
        __source: sourceName,
      },
    })),
  };
}

function composePoliticalFeatures(primaryTopology, detailTopology) {
  const primaryCollection = getPoliticalFeatureCollection(primaryTopology, "primary");
  if (!detailTopology) {
    return primaryCollection;
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

  return {
    type: "FeatureCollection",
    features,
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
  const bounds = pathSVG.bounds(feature);
  const minX = bounds[0][0] * state.zoomTransform.k + state.zoomTransform.x;
  const minY = bounds[0][1] * state.zoomTransform.k + state.zoomTransform.y;
  const maxX = bounds[1][0] * state.zoomTransform.k + state.zoomTransform.x;
  const maxY = bounds[1][1] * state.zoomTransform.k + state.zoomTransform.y;
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

function ensureLayerDataFromTopology() {
  const baseTopology = state.topologyPrimary || state.topology;
  if (!baseTopology || !baseTopology.objects || !globalThis.topojson) return;
  const objects = baseTopology.objects;

  if (!state.oceanData && objects.ocean) {
    state.oceanData = globalThis.topojson.feature(baseTopology, objects.ocean);
  }
  if (!state.landBgData && objects.land) {
    state.landBgData = globalThis.topojson.feature(baseTopology, objects.land);
  }
  if (!state.riversData && objects.rivers) {
    state.riversData = globalThis.topojson.feature(baseTopology, objects.rivers);
  }
  if (!state.urbanData && objects.urban) {
    state.urbanData = globalThis.topojson.feature(baseTopology, objects.urban);
  }
  if (!state.physicalData && objects.physical) {
    state.physicalData = globalThis.topojson.feature(baseTopology, objects.physical);
  }
  if (!state.specialZonesData && objects.special_zones) {
    state.specialZonesData = globalThis.topojson.feature(baseTopology, objects.special_zones);
  }

  // Composite mode owns state.landData and must not be overwritten by primary political-only data.
  if (state.topologyBundleMode === "composite") {
    return;
  }

  if (objects.political) {
    const expectedCount = Array.isArray(objects.political.geometries)
      ? objects.political.geometries.length
      : 0;
    const currentCount = Array.isArray(state.landData?.features)
      ? state.landData.features.length
      : 0;
    if (currentCount !== expectedCount) {
      state.landData = globalThis.topojson.feature(baseTopology, objects.political);
    }
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

  const countryMesh = globalThis.topojson.mesh(
    topology,
    object,
    (a, b) => {
      if (!a || !b) return false;
      if (!inScope(a) || !inScope(b)) return false;
      const codeA = getFeatureCountryCodeNormalized(a);
      const codeB = getFeatureCountryCodeNormalized(b);
      return !!(codeA && codeB && codeA !== codeB);
    }
  );

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

  const coastlineMesh = globalThis.topojson.mesh(
    topology,
    object,
    (a, b) => !!(a && !b && inScope(a))
  );

  return {
    countryMesh,
    provinceMesh,
    localMesh,
    coastlineMesh,
  };
}

function rebuildStaticMeshes() {
  state.cachedCountryBorders = [];
  state.cachedProvinceBorders = [];
  state.cachedLocalBorders = [];
  state.cachedCoastlines = [];
  state.cachedGridLines = [];
  if (!globalThis.topojson) return;

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

    if (isUsableMesh(meshes.countryMesh)) state.cachedCountryBorders.push(meshes.countryMesh);
    if (isUsableMesh(meshes.provinceMesh)) state.cachedProvinceBorders.push(meshes.provinceMesh);
    if (isUsableMesh(meshes.localMesh)) state.cachedLocalBorders.push(meshes.localMesh);
    if (isUsableMesh(meshes.coastlineMesh)) state.cachedCoastlines.push(meshes.coastlineMesh);
  });

  // Backward compatibility: expose local boundaries as "grid lines".
  state.cachedGridLines = [...(state.cachedLocalBorders || [])];
}

function invalidateBorderCache() {
  rebuildDynamicBorders();
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
}

function buildSpatialIndex() {
  state.spatialItems = [];
  state.spatialIndex = null;
  if (!state.landData || !state.landData.features || !pathSVG) return;
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();

  for (const feature of state.landData.features) {
    const id = getFeatureId(feature);
    if (!id) continue;
    if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) continue;
    const bounds = pathSVG.bounds(feature);
    const minX = bounds[0][0];
    const minY = bounds[0][1];
    const maxX = bounds[1][0];
    const maxY = bounds[1][1];
    if (![minX, minY, maxX, maxY].every(Number.isFinite)) continue;

    state.spatialItems.push({
      id,
      feature,
      minX,
      minY,
      maxX,
      maxY,
      cx: (minX + maxX) / 2,
      cy: (minY + maxY) / 2,
    });
  }

  state.spatialIndex = globalThis.d3
    .quadtree()
    .x((item) => item.cx)
    .y((item) => item.cy)
    .addAll(state.spatialItems);
}

function getFeatureIdFromEvent(event) {
  if (!state.landData || !mapSvg || !projection) return null;

  const [sx, sy] = globalThis.d3.pointer(event, mapSvg);
  const px = (sx - state.zoomTransform.x) / state.zoomTransform.k;
  const py = (sy - state.zoomTransform.y) / state.zoomTransform.k;
  if (!Number.isFinite(px) || !Number.isFinite(py)) return null;

  const lonLat = projection.invert([px, py]);
  if (!lonLat) return null;

  const candidates = [];
  if (state.spatialIndex) {
    state.spatialIndex.visit((node, x0, y0, x1, y1) => {
      if (px < x0 || px > x1 || py < y0 || py > y1) return true;
      if (!node.length) {
        let current = node;
        do {
          const item = current.data;
          if (
            item &&
            px >= item.minX && px <= item.maxX &&
            py >= item.minY && py <= item.maxY
          ) {
            candidates.push(item);
          }
          current = current.next;
        } while (current);
      }
      return false;
    });
  }

  for (const candidate of candidates) {
    if (globalThis.d3.geoContains(candidate.feature, lonLat)) {
      return candidate.id;
    }
  }

  return null;
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

function drawHierarchicalBorders(k) {
  const zoomK = clamp(k, 1, 6);
  const t = (zoomK - 1) / 5;
  const internal = state.styleConfig?.internalBorders || {};
  const empire = state.styleConfig?.empireBorders || {};
  const coast = state.styleConfig?.coastlines || {};

  const empireColor = getSafeCanvasColor(empire.color, "#666666");
  const internalColor = getSafeCanvasColor(internal.color, "#cccccc");
  const coastColor = getSafeCanvasColor(coast.color, "#333333");

  const empireWidthBase = Number(empire.width) || 1;
  const internalWidthBase = Number(internal.width) || 0.5;
  const coastWidthBase = Number(coast.width) || 1.2;
  const internalOpacity = Number.isFinite(Number(internal.opacity)) ? Number(internal.opacity) : 1;

  const countryAlpha = 0.88;
  const provinceAlpha = clamp(internalOpacity * (0.28 + 0.30 * t), 0.18, 0.62);
  const localAlpha = clamp(internalOpacity * (0.10 + 0.22 * t), 0.07, 0.35);
  const coastAlpha = 0.80;

  const countryWidth = (empireWidthBase * (1.0 + 0.20 * t)) / k;
  const provinceWidth = (internalWidthBase * (0.90 + 0.20 * t)) / k;
  const localWidth = Math.max(0.18, internalWidthBase * 0.55 * (0.85 + 0.20 * t)) / k;
  const coastWidth = coastWidthBase / k;

  context.globalAlpha = localAlpha;
  drawMeshCollection(state.cachedLocalBorders, internalColor, localWidth);

  context.globalAlpha = provinceAlpha;
  drawMeshCollection(state.cachedProvinceBorders, internalColor, provinceWidth);

  context.globalAlpha = countryAlpha;
  drawMeshCollection(state.cachedCountryBorders, empireColor, countryWidth);

  context.globalAlpha = coastAlpha;
  drawMeshCollection(state.cachedCoastlines, coastColor, coastWidth);

  context.globalAlpha = 1.0;
}

function drawCanvas() {
  if (!context || !pathCanvas) return;
  ensureLayerDataFromTopology();

  const width = context.canvas.width;
  const height = context.canvas.height;
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  const t = state.zoomTransform || globalThis.d3.zoomIdentity;
  const k = Math.max(0.0001, t.k || 1);

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
  context.fillStyle = OCEAN_FILL_COLOR;
  context.beginPath();
  pathCanvas({ type: "Sphere" });
  context.fill();

  if (state.oceanData) {
    context.fillStyle = OCEAN_FILL_COLOR;
    context.beginPath();
    pathCanvas(state.oceanData);
    context.fill();
  }

  // 4. Draw political features only (no base land layer)
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

    // 5. Draw border hierarchy (country > province > local) after fills.
    drawHierarchicalBorders(k);
  }
}

function updateSpecialZonesPaths() {
  if (!specialZonesGroup || !pathSVG) return;

  const features = state.specialZonesData?.features || [];
  if (!features.length) {
    specialZonesGroup.selectAll("path.special-zone").remove();
    return;
  }

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
    .attr("fill", (d) => {
      const type = d?.properties?.type || "";
      if (type === "disputed") return "rgba(249,115,22,0.15)";
      if (type === "wasteland") return "rgba(220,38,38,0.12)";
      return "none";
    })
    .attr("stroke", (d) => {
      const type = d?.properties?.type || "";
      if (type === "disputed") return "#f97316";
      if (type === "wasteland") return "#dc2626";
      return "#111827";
    })
    .attr("stroke-width", 1.2)
    .attr("opacity", 0.85);

  selection.exit().remove();
}

function renderHoverOverlay() {
  if (!hoverGroup || !pathSVG) return;

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
  if (!specialZonesGroup) return;
  if (!state.showSpecialZones) {
    specialZonesGroup.attr("display", "none");
    return;
  }
  specialZonesGroup.attr("display", null);
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
  renderLegend();
  if (typeof state.updateLegendUI === "function") {
    state.updateLegendUI();
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
}

function handleMouseMove(event) {
  const now = performance.now();
  if (now - state.lastMouseMoveTime < state.MOUSE_THROTTLE_MS) return;
  state.lastMouseMoveTime = now;
  if (!state.landData || state.isInteracting) return;

  const id = getFeatureIdFromEvent(event);
  if (id !== state.hoveredId) {
    state.hoveredId = id;
    renderHoverOverlay();
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

  const id = getFeatureIdFromEvent(event);
  if (!id) return;
  const feature = state.landIndex.get(id);
  if (!feature) return;
  const countryCode = getFeatureCountryCodeNormalized(feature);
  const targetIds = resolveInteractionTargetIds(feature, id);

  if (state.isEditingPreset) {
    if (typeof globalThis.togglePresetRegion === "function") {
      globalThis.togglePresetRegion(id);
    }
    return;
  }

  if (state.currentTool === "eraser") {
    if (state.interactionGranularity === "country" && countryCode) {
      delete state.countryBaseColors[countryCode];
    } else {
      targetIds.forEach((targetId) => {
        delete state.featureOverrides[targetId];
      });
    }
    refreshColorState({ renderNow: true });
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
    const bounds = pathSVG.bounds(feature);
    if (!bounds || bounds.length !== 2) continue;

    const featureMinX = bounds[0][0];
    const featureMinY = bounds[0][1];
    const featureMaxX = bounds[1][0];
    const featureMaxY = bounds[1][1];
    if (![featureMinX, featureMinY, featureMaxX, featureMaxY].every(Number.isFinite)) {
      continue;
    }

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
  buildSpatialIndex();
  updateSpecialZonesPaths();
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
      state.isInteracting = true;
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
      state.isInteracting = false;
      updateMap(event.transform);
      renderHoverOverlay();
    });

  updateZoomTranslateExtent();
  globalThis.d3.select(interactionRect.node()).call(zoomBehavior);
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
  ensureLayerDataFromTopology();

  state.colorCanvas = mapCanvas;
  state.lineCanvas = null;
  state.colorCtx = context;
  state.lineCtx = null;
  state.countryBaseColors = sanitizeCountryColorMap(state.countryBaseColors);
  state.featureOverrides = sanitizeColorMap(state.featureOverrides);
  state.colors = sanitizeColorMap(state.colors);
  state.debugMode = debugMode;

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
  ensureLayerDataFromTopology();
  const primaryTopology = state.topologyPrimary || state.topology;
  const detailTopology = state.topologyBundleMode === "composite" ? state.topologyDetail : null;
  if (primaryTopology?.objects?.political && globalThis.topojson) {
    state.landData = state.topologyBundleMode === "composite"
      ? composePoliticalFeatures(primaryTopology, detailTopology)
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
  rebuildResolvedColors();
  rebuildStaticMeshes();
  invalidateBorderCache();
  fitProjection();
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
  rebuildStaticMeshes,
  invalidateBorderCache,
  refreshColorState,
  setDebugMode,
};
