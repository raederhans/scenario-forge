// Hybrid canvas + SVG rendering engine.
import {
  normalizeDayNightStyleConfig,
  normalizeLakeStyleConfig,
  normalizePhysicalStyleConfig,
  normalizeTextureStyleConfig,
  PHYSICAL_ATLAS_PALETTE,
  state,
} from "./state.js";
import {
  MODERN_CITY_LIGHTS_BASE_THRESHOLD,
  MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD,
  MODERN_CITY_LIGHTS_GRID,
  MODERN_CITY_LIGHTS_GRID_HEIGHT,
  MODERN_CITY_LIGHTS_GRID_WIDTH,
  MODERN_CITY_LIGHTS_STEP_LAT_DEG,
  MODERN_CITY_LIGHTS_STEP_LON_DEG,
} from "./city_lights_modern_asset.js";
import { ColorManager } from "./color_manager.js";
import { LegendManager } from "./legend_manager.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import { getTooltipText, t } from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";
import { markDirty } from "./dirty_state.js";
import {
  ensureSovereigntyState,
  getFeatureOwnerCode,
  getFeatureIdsForOwner,
  migrateLegacyColorState,
  setFeatureOwnerCodes,
  resetFeatureOwnerCodes,
} from "./sovereignty_manager.js";

let mapContainer = null;
let mapCanvas = null;
let hitCanvas = null;
let mapSvg = null;
let interactionRect = null;
let tooltip = null;
let context = null;
let hitContext = null;

let projection = null;
let pathSVG = null;
let pathCanvas = null;
let pathHitCanvas = null;
let zoomBehavior = null;
let activeContextMetricSession = null;

let viewportGroup = null;
let specialZonesGroup = null;
let specialZoneEditorGroup = null;
let hoverGroup = null;
let devSelectionGroup = null;
let inspectorHighlightGroup = null;
let legendGroup = null;
let legendItemsGroup = null;
let legendBackground = null;
let lastLegendKey = null;
let brushSession = null;
let suppressNextClickAfterBrush = false;
let lastDetailToastToken = "";
let lastDetailToastAt = 0;
let lastSpecialZonesOverlaySignature = "";
let lastInspectorOverlaySignature = "";
let lastHoverOverlaySignature = "";
let lastDevSelectionOverlaySignature = "";

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
const SPECIAL_REGION_FALLBACK_FILL = "#d6c19a";
const SPECIAL_REGION_FALLBACK_STROKE = "#8d6f47";
const UNIFIED_WATER_STROKE_COLOR = "rgba(62, 96, 138, 0)";
const UNIFIED_WATER_FILL_OPACITY = 1;
const RELIEF_SALT_FILL_COLOR = "rgba(222, 203, 170, 0.22)";
const RELIEF_SALT_STROKE_COLOR = "rgba(128, 100, 63, 0.55)";
const RELIEF_SHORELINE_COLOR = "rgba(109, 84, 50, 0.78)";
const RELIEF_CONTOUR_COLOR = "rgba(176, 148, 103, 0.6)";
const RELIEF_SWAMP_FILL_COLOR = "rgba(128, 150, 114, 0.18)";
const RELIEF_SWAMP_STROKE_COLOR = "rgba(88, 108, 76, 0.52)";
const RELIEF_LAKE_SHORELINE_COLOR = "rgba(214, 232, 244, 0.92)";
const RELIEF_DAM_APPROACH_COLOR = "rgba(102, 86, 62, 0.8)";
const GIANT_FEATURE_CULL_RATIO = 0.95;
const GIANT_FEATURE_ALLOWLIST = new Set(["RU", "CA", "CN", "US", "AQ", "ATA"]);
const COUNTRY_CODE_ALIASES = {
  UK: "GB",
  EL: "GR",
};
const INTERACTIVE_AGGREGATE_TIER_FILTERS = {
  GB: new Set(["nuts1_basic"]),
  GR: new Set(["adm1_basic"]),
};
const WRAP_ARTIFACT_WIDTH_RATIO = 0.9;
const WRAP_ARTIFACT_HEIGHT_RATIO = 0.3;
const WRAP_ARTIFACT_AREA_RATIO = 0.35;
const WRAP_ARTIFACT_ASPECT_MIN = 1.6;
const HIT_GRID_TARGET_COLS = 24;
const HIT_GRID_MIN_CELL_PX = 32;
const HIT_GRID_MAX_CELL_PX = 96;
const HIT_SNAP_RADIUS_PX = 8;
const HIT_SNAP_RADIUS_HOVER_PX = 0;
const HIT_SNAP_RADIUS_CLICK_PX = 3;
const HIT_MAX_CELLS_PER_ITEM = 400;
const HIT_MODE_PARAM = "hit_mode";
const HIT_MODES = new Set(["auto", "canvas", "spatial"]);
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
const EXACT_AFTER_SETTLE_QUIET_WINDOW_MS = 450;
const CONTEXT_BASE_REUSE_MIN_DISTANCE_PX = 320;
const CONTEXT_BASE_REUSE_MAX_DISTANCE_PX = 640;
const CONTEXT_BASE_REUSE_MAX_DISTANCE_VIEWPORT_RATIO = 0.35;
const CONTEXT_BASE_MINOR_CONTOUR_THRESHOLD = 2;
const CONTEXT_BASE_BUCKET_LOW_MAX = 1.4;
const CONTEXT_BASE_BUCKET_MID_MAX = 2.5;
const INTERNAL_BORDER_PROVINCE_MIN_ALPHA = 0.30;
const INTERNAL_BORDER_LOCAL_MIN_ALPHA = 0.22;
const INTERNAL_BORDER_PROVINCE_MIN_WIDTH = 0.52;
const INTERNAL_BORDER_LOCAL_MIN_WIDTH = 0.36;
const DETAIL_ADM_BORDER_COLOR = "#888888";
const DETAIL_ADM_BORDER_MIN_ALPHA = 0.24;
const DETAIL_ADM_BORDER_MAX_ALPHA = 0.34;
const DETAIL_ADM_BORDER_MIN_WIDTH = 0.30;
const LOCAL_BORDERS_MIN_ZOOM = 2.0;
const DETAIL_ADM_BORDERS_MIN_ZOOM = 2.4;
const PROVINCE_BORDERS_FADE_START_ZOOM = 1.1;
const PROVINCE_BORDERS_TRANSITION_END_ZOOM = 2.0;
const PROVINCE_BORDERS_FAR_ALPHA = 0.10;
const PROVINCE_BORDERS_TRANSITION_ALPHA = 0.38;
const PROVINCE_BORDERS_FAR_WIDTH_MAX_ZOOM = 1.5;
const PROVINCE_BORDERS_FAR_WIDTH_SCALE = 0.75;
const PARENT_BORDER_MIN_COVERAGE = 0.70;
const PARENT_BORDER_MAX_DOMINANT_SHARE = 0.90;
const PARENT_BORDER_MIN_RENDERABLE_GROUPS = 2;
const GB_PARENT_MIN_GROUPS = 20;
const GB_NUTS1_GROUP_MIN = 10;
const GB_NUTS1_PREFIX_LENGTH = 3;
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
const CONTEXT_BREAKDOWN_METRIC_NAMES = new Set([
  "drawPhysicalAtlasLayer",
  "drawPhysicalContourLayer",
  "drawUrbanLayer",
  "drawRiversLayer",
  "drawScenarioRegionOverlaysPass",
  "drawScenarioReliefOverlaysLayer",
]);
const LAYER_DIAG_PREFIX = "[layer-resolver]";
const DEFAULT_SPECIAL_ZONE_TYPE = "custom";
const PAPER_TEXTURE_BASE_TILE_SIZE = 512;
const PAPER_NOISE_TILE_SIZE = 192;
const TEXTURE_LABEL_SERIF_STACK = "\"Iowan Old Style\", \"Palatino Linotype\", Georgia, serif";
const GRATICULE_SAMPLE_DEGREES = 2;
const PAPER_TEXTURE_ASSET_URLS = {
  paper_vintage_01: new URL("../../vendor/textures/paper_vintage_01.svg", import.meta.url).href,
};
// Keep this list empty by default. Polygon winding issues are repaired dynamically.
const KNOWN_BAD_FEATURE_IDS = new Set();
const DEBUG_MODES = new Set(["PROD", "GEOMETRY", "ARTIFACTS", "ISLANDS", "ID_HASH"]);
const COLOR_HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const COLOR_FUNC_RE = /^(?:rgb|rgba|hsl|hsla)\([^)]*\)$/i;
const COLOR_NAME_RE = /^[a-z]+$/i;
const RENDER_DIAG_PARAM = "render_diag";
const PERF_OVERLAY_PARAM = "perf_overlay";
const DAY_NIGHT_CLOCK_INTERVAL_MS = 15_000;
const RENDER_PASS_NAMES = ["background", "political", "effects", "contextBase", "contextScenario", "dayNight", "borders"];
const HEAVY_SCENARIO_STAGED_APPLY_FEATURE_THRESHOLD = 12000;
const STAGED_CONTEXT_BASE_TIMEOUT_MS = 180;
const STAGED_HIT_CANVAS_TIMEOUT_MS = 260;
let debugMode = "PROD";
let islandNeighborsCache = {
  topologyRef: null,
  objectRef: null,
  count: 0,
  neighbors: [],
};
const oceanPatternCache = new Map();
const textureAssetCache = new Map();
const texturePatternCache = new Map();
const textureGeometryCache = new Map();
const textureNoiseTileCache = new Map();
const modernCityLightsGeometryCache = {
  projectionKey: "",
  baseEntries: [],
  corridorEntries: [],
};
const layerResolverCache = {
  primaryRef: null,
  detailRef: null,
  bundleMode: null,
};
let admin0MergedCache = {
  topologyRef: null,
  featureCount: 0,
  entries: [],
};
let scenarioPoliticalBackgroundCache = {
  topologyRef: null,
  landCollectionRef: null,
  scenarioId: "",
  viewMode: "ownership",
  oceanFillColor: "",
  topologyRevision: 0,
  colorRevision: 0,
  sovereigntyRevision: 0,
  controllerRevision: 0,
  shellRevision: 0,
  canvasWidth: 0,
  canvasHeight: 0,
  featureCount: 0,
  entries: [],
};
let physicalLandClipPathCache = {
  key: "",
  path: null,
};
const SCENARIO_BACKGROUND_MERGE_MAX_AREA = Math.PI * 2;
const suspiciousScenarioBackgroundMergeWarnings = new Set();
const missingPhysicalContextWarnings = new Set();
const physicalAtlasFallbackCache = {
  sourceRef: null,
  collection: null,
};
const renderDiag = {
  enabled: false,
  seenKeys: new Set(),
  skippedByReason: new Map(),
  skippedByCountry: new Map(),
  sampleByReason: new Map(),
};
const rewoundFeatureLogKeys = new Set();
const urbanGeoCentroidCache = new WeakMap();
let dayNightClockTimerId = null;
let lastDayNightClockToken = "";

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

function isPerfOverlayEnabled() {
  const raw = readSearchParam(PERF_OVERLAY_PARAM);
  return ["1", "true", "yes", "on"].includes(raw);
}

function getRenderPassCacheState() {
  if (!state.renderPassCache || typeof state.renderPassCache !== "object") {
    state.renderPassCache = {};
  }
  const cache = state.renderPassCache;
  cache.canvases = cache.canvases && typeof cache.canvases === "object" ? cache.canvases : {};
  cache.signatures = cache.signatures && typeof cache.signatures === "object" ? cache.signatures : {};
  cache.referenceTransforms = cache.referenceTransforms && typeof cache.referenceTransforms === "object"
    ? cache.referenceTransforms
    : {};
  cache.dirty = cache.dirty && typeof cache.dirty === "object" ? cache.dirty : {};
  cache.reasons = cache.reasons && typeof cache.reasons === "object" ? cache.reasons : {};
  cache.counters = cache.counters && typeof cache.counters === "object" ? cache.counters : {};
  RENDER_PASS_NAMES.forEach((passName) => {
    if (!(passName in cache.dirty)) {
      cache.dirty[passName] = true;
    }
    if (!(passName in cache.reasons)) {
      cache.reasons[passName] = "init";
    }
  });
  const counterDefaults = {
    frames: 0,
    composites: 0,
    transformedFrames: 0,
    drawCanvas: 0,
    backgroundPassRenders: 0,
    politicalPassRenders: 0,
    effectsPassRenders: 0,
    contextPassRenders: 0,
    contextBasePassRenders: 0,
    contextScenarioPassRenders: 0,
    dayNightPassRenders: 0,
    borderPassRenders: 0,
    hitCanvasRenders: 0,
    dynamicBorderRebuilds: 0,
  };
  Object.entries(counterDefaults).forEach(([counterName, initialValue]) => {
    if (!Number.isFinite(Number(cache.counters[counterName]))) {
      cache.counters[counterName] = initialValue;
    }
  });
  return cache;
}

function getSidebarPerfState() {
  if (!state.sidebarPerf || typeof state.sidebarPerf !== "object") {
    state.sidebarPerf = {};
  }
  if (!state.sidebarPerf.counters || typeof state.sidebarPerf.counters !== "object") {
    state.sidebarPerf.counters = {};
  }
  return state.sidebarPerf;
}

function ensureRenderPerfMetrics() {
  if (!state.renderPerfMetrics || typeof state.renderPerfMetrics !== "object") {
    state.renderPerfMetrics = {};
  }
  return state.renderPerfMetrics;
}

function recordRenderPerfMetric(name, durationMs, details = {}) {
  const metrics = ensureRenderPerfMetrics();
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return null;
  const nextEntry = {
    durationMs: Math.max(0, Number(durationMs) || 0),
    recordedAt: Date.now(),
    ...details,
  };
  metrics[normalizedName] = nextEntry;
  globalThis.__renderPerfMetrics = metrics;
  return nextEntry;
}

function beginContextMetricSession() {
  activeContextMetricSession = {
    metrics: {},
  };
}

function collectContextMetric(name, durationMs, details = {}) {
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return null;
  const nextEntry = {
    durationMs: Math.max(0, Number(durationMs) || 0),
    recordedAt: Date.now(),
    ...details,
  };
  if (!activeContextMetricSession?.metrics) {
    return recordRenderPerfMetric(normalizedName, nextEntry.durationMs, details);
  }
  const existingEntry = activeContextMetricSession.metrics[normalizedName];
  if (!existingEntry) {
    activeContextMetricSession.metrics[normalizedName] = {
      ...nextEntry,
      callCount: 1,
    };
    return activeContextMetricSession.metrics[normalizedName];
  }
  activeContextMetricSession.metrics[normalizedName] = {
    ...existingEntry,
    ...details,
    durationMs: Math.max(0, Number(existingEntry.durationMs || 0) + nextEntry.durationMs),
    recordedAt: nextEntry.recordedAt,
    callCount: Math.max(1, Number(existingEntry.callCount || 1) + 1),
  };
  return activeContextMetricSession.metrics[normalizedName];
}

function endContextMetricSession() {
  const session = activeContextMetricSession;
  activeContextMetricSession = null;
  const metrics = ensureRenderPerfMetrics();
  const breakdown = metrics.contextBreakdown && typeof metrics.contextBreakdown === "object"
    ? { ...metrics.contextBreakdown }
    : {};
  const sessionMetrics = session?.metrics && typeof session.metrics === "object" ? session.metrics : {};
  Object.entries(sessionMetrics).forEach(([name, entry]) => {
    if (!entry || typeof entry !== "object") return;
    const { durationMs, ...details } = entry;
    const recordedEntry = recordRenderPerfMetric(name, durationMs, details);
    if (CONTEXT_BREAKDOWN_METRIC_NAMES.has(name) && recordedEntry) {
      breakdown[name] = { ...recordedEntry };
    }
  });
  metrics.contextBreakdown = breakdown;
  globalThis.__renderPerfMetrics = metrics;
  return breakdown;
}

function incrementPerfCounter(counterName, amount = 1) {
  const cache = getRenderPassCacheState();
  cache.counters[counterName] = (Number(cache.counters[counterName]) || 0) + Number(amount || 0);
}

function stableJson(value) {
  try {
    return JSON.stringify(value ?? null);
  } catch (_error) {
    return "";
  }
}

function cloneZoomTransform(transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  return {
    x: Number(transform?.x || 0),
    y: Number(transform?.y || 0),
    k: Math.max(0.0001, Number(transform?.k || 1)),
  };
}

function getTransformSignature(transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  const normalized = cloneZoomTransform(transform);
  return [
    normalized.x.toFixed(3),
    normalized.y.toFixed(3),
    normalized.k.toFixed(4),
    Number(state.width || 0),
    Number(state.height || 0),
    Number(state.dpr || 1).toFixed(2),
  ].join("|");
}

function noteRenderAction(label, startedAt = null) {
  const cache = getRenderPassCacheState();
  cache.lastAction = String(label || "").trim();
  cache.lastActionAt = Date.now();
  const lastFrame = cache.lastFrame && typeof cache.lastFrame === "object" ? cache.lastFrame : null;
  cache.lastActionFrame = lastFrame
    ? {
      phase: lastFrame.phase,
      totalMs: Number(lastFrame.totalMs || 0),
      timings: { ...(lastFrame.timings || {}) },
      transform: cloneZoomTransform(lastFrame.transform),
    }
    : null;
  if (Number.isFinite(startedAt)) {
    cache.lastActionDurationMs = Math.max(0, nowMs() - Number(startedAt));
  }
}

function invalidateRenderPasses(passNames, reason = "unspecified") {
  const cache = getRenderPassCacheState();
  const rawTargetPassNames = Array.isArray(passNames) ? passNames : [passNames];
  const targetPassNames = rawTargetPassNames.flatMap((passName) => {
    if (passName === "context") {
      return ["contextBase", "contextScenario"];
    }
    return [passName];
  });
  targetPassNames.forEach((passName) => {
    if (!passName || !RENDER_PASS_NAMES.includes(passName)) return;
    cache.dirty[passName] = true;
    cache.reasons[passName] = String(reason || "unspecified");
  });
}

function invalidateAllRenderPasses(reason = "unspecified") {
  invalidateRenderPasses(RENDER_PASS_NAMES, reason);
}

function clearRenderPassReferenceTransforms(passNames = null) {
  const cache = getRenderPassCacheState();
  if (!passNames) {
    cache.referenceTransform = null;
    cache.referenceTransforms = {};
    return;
  }
  const rawTargetPassNames = Array.isArray(passNames) ? passNames : [passNames];
  const targetPassNames = rawTargetPassNames.flatMap((passName) => {
    if (passName === "context") {
      return ["contextBase", "contextScenario"];
    }
    return [passName];
  });
  targetPassNames.forEach((passName) => {
    if (!passName) return;
    delete cache.referenceTransforms[passName];
  });
  cache.referenceTransform = null;
}

function invalidateOceanVisualState(reason = "ocean-visual") {
  cancelExactAfterSettleRefresh({ clearDefer: true });
  invalidateRenderPasses(["background", "political", "contextBase", "contextScenario"], reason);
  clearRenderPassReferenceTransforms(["background", "political", "contextBase", "contextScenario", "effects", "dayNight"]);
}

function resizeRenderPassCanvases() {
  const cache = getRenderPassCacheState();
  const scaledWidth = Math.max(1, Math.floor((state.width || 1) * Math.max(state.dpr || 1, 1)));
  const scaledHeight = Math.max(1, Math.floor((state.height || 1) * Math.max(state.dpr || 1, 1)));
  RENDER_PASS_NAMES.forEach((passName) => {
    const canvas = cache.canvases?.[passName];
    if (!canvas) return;
    if (canvas.width !== scaledWidth) canvas.width = scaledWidth;
    if (canvas.height !== scaledHeight) canvas.height = scaledHeight;
  });
}

function ensureRenderPassCanvas(passName) {
  const cache = getRenderPassCacheState();
  if (!cache.canvases[passName]) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    cache.canvases[passName] = canvas;
  }
  resizeRenderPassCanvases();
  return cache.canvases[passName];
}

function getScenarioRuntimeTopologySignatureToken() {
  const runtimeTopology = state.scenarioRuntimeTopologyData || state.runtimePoliticalTopology || null;
  return [
    estimateTopologyObjectArcRefs(runtimeTopology, "political") ?? "na",
    estimateTopologyObjectArcRefs(runtimeTopology, "land_mask") ?? "na",
    estimateTopologyObjectArcRefs(runtimeTopology, "context_land_mask") ?? "na",
    estimateTopologyObjectArcRefs(runtimeTopology, "scenario_water") ?? "na",
    estimateTopologyObjectArcRefs(runtimeTopology, "scenario_special_land") ?? "na",
  ].join("|");
}

function getScenarioOverlaySignatureToken() {
  return [
    Number(state.scenarioReliefOverlayRevision || 0),
    getFeatureCollectionFeatureCount(state.scenarioWaterRegionsData),
    getFeatureCollectionFeatureCount(state.scenarioSpecialRegionsData),
    getFeatureCollectionFeatureCount(state.scenarioReliefOverlaysData),
  ].join("|");
}

function getRenderPassSignature(passName, transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  const transformSignature = getTransformSignature(transform);
  if (passName === "background") {
    return [
      transformSignature,
      state.topologyRevision || 0,
      state.oceanMaskMode || "topology_ocean",
      Number(state.oceanMaskQuality || 1).toFixed(3),
      stableJson(state.styleConfig?.ocean || {}),
    ].join("::");
  }
  if (passName === "political") {
    return [
      transformSignature,
      state.topologyRevision || 0,
      state.colorRevision || 0,
      `ocean-fill:${getOceanBaseFillColor()}`,
      debugMode,
      state.topologyBundleMode || "single",
      getColorsHash(),
    ].join("::");
  }
  if (passName === "effects") {
    return [
      transformSignature,
      state.topologyRevision || 0,
      stableJson(normalizeTextureStyleConfig(state.styleConfig?.texture || {})),
    ].join("::");
  }
  if (passName === "contextBase") {
    const maskInfo = getPhysicalLandMaskInfo();
    const zoomBucket = getContextBaseZoomBucketId(transform?.k || state.zoomTransform?.k || 1);
    const baseSignatureParts = [
      state.topologyRevision || 0,
      state.activeScenarioId || "",
      state.deferContextBasePass ? "context-base:deferred" : "context-base:ready",
      `bucket:${zoomBucket}`,
      state.showPhysical ? "physical:on" : "physical:off",
      state.showUrban ? "urban:on" : "urban:off",
      state.showRivers ? "rivers:on" : "rivers:off",
      `mask:${maskInfo.maskSource}:${maskInfo.maskFeatureCount}:${maskInfo.maskArcRefEstimate ?? "na"}`,
      `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
      String(state.renderProfile || "auto"),
      stableJson(normalizePhysicalStyleConfig(state.styleConfig?.physical || {})),
      stableJson(state.styleConfig?.urban || {}),
      stableJson(state.styleConfig?.rivers || {}),
    ];
    if (shouldEnableContextBaseTransformReuse()) {
      return [
        getViewportRenderSignature(),
        "context-base-transform-reuse",
        ...baseSignatureParts,
      ].join("::");
    }
    return [
      transformSignature,
      ...baseSignatureParts,
    ].join("::");
  }
  if (passName === "contextScenario") {
    return [
      transformSignature,
      state.topologyRevision || 0,
      state.activeScenarioId || "",
      state.scenarioReliefOverlayRevision || 0,
      `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
      `scenario-overlays:${getScenarioOverlaySignatureToken()}`,
      state.showWaterRegions ? "scenario-water:on" : "scenario-water:off",
      state.showOpenOceanRegions ? "open-ocean:on" : "open-ocean:off",
      state.showScenarioSpecialRegions ? "scenario-special:on" : "scenario-special:off",
      state.showScenarioReliefOverlays ? "scenario-relief:on" : "scenario-relief:off",
      `ocean-fill:${getOceanBaseFillColor()}`,
      `lake-fill:${getLakeBaseFillColor()}`,
      `lake-style:${stableJson(getLakeStyleConfig())}`,
    ].join("::");
  }
  if (passName === "dayNight") {
    const dayNightConfig = getDayNightStyleConfig();
    return [
      transformSignature,
      state.topologyRevision || 0,
      stableJson(dayNightConfig),
      getDayNightSignatureClockToken(dayNightConfig),
    ].join("::");
  }
  if (passName === "borders") {
    return [
      transformSignature,
      state.topologyRevision || 0,
      state.colorRevision || 0,
      state.cachedDynamicBordersHash || "",
      state.sovereigntyRevision || 0,
      state.scenarioControllerRevision || 0,
      state.activeScenarioId || "",
      state.scenarioBorderMode || "canonical",
      state.scenarioViewMode || "ownership",
      stableJson(state.parentBorderEnabledByCountry || {}),
      stableJson(state.styleConfig?.internalBorders || {}),
      stableJson(state.styleConfig?.empireBorders || {}),
      stableJson(state.styleConfig?.coastlines || {}),
      stableJson(state.styleConfig?.parentBorders || {}),
    ].join("::");
  }
  return transformSignature;
}

function resolveHitMode() {
  const raw = readSearchParam(HIT_MODE_PARAM);
  if (!raw) return "auto";
  if (!HIT_MODES.has(raw)) return "auto";
  return raw;
}

function isDynamicBordersEnabled() {
  if (!state.runtimePoliticalTopology?.objects?.political || !globalThis.topojson) {
    return false;
  }
  const raw = readSearchParam("dynamic_borders");
  if (!raw) return state.dynamicBordersEnabled !== false;
  return !["0", "false", "off", "no"].includes(raw);
}

function isSovereigntyModeActive() {
  return String(state.paintMode || "visual").toLowerCase() === "sovereignty";
}

function clearPendingDynamicBorderTimer() {
  if (state.pendingDynamicBorderTimerId) {
    globalThis.clearTimeout(state.pendingDynamicBorderTimerId);
    state.pendingDynamicBorderTimerId = null;
  }
}

function updateDynamicBorderStatusUI() {
  if (typeof state.updateDynamicBorderStatusUIFn === "function") {
    state.updateDynamicBorderStatusUIFn();
  }
}

function markDynamicBordersDirty(reason = "") {
  if (!isDynamicBordersEnabled()) {
    state.dynamicBordersDirty = false;
    state.dynamicBordersDirtyReason = "";
    updateDynamicBorderStatusUI();
    return;
  }
  state.dynamicBordersDirty = true;
  state.dynamicBordersDirtyReason = String(reason || "").trim();
  updateDynamicBorderStatusUI();
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

function getWaterRegionName(feature) {
  const rawName =
    feature?.properties?.label ||
    feature?.properties?.name ||
    feature?.properties?.name_en ||
    feature?.properties?.NAME ||
    "Water Region";
  return String(rawName || "").trim() || "Water Region";
}

function getWaterRegionType(feature) {
  return String(feature?.properties?.water_type || "water_region").trim().toLowerCase();
}

function isAtlantropaOceanMergedWaterRegion(feature) {
  if (String(state.activeScenarioId || "").trim().toLowerCase() !== "tno_1962") return false;
  return String(feature?.properties?.region_group || "").trim().toLowerCase() === "mediterranean";
}

function isBaseGeographyScenarioFeature(feature) {
  return feature?.properties?.render_as_base_geography === true;
}

function isOpenOceanWaterRegion(feature) {
  return getWaterRegionType(feature) === "ocean";
}

function isMacroOceanWaterRegion(feature) {
  if (!feature) return false;
  return (
    isOpenOceanWaterRegion(feature)
    || String(feature?.properties?.region_group || "").trim().toLowerCase() === "ocean_macro"
  );
}

function isWaterRegionEnabled(feature) {
  if (!feature) return false;
  if (isBaseGeographyScenarioFeature(feature)) {
    return true;
  }
  if (isOpenOceanWaterRegion(feature)) {
    return !!state.showOpenOceanRegions;
  }
  return feature?.properties?.interactive !== false;
}

function getWaterRegionDefaultStyle(feature) {
  return getUnifiedWaterBaseStyle(feature);
}

function getWaterRegionColor(id) {
  const resolvedId = String(id || "").trim();
  return (
    getSafeCanvasColor(state.waterRegionOverrides?.[resolvedId], null) ||
    getWaterRegionDefaultStyle(state.waterRegionsById?.get(resolvedId)).fill
  );
}

function isScenarioWaterRegion(feature) {
  return !!String(feature?.properties?.scenario_id || "").trim();
}

function getScenarioExcludedWaterRegionIds() {
  const ids = state.activeScenarioManifest?.excluded_water_region_ids;
  if (!Array.isArray(ids) || !ids.length) return new Set();
  return new Set(
    ids
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  );
}

function getScenarioExcludedWaterRegionGroups() {
  const groups = state.activeScenarioManifest?.excluded_water_region_groups;
  if (!Array.isArray(groups) || !groups.length) return new Set();
  return new Set(
    groups
      .map((value) => String(value || "").trim().toLowerCase())
      .filter(Boolean)
  );
}

function isWaterRegionExcludedByScenario(feature) {
  if (!feature || isScenarioWaterRegion(feature)) return false;
  if (isAtlantropaOceanMergedWaterRegion(feature)) return true;
  const excludedIds = getScenarioExcludedWaterRegionIds();
  const featureId = String(feature?.properties?.id || "").trim();
  if (featureId && excludedIds.has(featureId)) {
    return true;
  }
  const excludedGroups = getScenarioExcludedWaterRegionGroups();
  const regionGroup = String(feature?.properties?.region_group || "").trim().toLowerCase();
  return !!(regionGroup && excludedGroups.has(regionGroup));
}

function getEffectiveWaterRegionFeatures() {
  return [
    ...(Array.isArray(state.waterRegionsData?.features) ? state.waterRegionsData.features : []),
    ...(Array.isArray(state.scenarioWaterRegionsData?.features) ? state.scenarioWaterRegionsData.features : []),
  ].filter((feature) => !isWaterRegionExcludedByScenario(feature));
}

function getSpecialRegionName(feature) {
  const rawName =
    feature?.properties?.label ||
    feature?.properties?.name ||
    feature?.properties?.name_en ||
    feature?.properties?.NAME ||
    "Special Region";
  return String(rawName || "").trim() || "Special Region";
}

function getSpecialRegionType(feature) {
  return String(feature?.properties?.special_type || "special_region").trim().toLowerCase();
}

function isSpecialRegionEnabled(feature) {
  if (!feature) return false;
  if (!state.activeScenarioId) return false;
  if (!state.showScenarioSpecialRegions && !isBaseGeographyScenarioFeature(feature)) return false;
  return feature?.properties?.interactive !== false;
}

function getSpecialRegionDefaultStyle(feature) {
  const specialType = getSpecialRegionType(feature);
  if (specialType === "salt_flat") {
    return {
      fill: "#d7c6a3",
      stroke: "#8b6f49",
      opacity: 0.9,
    };
  }
  if (specialType === "wasteland") {
    return {
      fill: "#bf8f74",
      stroke: "#7d4e3d",
      opacity: 0.9,
    };
  }
  return {
    fill: SPECIAL_REGION_FALLBACK_FILL,
    stroke: SPECIAL_REGION_FALLBACK_STROKE,
    opacity: 0.88,
  };
}

function getSpecialRegionColor(id, feature = null) {
  const resolvedId = String(id || "").trim();
  const override = getSafeCanvasColor(state.specialRegionOverrides?.[resolvedId], null);
  if (override) return override;
  return getSpecialRegionDefaultStyle(feature || state.specialRegionsById?.get(resolvedId)).fill;
}

function getSpecialRegionStrokeColor(feature) {
  return getSpecialRegionDefaultStyle(feature).stroke;
}

function getSpecialRegionOpacity(feature, id) {
  const resolvedId = String(id || "").trim();
  if (Object.prototype.hasOwnProperty.call(state.specialRegionOverrides || {}, resolvedId)) {
    return 1;
  }
  return getSpecialRegionDefaultStyle(feature).opacity;
}

function getEffectiveSpecialRegionFeatures() {
  return Array.isArray(state.scenarioSpecialRegionsData?.features)
    ? state.scenarioSpecialRegionsData.features
    : [];
}

function getEffectiveScenarioReliefOverlayFeatures() {
  return Array.isArray(state.scenarioReliefOverlaysData?.features)
    ? state.scenarioReliefOverlaysData.features
    : [];
}

function getReliefOverlayKind(feature) {
  return String(feature?.properties?.overlay_kind || "").trim().toLowerCase();
}

function isReliefOverlayEnabled(feature) {
  if (!feature) return false;
  if (!state.activeScenarioId) return false;
  if (!state.showScenarioReliefOverlays) return false;
  if (isBaseGeographyScenarioFeature(feature)) return true;
  return feature?.properties?.interactive !== false;
}

function getReliefOverlayStyle(feature) {
  const kind = getReliefOverlayKind(feature);
  switch (kind) {
    case "salt_flat_texture":
      return {
        fill: RELIEF_SALT_FILL_COLOR,
        stroke: RELIEF_SALT_STROKE_COLOR,
        lineWidth: 0.7,
        fillAlpha: 1,
      };
    case "new_shoreline":
      return {
        fill: null,
        stroke: RELIEF_SHORELINE_COLOR,
        lineWidth: 1.35,
      };
    case "drained_basin_contour":
      return {
        fill: null,
        stroke: RELIEF_CONTOUR_COLOR,
        lineWidth: 1,
      };
    case "swamp_margin":
      return {
        fill: RELIEF_SWAMP_FILL_COLOR,
        stroke: RELIEF_SWAMP_STROKE_COLOR,
        lineWidth: 0.8,
        fillAlpha: 1,
      };
    case "lake_shoreline":
      return {
        fill: null,
        stroke: RELIEF_LAKE_SHORELINE_COLOR,
        lineWidth: 1.4,
      };
    case "dam_approach":
      return {
        fill: null,
        stroke: RELIEF_DAM_APPROACH_COLOR,
        lineWidth: 1.1,
      };
    default:
      return {
        fill: null,
        stroke: RELIEF_SALT_STROKE_COLOR,
        lineWidth: 1,
      };
  }
}

function drawPolygonLinePattern(bounds, {
  color = RELIEF_SALT_STROKE_COLOR,
  spacing = 10,
  angleDeg = -18,
  lineWidth = 0.6,
  alpha = 0.45,
} = {}) {
  if (!bounds) return;
  const width = bounds.maxX - bounds.minX;
  const height = bounds.maxY - bounds.minY;
  if (!(width > 0 && height > 0)) return;
  const diagonal = Math.sqrt(width * width + height * height);
  const radians = angleDeg * (Math.PI / 180);
  const dx = Math.cos(radians);
  const dy = Math.sin(radians);
  const nx = -dy;
  const ny = dx;
  const centerX = (bounds.minX + bounds.maxX) * 0.5;
  const centerY = (bounds.minY + bounds.maxY) * 0.5;
  const extent = diagonal * 0.9;
  context.save();
  context.globalAlpha = alpha;
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  for (let offset = -extent; offset <= extent; offset += Math.max(4, spacing)) {
    const startX = centerX + nx * offset - dx * diagonal;
    const startY = centerY + ny * offset - dy * diagonal;
    const endX = centerX + nx * offset + dx * diagonal;
    const endY = centerY + ny * offset + dy * diagonal;
    context.beginPath();
    context.moveTo(startX, startY);
    context.lineTo(endX, endY);
    context.stroke();
  }
  context.restore();
}

function drawScenarioReliefOverlaysLayer(k) {
  const startedAt = nowMs();
  const overlays = getEffectiveScenarioReliefOverlayFeatures();
  if (!overlays.length) {
    collectContextMetric("drawScenarioReliefOverlaysLayer", nowMs() - startedAt, {
      featureCount: 0,
      renderedCount: 0,
      skipped: true,
      reason: "no-overlays",
    });
    return;
  }
  if (!state.showScenarioReliefOverlays) {
    collectContextMetric("drawScenarioReliefOverlaysLayer", nowMs() - startedAt, {
      featureCount: overlays.length,
      renderedCount: 0,
      skipped: true,
      reason: "disabled",
    });
    return;
  }
  if (state.renderPhase === RENDER_PHASE_INTERACTING || state.renderPhase === RENDER_PHASE_SETTLING) {
    collectContextMetric("drawScenarioReliefOverlaysLayer", nowMs() - startedAt, {
      featureCount: overlays.length,
      renderedCount: 0,
      skipped: true,
      reason: state.renderPhase,
    });
    return;
  }
  let renderedCount = 0;
  overlays.forEach((feature) => {
    if (!isReliefOverlayEnabled(feature)) return;
    if (!pathBoundsInScreen(feature)) return;
    const style = getReliefOverlayStyle(feature);
    const bounds = getPathBounds(feature);
    if (!bounds) return;
    const geometryType = String(feature?.geometry?.type || "").trim();
    if ((geometryType === "Polygon" || geometryType === "MultiPolygon") && style.fill) {
      context.beginPath();
      pathCanvas(feature);
      context.save();
      context.globalAlpha = style.fillAlpha ?? 1;
      context.fillStyle = style.fill;
      context.fill();
      context.clip();
      if (getReliefOverlayKind(feature) === "salt_flat_texture") {
        drawPolygonLinePattern(bounds, {
          color: style.stroke,
          spacing: 11 / Math.max(0.3, Math.min(4, k)),
          angleDeg: -16,
          lineWidth: (style.lineWidth || 0.7) / Math.max(0.0001, k),
          alpha: 0.55,
        });
        drawPolygonLinePattern(bounds, {
          color: style.stroke,
          spacing: 19 / Math.max(0.3, Math.min(4, k)),
          angleDeg: 12,
          lineWidth: 0.45 / Math.max(0.0001, k),
          alpha: 0.25,
        });
      }
      context.restore();
    }
    context.beginPath();
    pathCanvas(feature);
    context.save();
    if (getReliefOverlayKind(feature) === "dam_approach") {
      context.setLineDash([3 / Math.max(0.0001, k), 2 / Math.max(0.0001, k)]);
    }
    context.strokeStyle = style.stroke;
    context.lineWidth = (style.lineWidth || 1) / Math.max(0.0001, k);
    context.lineJoin = "round";
    context.lineCap = "round";
    context.stroke();
    context.restore();
    renderedCount += 1;
  });
  collectContextMetric("drawScenarioReliefOverlaysLayer", nowMs() - startedAt, {
    featureCount: overlays.length,
    renderedCount,
    skipped: false,
    phase: state.renderPhase,
  });
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

function getAtlantropaSurfaceKind(feature) {
  return String(feature?.properties?.atl_surface_kind || "").trim().toLowerCase();
}

function isAtlantropaSeaFeature(feature) {
  return getFeatureCountryCodeNormalized(feature) === "ATL"
    && getAtlantropaSurfaceKind(feature) === "sea";
}

function getAtlantropaSeaPoliticalFillColor() {
  return getOceanBaseFillColor();
}

function getAtlantropaSeaPoliticalStrokeColor() {
  return UNIFIED_WATER_STROKE_COLOR;
}

function getMediterraneanAtlantropaBounds() {
  if (String(state.activeScenarioId || "").trim().toLowerCase() !== "tno_1962") return null;
  const cache = state.mediterraneanAtlantropaBoundsCache || {};
  const featureCount = Array.isArray(state.landData?.features) ? state.landData.features.length : 0;
  if (
    cache.scenarioId === state.activeScenarioId &&
    cache.topologyRevision === Number(state.topologyRevision || 0) &&
    cache.featureCount === featureCount &&
    Array.isArray(cache.bounds)
  ) {
    return cache.bounds;
  }
  if (!Array.isArray(state.landData?.features) || !state.landData.features.length || !globalThis.d3?.geoBounds) {
    return null;
  }
  const atlFeatures = state.landData.features.filter((feature) => getFeatureCountryCodeNormalized(feature) === "ATL");
  if (!atlFeatures.length) return null;
  try {
    const bounds = globalThis.d3.geoBounds({
      type: "FeatureCollection",
      features: atlFeatures,
    });
    state.mediterraneanAtlantropaBoundsCache = {
      scenarioId: state.activeScenarioId || "",
      topologyRevision: Number(state.topologyRevision || 0),
      featureCount,
      bounds,
    };
    return bounds;
  } catch (_error) {
    return null;
  }
}

function isPointerInsideMediterraneanAtlantropaBounds(pointer) {
  const bounds = getMediterraneanAtlantropaBounds();
  if (!bounds || !Array.isArray(bounds) || bounds.length !== 2) return false;
  const lon = Number(pointer?.lonLat?.[0]);
  const lat = Number(pointer?.lonLat?.[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return false;
  const [[minLon, minLat], [maxLon, maxLat]] = bounds;
  return lon >= minLon && lon <= maxLon && lat >= minLat && lat <= maxLat;
}

function shouldSuppressOpenOceanHit(candidate, pointer) {
  if (!candidate?.item?.feature || !isOpenOceanWaterRegion(candidate.item.feature)) return false;
  return isPointerInsideMediterraneanAtlantropaBounds(pointer);
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
  const sovereignEntries = Object.entries(state.sovereignBaseColors || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const visualEntries = Object.entries(state.visualOverrides || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const waterEntries = Object.entries(state.waterRegionOverrides || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const legacyCountryEntries = Object.entries(state.countryBaseColors || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const legacyFeatureEntries = Object.entries(state.featureOverrides || {}).sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify([
    sovereignEntries,
    visualEntries,
    waterEntries,
    legacyCountryEntries,
    legacyFeatureEntries,
    state.paintMode || "visual",
  ]);
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
  invalidateRenderPasses(["political", "borders"], "debug-mode");
  if (pathSVG) {
    buildSpatialIndex();
  }
  if (context) {
    render();
  }
}

function prepareTargetContext(targetContext, transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  if (!targetContext?.canvas) return 1;
  const width = targetContext.canvas.width;
  const height = targetContext.canvas.height;
  const normalized = cloneZoomTransform(transform);
  targetContext.setTransform(1, 0, 0, 1, 0, 0);
  targetContext.clearRect(0, 0, width, height);
  targetContext.globalCompositeOperation = "source-over";
  targetContext.globalAlpha = 1;
  targetContext.shadowBlur = 0;
  targetContext.filter = "none";
  targetContext.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  targetContext.translate(normalized.x, normalized.y);
  targetContext.scale(normalized.k, normalized.k);
  return normalized.k;
}

function withRenderTarget(targetContext, callback) {
  if (!targetContext || typeof callback !== "function") return undefined;
  const previousContext = context;
  const previousPathCanvas = pathCanvas;
  context = targetContext;
  pathCanvas = globalThis.d3.geoPath(projection, targetContext).pointRadius(PATH_POINT_RADIUS);
  try {
    return callback();
  } finally {
    context = previousContext;
    pathCanvas = previousPathCanvas;
  }
}

function getPassCounterNames(passName) {
  if (passName === "background") return ["backgroundPassRenders"];
  if (passName === "political") return ["politicalPassRenders"];
  if (passName === "effects") return ["effectsPassRenders"];
  if (passName === "contextBase") return ["contextPassRenders", "contextBasePassRenders"];
  if (passName === "contextScenario") return ["contextPassRenders", "contextScenarioPassRenders"];
  if (passName === "dayNight") return ["dayNightPassRenders"];
  if (passName === "borders") return ["borderPassRenders"];
  return [];
}

function recordPassTiming(timings, passName, startedAt) {
  if (!timings || !passName) return;
  timings[passName] = Math.max(0, nowMs() - startedAt);
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

function scheduleDeferredWork(callback, { timeout = 0 } = {}) {
  if (typeof callback !== "function") return null;
  if (typeof globalThis.requestIdleCallback === "function") {
    return {
      type: "idle",
      id: globalThis.requestIdleCallback(callback, {
        timeout: Math.max(0, Number(timeout) || 0),
      }),
    };
  }
  return {
    type: "timeout",
    id: globalThis.setTimeout(callback, Math.max(0, Number(timeout) || 0)),
  };
}

function cancelDeferredWork(handle) {
  if (!handle || typeof handle !== "object") return;
  if (handle.type === "idle" && typeof globalThis.cancelIdleCallback === "function") {
    globalThis.cancelIdleCallback(handle.id);
    return;
  }
  if (typeof globalThis.clearTimeout === "function") {
    globalThis.clearTimeout(handle.id);
  }
}

function clearStagedMapDataTasks() {
  cancelDeferredWork(state.stagedContextBaseHandle);
  cancelDeferredWork(state.stagedHitCanvasHandle);
  state.stagedContextBaseHandle = null;
  state.stagedHitCanvasHandle = null;
}

function cancelExactAfterSettleRefresh({ clearDefer = true } = {}) {
  cancelDeferredWork(state.exactAfterSettleHandle);
  state.exactAfterSettleHandle = null;
  if (clearDefer) {
    state.deferExactAfterSettle = false;
  }
}

function isHeavyScenarioStagedApplyCandidate() {
  const landCount = Array.isArray(state.landData?.features) ? state.landData.features.length : 0;
  return !!state.activeScenarioId && landCount >= HEAVY_SCENARIO_STAGED_APPLY_FEATURE_THRESHOLD;
}

function getViewportRenderSignature() {
  return [
    Math.round(Number(state.width || 0)),
    Math.round(Number(state.height || 0)),
    Number(Number(state.dpr || 1).toFixed(2)),
  ].join("|");
}

function getProjectionRenderSignature() {
  if (!projection || typeof projection.scale !== "function" || typeof projection.translate !== "function") {
    return "projection:na";
  }
  const translate = projection.translate() || [0, 0];
  return [
    Number(Number(projection.scale() || 0).toFixed(3)),
    Number(Number(translate[0] || 0).toFixed(3)),
    Number(Number(translate[1] || 0).toFixed(3)),
  ].join("|");
}

function getContextBaseZoomBucketId(k = state.zoomTransform?.k || 1) {
  const normalized = Math.max(0.0001, Number(k || 1));
  if (normalized < CONTEXT_BASE_BUCKET_LOW_MAX) return "low";
  if (normalized < CONTEXT_BASE_BUCKET_MID_MAX) return "mid";
  return "high";
}

function getContextBaseReuseMaxDistancePx() {
  const viewportMin = Math.max(1, Math.min(Number(state.width || 0), Number(state.height || 0)));
  const scaled = viewportMin * CONTEXT_BASE_REUSE_MAX_DISTANCE_VIEWPORT_RATIO;
  return Math.max(
    CONTEXT_BASE_REUSE_MIN_DISTANCE_PX,
    Math.min(CONTEXT_BASE_REUSE_MAX_DISTANCE_PX, scaled)
  );
}

function resetPhysicalLandClipPathCache() {
  physicalLandClipPathCache.key = "";
  physicalLandClipPathCache.path = null;
}

function shouldEnableContextBaseTransformReuse() {
  return (
    String(state.renderProfile || "auto") === "balanced"
    && isHeavyScenarioStagedApplyCandidate()
    && !!state.activeScenarioId
  );
}

function getPassReferenceTransform(passName) {
  const cache = getRenderPassCacheState();
  if (cache.referenceTransforms?.[passName]) {
    return cloneZoomTransform(cache.referenceTransforms[passName]);
  }
  return cache.referenceTransform ? cloneZoomTransform(cache.referenceTransform) : null;
}

function setPassReferenceTransform(passName, transform) {
  const cache = getRenderPassCacheState();
  cache.referenceTransforms[passName] = cloneZoomTransform(transform);
  cache.referenceTransform = cloneZoomTransform(transform);
}

function getTransformReuseDelta(currentTransform, referenceTransform) {
  const current = cloneZoomTransform(currentTransform);
  const reference = cloneZoomTransform(referenceTransform);
  const scaleRatio = current.k / Math.max(reference.k, 0.0001);
  const dx = current.x - (reference.x * scaleRatio);
  const dy = current.y - (reference.y * scaleRatio);
  const distancePx = Math.hypot(dx, dy);
  return {
    current,
    reference,
    scaleRatio,
    dx,
    dy,
    distancePx,
  };
}

function getContextBaseReuseDecision(transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  const referenceTransform = getPassReferenceTransform("contextBase");
  const currentBucket = getContextBaseZoomBucketId(transform?.k || state.zoomTransform?.k || 1);
  if (!shouldEnableContextBaseTransformReuse()) {
    return {
      enabled: false,
      shouldExactRefresh: true,
      reason: "reuse-disabled",
      scaleRatio: 1,
      distancePx: 0,
      zoomBucket: currentBucket,
      referenceZoomBucket: currentBucket,
      crossesMinorContourThreshold: false,
      referenceTransform,
    };
  }
  if (!referenceTransform) {
    return {
      enabled: true,
      shouldExactRefresh: true,
      reason: "no-reference-transform",
      scaleRatio: 1,
      distancePx: 0,
      zoomBucket: currentBucket,
      referenceZoomBucket: "",
      crossesMinorContourThreshold: false,
      referenceTransform: null,
    };
  }
  const delta = getTransformReuseDelta(transform, referenceTransform);
  const referenceBucket = getContextBaseZoomBucketId(referenceTransform?.k || 1);
  const crossesMinorContourThreshold =
    (delta.reference.k < CONTEXT_BASE_MINOR_CONTOUR_THRESHOLD && delta.current.k >= CONTEXT_BASE_MINOR_CONTOUR_THRESHOLD)
    || (delta.reference.k >= CONTEXT_BASE_MINOR_CONTOUR_THRESHOLD && delta.current.k < CONTEXT_BASE_MINOR_CONTOUR_THRESHOLD);
  const crossesZoomBucket = currentBucket !== referenceBucket;
  const maxDistancePx = getContextBaseReuseMaxDistancePx();
  const shouldExactRefresh =
    crossesZoomBucket
    || delta.distancePx > maxDistancePx
    || crossesMinorContourThreshold;
  let reason = "transform-reuse";
  if (crossesZoomBucket) {
    reason = "zoom-bucket-change";
  } else if (delta.distancePx > maxDistancePx) {
    reason = "distance-threshold";
  } else if (crossesMinorContourThreshold) {
    reason = "minor-contour-threshold";
  }
  return {
    enabled: true,
    shouldExactRefresh,
    reason,
    scaleRatio: Number(delta.scaleRatio.toFixed(4)),
    distancePx: Number(delta.distancePx.toFixed(2)),
    maxDistancePx: Number(maxDistancePx.toFixed(2)),
    zoomBucket: currentBucket,
    referenceZoomBucket: referenceBucket,
    crossesZoomBucket,
    crossesMinorContourThreshold,
    referenceTransform,
    currentTransform: delta.current,
  };
}

function shouldStartExactAfterSettleFastPath() {
  if (!shouldEnableContextBaseTransformReuse()) return false;
  if (state.deferContextBasePass) return false;
  const requiredPasses = ["background", "political", "effects", "contextBase", "contextScenario", "dayNight"];
  return requiredPasses.every((passName) => {
    const cache = getRenderPassCacheState();
    return !!cache.canvases?.[passName] && !!getPassReferenceTransform(passName);
  });
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
  if (/^[A-Z]{2,3}$/.test(candidate)) {
    return true;
  }
  const detailTier = String(feature?.properties?.detail_tier || "").trim().toLowerCase();
  return detailTier === "antarctic_sector" && candidate.startsWith("AQ_");
}

function isScenarioShellFeature(feature, featureId = null) {
  const candidate = String(
    feature?.properties?.id ?? featureId ?? feature?.id ?? ""
  ).trim().toUpperCase();
  if (candidate.includes("_FB_")) return true;
  return String(feature?.properties?.name || "").toLowerCase().includes("shell fallback");
}

function isAntarcticSectorFeature(feature, featureId = null) {
  const candidate = String(
    feature?.properties?.id ?? featureId ?? feature?.id ?? ""
  ).trim().toUpperCase();
  if (!candidate) return false;
  const countryCode = getFeatureCountryCodeNormalized(feature);
  const detailTier = String(feature?.properties?.detail_tier || "").trim().toLowerCase();
  return detailTier === "antarctic_sector" && (countryCode === "AQ" || candidate.startsWith("AQ_"));
}

function shouldExcludePoliticalInteractionFeature(feature, featureId = null) {
  return isScenarioShellFeature(feature, featureId) || isAntarcticSectorFeature(feature, featureId);
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
  const countryCode = getFeatureCountryCodeNormalized(feature);
  if (!bounds) {
    return {
      skip: false,
      reason: null,
      featureId,
      countryCode,
      bounds: null,
    };
  }

  const isTrustedAdmin0Shell =
    GIANT_FEATURE_ALLOWLIST.has(countryCode) &&
    isAdmin0ShellFeature(feature, featureId);
  const spherical = getSphericalFeatureDiagnostics(feature, { featureId });
  if (spherical?.invalid && !isTrustedAdmin0Shell) {
    return {
      skip: true,
      reason: spherical.isWorldBounds ? "world_bounds" : "spherical_area",
      featureId,
      countryCode,
      bounds,
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
      const existingSource = String(normalizedFeature?.properties?.__source || "").trim();
      return {
        ...normalizedFeature,
        properties: {
          ...(normalizedFeature?.properties || {}),
          __source: existingSource || sourceName,
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

function getRingOrientationAccumulator(ring) {
  if (!Array.isArray(ring) || ring.length < 4) return 0;
  let total = 0;
  for (let index = 0; index < ring.length - 1; index += 1) {
    const start = ring[index];
    const end = ring[index + 1];
    if (!Array.isArray(start) || !Array.isArray(end)) continue;
    total += (Number(end[0]) - Number(start[0])) * (Number(end[1]) + Number(start[1]));
  }
  return total;
}

function orientRingCoordinates(ring, clockwise) {
  if (!Array.isArray(ring) || ring.length < 4) return ring;
  const signed = getRingOrientationAccumulator(ring);
  const isClockwise = signed > 0;
  if (clockwise === isClockwise) return ring;
  return [...ring].reverse();
}

function rewindGeometryRings(geometry) {
  if (!geometry || !geometry.type || !geometry.coordinates) return null;
  if (geometry.type === "Polygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((ring, index) =>
        orientRingCoordinates(ring, index === 0)
      ),
    };
  }
  if (geometry.type === "MultiPolygon") {
    return {
      ...geometry,
      coordinates: geometry.coordinates.map((polygon) =>
        Array.isArray(polygon)
          ? polygon.map((ring, index) => orientRingCoordinates(ring, index === 0))
          : polygon
      ),
    };
  }
  return null;
}

function isWorldBounds(bounds) {
  return !!(
    Array.isArray(bounds) &&
    bounds.length === 2 &&
    Array.isArray(bounds[0]) &&
    Array.isArray(bounds[1]) &&
    Math.abs(Number(bounds[0][0]) + 180) < 1e-9 &&
    Math.abs(Number(bounds[0][1]) + 90) < 1e-9 &&
    Math.abs(Number(bounds[1][0]) - 180) < 1e-9 &&
    Math.abs(Number(bounds[1][1]) - 90) < 1e-9
  );
}

function getSphericalFeatureDiagnostics(feature, { featureId = null, allowCompute = true } = {}) {
  const resolvedFeatureId = featureId || getFeatureId(feature);
  if (resolvedFeatureId && state.sphericalFeatureDiagnosticsById?.has(resolvedFeatureId)) {
    return state.sphericalFeatureDiagnosticsById.get(resolvedFeatureId) || null;
  }
  if (!allowCompute || !globalThis.d3?.geoArea || !globalThis.d3?.geoBounds || !feature?.geometry) {
    return null;
  }

  try {
    const area = Number(globalThis.d3.geoArea(feature));
    const bounds = globalThis.d3.geoBounds(feature);
    const diagnostics = {
      area,
      bounds,
      isWorldBounds: isWorldBounds(bounds),
      hasExcessiveSphereArea: Number.isFinite(area) && area > Math.PI * 2,
    };
    diagnostics.invalid = diagnostics.isWorldBounds || diagnostics.hasExcessiveSphereArea;
    if (resolvedFeatureId) {
      state.sphericalFeatureDiagnosticsById.set(resolvedFeatureId, diagnostics);
    }
    return diagnostics;
  } catch (_error) {
    return null;
  }
}

function getMaxDprForProfile(renderProfile) {
  const profile = String(renderProfile || "auto").trim().toLowerCase();
  if (profile === "full") return Math.max(1, Number(globalThis.devicePixelRatio) || 1);
  if (profile === "balanced") return 1.5;
  return 1.25;
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

  const rewoundGeometry = rewindGeometryRings(feature.geometry);
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

function buildInteractiveLandData(fullCollection) {
  if (!Array.isArray(fullCollection?.features) || !fullCollection.features.length) {
    return fullCollection;
  }

  const filterStateByCountry = new Map();
  fullCollection.features.forEach((feature) => {
    const countryCode = getFeatureCountryCodeNormalized(feature);
    const blockedTiers = INTERACTIVE_AGGREGATE_TIER_FILTERS[countryCode];
    if (!countryCode || !blockedTiers?.size) return;

    const tier = getDetailTier(feature).toLowerCase();
    let entry = filterStateByCountry.get(countryCode);
    if (!entry) {
      entry = {
        blockedTiers,
        hasLeaf: false,
        hasBlocked: false,
      };
      filterStateByCountry.set(countryCode, entry);
    }

    if (blockedTiers.has(tier)) {
      entry.hasBlocked = true;
      return;
    }

    if (String(feature?.properties?.__source || "primary") === "detail") {
      entry.hasLeaf = true;
    }
  });

  const activeFilters = new Map(
    Array.from(filterStateByCountry.entries()).filter(([, entry]) => entry.hasLeaf && entry.hasBlocked)
  );
  if (!activeFilters.size) {
    return fullCollection;
  }

  const filteredFeatures = fullCollection.features.filter((feature) => {
    const countryCode = getFeatureCountryCodeNormalized(feature);
    const entry = activeFilters.get(countryCode);
    if (!entry) return true;
    return !entry.blockedTiers.has(getDetailTier(feature).toLowerCase());
  });

  if (filteredFeatures.length === fullCollection.features.length) {
    return fullCollection;
  }

  return {
    type: "FeatureCollection",
    features: filteredFeatures,
  };
}

function rebuildPoliticalLandCollections() {
  const primaryTopology = state.topologyPrimary || state.topology;
  const detailTopology = state.topologyBundleMode === "composite" ? state.topologyDetail : null;
  const overrideCollection = state.topologyBundleMode === "composite" ? state.ruCityOverrides : null;
  const runtimeTopology = state.topologyBundleMode === "composite" ? state.runtimePoliticalTopology : null;

  let fullCollection = state.landDataFull || state.landData || null;
  if (runtimeTopology?.objects?.political && globalThis.topojson) {
    fullCollection = getPoliticalFeatureCollection(runtimeTopology, "runtime");
  } else if (primaryTopology?.objects?.political && globalThis.topojson) {
    fullCollection = state.topologyBundleMode === "composite"
      ? composePoliticalFeatures(primaryTopology, detailTopology, overrideCollection)
      : getPoliticalFeatureCollection(primaryTopology, "primary");
  }

  const interactiveCollection = buildInteractiveLandData(fullCollection);
  state.landDataFull = fullCollection;
  state.landData = interactiveCollection;

  const fullCount = Array.isArray(fullCollection?.features) ? fullCollection.features.length : 0;
  const interactiveCount = Array.isArray(interactiveCollection?.features) ? interactiveCollection.features.length : 0;
  if (interactiveCount < fullCount) {
    console.info(
      `[map_renderer] Interactive land filter removed ${fullCount - interactiveCount} aggregate support tier features.`
    );
  }

  return { fullCollection, interactiveCollection };
}

function clearRenderPhaseTimer() {
  if (state.renderPhaseTimerId) {
    globalThis.clearTimeout(state.renderPhaseTimerId);
    state.renderPhaseTimerId = null;
  }
}

function setRenderPhase(phase) {
  const previousPhase = state.renderPhase;
  state.renderPhase = phase;
  state.phaseEnteredAt = nowMs();
  state.isInteracting = phase === RENDER_PHASE_INTERACTING;
  if (previousPhase !== phase && (previousPhase === RENDER_PHASE_IDLE || phase === RENDER_PHASE_IDLE)) {
    state.hoverOverlayDirty = true;
  }
}

function markOverlaysDirty({
  specialZones = false,
  inspector = false,
  hover = false,
} = {}) {
  if (specialZones) {
    state.specialZonesOverlayDirty = true;
  }
  if (inspector) {
    state.inspectorOverlayDirty = true;
  }
  if (hover) {
    state.hoverOverlayDirty = true;
  }
}

function markAllOverlaysDirty() {
  markOverlaysDirty({
    specialZones: true,
    inspector: true,
    hover: true,
  });
}

function getOverlayProjectionSignature() {
  return [
    Number(state.topologyRevision || 0),
    getProjectionRenderSignature(),
  ].join("::");
}

function getSpecialZonesOverlaySignature() {
  return [
    getOverlayProjectionSignature(),
    Number(state.dirtyRevision || 0),
    state.showSpecialZones ? "1" : "0",
    Array.isArray(state.scenarioSpecialRegionsData?.features) ? state.scenarioSpecialRegionsData.features.length : 0,
    Array.isArray(state.manualSpecialZones?.features) ? state.manualSpecialZones.features.length : 0,
    !!state.specialZoneEditor?.active ? "1" : "0",
    String(state.specialZoneEditor?.selectedId || ""),
    String(state.specialZoneEditor?.zoneType || ""),
    String(state.specialZoneEditor?.label || ""),
    Array.isArray(state.specialZoneEditor?.vertices) ? state.specialZoneEditor.vertices.length : 0,
  ].join("::");
}

function getInspectorOverlaySignature() {
  return [
    getOverlayProjectionSignature(),
    String(state.inspectorHighlightCountryCode || "").trim().toUpperCase(),
    Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
  ].join("::");
}

function getHoverOverlaySignature() {
  return [
    getOverlayProjectionSignature(),
    String(state.renderPhase || RENDER_PHASE_IDLE),
    String(state.hoveredId || ""),
    String(state.hoveredWaterRegionId || ""),
    String(state.hoveredSpecialRegionId || ""),
  ].join("::");
}

function getDevSelectionOverlaySignature() {
  const orderedIds = Array.isArray(state.devSelectionOrder)
    ? state.devSelectionOrder.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  return [
    getOverlayProjectionSignature(),
    orderedIds.join("|"),
    Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
  ].join("::");
}

function renderSpecialZonesIfNeeded({ force = false } = {}) {
  const nextSignature = getSpecialZonesOverlaySignature();
  if (!force && !state.specialZonesOverlayDirty && nextSignature === lastSpecialZonesOverlaySignature) {
    return;
  }
  renderSpecialZones();
  state.specialZonesOverlayDirty = false;
  lastSpecialZonesOverlaySignature = nextSignature;
}

function renderInspectorHighlightOverlayIfNeeded({ force = false } = {}) {
  const nextSignature = getInspectorOverlaySignature();
  if (!force && !state.inspectorOverlayDirty && nextSignature === lastInspectorOverlaySignature) {
    return;
  }
  renderInspectorHighlightOverlay();
  state.inspectorOverlayDirty = false;
  lastInspectorOverlaySignature = nextSignature;
}

function renderHoverOverlayIfNeeded({ force = false } = {}) {
  const nextSignature = getHoverOverlaySignature();
  if (!force && !state.hoverOverlayDirty && nextSignature === lastHoverOverlaySignature) {
    return;
  }
  renderHoverOverlay();
  state.hoverOverlayDirty = false;
  lastHoverOverlaySignature = nextSignature;
}

function renderDevSelectionOverlay() {
  if (!devSelectionGroup || !pathSVG) return;
  const orderedIds = Array.isArray(state.devSelectionOrder)
    ? state.devSelectionOrder.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const data = orderedIds
    .map((featureId) => state.landIndex?.get(featureId) || null)
    .filter(Boolean);

  const selection = devSelectionGroup
    .selectAll("path.dev-selected-feature")
    .data(data, (feature, index) => getFeatureId(feature) || `dev-selection-${index}`);

  selection
    .enter()
    .append("path")
    .attr("class", "dev-selected-feature")
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
    .attr("vector-effect", "non-scaling-stroke")
    .merge(selection)
    .attr("d", pathSVG)
    .attr("fill", "rgba(14, 165, 233, 0.14)")
    .attr("stroke", "rgba(14, 165, 233, 0.94)")
    .attr("stroke-width", 1.8);

  selection.exit().remove();
  devSelectionGroup
    .attr("aria-hidden", data.length ? "false" : "true")
    .attr("aria-label", data.length ? `Development selection overlay (${data.length})` : "Development selection overlay");
}

function renderDevSelectionOverlayIfNeeded({ force = false } = {}) {
  const nextSignature = getDevSelectionOverlaySignature();
  if (!force && !state.devSelectionOverlayDirty && nextSignature === lastDevSelectionOverlaySignature) {
    return;
  }
  renderDevSelectionOverlay();
  state.devSelectionOverlayDirty = false;
  lastDevSelectionOverlaySignature = nextSignature;
}

function applyTooltipState(nextState = null) {
  if (!tooltip) return;
  const visible = !!nextState?.visible;
  const text = visible ? String(nextState?.text || "") : "";
  tooltip.textContent = text;
  tooltip.style.opacity = visible ? "1" : "0";
  tooltip.style.transform = visible
    ? `translate3d(${Math.round(Number(nextState?.x || 0))}px, ${Math.round(Number(nextState?.y || 0))}px, 0)`
    : "translate3d(-9999px, -9999px, 0)";
}

function queueTooltipUpdate(nextState = null) {
  state.tooltipPendingState = nextState && typeof nextState === "object"
    ? { ...nextState }
    : { visible: false };
  if (state.tooltipRafHandle) {
    return;
  }
  state.tooltipRafHandle = globalThis.requestAnimationFrame(() => {
    state.tooltipRafHandle = null;
    const pendingState = state.tooltipPendingState;
    state.tooltipPendingState = null;
    applyTooltipState(pendingState);
  });
}

function scheduleRenderPhaseIdle() {
  clearRenderPhaseTimer();
  state.renderPhaseTimerId = globalThis.setTimeout(() => {
    state.renderPhaseTimerId = null;
    setRenderPhase(RENDER_PHASE_IDLE);
    if (shouldStartExactAfterSettleFastPath()) {
      state.deferExactAfterSettle = true;
      render();
      scheduleExactAfterSettleRefresh();
      return;
    }
    render();
  }, RENDER_SETTLE_DURATION_MS);
}

function getDisplayOwnerCode(feature, id) {
  const resolvedId = String(id || "").trim() || getFeatureId(feature);
  if (isAntarcticSectorFeature(feature, resolvedId)) {
    return "";
  }
  const isScenarioShell = isScenarioShellFeature(feature, resolvedId);
  const shellOwnerCode = String(state.scenarioAutoShellOwnerByFeatureId?.[resolvedId] || "").trim().toUpperCase();
  const directOwnerCode = canonicalCountryCode(state.sovereigntyByFeatureId?.[resolvedId] || "");
  const fallbackOwnerCode = getFeatureCountryCodeNormalized(feature);
  const ownershipOwnerCode = isScenarioShell
    ? (directOwnerCode || shellOwnerCode || "")
    : (directOwnerCode || fallbackOwnerCode || "");
  if (!state.activeScenarioId || String(state.scenarioViewMode || "ownership") !== "frontline") {
    return ownershipOwnerCode;
  }
  const shellControllerCode = String(state.scenarioAutoShellControllerByFeatureId?.[resolvedId] || "").trim().toUpperCase();
  const directControllerCode = canonicalCountryCode(state.scenarioControllersByFeatureId?.[resolvedId] || "");
  return isScenarioShell
    ? (directControllerCode || shellControllerCode || ownershipOwnerCode || "")
    : (directControllerCode || ownershipOwnerCode || "");
}

function getResolvedFeatureColor(feature, id) {
  if (isAtlantropaSeaFeature(feature)) {
    return getOceanBaseFillColor();
  }
  const direct =
    getSafeCanvasColor(state.visualOverrides?.[id], null) ||
    getSafeCanvasColor(state.featureOverrides?.[id], null);
  if (direct) return direct;

  const ownerCode = getDisplayOwnerCode(feature, id);
  if (!ownerCode) return null;

  return (
    getSafeCanvasColor(state.sovereignBaseColors?.[ownerCode], null) ||
    getSafeCanvasColor(state.countryBaseColors?.[ownerCode], null)
  );
}

function rebuildResolvedColors() {
  migrateLegacyColorState();
  ensureSovereigntyState();
  state.sovereignBaseColors = sanitizeCountryColorMap(state.sovereignBaseColors);
  state.visualOverrides = sanitizeColorMap(state.visualOverrides);
  state.waterRegionOverrides = sanitizeColorMap(state.waterRegionOverrides);
  state.specialRegionOverrides = sanitizeColorMap(state.specialRegionOverrides);
  state.countryBaseColors = { ...state.sovereignBaseColors };
  state.featureOverrides = { ...state.visualOverrides };

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
  state.colorRevision = Number(state.colorRevision || 0) + 1;
  invalidateRenderPasses("political", "rebuild-colors");
  return nextColors;
}

function refreshResolvedColorsForFeatures(featureIds, { renderNow = false } = {}) {
  migrateLegacyColorState();
  ensureSovereigntyState();
  state.sovereignBaseColors = sanitizeCountryColorMap(state.sovereignBaseColors);
  state.visualOverrides = sanitizeColorMap(state.visualOverrides);
  state.waterRegionOverrides = sanitizeColorMap(state.waterRegionOverrides);
  state.specialRegionOverrides = sanitizeColorMap(state.specialRegionOverrides);
  state.countryBaseColors = { ...state.sovereignBaseColors };
  state.featureOverrides = { ...state.visualOverrides };

  const ids = Array.isArray(featureIds)
    ? Array.from(new Set(featureIds.map((value) => String(value || "").trim()).filter(Boolean)))
    : [];
  ids.forEach((id) => {
    const feature = state.landIndex?.get(id);
    if (!feature) {
      delete state.colors[id];
      return;
    }
    const resolved = getResolvedFeatureColor(feature, id);
    if (resolved) {
      state.colors[id] = resolved;
    } else {
      delete state.colors[id];
    }
  });

  state.colorRevision = Number(state.colorRevision || 0) + 1;
  invalidateRenderPasses("political", "refresh-colors");

  if (renderNow && context) {
    render();
  }
}

function refreshResolvedColorsForOwners(ownerCodes, { renderNow = false } = {}) {
  const codes = Array.isArray(ownerCodes) ? ownerCodes : [];
  const ids = [];
  codes.forEach((ownerCode) => {
    getFeatureIdsForOwner(ownerCode).forEach((id) => ids.push(id));
  });
  refreshResolvedColorsForFeatures(ids, { renderNow });
}

function refreshColorState({ renderNow = true } = {}) {
  state.waterRegionOverrides = sanitizeColorMap(state.waterRegionOverrides);
  state.specialRegionOverrides = sanitizeColorMap(state.specialRegionOverrides);
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
  const externalContextCollection = state.contextLayerExternalDataByName?.[layerName];
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

  if (pick.source === "none" && Array.isArray(externalContextCollection?.features)) {
    state.contextLayerSourceByName[layerName] = "external";
    state.layerDataDiagnostics[layerName] = {
      source: "external",
      primaryCount: pick.primaryCount,
      detailCount: externalContextCollection.features.length,
      primaryScore: Number(pick.primaryScore.toFixed(3)),
      detailScore: 1,
    };
    return externalContextCollection;
  }

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
  state.waterRegionsData = resolveContextLayerData("water_regions");
  state.riversData = resolveContextLayerData("rivers");
  state.urbanData = resolveContextLayerData("urban");
  state.physicalData = resolveContextLayerData("physical");
  state.specialZonesData = resolveContextLayerData("special_zones");

  const diag = state.layerDataDiagnostics || {};
  console.info(
    `${LAYER_DIAG_PREFIX} sources: ocean=${diag.ocean?.source || "none"}, `
      + `land=${diag.land?.source || "none"}, water_regions=${diag.water_regions?.source || "none"}, `
      + `rivers=${diag.rivers?.source || "none"}, `
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
    const fullCount = Array.isArray(state.landDataFull?.features)
      ? state.landDataFull.features.length
      : 0;
    if (currentCount !== expectedCount || fullCount !== expectedCount) {
      const primaryCollection = globalThis.topojson.feature(primaryTopology, primaryTopology.objects.political);
      state.landDataFull = primaryCollection;
      state.landData = primaryCollection;
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

function createHitCanvasElement() {
  const canvas = document.createElement("canvas");
  canvas.id = "map-hit-canvas";
  canvas.width = 1;
  canvas.height = 1;
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
    const anchor = legacyColorCanvas || legacyLineCanvas || null;
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
    mapContainer.appendChild(mapSvg);
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
  specialZonesGroup
    .style("pointer-events", "none")
    .attr("role", "img")
    .attr("aria-label", "Special zones overlay")
    .attr("aria-hidden", "true")
    .attr("focusable", "false");

  specialZoneEditorGroup = viewportGroup.select("g.special-zone-editor-layer");
  if (specialZoneEditorGroup.empty()) {
    specialZoneEditorGroup = viewportGroup.append("g").attr("class", "special-zone-editor-layer");
  }
  specialZoneEditorGroup
    .style("pointer-events", "none")
    .attr("role", "img")
    .attr("aria-label", "Special zone drawing overlay")
    .attr("aria-hidden", "true")
    .attr("focusable", "false");

  hoverGroup = viewportGroup.select("g.hover-layer");
  if (hoverGroup.empty()) {
    hoverGroup = viewportGroup.append("g").attr("class", "hover-layer");
  }
  hoverGroup
    .style("pointer-events", "none")
    .attr("role", "img")
    .attr("aria-label", "Hovered region outline overlay")
    .attr("aria-hidden", "true")
    .attr("focusable", "false");

  devSelectionGroup = viewportGroup.select("g.dev-selection-layer");
  if (devSelectionGroup.empty()) {
    devSelectionGroup = viewportGroup.append("g").attr("class", "dev-selection-layer");
  }
  devSelectionGroup
    .style("pointer-events", "none")
    .attr("role", "img")
    .attr("aria-label", "Development selection overlay")
    .attr("aria-hidden", "true")
    .attr("focusable", "false");

  inspectorHighlightGroup = viewportGroup.select("g.inspector-highlight-layer");
  if (inspectorHighlightGroup.empty()) {
    inspectorHighlightGroup = viewportGroup.append("g").attr("class", "inspector-highlight-layer");
  }
  inspectorHighlightGroup
    .style("pointer-events", "none")
    .attr("role", "img")
    .attr("aria-label", "Inspector highlight overlay")
    .attr("aria-hidden", "true")
    .attr("focusable", "false");

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

  const deviceDpr = Math.max(Number(globalThis.devicePixelRatio || 1), 1);
  state.dpr = Math.min(deviceDpr, getMaxDprForProfile(state.renderProfile));
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
  if (hitCanvas) {
    hitCanvas.width = scaledW;
    hitCanvas.height = scaledH;
  }
  resizeRenderPassCanvases();
  oceanPatternCache.clear();
  texturePatternCache.clear();
  textureNoiseTileCache.clear();
  clearProjectedBoundsCache();
  state.hitCanvasDirty = true;
  invalidateAllRenderPasses("resize");

  const svg = globalThis.d3.select(mapSvg);
  svg.attr("width", state.width).attr("height", state.height);
  interactionRect.attr("x", 0).attr("y", 0).attr("width", state.width).attr("height", state.height);
}

function rebuildDynamicBorders() {
  const startedAt = nowMs();
  incrementPerfCounter("dynamicBorderRebuilds");
  state.cachedBorders = null;
  state.cachedColorsHash = getColorsHash();
  if (!isDynamicBordersEnabled()) {
    state.cachedDynamicOwnerBorders = null;
    state.cachedDynamicBordersHash = null;
    state.dynamicBordersDirty = false;
    state.dynamicBordersDirtyReason = "";
    clearPendingDynamicBorderTimer();
    updateDynamicBorderStatusUI();
    recordRenderPerfMetric("rebuildDynamicBorders", nowMs() - startedAt, {
      enabled: false,
      segmentCount: 0,
    });
    return;
  }
  ensureSovereigntyState();
  const nextHash = [
    `rev:${Number(state.sovereigntyRevision) || 0}`,
    `mode:${state.activeScenarioId ? String(state.scenarioViewMode || "ownership") : "ownership"}`,
    `ctrl:${Number(state.scenarioControllerRevision) || 0}`,
    `shell:${state.activeScenarioId ? Number(state.scenarioShellOverlayRevision) || 0 : 0}`,
  ].join("|");
  if (state.cachedDynamicBordersHash === nextHash && state.cachedDynamicOwnerBorders) {
    state.dynamicBordersDirty = false;
    state.dynamicBordersDirtyReason = "";
    updateDynamicBorderStatusUI();
    recordRenderPerfMetric("rebuildDynamicBorders", nowMs() - startedAt, {
      enabled: true,
      cacheHit: true,
      segmentCount: Array.isArray(state.cachedDynamicOwnerBorders?.coordinates)
        ? state.cachedDynamicOwnerBorders.coordinates.length
        : 0,
    });
    return;
  }
  state.cachedDynamicOwnerBorders = buildDynamicOwnerBorderMesh(
    state.runtimePoliticalTopology,
    {
      ownershipByFeatureId: state.sovereigntyByFeatureId,
      controllerByFeatureId: state.scenarioControllersByFeatureId,
      shellOwnerByFeatureId: state.scenarioAutoShellOwnerByFeatureId,
      shellControllerByFeatureId: state.scenarioAutoShellControllerByFeatureId,
      scenarioActive: !!state.activeScenarioId,
      viewMode: state.scenarioViewMode,
    }
  );
  state.cachedDynamicBordersHash = nextHash;
  state.dynamicBordersDirty = false;
  state.dynamicBordersDirtyReason = "";
  updateDynamicBorderStatusUI();
  invalidateRenderPasses("borders", "dynamic-borders");
  recordRenderPerfMetric("rebuildDynamicBorders", nowMs() - startedAt, {
    enabled: true,
    cacheHit: false,
    segmentCount: Array.isArray(state.cachedDynamicOwnerBorders?.coordinates)
      ? state.cachedDynamicOwnerBorders.coordinates.length
      : 0,
  });
}

function recomputeDynamicBordersNow({ renderNow = true, reason = "" } = {}) {
  clearPendingDynamicBorderTimer();
  if (!isDynamicBordersEnabled()) {
    state.dynamicBordersDirty = false;
    state.dynamicBordersDirtyReason = "";
    updateDynamicBorderStatusUI();
    return false;
  }
  if (reason) {
    state.dynamicBordersDirtyReason = String(reason);
  }
  rebuildDynamicBorders();
  if (renderNow && context) {
    render();
  }
  return true;
}

function refreshScenarioOpeningOwnerBorders({ renderNow = false, reason = "" } = {}) {
  const startedAt = nowMs();
  const shouldBuild =
    !!state.activeScenarioId
    && state.scenarioBorderMode === "scenario_owner_only"
    && String(state.scenarioViewMode || "ownership") === "ownership"
    && !!state.runtimePoliticalTopology?.objects?.political
    && Object.keys(state.scenarioBaselineOwnersByFeatureId || {}).length > 0;

  state.cachedScenarioOpeningOwnerBorders = shouldBuild
    ? buildOwnerBorderMesh(
      state.runtimePoliticalTopology,
      {
        ownershipByFeatureId: state.scenarioBaselineOwnersByFeatureId,
        scenarioActive: false,
        viewMode: "ownership",
      },
      { excludeSea: true }
    )
    : null;

  invalidateRenderPasses("borders", reason || "scenario-opening-borders");
  recordRenderPerfMetric("refreshScenarioOpeningOwnerBorders", nowMs() - startedAt, {
    enabled: shouldBuild,
    segmentCount: Array.isArray(state.cachedScenarioOpeningOwnerBorders?.coordinates)
      ? state.cachedScenarioOpeningOwnerBorders.coordinates.length
      : 0,
  });
  if (renderNow && context) {
    render();
  }
  return !!state.cachedScenarioOpeningOwnerBorders;
}

function scheduleDynamicBorderRecompute(reason = "", delayMs = 150) {
  markDynamicBordersDirty(reason);
  clearPendingDynamicBorderTimer();
  state.pendingDynamicBorderTimerId = globalThis.setTimeout(() => {
    state.pendingDynamicBorderTimerId = null;
    recomputeDynamicBordersNow({ renderNow: true, reason });
  }, Math.max(0, Number(delayMs) || 0));
}

function isUsableMesh(mesh) {
  return !!(mesh && Array.isArray(mesh.coordinates) && mesh.coordinates.length > 0);
}

function getAdmin1Group(entity) {
  const value = entity?.properties?.admin1_group;
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function getDetailTier(entity) {
  const value = entity?.properties?.detail_tier;
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

function isAdmDetailTier(entity) {
  return getDetailTier(entity).toLowerCase().startsWith("adm2");
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

function getEntityOwnerCode(entity) {
  const featureId = getEntityFeatureId(entity);
  if (!featureId) return "";
  return getDisplayOwnerCode(asFeatureLike(entity), featureId);
}

function shouldExcludeOwnerBorderEntity(entity, { excludeSea = false } = {}) {
  if (!entity) return false;
  const feature = asFeatureLike(entity);
  if (shouldExcludePoliticalInteractionFeature(feature)) return true;
  if (!excludeSea) return false;
  return isAtlantropaSeaFeature(feature);
}

function resolveOwnerBorderCode(entity, ownershipContext = {}) {
  const feature = asFeatureLike(entity);
  if (shouldExcludePoliticalInteractionFeature(feature)) {
    return "";
  }
  const featureId = getEntityFeatureId(entity);
  const fallbackCode = getEntityCountryCode(entity) || "";
  const ownershipByFeatureId = ownershipContext?.ownershipByFeatureId || {};
  const controllerByFeatureId = ownershipContext?.controllerByFeatureId || {};
  const shellOwnerByFeatureId = ownershipContext?.shellOwnerByFeatureId || {};
  const shellControllerByFeatureId = ownershipContext?.shellControllerByFeatureId || {};
  const scenarioActive = !!ownershipContext?.scenarioActive;
  const useFrontline = scenarioActive && String(ownershipContext?.viewMode || "ownership") === "frontline";
  if (!featureId) {
    return canonicalCountryCode(fallbackCode);
  }
  const isScenarioShell = isScenarioShellFeature(feature, featureId);
  return canonicalCountryCode(
    (useFrontline ? controllerByFeatureId?.[featureId] : "")
    || (useFrontline && isScenarioShell ? shellControllerByFeatureId?.[featureId] : "")
    || ownershipByFeatureId?.[featureId]
    || (!isScenarioShell ? fallbackCode : "")
    || (isScenarioShell ? shellOwnerByFeatureId?.[featureId] : "")
    || ""
  );
}

function buildOwnerBorderMesh(runtimeTopology, ownershipContext = {}, { excludeSea = false } = {}) {
  const object = runtimeTopology?.objects?.political;
  if (!object || !globalThis.topojson) return null;
  return globalThis.topojson.mesh(runtimeTopology, object, (a, b) => {
    if (!a || !b) return false;
    if (shouldExcludeOwnerBorderEntity(a, { excludeSea }) || shouldExcludeOwnerBorderEntity(b, { excludeSea })) {
      return false;
    }
    const ownerA = resolveOwnerBorderCode(a, ownershipContext);
    const ownerB = resolveOwnerBorderCode(b, ownershipContext);
    return !!(ownerA && ownerB && ownerA !== ownerB);
  });
}

function buildDynamicOwnerBorderMesh(runtimeTopology, ownershipContext) {
  return buildOwnerBorderMesh(runtimeTopology, ownershipContext, { excludeSea: true });
}

function buildDetailAdmBorderMesh(topology, includedCountries) {
  const object = topology?.objects?.political;
  if (!object || !globalThis.topojson || !includedCountries?.size) {
    return null;
  }

  return globalThis.topojson.mesh(topology, object, (a, b) => {
    if (!a || !b) return false;
    const codeA = getEntityCountryCode(a);
    const codeB = getEntityCountryCode(b);
    if (!codeA || !codeB || codeA !== codeB || !includedCountries.has(codeA)) {
      return false;
    }
    return isAdmDetailTier(a) || isAdmDetailTier(b);
  });
}

function getFullLandDataFeatures() {
  if (Array.isArray(state.landDataFull?.features) && state.landDataFull.features.length) {
    return state.landDataFull.features;
  }
  return Array.isArray(state.landData?.features) ? state.landData.features : [];
}

function getCountryFeatureEntriesMap() {
  const byCountry = new Map();
  const features = getFullLandDataFeatures();
  features.forEach((feature) => {
    const id = getFeatureId(feature);
    const countryCode = getFeatureCountryCodeNormalized(feature);
    if (!id || !countryCode || shouldExcludePoliticalInteractionFeature(feature, id)) return;
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

function isBritishConstituentGroupingCandidate(candidate) {
  if (!candidate || candidate.source !== "hierarchy") return false;
  if (candidate.coverage < PARENT_BORDER_MIN_COVERAGE) return false;
  if (candidate.groupCount < 4) return false;
  const groups = new Set(candidate.groupCounts ? Array.from(candidate.groupCounts.keys()) : []);
  return (
    groups.has("GB_England")
    && groups.has("GB_Scotland")
    && groups.has("GB_Wales")
    && groups.has("GB_Northern_Ireland")
  );
}

function isBritishNuts1GroupingCandidate(candidate) {
  if (!candidate || candidate.source !== "id_prefix") return false;
  if (candidate.prefixLength !== GB_NUTS1_PREFIX_LENGTH) return false;
  if (candidate.coverage < PARENT_BORDER_MIN_COVERAGE) return false;
  return candidate.groupCountTotal >= GB_NUTS1_GROUP_MIN;
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
    const britishLeafEntries = featureEntries.filter(({ id }) =>
      GB_ID_PATTERN_RE.test(String(id || "").trim().toUpperCase())
    );
    const nuts1Candidate = buildIdPrefixGroupingCandidate(
      countryCode,
      britishLeafEntries,
      GB_NUTS1_PREFIX_LENGTH
    );
    if (isBritishNuts1GroupingCandidate(nuts1Candidate)) {
      return {
        ...nuts1Candidate,
        accepted: true,
        forcedRule: "gb_nuts1",
      };
    }
    if (isBritishConstituentGroupingCandidate(hierarchyCandidate)) {
      return {
        ...hierarchyCandidate,
        accepted: true,
        forcedRule: "gb_constituent_countries",
      };
    }
    const hierarchyFineEnough =
      hierarchyCandidate?.accepted &&
      Math.max(hierarchyCandidate.groupCount, hierarchyCandidate.groupCountTotal) >= GB_PARENT_MIN_GROUPS;
    if (hierarchyFineEnough) return hierarchyCandidate;

    const idPrefixCandidate = [
      buildIdPrefixGroupingCandidate(countryCode, britishLeafEntries, 4),
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

  const features = getFullLandDataFeatures();
  if (!features.length) {
    return sets;
  }

  features.forEach((feature) => {
    const source = String(feature?.properties?.__source || "primary");
    const countryCode = getFeatureCountryCodeNormalized(feature);
    const featureId = getFeatureId(feature);
    if (!countryCode || shouldExcludePoliticalInteractionFeature(feature, featureId)) return;
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
      if (shouldExcludePoliticalInteractionFeature(asFeatureLike(a)) || shouldExcludePoliticalInteractionFeature(asFeatureLike(b))) {
        return false;
      }
      const codeA = getFeatureCountryCodeNormalized(a);
      const codeB = getFeatureCountryCodeNormalized(b);
      return !!(codeA && codeB && codeA !== codeB);
    }
  );
}

function buildGlobalCoastlineMesh(primaryTopology) {
  if (!primaryTopology?.objects || !globalThis.topojson) return null;
  if (primaryTopology.objects.land_mask) {
    return globalThis.topojson.mesh(primaryTopology, primaryTopology.objects.land_mask);
  }
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
  const startedAt = nowMs();
  state.cachedCountryBorders = [];
  state.cachedProvinceBorders = [];
  state.cachedLocalBorders = [];
  state.cachedDetailAdmBorders = [];
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
    recordRenderPerfMetric("rebuildStaticMeshes", nowMs() - startedAt, {
      hasTopojson: false,
      countryMeshes: 0,
      coastlineMeshes: 0,
    });
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

  const detailCountries = sourceCountries.detail || new Set();
  const detailAdmMesh = buildDetailAdmBorderMesh(state.topologyDetail, detailCountries);
  if (isUsableMesh(detailAdmMesh)) {
    state.cachedDetailAdmBorders.push(detailAdmMesh);
  }

  const unifiedBorderTopology =
    state.topologyBundleMode === "composite" && state.runtimePoliticalTopology?.objects?.political
      ? state.runtimePoliticalTopology
      : (state.topologyPrimary || state.topology);
  const countryMesh = buildGlobalCountryBorderMesh(unifiedBorderTopology);
  if (isUsableMesh(countryMesh)) {
    state.cachedCountryBorders.push(countryMesh);
  }

  const coastlineMesh = buildGlobalCoastlineMesh(unifiedBorderTopology);
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
  recordRenderPerfMetric("rebuildStaticMeshes", nowMs() - startedAt, {
    hasTopojson: true,
    countryMeshes: state.cachedCountryBorders.length,
    provinceMeshes: state.cachedProvinceBorders.length,
    localMeshes: state.cachedLocalBorders.length,
    coastlineMeshes: state.cachedCoastlines.length,
  });
}

function invalidateBorderCache() {
  rebuildDynamicBorders();
  invalidateRenderPasses("borders", "border-cache");
}

function createHitResult(overrides = {}) {
  return {
    id: null,
    countryCode: null,
    targetType: null,
    feature: null,
    hitSource: "none",
    bboxArea: Infinity,
    viaSnap: false,
    strict: false,
    distancePx: Infinity,
    ...overrides,
  };
}

function keyToHitColor(key) {
  const value = Math.max(0, Math.min(0xffffff, Number(key) || 0));
  const r = value & 255;
  const g = (value >> 8) & 255;
  const b = (value >> 16) & 255;
  return `rgb(${r}, ${g}, ${b})`;
}

function hitColorToKey(pixel) {
  if (!pixel || pixel.length < 3) return 0;
  return (pixel[0] || 0) | ((pixel[1] || 0) << 8) | ((pixel[2] || 0) << 16);
}

function drawHitCanvas() {
  if (!hitContext || !pathHitCanvas || !state.landData?.features?.length) {
    state.hitCanvasDirty = false;
    return false;
  }

  const width = hitCanvas?.width || 0;
  const height = hitCanvas?.height || 0;
  if (width <= 0 || height <= 0) {
    state.hitCanvasDirty = false;
    return false;
  }

  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  const t = state.zoomTransform || globalThis.d3.zoomIdentity;
  const k = Math.max(0.0001, t.k || 1);

  hitContext.save();
  hitContext.setTransform(1, 0, 0, 1, 0, 0);
  hitContext.clearRect(0, 0, width, height);
  hitContext.globalCompositeOperation = "source-over";
  hitContext.globalAlpha = 1;
  hitContext.filter = "none";
  hitContext.shadowBlur = 0;
  hitContext.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  hitContext.translate(t.x, t.y);
  hitContext.scale(k, k);

  state.landData.features.forEach((feature, index) => {
    const id = getFeatureId(feature) || `feature-${index}`;
    const key = state.idToKey.get(id);
    if (!key) return;
    if (shouldExcludePoliticalInteractionFeature(feature, id)) return;
    if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) return;
    if (!pathBoundsInScreen(feature)) return;
    hitContext.beginPath();
    pathHitCanvas(feature);
    hitContext.fillStyle = keyToHitColor(key);
    hitContext.fill();
  });

  hitContext.restore();
  state.hitCanvasDirty = false;
  incrementPerfCounter("hitCanvasRenders");
  return true;
}

function drawHitCanvasWithMetric(details = {}) {
  const startedAt = nowMs();
  const built = drawHitCanvas();
  recordRenderPerfMetric("buildHitCanvas", nowMs() - startedAt, {
    built: !!built,
    dirtyBefore: true,
    ...details,
  });
  return built;
}

function scheduleHitCanvasBuildIfNeeded({ reason = "idle-render" } = {}) {
  if (!hitContext || !pathHitCanvas || !state.hitCanvasDirty) return false;
  if (state.deferHitCanvasBuild || state.renderPhase !== RENDER_PHASE_IDLE) {
    return false;
  }
  if (state.hitCanvasBuildScheduled) {
    return false;
  }
  state.hitCanvasBuildScheduled = scheduleDeferredWork(() => {
    state.hitCanvasBuildScheduled = null;
    if (!hitContext || !pathHitCanvas || !state.hitCanvasDirty) return;
    if (state.deferHitCanvasBuild || state.renderPhase !== RENDER_PHASE_IDLE) return;
    drawHitCanvasWithMetric({
      mode: "deferred",
      reason,
      activeScenarioId: String(state.activeScenarioId || ""),
    });
  }, {
    timeout: STAGED_HIT_CANVAS_TIMEOUT_MS,
  });
  return false;
}

function ensureHitCanvasUpToDate({ force = false } = {}) {
  if (!hitContext || !pathHitCanvas) return false;
  if (!force && !state.hitCanvasDirty) return true;
  if (!force) {
    scheduleHitCanvasBuildIfNeeded({ reason: "lazy-hit-validation" });
    return false;
  }
  cancelDeferredWork(state.hitCanvasBuildScheduled);
  state.hitCanvasBuildScheduled = null;
  return drawHitCanvasWithMetric({
    mode: "forced",
    reason: "strict-validation",
    activeScenarioId: String(state.activeScenarioId || ""),
  });
}

function getHitResultFromCanvas(event) {
  if (!mapSvg || !hitContext || !state.keyToId?.size || !globalThis.d3?.pointer) {
    return createHitResult();
  }
  const [sx, sy] = globalThis.d3.pointer(event, mapSvg);
  if (![sx, sy].every(Number.isFinite)) return createHitResult();
  const px = Math.max(0, Math.min((hitCanvas?.width || 1) - 1, Math.round(sx * state.dpr)));
  const py = Math.max(0, Math.min((hitCanvas?.height || 1) - 1, Math.round(sy * state.dpr)));

  let pixel = null;
  try {
    pixel = hitContext.getImageData(px, py, 1, 1).data;
  } catch (_error) {
    return createHitResult();
  }

  const key = hitColorToKey(pixel);
  if (!key) return createHitResult();
  const id = state.keyToId.get(key);
  if (!id) return createHitResult();
  const feature = state.landIndex.get(id);
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  if (
    !feature
    || shouldExcludePoliticalInteractionFeature(feature, id)
    || shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })
  ) {
    return createHitResult();
  }
  return createHitResult({
    id,
    countryCode: getFeatureCountryCodeNormalized(feature),
    targetType: "land",
    feature,
    hitSource: "canvas",
    bboxArea: Number(state.spatialItemsById?.get(id)?.bboxArea || Infinity),
    viaSnap: false,
    strict: true,
    distancePx: 0,
  });
}

function getValidatedCanvasHit(event, strictIds = null, { forceBuild = false } = {}) {
  if (state.renderPhase !== RENDER_PHASE_IDLE || !ensureHitCanvasUpToDate({ force: !!forceBuild })) {
    return createHitResult();
  }
  const hit = getHitResultFromCanvas(event);
  if (!hit.id) return hit;
  if (!strictIds?.size || strictIds.has(hit.id)) return hit;
  return createHitResult();
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
    if (shouldExcludePoliticalInteractionFeature(item.feature, item.id)) return;
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

function collectWaterGridCandidates(px, py, radiusProj = 0) {
  const meta = state.waterSpatialGridMeta;
  const grid = state.waterSpatialGrid;
  if (!meta || !grid) return [];
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
      const bucket = grid.get(key);
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
    if (!isWaterRegionEnabled(item.feature)) return;
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

function collectSpecialGridCandidates(px, py, radiusProj = 0) {
  const meta = state.specialSpatialGridMeta;
  const grid = state.specialSpatialGrid;
  if (!meta || !grid) return [];
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
      const bucket = grid.get(key);
      if (bucket?.length) {
        buckets.push(bucket);
      }
    }
  }

  const seen = new Set();
  const candidates = [];
  const strict = radius <= 0;

  const maybePush = (item) => {
    if (!item?.id || seen.has(item.id) || !isSpecialRegionEnabled(item.feature)) return;
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

function toHitResult(candidate, { viaSnap = false, strict = false, zoomK = 1, targetType = "land" } = {}) {
  if (!candidate?.item?.id) return createHitResult();
  return createHitResult({
    id: candidate.item.id,
    countryCode: candidate.item.countryCode || getFeatureCountryCodeNormalized(candidate.item.feature),
    targetType,
    feature: candidate.item.feature || null,
    hitSource: "spatial",
    bboxArea: Number(candidate.bboxArea || candidate.item.bboxArea || Infinity),
    viaSnap,
    strict,
    distancePx: candidate.distanceProj * zoomK,
  });
}

function shouldPreferWaterHit(landHit, waterHit) {
  if (!waterHit?.id) return false;
  if (!landHit?.id) return true;
  const waterType = getWaterRegionType(waterHit.feature);
  if (["lake", "inland_sea", "strait", "chokepoint"].includes(waterType)) {
    return true;
  }
  const landArea = Number(landHit.bboxArea || Infinity);
  const waterArea = Number(waterHit.bboxArea || Infinity);
  if (waterHit.strict && Number.isFinite(waterArea) && Number.isFinite(landArea) && waterArea < landArea * 0.2) {
    return true;
  }
  return false;
}

function getLandHitFromPointer(
  event,
  pointer,
  { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown" } = {}
) {
  if (!state.landData || !state.spatialItems?.length) return createHitResult();
  const hitMode = resolveHitMode();
  if (hitMode === "canvas" && eventType !== "compat") {
    const hitFromCanvas = getValidatedCanvasHit(event, null, {
      forceBuild: eventType === "click" || eventType === "dblclick",
    });
    if (hitFromCanvas.id) {
      return hitFromCanvas;
    }
  }

  const strictCandidates = collectGridCandidates(pointer.px, pointer.py, 0);
  const strictRanked = rankCandidates(strictCandidates, pointer.lonLat);
  if (strictRanked.length > 0) {
    const strictContainsGeo = strictRanked.find((candidate) => candidate.containsGeo);
    if (strictContainsGeo) {
      if (hitMode === "auto" && eventType !== "compat") {
        const strictIds = new Set(strictRanked.map((candidate) => candidate.item.id));
        const strictMatchCount = strictRanked.filter((candidate) => candidate.containsGeo).length;
        const hitFromCanvas = getValidatedCanvasHit(event, strictIds, {
          forceBuild:
            strictMatchCount > 1
            && (eventType === "click" || eventType === "dblclick" || eventType === "compat"),
        });
        if (hitFromCanvas.id === strictContainsGeo.item.id) {
          return hitFromCanvas;
        }
      }
      return toHitResult(strictContainsGeo, {
        viaSnap: false,
        strict: true,
        zoomK: pointer.zoomK,
        targetType: "land",
      });
    }
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
  return toHitResult(chosen, {
    viaSnap: true,
    strict: false,
    zoomK: pointer.zoomK,
    targetType: "land",
  });
}

function getWaterHitFromPointer(
  pointer,
  { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX } = {}
) {
  if (!state.showWaterRegions || !state.waterSpatialItems?.length) return createHitResult();

  const strictCandidates = collectWaterGridCandidates(pointer.px, pointer.py, 0);
  const strictRanked = rankCandidates(strictCandidates, pointer.lonLat);
  const strictHit = strictRanked.find((candidate) => candidate.containsGeo);
  if (strictHit) {
    if (shouldSuppressOpenOceanHit(strictHit, pointer)) {
      return createHitResult();
    }
    return toHitResult(strictHit, {
      viaSnap: false,
      strict: true,
      zoomK: pointer.zoomK,
      targetType: "water",
    });
  }

  if (!enableSnap) return createHitResult();

  const snapRadiusPx = Number.isFinite(Number(snapPx))
    ? Math.max(0, Number(snapPx))
    : HIT_SNAP_RADIUS_PX;
  const radiusProj = snapRadiusPx / pointer.zoomK;
  if (radiusProj <= 0) return createHitResult();

  const snapCandidates = collectWaterGridCandidates(pointer.px, pointer.py, radiusProj);
  const snapRanked = rankCandidates(snapCandidates, pointer.lonLat);
  const chosen = snapRanked.find((candidate) => candidate.containsGeo);
  if (!chosen) return createHitResult();
  if (shouldSuppressOpenOceanHit(chosen, pointer)) {
    return createHitResult();
  }
  return toHitResult(chosen, {
    viaSnap: true,
    strict: false,
    zoomK: pointer.zoomK,
    targetType: "water",
  });
}

function getSpecialHitFromPointer(
  pointer,
  { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX } = {}
) {
  if (!state.showScenarioSpecialRegions || !state.specialSpatialItems?.length) return createHitResult();

  const strictCandidates = collectSpecialGridCandidates(pointer.px, pointer.py, 0);
  const strictRanked = rankCandidates(strictCandidates, pointer.lonLat);
  const strictHit = strictRanked.find((candidate) => candidate.containsGeo);
  if (strictHit) {
    return toHitResult(strictHit, {
      viaSnap: false,
      strict: true,
      zoomK: pointer.zoomK,
      targetType: "special",
    });
  }

  if (!enableSnap) return createHitResult();

  const snapRadiusPx = Number.isFinite(Number(snapPx))
    ? Math.max(0, Number(snapPx))
    : HIT_SNAP_RADIUS_PX;
  const radiusProj = snapRadiusPx / pointer.zoomK;
  if (radiusProj <= 0) return createHitResult();

  const snapCandidates = collectSpecialGridCandidates(pointer.px, pointer.py, radiusProj);
  const snapRanked = rankCandidates(snapCandidates, pointer.lonLat);
  const chosen = snapRanked.find((candidate) => candidate.containsGeo);
  if (!chosen) return createHitResult();
  return toHitResult(chosen, {
    viaSnap: true,
    strict: false,
    zoomK: pointer.zoomK,
    targetType: "special",
  });
}

function buildIndex() {
  state.landIndex.clear();
  state.countryToFeatureIds.clear();
  state.idToKey.clear();
  state.keyToId.clear();
  state.waterRegionsById = new Map();
  state.specialRegionsById = new Map();

  getEffectiveWaterRegionFeatures().forEach((feature) => {
    const id = getFeatureId(feature);
    if (!id) return;
    state.waterRegionsById.set(id, feature);
  });

  getEffectiveSpecialRegionFeatures().forEach((feature) => {
    const id = getFeatureId(feature);
    if (!id) return;
    state.specialRegionsById.set(id, feature);
  });

  if (state.selectedWaterRegionId && !state.waterRegionsById.has(state.selectedWaterRegionId)) {
    state.selectedWaterRegionId = "";
  } else if (state.selectedWaterRegionId) {
    const selectedFeature = state.waterRegionsById.get(state.selectedWaterRegionId);
    if (!isWaterRegionEnabled(selectedFeature)) {
      state.selectedWaterRegionId = "";
    }
  }

  if (state.selectedSpecialRegionId && !state.specialRegionsById.has(state.selectedSpecialRegionId)) {
    state.selectedSpecialRegionId = "";
  } else if (state.selectedSpecialRegionId) {
    const selectedFeature = state.specialRegionsById.get(state.selectedSpecialRegionId);
    if (!isSpecialRegionEnabled(selectedFeature)) {
      state.selectedSpecialRegionId = "";
    }
  }

  if (!state.landData || !state.landData.features) {
    if (typeof state.renderWaterRegionListFn === "function") {
      state.renderWaterRegionListFn();
    }
    if (typeof state.renderSpecialRegionListFn === "function") {
      state.renderSpecialRegionListFn();
    }
    return;
  }
  state.landData.features.forEach((feature, index) => {
    const id = getFeatureId(feature) || `feature-${index}`;
    state.landIndex.set(id, feature);
    if (shouldExcludePoliticalInteractionFeature(feature, id)) return;
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
  if (typeof state.renderWaterRegionListFn === "function") {
    state.renderWaterRegionListFn();
  }
  if (typeof state.renderSpecialRegionListFn === "function") {
    state.renderSpecialRegionListFn();
  }
  if (typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
  state.devSelectionOverlayDirty = true;
  notifyDevWorkspace();
  state.hitCanvasDirty = true;
}

function buildRuntimePoliticalMeta() {
  state.runtimeFeatureIndexById = new Map();
  state.runtimeFeatureIds = [];
  state.runtimeNeighborGraph = [];
  state.runtimeCanonicalCountryByFeatureId = {};

  const geometries = state.runtimePoliticalTopology?.objects?.political?.geometries || [];
  if (!Array.isArray(geometries) || !geometries.length) return;

  const neighbors = Array.isArray(state.runtimePoliticalTopology?.objects?.political?.computed_neighbors)
    ? state.runtimePoliticalTopology.objects.political.computed_neighbors
    : [];

  geometries.forEach((geometry, index) => {
    const id = getEntityFeatureId(geometry);
    if (!id) return;
    state.runtimeFeatureIds.push(id);
    state.runtimeFeatureIndexById.set(id, index);
    state.runtimeCanonicalCountryByFeatureId[id] = getEntityCountryCode(geometry);
  });
  state.runtimeNeighborGraph =
    Array.isArray(neighbors) && neighbors.length === geometries.length
      ? neighbors
      : new Array(geometries.length).fill(null).map(() => []);
}

function buildSpatialIndex() {
  const startedAt = nowMs();
  state.spatialItems = [];
  state.spatialIndex = null;
  state.spatialGrid = new Map();
  state.spatialGridMeta = null;
  state.spatialItemsById = new Map();
  state.waterSpatialItems = [];
  state.waterSpatialIndex = null;
  state.waterSpatialGrid = new Map();
  state.waterSpatialGridMeta = null;
  state.waterSpatialItemsById = new Map();
  state.specialSpatialItems = [];
  state.specialSpatialIndex = null;
  state.specialSpatialGrid = new Map();
  state.specialSpatialGridMeta = null;
  state.specialSpatialItemsById = new Map();
  if (!state.landData || !state.landData.features || !pathSVG) {
    recordRenderPerfMetric("buildSpatialIndex", nowMs() - startedAt, {
      landCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
      spatialItems: 0,
      waterItems: 0,
      specialItems: 0,
      skipped: true,
    });
    return;
  }
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();

  for (const feature of state.landData.features) {
    const id = getFeatureId(feature);
    if (!id) continue;
    if (shouldExcludePoliticalInteractionFeature(feature, id)) continue;
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
  const buildSecondarySpatialGrid = (items, assign) => {
    const previousGrid = state.spatialGrid;
    const previousMeta = state.spatialGridMeta;
    const previousItemsById = state.spatialItemsById;
    buildSpatialGrid(items, canvasWidth, canvasHeight);
    assign();
    state.spatialGrid = previousGrid;
    state.spatialGridMeta = previousMeta;
    state.spatialItemsById = previousItemsById;
  };

  getEffectiveWaterRegionFeatures().forEach((feature) => {
    const id = getFeatureId(feature);
    if (!id) return;
    const bounds = getProjectedFeatureBounds(feature, { featureId: id, allowCompute: false })
      || getProjectedFeatureBounds(feature, { featureId: id });
    if (!bounds) return;
    state.waterSpatialItems.push({
      id,
      feature,
      countryCode: "",
      source: String(feature?.properties?.__source || "primary"),
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      bboxArea: bounds.area,
    });
  });
  buildSecondarySpatialGrid(state.waterSpatialItems, () => {
    state.waterSpatialGrid = state.spatialGrid;
    state.waterSpatialGridMeta = state.spatialGridMeta;
    state.waterSpatialItemsById = state.spatialItemsById;
  });

  getEffectiveSpecialRegionFeatures().forEach((feature) => {
    const id = getFeatureId(feature);
    if (!id) return;
    const bounds = getProjectedFeatureBounds(feature, { featureId: id, allowCompute: false })
      || getProjectedFeatureBounds(feature, { featureId: id });
    if (!bounds) return;
    state.specialSpatialItems.push({
      id,
      feature,
      countryCode: "",
      source: String(feature?.properties?.__source || "scenario"),
      minX: bounds.minX,
      minY: bounds.minY,
      maxX: bounds.maxX,
      maxY: bounds.maxY,
      bboxArea: bounds.area,
    });
  });
  buildSecondarySpatialGrid(state.specialSpatialItems, () => {
    state.specialSpatialGrid = state.spatialGrid;
    state.specialSpatialGridMeta = state.spatialGridMeta;
    state.specialSpatialItemsById = state.spatialItemsById;
  });
  state.hitCanvasDirty = true;
  recordRenderPerfMetric("buildSpatialIndex", nowMs() - startedAt, {
    landCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
    spatialItems: state.spatialItems.length,
    waterItems: state.waterSpatialItems.length,
    specialItems: state.specialSpatialItems.length,
    skipped: false,
  });
}

function getHitFromEvent(
  event,
  { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown" } = {}
) {
  if ((!state.landData || !state.spatialItems?.length) && !state.waterSpatialItems?.length && !state.specialSpatialItems?.length) {
    return createHitResult();
  }
  const pointer = getPointerProjectionPosition(event);
  if (!pointer) return createHitResult();
  const specialHit = getSpecialHitFromPointer(pointer, {
    enableSnap,
    snapPx,
  });
  if (specialHit.id) {
    return specialHit;
  }
  const landHit = getLandHitFromPointer(event, pointer, {
    enableSnap,
    snapPx,
    eventType,
  });
  const waterHit = getWaterHitFromPointer(pointer, {
    enableSnap,
    snapPx,
  });
  if (waterHit.id && isScenarioWaterRegion(waterHit.feature)) {
    return waterHit;
  }
  if (shouldPreferWaterHit(landHit, waterHit)) {
    return waterHit;
  }
  if (landHit.id) return landHit;
  if (waterHit.id) return waterHit;
  return createHitResult();
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
  const scenarioOwnerOnlyBorders =
    !!state.activeScenarioId && state.scenarioBorderMode === "scenario_owner_only";
  const dynamicOwnerMeshes =
    isDynamicBordersEnabled() && isUsableMesh(state.cachedDynamicOwnerBorders)
      ? [state.cachedDynamicOwnerBorders]
      : null;
  const openingOwnerMeshes =
    scenarioOwnerOnlyBorders
    && String(state.scenarioViewMode || "ownership") === "ownership"
    && !isDynamicBordersEnabled()
    && isUsableMesh(state.cachedScenarioOpeningOwnerBorders)
      ? [state.cachedScenarioOpeningOwnerBorders]
      : null;
  const empireMeshes = scenarioOwnerOnlyBorders
    ? (dynamicOwnerMeshes || openingOwnerMeshes || state.cachedCountryBorders)
    : (dynamicOwnerMeshes || state.cachedCountryBorders);

  if (interactive) {
    const countryWidth = (empireWidthBase * 0.95) / kDenom;
    const coastWidth = (coastWidthBase * 0.88) / kDenom;
    const coastlineLow = state.cachedCoastlinesLow?.length
      ? state.cachedCoastlinesLow
      : (state.cachedCoastlines?.length ? state.cachedCoastlines : state.cachedCoastlinesHigh);

    context.globalAlpha = 0.88;
    drawMeshCollection(empireMeshes, empireColor, countryWidth);

    context.globalAlpha = 0.78;
    drawMeshCollection(coastlineLow, coastColor, coastWidth);

    context.globalAlpha = 1.0;
    return;
  }

  const countryAlpha = 0.90;
  const regularProvinceAlpha = clamp(
    internalOpacity * (0.22 + 0.50 * t) * lowZoomDeclutter,
    INTERNAL_BORDER_PROVINCE_MIN_ALPHA,
    0.74
  );
  let provinceAlpha = regularProvinceAlpha;
  if (k <= PROVINCE_BORDERS_FADE_START_ZOOM) {
    provinceAlpha = PROVINCE_BORDERS_FAR_ALPHA;
  } else if (k < PROVINCE_BORDERS_TRANSITION_END_ZOOM) {
    const fadeT = clamp(
      (k - PROVINCE_BORDERS_FADE_START_ZOOM)
      / (PROVINCE_BORDERS_TRANSITION_END_ZOOM - PROVINCE_BORDERS_FADE_START_ZOOM),
      0,
      1
    );
    provinceAlpha = PROVINCE_BORDERS_FAR_ALPHA
      + ((PROVINCE_BORDERS_TRANSITION_ALPHA - PROVINCE_BORDERS_FAR_ALPHA) * fadeT);
  } else {
    provinceAlpha = Math.max(regularProvinceAlpha, PROVINCE_BORDERS_TRANSITION_ALPHA);
  }
  const localAlpha = clamp(
    internalOpacity * (0.08 + 0.34 * t) * lowZoomDeclutter,
    INTERNAL_BORDER_LOCAL_MIN_ALPHA,
    0.48
  );
  const parentAlpha = clamp(parentOpacity * (0.55 + 0.25 * t), 0.30, 0.90);
  const coastAlpha = clamp(0.74 + 0.12 * t, 0.74, 0.86);
  const detailAdmAlpha = clamp(0.20 + 0.12 * t, DETAIL_ADM_BORDER_MIN_ALPHA, DETAIL_ADM_BORDER_MAX_ALPHA);

  const countryWidth = (empireWidthBase * (0.95 + 0.40 * t)) / kDenom;
  let provinceWidth = Math.max(
    INTERNAL_BORDER_PROVINCE_MIN_WIDTH,
    internalWidthBase * (0.72 + 0.65 * t) * lowZoomWidthScale
  ) / kDenom;
  if (k < PROVINCE_BORDERS_FAR_WIDTH_MAX_ZOOM) {
    provinceWidth *= PROVINCE_BORDERS_FAR_WIDTH_SCALE;
  }
  const localWidth = Math.max(
    INTERNAL_BORDER_LOCAL_MIN_WIDTH,
    internalWidthBase * 0.40 * (0.70 + 0.55 * t) * lowZoomWidthScale
  ) / kDenom;
  const parentWidth = (parentWidthBase * (0.90 + 0.35 * t)) / kDenom;
  const coastWidth = (coastWidthBase * (0.90 + 0.30 * t)) / kDenom;
  const detailAdmWidth = Math.max(
    DETAIL_ADM_BORDER_MIN_WIDTH,
    internalWidthBase * 0.42 * (0.72 + 0.40 * t) * lowZoomWidthScale
  ) / kDenom;
  const coastlineCollection = k < COASTLINE_LOD_LOW_ZOOM_MAX
    ? (state.cachedCoastlinesLow?.length ? state.cachedCoastlinesLow : state.cachedCoastlines)
    : k < COASTLINE_LOD_MID_ZOOM_MAX
      ? (state.cachedCoastlinesMid?.length ? state.cachedCoastlinesMid : state.cachedCoastlines)
      : (state.cachedCoastlinesHigh?.length ? state.cachedCoastlinesHigh : state.cachedCoastlines);

  if (k >= LOCAL_BORDERS_MIN_ZOOM) {
    context.globalAlpha = localAlpha;
    drawMeshCollection(state.cachedLocalBorders, internalColor, localWidth);
  }

  context.globalAlpha = provinceAlpha;
  drawMeshCollection(state.cachedProvinceBorders, internalColor, provinceWidth);

  if (k >= DETAIL_ADM_BORDERS_MIN_ZOOM) {
    context.globalAlpha = detailAdmAlpha;
    drawMeshCollection(state.cachedDetailAdmBorders, DETAIL_ADM_BORDER_COLOR, detailAdmWidth);
  }

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
  drawMeshCollection(empireMeshes, empireColor, countryWidth);

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

function getLakeStyleConfig() {
  state.styleConfig = state.styleConfig && typeof state.styleConfig === "object" ? state.styleConfig : {};
  state.styleConfig.lakes = normalizeLakeStyleConfig(state.styleConfig.lakes);
  return state.styleConfig.lakes;
}

function getLakeBaseFillColor() {
  const lakeStyle = getLakeStyleConfig();
  if (lakeStyle.linkedToOcean) {
    return getOceanBaseFillColor();
  }
  return getSafeCanvasColor(lakeStyle.fillColor, getOceanBaseFillColor()) || getOceanBaseFillColor();
}

function getUnifiedWaterBaseStyle(feature) {
  const waterType = getWaterRegionType(feature);
  return {
    fill: waterType === "lake" ? getLakeBaseFillColor() : getOceanBaseFillColor(),
    stroke: UNIFIED_WATER_STROKE_COLOR,
    opacity: UNIFIED_WATER_FILL_OPACITY,
  };
}

function getWaterRegionDefaultFillColorById(id) {
  return getWaterRegionDefaultStyle(state.waterRegionsById?.get(String(id || "").trim())).fill;
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
  const startedAt = nowMs();
  context.beginPath();
  if (maskMode === OCEAN_MASK_MODE_TOPOLOGY && state.oceanData) {
    pathCanvas(state.oceanData);
    context.clip();
    recordRenderPerfMetric("applyOceanClipMask", nowMs() - startedAt, {
      applied: true,
      maskMode,
      maskSource: "oceanData",
      maskFeatureCount: getFeatureCollectionFeatureCount(state.oceanData),
      maskArcRefEstimate: estimateTopologyObjectArcRefs(state.topologyPrimary || state.topology, "ocean"),
    });
    return;
  }

  pathCanvas({ type: "Sphere" });
  const maskInfo = getPhysicalLandMaskInfo();
  const landMask = maskInfo.collection;

  if (landMask) {
    pathCanvas(landMask);
    try {
      context.clip("evenodd");
    } catch (error) {
      context.clip();
    }
    recordRenderPerfMetric("applyOceanClipMask", nowMs() - startedAt, {
      applied: true,
      maskMode,
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    });
    return;
  }

  context.clip();
  recordRenderPerfMetric("applyOceanClipMask", nowMs() - startedAt, {
    applied: true,
    maskMode,
    maskSource: "sphere-only",
    maskFeatureCount: 0,
    maskArcRefEstimate: null,
  });
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

function warnMissingPhysicalContextOnce(key, message) {
  if (missingPhysicalContextWarnings.has(key)) return;
  missingPhysicalContextWarnings.add(key);
  console.warn(message);
}

function getPhysicalAtlasClass(feature) {
  const props = feature?.properties || {};
  return String(props.atlas_class || props.atlasClass || "").trim();
}

function getPhysicalAtlasLayer(feature) {
  const props = feature?.properties || {};
  return String(props.atlas_layer || props.atlasLayer || "relief_base").trim().toLowerCase();
}

function buildPhysicalAtlasFallbackCollection() {
  const sourceCollection = state.physicalData;
  if (!Array.isArray(sourceCollection?.features)) return null;
  if (physicalAtlasFallbackCache.sourceRef === sourceCollection) {
    return physicalAtlasFallbackCache.collection;
  }

  const classifyFeature = (featureClassRaw) => {
    const featureClass = String(featureClassRaw || "").trim().toLowerCase();
    switch (featureClass) {
      case "range/mountain":
      case "range/mtn":
        return { atlasClass: "mountain_high_relief", atlasLayer: "relief_base" };
      case "foothills":
      case "plateau":
        return { atlasClass: "upland_plateau", atlasLayer: "relief_base" };
      case "plain":
      case "lowland":
        return { atlasClass: "plains_lowlands", atlasLayer: "relief_base" };
      case "delta":
      case "wetlands":
        return { atlasClass: "wetlands_delta", atlasLayer: "relief_base" };
      case "desert":
        return { atlasClass: "desert_bare", atlasLayer: "semantic_overlay" };
      case "tundra":
        return { atlasClass: "tundra_ice", atlasLayer: "semantic_overlay" };
      default:
        return null;
    }
  };
  const features = sourceCollection.features
    .map((feature, index) => {
      const props = feature?.properties || {};
      const featureClass = String(props.featurecla || props.FEATURECLA || "").trim();
      const semantic = classifyFeature(featureClass);
      if (!semantic?.atlasClass) return null;
      return {
        type: "Feature",
        id: props.id || `physical_fallback_${index}`,
        properties: {
          ...props,
          atlas_class: semantic.atlasClass,
          atlas_layer: semantic.atlasLayer,
          source: "topology_physical_fallback",
        },
        geometry: feature.geometry,
      };
    })
    .filter(Boolean);

  physicalAtlasFallbackCache.sourceRef = sourceCollection;
  physicalAtlasFallbackCache.collection = {
    type: "FeatureCollection",
    features,
  };
  return physicalAtlasFallbackCache.collection;
}

function getResolvedPhysicalAtlasCollection() {
  if (Array.isArray(state.physicalSemanticsData?.features) && state.physicalSemanticsData.features.length > 0) {
    return state.physicalSemanticsData;
  }
  const fallback = buildPhysicalAtlasFallbackCollection();
  if (Array.isArray(fallback?.features) && fallback.features.length > 0) {
    warnMissingPhysicalContextOnce(
      "physical-semantics-fallback",
      "[physical] global_physical_semantics.topo.json missing; using relief-only atlas fallback."
    );
    return fallback;
  }
  return null;
}

function getAtlasFeatureAlphaMultiplier(atlasClass, cfg) {
  if (atlasClass === "rainforest") {
    return clamp(0.72 + cfg.rainforestEmphasis * 0.38, 0.2, 1.2);
  }
  if (atlasClass === "plains_lowlands") return 0.88;
  if (atlasClass === "wetlands_delta") return 0.92;
  return 1;
}

function countTopologyArcRefs(arcs) {
  if (Number.isInteger(arcs)) return 1;
  if (!Array.isArray(arcs)) return 0;
  return arcs.reduce((sum, entry) => sum + countTopologyArcRefs(entry), 0);
}

function estimateTopologyObjectArcRefs(topology, objectName) {
  const object = topology?.objects?.[objectName];
  if (!object || typeof object !== "object") return null;
  if (Array.isArray(object.geometries)) {
    const total = object.geometries.reduce(
      (sum, geometry) => sum + countTopologyArcRefs(geometry?.arcs),
      0
    );
    return total > 0 ? total : null;
  }
  const total = countTopologyArcRefs(object.arcs);
  return total > 0 ? total : null;
}

function getFeatureCollectionFeatureCount(collection) {
  return Array.isArray(collection?.features) ? collection.features.length : 0;
}

function getPhysicalLandMaskInfo() {
  const primaryTopology = state.topologyPrimary || state.topology;
  const detailTopology = state.topologyDetail;
  const landSource = String(state.contextLayerSourceByName?.land || "").trim().toLowerCase();
  if (Array.isArray(state.scenarioContextLandMaskData?.features) && state.scenarioContextLandMaskData.features.length) {
    return {
      collection: state.scenarioContextLandMaskData,
      maskSource: "scenarioContextLandMask",
      maskFeatureCount: getFeatureCollectionFeatureCount(state.scenarioContextLandMaskData),
      maskArcRefEstimate: estimateTopologyObjectArcRefs(state.scenarioRuntimeTopologyData, "context_land_mask")
        ?? estimateTopologyObjectArcRefs(state.scenarioRuntimeTopologyData, "land_mask")
        ?? estimateTopologyObjectArcRefs(state.scenarioRuntimeTopologyData, "land"),
    };
  }
  if (Array.isArray(state.scenarioLandMaskData?.features) && state.scenarioLandMaskData.features.length) {
    return {
      collection: state.scenarioLandMaskData,
      maskSource: "scenarioLandMask",
      maskFeatureCount: getFeatureCollectionFeatureCount(state.scenarioLandMaskData),
      maskArcRefEstimate:
        estimateTopologyObjectArcRefs(state.scenarioRuntimeTopologyData, "land_mask")
        ?? estimateTopologyObjectArcRefs(state.scenarioRuntimeTopologyData, "land"),
    };
  }
  if (Array.isArray(state.landBgData?.features) && state.landBgData.features.length) {
    const topology = landSource === "detail" ? detailTopology : primaryTopology;
    return {
      collection: state.landBgData,
      maskSource: "landBgData",
      maskFeatureCount: getFeatureCollectionFeatureCount(state.landBgData),
      maskArcRefEstimate: estimateTopologyObjectArcRefs(topology, "land"),
    };
  }
  if (Array.isArray(state.landDataFull?.features) && state.landDataFull.features.length) {
    const topology = state.runtimePoliticalTopology?.objects?.political
      ? state.runtimePoliticalTopology
      : (primaryTopology || null);
    return {
      collection: state.landDataFull,
      maskSource: "landDataFull",
      maskFeatureCount: getFeatureCollectionFeatureCount(state.landDataFull),
      maskArcRefEstimate: estimateTopologyObjectArcRefs(topology, "political"),
    };
  }
  if (Array.isArray(state.landData?.features) && state.landData.features.length) {
    const topology = state.runtimePoliticalTopology?.objects?.political
      ? state.runtimePoliticalTopology
      : (primaryTopology || null);
    return {
      collection: state.landData,
      maskSource: "landData",
      maskFeatureCount: getFeatureCollectionFeatureCount(state.landData),
      maskArcRefEstimate: estimateTopologyObjectArcRefs(topology, "political"),
    };
  }
  return {
    collection: null,
    maskSource: "none",
    maskFeatureCount: 0,
    maskArcRefEstimate: null,
  };
}

function getPhysicalLandMask() {
  return getPhysicalLandMaskInfo().collection;
}

function getPhysicalLandClipCacheKey(maskInfo) {
  return [
    String(state.activeScenarioId || ""),
    String(state.renderProfile || "auto"),
    getViewportRenderSignature(),
    getProjectionRenderSignature(),
    getContextBaseZoomBucketId(),
    `mask:${maskInfo?.maskSource || "none"}:${maskInfo?.maskFeatureCount || 0}:${maskInfo?.maskArcRefEstimate ?? "na"}`,
    `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
  ].join("::");
}

function getPhysicalLandClipPath(maskInfo, landMask) {
  if (!globalThis.Path2D || !globalThis.d3 || typeof globalThis.d3.geoPath !== "function") {
    return { path: null, cacheHit: false, cacheKey: "", pathType: "canvas-path" };
  }
  const cacheKey = getPhysicalLandClipCacheKey(maskInfo);
  if (physicalLandClipPathCache.key === cacheKey && physicalLandClipPathCache.path) {
    return {
      path: physicalLandClipPathCache.path,
      cacheHit: true,
      cacheKey,
      pathType: "path2d-cache",
    };
  }
  try {
    const pathString = globalThis.d3.geoPath(projection).pointRadius(PATH_POINT_RADIUS)(landMask);
    if (!pathString) {
      return { path: null, cacheHit: false, cacheKey, pathType: "canvas-path" };
    }
    const path = new globalThis.Path2D(pathString);
    physicalLandClipPathCache.key = cacheKey;
    physicalLandClipPathCache.path = path;
    return {
      path,
      cacheHit: false,
      cacheKey,
      pathType: "path2d-cache",
    };
  } catch (_error) {
    return { path: null, cacheHit: false, cacheKey, pathType: "canvas-path" };
  }
}

function applyPhysicalLandClipMask() {
  const startedAt = nowMs();
  const maskInfo = getPhysicalLandMaskInfo();
  const landMask = maskInfo.collection;
  if (!landMask) {
    collectContextMetric("applyPhysicalLandClipMask", nowMs() - startedAt, {
      applied: false,
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
      reason: "no-mask",
    });
    return false;
  }
  const clipPath = getPhysicalLandClipPath(maskInfo, landMask);
  if (clipPath.path) {
    context.clip(clipPath.path);
  } else {
    context.beginPath();
    pathCanvas(landMask);
    context.clip();
  }
  collectContextMetric("applyPhysicalLandClipMask", nowMs() - startedAt, {
    applied: true,
    maskSource: maskInfo.maskSource,
    maskFeatureCount: maskInfo.maskFeatureCount,
    maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    cacheHit: !!clipPath.cacheHit,
    pathType: clipPath.pathType,
  });
  return true;
}

function drawPhysicalAtlasLayer(k, { interactive = false, clipAlreadyApplied = false } = {}) {
  const startedAt = nowMs();
  const cfg = normalizePhysicalStyleConfig(state.styleConfig?.physical);
  const maskInfo = getPhysicalLandMaskInfo();
  if (!state.showPhysical || cfg.mode === "contours_only") {
    collectContextMetric("drawPhysicalAtlasLayer", nowMs() - startedAt, {
      featureCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: !state.showPhysical ? "hidden" : "contours-only",
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    });
    return;
  }

  const atlasCollection = getResolvedPhysicalAtlasCollection();
  if (!Array.isArray(atlasCollection?.features) || atlasCollection.features.length === 0) {
    warnMissingPhysicalContextOnce(
      "physical-atlas-missing",
      "[physical] Atlas semantics unavailable; skipping physical atlas fill."
    );
    collectContextMetric("drawPhysicalAtlasLayer", nowMs() - startedAt, {
      featureCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "no-data",
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    });
    return;
  }

  const blendMode = getSafeBlendMode(cfg.blendMode, "source-over");
  const baseOpacity = clamp(
    cfg.opacity * cfg.atlasOpacity * (interactive ? 0.7 : 1) * cfg.atlasIntensity,
    0,
    1
  );

  context.save();
  if (!clipAlreadyApplied) {
    applyPhysicalLandClipMask();
  }
  context.globalCompositeOperation = blendMode;

  ["relief_base", "semantic_overlay"].forEach((layerName) => {
    atlasCollection.features.forEach((feature) => {
      const atlasClass = getPhysicalAtlasClass(feature);
      if (!atlasClass || cfg.atlasClassVisibility?.[atlasClass] === false) return;
      if (getPhysicalAtlasLayer(feature) !== layerName) return;
      if (!pathBoundsInScreen(feature)) return;
      const fillColor = getSafeCanvasColor(PHYSICAL_ATLAS_PALETTE[atlasClass], null);
      if (!fillColor) return;
      context.globalAlpha = clamp(baseOpacity * getAtlasFeatureAlphaMultiplier(atlasClass, cfg), 0, 1);
      context.fillStyle = fillColor;
      context.beginPath();
      pathCanvas(feature);
      context.fill();
    });
  });

  context.restore();
  collectContextMetric("drawPhysicalAtlasLayer", nowMs() - startedAt, {
    featureCount: atlasCollection.features.length,
    interactive: !!interactive,
    skipped: false,
    maskSource: maskInfo.maskSource,
    maskFeatureCount: maskInfo.maskFeatureCount,
    maskArcRefEstimate: maskInfo.maskArcRefEstimate,
  });
}

function drawContourCollection(
  collection,
  {
    color,
    opacity,
    width,
    k,
    interactive = false,
    lowReliefCutoff = 0,
    intervalM = 0,
    excludeIntervalM = 0,
  } = {}
) {
  if (!Array.isArray(collection?.features) || collection.features.length === 0) return false;
  const scale = Math.max(0.0001, k);
  context.globalAlpha = interactive ? Math.min(opacity, 0.22) : opacity;
  context.strokeStyle = color;
  context.lineWidth = width / scale;
  context.lineJoin = "round";
  context.lineCap = "round";

  let drewAny = false;
  collection.features.forEach((feature) => {
    const elevation = Number(feature?.properties?.elevation_m);
    if (Number.isFinite(elevation) && elevation < lowReliefCutoff) return;
    if (intervalM > 0 && Number.isFinite(elevation) && elevation % intervalM !== 0) return;
    if (excludeIntervalM > 0 && Number.isFinite(elevation) && elevation % excludeIntervalM === 0) return;
    if (!pathBoundsInScreen(feature)) return;
    context.beginPath();
    pathCanvas(feature);
    context.stroke();
    drewAny = true;
  });
  return drewAny;
}

function drawPhysicalContourLayer(k, { interactive = false, clipAlreadyApplied = false } = {}) {
  const startedAt = nowMs();
  const cfg = normalizePhysicalStyleConfig(state.styleConfig?.physical);
  const maskInfo = getPhysicalLandMaskInfo();
  if (!state.showPhysical || cfg.mode === "atlas_only") {
    collectContextMetric("drawPhysicalContourLayer", nowMs() - startedAt, {
      featureCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: !state.showPhysical ? "hidden" : "atlas-only",
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    });
    return;
  }

  if (!Array.isArray(state.physicalContourMajorData?.features) || state.physicalContourMajorData.features.length === 0) {
    warnMissingPhysicalContextOnce(
      "physical-contours-major-missing",
      "[physical] global_contours.major.topo.json missing; skipping terrain contours."
    );
    collectContextMetric("drawPhysicalContourLayer", nowMs() - startedAt, {
      featureCount: 0,
      majorFeatureCount: 0,
      minorFeatureCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "no-data",
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    });
    return;
  }

  const blendMode = getSafeBlendMode(cfg.blendMode, "source-over");
  const contourColor = getSafeCanvasColor(cfg.contourColor, "#6b5947");
  const lowReliefCutoff = clamp(Number(cfg.contourLowReliefCutoffM) || 0, 0, 2000);
  const majorOpacity = clamp(cfg.opacity * cfg.contourOpacity, 0, 1);
  const minorOpacity = clamp(majorOpacity * 0.68, 0, 1);

  context.save();
  if (!clipAlreadyApplied) {
    applyPhysicalLandClipMask();
  }
  context.globalCompositeOperation = blendMode;

  drawContourCollection(state.physicalContourMajorData, {
    color: contourColor,
    opacity: majorOpacity,
    width: clamp(Number(cfg.contourMajorWidth) || 0.8, 0.2, 3),
    k,
    interactive,
    lowReliefCutoff,
    intervalM: clamp(Number(cfg.contourMajorIntervalM) || 500, 500, 2000),
  });

  if (cfg.contourMinorVisible && k >= 2) {
    if (Array.isArray(state.physicalContourMinorData?.features) && state.physicalContourMinorData.features.length > 0) {
      drawContourCollection(state.physicalContourMinorData, {
        color: contourColor,
        opacity: minorOpacity,
        width: clamp(Number(cfg.contourMinorWidth) || 0.45, 0.1, 2),
        k,
        interactive,
        lowReliefCutoff,
        intervalM: clamp(Number(cfg.contourMinorIntervalM) || 100, 100, 1000),
        excludeIntervalM: clamp(Number(cfg.contourMajorIntervalM) || 500, 500, 2000),
      });
    } else {
      warnMissingPhysicalContextOnce(
        "physical-contours-minor-missing",
        "[physical] global_contours.minor.topo.json missing; skipping minor contours."
      );
    }
  }

  context.restore();
  collectContextMetric("drawPhysicalContourLayer", nowMs() - startedAt, {
    featureCount:
      getFeatureCollectionFeatureCount(state.physicalContourMajorData)
      + getFeatureCollectionFeatureCount(state.physicalContourMinorData),
    majorFeatureCount: getFeatureCollectionFeatureCount(state.physicalContourMajorData),
    minorFeatureCount: getFeatureCollectionFeatureCount(state.physicalContourMinorData),
    interactive: !!interactive,
    skipped: false,
    maskSource: maskInfo.maskSource,
    maskFeatureCount: maskInfo.maskFeatureCount,
    maskArcRefEstimate: maskInfo.maskArcRefEstimate,
  });
}

function drawPhysicalLayer(k, { interactive = false } = {}) {
  const cfg = normalizePhysicalStyleConfig(state.styleConfig?.physical);
  const shouldShareClip = !!state.showPhysical && cfg.mode !== "disabled";
  if (!shouldShareClip) {
    drawPhysicalAtlasLayer(k, { interactive });
    drawPhysicalContourLayer(k, { interactive });
    return;
  }
  context.save();
  applyPhysicalLandClipMask();
  drawPhysicalAtlasLayer(k, { interactive, clipAlreadyApplied: true });
  drawPhysicalContourLayer(k, { interactive, clipAlreadyApplied: true });
  context.restore();
}

function drawUrbanLayer(k, { interactive = false } = {}) {
  const startedAt = nowMs();
  if (!state.showUrban || !state.urbanData?.features?.length) {
    collectContextMetric("drawUrbanLayer", nowMs() - startedAt, {
      featureCount: getFeatureCollectionFeatureCount(state.urbanData),
      interactive: !!interactive,
      skipped: true,
      reason: !state.showUrban ? "hidden" : "no-data",
    });
    return;
  }
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
    if (!pathBoundsInScreen(feature)) return;
    context.beginPath();
    pathCanvas(feature);
    context.fill();
  });

  context.restore();
  collectContextMetric("drawUrbanLayer", nowMs() - startedAt, {
    featureCount: getFeatureCollectionFeatureCount(state.urbanData),
    interactive: !!interactive,
    skipped: false,
  });
}

function drawRiversLayer(k, { interactive = false } = {}) {
  const startedAt = nowMs();
  if (!state.showRivers || !state.riversData?.features?.length) {
    collectContextMetric("drawRiversLayer", nowMs() - startedAt, {
      featureCount: getFeatureCollectionFeatureCount(state.riversData),
      interactive: !!interactive,
      skipped: true,
      reason: !state.showRivers ? "hidden" : "no-data",
    });
    return;
  }
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
      if (!pathBoundsInScreen(feature)) return;
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
    if (!pathBoundsInScreen(feature)) return;
    context.beginPath();
    pathCanvas(feature);
    context.stroke();
  });
  context.setLineDash([]);

  context.restore();
  collectContextMetric("drawRiversLayer", nowMs() - startedAt, {
    featureCount: getFeatureCollectionFeatureCount(state.riversData),
    interactive: !!interactive,
    skipped: false,
  });
}

function getTextureStyleConfig() {
  if (!state.styleConfig || typeof state.styleConfig !== "object") {
    state.styleConfig = {};
  }
  state.styleConfig.texture = normalizeTextureStyleConfig(state.styleConfig.texture);
  return state.styleConfig.texture;
}

function requestTextureRerender() {
  if (typeof state.renderNowFn === "function") {
    state.renderNowFn();
    return;
  }
  if (context) {
    drawCanvas();
  }
}

function getDayNightStyleConfig() {
  if (!state.styleConfig || typeof state.styleConfig !== "object") {
    state.styleConfig = {};
  }
  state.styleConfig.dayNight = normalizeDayNightStyleConfig(state.styleConfig.dayNight);
  return state.styleConfig.dayNight;
}

function normalizeLongitude(value) {
  let normalized = Number.isFinite(Number(value)) ? Number(value) : 0;
  while (normalized > 180) normalized -= 360;
  while (normalized <= -180) normalized += 360;
  return normalized;
}

function getUtcDateKey(date = new Date()) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getUtcDayOfYear(date = new Date()) {
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const todayUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.max(1, Math.floor((todayUtc - yearStart) / 86_400_000) + 1);
}

function getCurrentUtcMinutesFromDate(date = new Date()) {
  return date.getUTCHours() * 60 + date.getUTCMinutes();
}

function getCurrentUtcMinutes() {
  return getCurrentUtcMinutesFromDate(new Date());
}

function getDayNightSignatureClockToken(config = getDayNightStyleConfig(), now = new Date()) {
  const dayKey = getUtcDateKey(now);
  if (config.mode === "utc") {
    return `${dayKey}|utc:${getCurrentUtcMinutesFromDate(now)}`;
  }
  return `${dayKey}|manual:${config.manualUtcMinutes}`;
}

function getDayNightLiveClockToken(config = getDayNightStyleConfig(), now = new Date()) {
  const dayKey = getUtcDateKey(now);
  if (config.mode === "utc") {
    return `${dayKey}|utc:${getCurrentUtcMinutesFromDate(now)}`;
  }
  return `${dayKey}|manual-day`;
}

function getSolarDeclinationRadians(date = new Date(), utcMinutes = getCurrentUtcMinutesFromDate(date)) {
  const dayOfYear = getUtcDayOfYear(date);
  const gamma = (2 * Math.PI / 365) * (dayOfYear - 1 + ((utcMinutes / 60) - 12) / 24);
  return (
    0.006918
    - 0.399912 * Math.cos(gamma)
    + 0.070257 * Math.sin(gamma)
    - 0.006758 * Math.cos(2 * gamma)
    + 0.000907 * Math.sin(2 * gamma)
    - 0.002697 * Math.cos(3 * gamma)
    + 0.00148 * Math.sin(3 * gamma)
  );
}

function getCurrentSolarState(config = getDayNightStyleConfig()) {
  const now = new Date();
  const utcMinutes = config.mode === "utc"
    ? getCurrentUtcMinutesFromDate(now)
    : clamp(Math.round(Number(config.manualUtcMinutes) || 0), 0, 24 * 60 - 1);
  const declinationDeg = getSolarDeclinationRadians(now, utcMinutes) * (180 / Math.PI);
  const subsolarLongitude = normalizeLongitude(180 - (utcMinutes / 4));
  return {
    now,
    utcMinutes,
    declinationDeg,
    subsolarLongitude,
    antisolarLongitude: normalizeLongitude(subsolarLongitude + 180),
    antisolarLatitude: clamp(-declinationDeg, -89.5, 89.5),
  };
}

function buildNightHemisphereFeature(solarState, radiusDeg = 90) {
  if (!solarState || !globalThis.d3?.geoCircle) return null;
  return globalThis.d3.geoCircle()
    .center([solarState.antisolarLongitude, solarState.antisolarLatitude])
    .radius(clamp(Number(radiusDeg) || 90, 1, 90))
    .precision(2)();
}

function getNightLightPalette(styleVariant = "modern") {
  if (styleVariant === "historical_1930s") {
    return {
      halo: "#f4c972",
      core: "#ffd88b",
      glint: "#fff4c1",
    };
  }
  return {
    texture: "#526a8c",
    corridor: "#d7e6ff",
    halo: "#96b5da",
    core: "#fff1cf",
    glint: "#f8fbff",
  };
}

function getUrbanLightWeight(feature, styleVariant = "modern") {
  const props = feature?.properties || {};
  const areaSqKm = Math.max(0, Number(props.area_sqkm ?? props.AREA_SQKM ?? 0));
  const scalerank = clamp(
    Math.round(Number(props.scalerank ?? props.SCALERANK ?? 8)) || 8,
    1,
    10
  );
  const areaScore = clamp(Math.log10(areaSqKm + 1) / 3.45, 0, 1.1);
  const rankScore = clamp((9 - scalerank) / 7, 0, 1.12);
  const metroBoost = areaSqKm >= 1500 ? 0.18 : areaSqKm >= 700 ? 0.08 : 0;

  if (styleVariant === "historical_1930s") {
    const keep = scalerank <= 5 || areaSqKm >= 220;
    if (!keep) return 0;
    return clamp((areaScore * 0.55) + (rankScore * 0.72) + metroBoost, 0.12, 0.92);
  }

  return clamp((areaScore * 0.62) + (rankScore * 0.78) + metroBoost, 0.08, 1.18);
}

function getModernCityLightsProjectionKey() {
  if (!projection) return "";
  const scale = Number(projection.scale?.() || 0).toFixed(4);
  const translate = projection.translate?.() || [0, 0];
  const center = projection.center?.() || [0, 0];
  const rotate = projection.rotate?.() || [0, 0, 0];
  return [
    state.width || 0,
    state.height || 0,
    scale,
    ...translate.map((value) => Number(value || 0).toFixed(2)),
    ...center.map((value) => Number(value || 0).toFixed(2)),
    ...rotate.map((value) => Number(value || 0).toFixed(2)),
  ].join("|");
}

function getModernCityLightsGridValue(x, y) {
  const wrappedX = ((Math.round(x) % MODERN_CITY_LIGHTS_GRID_WIDTH) + MODERN_CITY_LIGHTS_GRID_WIDTH)
    % MODERN_CITY_LIGHTS_GRID_WIDTH;
  const clampedY = clamp(Math.round(y), 0, MODERN_CITY_LIGHTS_GRID_HEIGHT - 1);
  return MODERN_CITY_LIGHTS_GRID[(clampedY * MODERN_CITY_LIGHTS_GRID_WIDTH) + wrappedX] || 0;
}

function sampleModernCityLightsGridNormalized(lon, lat) {
  if (!MODERN_CITY_LIGHTS_GRID?.length) return 0;
  const normalizedLon = (
    (normalizeLongitude(lon) + 180) / Math.max(MODERN_CITY_LIGHTS_STEP_LON_DEG, 0.0001)
  ) - 0.5;
  const normalizedLat = clamp(
    ((90 - clamp(lat, -89.999, 89.999)) / Math.max(MODERN_CITY_LIGHTS_STEP_LAT_DEG, 0.0001)) - 0.5,
    0,
    MODERN_CITY_LIGHTS_GRID_HEIGHT - 1
  );
  const x0 = Math.floor(normalizedLon);
  const y0 = Math.floor(normalizedLat);
  const tx = normalizedLon - x0;
  const ty = normalizedLat - y0;
  const y1 = Math.min(MODERN_CITY_LIGHTS_GRID_HEIGHT - 1, y0 + 1);
  const v00 = getModernCityLightsGridValue(x0, y0);
  const v10 = getModernCityLightsGridValue(x0 + 1, y0);
  const v01 = getModernCityLightsGridValue(x0, y1);
  const v11 = getModernCityLightsGridValue(x0 + 1, y1);
  const top = v00 + ((v10 - v00) * tx);
  const bottom = v01 + ((v11 - v01) * tx);
  return clamp((top + ((bottom - top) * ty)) / 255, 0, 1);
}

function getFeatureGeoCentroid(feature) {
  if (!feature || !globalThis.d3?.geoCentroid) return null;
  const cached = urbanGeoCentroidCache.get(feature);
  if (cached) return cached;
  const centroid = globalThis.d3.geoCentroid(feature);
  const longitude = Number(centroid?.[0]);
  const latitude = Number(centroid?.[1]);
  if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
    return null;
  }
  const normalized = [normalizeLongitude(longitude), clamp(latitude, -89.999, 89.999)];
  urbanGeoCentroidCache.set(feature, normalized);
  return normalized;
}

function getModernCityLightsGeometry() {
  const projectionKey = getModernCityLightsProjectionKey();
  if (
    modernCityLightsGeometryCache.projectionKey === projectionKey &&
    Array.isArray(modernCityLightsGeometryCache.baseEntries) &&
    modernCityLightsGeometryCache.baseEntries.length
  ) {
    return modernCityLightsGeometryCache;
  }

  const baseEntries = [];
  const corridorEntries = [];
  const halfLon = MODERN_CITY_LIGHTS_STEP_LON_DEG * 0.5;
  const halfLat = MODERN_CITY_LIGHTS_STEP_LAT_DEG * 0.5;

  for (let y = 0; y < MODERN_CITY_LIGHTS_GRID_HEIGHT; y += 1) {
    const lat = 90 - ((y + 0.5) * MODERN_CITY_LIGHTS_STEP_LAT_DEG);
    for (let x = 0; x < MODERN_CITY_LIGHTS_GRID_WIDTH; x += 1) {
      const value = MODERN_CITY_LIGHTS_GRID[(y * MODERN_CITY_LIGHTS_GRID_WIDTH) + x] || 0;
      if (value < MODERN_CITY_LIGHTS_BASE_THRESHOLD) continue;

      const lon = -180 + ((x + 0.5) * MODERN_CITY_LIGHTS_STEP_LON_DEG);
      const center = projection ? projection([lon, lat]) : null;
      const east = projection ? projection([normalizeLongitude(lon + halfLon), lat]) : null;
      const west = projection ? projection([normalizeLongitude(lon - halfLon), lat]) : null;
      const north = projection ? projection([lon, clamp(lat + halfLat, -89.999, 89.999)]) : null;
      const south = projection ? projection([lon, clamp(lat - halfLat, -89.999, 89.999)]) : null;
      if (
        !Array.isArray(center) ||
        !Array.isArray(east) ||
        !Array.isArray(west) ||
        !Array.isArray(north) ||
        !Array.isArray(south)
      ) {
        continue;
      }
      const values = [...center, ...east, ...west, ...north, ...south];
      if (!values.every((entry) => Number.isFinite(Number(entry)))) continue;

      const ewDx = east[0] - west[0];
      const ewDy = east[1] - west[1];
      const nsDx = north[0] - south[0];
      const nsDy = north[1] - south[1];
      const rx = Math.hypot(ewDx, ewDy) * 0.5;
      const ry = Math.hypot(nsDx, nsDy) * 0.5;
      if (!Number.isFinite(rx) || !Number.isFinite(ry) || rx <= 0.02 || ry <= 0.02 || rx > 12 || ry > 12) {
        continue;
      }

      const entry = {
        x: center[0],
        y: center[1],
        rx,
        ry,
        rotation: Math.atan2(ewDy, ewDx),
        value,
      };
      baseEntries.push(entry);
      if (value >= MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD) {
        corridorEntries.push(entry);
      }
    }
  }

  modernCityLightsGeometryCache.projectionKey = projectionKey;
  modernCityLightsGeometryCache.baseEntries = baseEntries;
  modernCityLightsGeometryCache.corridorEntries = corridorEntries;
  return modernCityLightsGeometryCache;
}

function shouldCullModernLightEntry(entry, overscan = 48) {
  const transform = state.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
  const screenX = (entry.x * transform.k) + transform.x;
  const screenY = (entry.y * transform.k) + transform.y;
  return (
    screenX < -overscan ||
    screenX > state.width + overscan ||
    screenY < -overscan ||
    screenY > state.height + overscan
  );
}

function drawLightEllipse(x, y, rx, ry, rotation = 0) {
  if (typeof context.ellipse === "function") {
    context.beginPath();
    context.ellipse(x, y, rx, ry, rotation, 0, Math.PI * 2);
    context.fill();
    return;
  }
  context.save();
  context.translate(x, y);
  context.rotate(rotation);
  context.scale(Math.max(rx, 0.0001), Math.max(ry, 0.0001));
  context.beginPath();
  context.arc(0, 0, 1, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function drawModernCityLightsTexture(config, intensity) {
  const textureOpacity = clamp(Number(config.cityLightsTextureOpacity) || 0, 0, 1);
  if (textureOpacity <= 0) return;
  const palette = getNightLightPalette("modern");
  const geometry = getModernCityLightsGeometry();
  const overscan = Math.max(32, Math.min(state.width, state.height) * 0.06);
  context.fillStyle = palette.texture;

  geometry.baseEntries.forEach((entry) => {
    if (shouldCullModernLightEntry(entry, overscan)) return;
    const normalized = clamp(entry.value / 255, 0, 1);
    const lumaWeight = Math.pow(normalized, 0.66);
    const alpha = clamp(intensity * textureOpacity * (0.01 + (lumaWeight * 0.2)), 0, 0.2);
    if (alpha <= 0.002) return;
    context.globalAlpha = alpha;
    drawLightEllipse(
      entry.x,
      entry.y,
      entry.rx * (1.02 + (lumaWeight * 0.72)),
      entry.ry * (1.02 + (lumaWeight * 0.72)),
      0
    );
  });
}

function drawModernCityLightsCorridors(config, intensity) {
  const corridorStrength = clamp(Number(config.cityLightsCorridorStrength) || 0, 0, 1);
  if (corridorStrength <= 0) return;
  const palette = getNightLightPalette("modern");
  const geometry = getModernCityLightsGeometry();
  const overscan = Math.max(40, Math.min(state.width, state.height) * 0.08);
  context.fillStyle = palette.corridor;

  geometry.corridorEntries.forEach((entry) => {
    if (shouldCullModernLightEntry(entry, overscan)) return;
    const normalized = clamp(entry.value / 255, 0, 1);
    const corridorWeight = Math.pow(normalized, 0.82);
    const alpha = clamp(intensity * corridorStrength * (0.008 + (corridorWeight * 0.1)), 0, 0.14);
    if (alpha <= 0.003) return;
    context.globalAlpha = alpha;
    drawLightEllipse(
      entry.x,
      entry.y,
      entry.rx * (0.94 + (corridorStrength * 0.26) + (corridorWeight * 0.22)),
      entry.ry * (0.72 + (corridorStrength * 0.12)),
      0
    );
  });
}

function drawModernCityLightsCores(k, config, intensity) {
  if (!Array.isArray(state.urbanData?.features) || !state.urbanData.features.length) return;
  const palette = getNightLightPalette("modern");
  const textureOpacity = clamp(Number(config.cityLightsTextureOpacity) || 0, 0, 1);
  const coreSharpness = clamp(Number(config.cityLightsCoreSharpness) || 0, 0, 1);
  const zoomScale = Math.max(0.0001, Number(state.zoomTransform?.k || 1));
  const minProjectedAreaPx = zoomScale <= 1.15 ? 4.6 : zoomScale <= 1.7 ? 3.2 : 2.2;
  const overscan = Math.max(32, Math.min(state.width, state.height) * 0.06);

  state.urbanData.features.forEach((feature) => {
    if (!pathBoundsInScreen(feature)) return;
    if (estimateProjectedAreaPx(feature, k) < minProjectedAreaPx) return;

    const heuristicWeight = getUrbanLightWeight(feature, "modern");
    if (heuristicWeight <= 0) return;
    if (zoomScale <= 1.15 && heuristicWeight < 0.72) return;

    const geographicCentroid = getFeatureGeoCentroid(feature);
    const sample = geographicCentroid
      ? sampleModernCityLightsGridNormalized(geographicCentroid[0], geographicCentroid[1])
      : 0;
    const sampledBoost = clamp(0.28 + (Math.pow(sample, 0.58) * 1.45), 0.22, 1.6);
    const weight = clamp(heuristicWeight * sampledBoost, 0.04, 1.22);
    if (sample <= 0.01 && heuristicWeight < 0.34) return;
    if (weight < 0.16) return;
    if (zoomScale <= 1.35 && weight < 0.44) return;

    const centroid = pathCanvas.centroid(feature);
    const cx = Number(centroid?.[0]);
    const cy = Number(centroid?.[1]);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

    const screenX = (cx * state.zoomTransform.k) + state.zoomTransform.x;
    const screenY = (cy * state.zoomTransform.k) + state.zoomTransform.y;
    if (
      screenX < -overscan ||
      screenX > state.width + overscan ||
      screenY < -overscan ||
      screenY > state.height + overscan
    ) {
      return;
    }

    const orientation = (stringHash(
      feature?.properties?.nameascii ||
      feature?.properties?.name ||
      feature?.properties?.NAME ||
      feature?.id ||
      `${cx}:${cy}`
    ) % 180) * (Math.PI / 180);
    const baseRadiusPx = 0.48 + (weight * (0.74 + (coreSharpness * 0.74)));
    const stretch = 1.08 + (coreSharpness * 0.52) + (sample * 0.36);
    const haloAlpha = clamp(intensity * weight * (0.03 + (textureOpacity * 0.05) + (sample * 0.06)), 0, 0.18);
    const coreAlpha = clamp(intensity * weight * (0.12 + (coreSharpness * 0.18) + (sample * 0.18)), 0, 0.48);
    const glintAlpha = zoomScale < 1.45
      ? 0
      : clamp(intensity * weight * (0.03 + (sample * 0.08)), 0, 0.16);
    const offsetPx = baseRadiusPx * (0.22 + (sample * 0.28));
    const offsetX = (Math.cos(orientation) * offsetPx) / Math.max(0.0001, k);
    const offsetY = (Math.sin(orientation) * offsetPx) / Math.max(0.0001, k);

    context.fillStyle = palette.halo;
    context.globalAlpha = haloAlpha;
    drawLightEllipse(
      cx,
      cy,
      (baseRadiusPx * stretch * 1.45) / Math.max(0.0001, k),
      (baseRadiusPx * 0.74) / Math.max(0.0001, k),
      orientation
    );

    context.fillStyle = palette.core;
    context.globalAlpha = coreAlpha;
    drawLightEllipse(
      cx,
      cy,
      (baseRadiusPx * stretch) / Math.max(0.0001, k),
      (baseRadiusPx * 0.5) / Math.max(0.0001, k),
      orientation
    );

    context.fillStyle = palette.glint;
    context.globalAlpha = glintAlpha;
    drawLightEllipse(
      cx + offsetX,
      cy + offsetY,
      (baseRadiusPx * 0.6) / Math.max(0.0001, k),
      (baseRadiusPx * 0.24) / Math.max(0.0001, k),
      orientation
    );
  });
}

function drawModernNightLightsLayer(k, config, solarState) {
  const nightHemisphere = buildNightHemisphereFeature(solarState, 90);
  if (!nightHemisphere) return;
  const intensity = clamp(Number(config.cityLightsIntensity) || 0, 0, 1.2);
  if (intensity <= 0) return;

  context.save();
  context.beginPath();
  pathCanvas(nightHemisphere);
  context.clip();
  context.globalCompositeOperation = getSafeBlendMode("screen", "lighter");
  drawModernCityLightsTexture(config, intensity);
  drawModernCityLightsCorridors(config, intensity);
  drawModernCityLightsCores(k, config, intensity);
  context.restore();
}

function drawHistoricalNightLightsLayer(k, config, solarState) {
  if (!Array.isArray(state.urbanData?.features) || !state.urbanData.features.length) {
    return;
  }
  const nightHemisphere = buildNightHemisphereFeature(solarState, 90);
  if (!nightHemisphere) return;

  const variant = "historical_1930s";
  const intensity = clamp(Number(config.cityLightsIntensity) || 0, 0, 1.2);
  if (intensity <= 0) return;
  const palette = getNightLightPalette(variant);
  const minProjectedAreaPx = 2.8;
  const overscan = Math.max(24, Math.min(state.width, state.height) * 0.05);

  context.save();
  context.beginPath();
  pathCanvas(nightHemisphere);
  context.clip();
  context.globalCompositeOperation = getSafeBlendMode("screen", "lighter");

  state.urbanData.features.forEach((feature) => {
    if (!pathBoundsInScreen(feature)) return;
    if (estimateProjectedAreaPx(feature, k) < minProjectedAreaPx) return;

    const weight = getUrbanLightWeight(feature, variant);
    if (weight <= 0) return;

    const centroid = pathCanvas.centroid(feature);
    const cx = Number(centroid?.[0]);
    const cy = Number(centroid?.[1]);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

    const screenX = (cx * state.zoomTransform.k) + state.zoomTransform.x;
    const screenY = (cy * state.zoomTransform.k) + state.zoomTransform.y;
    if (
      screenX < -overscan ||
      screenX > state.width + overscan ||
      screenY < -overscan ||
      screenY > state.height + overscan
    ) {
      return;
    }

    const baseRadiusPx = 0.76 + (weight * 1.55);
    const haloRadiusPx = baseRadiusPx * 1.44;
    const haloAlpha = clamp(intensity * weight * 0.14, 0, 0.24);
    const coreAlpha = clamp(intensity * weight * 0.28, 0, 0.52);
    const orientation = (stringHash(
      feature?.properties?.nameascii ||
      feature?.properties?.name ||
      feature?.properties?.NAME ||
      feature?.id ||
      `${cx}:${cy}`
    ) % 180) * (Math.PI / 180);

    context.fillStyle = palette.halo;
    context.globalAlpha = haloAlpha;
    drawLightEllipse(
      cx,
      cy,
      (haloRadiusPx * 1.12) / Math.max(0.0001, k),
      (haloRadiusPx * 0.74) / Math.max(0.0001, k),
      orientation
    );

    context.fillStyle = palette.core;
    context.globalAlpha = coreAlpha;
    drawLightEllipse(
      cx,
      cy,
      baseRadiusPx / Math.max(0.0001, k),
      (baseRadiusPx * 0.58) / Math.max(0.0001, k),
      orientation
    );
  });

  context.restore();
}

function drawDayNightShadowLayer(_k, config, solarState) {
  const twilightBand = buildNightHemisphereFeature(solarState, 90);
  if (!twilightBand) return;
  const coreRadius = clamp(90 - Number(config.twilightWidthDeg || 10), 56, 89);
  const nightCore = buildNightHemisphereFeature(solarState, coreRadius);

  context.save();
  context.globalCompositeOperation = "source-over";

  context.fillStyle = "#24374c";
  context.globalAlpha = clamp(config.shadowOpacity * 0.5, 0, 0.5);
  context.beginPath();
  pathCanvas(twilightBand);
  context.fill();

  if (nightCore) {
    context.fillStyle = "#081423";
    context.globalAlpha = clamp(config.shadowOpacity, 0, 0.85);
    context.beginPath();
    pathCanvas(nightCore);
    context.fill();
  }

  context.strokeStyle = "#8aa1ba";
  context.globalAlpha = clamp(config.shadowOpacity * 0.28, 0, 0.24);
  context.lineWidth = 1.1 / Math.max(0.0001, Number(state.zoomTransform?.k || 1));
  context.beginPath();
  pathCanvas(twilightBand);
  context.stroke();

  context.restore();
}

function drawNightLightsLayer(k, config, solarState) {
  if (!config.cityLightsEnabled) {
    return;
  }
  const variant = String(config.cityLightsStyle || "modern").trim().toLowerCase();
  if (variant === "modern") {
    drawModernNightLightsLayer(k, config, solarState);
    return;
  }
  drawHistoricalNightLightsLayer(k, config, solarState);
}

function ensureDayNightClockTimer() {
  if (dayNightClockTimerId) return;
  lastDayNightClockToken = getDayNightLiveClockToken();
  dayNightClockTimerId = globalThis.setInterval(() => {
    const config = getDayNightStyleConfig();
    const nextToken = getDayNightLiveClockToken(config);
    if (nextToken === lastDayNightClockToken) return;
    lastDayNightClockToken = nextToken;
    if (typeof state.updateToolbarInputsFn === "function") {
      state.updateToolbarInputsFn();
    }
    if (!config.enabled) return;
    invalidateRenderPasses("dayNight", "day-night-clock");
    if (typeof state.renderNowFn === "function") {
      state.renderNowFn();
    } else if (context) {
      render();
    }
  }, DAY_NIGHT_CLOCK_INTERVAL_MS);
}

function resolvePaperTextureAssetUrl(assetId) {
  return PAPER_TEXTURE_ASSET_URLS[String(assetId || "").trim()] || null;
}

function ensureTextureAssetImage(assetId) {
  const normalizedId = String(assetId || "").trim();
  if (!normalizedId) return null;
  const existing = textureAssetCache.get(normalizedId);
  if (existing) {
    return existing.status === "ready" ? existing.image : null;
  }
  const url = resolvePaperTextureAssetUrl(normalizedId);
  if (!url) return null;

  const image = new Image();
  const entry = {
    status: "loading",
    image,
    url,
  };
  textureAssetCache.set(normalizedId, entry);
  image.decoding = "async";
  image.onload = () => {
    entry.status = "ready";
    texturePatternCache.clear();
    requestTextureRerender();
  };
  image.onerror = () => {
    entry.status = "error";
  };
  image.src = url;
  return null;
}

function createSeededRandom(seedInput) {
  let seed = Number(seedInput) || 1;
  return () => {
    seed |= 0;
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getTexturePattern(source, cacheKey, scale = 1) {
  if (!context || !source || !cacheKey) return null;
  const normalizedScale = clamp(Number(scale) || 1, 0.25, 4);
  const key = `${cacheKey}|${normalizedScale.toFixed(3)}`;
  const cached = texturePatternCache.get(key);
  if (cached) return cached;

  const pattern = context.createPattern(source, "repeat");
  if (!pattern) return null;
  if (pattern.setTransform && globalThis.DOMMatrix) {
    const matrix = new globalThis.DOMMatrix();
    matrix.scaleSelf(normalizedScale, normalizedScale);
    pattern.setTransform(matrix);
  }
  texturePatternCache.set(key, pattern);
  return pattern;
}

function getPaperNoiseTile(paperConfig) {
  const scaleBucket = Math.round((paperConfig?.scale || 1) * 100);
  const grainBucket = Math.round((paperConfig?.grain || 0) * 100);
  const wearBucket = Math.round((paperConfig?.wear || 0) * 100);
  const warmthBucket = Math.round((paperConfig?.warmth || 0) * 100);
  const key = `${scaleBucket}|${grainBucket}|${wearBucket}|${warmthBucket}`;
  const cached = textureNoiseTileCache.get(key);
  if (cached) return cached;

  const tile = document.createElement("canvas");
  tile.width = PAPER_NOISE_TILE_SIZE;
  tile.height = PAPER_NOISE_TILE_SIZE;
  const tileCtx = tile.getContext("2d");
  if (!tileCtx) return null;

  const rng = createSeededRandom(scaleBucket * 17 + grainBucket * 29 + wearBucket * 43 + warmthBucket * 59);
  tileCtx.clearRect(0, 0, tile.width, tile.height);

  const speckCount = Math.round(900 + grainBucket * 14);
  for (let index = 0; index < speckCount; index += 1) {
    const alpha = 0.012 + rng() * 0.03;
    const shade = Math.round(88 + rng() * 70);
    tileCtx.fillStyle = `rgba(${shade}, ${shade - 6}, ${Math.max(24, shade - 22)}, ${alpha})`;
    const x = rng() * tile.width;
    const y = rng() * tile.height;
    const size = rng() < 0.82 ? 1 : 2 + rng() * 1.8;
    tileCtx.fillRect(x, y, size, size);
  }

  const fiberCount = Math.round(260 + grainBucket * 2.6);
  tileCtx.lineCap = "round";
  for (let index = 0; index < fiberCount; index += 1) {
    const x = rng() * tile.width;
    const y = rng() * tile.height;
    const length = 4 + rng() * 12;
    const angle = rng() * Math.PI * 2;
    tileCtx.strokeStyle = `rgba(98, 74, 52, ${0.018 + rng() * 0.025})`;
    tileCtx.lineWidth = 0.35 + rng() * 0.8;
    tileCtx.beginPath();
    tileCtx.moveTo(x, y);
    tileCtx.lineTo(x + Math.cos(angle) * length, y + Math.sin(angle) * length);
    tileCtx.stroke();
  }

  const stainCount = Math.round(10 + wearBucket * 0.1);
  for (let index = 0; index < stainCount; index += 1) {
    const radius = 12 + rng() * 26;
    const x = rng() * tile.width;
    const y = rng() * tile.height;
    const gradient = tileCtx.createRadialGradient(x, y, radius * 0.12, x, y, radius);
    gradient.addColorStop(0, `rgba(128, 92, 54, ${0.022 + rng() * 0.028})`);
    gradient.addColorStop(1, "rgba(128, 92, 54, 0)");
    tileCtx.fillStyle = gradient;
    tileCtx.beginPath();
    tileCtx.arc(x, y, radius, 0, Math.PI * 2);
    tileCtx.fill();
  }

  if (warmthBucket > 0) {
    tileCtx.fillStyle = `rgba(171, 132, 78, ${0.02 + warmthBucket / 5500})`;
    tileCtx.fillRect(0, 0, tile.width, tile.height);
  }

  textureNoiseTileCache.set(key, tile);
  return tile;
}

function withTextureSphereClip(shouldClip, drawFn) {
  if (!context || !pathCanvas || typeof drawFn !== "function") return;
  context.save();
  if (shouldClip) {
    context.beginPath();
    pathCanvas({ type: "Sphere" });
    context.clip();
  }
  drawFn();
  context.restore();
}

function buildTextureAxisValues(limit, step) {
  const values = [];
  const safeStep = Math.max(1, Number(step) || 1);
  for (let value = -limit + safeStep; value < limit; value += safeStep) {
    values.push(Number(value.toFixed(6)));
  }
  return values;
}

function shouldIncludeTextureLabel(value, step) {
  const normalizedStep = Math.max(1, Number(step) || 1);
  return Math.abs(value / normalizedStep - Math.round(value / normalizedStep)) < 1e-6;
}

function formatLongitudeLabel(value) {
  const abs = Math.round(Math.abs(value));
  if (abs === 0) return "0°";
  return `${abs}°${value < 0 ? "W" : "E"}`;
}

function formatLatitudeLabel(value) {
  const abs = Math.round(Math.abs(value));
  if (abs === 0) return "0°";
  return `${abs}°${value < 0 ? "S" : "N"}`;
}

function buildTextureLine(kind, fixedValue, rotatePoint, label = "") {
  const coordinates = [];
  if (kind === "meridian") {
    for (let lat = -89.5; lat <= 89.5; lat += GRATICULE_SAMPLE_DEGREES) {
      coordinates.push(rotatePoint([fixedValue, lat]));
    }
    coordinates.push(rotatePoint([fixedValue, 89.5]));
  } else {
    for (let lon = -180; lon <= 180; lon += GRATICULE_SAMPLE_DEGREES) {
      coordinates.push(rotatePoint([lon, fixedValue]));
    }
    coordinates.push(rotatePoint([180, fixedValue]));
  }
  return {
    kind,
    value: fixedValue,
    label,
    geometry: {
      type: "LineString",
      coordinates,
    },
  };
}

function buildTextureGraticuleGeometry(cacheKey, {
  majorStep,
  minorStep,
  labelStep,
  rotation = [0, 0, 0],
  includeLabels = true,
} = {}) {
  const cached = textureGeometryCache.get(cacheKey);
  if (cached) return cached;
  const rotatePoint = globalThis.d3?.geoRotation ? globalThis.d3.geoRotation(rotation) : ((point) => point);
  const geometry = {
    majorLines: [],
    minorLines: [],
  };
  const majorMeridians = new Set(buildTextureAxisValues(180, majorStep).map((value) => value.toFixed(6)));
  const majorParallels = new Set(buildTextureAxisValues(90, majorStep).map((value) => value.toFixed(6)));

  buildTextureAxisValues(180, majorStep).forEach((value) => {
    geometry.majorLines.push(
      buildTextureLine(
        "meridian",
        value,
        rotatePoint,
        includeLabels && shouldIncludeTextureLabel(value, labelStep) ? formatLongitudeLabel(value) : ""
      )
    );
  });
  buildTextureAxisValues(90, majorStep).forEach((value) => {
    geometry.majorLines.push(
      buildTextureLine(
        "parallel",
        value,
        rotatePoint,
        includeLabels && shouldIncludeTextureLabel(value, labelStep) ? formatLatitudeLabel(value) : ""
      )
    );
  });

  if (minorStep < majorStep) {
    buildTextureAxisValues(180, minorStep).forEach((value) => {
      if (majorMeridians.has(value.toFixed(6))) return;
      geometry.minorLines.push(buildTextureLine("meridian", value, rotatePoint));
    });
    buildTextureAxisValues(90, minorStep).forEach((value) => {
      if (majorParallels.has(value.toFixed(6))) return;
      geometry.minorLines.push(buildTextureLine("parallel", value, rotatePoint));
    });
  }

  textureGeometryCache.set(cacheKey, geometry);
  return geometry;
}

function getTextureLineAnchor(line) {
  if (!projection || !Array.isArray(line?.geometry?.coordinates)) return null;
  let best = null;
  line.geometry.coordinates.forEach((coordinate) => {
    const projected = projection(coordinate);
    if (!projected || projected.length < 2 || !projected.every(Number.isFinite)) return;
    const [x, y] = projected;
    if (line.kind === "meridian") {
      if (!best || y < best.y) {
        best = { x, y, align: "center", baseline: "top", offsetX: 0, offsetY: 8 };
      }
    } else if (!best || x < best.x) {
      best = { x, y, align: "left", baseline: "middle", offsetX: 8, offsetY: 0 };
    }
  });
  return best;
}

function drawTextureLabels(lines, config, k, opacity) {
  if (!context || !Array.isArray(lines) || !lines.length) return;
  const occupied = [];
  const minDistance = 34 / Math.max(0.8, k);
  const fontSize = clamp((Number(config.labelSize) || 11) / Math.max(0.75, k), 8, 18);

  context.save();
  context.fillStyle = getSafeCanvasColor(config.labelColor, "#475569");
  context.globalAlpha = clamp(opacity, 0, 1);
  context.font = `${fontSize}px ${TEXTURE_LABEL_SERIF_STACK}`;
  context.shadowColor = "rgba(255,255,255,0.8)";
  context.shadowBlur = 5 / Math.max(0.85, k);

  lines.forEach((line) => {
    if (!line?.label) return;
    const anchor = getTextureLineAnchor(line);
    if (!anchor) return;
    const x = anchor.x + anchor.offsetX / Math.max(0.8, k);
    const y = anchor.y + anchor.offsetY / Math.max(0.8, k);
    const overlaps = occupied.some((point) => Math.hypot(point.x - x, point.y - y) < minDistance);
    if (overlaps) return;
    occupied.push({ x, y });
    context.textAlign = anchor.align;
    context.textBaseline = anchor.baseline;
    context.fillText(line.label, x, y);
  });

  context.restore();
}

function drawOldPaperTexture(k, { interactive = false } = {}) {
  if (!context || !pathCanvas || !pathSVG) return;
  const texture = getTextureStyleConfig();
  const paper = texture.paper || {};
  const assetImage = ensureTextureAssetImage(paper.assetId);
  const noiseTile = getPaperNoiseTile(paper);
  const sphereBounds = pathSVG.bounds({ type: "Sphere" });
  const minX = sphereBounds?.[0]?.[0] || 0;
  const minY = sphereBounds?.[0]?.[1] || 0;
  const maxX = sphereBounds?.[1]?.[0] || state.width;
  const maxY = sphereBounds?.[1]?.[1] || state.height;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const radius = Math.max(maxX - minX, maxY - minY) * 0.58;

  withTextureSphereClip(texture.sphereClip, () => {
    context.save();
    context.globalCompositeOperation = "multiply";
    context.globalAlpha = clamp(texture.opacity * (0.24 + paper.warmth * 0.22), 0, interactive ? 0.28 : 0.42);
    context.fillStyle = `rgba(205, 182, 138, ${0.42 + paper.warmth * 0.18})`;
    context.beginPath();
    pathCanvas({ type: "Sphere" });
    context.fill();

    if (assetImage) {
      const assetPattern = getTexturePattern(assetImage, `paper-asset:${paper.assetId}`, paper.scale);
      if (assetPattern) {
        context.globalCompositeOperation = getSafeBlendMode(paper.blendMode, "multiply");
        context.globalAlpha = clamp(texture.opacity * (interactive ? 0.15 : 0.34), 0, 0.42);
        context.fillStyle = assetPattern;
        context.beginPath();
        pathCanvas({ type: "Sphere" });
        context.fill();
      }
    }

    if (noiseTile) {
      const noisePattern = getTexturePattern(
        noiseTile,
        `paper-noise:${Math.round(paper.grain * 100)}:${Math.round(paper.wear * 100)}:${Math.round(paper.warmth * 100)}`,
        paper.scale * 0.88
      );
      if (noisePattern) {
        context.globalCompositeOperation = "multiply";
        context.globalAlpha = clamp(texture.opacity * (0.22 + paper.grain * 0.3 + paper.wear * 0.22), 0, interactive ? 0.24 : 0.48);
        context.fillStyle = noisePattern;
        context.beginPath();
        pathCanvas({ type: "Sphere" });
        context.fill();
      }
    }

    const vignette = context.createRadialGradient(
      centerX,
      centerY,
      radius * 0.24,
      centerX,
      centerY,
      radius * 1.06
    );
    vignette.addColorStop(0, "rgba(88, 62, 34, 0)");
    vignette.addColorStop(1, `rgba(88, 62, 34, ${0.18 + paper.vignette * 0.42})`);
    context.globalCompositeOperation = "multiply";
    context.globalAlpha = clamp(texture.opacity * (0.14 + paper.vignette * 0.65), 0, 0.32);
    context.fillStyle = vignette;
    context.fillRect(minX - 24, minY - 24, maxX - minX + 48, maxY - minY + 48);
    context.restore();
  });
}

function drawProjectedTextureLines(lines, {
  color = "#64748b",
  width = 1,
  opacity = 0.2,
  dash = [],
  k = 1,
} = {}) {
  if (!context || !pathCanvas || !Array.isArray(lines) || !lines.length) return;
  context.save();
  context.strokeStyle = getSafeCanvasColor(color, "#64748b");
  context.globalAlpha = clamp(opacity, 0, 1);
  context.lineWidth = clamp(Number(width) || 1, 0.1, 4) / Math.max(0.0001, k);
  context.setLineDash(Array.isArray(dash) ? dash : []);
  lines.forEach((line) => {
    if (!line?.geometry) return;
    context.beginPath();
    pathCanvas(line.geometry);
    context.stroke();
  });
  context.restore();
}

function drawGraticuleTexture(k, { interactive = false } = {}) {
  const texture = getTextureStyleConfig();
  const config = texture.graticule || {};
  const cacheKey = [
    "graticule",
    config.majorStep,
    config.minorStep,
    config.labelStep,
    config.majorWidth,
    config.minorWidth,
  ].join("|");
  const geometry = buildTextureGraticuleGeometry(cacheKey, {
    majorStep: config.majorStep,
    minorStep: config.minorStep,
    labelStep: config.labelStep,
    includeLabels: true,
  });

  withTextureSphereClip(texture.sphereClip, () => {
    drawProjectedTextureLines(geometry.minorLines, {
      color: config.color,
      width: config.minorWidth,
      opacity: texture.opacity * config.minorOpacity * (interactive ? 0.9 : 1),
      k,
    });
    drawProjectedTextureLines(geometry.majorLines, {
      color: config.color,
      width: config.majorWidth,
      opacity: texture.opacity * config.majorOpacity,
      k,
    });
    drawTextureLabels(
      geometry.majorLines,
      config,
      k,
      texture.opacity * clamp(config.majorOpacity * 1.18, 0, 0.6)
    );
  });
}

function drawDraftGridTexture(k, { interactive = false } = {}) {
  const texture = getTextureStyleConfig();
  const config = texture.draftGrid || {};
  const cacheKey = [
    "draft-grid",
    config.majorStep,
    config.minorStep,
    Math.round(config.lonOffset),
    Math.round(config.latOffset),
    Math.round(config.roll),
  ].join("|");
  const geometry = buildTextureGraticuleGeometry(cacheKey, {
    majorStep: config.majorStep,
    minorStep: config.minorStep,
    labelStep: 999,
    rotation: [config.lonOffset, config.latOffset, config.roll],
    includeLabels: false,
  });
  const majorDash = getDashPattern(config.dash || "dashed", Number(config.width) || 1);
  const minorDash = config.dash === "solid"
    ? []
    : getDashPattern(config.dash || "dashed", Math.max(0.5, (Number(config.width) || 1) * 0.75));
  const drawMinor = !interactive || k > 1.15;

  withTextureSphereClip(texture.sphereClip, () => {
    if (drawMinor) {
      drawProjectedTextureLines(geometry.minorLines, {
        color: config.color,
        width: Math.max(0.22, (Number(config.width) || 1) * 0.68),
        opacity: texture.opacity * config.minorOpacity,
        dash: minorDash,
        k,
      });
    }
    drawProjectedTextureLines(geometry.majorLines, {
      color: config.color,
      width: config.width,
      opacity: texture.opacity * config.majorOpacity,
      dash: majorDash,
      k,
    });
  });
}

function drawTextureLayer(k, { interactive = false } = {}) {
  const texture = getTextureStyleConfig();
  const mode = String(texture.mode || "none").trim().toLowerCase();
  if (mode === "none") return;
  if (mode === "paper") {
    drawOldPaperTexture(k, { interactive });
    return;
  }
  if (mode === "graticule") {
    drawGraticuleTexture(k, { interactive });
    return;
  }
  if (mode === "draft_grid") {
    drawDraftGridTexture(k, { interactive });
  }
}

function shouldUseScenarioPoliticalBackgroundMerge() {
  return Boolean(
    debugMode === "PROD" &&
    state.activeScenarioId &&
    state.runtimePoliticalTopology?.objects?.political &&
    globalThis.topojson?.merge
  );
}

function shouldSkipScenarioPoliticalBackgroundMergeShape(
  mergedShape,
  { displayCode = "", fillColor = "", groupSize = 0 } = {}
) {
  const scenarioId = String(state.activeScenarioId || "").trim();
  const geoAreaFn = globalThis.d3?.geoArea;
  const geoBoundsFn = globalThis.d3?.geoBounds;
  if (typeof geoAreaFn !== "function") {
    return false;
  }
  let area = Number.NaN;
  let bounds = null;
  try {
    area = geoAreaFn(mergedShape);
    bounds = typeof geoBoundsFn === "function" ? geoBoundsFn(mergedShape) : null;
  } catch (_error) {
    area = Number.NaN;
    bounds = null;
  }
  const suspicious =
    !Number.isFinite(area) ||
    area > SCENARIO_BACKGROUND_MERGE_MAX_AREA ||
    isWorldBounds(bounds);
  if (!suspicious) {
    return false;
  }
  const viewMode = String(state.scenarioViewMode || "ownership");
  const logKey = `${scenarioId}::${viewMode}::${displayCode}::${fillColor}`;
  if (!suspiciousScenarioBackgroundMergeWarnings.has(logKey)) {
    suspiciousScenarioBackgroundMergeWarnings.add(logKey);
    const areaText = Number.isFinite(area) ? area.toFixed(5) : "non-finite";
    console.warn(
      `[map_renderer] Skipping suspicious scenario political background merge: scenario=${scenarioId || "(none)"} view=${viewMode} owner=${displayCode || "(unknown)"} fill=${fillColor || "(none)"} group=${groupSize} area=${areaText}`
    );
  }
  return true;
}

function buildScenarioPoliticalBackgroundEntries() {
  const startedAt = nowMs();
  if (!shouldUseScenarioPoliticalBackgroundMerge()) {
    recordRenderPerfMetric("drawScenarioPoliticalBackgroundEntries", nowMs() - startedAt, {
      cacheHit: false,
      entryCount: 0,
      featureCount: 0,
      skipped: true,
    });
    return [];
  }

  const topology = state.runtimePoliticalTopology;
  const landCollection = state.landData;
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  const featureCount = Array.isArray(landCollection?.features) ? landCollection.features.length : 0;
  const cacheMatches =
    scenarioPoliticalBackgroundCache.topologyRef === topology &&
    scenarioPoliticalBackgroundCache.landCollectionRef === landCollection &&
    scenarioPoliticalBackgroundCache.scenarioId === state.activeScenarioId &&
    scenarioPoliticalBackgroundCache.viewMode === String(state.scenarioViewMode || "ownership") &&
    scenarioPoliticalBackgroundCache.oceanFillColor === getAtlantropaSeaPoliticalFillColor() &&
    scenarioPoliticalBackgroundCache.topologyRevision === Number(state.topologyRevision || 0) &&
    scenarioPoliticalBackgroundCache.colorRevision === Number(state.colorRevision || 0) &&
    scenarioPoliticalBackgroundCache.sovereigntyRevision === Number(state.sovereigntyRevision || 0) &&
    scenarioPoliticalBackgroundCache.controllerRevision === Number(state.scenarioControllerRevision || 0) &&
    scenarioPoliticalBackgroundCache.shellRevision === Number(state.scenarioShellOverlayRevision || 0) &&
    scenarioPoliticalBackgroundCache.canvasWidth === canvasWidth &&
    scenarioPoliticalBackgroundCache.canvasHeight === canvasHeight &&
    scenarioPoliticalBackgroundCache.featureCount === featureCount;
  if (cacheMatches) {
    recordRenderPerfMetric("drawScenarioPoliticalBackgroundEntries", nowMs() - startedAt, {
      cacheHit: true,
      entryCount: scenarioPoliticalBackgroundCache.entries.length,
      featureCount,
    });
    return scenarioPoliticalBackgroundCache.entries;
  }

  const includedFeatureIds = new Set(
    getRenderableLandFeatures(canvasWidth, canvasHeight, { forceProd: true })
      .map((feature) => getFeatureId(feature))
      .filter(Boolean)
  );
  if (!includedFeatureIds.size) {
    scenarioPoliticalBackgroundCache = {
      topologyRef: topology,
      landCollectionRef: landCollection,
      scenarioId: state.activeScenarioId || "",
      viewMode: String(state.scenarioViewMode || "ownership"),
      oceanFillColor: getAtlantropaSeaPoliticalFillColor(),
      topologyRevision: Number(state.topologyRevision || 0),
      colorRevision: Number(state.colorRevision || 0),
      sovereigntyRevision: Number(state.sovereigntyRevision || 0),
      controllerRevision: Number(state.scenarioControllerRevision || 0),
      shellRevision: Number(state.scenarioShellOverlayRevision || 0),
      canvasWidth,
      canvasHeight,
      featureCount,
      entries: [],
    };
    recordRenderPerfMetric("drawScenarioPoliticalBackgroundEntries", nowMs() - startedAt, {
      cacheHit: false,
      entryCount: 0,
      featureCount,
    });
    return scenarioPoliticalBackgroundCache.entries;
  }

  const groupedGeometries = new Map();
  const geometries = Array.isArray(topology?.objects?.political?.geometries)
    ? topology.objects.political.geometries
    : [];
  geometries.forEach((geometry, index) => {
    const id = getFeatureId(geometry) || `feature-${index}`;
    if (!includedFeatureIds.has(id)) return;
    if (shouldExcludePoliticalInteractionFeature(geometry, id)) return;

    const displayCode =
      getDisplayOwnerCode(geometry, id) ||
      getFeatureCountryCodeNormalized(geometry) ||
      "__NONE__";
    const fillColor =
      (isAtlantropaSeaFeature(geometry)
        ? getAtlantropaSeaPoliticalFillColor()
        : null) ||
      getSafeCanvasColor(state.colors?.[id], null) ||
      getSafeCanvasColor(getResolvedFeatureColor(geometry, id), null) ||
      LAND_FILL_COLOR;
    const groupKey = `${displayCode}::${fillColor}`;
    if (!groupedGeometries.has(groupKey)) {
      groupedGeometries.set(groupKey, { displayCode, fillColor, geometries: [] });
    }
    groupedGeometries.get(groupKey).geometries.push(geometry);
  });

  const entries = [];
  let skippedSuspiciousCount = 0;
  groupedGeometries.forEach(({ displayCode, fillColor, geometries: group }) => {
    if (!Array.isArray(group) || !group.length) return;
    try {
      const mergedShape = globalThis.topojson.merge(topology, group);
      const normalizedMergedFeature = normalizeFeatureGeometry(
        {
          type: "Feature",
          properties: {
            id: `scenario-background-${state.activeScenarioId || "scenario"}-${displayCode || "unknown"}`,
          },
          geometry: mergedShape,
        },
        { sourceLabel: "scenario_background_merge" }
      );
      const normalizedMergedShape = normalizedMergedFeature?.geometry || mergedShape;
      if (shouldSkipScenarioPoliticalBackgroundMergeShape(normalizedMergedShape, {
        displayCode,
        fillColor,
        groupSize: group.length,
      })) {
        skippedSuspiciousCount += 1;
        return;
      }
      entries.push({ fillColor, mergedShape: normalizedMergedShape });
    } catch (_error) {
      // Skip groups that fail to merge and fall back to per-feature fills below.
    }
  });

  scenarioPoliticalBackgroundCache = {
    topologyRef: topology,
    landCollectionRef: landCollection,
    scenarioId: state.activeScenarioId || "",
    viewMode: String(state.scenarioViewMode || "ownership"),
    oceanFillColor: getAtlantropaSeaPoliticalFillColor(),
    topologyRevision: Number(state.topologyRevision || 0),
    colorRevision: Number(state.colorRevision || 0),
    sovereigntyRevision: Number(state.sovereigntyRevision || 0),
    controllerRevision: Number(state.scenarioControllerRevision || 0),
    shellRevision: Number(state.scenarioShellOverlayRevision || 0),
    canvasWidth,
    canvasHeight,
    featureCount,
    entries,
  };
  recordRenderPerfMetric("drawScenarioPoliticalBackgroundEntries", nowMs() - startedAt, {
    cacheHit: false,
    entryCount: entries.length,
    featureCount,
    skippedSuspiciousCount,
  });
  return entries;
}

function drawScenarioPoliticalBackgroundFills() {
  const entries = buildScenarioPoliticalBackgroundEntries();
  if (!entries.length) return;

  entries.forEach(({ fillColor, mergedShape }) => {
    context.beginPath();
    pathCanvas(mergedShape);
    context.fillStyle = fillColor;
    context.fill();
  });
}

function buildAdmin0MergedShapes() {
  const topology = state.topologyPrimary || state.topology;
  if (!topology?.objects?.political || !globalThis.topojson?.merge) return [];

  const geometries = topology.objects.political.geometries || [];
  const currentFeatureCount = state.landData?.features?.length || 0;

  if (
    admin0MergedCache.topologyRef === topology &&
    admin0MergedCache.featureCount === currentFeatureCount
  ) {
    return admin0MergedCache.entries;
  }

  const byCountry = new Map();
  geometries.forEach((geom) => {
    const code = String(geom?.properties?.cntr_code || "").trim().toUpperCase();
    if (!code) return;
    if (!byCountry.has(code)) byCountry.set(code, []);
    byCountry.get(code).push(geom);
  });

  const entries = [];
  byCountry.forEach((geoms, code) => {
    try {
      const mergedShape = globalThis.topojson.merge(topology, geoms);
      entries.push({ code, mergedShape });
    } catch (_e) {
      // Skip countries that fail to merge
    }
  });

  admin0MergedCache = { topologyRef: topology, featureCount: currentFeatureCount, entries };
  return entries;
}

function drawAdmin0BackgroundFills() {
  const entries = buildAdmin0MergedShapes();
  if (!entries.length) return;

  entries.forEach(({ code, mergedShape }) => {
    if (code === "ATL") return;
    const color =
      (state.sovereignBaseColors && state.sovereignBaseColors[code]) ||
      (state.countryBaseColors && state.countryBaseColors[code]) ||
      null;
    const fillColor = getSafeCanvasColor(color, null) || LAND_FILL_COLOR;

    context.beginPath();
    pathCanvas(mergedShape);
    context.fillStyle = fillColor;
    context.fill();
  });
}

function drawBackgroundPass() {
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
}

function drawPoliticalPass(k) {
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  const useScenarioBackgroundMerge = shouldUseScenarioPoliticalBackgroundMerge();
  if (debugMode === "PROD") {
    if (useScenarioBackgroundMerge) {
      // Merged background fills keep same-color runtime fragments from exposing anti-aliased seams.
      drawScenarioPoliticalBackgroundFills();
    } else {
      drawAdmin0BackgroundFills();
    }
  }
  if (!state.landData?.features?.length) return;
  const islandNeighbors = debugMode === "ISLANDS" ? getIslandNeighborGraph() : null;
  state.landData.features.forEach((feature, index) => {
    const id = getFeatureId(feature) || `feature-${index}`;
    if (shouldExcludePoliticalInteractionFeature(feature, id)) return;
    if (shouldSkipFeature(feature, canvasWidth, canvasHeight)) return;
    if (!pathBoundsInScreen(feature)) return;
    const isAtlantropaSea = debugMode === "PROD" && isAtlantropaSeaFeature(feature);

    let fillColor = LAND_FILL_COLOR;
    if (debugMode === "PROD") {
      fillColor = isAtlantropaSea
        ? getAtlantropaSeaPoliticalFillColor()
        : (getSafeCanvasColor(state.colors[id], null) || LAND_FILL_COLOR);
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

    if (debugMode === "PROD") {
      if (!useScenarioBackgroundMerge || isAtlantropaSea) {
        context.strokeStyle = isAtlantropaSea
          ? getAtlantropaSeaPoliticalStrokeColor()
          : fillColor;
        context.lineWidth = 0.5 / k;
        context.lineJoin = "round";
        context.stroke();
      }
    }
  });
}

function drawScenarioRegionOverlaysPass(k) {
  const startedAt = nowMs();
  const showWater = !!state.showWaterRegions;
  const showSpecial = !!state.showScenarioSpecialRegions;
  const waterFeatures = showWater ? getEffectiveWaterRegionFeatures() : [];
  const specialFeatures = showSpecial ? getEffectiveSpecialRegionFeatures() : [];
  let renderedWaterCount = 0;
  let renderedSpecialCount = 0;
  if (!showWater && !showSpecial) {
    collectContextMetric("drawScenarioRegionOverlaysPass", nowMs() - startedAt, {
      featureCount: 0,
      waterFeatureCount: 0,
      specialFeatureCount: 0,
      renderedWaterCount: 0,
      renderedSpecialCount: 0,
      skipped: true,
      reason: "disabled",
    });
    return;
  }

  if (showWater) {
    waterFeatures.forEach((feature, index) => {
      const id = getFeatureId(feature) || `water-${index}`;
      if (!isWaterRegionEnabled(feature)) return;
      if (!pathBoundsInScreen(feature)) return;
      const isMacroOcean = isMacroOceanWaterRegion(feature);
      const defaultStyle = getWaterRegionDefaultStyle(feature);
      const isHighlighted = state.selectedWaterRegionId === id || state.hoveredWaterRegionId === id;
      const fillOpacity = isMacroOcean
        ? 0
        : defaultStyle.opacity;
      context.beginPath();
      pathCanvas(feature);
      if (fillOpacity > 0) {
        context.save();
        context.globalAlpha = fillOpacity;
        context.fillStyle = getWaterRegionColor(id);
        context.fill();
        context.restore();
      }
      if (isHighlighted) {
        context.save();
        context.globalAlpha = isMacroOcean ? 0.92 : 1;
        context.strokeStyle = "#f1c40f";
        context.lineWidth = (isMacroOcean ? 1.15 : 0.9) / Math.max(0.0001, k);
        context.lineJoin = "round";
        context.stroke();
        context.restore();
      }
      renderedWaterCount += 1;
    });
  }

  if (showSpecial) {
    specialFeatures.forEach((feature, index) => {
      const id = getFeatureId(feature) || `special-${index}`;
      const renderAsBase = isBaseGeographyScenarioFeature(feature);
      if (!renderAsBase && !showSpecial) return;
      if (!isSpecialRegionEnabled(feature)) return;
      if (!pathBoundsInScreen(feature)) return;
      context.beginPath();
      pathCanvas(feature);
      context.save();
      context.globalAlpha = renderAsBase
        ? Math.max(getSpecialRegionOpacity(feature, id), 0.94)
        : getSpecialRegionOpacity(feature, id);
      context.fillStyle = getSpecialRegionColor(id, feature);
      context.fill();
      context.restore();
      context.strokeStyle = getSpecialRegionStrokeColor(feature);
      context.lineWidth = 1 / Math.max(0.0001, k);
      context.lineJoin = "round";
      context.stroke();
      renderedSpecialCount += 1;
    });
  }
  collectContextMetric("drawScenarioRegionOverlaysPass", nowMs() - startedAt, {
    featureCount: waterFeatures.length + specialFeatures.length,
    waterFeatureCount: waterFeatures.length,
    specialFeatureCount: specialFeatures.length,
    renderedWaterCount,
    renderedSpecialCount,
    skipped: false,
  });
}

function drawEffectsPass(k, { interactive = false } = {}) {
  drawTextureLayer(k, { interactive });
}

function drawContextBasePass(k, { interactive = false } = {}) {
  const startedAt = nowMs();
  let deferred = false;
  beginContextMetricSession();
  try {
    if (state.deferContextBasePass && !interactive) {
      deferred = true;
      const maskInfo = getPhysicalLandMaskInfo();
      collectContextMetric("drawPhysicalAtlasLayer", 0, {
        featureCount: 0,
        interactive: false,
        skipped: true,
        reason: "staged-apply",
        maskSource: maskInfo.maskSource,
        maskFeatureCount: maskInfo.maskFeatureCount,
        maskArcRefEstimate: maskInfo.maskArcRefEstimate,
      });
      collectContextMetric("drawPhysicalContourLayer", 0, {
        featureCount: 0,
        majorFeatureCount: 0,
        minorFeatureCount: 0,
        interactive: false,
        skipped: true,
        reason: "staged-apply",
        maskSource: maskInfo.maskSource,
        maskFeatureCount: maskInfo.maskFeatureCount,
        maskArcRefEstimate: maskInfo.maskArcRefEstimate,
      });
      collectContextMetric("drawUrbanLayer", 0, {
        featureCount: getFeatureCollectionFeatureCount(state.urbanData),
        interactive: false,
        skipped: true,
        reason: "staged-apply",
      });
      collectContextMetric("drawRiversLayer", 0, {
        featureCount: getFeatureCollectionFeatureCount(state.riversData),
        interactive: false,
        skipped: true,
        reason: "staged-apply",
      });
    } else {
      drawPhysicalLayer(k, { interactive });
      drawUrbanLayer(k, { interactive });
      drawRiversLayer(k, { interactive });
    }
  } finally {
    endContextMetricSession();
  }
  recordRenderPerfMetric("drawContextBasePass", nowMs() - startedAt, {
    interactive: !!interactive,
    deferred,
  });
}

function drawContextScenarioPass(k, { interactive = false } = {}) {
  const startedAt = nowMs();
  beginContextMetricSession();
  try {
    drawScenarioRegionOverlaysPass(k);
    drawScenarioReliefOverlaysLayer(k);
  } finally {
    endContextMetricSession();
  }
  recordRenderPerfMetric("drawContextScenarioPass", nowMs() - startedAt, {
    interactive: !!interactive,
  });
}

function drawDayNightPass(k, { interactive = false } = {}) {
  const config = getDayNightStyleConfig();
  if (!config.enabled) return;
  const solarState = getCurrentSolarState(config);
  drawDayNightShadowLayer(k, config, solarState);
  if (!interactive) {
    drawNightLightsLayer(k, config, solarState);
  }
}

function drawBordersPass(k, { interactive = false } = {}) {
  if (!state.landData?.features?.length) return;
  drawHierarchicalBorders(k, { interactive });
}

function renderPassToCache(passName, drawFn, transform, timings) {
  const passCanvas = ensureRenderPassCanvas(passName);
  const passContext = passCanvas.getContext("2d");
  if (!passContext) return;
  const passStart = nowMs();
  withRenderTarget(passContext, () => {
    const k = prepareTargetContext(passContext, transform);
    drawFn(k);
  });
  setPassReferenceTransform(passName, transform);
  getRenderPassCacheState().signatures[passName] = getRenderPassSignature(passName, transform);
  getRenderPassCacheState().dirty[passName] = false;
  recordPassTiming(timings, passName, passStart);
  getPassCounterNames(passName).forEach((counterName) => incrementPerfCounter(counterName));
}

function ensureIdleRenderPasses(timings) {
  const transform = state.zoomTransform || globalThis.d3.zoomIdentity;
  const cache = getRenderPassCacheState();
  const passDefinitions = [
    ["background", (k) => drawBackgroundPass(k)],
    ["political", (k) => drawPoliticalPass(k)],
    ["effects", (k) => drawEffectsPass(k)],
    ["contextBase", (k) => drawContextBasePass(k)],
    ["contextScenario", (k) => drawContextScenarioPass(k)],
    ["dayNight", (k) => drawDayNightPass(k)],
    ["borders", (k) => drawBordersPass(k)],
  ];
  passDefinitions.forEach(([passName, drawFn]) => {
    const nextSignature = getRenderPassSignature(passName, transform);
    if (cache.signatures[passName] !== nextSignature) {
      cache.dirty[passName] = true;
      if (!cache.reasons[passName] || cache.reasons[passName] === "init") {
        cache.reasons[passName] = "signature";
      }
    }
    if (
      passName === "contextBase"
      && shouldEnableContextBaseTransformReuse()
      && !state.deferExactAfterSettle
      && shouldStartExactAfterSettleFastPath()
    ) {
      const reuseDecision = getContextBaseReuseDecision(transform);
      if (reuseDecision.enabled && reuseDecision.shouldExactRefresh) {
        cache.dirty[passName] = true;
        cache.reasons[passName] = reuseDecision.reason || "context-base-threshold";
      }
    }
    if (!cache.dirty[passName]) return;
    renderPassToCache(passName, drawFn, transform, timings);
  });
  if (Number.isFinite(timings.contextBase) || Number.isFinite(timings.contextScenario)) {
    timings.context =
      Math.max(0, Number(timings.contextBase || 0))
      + Math.max(0, Number(timings.contextScenario || 0));
  }
}

function resetMainCanvas() {
  if (!context?.canvas) return;
  const width = context.canvas.width;
  const height = context.canvas.height;
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, width, height);
  context.globalCompositeOperation = "source-over";
  context.globalAlpha = 1;
  context.shadowBlur = 0;
  context.filter = "none";
}

function areZoomTransformsEquivalent(a, b, epsilon = 0.01) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  return (
    Math.abs(Number(a.k || 1) - Number(b.k || 1)) <= epsilon
    && Math.abs(Number(a.x || 0) - Number(b.x || 0)) <= epsilon
    && Math.abs(Number(a.y || 0) - Number(b.y || 0)) <= epsilon
  );
}

function composeCachedPasses(passNames, currentTransform = state.zoomTransform || globalThis.d3.zoomIdentity) {
  const cache = getRenderPassCacheState();
  resetMainCanvas();
  (Array.isArray(passNames) ? passNames : RENDER_PASS_NAMES).forEach((passName) => {
    const passCanvas = cache.canvases?.[passName];
    if (!passCanvas) return;
    const referenceTransform = getPassReferenceTransform(passName);
    if (referenceTransform && !areZoomTransformsEquivalent(referenceTransform, currentTransform)) {
      drawTransformedPass(passName, currentTransform, referenceTransform);
      return;
    }
    context.drawImage(passCanvas, 0, 0);
  });
  incrementPerfCounter("composites");
}

function drawTransformedPass(passName, currentTransform, referenceTransform = null) {
  const cache = getRenderPassCacheState();
  const passCanvas = cache.canvases?.[passName];
  if (!passCanvas) return false;
  const resolvedReferenceTransform = referenceTransform || getPassReferenceTransform(passName);
  if (!resolvedReferenceTransform) return false;
  const current = cloneZoomTransform(currentTransform);
  const reference = cloneZoomTransform(resolvedReferenceTransform);
  const scaleRatio = current.k / Math.max(reference.k, 0.0001);
  const dx = current.x - (reference.x * scaleRatio);
  const dy = current.y - (reference.y * scaleRatio);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.translate(dx * state.dpr, dy * state.dpr);
  context.scale(scaleRatio, scaleRatio);
  context.drawImage(passCanvas, 0, 0);
  context.restore();
  return true;
}

function drawTransformedFrameFromCaches(timings, { interactiveBorders = false } = {}) {
  const currentTransform = state.zoomTransform || globalThis.d3.zoomIdentity;
  const compositeStart = nowMs();
  resetMainCanvas();
  const transformedPasses = ["background", "political", "effects", "contextBase", "contextScenario", "dayNight"];
  const cache = getRenderPassCacheState();
  if (transformedPasses.some((passName) => cache.dirty?.[passName])) {
    return false;
  }
  const drewAll = transformedPasses.every((passName) =>
    drawTransformedPass(passName, currentTransform)
  );
  if (!drewAll) return false;

  const k = Math.max(0.0001, Number(currentTransform?.k || 1));
  context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  context.translate(currentTransform.x, currentTransform.y);
  context.scale(k, k);
  drawBordersPass(k, { interactive: !!interactiveBorders });
  context.setTransform(1, 0, 0, 1, 0, 0);
  const timingLabel = interactiveBorders ? "interactiveComposite" : "transformedComposite";
  recordPassTiming(timings, timingLabel, compositeStart);
  if (Number.isFinite(timings.contextBase) || Number.isFinite(timings.contextScenario)) {
    timings.context =
      Math.max(0, Number(timings.contextBase || 0))
      + Math.max(0, Number(timings.contextScenario || 0));
  }
  incrementPerfCounter("transformedFrames");
  if (state.renderPhase === RENDER_PHASE_SETTLING || (state.renderPhase === RENDER_PHASE_IDLE && state.deferExactAfterSettle)) {
    recordRenderPerfMetric("settleFastFrame", Math.max(0, nowMs() - compositeStart), {
      phase: state.renderPhase,
      interactiveBorders: !!interactiveBorders,
      activeScenarioId: String(state.activeScenarioId || ""),
    });
  }
  return true;
}

function drawCanvas() {
  if (!context || !pathCanvas) return;
  ensureLayerDataFromTopology();
  incrementPerfCounter("drawCanvas");
  const frameStart = nowMs();
  const frameTimings = {};
  const useTransformedFrame =
    state.renderPhase === RENDER_PHASE_INTERACTING
    || state.renderPhase === RENDER_PHASE_SETTLING
    || (state.renderPhase === RENDER_PHASE_IDLE && state.deferExactAfterSettle);

  if (!useTransformedFrame || !drawTransformedFrameFromCaches(frameTimings, {
    interactiveBorders: state.renderPhase !== RENDER_PHASE_IDLE || state.deferExactAfterSettle,
  })) {
    ensureIdleRenderPasses(frameTimings);
    composeCachedPasses(RENDER_PASS_NAMES);
  }

  const cache = getRenderPassCacheState();
  cache.lastFrame = {
    phase: state.renderPhase,
    totalMs: Math.max(0, nowMs() - frameStart),
    timings: frameTimings,
    transform: cloneZoomTransform(state.zoomTransform),
  };
  incrementPerfCounter("frames");
}

function scheduleExactAfterSettleRefresh() {
  cancelExactAfterSettleRefresh({ clearDefer: false });
  state.exactAfterSettleHandle = {
    type: "timeout",
    id: globalThis.setTimeout(() => {
    state.exactAfterSettleHandle = null;
    if (state.renderPhase !== RENDER_PHASE_IDLE || !state.deferExactAfterSettle) return;
    const reuseDecision = getContextBaseReuseDecision();
    const startedAt = nowMs();
    state.deferExactAfterSettle = false;
    if (reuseDecision.enabled) {
      recordRenderPerfMetric("contextBaseReuseScaleRatio", 0, {
        activeScenarioId: String(state.activeScenarioId || ""),
        scaleRatio: reuseDecision.scaleRatio,
        zoomBucket: reuseDecision.zoomBucket,
        referenceZoomBucket: reuseDecision.referenceZoomBucket,
      });
      recordRenderPerfMetric("contextBaseReuseDistancePx", 0, {
        activeScenarioId: String(state.activeScenarioId || ""),
        distancePx: reuseDecision.distancePx,
        maxDistancePx: reuseDecision.maxDistancePx,
      });
      if (reuseDecision.shouldExactRefresh) {
        invalidateRenderPasses("contextBase", reuseDecision.reason || "context-base-exact");
      } else {
        recordRenderPerfMetric("contextBaseReuseSkipped", 0, {
          activeScenarioId: String(state.activeScenarioId || ""),
          reason: reuseDecision.reason,
          scaleRatio: reuseDecision.scaleRatio,
          distancePx: reuseDecision.distancePx,
          maxDistancePx: reuseDecision.maxDistancePx,
          zoomBucket: reuseDecision.zoomBucket,
          referenceZoomBucket: reuseDecision.referenceZoomBucket,
          crossesZoomBucket: !!reuseDecision.crossesZoomBucket,
          crossesMinorContourThreshold: !!reuseDecision.crossesMinorContourThreshold,
        });
      }
    }
    render();
    const durationMs = Math.max(0, nowMs() - startedAt);
    recordRenderPerfMetric("settleExactRefresh", durationMs, {
      activeScenarioId: String(state.activeScenarioId || ""),
      contextBaseRefreshed: !!reuseDecision.shouldExactRefresh,
      reason: reuseDecision.reason,
      scaleRatio: reuseDecision.scaleRatio,
      distancePx: reuseDecision.distancePx,
      maxDistancePx: reuseDecision.maxDistancePx,
      zoomBucket: reuseDecision.zoomBucket,
      referenceZoomBucket: reuseDecision.referenceZoomBucket,
      crossesZoomBucket: !!reuseDecision.crossesZoomBucket,
      crossesMinorContourThreshold: !!reuseDecision.crossesMinorContourThreshold,
    });
    if (reuseDecision.enabled && reuseDecision.shouldExactRefresh) {
      recordRenderPerfMetric("contextBaseExactRefresh", Number(state.renderPerfMetrics?.drawContextBasePass?.durationMs || durationMs), {
        activeScenarioId: String(state.activeScenarioId || ""),
        reason: reuseDecision.reason,
        scaleRatio: reuseDecision.scaleRatio,
        distancePx: reuseDecision.distancePx,
        maxDistancePx: reuseDecision.maxDistancePx,
        zoomBucket: reuseDecision.zoomBucket,
        referenceZoomBucket: reuseDecision.referenceZoomBucket,
        crossesZoomBucket: !!reuseDecision.crossesZoomBucket,
        crossesMinorContourThreshold: !!reuseDecision.crossesMinorContourThreshold,
      });
    }
    }, EXACT_AFTER_SETTLE_QUIET_WINDOW_MS),
  };
}

function scheduleStagedHitCanvasWarmup(startedAt, token) {
  cancelDeferredWork(state.stagedHitCanvasHandle);
  state.stagedHitCanvasHandle = scheduleDeferredWork(() => {
    state.stagedHitCanvasHandle = null;
    if (token !== Number(state.stagedMapDataToken || 0)) return;
    if (state.renderPhase !== RENDER_PHASE_IDLE) {
      scheduleStagedHitCanvasWarmup(startedAt, token);
      return;
    }
    state.deferHitCanvasBuild = false;
    if (state.hitCanvasDirty) {
      ensureHitCanvasUpToDate({ force: true });
    }
    recordRenderPerfMetric("setMapDataHitCanvasReady", nowMs() - startedAt, {
      staged: true,
      activeScenarioId: String(state.activeScenarioId || ""),
    });
  }, {
    timeout: STAGED_HIT_CANVAS_TIMEOUT_MS,
  });
}

function scheduleStagedContextBaseWarmup(startedAt, token) {
  cancelDeferredWork(state.stagedContextBaseHandle);
  state.stagedContextBaseHandle = scheduleDeferredWork(() => {
    state.stagedContextBaseHandle = null;
    if (token !== Number(state.stagedMapDataToken || 0)) return;
    if (state.renderPhase !== RENDER_PHASE_IDLE) {
      scheduleStagedContextBaseWarmup(startedAt, token);
      return;
    }
    state.deferContextBasePass = false;
    invalidateRenderPasses("contextBase", "staged-context-base");
    render();
    recordRenderPerfMetric("setMapDataContextBaseReady", nowMs() - startedAt, {
      staged: true,
      activeScenarioId: String(state.activeScenarioId || ""),
    });
    scheduleStagedHitCanvasWarmup(startedAt, token);
  }, {
    timeout: STAGED_CONTEXT_BASE_TIMEOUT_MS,
  });
}

function beginStagedMapDataWarmup(startedAt) {
  clearStagedMapDataTasks();
  const token = Number(state.stagedMapDataToken || 0) + 1;
  state.stagedMapDataToken = token;
  const shouldStage = isHeavyScenarioStagedApplyCandidate();
  state.deferContextBasePass = shouldStage;
  state.deferHitCanvasBuild = shouldStage;
  if (shouldStage) {
    scheduleStagedContextBaseWarmup(startedAt, token);
  }
  return shouldStage;
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

  const normalizeSpecialZoneFeature = (feature, index, sourceLabel) => {
    if (!feature?.geometry) return null;
    const normalizedFeature = normalizeFeatureGeometry(feature, {
      sourceLabel: `special_zone_${sourceLabel}`,
    });
    return {
      ...normalizedFeature,
      properties: {
        ...(normalizedFeature?.properties || {}),
        __source: sourceLabel,
        id: String(normalizedFeature?.properties?.id || `special_zone_${sourceLabel}_${index + 1}`),
      },
    };
  };

  const features = [
    ...topologyFeatures
      .map((feature, index) => normalizeSpecialZoneFeature(feature, index, "topology"))
      .filter(Boolean),
    ...manualFeatures
      .map((feature, index) => normalizeSpecialZoneFeature(feature, index, "manual"))
      .filter(Boolean),
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
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
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
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
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
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
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
    hoverGroup.attr("aria-hidden", "true");
    return;
  }

  const feature = state.hoveredSpecialRegionId
    ? state.specialRegionsById.get(state.hoveredSpecialRegionId)
    : state.hoveredWaterRegionId
      ? state.waterRegionsById.get(state.hoveredWaterRegionId)
      : (state.hoveredId ? state.landIndex.get(state.hoveredId) : null);
  const data = feature && (
    (!state.hoveredSpecialRegionId || isSpecialRegionEnabled(feature))
    && (!state.hoveredWaterRegionId || isWaterRegionEnabled(feature))
  ) ? [feature] : [];

  const selection = hoverGroup
    .selectAll("path.hovered-feature")
    .data(data, (d) => getFeatureId(d) || "hover");

  selection
    .enter()
    .append("path")
    .attr("class", "hovered-feature")
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
    .attr("vector-effect", "non-scaling-stroke")
    .merge(selection)
    .attr("d", pathSVG)
    .attr("fill", "none")
    .attr("stroke", "#f1c40f")
    .attr("stroke-width", 2.0);

  selection.exit().remove();
  hoverGroup.attr("aria-hidden", data.length ? "false" : "true");
}

function renderInspectorHighlightOverlay() {
  if (!inspectorHighlightGroup || !pathSVG) return;
  const code = String(state.inspectorHighlightCountryCode || "").trim().toUpperCase();
  if (!code) {
    inspectorHighlightGroup.selectAll("path.inspector-highlight").remove();
    inspectorHighlightGroup.attr("aria-hidden", "true");
    return;
  }
  const data = (state.landData?.features || []).filter((feature) => getFeatureCountryCodeNormalized(feature) === code);
  const selection = inspectorHighlightGroup
    .selectAll("path.inspector-highlight")
    .data(data, (d, index) => getFeatureId(d) || `${code}-${index}`);

  selection
    .enter()
    .append("path")
    .attr("class", "inspector-highlight")
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
    .attr("vector-effect", "non-scaling-stroke")
    .merge(selection)
    .attr("d", pathSVG)
    .attr("fill", "none")
    .attr("stroke", "rgba(0, 47, 167, 0.6)")
    .attr("stroke-width", 2.4);

  selection.exit().remove();
  inspectorHighlightGroup
    .attr("aria-hidden", data.length ? "false" : "true")
    .attr("aria-label", data.length ? `Inspector highlight overlay for ${code}` : "Inspector highlight overlay");
}

function renderSpecialZones() {
  if (!specialZonesGroup || !specialZoneEditorGroup) return;
  const isDrawing = !!state.specialZoneEditor?.active;
  if (!state.showSpecialZones && !isDrawing) {
    specialZonesGroup.attr("display", "none");
    specialZoneEditorGroup.attr("display", "none");
    specialZonesGroup.attr("aria-hidden", "true");
    specialZoneEditorGroup.attr("aria-hidden", "true");
    return;
  }
  updateSpecialZonesPaths();
  renderSpecialZoneEditorOverlay();
  const visibleSpecialZones = state.showSpecialZones && getEffectiveSpecialZonesFeatureCollection().features.length > 0;
  specialZonesGroup
    .attr("display", state.showSpecialZones ? null : "none")
    .attr("aria-hidden", visibleSpecialZones ? "false" : "true");
  specialZoneEditorGroup
    .attr("display", null)
    .attr("aria-hidden", isDrawing ? "false" : "true");
}

export function renderLegend(uniqueColors = null, labels = null) {
  if (!legendGroup || !legendItemsGroup || !legendBackground) return;

  const colors = Array.isArray(uniqueColors)
    ? uniqueColors
    : LegendManager.getUniqueColors(state);
  const labelMap = labels || LegendManager.getLabels();
  const hasScenarioVisualEdits =
    !!state.activeScenarioId &&
    (
      Object.keys(state.visualOverrides || {}).length > 0
      || Object.keys(state.featureOverrides || {}).length > 0
    );
  const hasMeaningfulLabels = colors.some((color) => {
    const key = String(color || "").toLowerCase();
    return String(labelMap?.[key] || "").trim().length > 0;
  });
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

  if (state.activeScenarioId && !hasMeaningfulLabels && !hasScenarioVisualEdits) {
    legendGroup.attr("display", "none");
    lastLegendKey = `${legendKey}::scenario-hidden`;
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

function ensurePerfOverlayElement() {
  const cache = getRenderPassCacheState();
  if (!cache.perfOverlayEnabled || !mapContainer) return null;
  if (cache.overlayElement && mapContainer.contains(cache.overlayElement)) {
    return cache.overlayElement;
  }
  const element = document.createElement("pre");
  element.id = "perf-overlay";
  element.style.position = "absolute";
  element.style.top = "12px";
  element.style.right = "12px";
  element.style.zIndex = "5";
  element.style.maxWidth = "360px";
  element.style.margin = "0";
  element.style.padding = "10px 12px";
  element.style.borderRadius = "10px";
  element.style.background = "rgba(15, 23, 42, 0.84)";
  element.style.color = "#e2e8f0";
  element.style.font = "11px/1.45 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";
  element.style.whiteSpace = "pre-wrap";
  element.style.pointerEvents = "none";
  element.style.boxShadow = "0 8px 30px rgba(15, 23, 42, 0.28)";
  mapContainer.appendChild(element);
  cache.overlayElement = element;
  return element;
}

function updatePerfOverlay() {
  const cache = getRenderPassCacheState();
  if (!cache.perfOverlayEnabled) {
    if (cache.overlayElement?.remove) {
      cache.overlayElement.remove();
    }
    cache.overlayElement = null;
    return;
  }
  const overlay = ensurePerfOverlayElement();
  if (!overlay) return;
  const frame = cache.lastFrame || {};
  const sidebarPerf = getSidebarPerfState();
  const invalidations = RENDER_PASS_NAMES.map((passName) => {
    const reason = cache.reasons?.[passName] || "-";
    const dirtyFlag = cache.dirty?.[passName] ? "*" : "";
    return `${passName}:${reason}${dirtyFlag}`;
  }).join(" | ");
  const timingEntries = Object.entries(frame.timings || {})
    .map(([name, value]) => `${name}=${Number(value || 0).toFixed(1)}ms`)
    .join(", ");
  const renderPerf = state.renderPerfMetrics || {};
  const scenarioPerf = state.scenarioPerfMetrics || {};
  const opEntries = [
    ["setMapData", renderPerf.setMapData?.durationMs],
    ["firstPaint", renderPerf.setMapDataFirstPaint?.durationMs],
    ["contextBaseReady", renderPerf.setMapDataContextBaseReady?.durationMs],
    ["hitReady", renderPerf.setMapDataHitCanvasReady?.durationMs],
    ["settleFast", renderPerf.settleFastFrame?.durationMs],
    ["settleExact", renderPerf.settleExactRefresh?.durationMs],
    ["ctxBaseExact", renderPerf.contextBaseExactRefresh?.durationMs],
    ["buildSpatialIndex", renderPerf.buildSpatialIndex?.durationMs],
    ["rebuildStaticMeshes", renderPerf.rebuildStaticMeshes?.durationMs],
    ["rebuildDynamicBorders", renderPerf.rebuildDynamicBorders?.durationMs],
    ["physicalClip", renderPerf.applyPhysicalLandClipMask?.durationMs],
    ["oceanClip", renderPerf.applyOceanClipMask?.durationMs],
    ["contextBase", renderPerf.drawContextBasePass?.durationMs],
    ["contextScenario", renderPerf.drawContextScenarioPass?.durationMs],
    ["hitCanvas", renderPerf.buildHitCanvas?.durationMs],
    ["bgMerge", renderPerf.drawScenarioPoliticalBackgroundEntries?.durationMs],
    ["relief", renderPerf.drawScenarioReliefOverlaysLayer?.durationMs],
    ["scenarioLoad", scenarioPerf.loadScenarioBundle?.durationMs],
    ["scenarioApply", scenarioPerf.applyScenarioBundle?.durationMs],
  ]
    .filter(([, value]) => Number.isFinite(Number(value)))
    .map(([name, value]) => `${name}=${Number(value || 0).toFixed(1)}ms`)
    .join(", ");
  const contextBreakdownEntries = Object.entries(renderPerf.contextBreakdown || {})
    .map(([name, value]) => {
      const duration = Number(value?.durationMs || 0).toFixed(1);
      const callCount = Number(value?.callCount || 0);
      return `${name}=${duration}ms${callCount > 1 ? `#${callCount}` : ""}`;
    })
    .join(", ");
  overlay.textContent = [
    `phase=${frame.phase || state.renderPhase} total=${Number(frame.totalMs || 0).toFixed(1)}ms`,
    `action=${cache.lastAction || "-"} ${Number(cache.lastActionDurationMs || 0).toFixed(1)}ms`,
    `transform=${getTransformSignature(frame.transform || state.zoomTransform)}`,
    `passes ${timingEntries || "none"}`,
    `contextBreakdown ${contextBreakdownEntries || "none"}`,
    `ops ${opEntries || "none"}`,
    `ctxReuse skip=${renderPerf.contextBaseReuseSkipped ? "yes" : "no"} scale=${Number(renderPerf.contextBaseReuseScaleRatio?.scaleRatio || 0).toFixed(4)} dist=${Number(renderPerf.contextBaseReuseDistancePx?.distancePx || 0).toFixed(2)}px`,
    `invalidations ${invalidations}`,
    `render draw=${cache.counters.drawCanvas || 0} frame=${cache.counters.frames || 0} ctxBase=${cache.counters.contextBasePassRenders || 0} ctxScenario=${cache.counters.contextScenarioPassRenders || 0} dayNight=${cache.counters.dayNightPassRenders || 0} hit=${cache.counters.hitCanvasRenders || 0} dynBorder=${cache.counters.dynamicBorderRebuilds || 0}`,
    `sidebar list=${sidebarPerf.counters.fullListRenders || 0} rows=${sidebarPerf.counters.rowRefreshes || 0} detail=${sidebarPerf.counters.inspectorRenders || 0} preset=${sidebarPerf.counters.presetTreeRenders || 0} legend=${sidebarPerf.counters.legendRenders || 0}`,
  ].join("\n");
}

function render() {
  drawCanvas();
  if (state.renderPhase === RENDER_PHASE_IDLE) {
    scheduleHitCanvasBuildIfNeeded();
  }
  renderSpecialZonesIfNeeded();
  renderDevSelectionOverlayIfNeeded();
  renderInspectorHighlightOverlayIfNeeded();
  renderHoverOverlayIfNeeded();
  if (state.renderPhase === RENDER_PHASE_IDLE) {
    renderLegend();
    if (typeof state.updateLegendUI === "function") {
      state.updateLegendUI();
    }
  }
  updatePerfOverlay();
}

function autoFillMap(mode = "region", { recordHistory = true, styleUpdates = null } = {}) {
  if (!state.landData?.features?.length) {
    console.warn("[autoFillMap] No land features available, aborting.");
    return;
  }

  migrateLegacyColorState();
  ensureSovereigntyState();
  const nextCountryBaseColors = {};
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();

  if (mode === "political" && state.runtimePoliticalTopology?.objects?.political) {
    const computed = ColorManager.computeOwnerColors(
      {
        featureIds: state.runtimeFeatureIds,
        canonicalCountryByFeatureId: state.runtimeCanonicalCountryByFeatureId,
        neighborGraph: state.runtimeNeighborGraph,
      },
      state.sovereigntyByFeatureId,
      {
        fixedOwnerColors: {
          ...(state.fixedPaletteColorsByIso2 || {}),
          ...(state.scenarioFixedOwnerColors || {}),
        },
      }
    );
    const ownerColors = computed?.ownerColors || {};
    state.landData.features.forEach((feature, index) => {
      const id = getFeatureId(feature) || `feature-${index}`;
      if (shouldExcludePoliticalInteractionFeature(feature, id)) return;
      if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) return;
      const ownerCode = getFeatureOwnerCode(id) || getFeatureCountryCodeNormalized(feature);
      if (!ownerCode || nextCountryBaseColors[ownerCode]) return;
      const color =
        getColorByCanonicalCountryCode(ownerColors, ownerCode) ||
        (ownerCode && state.countryPalette && state.countryPalette[ownerCode]) ||
        ColorManager.getPoliticalFallbackColor(ownerCode || id, index);
      nextCountryBaseColors[ownerCode] = getSafeCanvasColor(color, LAND_FILL_COLOR);
    });
    state.sovereignContrastWarnings = computed?.contrastStats?.lowContrastEdges
      ? [computed.contrastStats]
      : [];

  } else {
    // Region mode: assign one region-derived color per country to country base colors.
    const countryRegionTag = new Map();
    state.landData.features.forEach((feature, index) => {
      const id = getFeatureId(feature) || `feature-${index}`;
      if (shouldExcludePoliticalInteractionFeature(feature, id)) return;
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

  const historyFeatureIds = Object.keys(state.visualOverrides || {});
  const historyOwnerCodes = Array.from(new Set([
    ...Object.keys(state.sovereignBaseColors || {}),
    ...Object.keys(state.countryBaseColors || {}),
    ...Object.keys(nextCountryBaseColors || {}),
  ]));
  const stylePaths = styleUpdates && typeof styleUpdates === "object"
    ? Object.keys(styleUpdates)
    : [];
  const historyBefore = recordHistory
    ? captureHistoryState({
      featureIds: historyFeatureIds,
      ownerCodes: historyOwnerCodes,
      stylePaths,
    })
    : null;

  state.visualOverrides = {};
  state.featureOverrides = {};
  state.sovereignBaseColors = sanitizeCountryColorMap(nextCountryBaseColors);
  state.countryBaseColors = { ...state.sovereignBaseColors };
  if (styleUpdates && typeof styleUpdates === "object") {
    Object.entries(styleUpdates).forEach(([path, value]) => {
      const segments = String(path || "").split(".").filter(Boolean);
      if (!segments.length) return;
      let cursor = state.styleConfig;
      for (let index = 0; index < segments.length - 1; index += 1) {
        const segment = segments[index];
        if (!cursor[segment] || typeof cursor[segment] !== "object") {
          cursor[segment] = {};
        }
        cursor = cursor[segment];
      }
      cursor[segments[segments.length - 1]] = value;
    });
  }
  markDirty(mode === "political" ? "auto-fill-political" : "auto-fill-region");
  refreshResolvedColorsForOwners(Object.keys(nextCountryBaseColors), { renderNow: false });
  if (recordHistory) {
    commitHistoryEntry({
      kind: mode === "political" ? "auto-fill-political" : "auto-fill-region",
      before: historyBefore,
      after: captureHistoryState({
        featureIds: historyFeatureIds,
        ownerCodes: historyOwnerCodes,
        stylePaths,
      }),
    });
  }
  if (typeof state.renderCountryListFn === "function") {
    state.renderCountryListFn();
  }
  if (context) {
    render();
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
  state.specialZonesOverlayDirty = true;
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
  state.specialZonesOverlayDirty = true;
  updateSpecialZoneEditorUI();
  if (context) render();
}

function undoSpecialZoneVertex() {
  ensureSpecialZoneEditorState();
  if (!state.specialZoneEditor.active || !state.specialZoneEditor.vertices.length) return;
  state.specialZoneEditor.vertices.pop();
  state.specialZonesOverlayDirty = true;
  updateSpecialZoneEditorUI();
  if (context) render();
}

function cancelSpecialZoneDraw() {
  ensureSpecialZoneEditorState();
  state.specialZoneEditor.active = false;
  state.specialZoneEditor.vertices = [];
  state.specialZonesOverlayDirty = true;
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
  state.specialZonesOverlayDirty = true;
  updateSpecialZoneEditorUI();
  if (context) render();
  return true;
}

function selectSpecialZoneById(id) {
  ensureSpecialZoneEditorState();
  const next = String(id || "").trim();
  state.specialZoneEditor.selectedId = next || null;
  state.specialZonesOverlayDirty = true;
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
    state.specialZonesOverlayDirty = true;
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
  if (!state.landData && !state.waterRegionsData && !state.scenarioSpecialRegionsData) return;
  if (state.specialZoneEditor?.active) {
    state.hoveredId = null;
    state.hoveredWaterRegionId = null;
    state.hoveredSpecialRegionId = null;
    updateDevHoverHit(null);
    state.hoverOverlayDirty = true;
    renderHoverOverlayIfNeeded();
    queueTooltipUpdate({ visible: false });
    return;
  }

  const reducedHoverPhase = state.renderPhase !== RENDER_PHASE_IDLE;
  const hit = getHitFromEvent(event, {
    enableSnap: false,
    snapPx: HIT_SNAP_RADIUS_HOVER_PX,
    eventType: "hover",
  });
  const id = hit.id;
  const nextHoveredSpecialId = hit.targetType === "special" ? id : null;
  const nextHoveredLandId = hit.targetType === "land" ? id : null;
  const nextHoveredWaterId = hit.targetType === "water" ? id : null;
  if (
    nextHoveredLandId !== state.hoveredId
    || nextHoveredWaterId !== state.hoveredWaterRegionId
    || nextHoveredSpecialId !== state.hoveredSpecialRegionId
  ) {
    state.hoveredId = nextHoveredLandId;
    state.hoveredWaterRegionId = nextHoveredWaterId;
    state.hoveredSpecialRegionId = nextHoveredSpecialId;
    state.hoverOverlayDirty = true;
    if (!reducedHoverPhase) {
      renderHoverOverlayIfNeeded();
    }
  }
  updateDevHoverHit(id ? hit : null);

  if (!tooltip) return;
  if (id && (state.landIndex.has(id) || state.waterRegionsById.has(id) || state.specialRegionsById.has(id))) {
    const feature = hit.targetType === "special"
      ? state.specialRegionsById.get(id)
      : hit.targetType === "water"
        ? state.waterRegionsById.get(id)
        : state.landIndex.get(id);
    queueTooltipUpdate({
      visible: true,
      text: getTooltipText(feature),
      x: event.clientX + 12,
      y: event.clientY + 12,
    });
  } else {
    queueTooltipUpdate({ visible: false });
  }
}

function addRecentColor(color) {
  if (!color) return;
  state.recentColors = state.recentColors.filter((value) => value !== color);
  state.recentColors.unshift(color);
  if (state.recentColors.length > 4) {
    state.recentColors = state.recentColors.slice(0, 4);
  }
  if (typeof state.updateRecentUI === "function") {
    state.updateRecentUI();
  }
}

function commitHistoryEntry({ kind, before, after, affectsSovereignty = false } = {}) {
  pushHistoryEntry({
    kind: String(kind || "interaction"),
    before: before || {},
    after: after || {},
    meta: {
      affectsSovereignty: !!affectsSovereignty,
    },
  });
}

function getCountryFeatureIds(countryCode) {
  if (!countryCode || !(state.countryToFeatureIds instanceof Map)) return [];
  const ids = state.countryToFeatureIds.get(countryCode);
  if (!Array.isArray(ids)) return [];
  return ids.filter((candidateId) => {
    const candidateFeature = state.landIndex?.get(candidateId);
    return candidateFeature && !shouldExcludePoliticalInteractionFeature(candidateFeature, candidateId);
  });
}

function getCountryInteractionPolicy(countryCode) {
  if (!countryCode || !(state.countryInteractionPoliciesByCode instanceof Map)) return null;
  return state.countryInteractionPoliciesByCode.get(countryCode) || null;
}

function shouldRequireLeafDetail(countryCode) {
  const policy = getCountryInteractionPolicy(countryCode);
  if (!policy?.requiresComposite) return false;
  if (isSovereigntyModeActive()) return false;
  return state.interactionGranularity !== "country";
}

function hasLeafDetailReady(countryCode) {
  if (!shouldRequireLeafDetail(countryCode)) return true;
  if (state.topologyBundleMode !== "composite") return false;
  return getCountryFeatureIds(countryCode).length > 1;
}

function showDetailPromotionToast(message, { title = "", tone = "info", duration = 2600 } = {}) {
  const nextMessage = String(message || "").trim();
  if (!nextMessage) return;
  const now = Date.now();
  const token = `${tone}::${title}::${nextMessage}`;
  if (token === lastDetailToastToken && now - lastDetailToastAt < 1400) {
    return;
  }
  lastDetailToastToken = token;
  lastDetailToastAt = now;
  showToast(nextMessage, { title, tone, duration });
}

function requestLeafDetailPromotion(countryCode, { announce = false } = {}) {
  if (!shouldRequireLeafDetail(countryCode)) return true;
  if (hasLeafDetailReady(countryCode)) return true;

  if (announce) {
    showDetailPromotionToast("Loading detailed subdivisions for this country…", {
      title: "Detail layer",
      tone: "info",
    });
  }

  if (!state.detailPromotionInFlight && typeof state.ensureDetailTopologyFn === "function") {
    void state.ensureDetailTopologyFn();
  }
  return false;
}

async function ensureLeafDetailReady(countryCode, { announce = false } = {}) {
  if (!shouldRequireLeafDetail(countryCode)) return true;
  if (hasLeafDetailReady(countryCode)) return true;

  if (announce) {
    showDetailPromotionToast("Loading detailed subdivisions for this country…", {
      title: "Detail layer",
      tone: "info",
      duration: 2200,
    });
  }

  if (typeof state.ensureDetailTopologyFn !== "function") {
    showDetailPromotionToast("Detailed subdivisions are unavailable in the current session.", {
      title: "Detail layer unavailable",
      tone: "warning",
      duration: 3200,
    });
    return false;
  }

  const promoted = await state.ensureDetailTopologyFn();
  if (!promoted || !hasLeafDetailReady(countryCode)) {
    showDetailPromotionToast("Detailed subdivisions could not be loaded. Keep the detail layer enabled and try again.", {
      title: "Detail layer unavailable",
      tone: "warning",
      duration: 3600,
    });
    return false;
  }
  return true;
}

function collectCountryCodesForFeatureIds(featureIds) {
  const codes = new Set();
  (Array.isArray(featureIds) ? featureIds : []).forEach((featureId) => {
    const feature = state.landIndex?.get(featureId);
    const code = feature ? getFeatureCountryCodeNormalized(feature) : "";
    if (code) {
      codes.add(code);
    }
  });
  return Array.from(codes);
}

function refreshSidebarAfterPaint({
  featureIds = [],
  waterRegionIds = [],
  specialRegionIds = [],
  ownerCodes = [],
  refreshPresetTree = false,
} = {}) {
  const countryCodes = Array.from(
    new Set([
      ...collectCountryCodesForFeatureIds(featureIds),
      ...(Array.isArray(ownerCodes) ? ownerCodes.map((code) => canonicalCountryCode(code)).filter(Boolean) : []),
    ])
  );
  if (typeof state.renderWaterRegionListFn === "function" && Array.isArray(waterRegionIds)) {
    state.renderWaterRegionListFn();
  }
  if (typeof state.renderSpecialRegionListFn === "function" && Array.isArray(specialRegionIds)) {
    state.renderSpecialRegionListFn();
  }
  if (typeof state.refreshCountryListRowsFn === "function") {
    state.refreshCountryListRowsFn({
      countryCodes,
      refreshInspector: true,
      refreshPresetTree,
    });
    return;
  }
  if (typeof state.renderCountryListFn === "function") {
    state.renderCountryListFn();
  }
  if (refreshPresetTree && typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
}

function notifyDevWorkspace() {
  if (typeof state.updateDevWorkspaceUIFn === "function") {
    state.updateDevWorkspaceUIFn();
  }
}

function isDevSelectionEligibleFeature(feature, featureId = null) {
  return !!feature
    && !shouldExcludePoliticalInteractionFeature(feature, featureId)
    && !isAtlantropaSeaFeature(feature);
}

function setDevSelectionDirty() {
  state.devSelectionOverlayDirty = true;
  state.devClipboardFallbackText = "";
  notifyDevWorkspace();
}

function updateDevHoverHit(hit = null) {
  state.devHoverHit = hit?.id
    ? {
      id: String(hit.id || "").trim(),
      targetType: String(hit.targetType || ""),
      countryCode: String(hit.countryCode || "").trim().toUpperCase(),
      hitSource: String(hit.hitSource || "spatial"),
      viaSnap: !!hit.viaSnap,
      strict: !!hit.strict,
    }
    : null;
  notifyDevWorkspace();
}

function updateDevSelectedHit(hit = null) {
  state.devSelectedHit = hit?.id
    ? {
      id: String(hit.id || "").trim(),
      targetType: String(hit.targetType || ""),
      countryCode: String(hit.countryCode || "").trim().toUpperCase(),
      hitSource: String(hit.hitSource || "spatial"),
      viaSnap: !!hit.viaSnap,
      strict: !!hit.strict,
    }
    : null;
  notifyDevWorkspace();
}

function getDevSelectionIds() {
  const rawIds = Array.isArray(state.devSelectionOrder)
    ? state.devSelectionOrder.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
  const nextIds = [];
  const seen = new Set();
  rawIds.forEach((id) => {
    if (!id || seen.has(id)) return;
    const feature = state.landIndex?.get(id);
    if (!isDevSelectionEligibleFeature(feature, id)) return;
    seen.add(id);
    nextIds.push(id);
  });
  const changed = rawIds.length !== nextIds.length || rawIds.some((id, index) => id !== nextIds[index]);
  if (changed) {
    state.devSelectionOrder = nextIds;
    state.devSelectionFeatureIds = new Set(nextIds);
    state.devClipboardFallbackText = "";
    state.devSelectionOverlayDirty = true;
  } else if (!(state.devSelectionFeatureIds instanceof Set)) {
    state.devSelectionFeatureIds = new Set(nextIds);
  }
  return nextIds;
}

function addFeatureToDevSelection(featureId) {
  const id = String(featureId || "").trim();
  const feature = id ? state.landIndex?.get(id) : null;
  if (!isDevSelectionEligibleFeature(feature, id)) return false;
  state.devSelectionFeatureIds = state.devSelectionFeatureIds instanceof Set
    ? state.devSelectionFeatureIds
    : new Set();
  state.devSelectionOrder = getDevSelectionIds();
  if (state.devSelectionFeatureIds.has(id)) {
    return false;
  }
  const limit = Math.max(1, Number(state.devSelectionLimit) || 200);
  if (state.devSelectionOrder.length >= limit) {
    showToast(
      state.currentLanguage === "zh"
        ? `开发多选已达到上限（${limit}）。`
        : `Selection limit reached (${limit}).`,
      {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
      duration: 3600,
    });
    return false;
  }
  state.devSelectionFeatureIds.add(id);
  state.devSelectionOrder.push(id);
  setDevSelectionDirty();
  if (context) {
    render();
  }
  return true;
}

function toggleFeatureInDevSelection(featureId) {
  const id = String(featureId || "").trim();
  const feature = id ? state.landIndex?.get(id) : null;
  if (!isDevSelectionEligibleFeature(feature, id)) return false;
  state.devSelectionFeatureIds = state.devSelectionFeatureIds instanceof Set
    ? state.devSelectionFeatureIds
    : new Set();
  state.devSelectionOrder = getDevSelectionIds();
  if (state.devSelectionFeatureIds.has(id)) {
    state.devSelectionFeatureIds.delete(id);
    state.devSelectionOrder = state.devSelectionOrder.filter((value) => value !== id);
    setDevSelectionDirty();
    if (context) {
      render();
    }
    return true;
  }
  return addFeatureToDevSelection(id);
}

function removeLastDevSelection() {
  const ids = getDevSelectionIds();
  if (!ids.length) return false;
  const lastId = ids[ids.length - 1];
  state.devSelectionFeatureIds.delete(lastId);
  state.devSelectionOrder = ids.slice(0, -1);
  setDevSelectionDirty();
  if (context) {
    render();
  }
  return true;
}

function clearDevSelection() {
  const hadEntries = getDevSelectionIds().length > 0;
  state.devSelectionFeatureIds = new Set();
  state.devSelectionOrder = [];
  if (hadEntries) {
    setDevSelectionDirty();
    if (context) {
      render();
    }
  } else {
    notifyDevWorkspace();
  }
  return hadEntries;
}

function getDevWorkspaceActiveLandContext() {
  const selectedHit = state.devSelectedHit;
  const selectedId = selectedHit?.targetType === "land" ? String(selectedHit.id || "").trim() : "";
  const hoveredId = String(state.hoveredId || "").trim();
  const featureId = selectedId || hoveredId;
  if (!featureId) return null;
  const feature = state.landIndex?.get(featureId);
  if (!isDevSelectionEligibleFeature(feature, featureId)) return null;
  const countryCode = getFeatureCountryCodeNormalized(feature);
  return {
    featureId,
    feature,
    countryCode,
  };
}

function applyVisualFillToResolvedIds(targetIds, selectedColor, kind, dirtyReason) {
  const resolvedIds = Array.from(new Set((Array.isArray(targetIds) ? targetIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
  if (!resolvedIds.length) return false;
  return applyVisualSubdivisionFill(resolvedIds, selectedColor, {
    kind,
    dirtyReason,
  });
}

function eraseVisualOverridesForIds(targetIds, { kind, dirtyReason } = {}) {
  const resolvedIds = Array.from(new Set((Array.isArray(targetIds) ? targetIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
  if (!resolvedIds.length) return false;
  const historyBefore = captureHistoryState({
    featureIds: resolvedIds,
  });
  resolvedIds.forEach((targetId) => {
    delete state.visualOverrides[targetId];
    delete state.featureOverrides[targetId];
  });
  refreshResolvedColorsForFeatures(resolvedIds, { renderNow: false });
  markDirty(dirtyReason || kind || "erase-feature-color");
  commitHistoryEntry({
    kind: kind || "erase-feature-color",
    before: historyBefore,
    after: captureHistoryState({
      featureIds: resolvedIds,
    }),
  });
  if (context) {
    render();
  }
  refreshSidebarAfterPaint({ featureIds: resolvedIds });
  return true;
}

function applySovereigntyFillToIds(targetIds, { kind, dirtyReason, recomputeReason } = {}) {
  const resolvedIds = Array.from(new Set((Array.isArray(targetIds) ? targetIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
  if (!resolvedIds.length) return false;
  if (!state.activeSovereignCode) {
    showToast(t("No active sovereign selected.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  const historyBefore = captureHistoryState({
    sovereigntyFeatureIds: resolvedIds,
  });
  const changed = setFeatureOwnerCodes(resolvedIds, state.activeSovereignCode);
  refreshResolvedColorsForFeatures(resolvedIds, { renderNow: false });
  if (changed > 0) {
    scheduleDynamicBorderRecompute(recomputeReason || kind || "dev-workspace-sovereignty-fill", 90);
    markDirty(dirtyReason || kind || "fill-sovereignty");
    commitHistoryEntry({
      kind: kind || "fill-sovereignty",
      before: historyBefore,
      after: captureHistoryState({
        sovereigntyFeatureIds: resolvedIds,
      }),
      affectsSovereignty: true,
    });
    if (context) {
      render();
    }
    refreshSidebarAfterPaint({ featureIds: resolvedIds });
    return true;
  }
  return false;
}

function eraseSovereigntyForIds(targetIds, { kind, dirtyReason, recomputeReason } = {}) {
  const resolvedIds = Array.from(new Set((Array.isArray(targetIds) ? targetIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
  if (!resolvedIds.length) return false;
  const historyBefore = captureHistoryState({
    sovereigntyFeatureIds: resolvedIds,
  });
  const changed = resetFeatureOwnerCodes(resolvedIds);
  refreshResolvedColorsForFeatures(resolvedIds, { renderNow: false });
  if (changed > 0) {
    scheduleDynamicBorderRecompute(recomputeReason || kind || "dev-workspace-sovereignty-reset", 90);
    markDirty(dirtyReason || kind || "erase-sovereignty");
    commitHistoryEntry({
      kind: kind || "erase-sovereignty",
      before: historyBefore,
      after: captureHistoryState({
        sovereigntyFeatureIds: resolvedIds,
      }),
      affectsSovereignty: true,
    });
    if (context) {
      render();
    }
    refreshSidebarAfterPaint({ featureIds: resolvedIds });
    return true;
  }
  return false;
}

function applyDevLandBatchAction(targetIds, {
  ownerCodes = [],
  visualKind = "dev-batch-fill",
  visualDirtyReason = visualKind,
  sovereigntyFillKind = "dev-batch-sovereignty-fill",
  sovereigntyEraseKind = "dev-batch-sovereignty-reset",
  recomputeReason = "dev-batch",
} = {}) {
  const resolvedIds = Array.from(new Set((Array.isArray(targetIds) ? targetIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
  if (!resolvedIds.length) return false;
  if (state.currentTool === "eyedropper") {
    showToast(t("Switch to Fill or Eraser before running a batch action.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  if (isSovereigntyModeActive()) {
    return state.currentTool === "eraser"
      ? eraseSovereigntyForIds(resolvedIds, {
        kind: sovereigntyEraseKind,
        dirtyReason: sovereigntyEraseKind,
        recomputeReason,
      })
      : applySovereigntyFillToIds(resolvedIds, {
        kind: sovereigntyFillKind,
        dirtyReason: sovereigntyFillKind,
        recomputeReason,
      });
  }
  if (state.currentTool === "eraser") {
    return eraseVisualOverridesForIds(resolvedIds, {
      kind: `${visualKind}-erase`,
      dirtyReason: `${visualDirtyReason}-erase`,
    });
  }
  const color = getSafeCanvasColor(state.selectedColor, LAND_FILL_COLOR);
  if (ownerCodes.length === 1) {
    refreshSidebarAfterPaint({
      featureIds: resolvedIds,
      ownerCodes,
    });
  }
  return applyVisualFillToResolvedIds(resolvedIds, color, visualKind, visualDirtyReason);
}

function applyDevMacroFillCurrentCountry() {
  const contextInfo = getDevWorkspaceActiveLandContext();
  if (!contextInfo?.countryCode) {
    showToast(t("Select or hover a land feature first.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  const ids = getCountryFeatureIds(contextInfo.countryCode);
  if (!ids.length) return false;
  return applyDevLandBatchAction(ids, {
    ownerCodes: [contextInfo.countryCode],
    visualKind: "dev-fill-country",
    visualDirtyReason: "dev-fill-country",
    sovereigntyFillKind: "dev-fill-country-sovereignty",
    sovereigntyEraseKind: "dev-erase-country-sovereignty",
    recomputeReason: "dev-fill-country",
  });
}

function applyDevMacroFillCurrentParentGroup() {
  const contextInfo = getDevWorkspaceActiveLandContext();
  if (!contextInfo) {
    showToast(t("Select or hover a land feature first.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  const ids = resolveParentGroupTargetIds(contextInfo.feature, contextInfo.featureId);
  if (!ids.length) {
    showToast(t("No parent group is available for this feature.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  return applyDevLandBatchAction(ids, {
    visualKind: "dev-fill-parent-group",
    visualDirtyReason: "dev-fill-parent-group",
    sovereigntyFillKind: "dev-fill-parent-group-sovereignty",
    sovereigntyEraseKind: "dev-erase-parent-group-sovereignty",
    recomputeReason: "dev-fill-parent-group",
  });
}

function applyDevMacroFillCurrentOwnerScope() {
  const contextInfo = getDevWorkspaceActiveLandContext();
  if (!contextInfo) {
    showToast(t("Select or hover a land feature first.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  const ownerCode = getFeatureOwnerCode(contextInfo.featureId) || contextInfo.countryCode;
  const ids = getFeatureIdsForOwner(ownerCode)
    .map((value) => String(value || "").trim())
    .filter((featureId) => featureId && state.landIndex?.has(featureId));
  if (!ids.length) {
    showToast(t("No owner scope is available for this feature.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  return applyDevLandBatchAction(ids, {
    ownerCodes: ownerCode ? [ownerCode] : [],
    visualKind: "dev-fill-owner-scope",
    visualDirtyReason: "dev-fill-owner-scope",
    sovereigntyFillKind: "dev-fill-owner-scope-sovereignty",
    sovereigntyEraseKind: "dev-erase-owner-scope-sovereignty",
    recomputeReason: "dev-fill-owner-scope",
  });
}

function applyDevSelectionFill() {
  const ids = getDevSelectionIds();
  if (!ids.length) {
    showToast(t("No selected regions in the development selection.", "ui"), {
      title: t("Dev Workspace", "ui"),
      tone: "warning",
    });
    return false;
  }
  return applyDevLandBatchAction(ids, {
    visualKind: "dev-fill-selection",
    visualDirtyReason: "dev-fill-selection",
    sovereigntyFillKind: "dev-fill-selection-sovereignty",
    sovereigntyEraseKind: "dev-erase-selection-sovereignty",
    recomputeReason: "dev-fill-selection",
  });
}

function resolveInteractionTargetIds(feature, id) {
  if (shouldExcludePoliticalInteractionFeature(feature, id)) {
    return [];
  }
  if (isSovereigntyModeActive()) {
    return [id];
  }
  if (state.interactionGranularity !== "country") {
    return [id];
  }
  const countryCode = getFeatureCountryCodeNormalized(feature);
  if (!countryCode) {
    return [id];
  }
  const ids = getCountryFeatureIds(countryCode);
  return ids.length ? ids : [id];
}

function isBrushNavigationModifier(event) {
  return !!(state.brushModeEnabled && event?.shiftKey);
}

function shouldAllowZoomEvent(event) {
  const type = String(event?.type || "").toLowerCase();
  if (type === "wheel") return true;
  if (type.startsWith("touch")) return true;
  if (event?.ctrlKey) return false;
  if (typeof event?.button === "number" && event.button !== 0) return false;
  if (state.specialZoneEditor?.active) return false;
  if (state.brushModeEnabled) {
    return isBrushNavigationModifier(event);
  }
  return true;
}

function resolveParentGroupKey(feature, featureId) {
  const countryCode = getFeatureCountryCodeNormalized(feature);
  if (!countryCode) return "";
  const fallbackGroup = state.parentGroupByFeatureId?.get(featureId);
  const directGroup = getAdmin1Group(feature);
  const groupName = String(fallbackGroup || directGroup || "").trim();
  if (!groupName) return "";
  return `${countryCode}::${groupName}`;
}

function resolveParentGroupTargetIds(feature, featureId) {
  if (!featureId || !state.landIndex?.has(featureId)) return [];
  if (shouldExcludePoliticalInteractionFeature(feature, featureId)) return [];
  const countryCode = getFeatureCountryCodeNormalized(feature);
  const parentGroupKey = resolveParentGroupKey(feature, featureId);
  if (!countryCode || !parentGroupKey) return [];
  const ids = getCountryFeatureIds(countryCode);
  if (!ids.length) return [];
  const targetIds = ids.filter((candidateId) => {
    const candidateFeature = state.landIndex.get(candidateId);
    if (!candidateFeature) return false;
    if (shouldExcludePoliticalInteractionFeature(candidateFeature, candidateId)) return false;
    return resolveParentGroupKey(candidateFeature, candidateId) === parentGroupKey;
  });
  if (targetIds.length < 2) return [];
  return Array.from(new Set(targetIds));
}

function resolveCountryFillTargetIds(feature, featureId, { allowWhenParentGrouping = false } = {}) {
  if (!featureId || !state.landIndex?.has(featureId)) return [];
  if (shouldExcludePoliticalInteractionFeature(feature, featureId)) return [];
  const countryCode = getFeatureCountryCodeNormalized(feature);
  if (!countryCode) return [];
  const ids = getCountryFeatureIds(countryCode).filter((candidateId) => {
    const candidateFeature = state.landIndex.get(candidateId);
    return candidateFeature && !shouldExcludePoliticalInteractionFeature(candidateFeature, candidateId);
  });
  if (ids.length < 2) return [];

  if (!allowWhenParentGrouping) {
    const hasParentGrouping = ids.some((candidateId) => {
      const candidateFeature = state.landIndex.get(candidateId);
      if (!candidateFeature) return false;
      return !!resolveParentGroupKey(candidateFeature, candidateId);
    });
    if (hasParentGrouping) return [];
  }

  return ids;
}

function isBatchFillDoubleClickBaseEligible(hit, feature) {
  if (!hit?.id || !feature) return false;
  if (state.currentTool !== "fill") return false;
  if (isSovereigntyModeActive()) return false;
  if (state.interactionGranularity !== "subdivision") return false;
  if (state.brushModeEnabled) return false;
  if (state.specialZoneEditor?.active) return false;
  return true;
}

function buildDoubleClickBatchPlan(feature, featureId) {
  if (!feature || !featureId) return null;
  if (shouldExcludePoliticalInteractionFeature(feature, featureId)) return null;
  const requestedScope = String(state.batchFillScope || "parent") === "country" ? "country" : "parent";
  if (requestedScope === "parent") {
    const parentTargetIds = resolveParentGroupTargetIds(feature, featureId);
    if (parentTargetIds.length >= 2) {
      return {
        targetIds: parentTargetIds,
        kind: "fill-parent-group",
        dirtyReason: "fill-parent-group",
        fallbackToCountry: false,
      };
    }
  }

  const countryTargetIds = resolveCountryFillTargetIds(feature, featureId, {
    allowWhenParentGrouping: true,
  });
  if (countryTargetIds.length >= 2) {
    return {
      targetIds: countryTargetIds,
      kind: "fill-country-batch",
      dirtyReason: "fill-country-batch",
      fallbackToCountry: requestedScope === "parent",
    };
  }
  return null;
}

function isDoubleClickBatchEligible(hit, feature) {
  if (!isBatchFillDoubleClickBaseEligible(hit, feature)) return false;
  return !!buildDoubleClickBatchPlan(feature, hit.id);
}

function applyVisualSubdivisionFill(targetIds, selectedColor, { kind = "fill-feature-color", dirtyReason = kind } = {}) {
  const actionStart = nowMs();
  const resolvedIds = Array.from(new Set((Array.isArray(targetIds) ? targetIds : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean)));
  if (!resolvedIds.length) return false;
  const color = getSafeCanvasColor(selectedColor, LAND_FILL_COLOR);
  const historyBefore = captureHistoryState({
    featureIds: resolvedIds,
  });
  resolvedIds.forEach((targetId) => {
    state.visualOverrides[targetId] = color;
    state.featureOverrides[targetId] = color;
  });
  refreshResolvedColorsForFeatures(resolvedIds, { renderNow: false });
  markDirty(dirtyReason);
  commitHistoryEntry({
    kind,
    before: historyBefore,
    after: captureHistoryState({
      featureIds: resolvedIds,
    }),
  });
  addRecentColor(color);
  if (context) {
    render();
  }
  refreshSidebarAfterPaint({ featureIds: resolvedIds });
  noteRenderAction(kind, actionStart);
  return true;
}

function applyWaterRegionFill(targetId, selectedColor, { kind = "fill-water-region-color", dirtyReason = kind } = {}) {
  const actionStart = nowMs();
  const resolvedId = String(targetId || "").trim();
  if (!resolvedId) return false;
  const defaultColor = getWaterRegionDefaultFillColorById(resolvedId);
  const color = getSafeCanvasColor(selectedColor, defaultColor);
  const currentColor = getWaterRegionColor(resolvedId);
  state.selectedWaterRegionId = resolvedId;
  if (currentColor === color) {
    if (typeof state.renderWaterRegionListFn === "function") {
      state.renderWaterRegionListFn();
    }
    return false;
  }
  const historyBefore = captureHistoryState({
    waterRegionIds: [resolvedId],
  });
  state.waterRegionOverrides[resolvedId] = color;
  markDirty(dirtyReason);
  commitHistoryEntry({
    kind,
    before: historyBefore,
    after: captureHistoryState({
      waterRegionIds: [resolvedId],
    }),
  });
  addRecentColor(color);
  if (context) {
    render();
  }
  refreshSidebarAfterPaint({ waterRegionIds: [resolvedId] });
  noteRenderAction(kind, actionStart);
  return true;
}

function executeSingleSubdivisionFill(action) {
  if (!action) return false;
  const targetIds = action.eventPayload?.targetIds || [action.featureId];
  return applyVisualSubdivisionFill(targetIds, action.selectedColor, {
    kind: "fill-feature-color",
    dirtyReason: "fill-feature-color",
  });
}

function executeBatchFill(action, resolverFn, kind) {
  if (!action) return false;
  const feature = action.eventPayload?.feature || state.landIndex.get(action.featureId);
  const targetIds = resolverFn(feature, action.featureId);
  if (!targetIds.length) {
    return executeSingleSubdivisionFill(action);
  }
  return applyVisualSubdivisionFill(targetIds, action.selectedColor, {
    kind,
    dirtyReason: kind,
  });
}

function executeDoubleClickBatchFill(feature, featureId) {
  if (!feature || !featureId) return false;
  const plan = buildDoubleClickBatchPlan(feature, featureId);
  if (!plan?.targetIds?.length) return false;
  if (plan.fallbackToCountry) {
    showDetailPromotionToast("No parent group was available here. Double-click fell back to country fill.", {
      title: "Quick fill scope",
      tone: "info",
      duration: 2400,
    });
  }
  return applyVisualSubdivisionFill(plan.targetIds, state.selectedColor, {
    kind: plan.kind,
    dirtyReason: plan.dirtyReason,
  });
}

function mergeHistorySnapshot(target, snapshot) {
  if (!snapshot || typeof snapshot !== "object") return;
  Object.entries(snapshot).forEach(([section, patch]) => {
    if (!patch || typeof patch !== "object") return;
    target[section] = target[section] || {};
    Object.assign(target[section], patch);
  });
}

function ensureBrushSession(event) {
  if (brushSession) return brushSession;
  brushSession = {
    active: true,
    dragging: false,
    startX: Number(event?.clientX || 0),
    startY: Number(event?.clientY || 0),
    visitedFeatureIds: new Set(),
    visitedWaterRegionIds: new Set(),
    visitedSpecialRegionIds: new Set(),
    visitedOwnerCodes: new Set(),
    affectedFeatureIds: new Set(),
    affectedWaterRegionIds: new Set(),
    affectedSpecialRegionIds: new Set(),
    affectedOwnerCodes: new Set(),
    affectedSovereigntyIds: new Set(),
    before: {},
    changed: false,
  };
  return brushSession;
}

function applyBrushHit(hit) {
  if (!hit?.id) return false;
  if (hit.targetType === "special") {
    const specialId = String(hit.id || "").trim();
    if (!specialId || brushSession.visitedSpecialRegionIds.has(specialId)) return false;
    if (state.currentTool === "eyedropper") return false;
    mergeHistorySnapshot(brushSession.before, captureHistoryState({ specialRegionIds: [specialId] }));
    brushSession.visitedSpecialRegionIds.add(specialId);
    brushSession.affectedSpecialRegionIds.add(specialId);
    if (state.currentTool === "eraser") {
      delete state.specialRegionOverrides[specialId];
    } else {
      state.specialRegionOverrides[specialId] = getSafeCanvasColor(
        state.selectedColor,
        getSpecialRegionColor(specialId)
      );
    }
    state.selectedSpecialRegionId = specialId;
    brushSession.changed = true;
    return true;
  }
  if (hit.targetType === "water") {
    const waterId = String(hit.id || "").trim();
    if (!waterId || brushSession.visitedWaterRegionIds.has(waterId)) return false;
    if (state.currentTool === "eyedropper") return false;
    mergeHistorySnapshot(brushSession.before, captureHistoryState({ waterRegionIds: [waterId] }));
    brushSession.visitedWaterRegionIds.add(waterId);
    brushSession.affectedWaterRegionIds.add(waterId);
    if (state.currentTool === "eraser") {
      delete state.waterRegionOverrides[waterId];
    } else {
      state.waterRegionOverrides[waterId] = getSafeCanvasColor(
        state.selectedColor,
        getWaterRegionDefaultFillColorById(waterId)
      );
    }
    state.selectedWaterRegionId = waterId;
    brushSession.changed = true;
    return true;
  }
  const feature = state.landIndex.get(hit.id);
  if (!feature) return false;
  const id = hit.id;
  const countryCode = hit.countryCode || getFeatureCountryCodeNormalized(feature);
  if (!requestLeafDetailPromotion(countryCode, { announce: true })) {
    return false;
  }
  const targetIds = resolveInteractionTargetIds(feature, id);
  const selectedColor = getSafeCanvasColor(state.selectedColor, LAND_FILL_COLOR);

  if (state.currentTool === "eyedropper") return false;
  if (state.currentTool === "eraser") {
    if (isSovereigntyModeActive()) {
      const freshIds = targetIds.filter((targetId) => !brushSession.affectedSovereigntyIds.has(targetId));
      if (!freshIds.length) return false;
      mergeHistorySnapshot(brushSession.before, captureHistoryState({ sovereigntyFeatureIds: freshIds }));
      freshIds.forEach((targetId) => brushSession.affectedSovereigntyIds.add(targetId));
      const changed = resetFeatureOwnerCodes(targetIds);
      if (changed > 0) {
        brushSession.changed = true;
        refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
        scheduleDynamicBorderRecompute("brush-sovereignty-reset", 90);
        return true;
      }
      return false;
    }
    if (state.interactionGranularity === "country" && countryCode) {
      if (brushSession.visitedOwnerCodes.has(countryCode)) return false;
      brushSession.visitedOwnerCodes.add(countryCode);
      mergeHistorySnapshot(brushSession.before, captureHistoryState({ ownerCodes: [countryCode] }));
      brushSession.affectedOwnerCodes.add(countryCode);
      delete state.sovereignBaseColors[countryCode];
      delete state.countryBaseColors[countryCode];
      refreshResolvedColorsForOwners([countryCode], { renderNow: false });
      brushSession.changed = true;
      return true;
    }
    const freshIds = targetIds.filter((targetId) => !brushSession.visitedFeatureIds.has(targetId));
    if (!freshIds.length) return false;
    mergeHistorySnapshot(brushSession.before, captureHistoryState({ featureIds: freshIds }));
    freshIds.forEach((targetId) => {
      brushSession.visitedFeatureIds.add(targetId);
      brushSession.affectedFeatureIds.add(targetId);
      delete state.visualOverrides[targetId];
      delete state.featureOverrides[targetId];
    });
    refreshResolvedColorsForFeatures(freshIds, { renderNow: false });
    brushSession.changed = true;
    return true;
  }

  if (isSovereigntyModeActive()) {
    if (!state.activeSovereignCode) return false;
    const freshIds = targetIds.filter((targetId) => !brushSession.affectedSovereigntyIds.has(targetId));
    if (!freshIds.length) return false;
    mergeHistorySnapshot(brushSession.before, captureHistoryState({ sovereigntyFeatureIds: freshIds }));
    freshIds.forEach((targetId) => brushSession.affectedSovereigntyIds.add(targetId));
    const changed = setFeatureOwnerCodes(targetIds, state.activeSovereignCode);
    if (changed > 0) {
      brushSession.changed = true;
      refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
      scheduleDynamicBorderRecompute("brush-sovereignty-fill", 90);
      return true;
    }
    return false;
  }

  if (state.interactionGranularity === "country" && countryCode) {
    if (brushSession.visitedOwnerCodes.has(countryCode)) return false;
    brushSession.visitedOwnerCodes.add(countryCode);
    mergeHistorySnapshot(brushSession.before, captureHistoryState({ ownerCodes: [countryCode] }));
    brushSession.affectedOwnerCodes.add(countryCode);
    state.sovereignBaseColors[countryCode] = selectedColor;
    state.countryBaseColors[countryCode] = selectedColor;
    refreshResolvedColorsForOwners([countryCode], { renderNow: false });
    brushSession.changed = true;
    return true;
  }

  const freshIds = targetIds.filter((targetId) => !brushSession.visitedFeatureIds.has(targetId));
  if (!freshIds.length) return false;
  mergeHistorySnapshot(brushSession.before, captureHistoryState({ featureIds: freshIds }));
  freshIds.forEach((targetId) => {
    brushSession.visitedFeatureIds.add(targetId);
    brushSession.affectedFeatureIds.add(targetId);
    state.visualOverrides[targetId] = selectedColor;
    state.featureOverrides[targetId] = selectedColor;
  });
  refreshResolvedColorsForFeatures(freshIds, { renderNow: false });
  brushSession.changed = true;
  return true;
}

function flushBrushSession() {
  const actionStart = nowMs();
  if (!brushSession) return;
  const current = brushSession;
  brushSession = null;
  if (current.dragging) {
    suppressNextClickAfterBrush = true;
  }
  if (!current.dragging || !current.changed) return;
  const featureIds = Array.from(current.affectedFeatureIds);
  const waterRegionIds = Array.from(current.affectedWaterRegionIds);
  const specialRegionIds = Array.from(current.affectedSpecialRegionIds);
  const ownerCodes = Array.from(current.affectedOwnerCodes);
  const sovereigntyFeatureIds = Array.from(current.affectedSovereigntyIds);
  const after = captureHistoryState({ featureIds, waterRegionIds, specialRegionIds, ownerCodes, sovereigntyFeatureIds });
  pushHistoryEntry({
    kind: state.currentTool === "eraser" ? "brush-erase" : "brush-fill",
    before: current.before,
    after,
    meta: {
      affectsSovereignty: isSovereigntyModeActive(),
    },
  });
  if (state.currentTool !== "eyedropper") {
    addRecentColor(state.selectedColor);
  }
  markDirty("brush-stroke");
  refreshSidebarAfterPaint({
    featureIds,
    waterRegionIds,
    specialRegionIds,
    ownerCodes,
  });
  if (typeof state.renderNowFn === "function") {
    state.renderNowFn();
  }
  noteRenderAction("brush-stroke", actionStart);
}

function handleBrushPointerDown(event) {
  if (!state.brushModeEnabled || state.currentTool === "eyedropper" || state.specialZoneEditor?.active) return;
  if (isBrushNavigationModifier(event)) return;
  if ((event.buttons & 1) !== 1) return;
  if (event?.preventDefault) event.preventDefault();
  ensureBrushSession(event);
}

function handleBrushPointerMove(event) {
  if (!brushSession || !state.brushModeEnabled || state.currentTool === "eyedropper" || state.specialZoneEditor?.active) {
    return;
  }
  if ((event.buttons & 1) !== 1) {
    flushBrushSession();
    return;
  }
  const dx = Number(event.clientX || 0) - brushSession.startX;
  const dy = Number(event.clientY || 0) - brushSession.startY;
  if (!brushSession.dragging && Math.hypot(dx, dy) <= 3) return;
  brushSession.dragging = true;
  const hit = getHitFromEvent(event, {
    enableSnap: false,
    snapPx: 0,
    eventType: "brush",
  });
  if (!hit?.id) return;
  if (applyBrushHit(hit) && context) {
    render();
  }
}

async function handleClick(event) {
  const actionStart = nowMs();
  if (!state.landData && !state.waterRegionsData && !state.scenarioSpecialRegionsData) return;
  if (suppressNextClickAfterBrush) {
    suppressNextClickAfterBrush = false;
    return;
  }
  if (typeof state.dismissOnboardingHintFn === "function") {
    state.dismissOnboardingHintFn();
  }
  if (state.specialZoneEditor?.active) {
    appendSpecialZoneVertexFromEvent(event);
    return;
  }

  const hit = getHitFromEvent(event, {
    enableSnap: true,
    snapPx: HIT_SNAP_RADIUS_CLICK_PX,
    eventType: "click",
  });
  const id = hit.id;
  if (!id) return;
  updateDevSelectedHit(hit);
  if (hit.targetType === "special") {
    const specialFeature = state.specialRegionsById.get(id);
    if (!specialFeature) return;
    state.selectedWaterRegionId = "";
    if (typeof state.renderWaterRegionListFn === "function") {
      state.renderWaterRegionListFn();
    }
    state.selectedSpecialRegionId = id;
    if (typeof state.renderSpecialRegionListFn === "function") {
      state.renderSpecialRegionListFn();
    }
    if (state.currentTool === "eraser") {
      const historyBefore = captureHistoryState({ specialRegionIds: [id] });
      delete state.specialRegionOverrides[id];
      markDirty("erase-special-region-color");
      commitHistoryEntry({
        kind: "erase-special-region-color",
        before: historyBefore,
        after: captureHistoryState({ specialRegionIds: [id] }),
      });
      if (context) {
        render();
      }
      refreshSidebarAfterPaint({ specialRegionIds: [id] });
      noteRenderAction("click-erase-special", actionStart);
      return;
    }
    if (state.currentTool === "eyedropper") {
      const picked = getSpecialRegionColor(id, specialFeature);
      if (picked) {
        state.selectedColor = picked;
        if (typeof state.updateSwatchUIFn === "function") {
          state.updateSwatchUIFn();
        }
      }
      noteRenderAction("eyedropper-special", actionStart);
      return;
    }
    const currentColor = getSpecialRegionColor(id, specialFeature);
    const nextColor = getSafeCanvasColor(state.selectedColor, currentColor);
    if (nextColor !== currentColor) {
      const historyBefore = captureHistoryState({ specialRegionIds: [id] });
      state.specialRegionOverrides[id] = nextColor;
      markDirty("fill-special-region-color");
      commitHistoryEntry({
        kind: "fill-special-region-color",
        before: historyBefore,
        after: captureHistoryState({ specialRegionIds: [id] }),
      });
      addRecentColor(nextColor);
      if (context) {
        render();
      }
      refreshSidebarAfterPaint({ specialRegionIds: [id] });
    }
    noteRenderAction("click-fill-special", actionStart);
    return;
  }
  if (hit.targetType === "water") {
    const waterFeature = state.waterRegionsById.get(id);
    if (!waterFeature) return;
    state.selectedSpecialRegionId = "";
    if (typeof state.renderSpecialRegionListFn === "function") {
      state.renderSpecialRegionListFn();
    }
    state.selectedWaterRegionId = id;
    if (typeof state.renderWaterRegionListFn === "function") {
      state.renderWaterRegionListFn();
    }
    if (state.currentTool === "eraser") {
      const historyBefore = captureHistoryState({ waterRegionIds: [id] });
      delete state.waterRegionOverrides[id];
      markDirty("erase-water-region-color");
      commitHistoryEntry({
        kind: "erase-water-region-color",
        before: historyBefore,
        after: captureHistoryState({ waterRegionIds: [id] }),
      });
      if (context) {
        render();
      }
      refreshSidebarAfterPaint({ waterRegionIds: [id] });
      noteRenderAction("click-erase-water", actionStart);
      return;
    }
    if (state.currentTool === "eyedropper") {
      const picked = getWaterRegionColor(id);
      if (picked) {
        state.selectedColor = picked;
        if (typeof state.updateSwatchUIFn === "function") {
          state.updateSwatchUIFn();
        }
      }
      noteRenderAction("eyedropper-water", actionStart);
      return;
    }
    applyWaterRegionFill(id, state.selectedColor, {
      kind: "fill-water-region-color",
      dirtyReason: "fill-water-region-color",
    });
    return;
  }
  if (state.selectedWaterRegionId) {
    state.selectedWaterRegionId = "";
    if (typeof state.renderWaterRegionListFn === "function") {
      state.renderWaterRegionListFn();
    }
  }
  if (state.selectedSpecialRegionId) {
    state.selectedSpecialRegionId = "";
    if (typeof state.renderSpecialRegionListFn === "function") {
      state.renderSpecialRegionListFn();
    }
  }
  let landHit = hit;
  let landId = id;
  let feature = state.landIndex.get(landId);
  if (!feature) return;
  if (state.devSelectionModeEnabled && (event?.ctrlKey || event?.metaKey)) {
    toggleFeatureInDevSelection(landId);
    if (context) {
      render();
    }
    noteRenderAction("dev-selection-toggle", actionStart);
    return;
  }
  let countryCode = landHit.countryCode || getFeatureCountryCodeNormalized(feature);
  if (!(await ensureLeafDetailReady(countryCode, { announce: true }))) {
    return;
  }
  if (shouldRequireLeafDetail(countryCode)) {
    const refreshedHit = getHitFromEvent(event, {
      enableSnap: true,
      snapPx: HIT_SNAP_RADIUS_CLICK_PX,
      eventType: "click",
    });
    const refreshedId = refreshedHit.id;
    const refreshedFeature = refreshedId ? state.landIndex.get(refreshedId) : null;
    if (refreshedHit.targetType === "land" && refreshedId && refreshedFeature) {
      landHit = refreshedHit;
      landId = refreshedId;
      feature = refreshedFeature;
      countryCode = landHit.countryCode || getFeatureCountryCodeNormalized(feature);
      updateDevSelectedHit(landHit);
    }
  }
  const targetIds = resolveInteractionTargetIds(feature, landId);

  if (state.isEditingPreset) {
    if (typeof globalThis.togglePresetRegion === "function") {
      globalThis.togglePresetRegion(landId);
    }
    return;
  }

  if (state.currentTool === "eraser") {
    const shouldRefreshCountryList = (!!countryCode);
    let historyBefore = null;
    if (isSovereigntyModeActive()) {
      historyBefore = captureHistoryState({
        sovereigntyFeatureIds: targetIds,
      });
      const changed = resetFeatureOwnerCodes(targetIds);
      refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
      if (changed > 0) {
        markDirty("erase-sovereignty");
        if (targetIds.length > 1) {
          scheduleDynamicBorderRecompute("sovereignty-batch-reset", 90);
        } else {
          scheduleDynamicBorderRecompute("sovereignty-single-reset", 150);
        }
        commitHistoryEntry({
          kind: "erase-sovereignty",
          before: historyBefore,
          after: captureHistoryState({
            sovereigntyFeatureIds: targetIds,
          }),
          affectsSovereignty: true,
        });
      }
    } else if (state.interactionGranularity === "country" && countryCode) {
      historyBefore = captureHistoryState({
        ownerCodes: [countryCode],
      });
      delete state.sovereignBaseColors[countryCode];
      delete state.countryBaseColors[countryCode];
      refreshResolvedColorsForOwners([countryCode], { renderNow: false });
      markDirty("erase-country-color");
      commitHistoryEntry({
        kind: "erase-country-color",
        before: historyBefore,
        after: captureHistoryState({
          ownerCodes: [countryCode],
        }),
      });
    } else {
      historyBefore = captureHistoryState({
        featureIds: targetIds,
      });
      targetIds.forEach((targetId) => {
        delete state.visualOverrides[targetId];
        delete state.featureOverrides[targetId];
      });
      refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
      markDirty("erase-feature-color");
      commitHistoryEntry({
        kind: "erase-feature-color",
        before: historyBefore,
        after: captureHistoryState({
          featureIds: targetIds,
        }),
      });
    }
    if (context) {
      render();
    }
    if (shouldRefreshCountryList) {
      refreshSidebarAfterPaint({
        featureIds: targetIds,
        ownerCodes: countryCode ? [countryCode] : [],
      });
    }
    noteRenderAction("click-erase", actionStart);
    return;
  }

  if (state.currentTool === "eyedropper") {
    if (isSovereigntyModeActive()) {
      const ownerCode = getFeatureOwnerCode(landId) || countryCode;
      if (ownerCode) {
        const previousActiveOwner = state.activeSovereignCode;
        state.activeSovereignCode = ownerCode;
        if (typeof state.updateActiveSovereignUIFn === "function") {
          state.updateActiveSovereignUIFn();
        }
        refreshSidebarAfterPaint({
          ownerCodes: [previousActiveOwner, ownerCode],
        });
      }
    } else {
      const picked =
        (state.interactionGranularity === "country" && countryCode
          ? getSafeCanvasColor(state.sovereignBaseColors?.[countryCode] || state.countryBaseColors?.[countryCode], null)
          : null) ||
        getSafeCanvasColor(state.colors[landId], null);
      if (picked) {
        state.selectedColor = picked;
        if (typeof state.updateSwatchUIFn === "function") {
          state.updateSwatchUIFn();
        }
      }
    }
    noteRenderAction("eyedropper", actionStart);
    return;
  }

  const selectedColor = getSafeCanvasColor(state.selectedColor, LAND_FILL_COLOR);
  state.selectedColor = selectedColor;
  if (isSovereigntyModeActive()) {
    const historyBefore = captureHistoryState({
      sovereigntyFeatureIds: targetIds,
    });
    if (!state.activeSovereignCode) {
      console.warn("[sovereignty] No active sovereign selected.");
      return;
    }
    const changed = setFeatureOwnerCodes(targetIds, state.activeSovereignCode);
    refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
    if (changed > 0) {
      if (targetIds.length > 1) {
        scheduleDynamicBorderRecompute("sovereignty-batch-fill", 90);
      } else {
        scheduleDynamicBorderRecompute("sovereignty-single-fill", 150);
      }
    }
    if (changed > 0) {
      markDirty("fill-sovereignty");
      commitHistoryEntry({
        kind: "fill-sovereignty",
        before: historyBefore,
        after: captureHistoryState({
          sovereigntyFeatureIds: targetIds,
        }),
        affectsSovereignty: true,
      });
    }
  } else if (state.interactionGranularity === "country" && countryCode) {
    const historyBefore = captureHistoryState({
      ownerCodes: [countryCode],
    });
    state.sovereignBaseColors[countryCode] = selectedColor;
    state.countryBaseColors[countryCode] = selectedColor;
    refreshResolvedColorsForOwners([countryCode], { renderNow: false });
    markDirty("fill-country-color");
    commitHistoryEntry({
      kind: "fill-country-color",
      before: historyBefore,
      after: captureHistoryState({
        ownerCodes: [countryCode],
      }),
    });
  } else {
    const clickCount = Math.max(1, Number(event?.detail || 1));
    if (clickCount >= 2 && isDoubleClickBatchEligible(landHit, feature)) {
      return;
    }
    applyVisualSubdivisionFill(targetIds, selectedColor, {
      kind: "fill-feature-color",
      dirtyReason: "fill-feature-color",
    });
    return;
  }
  addRecentColor(selectedColor);
  if (context) {
    render();
  }
  if (isSovereigntyModeActive() || (state.interactionGranularity === "country" && countryCode)) {
    refreshSidebarAfterPaint({
      featureIds: targetIds,
      ownerCodes: countryCode ? [countryCode] : [],
    });
  }
  noteRenderAction("click-fill", actionStart);
}

async function handleDoubleClick(event) {
  const actionStart = nowMs();
  if (state.specialZoneEditor?.active) {
    if (event?.preventDefault) event.preventDefault();
    finishSpecialZoneDraw();
    return;
  }
  if (!state.landData) return;
  if (event?.preventDefault) event.preventDefault();

  const hit = getHitFromEvent(event, {
    enableSnap: true,
    snapPx: HIT_SNAP_RADIUS_CLICK_PX,
    eventType: "dblclick",
  });
  const id = hit.id;
  if (!id) return;
  let feature = state.landIndex.get(id);
  if (!feature) return;
  let featureId = id;
  let countryCode = hit.countryCode || getFeatureCountryCodeNormalized(feature);
  if (!(await ensureLeafDetailReady(countryCode, { announce: true }))) {
    return;
  }
  if (shouldRequireLeafDetail(countryCode)) {
    const refreshedHit = getHitFromEvent(event, {
      enableSnap: true,
      snapPx: HIT_SNAP_RADIUS_CLICK_PX,
      eventType: "dblclick",
    });
    const refreshedId = refreshedHit.id;
    const refreshedFeature = refreshedId ? state.landIndex.get(refreshedId) : null;
    if (refreshedHit.targetType === "land" && refreshedId && refreshedFeature) {
      feature = refreshedFeature;
      featureId = refreshedId;
      countryCode = refreshedHit.countryCode || getFeatureCountryCodeNormalized(feature);
    }
  }
  executeDoubleClickBatchFill(feature, featureId);
  noteRenderAction("double-click-fill", actionStart);
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
  state.hitCanvasDirty = true;
  if (typeof state.updateZoomUIFn === "function") {
    state.updateZoomUIFn();
  }
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

function zoomByStep(direction = 1) {
  if (!zoomBehavior || !interactionRect || !globalThis.d3) return;
  const factor = Number(direction) >= 0 ? 1.2 : 1 / 1.2;
  globalThis.d3.select(interactionRect.node()).call(zoomBehavior.scaleBy, factor);
}

function setZoomPercent(percent) {
  if (!zoomBehavior || !interactionRect || !globalThis.d3) return;
  const rawPercent = typeof percent === "string"
    ? Number(String(percent).trim().replace(/%/g, ""))
    : Number(percent);
  if (!Number.isFinite(rawPercent)) return;
  const nextScale = Math.min(MAX_ZOOM_SCALE, Math.max(MIN_ZOOM_SCALE, rawPercent / 100));
  globalThis.d3.select(interactionRect.node()).call(zoomBehavior.scaleTo, nextScale);
}

function getZoomPercent() {
  const scale = Math.max(0.01, Number(state.zoomTransform?.k) || 1);
  return `${Math.round(scale * 100)}%`;
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
  state.hitCanvasDirty = true;
  updateSpecialZonesPaths();
  renderSpecialZoneEditorOverlay();
  updateZoomTranslateExtent();
  markAllOverlaysDirty();
}

function handleResize() {
  setCanvasSize();
  fitProjection();
  resetZoomToFit();
  enforceZoomConstraints();
  markAllOverlaysDirty();
  render();
}

function initZoom() {
  zoomBehavior = globalThis.d3
    .zoom()
    .scaleExtent([MIN_ZOOM_SCALE, MAX_ZOOM_SCALE])
    .extent([[0, 0], [state.width, state.height]])
    .filter((event) => shouldAllowZoomEvent(event))
    .on("start", () => {
      clearRenderPhaseTimer();
      cancelExactAfterSettleRefresh();
      setRenderPhase(RENDER_PHASE_INTERACTING);
      renderHoverOverlayIfNeeded({ force: true });
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
  interactionRect.on("mousedown.brush", handleBrushPointerDown);
  interactionRect.on("mousemove.brush", handleBrushPointerMove);
  interactionRect.on("mouseleave", () => {
    state.hoveredId = null;
    state.hoveredWaterRegionId = null;
    state.hoveredSpecialRegionId = null;
    updateDevHoverHit(null);
    state.hoverOverlayDirty = true;
    renderHoverOverlayIfNeeded();
    queueTooltipUpdate({ visible: false });
  });
  interactionRect.on("click", handleClick);
  interactionRect.on("dblclick", handleDoubleClick);
  window.addEventListener("mouseup", flushBrushSession);
  window.addEventListener("resize", handleResize);
}

function initMap({ containerId = "mapContainer" } = {}) {
  if (!globalThis.d3) {
    console.error("D3 is required for map renderer.");
    return;
  }

  mapContainer = document.getElementById(containerId);
  tooltip = document.getElementById("tooltip");
  state.refreshColorStateFn = refreshColorState;
  state.recomputeDynamicBordersNowFn = recomputeDynamicBordersNow;

  if (!mapContainer) {
    console.error("Map container not found.");
    return;
  }

  ensureHybridLayers();

  if (!hitCanvas) {
    hitCanvas = createHitCanvasElement();
  }

  context = mapCanvas.getContext("2d");
  if (!context) {
    console.error("Canvas 2D context unavailable.");
    return;
  }
  hitContext = hitCanvas.getContext("2d", { willReadFrequently: true });
  if (!hitContext) {
    console.error("Hit canvas 2D context unavailable.");
    return;
  }

  projection = globalThis.d3.geoEqualEarth().precision(PROJECTION_PRECISION);
  projection.clipExtent(null);
  pathSVG = globalThis.d3.geoPath(projection).pointRadius(PATH_POINT_RADIUS);
  pathCanvas = globalThis.d3.geoPath(projection, context).pointRadius(PATH_POINT_RADIUS);
  pathHitCanvas = globalThis.d3.geoPath(projection, hitContext).pointRadius(PATH_POINT_RADIUS);
  layerResolverCache.primaryRef = null;
  layerResolverCache.detailRef = null;
  layerResolverCache.bundleMode = null;
  resetPhysicalLandClipPathCache();
  state.topologyRevision = Number(state.topologyRevision || 0) + 1;
  const renderPassCache = getRenderPassCacheState();
  renderPassCache.referenceTransform = null;
  renderPassCache.referenceTransforms = {};
  renderPassCache.perfOverlayEnabled = isPerfOverlayEnabled();
  ensureLayerDataFromTopology();
  rebuildPoliticalLandCollections();

  state.colorCanvas = mapCanvas;
  state.lineCanvas = null;
  state.colorCtx = context;
  state.lineCtx = null;
  migrateLegacyColorState();
  ensureSovereigntyState();
  state.countryBaseColors = sanitizeCountryColorMap(state.countryBaseColors);
  state.featureOverrides = sanitizeColorMap(state.featureOverrides);
  state.sovereignBaseColors = sanitizeCountryColorMap(state.sovereignBaseColors);
  state.visualOverrides = sanitizeColorMap(state.visualOverrides);
  state.waterRegionOverrides = sanitizeColorMap(state.waterRegionOverrides);
  state.specialRegionOverrides = sanitizeColorMap(state.specialRegionOverrides);
  state.colors = sanitizeColorMap(state.colors);
  state.debugMode = debugMode;
  resetRenderDiagnostics();
  clearRenderPhaseTimer();
  state.renderPhase = RENDER_PHASE_IDLE;
  state.phaseEnteredAt = nowMs();
  state.renderPhaseTimerId = null;
  state.tooltipPendingState = { visible: false };
  state.tooltipRafHandle = null;
  markAllOverlaysDirty();
  clearStagedMapDataTasks();
  cancelExactAfterSettleRefresh();
  state.deferContextBasePass = false;
  state.deferHitCanvasBuild = false;
  state.deferExactAfterSettle = false;
  state.hitCanvasBuildScheduled = null;
  state.projectedBoundsById = new Map();
  state.sphericalFeatureDiagnosticsById = new Map();
  invalidateAllRenderPasses("init-map");
  ensureDayNightClockTimer();

  mapCanvas.style.pointerEvents = "none";
  mapCanvas.style.touchAction = "none";

  buildRuntimePoliticalMeta();
  setCanvasSize();
  buildIndex();
  rebuildStaticMeshes();
  invalidateBorderCache();
  updateDynamicBorderStatusUI();
  fitProjection();
  initZoom();
  bindEvents();

  render();
}

function setMapData({ refitProjection = true, resetZoom = true } = {}) {
  const startedAt = nowMs();
  clearPendingDynamicBorderTimer();
  clearRenderPhaseTimer();
  setRenderPhase(RENDER_PHASE_IDLE);
  resetRenderDiagnostics();
  clearStagedMapDataTasks();
  cancelExactAfterSettleRefresh();
  cancelDeferredWork(state.hitCanvasBuildScheduled);
  state.hitCanvasBuildScheduled = null;
  state.deferContextBasePass = false;
  state.deferHitCanvasBuild = false;
  state.deferExactAfterSettle = false;
  layerResolverCache.primaryRef = null;
  layerResolverCache.detailRef = null;
  layerResolverCache.bundleMode = null;
  state.devHoverHit = null;
  state.devSelectedHit = null;
  state.devSelectionFeatureIds = new Set();
  state.devSelectionOrder = [];
  state.devClipboardFallbackText = "";
  state.devClipboardPreviewFormat = "names_with_ids";
  resetPhysicalLandClipPathCache();
  state.topologyRevision = Number(state.topologyRevision || 0) + 1;
  getRenderPassCacheState().referenceTransform = null;
  getRenderPassCacheState().referenceTransforms = {};
  invalidateAllRenderPasses("set-map-data");
  markAllOverlaysDirty();
  queueTooltipUpdate({ visible: false });
  ensureLayerDataFromTopology();
  const { fullCollection, interactiveCollection } = rebuildPoliticalLandCollections();

  if (state.topologyBundleMode === "composite" && Array.isArray(fullCollection?.features)) {
    const coverage = collectCountryCoverageStats(fullCollection.features);
    const interactiveFeatureCount = Array.isArray(interactiveCollection?.features)
      ? interactiveCollection.features.length
      : 0;
    console.info(
      `[map_renderer] Composite coverage: countries detail=${coverage.detailCountries}, primaryFallback=${coverage.primaryCountries}, total=${coverage.totalCountries}; features detail=${coverage.detailFeatures}, primary=${coverage.primaryFeatures}, total=${coverage.totalFeatures}.`
      + ` interactive=${interactiveFeatureCount}.`
    );
  }

  state.countryBaseColors = sanitizeCountryColorMap(state.countryBaseColors);
  state.featureOverrides = sanitizeColorMap(state.featureOverrides);
  state.waterRegionOverrides = sanitizeColorMap(state.waterRegionOverrides);
  state.specialRegionOverrides = sanitizeColorMap(state.specialRegionOverrides);
  migrateLegacyColorState();
  setCanvasSize();
  buildRuntimePoliticalMeta();
  state.sovereigntyInitialized = false;
  islandNeighborsCache = {
    topologyRef: null,
    objectRef: null,
    count: 0,
    neighbors: [],
  };
  state.sphericalFeatureDiagnosticsById = new Map();
  buildIndex();
  ensureSovereigntyState();
  rebuildProjectedBoundsCache();
  rebuildStaticMeshes();
  invalidateBorderCache();
  updateDynamicBorderStatusUI();
  rebuildResolvedColors();
  if (refitProjection) {
    fitProjection();
  } else {
    buildSpatialIndex();
    updateSpecialZonesPaths();
    renderSpecialZoneEditorOverlay();
    updateZoomTranslateExtent();
  }
  if (resetZoom) {
    resetZoomToFit();
    enforceZoomConstraints();
  } else {
    state.hitCanvasDirty = true;
  }
  const stagedApply = beginStagedMapDataWarmup(startedAt);
  render();
  recordRenderPerfMetric("setMapDataFirstPaint", nowMs() - startedAt, {
    staged: stagedApply,
    activeScenarioId: String(state.activeScenarioId || ""),
  });
  recordRenderPerfMetric("setMapData", nowMs() - startedAt, {
    refitProjection: !!refitProjection,
    resetZoom: !!resetZoom,
    landCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
    renderProfile: String(state.renderProfile || "auto"),
    staged: stagedApply,
  });
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
  refreshResolvedColorsForFeatures,
  refreshResolvedColorsForOwners,
  refreshScenarioOpeningOwnerBorders,
  markDynamicBordersDirty,
  recomputeDynamicBordersNow,
  scheduleDynamicBorderRecompute,
  invalidateOceanVisualState,
  setDebugMode,
  addFeatureToDevSelection,
  toggleFeatureInDevSelection,
  removeLastDevSelection,
  clearDevSelection,
  applyDevMacroFillCurrentCountry,
  applyDevMacroFillCurrentParentGroup,
  applyDevMacroFillCurrentOwnerScope,
  applyDevSelectionFill,
  getWaterRegionColor,
  getZoomPercent,
  resetZoomToFit,
  setZoomPercent,
  zoomByStep,
  scheduleRenderPhaseIdle,
};
