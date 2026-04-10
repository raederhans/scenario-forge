// Hybrid canvas + SVG rendering engine.
import {
  normalizeCityLayerStyleConfig,
  normalizeDayNightStyleConfig,
  normalizeLakeStyleConfig,
  normalizeMapSemanticMode,
  normalizePhysicalStyleConfig,
  normalizeTextureStyleConfig,
  normalizeUrbanStyleConfig,
  PHYSICAL_ATLAS_PALETTE,
  state,
} from "./state.js";
import {
  MODERN_CITY_LIGHTS_BASE_THRESHOLD,
  MODERN_CITY_LIGHTS_CORRIDOR_THRESHOLD,
  MODERN_CITY_LIGHTS_GRID,
  MODERN_CITY_LIGHTS_GRID_HEIGHT,
  MODERN_CITY_LIGHTS_STATS,
  MODERN_CITY_LIGHTS_GRID_WIDTH,
  MODERN_CITY_LIGHTS_STEP_LAT_DEG,
  MODERN_CITY_LIGHTS_STEP_LON_DEG,
} from "./city_lights_modern_asset.js";
import {
  HISTORICAL_1930_CITY_LIGHTS_ENTRIES,
} from "./city_lights_historical_1930_asset.js";
import { ColorManager } from "./color_manager.js";
import { LegendManager } from "./legend_manager.js";
import { captureHistoryState, pushHistoryEntry } from "./history_manager.js";
import {
  getPreferredGeoLabel,
  getStrictGeoLabel,
  getTooltipText,
  renderTooltipText,
  t,
} from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";
import { markDirty } from "./dirty_state.js";
import { getScenarioCountryDisplayName } from "./scenario_country_display.js";
import {
  ensureSovereigntyState,
  getFeatureOwnerCode,
  getFeatureIdsForOwner,
  markLegacyColorStateDirty,
  migrateLegacyColorState,
  setFeatureOwnerCodes,
  resetFeatureOwnerCodes,
} from "./sovereignty_manager.js";
import { COUNTRY_CODE_ALIASES, normalizeCountryCodeAlias } from "./country_code_aliases.js";
import {
  DEFAULT_UNIT_COUNTER_PRESET_ID,
  getUnitCounterIconPathById,
  getUnitCounterEchelonLabel,
  getUnitCounterPresetById,
  normalizeUnitCounterSizeToken,
  UNIT_COUNTER_SCREEN_SIZE,
} from "./unit_counter_presets.js";
import { flushRenderBoundary, requestRender } from "./render_boundary.js";
import {
  bindInteractionFunnel,
  dispatchMapClick,
  dispatchMapDoubleClick,
} from "./interaction_funnel.js";

const DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT = 78;
const DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT = 74;
const DEFAULT_UNIT_COUNTER_BASE_FILL = "#f4f0e6";
const UNIT_COUNTER_STATS_PRESETS = Object.freeze({
  elite: Object.freeze({ organizationPct: 94, equipmentPct: 92 }),
  regular: Object.freeze({ organizationPct: 82, equipmentPct: 78 }),
  worn: Object.freeze({ organizationPct: 68, equipmentPct: 62 }),
  understrength: Object.freeze({ organizationPct: 58, equipmentPct: 48 }),
  improvised: Object.freeze({ organizationPct: 47, equipmentPct: 42 }),
});

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
let interactionInfrastructurePromise = null;
let activeContextMetricSession = null;

let viewportGroup = null;
let strategicDefs = null;
let frontlineOverlayGroup = null;
let frontlineLabelsGroup = null;
let operationalLinesGroup = null;
let operationGraphicsGroup = null;
let operationGraphicsEditorGroup = null;
let unitCountersGroup = null;
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
let lastFrontlineOverlaySignature = "";
let lastOperationalLinesOverlaySignature = "";
let lastOperationGraphicsOverlaySignature = "";
let lastUnitCountersOverlaySignature = "";
let lastInspectorOverlaySignature = "";
let lastHoverOverlaySignature = "";
let lastDevSelectionOverlaySignature = "";

const PROJECTION_PRECISION = 0.1;
const PATH_POINT_RADIUS = 2;
const VIEWPORT_CULL_OVERSCAN_PX = 96;
const MAP_PAN_PADDING_PX = 50;
const PROJECTION_FIT_PADDING_RATIO = 0.04;
const MIN_ZOOM_SCALE = 0.35;
const MAX_ZOOM_SCALE = 50;
const OCEAN_FILL_COLOR = "#aadaff";
const LAND_FILL_COLOR = "#f0f0f0";
const SPECIAL_REGION_FALLBACK_FILL = "#d6c19a";
const SPECIAL_REGION_FALLBACK_STROKE = "#8d6f47";
const UNIFIED_WATER_STROKE_COLOR = "rgba(62, 96, 138, 0)";
const UNIFIED_WATER_FILL_OPACITY = 1;
const RELIEF_SALT_FILL_COLOR = "rgba(222, 203, 170, 0.22)";
const RELIEF_SALT_STROKE_COLOR = "rgba(128, 100, 63, 0.55)";
const RELIEF_SHORELINE_COLOR = "rgba(109, 84, 50, 0.78)";
const RELIEF_CONTOUR_COLOR = "rgba(176, 148, 103, 0.6)";
const RELIEF_SWAMP_FILL_COLOR = "rgba(128, 150, 114, 0.28)";
const RELIEF_SWAMP_STROKE_COLOR = "rgba(88, 108, 76, 0.68)";
const RELIEF_LAKE_SHORELINE_COLOR = "rgba(214, 232, 244, 0.92)";
const RELIEF_DAM_APPROACH_COLOR = "rgba(102, 86, 62, 0.8)";
const TNO_COASTAL_ACCENT_COLOR = "rgba(214, 232, 244, 0.88)";
const GIANT_FEATURE_CULL_RATIO = 0.95;
const GIANT_FEATURE_ALLOWLIST = new Set(["RU", "CA", "CN", "US", "AQ", "ATA"]);
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
const COASTLINE_SIMPLIFY_LATITUDE_SCALE_MAX = 2.8;
const COASTLINE_SIMPLIFY_MIN_COS_LAT = 0.35;
const COASTLINE_EFFECTIVE_AREA_MULTIPLIER = 0.5;
const COASTLINE_VIEW_SIMPLIFY_LOW_MIN_DISTANCE_PX = 1.8;
const COASTLINE_VIEW_SIMPLIFY_MID_MIN_DISTANCE_PX = 1.1;
const COASTLINE_VIEW_SIMPLIFY_COLLINEAR_ANGLE_DEG = 10;
const COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW = 0.0016;
const COASTLINE_ACCENT_DENSITY_THRESHOLD_MID = 0.0022;
const COASTLINE_ACCENT_DENSITY_ALPHA_LOW = 0.68;
const COASTLINE_ACCENT_DENSITY_ALPHA_MID = 0.82;
const COASTLINE_ACCENT_DENSITY_WIDTH_SCALE = 0.9;
const COASTLINE_OVERLAY_ATLANTROPA_ALPHA = 0.42;
const COASTLINE_OVERLAY_ATLANTROPA_ALPHA_INTERACTIVE = 0.30;
const COASTLINE_OVERLAY_DENSITY_ALPHA_LOW = 0.78;
const COASTLINE_OVERLAY_DENSITY_ALPHA_MID = 0.86;
const COASTLINE_ACCENT_MIN_WIDTH_PX = 0.85;
const COASTLINE_ACCENT_OVERLAY_MIN_WIDTH_PX = 0.95;
const BATHYMETRY_SHALLOW_DEPTH_MAX_M = 200;
const BATHYMETRY_MID_DEPTH_MAX_M = 500;
const BATHYMETRY_BAND_SHALLOW_FADE_START_ZOOM = 2.0;
const BATHYMETRY_BAND_SHALLOW_FADE_END_ZOOM = 2.8;
const BATHYMETRY_BAND_MID_FADE_START_ZOOM = 2.6;
const BATHYMETRY_BAND_MID_FADE_END_ZOOM = 3.4;
const BATHYMETRY_BAND_DEEP_FADE_START_ZOOM = COASTLINE_LOD_MID_ZOOM_MAX;
const BATHYMETRY_BAND_DEEP_FADE_END_ZOOM = 4.2;
const BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_START_ZOOM = 2.0;
const BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_END_ZOOM = 3.0;
const BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_START_ZOOM = 2.4;
const BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_END_ZOOM = 3.4;
const BATHYMETRY_PRESET_PROFILES = Object.freeze({
  bathymetry_soft: Object.freeze({
    defaultOpacity: 0.78,
    defaultScale: 1.08,
    defaultContourStrength: 0.30,
    bandAlphaBase: 0.54,
    contourAlphaBase: 0.12,
    contourLineWidthBase: 0.30,
    contourLineWidthScale: 0.35,
    skipAlternateContourDepths: true,
  }),
  bathymetry_contours: Object.freeze({
    defaultOpacity: 0.62,
    defaultScale: 0.95,
    defaultContourStrength: 0.95,
    bandAlphaBase: 0.22,
    contourAlphaBase: 0.52,
    contourLineWidthBase: 0.95,
    contourLineWidthScale: 1.25,
    skipAlternateContourDepths: false,
  }),
});
const RENDER_PHASE_IDLE = "idle";
const RENDER_PHASE_INTERACTING = "interacting";
const RENDER_PHASE_SETTLING = "settling";
const RENDER_SETTLE_DURATION_MS = 200;
const EXACT_AFTER_SETTLE_QUIET_WINDOW_MS = 700;
const CONTEXT_BASE_REUSE_MIN_DISTANCE_PX = 320;
const CONTEXT_BASE_REUSE_MAX_DISTANCE_PX = 640;
const CONTEXT_BASE_REUSE_MAX_DISTANCE_VIEWPORT_RATIO = 0.35;
const CONTEXT_BASE_MINOR_CONTOUR_THRESHOLD = 2;
const CONTEXT_BASE_BUCKET_LOW_MAX = 1.4;
const CONTEXT_BASE_BUCKET_MID_MAX = 2.5;
const CONTOUR_ZOOM_STYLE_PROFILES = Object.freeze({
  low: Object.freeze({
    majorIntervalMultiplier: 3,
    majorOpacityMultiplier: 0.42,
    majorWidthMultiplier: 0.78,
    majorMinScreenSpanPx: 22,
    minorVisible: false,
    minorOpacityMultiplier: 0,
    minorWidthMultiplier: 0,
    minorIntervalMultiplier: 3,
    minorMinScreenSpanPx: 22,
    minorMaxFeaturesBase: 0,
    minorMaxFeaturesPerMajor: 0,
    minorMaxFeaturesHardCap: 0,
  }),
  mid: Object.freeze({
    majorIntervalMultiplier: 2,
    majorOpacityMultiplier: 0.72,
    majorWidthMultiplier: 0.88,
    majorMinScreenSpanPx: 12,
    minorVisible: true,
    minorOpacityMultiplier: 0.55,
    minorWidthMultiplier: 0.82,
    minorIntervalMultiplier: 2,
    minorMinScreenSpanPx: 18,
    minorMaxFeaturesBase: 900,
    minorMaxFeaturesPerMajor: 1.8,
    minorMaxFeaturesHardCap: 3000,
  }),
  high: Object.freeze({
    majorIntervalMultiplier: 1,
    majorOpacityMultiplier: 1,
    majorWidthMultiplier: 1,
    majorMinScreenSpanPx: 0,
    minorVisible: true,
    minorOpacityMultiplier: 1,
    minorWidthMultiplier: 1,
    minorIntervalMultiplier: 1,
    minorMinScreenSpanPx: 8,
    minorMaxFeaturesBase: 1800,
    minorMaxFeaturesPerMajor: 2.8,
    minorMaxFeaturesHardCap: 6400,
  }),
});
const RIVER_LOW_MAX_SCALERANK = 5;
const RIVER_MID_MAX_SCALERANK = 7;
const RIVER_ZOOM_STYLE_FACTORS = {
  low: {
    coreWidthFactor: 1.2,
    outlineWidthFactor: 0.85,
    outlineAlphaFactor: 0.6,
  },
  mid: {
    coreWidthFactor: 1,
    outlineWidthFactor: 0.7,
    outlineAlphaFactor: 0.7,
  },
  high: {
    coreWidthFactor: 0.75,
    outlineWidthFactor: 0.35,
    outlineAlphaFactor: 0.45,
  },
};
const RIVER_CLASS_STYLE_FACTORS = {
  river: {
    widthFactor: 1,
    opacityFactor: 1,
    outlineFactor: 1,
  },
  intermittent: {
    widthFactor: 0.8,
    opacityFactor: 0.7,
    outlineFactor: 0.5,
  },
  lakeCenterline: {
    widthFactor: 0.72,
    opacityFactor: 0.55,
    outlineFactor: 0,
  },
  canal: {
    widthFactor: 0.72,
    opacityFactor: 0.6,
    outlineFactor: 0,
  },
  unknown: {
    widthFactor: 1,
    opacityFactor: 1,
    outlineFactor: 1,
  },
};
const INTERNAL_BORDER_PROVINCE_MIN_ALPHA = 0.30;
const INTERNAL_BORDER_LOCAL_MIN_ALPHA = 0.22;
const INTERNAL_BORDER_PROVINCE_MIN_WIDTH = 0.52;
const INTERNAL_BORDER_LOCAL_MIN_WIDTH = 0.36;
const INTERNAL_BORDER_LOCAL_ALPHA_SCALE = 0.60;
const INTERNAL_BORDER_LOCAL_WIDTH_SCALE = 0.75;
const INTERNAL_BORDER_AUTO_DARK = "#ffffff";
const INTERNAL_BORDER_AUTO_LIGHT = "#111827";
const CONTOUR_HOST_FILL_FALLBACK_RADIUS = 24;
const DETAIL_ADM_BORDER_COLOR = "#888888";
const DETAIL_ADM_BORDER_MIN_ALPHA = 0.24;
const DETAIL_ADM_BORDER_MAX_ALPHA = 0.34;
const DETAIL_ADM_BORDER_MIN_WIDTH = 0.30;
const DETAIL_ADM_BORDER_TARGET_MIN_ALPHA = 0.12;
const DETAIL_ADM_BORDER_TARGET_MAX_ALPHA = 0.18;
const DETAIL_ADM_BORDER_ALPHA_SCALE = 0.70;
const DETAIL_ADM_BORDER_WIDTH_SCALE = 0.70;
const LOCAL_BORDERS_MIN_ZOOM = 2.0;
const DETAIL_ADM_BORDERS_MIN_ZOOM = 2.4;
const PROVINCE_BORDERS_FADE_START_ZOOM = 1.1;
const PROVINCE_BORDERS_TRANSITION_END_ZOOM = 2.0;
const PROVINCE_BORDERS_FAR_ALPHA = 0.10;
const PROVINCE_BORDERS_TRANSITION_ALPHA = 0.38;
const PROVINCE_BORDERS_FAR_WIDTH_MAX_ZOOM = 1.5;
const PROVINCE_BORDERS_FAR_WIDTH_SCALE = 0.75;
const PROVINCE_BORDERS_NEAR_ZOOM_START = 2.2;
const PROVINCE_BORDERS_NEAR_ALPHA_SCALE = 0.86;
const PROVINCE_BORDERS_NEAR_WIDTH_SCALE = 0.90;
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
const BOUNDARY_DEFAULT_LINE_JOIN = "round";
const BOUNDARY_DEFAULT_LINE_CAP = "round";
const BOUNDARY_DEFAULT_MITER_LIMIT = 2.4;
const OCEAN_MASK_MODE_TOPOLOGY = "topology_ocean";
const OCEAN_MASK_MODE_SPHERE_MINUS_LAND = "sphere_minus_land";
const OCEAN_MASK_MODE_BATHYMETRY = "bathymetry_features";
const OCEAN_MASK_MIN_QUALITY = 0.35;
const GLOBAL_BATHYMETRY_TOPOLOGY_URL = "data/global_bathymetry.topo.json";
const BATHYMETRY_BANDS_OBJECT_NAME = "bathymetry_bands";
const BATHYMETRY_CONTOURS_OBJECT_NAME = "bathymetry_contours";
const BATHYMETRY_MAX_REFERENCE_DEPTH_M = 6000;
const CONTEXT_LAYER_MIN_SCORE = 0.08;
const CONTEXT_BREAKDOWN_METRIC_NAMES = new Set([
  "drawPhysicalAtlasLayer",
  "drawPhysicalContourLayer",
  "drawCityPointsLayer",
  "drawAirportsLayer",
  "drawPortsLayer",
  "drawUrbanLayer",
  "drawRiversLayer",
  "drawScenarioRegionOverlaysPass",
  "drawScenarioReliefOverlaysLayer",
]);
const LAYER_DIAG_PREFIX = "[layer-resolver]";
const DEFAULT_SPECIAL_ZONE_TYPE = "custom";
const DEFAULT_OPERATION_GRAPHIC_KIND = "attack";
const DEFAULT_OPERATIONAL_LINE_KIND = "frontline";
const DEFAULT_UNIT_COUNTER_RENDERER = "game";
const DEFAULT_MILSTD_SIDC = "130310001412110000000000000000";
const STRATEGIC_LINE_LABEL_FONT = "\"IBM Plex Sans\", \"Segoe UI\", sans-serif";
const OPERATION_GRAPHIC_STYLE_PRESETS = ["attack", "retreat", "supply", "naval", "encirclement", "theater"];
const OPERATIONAL_LINE_STYLE_PRESETS = ["frontline", "offensive_line", "spearhead_line", "defensive_line"];
const STRATEGIC_COUNTER_ATTACHMENT_KIND = "operational-line";
const milsymbolSvgUriCache = new Map();
const DEFAULT_OPERATION_GRAPHIC_OPACITY = 0.96;
const DEFAULT_OPERATION_GRAPHIC_WIDTH = 4.4;
const DEFAULT_UNIT_COUNTER_SIDC = "130310001412110000000000000000";
const UNIT_COUNTER_MILSTD_SIZE_BY_TOKEN = Object.freeze({
  small: 12,
  medium: 14,
  large: 18,
});
const UNIT_COUNTER_SIDC_ALIASES = Object.freeze({
  INF: DEFAULT_UNIT_COUNTER_SIDC,
  ARMORED: "130310001712110000000000000000",
  ARM: "130310001712110000000000000000",
  HQ: "100310001712110000000000000000",
  ART: "130320000000000000000000000000",
});
const PAPER_TEXTURE_BASE_TILE_SIZE = 512;
const PAPER_NOISE_TILE_SIZE = 192;
const TEXTURE_LABEL_SERIF_STACK = "\"Libre Baskerville\", \"Palatino Linotype\", Georgia, serif";
const CITY_MARKER_THEME_GRAPHITE = "classic_graphite";
const CITY_REVEAL_PROFILE_HYBRID = "hybrid_country_budget";
const CITY_LABEL_DARK_BACKGROUND_LUMINANCE = 0.34;
const CITY_COUNTRY_TIER_RANK = {
  A: 5,
  B: 4,
  C: 3,
  D: 2,
  E: 1,
};
const CITY_MARKER_THEME_TOKENS = {
  classic_graphite: {
    fillTop: "rgba(126, 134, 143, 0.99)",
    fillMid: "rgba(86, 94, 102, 0.99)",
    fillBottom: "rgba(42, 48, 55, 0.99)",
    rimDark: "rgba(15, 21, 28, 0.44)",
    stroke: "rgba(202, 193, 176, 0.54)",
    highlight: "rgba(244, 247, 250, 0.22)",
    specular: "rgba(230, 236, 241, 0.14)",
    baseShadow: "rgba(11, 17, 23, 0.26)",
    capitalAccent: "rgba(175, 161, 126, 0.96)",
    capitalHighlight: "rgba(246, 236, 208, 0.42)",
    label: "rgba(56, 52, 46, 0.92)",
    capitalLabel: "rgba(74, 67, 56, 0.96)",
    halo: "rgba(255, 252, 245, 0.08)",
    shadow: "rgba(20, 24, 31, 0.18)",
  },
};

const bathymetryTopologyCacheByUrl = new Map();
const bathymetryLoadPromiseByUrl = new Map();
const bathymetryLoadFailureByUrl = new Set();
const CITY_MARKER_SIZE_LIMITS_PX = {
  minor: 10,
  regional: 14,
  major: 18,
  capital: 22,
};
const CITY_MARKER_BASE_SIZES_PX = {
  minor: 5.8,
  regional: 7.7,
  major: 10.4,
};
const CITY_LABEL_DENSITY_BUDGETS = {
  sparse: { P4: 16, P5: 32 },
  balanced: { P4: 24, P5: 48 },
  dense: { P4: 32, P5: 64 },
};
const CITY_LABEL_MAX_WIDTH_PX = {
  sparse: { capital: 212, major: 186, regional: 164, minor: 150 },
  balanced: { capital: 188, major: 166, regional: 148, minor: 134 },
  dense: { capital: 166, major: 148, regional: 132, minor: 120 },
};
const CITY_LABEL_PLACEMENT_ORDER = [
  "right",
  "left",
  "upper-right",
  "lower-right",
  "upper-left",
  "lower-left",
];
const CITY_ADMIN_LABEL_PATTERNS = [
  /\bcounty\b/giu,
  /\bdistrict\b/giu,
  /\boblast\b/giu,
  /\bokrug\b/giu,
  /\braion\b/giu,
  /\bmunicipality\b/giu,
  /\bgovernorate\b/giu,
  /городской округ/giu,
  /район/giu,
  /область/giu,
];
const CITY_ADMIN_LABEL_REJECT_PATTERNS = [
  /\bcounty\b/iu,
  /\bdistrict\b/iu,
  /\boblast\b/iu,
  /\bokrug\b/iu,
  /\braion\b/iu,
  /городской округ/iu,
  /район/iu,
  /область/iu,
];
const CITY_REVEAL_PHASES = [
  { id: "P0", minScale: 0, maxScale: 1.15, markerBudget: 18, labelBudget: 0 },
  { id: "P1", minScale: 1.15, maxScale: 1.45, markerBudget: 28, labelBudget: 0 },
  { id: "P2", minScale: 1.45, maxScale: 1.9, markerBudget: 42, labelBudget: 0 },
  { id: "P3", minScale: 1.9, maxScale: 2.45, markerBudget: 72, labelBudget: 0 },
  { id: "P4", minScale: 2.45, maxScale: 3.05, markerBudget: 110, labelBudget: 24 },
  { id: "P5", minScale: 3.05, maxScale: Infinity, markerBudget: 170, labelBudget: 48 },
];
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
const RENDER_PASS_NAMES = ["background", "physicalBase", "political", "effects", "contextBase", "contextScenario", "dayNight", "borders", "labels"];
const TRANSFORM_REUSED_RENDER_PASS_NAMES = new Set([
  "background",
  "physicalBase",
  "political",
  "effects",
  "contextBase",
  "contextScenario",
  "dayNight",
]);
const TRANSFORMED_FRAME_PASS_NAMES = [
  "background",
  "physicalBase",
  "political",
  "effects",
  "contextBase",
  "contextScenario",
  "dayNight",
  "labels",
];
const RENDER_PASS_OVERSCAN_RATIO_PER_SIDE = 0.15;
const POLITICAL_PARTIAL_REPAINT_FEATURE_THRESHOLD = 48;
const POLITICAL_PARTIAL_REPAINT_CANDIDATE_THRESHOLD = 160;
const POLITICAL_PARTIAL_REPAINT_VIEWPORT_COVERAGE_MAX = 0.18;
const POLITICAL_PARTIAL_REPAINT_SYNC_BUILD_CANDIDATE_MAX = 96;
const POLITICAL_PARTIAL_REPAINT_SYNC_BUILD_MISS_MAX = 96;
const POLITICAL_PARTIAL_REPAINT_PAD_PX = 4;
const POLITICAL_PATH_WARMUP_OVERSCAN_PX = 96;
const POLITICAL_PATH_WARMUP_QUEUE_MAX = 512;
const POLITICAL_PATH_WARMUP_MAX_FEATURES_PER_SLICE = 24;
const POLITICAL_PATH_WARMUP_CPU_BUDGET_MS = 4;
const POLITICAL_PATH_WARMUP_TIMEOUT_MS = 24;
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
const textureAssetCache = new Map();
const texturePatternCache = new Map();
const textureGeometryCache = new Map();
const textureNoiseTileCache = new Map();
const modernCityLightsGeometryCache = {
  projectionKey: "",
  baseEntries: [],
  corridorEntries: [],
};
const modernCityLightsPopulationBoostCache = {
  cityCollection: null,
  urbanCollection: null,
  cityLayerRevision: -1,
  scenarioId: "",
  urbanEntries: [],
  cityEntries: [],
};
const layerResolverCache = {
  primaryRef: null,
  detailRef: null,
  bundleMode: null,
  contextRevision: 0,
};
const politicalFeatureCollectionCache = new WeakMap();
let admin0MergedCache = {
  topologyRef: null,
  featureCount: 0,
  entries: [],
};
let composedPoliticalCollectionCache = {
  primaryRef: null,
  detailRef: null,
  overrideRef: null,
  result: null,
};
let scenarioCoastlineSourceCache = {
  primaryRef: null,
  runtimeRef: null,
  scenarioId: "",
  decision: null,
};
let staticMeshCache = {
  primaryRef: null,
  detailRef: null,
  runtimeRef: null,
  bundleMode: "",
  activeScenarioId: "",
  scenarioBorderMode: "",
  scenarioViewMode: "",
  sourceCountriesSignature: "",
  coastlineDecisionSignature: "",
  snapshot: null,
};
let countryDominantFillColorCache = {
  colorRevision: -1,
  scenarioViewMode: "",
  activeScenarioId: "",
  result: new Map(),
};
let contourHostFillColorCache = new WeakMap();
let staticMeshSourceCountries = {
  primary: new Set(),
  detail: new Set(),
};
let scenarioPoliticalBackgroundCache = {
  runtimeRef: null,
  scenarioId: "",
  viewMode: "ownership",
  oceanFillColor: "",
  sovereigntyRevision: 0,
  controllerRevision: 0,
  shellRevision: 0,
  colorRevision: 0,
  canvasWidth: 0,
  canvasHeight: 0,
  cacheKey: "",
  entries: [],
};
let scenarioOpeningOwnerBorderCache = {
  runtimeRef: null,
  meshPackRef: null,
  scenarioId: "",
  baselineHash: "",
  baselineOwnersRef: null,
  shellRevision: 0,
  meshSource: "",
  mesh: null,
};
let physicalLandClipPathCache = {
  key: "",
  path: null,
};
const SCENARIO_BACKGROUND_MERGE_MAX_AREA = Math.PI * 2;
const SCENARIO_COASTLINE_MAX_AREA_DELTA_RATIO = 0.02;
const SCENARIO_COASTLINE_MAX_INTERIOR_RING_RATIO = 0.25;
const SCENARIO_COASTLINE_MAX_INTERIOR_RING_COUNT = 500;
const suspiciousScenarioBackgroundMergeWarnings = new Set();
const scenarioCoastlineDecisionWarnings = new Set();
const scenarioOwnerOnlyCanonicalFallbackWarnings = new Set();
const missingPhysicalContextWarnings = new Set();
const renderDiag = {
  enabled: false,
  seenKeys: new Set(),
  skippedByReason: new Map(),
  skippedByCountry: new Map(),
  sampleByReason: new Map(),
};
const rewoundFeatureLogKeys = new Set();
const urbanGeoCentroidCache = new WeakMap();
let cityAnchorCache = new WeakMap();
const urbanFeatureIndexCache = {
  sourceRef: null,
  byId: new Map(),
};
const cityLayerCache = {
  baseRef: null,
  scenarioRef: null,
  scenarioCountriesRef: null,
  scenarioId: "",
  cityLayerRevision: -1,
  scenarioControllerRevision: -1,
  sovereigntyRevision: -1,
  merged: null,
};
const cityCountryProfileCache = new WeakMap();
const cityMarkerSpriteCache = new Map();
let cityMarkerSpriteCacheColorRevision = -1;
let visibleCityHoverEntries = [];
let dayNightClockTimerId = null;
let lastDayNightClockToken = "";
let pendingIndexUiRefreshHandle = null;
let pendingIndexUiRefreshState = null;
let deferredIndexUiRefreshHandle = null;
let deferredIndexUiRefreshState = null;
let pendingSidebarRefreshHandle = null;
let pendingSidebarRefreshState = null;
let secondarySpatialBuildHandle = null;
let pendingScenarioChunkFlushAfterExactHandle = null;
let deferredHeavyBorderMeshHandle = null;
let deferredContextBaseEnhancementHandle = null;
let deferContextBaseEnhancements = false;
let detailAdmMeshBuildState = {
  signature: "",
  status: "idle",
};
let visibleInternalBorderMeshSignature = "";
let visibleBorderCountryCodesCache = {
  signature: "",
  codes: new Set(),
};
let contourVisibleSetCache = {
  major: { collectionRef: null, key: "", features: [] },
  minor: { collectionRef: null, key: "", features: [] },
};

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
  cache.layouts = cache.layouts && typeof cache.layouts === "object" ? cache.layouts : {};
  cache.signatures = cache.signatures && typeof cache.signatures === "object" ? cache.signatures : {};
  cache.referenceTransforms = cache.referenceTransforms && typeof cache.referenceTransforms === "object"
    ? cache.referenceTransforms
    : {};
  cache.borderSnapshot = cache.borderSnapshot && typeof cache.borderSnapshot === "object"
    ? cache.borderSnapshot
    : {
      canvas: null,
      layout: null,
      referenceTransform: null,
      valid: false,
      reason: "init",
    };
  cache.lastGoodFrame = cache.lastGoodFrame && typeof cache.lastGoodFrame === "object"
    ? cache.lastGoodFrame
    : {
      canvas: null,
      referenceTransform: null,
      valid: false,
      capturedAt: 0,
      reason: "init",
    };
  cache.partialPoliticalDirtyIds = cache.partialPoliticalDirtyIds instanceof Set
    ? cache.partialPoliticalDirtyIds
    : new Set();
  cache.politicalPathCache = cache.politicalPathCache instanceof Map
    ? cache.politicalPathCache
    : new Map();
  cache.politicalPathCacheSignature = typeof cache.politicalPathCacheSignature === "string"
    ? cache.politicalPathCacheSignature
    : "";
  cache.politicalPathCacheTransform = cache.politicalPathCacheTransform
    ? cloneZoomTransform(cache.politicalPathCacheTransform)
    : null;
  cache.politicalPathWarmupQueue = Array.isArray(cache.politicalPathWarmupQueue)
    ? cache.politicalPathWarmupQueue
    : [];
  cache.politicalPathWarmupHandle = cache.politicalPathWarmupHandle && typeof cache.politicalPathWarmupHandle === "object"
    ? cache.politicalPathWarmupHandle
    : null;
  cache.politicalPathWarmupSignature = typeof cache.politicalPathWarmupSignature === "string"
    ? cache.politicalPathWarmupSignature
    : "";
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
    physicalBasePassRenders: 0,
    politicalPassRenders: 0,
    effectsPassRenders: 0,
    contextPassRenders: 0,
    contextBasePassRenders: 0,
    contextScenarioPassRenders: 0,
    dayNightPassRenders: 0,
    borderPassRenders: 0,
    borderSnapshotRenders: 0,
    borderSnapshotReuses: 0,
    labelPassRenders: 0,
    hitCanvasRenders: 0,
    dynamicBorderRebuilds: 0,
    politicalPartialRepaints: 0,
    politicalPartialFallbacks: 0,
    politicalPartialCandidateCount: 0,
    politicalPartialPathCacheMisses: 0,
    politicalPartialPathBuild: 0,
    politicalPathCacheBuild: 0,
    politicalPathWarmupBuild: 0,
    politicalPathWarmupSlices: 0,
    politicalPathWarmupCancels: 0,
    blackFrameCount: 0,
    lastGoodFrameReuses: 0,
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
  if (
    targetPassNames.includes("political")
    && !["refresh-colors", "rebuild-colors"].includes(String(reason || "unspecified"))
  ) {
    cache.partialPoliticalDirtyIds.clear();
    invalidatePoliticalPathCache(reason);
  }
  if (targetPassNames.includes("borders")) {
    invalidateInteractionBorderSnapshot(reason);
  }
}

function invalidateAllRenderPasses(reason = "unspecified") {
  invalidateRenderPasses(RENDER_PASS_NAMES, reason);
}

function isBootInteractionReady() {
  return String(state.bootPhase || "").trim().toLowerCase() === "ready" && !state.bootBlocking;
}

function clearRenderPassReferenceTransforms(passNames = null) {
  const cache = getRenderPassCacheState();
  if (!passNames) {
    cache.referenceTransform = null;
    cache.referenceTransforms = {};
    invalidateInteractionBorderSnapshot("clear-reference-transform");
    invalidatePoliticalPathCache("clear-reference-transform");
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
  if (targetPassNames.includes("political")) {
    invalidatePoliticalPathCache("clear-reference-transform");
  }
  if (targetPassNames.includes("borders")) {
    invalidateInteractionBorderSnapshot("clear-reference-transform");
  }
}

function invalidateOceanVisualState(reason = "ocean-visual") {
  cancelExactAfterSettleRefresh({ clearDefer: true });
  invalidateRenderPasses(["background", "physicalBase", "political", "contextBase", "contextScenario"], reason);
  clearRenderPassReferenceTransforms(["background", "physicalBase", "political", "contextBase", "contextScenario", "effects", "dayNight"]);
}

function invalidateOceanBackgroundVisualState(reason = "ocean-background") {
  cancelExactAfterSettleRefresh({ clearDefer: true });
  invalidateRenderPasses("background", reason);
  clearRenderPassReferenceTransforms("background");
}

function invalidateOceanTextureVisualState(reason = "ocean-texture") {
  cancelExactAfterSettleRefresh({ clearDefer: true });
  invalidateRenderPasses(["background", "physicalBase", "effects"], reason);
  clearRenderPassReferenceTransforms(["background", "physicalBase", "effects"]);
}

function invalidateOceanWaterInteractionVisualState(reason = "ocean-water-interaction") {
  cancelExactAfterSettleRefresh({ clearDefer: true });
  invalidateRenderPasses(["background", "physicalBase", "contextScenario"], reason);
  clearRenderPassReferenceTransforms(["background", "physicalBase", "contextScenario"]);
}

function invalidateOceanCoastalAccentVisualState(reason = "ocean-coastal-accent") {
  cancelExactAfterSettleRefresh({ clearDefer: true });
  invalidateRenderPasses("borders", reason);
  clearRenderPassReferenceTransforms("borders");
}

function getRenderPassOverscanRatio(passName) {
  return TRANSFORM_REUSED_RENDER_PASS_NAMES.has(passName)
    ? RENDER_PASS_OVERSCAN_RATIO_PER_SIDE
    : 0;
}

function buildRenderPassLayout(passName) {
  const dpr = Math.max(state.dpr || 1, 1);
  const logicalWidth = Math.max(1, Number(state.width || 1));
  const logicalHeight = Math.max(1, Number(state.height || 1));
  const overscanRatio = getRenderPassOverscanRatio(passName);
  const offsetX = overscanRatio > 0 ? Math.ceil(logicalWidth * overscanRatio) : 0;
  const offsetY = overscanRatio > 0 ? Math.ceil(logicalHeight * overscanRatio) : 0;
  const paddedWidth = logicalWidth + offsetX * 2;
  const paddedHeight = logicalHeight + offsetY * 2;
  return {
    offsetX,
    offsetY,
    logicalWidth,
    logicalHeight,
    paddedWidth,
    paddedHeight,
    pixelWidth: Math.max(1, Math.floor(paddedWidth * dpr)),
    pixelHeight: Math.max(1, Math.floor(paddedHeight * dpr)),
    dpr,
  };
}

function getRenderPassLayout(passName) {
  const cache = getRenderPassCacheState();
  const layout = buildRenderPassLayout(passName);
  cache.layouts[passName] = layout;
  return layout;
}

function resizeRenderPassCanvases() {
  const cache = getRenderPassCacheState();
  RENDER_PASS_NAMES.forEach((passName) => {
    const layout = getRenderPassLayout(passName);
    const canvas = cache.canvases?.[passName];
    if (!canvas) return;
    if (canvas.width !== layout.pixelWidth) canvas.width = layout.pixelWidth;
    if (canvas.height !== layout.pixelHeight) canvas.height = layout.pixelHeight;
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

function ensureLastGoodFrameCanvas() {
  const cache = getRenderPassCacheState();
  if (!cache.lastGoodFrame.canvas) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    cache.lastGoodFrame.canvas = canvas;
  }
  const targetCanvas = cache.lastGoodFrame.canvas;
  const width = Math.max(1, Number(context?.canvas?.width || 1));
  const height = Math.max(1, Number(context?.canvas?.height || 1));
  if (targetCanvas.width !== width) targetCanvas.width = width;
  if (targetCanvas.height !== height) targetCanvas.height = height;
  return targetCanvas;
}

function captureLastGoodFrame(reason = "frame", transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  if (!context?.canvas) return false;
  const targetCanvas = ensureLastGoodFrameCanvas();
  const targetContext = targetCanvas.getContext("2d");
  if (!targetContext) return false;
  targetContext.setTransform(1, 0, 0, 1, 0, 0);
  targetContext.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
  targetContext.drawImage(context.canvas, 0, 0);
  const cache = getRenderPassCacheState();
  cache.lastGoodFrame.referenceTransform = cloneZoomTransform(transform);
  cache.lastGoodFrame.capturedAt = Date.now();
  cache.lastGoodFrame.valid = true;
  cache.lastGoodFrame.reason = String(reason || "frame");
  return true;
}

function noteBlackFrame(reason = "unknown") {
  incrementPerfCounter("blackFrameCount");
  const cache = getRenderPassCacheState();
  const count = Number(cache.counters.blackFrameCount || 0);
  ensureRenderPerfMetrics().blackFrameCount = {
    count,
    reason: String(reason || "unknown"),
    recordedAt: Date.now(),
  };
}

function drawLastGoodFrameFallback(currentTransform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  const cache = getRenderPassCacheState();
  const fallbackCanvas = cache.lastGoodFrame?.canvas;
  const referenceTransform = cache.lastGoodFrame?.referenceTransform;
  if (!fallbackCanvas || !cache.lastGoodFrame?.valid || !referenceTransform) {
    return false;
  }
  const current = cloneZoomTransform(currentTransform);
  const reference = cloneZoomTransform(referenceTransform);
  const scaleRatio = current.k / Math.max(reference.k, 0.0001);
  const dx = current.x - (reference.x * scaleRatio);
  const dy = current.y - (reference.y * scaleRatio);
  resetMainCanvas();
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.translate(dx * state.dpr, dy * state.dpr);
  context.scale(scaleRatio, scaleRatio);
  context.drawImage(fallbackCanvas, 0, 0);
  context.restore();
  incrementPerfCounter("lastGoodFrameReuses");
  const ageMs = Math.max(0, Date.now() - Number(cache.lastGoodFrame?.capturedAt || 0));
  recordRenderPerfMetric("dragVisibleStaleFrameMs", ageMs, {
    phase: state.renderPhase,
    reason: String(cache.lastGoodFrame?.reason || "last-good-frame"),
  });
  return true;
}

function buildInteractionBorderSnapshotLayout() {
  const dpr = Math.max(state.dpr || 1, 1);
  const logicalWidth = Math.max(1, Number(state.width || 1));
  const logicalHeight = Math.max(1, Number(state.height || 1));
  const offsetX = Math.ceil(logicalWidth * RENDER_PASS_OVERSCAN_RATIO_PER_SIDE);
  const offsetY = Math.ceil(logicalHeight * RENDER_PASS_OVERSCAN_RATIO_PER_SIDE);
  const paddedWidth = logicalWidth + offsetX * 2;
  const paddedHeight = logicalHeight + offsetY * 2;
  return {
    offsetX,
    offsetY,
    logicalWidth,
    logicalHeight,
    paddedWidth,
    paddedHeight,
    pixelWidth: Math.max(1, Math.floor(paddedWidth * dpr)),
    pixelHeight: Math.max(1, Math.floor(paddedHeight * dpr)),
    dpr,
  };
}

function getInteractionBorderSnapshotState() {
  const cache = getRenderPassCacheState();
  return cache.borderSnapshot;
}

function ensureInteractionBorderSnapshotCanvas() {
  const snapshot = getInteractionBorderSnapshotState();
  if (!snapshot.canvas) {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    snapshot.canvas = canvas;
  }
  snapshot.layout = buildInteractionBorderSnapshotLayout();
  if (snapshot.canvas.width !== snapshot.layout.pixelWidth) snapshot.canvas.width = snapshot.layout.pixelWidth;
  if (snapshot.canvas.height !== snapshot.layout.pixelHeight) snapshot.canvas.height = snapshot.layout.pixelHeight;
  return snapshot.canvas;
}

function getPoliticalPassStaticSignature(transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  return [
    getTransformSignature(transform),
    state.topologyRevision || 0,
    `ocean-fill:${getOceanBaseFillColor()}`,
    debugMode,
    state.topologyBundleMode || "single",
  ].join("::");
}

function getPoliticalPathCacheSignature(transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  return [
    getPoliticalPassStaticSignature(transform),
    getProjectionRenderSignature(),
    getViewportRenderSignature(),
    String(state.activeScenarioId || ""),
    String(state.scenarioViewMode || "ownership"),
    Number(state.sovereigntyRevision || 0),
    Number(state.scenarioControllerRevision || 0),
    Number(state.scenarioShellOverlayRevision || 0),
  ].join("::");
}

function cancelPoliticalPathWarmup(reason = "unspecified") {
  const cache = getRenderPassCacheState();
  const hadWork =
    !!cache.politicalPathWarmupHandle
    || (Array.isArray(cache.politicalPathWarmupQueue) && cache.politicalPathWarmupQueue.length > 0)
    || !!cache.politicalPathWarmupSignature;
  if (cache.politicalPathWarmupHandle) {
    cancelDeferredWork(cache.politicalPathWarmupHandle);
  }
  cache.politicalPathWarmupHandle = null;
  cache.politicalPathWarmupQueue = [];
  cache.politicalPathWarmupSignature = "";
  cache.politicalPathWarmupReason = String(reason || "unspecified");
  if (hadWork) {
    incrementPerfCounter("politicalPathWarmupCancels");
  }
}

function invalidatePoliticalPathCache(reason = "unspecified") {
  const cache = getRenderPassCacheState();
  cancelPoliticalPathWarmup(reason);
  if (cache.politicalPathCache instanceof Map) {
    cache.politicalPathCache.clear();
  } else {
    cache.politicalPathCache = new Map();
  }
  cache.politicalPathCacheSignature = "";
  cache.politicalPathCacheTransform = null;
  cache.politicalPathCacheReason = String(reason || "unspecified");
}

function getPoliticalPathCacheHandle(
  transform = state.zoomTransform || globalThis.d3?.zoomIdentity,
  { resetIfMismatch = false } = {},
) {
  const cache = getRenderPassCacheState();
  const signature = getPoliticalPathCacheSignature(transform);
  const valid =
    cache.politicalPathCache instanceof Map
    && cache.politicalPathCacheSignature === signature
    && areZoomTransformsEquivalent(cache.politicalPathCacheTransform, transform);
  if (valid) {
    return {
      cache,
      signature,
      valid: true,
      map: cache.politicalPathCache,
    };
  }
  if (resetIfMismatch) {
    if (!(cache.politicalPathCache instanceof Map)) {
      cache.politicalPathCache = new Map();
    } else {
      cache.politicalPathCache.clear();
    }
    cache.politicalPathCacheSignature = signature;
    cache.politicalPathCacheTransform = cloneZoomTransform(transform);
    cache.politicalPathCacheReason = "prepared";
  }
  return {
    cache,
    signature,
    valid: resetIfMismatch,
    map: cache.politicalPathCache instanceof Map ? cache.politicalPathCache : new Map(),
  };
}

function buildPoliticalFeaturePathEntry(feature) {
  if (!feature?.geometry || !globalThis.Path2D || typeof pathSVG !== "function") {
    return null;
  }
  try {
    const pathString = pathSVG(feature);
    if (!pathString) return null;
    return {
      path: new globalThis.Path2D(pathString),
    };
  } catch (_error) {
    return null;
  }
}

function getPoliticalFeaturePathEntry(
  feature,
  {
    featureId = null,
    transform = state.zoomTransform || globalThis.d3?.zoomIdentity,
    allowBuild = false,
    countMiss = false,
    countBuild = false,
  } = {},
) {
  const resolvedId = featureId || getFeatureId(feature);
  if (!resolvedId) return null;
  const handle = getPoliticalPathCacheHandle(transform, { resetIfMismatch: allowBuild });
  if (!handle.valid || !(handle.map instanceof Map)) {
    if (countMiss) incrementPerfCounter("politicalPartialPathCacheMisses");
    return null;
  }
  const cachedEntry = handle.map.get(resolvedId);
  if (cachedEntry?.path) {
    return cachedEntry;
  }
  if (countMiss) incrementPerfCounter("politicalPartialPathCacheMisses");
  if (!allowBuild) {
    return null;
  }
  const builtEntry = buildPoliticalFeaturePathEntry(feature);
  if (!builtEntry?.path) {
    return null;
  }
  handle.map.set(resolvedId, builtEntry);
  if (countBuild) incrementPerfCounter("politicalPathCacheBuild");
  return builtEntry;
}

function collectWarmupCandidateItems(transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  const viewportWidth = Math.max(1, Number(state.width || 1));
  const viewportHeight = Math.max(1, Number(state.height || 1));
  const overscan = Math.max(0, Number(POLITICAL_PATH_WARMUP_OVERSCAN_PX || 0));
  const viewportRect = {
    minX: -overscan,
    minY: -overscan,
    maxX: viewportWidth + overscan,
    maxY: viewportHeight + overscan,
  };
  const projectedViewportRect = screenRectToProjectedRect(viewportRect, transform);
  if (!projectedViewportRect) return null;
  const candidateResult = collectLandSpatialItemsForProjectedRects([projectedViewportRect]);
  if (!candidateResult || candidateResult.overflow) {
    return null;
  }
  const normalizedTransform = cloneZoomTransform(transform);
  const centerX = ((viewportWidth / 2) - normalizedTransform.x) / normalizedTransform.k;
  const centerY = ((viewportHeight / 2) - normalizedTransform.y) / normalizedTransform.k;
  return candidateResult.items
    .map((item) => ({
      ...item,
      warmupDistance: Math.hypot(
        (((Number(item?.minX || 0) + Number(item?.maxX || 0)) / 2) - centerX),
        (((Number(item?.minY || 0) + Number(item?.maxY || 0)) / 2) - centerY),
      ),
    }))
    .sort((left, right) => {
      const distanceDelta = Number(left?.warmupDistance || 0) - Number(right?.warmupDistance || 0);
      if (Math.abs(distanceDelta) > 0.001) return distanceDelta;
      return (left?.drawOrder ?? 0) - (right?.drawOrder ?? 0);
    })
    .slice(0, POLITICAL_PATH_WARMUP_QUEUE_MAX);
}

function runPoliticalPathWarmupSlice(deadline = null) {
  const cache = getRenderPassCacheState();
  cache.politicalPathWarmupHandle = null;
  if (
    state.renderPhase !== RENDER_PHASE_IDLE
    || state.deferExactAfterSettle
    || cache.dirty?.political
  ) {
    cancelPoliticalPathWarmup("warmup-non-idle");
    return false;
  }
  const transform = state.zoomTransform || globalThis.d3?.zoomIdentity;
  const expectedSignature = getPoliticalPathCacheSignature(transform);
  if (
    cache.politicalPathWarmupSignature !== expectedSignature
    || (
      cache.politicalPathCacheSignature
      && cache.politicalPathCacheSignature !== expectedSignature
    )
  ) {
    invalidatePoliticalPathCache("warmup-signature-mismatch");
    return false;
  }
  if (!Array.isArray(cache.politicalPathWarmupQueue) || !cache.politicalPathWarmupQueue.length) {
    cache.politicalPathWarmupQueue = [];
    cache.politicalPathWarmupSignature = "";
    return false;
  }
  const handle = getPoliticalPathCacheHandle(transform, { resetIfMismatch: true });
  if (!handle.valid || !(handle.map instanceof Map)) {
    invalidatePoliticalPathCache("warmup-handle-invalid");
    return false;
  }
  const startedAt = nowMs();
  let processedCount = 0;
  let builtCount = 0;
  while (cache.politicalPathWarmupQueue.length > 0) {
    if (processedCount >= POLITICAL_PATH_WARMUP_MAX_FEATURES_PER_SLICE) break;
    if (processedCount > 0 && (nowMs() - startedAt) >= POLITICAL_PATH_WARMUP_CPU_BUDGET_MS) break;
    if (
      processedCount > 0
      && deadline
      && typeof deadline.timeRemaining === "function"
      && deadline.timeRemaining() <= 0
    ) {
      break;
    }
    const nextItem = cache.politicalPathWarmupQueue.shift();
    if (!nextItem?.id || !nextItem?.feature) continue;
    processedCount += 1;
    if (handle.map.get(nextItem.id)?.path) continue;
    const pathEntry = getPoliticalFeaturePathEntry(nextItem.feature, {
      featureId: nextItem.id,
      transform,
      allowBuild: true,
      countBuild: true,
    });
    if (pathEntry?.path) {
      builtCount += 1;
      incrementPerfCounter("politicalPathWarmupBuild");
    }
  }
  incrementPerfCounter("politicalPathWarmupSlices");
  const durationMs = nowMs() - startedAt;
  recordRenderPerfMetric("politicalPathWarmupSlice", durationMs, {
    builtCount,
    processedCount,
    remainingCount: cache.politicalPathWarmupQueue.length,
    activeScenarioId: String(state.activeScenarioId || ""),
    transformK: Number(transform?.k || 1),
  });
  recordRenderPerfMetric("politicalPathWarmup", durationMs, {
    builtCount,
    processedCount,
    remainingCount: cache.politicalPathWarmupQueue.length,
    activeScenarioId: String(state.activeScenarioId || ""),
    transformK: Number(transform?.k || 1),
  });
  if (cache.politicalPathWarmupQueue.length > 0) {
    cache.politicalPathWarmupHandle = scheduleDeferredWork(runPoliticalPathWarmupSlice, {
      timeout: POLITICAL_PATH_WARMUP_TIMEOUT_MS,
    });
  } else {
    cache.politicalPathWarmupSignature = "";
  }
  return builtCount > 0;
}

function schedulePoliticalPathWarmup(transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  const cache = getRenderPassCacheState();
  if (
    state.renderPhase !== RENDER_PHASE_IDLE
    || state.deferExactAfterSettle
    || cache.dirty?.political
  ) {
    return false;
  }
  const signature = getPoliticalPathCacheSignature(transform);
  const candidateItems = collectWarmupCandidateItems(transform);
  if (!Array.isArray(candidateItems)) {
    cancelPoliticalPathWarmup("warmup-spatial-unavailable");
    return false;
  }
  const handle = getPoliticalPathCacheHandle(transform, { resetIfMismatch: false });
  const cacheMap = handle.valid && handle.map instanceof Map ? handle.map : null;
  const queue = candidateItems.filter((item) => item?.id && item?.feature && !cacheMap?.get(item.id)?.path);
  if (!queue.length) {
    cancelPoliticalPathWarmup("warmup-complete");
    return false;
  }
  if (cache.politicalPathWarmupHandle) {
    cancelDeferredWork(cache.politicalPathWarmupHandle);
  }
  cache.politicalPathWarmupHandle = null;
  cache.politicalPathWarmupQueue = queue;
  cache.politicalPathWarmupSignature = signature;
  cache.politicalPathWarmupReason = "scheduled";
  cache.politicalPathWarmupHandle = scheduleDeferredWork(runPoliticalPathWarmupSlice, {
    timeout: POLITICAL_PATH_WARMUP_TIMEOUT_MS,
  });
  return true;
}

function invalidateInteractionBorderSnapshot(reason = "unspecified") {
  const snapshot = getInteractionBorderSnapshotState();
  snapshot.valid = false;
  snapshot.reason = String(reason || "unspecified");
  snapshot.referenceTransform = null;
}

function captureInteractionBorderSnapshot(transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  if (!state.landData?.features?.length) {
    invalidateInteractionBorderSnapshot("empty-land-data");
    return false;
  }
  const canvas = ensureInteractionBorderSnapshotCanvas();
  const snapshot = getInteractionBorderSnapshotState();
  const targetContext = canvas?.getContext?.("2d");
  if (!targetContext) {
    invalidateInteractionBorderSnapshot("missing-context");
    return false;
  }
  const referenceTransform = cloneZoomTransform(transform);
  const startedAt = nowMs();
  const k = prepareTargetContext(targetContext, referenceTransform, snapshot.layout);
  withRenderTarget(targetContext, () => {
    drawBordersPass(k, { interactive: true });
  });
  snapshot.referenceTransform = referenceTransform;
  snapshot.valid = true;
  snapshot.reason = "captured";
  incrementPerfCounter("borderSnapshotRenders");
  recordRenderPerfMetric("interactionBorderSnapshotBuild", nowMs() - startedAt, {
    activeScenarioId: String(state.activeScenarioId || ""),
    transformK: Number(referenceTransform.k || 1),
  });
  return true;
}

function drawInteractionBorderSnapshot(currentTransform = state.zoomTransform || globalThis.d3.zoomIdentity) {
  const snapshot = getInteractionBorderSnapshotState();
  if (!snapshot.valid || !snapshot.canvas || !snapshot.referenceTransform || !snapshot.layout) {
    return false;
  }
  const expectedLayout = buildInteractionBorderSnapshotLayout();
  if (
    snapshot.canvas.width !== expectedLayout.pixelWidth
    || snapshot.canvas.height !== expectedLayout.pixelHeight
  ) {
    invalidateInteractionBorderSnapshot("layout-mismatch");
    return false;
  }
  const current = cloneZoomTransform(currentTransform);
  const reference = cloneZoomTransform(snapshot.referenceTransform);
  const scaleRatio = current.k / Math.max(reference.k, 0.0001);
  const dx = current.x - (reference.x * scaleRatio);
  const dy = current.y - (reference.y * scaleRatio);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.translate(
    (dx - Number(snapshot.layout.offsetX || 0) * scaleRatio) * state.dpr,
    (dy - Number(snapshot.layout.offsetY || 0) * scaleRatio) * state.dpr,
  );
  context.scale(scaleRatio, scaleRatio);
  context.drawImage(snapshot.canvas, 0, 0);
  context.restore();
  incrementPerfCounter("borderSnapshotReuses");
  return true;
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
  if (passName === "physicalBase") {
    const maskInfo = getPhysicalLandMaskInfo();
    return [
      transformSignature,
      state.topologyRevision || 0,
      state.activeScenarioId || "",
      state.showPhysical ? "physical:on" : "physical:off",
      `mask:${maskInfo.maskSource}:${maskInfo.maskFeatureCount}:${maskInfo.maskArcRefEstimate ?? "na"}`,
      `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
      stableJson(normalizePhysicalStyleConfig(state.styleConfig?.physical || {})),
    ].join("::");
  }
  if (passName === "political") {
    return [
      state.colorRevision || 0,
      getPoliticalPassStaticSignature(transform),
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
      state.showCityPoints ? "cities:on" : "cities:off",
      state.showAirports ? "airports:on" : "airports:off",
      state.showPorts ? "ports:on" : "ports:off",
      state.showUrban ? "urban:on" : "urban:off",
      state.showRivers ? "rivers:on" : "rivers:off",
      `cities:${Number(state.cityLayerRevision || 0)}`,
      `colors:${Number(state.colorRevision || 0)}`,
      `context:${Number(state.contextLayerRevision || 0)}`,
      `mask:${maskInfo.maskSource}:${maskInfo.maskFeatureCount}:${maskInfo.maskArcRefEstimate ?? "na"}`,
      `scenario-topology:${getScenarioRuntimeTopologySignatureToken()}`,
      String(state.renderProfile || "auto"),
      stableJson(normalizePhysicalStyleConfig(state.styleConfig?.physical || {})),
      stableJson(normalizeCityLayerStyleConfig(state.styleConfig?.cityPoints || {})),
      stableJson(normalizeUrbanStyleConfig(state.styleConfig?.urban || {})),
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
  if (passName === "labels") {
    return [
      transformSignature,
      state.topologyRevision || 0,
      state.activeScenarioId || "",
      state.showCityPoints ? "cities:on" : "cities:off",
      `cities:${Number(state.cityLayerRevision || 0)}`,
      stableJson(normalizeCityLayerStyleConfig(state.styleConfig?.cityPoints || {})),
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
  state.projectedBoundsDiagnostics = {
    total: 0,
    byGeometryType: {},
    byReason: {},
  };
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
  return normalizeCountryCodeAlias(rawCode);
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

function isWaterRegionRenderable(feature) {
  if (!feature) return false;
  if (isBaseGeographyScenarioFeature(feature)) {
    return true;
  }
  return feature?.properties?.interactive !== false;
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

function isTnoCoastalAccentEnabled() {
  return String(state.activeScenarioId || "").trim().toLowerCase() === "tno_1962"
    && state.styleConfig?.ocean?.coastalAccentEnabled !== false;
}

function getScenarioCoastalAccentOverlayFeatures() {
  if (!isTnoCoastalAccentEnabled()) return [];
  return getEffectiveScenarioReliefOverlayFeatures().filter((feature) => {
    const kind = getReliefOverlayKind(feature);
    return kind === "new_shoreline" || kind === "lake_shoreline";
  });
}

function getAtlantropaAccentSuppressionFeatures() {
  if (!isTnoCoastalAccentEnabled()) return [];
  return Array.isArray(state.activeBathymetryBandsData?.features)
    ? state.activeBathymetryBandsData.features.filter((feature) => {
      if (String(feature?.properties?._bathymetrySource || "").trim().toLowerCase() !== "scenario") {
        return false;
      }
      if (!isAtlantropaBathymetryFeature(feature)) return false;
      return pathBoundsInScreen(feature);
    })
    : [];
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
    const kind = getReliefOverlayKind(feature);
    if (kind === "new_shoreline" || kind === "lake_shoreline") return;
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
      if (kind === "salt_flat_texture") {
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
      } else if (kind === "swamp_margin") {
        drawPolygonLinePattern(bounds, {
          color: style.stroke,
          spacing: 8 / Math.max(0.3, Math.min(4, k)),
          angleDeg: 82,
          lineWidth: 0.5 / Math.max(0.0001, k),
          alpha: 0.4,
        });
        drawPolygonLinePattern(bounds, {
          color: "rgba(90, 140, 180, 0.8)",
          spacing: 14 / Math.max(0.3, Math.min(4, k)),
          angleDeg: 0,
          lineWidth: 0.35 / Math.max(0.0001, k),
          alpha: 0.22,
        });
      }
      context.restore();
    }
    context.beginPath();
    pathCanvas(feature);
    context.save();
    if (kind === "dam_approach") {
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

function parseCanvasColorChannels(value) {
  const candidate = String(value || "").trim();
  if (!candidate) return null;

  const normalizedHex = ColorManager.normalizeHexColor(candidate);
  if (normalizedHex) {
    const rgb = ColorManager.hexToRgb(normalizedHex);
    return rgb ? { ...rgb, a: 1 } : null;
  }

  const rgbMatch = /^rgba?\(\s*([0-9.]+)\s*,\s*([0-9.]+)\s*,\s*([0-9.]+)(?:\s*,\s*([0-9.]+)\s*)?\)$/iu.exec(candidate);
  if (!rgbMatch) return null;
  return {
    r: clamp(Number(rgbMatch[1]) || 0, 0, 255),
    g: clamp(Number(rgbMatch[2]) || 0, 0, 255),
    b: clamp(Number(rgbMatch[3]) || 0, 0, 255),
    a: clamp(rgbMatch[4] === undefined ? 1 : (Number(rgbMatch[4]) || 0), 0, 1),
  };
}

function getCanvasColorRelativeLuminance(value) {
  const channels = parseCanvasColorChannels(value);
  if (!channels) return null;
  const r = ColorManager.srgbToLinear(channels.r / 255);
  const g = ColorManager.srgbToLinear(channels.g / 255);
  const b = ColorManager.srgbToLinear(channels.b / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function mixCanvasColors(baseColor, targetColor, amount) {
  const base = parseCanvasColorChannels(baseColor);
  const target = parseCanvasColorChannels(targetColor);
  if (!base || !target) return null;
  const mix = clamp(Number(amount) || 0, 0, 1);
  return ColorManager.rgbToHex(
    base.r + ((target.r - base.r) * mix),
    base.g + ((target.g - base.g) * mix),
    base.b + ((target.b - base.b) * mix),
  );
}

function buildCountryDominantFillColorMap() {
  const cacheMatches =
    countryDominantFillColorCache.colorRevision === Number(state.colorRevision || 0)
    && countryDominantFillColorCache.scenarioViewMode === String(state.scenarioViewMode || "ownership")
    && countryDominantFillColorCache.activeScenarioId === String(state.activeScenarioId || "");
  if (cacheMatches && countryDominantFillColorCache.result instanceof Map) {
    return countryDominantFillColorCache.result;
  }

  const countsByCountry = new Map();
  getFullLandDataFeatures().forEach((feature, index) => {
    const countryCode = getFeatureCountryCodeNormalized(feature);
    const id = getFeatureId(feature) || `feature-${index}`;
    if (!countryCode || !id || shouldExcludePoliticalInteractionFeature(feature, id)) return;
    const color = getSafeCanvasColor(state.colors?.[id], null) || getResolvedFeatureColor(feature, id);
    if (!color) return;
    const countryCounts = countsByCountry.get(countryCode) || new Map();
    countryCounts.set(color, (countryCounts.get(color) || 0) + 1);
    countsByCountry.set(countryCode, countryCounts);
  });

  const result = new Map();
  countsByCountry.forEach((countryCounts, countryCode) => {
    let bestColor = "";
    let bestCount = -1;
    countryCounts.forEach((count, color) => {
      if (count <= bestCount) return;
      bestColor = color;
      bestCount = count;
    });
    if (bestColor) {
      result.set(countryCode, bestColor);
    }
  });

  countryDominantFillColorCache = {
    colorRevision: Number(state.colorRevision || 0),
    scenarioViewMode: String(state.scenarioViewMode || "ownership"),
    activeScenarioId: String(state.activeScenarioId || ""),
    result,
  };
  return result;
}

function getInternalBorderStrokeColor(countryCode, fallbackColor) {
  const colorMode = String(state.styleConfig?.internalBorders?.colorMode || "auto").trim().toLowerCase();
  const manualColor = getSafeCanvasColor(state.styleConfig?.internalBorders?.color, fallbackColor || "#cccccc");
  if (colorMode === "manual") {
    return manualColor;
  }
  const dominantFillColor = buildCountryDominantFillColorMap().get(canonicalCountryCode(countryCode));
  const luminance = getCanvasColorRelativeLuminance(dominantFillColor);
  if (!Number.isFinite(luminance)) {
    return manualColor;
  }
  const targetColor = luminance >= 0.42 ? INTERNAL_BORDER_AUTO_LIGHT : INTERNAL_BORDER_AUTO_DARK;
  return mixCanvasColors(dominantFillColor, targetColor, luminance >= 0.42 ? 0.78 : 0.72)
    || targetColor
    || manualColor;
}

function getContourZoomStyleProfile(k) {
  const zoomBucket = getContextBaseZoomBucketId(k);
  return CONTOUR_ZOOM_STYLE_PROFILES[zoomBucket] || CONTOUR_ZOOM_STYLE_PROFILES.high;
}

function getContourFeatureHostFillColor(feature) {
  if (!feature || !state.spatialItems?.length || !projection) return null;
  const cacheKey = [
    Number(state.colorRevision || 0),
    String(state.activeScenarioId || ""),
    String(state.scenarioViewMode || "ownership"),
  ].join("::");
  const cached = contourHostFillColorCache.get(feature);
  if (cached?.key === cacheKey) {
    return cached.color;
  }

  const geographicCentroid = getFeatureGeoCentroid(feature);
  const projectedCentroid = pathCanvas?.centroid
    ? pathCanvas.centroid(feature)
    : (Array.isArray(geographicCentroid) ? projection(geographicCentroid) : null);
  const resolveFromRadius = (radiusProj = 0) => {
    if (
      !Array.isArray(projectedCentroid)
      || projectedCentroid.length < 2
      || !projectedCentroid.every((value) => Number.isFinite(Number(value)))
      || !Array.isArray(geographicCentroid)
    ) {
      return null;
    }
    const ranked = rankCandidates(
      collectGridCandidates(projectedCentroid[0], projectedCentroid[1], radiusProj),
      geographicCentroid,
    );
    const match = ranked.find((candidate) => candidate.containsGeo) || ranked[0];
    const hostFeature = match?.item?.feature || null;
    const hostFeatureId = String(match?.item?.featureId || getFeatureId(hostFeature) || "").trim();
    if (!hostFeature || !hostFeatureId) return null;
    return (
      getSafeCanvasColor(state.colors?.[hostFeatureId], null)
      || getSafeCanvasColor(getResolvedFeatureColor(hostFeature, hostFeatureId), null)
    );
  };

  const color = resolveFromRadius(0) || resolveFromRadius(CONTOUR_HOST_FILL_FALLBACK_RADIUS);
  contourHostFillColorCache.set(feature, {
    key: cacheKey,
    color,
  });
  return color;
}

function getAdaptiveContourStrokeColor(feature, baseColor) {
  const safeBaseColor = getSafeCanvasColor(baseColor, "#665241") || "#665241";
  const hostFillColor = getContourFeatureHostFillColor(feature);
  const luminance = getCanvasColorRelativeLuminance(hostFillColor);
  if (!Number.isFinite(luminance)) {
    return safeBaseColor;
  }
  const targetColor = luminance >= 0.42 ? "#111827" : "#ffffff";
  const mixAmount = luminance >= 0.42 ? 0.58 : 0.74;
  return mixCanvasColors(safeBaseColor, targetColor, mixAmount) || targetColor || safeBaseColor;
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

function prepareTargetContext(
  targetContext,
  transform = state.zoomTransform || globalThis.d3?.zoomIdentity,
  layout = null,
) {
  if (!targetContext?.canvas) return 1;
  const width = targetContext.canvas.width;
  const height = targetContext.canvas.height;
  const normalized = cloneZoomTransform(transform);
  const offsetX = Number(layout?.offsetX || 0);
  const offsetY = Number(layout?.offsetY || 0);
  targetContext.setTransform(1, 0, 0, 1, 0, 0);
  targetContext.clearRect(0, 0, width, height);
  targetContext.globalCompositeOperation = "source-over";
  targetContext.globalAlpha = 1;
  targetContext.shadowBlur = 0;
  targetContext.filter = "none";
  targetContext.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  targetContext.translate(offsetX, offsetY);
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
  if (passName === "physicalBase") return ["contextPassRenders", "physicalBasePassRenders"];
  if (passName === "political") return ["politicalPassRenders"];
  if (passName === "effects") return ["effectsPassRenders"];
  if (passName === "contextBase") return ["contextPassRenders", "contextBasePassRenders"];
  if (passName === "contextScenario") return ["contextPassRenders", "contextScenarioPassRenders"];
  if (passName === "dayNight") return ["dayNightPassRenders"];
  if (passName === "borders") return ["borderPassRenders"];
  if (passName === "labels") return ["labelPassRenders"];
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
  cancelDeferredWork(secondarySpatialBuildHandle);
  state.stagedContextBaseHandle = null;
  state.stagedHitCanvasHandle = null;
  secondarySpatialBuildHandle = null;
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
  const requiredPasses = ["background", "physicalBase", "political", "effects", "contextBase", "contextScenario", "dayNight"];
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

function isLineGeometryType(geometryType) {
  return geometryType === "LineString" || geometryType === "MultiLineString";
}

function recordProjectedBoundsDiagnostic(feature, reason = "unknown") {
  const geometryType = String(feature?.geometry?.type || "").trim() || "Unknown";
  const diagnostics = state.projectedBoundsDiagnostics && typeof state.projectedBoundsDiagnostics === "object"
    ? state.projectedBoundsDiagnostics
    : { total: 0, byGeometryType: {}, byReason: {} };
  diagnostics.total = Math.max(0, Number(diagnostics.total || 0) + 1);
  diagnostics.byGeometryType = diagnostics.byGeometryType && typeof diagnostics.byGeometryType === "object"
    ? diagnostics.byGeometryType
    : {};
  diagnostics.byReason = diagnostics.byReason && typeof diagnostics.byReason === "object"
    ? diagnostics.byReason
    : {};
  diagnostics.byGeometryType[geometryType] = Math.max(
    0,
    Number(diagnostics.byGeometryType[geometryType] || 0) + 1,
  );
  diagnostics.byReason[reason] = Math.max(
    0,
    Number(diagnostics.byReason[reason] || 0) + 1,
  );
  state.projectedBoundsDiagnostics = diagnostics;
  recordRenderPerfMetric("projectedBoundsDiagnostics", 0, {
    total: diagnostics.total,
    byGeometryType: { ...diagnostics.byGeometryType },
    byReason: { ...diagnostics.byReason },
    lastGeometryType: geometryType,
    lastReason: reason,
  });
}

function computeProjectedFeatureBounds(feature) {
  return computeProjectedGeoBounds(feature);
}

function computeProjectedGeoBounds(geoObject) {
  const pathRef = pathCanvas || pathSVG;
  if (!pathRef || !geoObject) return null;

  let bounds = null;
  try {
    bounds = pathRef.bounds(geoObject);
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

function collectPolygonalGeometryParts(geometry) {
  if (!geometry || typeof geometry !== "object") return [];
  const geometryType = String(geometry.type || "");
  if (geometryType === "Polygon") {
    return [geometry];
  }
  if (geometryType === "MultiPolygon") {
    const coordinates = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    return coordinates
      .filter((partCoordinates) => Array.isArray(partCoordinates) && partCoordinates.length > 0)
      .map((partCoordinates) => ({
        type: "Polygon",
        coordinates: partCoordinates,
      }));
  }
  if (geometryType === "GeometryCollection") {
    return (Array.isArray(geometry.geometries) ? geometry.geometries : [])
      .flatMap((partGeometry) => collectPolygonalGeometryParts(partGeometry));
  }
  return [];
}

function collectFeatureHitGeometries(feature) {
  const geometry = feature?.geometry;
  const polygonParts = collectPolygonalGeometryParts(geometry);
  return polygonParts.length ? polygonParts : (geometry ? [geometry] : []);
}

function rebuildProjectedBoundsCache() {
  clearProjectedBoundsCache();
  const cache = ensureProjectedBoundsCache();
  if (state.landData?.features?.length) {
    state.landData.features.forEach((feature) => {
      const featureId = getFeatureId(feature);
      if (!featureId) return;
      const bounds = computeProjectedFeatureBounds(feature);
      if (!bounds) return;
      cache.set(featureId, bounds);
    });
  }
  if (state.riversData?.features?.length) {
    state.riversData.features.forEach((feature) => {
      const featureId = getFeatureId(feature);
      if (!featureId) return;
      const bounds = computeProjectedFeatureBounds(feature);
      if (!bounds) return;
      cache.set(featureId, bounds);
    });
  }
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

function mergeProjectedBounds(boundsList = []) {
  const bounds = (Array.isArray(boundsList) ? boundsList : []).filter(Boolean);
  if (!bounds.length) return null;
  const minX = Math.min(...bounds.map((entry) => Number(entry.minX)));
  const minY = Math.min(...bounds.map((entry) => Number(entry.minY)));
  const maxX = Math.max(...bounds.map((entry) => Number(entry.maxX)));
  const maxY = Math.max(...bounds.map((entry) => Number(entry.maxY)));
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return null;
  }
  return {
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
    area: Math.max(0, maxX - minX) * Math.max(0, maxY - minY),
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
  if (/^[A-Z]{2,3}$/.test(candidate)) {
    return true;
  }
  const detailTier = String(feature?.properties?.detail_tier || "").trim().toLowerCase();
  return detailTier === "antarctic_sector" && candidate.startsWith("AQ_");
}

function isScenarioShellFeature(feature, featureId = null) {
  if (String(feature?.properties?.scenario_helper_kind || "").trim().toLowerCase() === "shell_fallback") {
    return true;
  }
  const candidate = String(
    feature?.properties?.id ?? featureId ?? feature?.id ?? ""
  ).trim().toUpperCase();
  if (candidate.startsWith("RU_ARCTIC_FB_")) return true;
  return String(feature?.properties?.name || "").toLowerCase().includes("shell fallback");
}

function getAtlantropaGeometryRole(feature) {
  return String(feature?.properties?.atl_geometry_role || "").trim().toLowerCase();
}

function getAtlantropaJoinMode(feature) {
  return String(feature?.properties?.atl_join_mode || "").trim().toLowerCase();
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

function isAtlantropaSupportHelperFeature(feature, featureId = null) {
  const candidate = String(
    feature?.properties?.id ?? featureId ?? feature?.id ?? ""
  ).trim().toUpperCase();
  if (
    candidate.startsWith("ATLSHL_")
    || candidate.startsWith("ATLWLD_")
    || candidate.startsWith("ATLSEA_FILL_")
  ) {
    return true;
  }
  const geometryRole = getAtlantropaGeometryRole(feature);
  const joinMode = getAtlantropaJoinMode(feature);
  return (
    geometryRole === "shore_seal"
    || geometryRole === "sea_completion"
    || geometryRole === "donor_sea"
    || joinMode === "gap_fill"
    || joinMode === "boolean_weld"
  );
}

function isPoliticalInteractionRenderableFeature(feature, featureId = null) {
  if (!feature) return false;
  if (isAntarcticSectorFeature(feature, featureId)) return false;
  if (isBaseGeographyScenarioFeature(feature)) return false;
  if (feature?.properties?.interactive === false) return false;
  if (isScenarioShellFeature(feature, featureId)) return false;
  if (isAtlantropaSupportHelperFeature(feature, featureId)) return false;
  return true;
}

function shouldExcludePoliticalInteractionFeature(feature, featureId = null) {
  return !isPoliticalInteractionRenderableFeature(feature, featureId);
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
  const cachedCollections = politicalFeatureCollectionCache.get(topology);
  if (cachedCollections?.has(sourceName)) {
    return cachedCollections.get(sourceName);
  }
  const seededCollection =
    sourceName === "runtime"
    && topology === state.runtimePoliticalTopology
    && Array.isArray(state.runtimePoliticalFeatureCollectionSeed?.features)
      ? state.runtimePoliticalFeatureCollectionSeed
      : null;
  const collection = seededCollection || globalThis.topojson.feature(topology, topology.objects.political);
  const features = Array.isArray(collection?.features) ? collection.features : [];
  const normalizedCollection = {
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
  const nextCollections = cachedCollections || new Map();
  nextCollections.set(sourceName, normalizedCollection);
  politicalFeatureCollectionCache.set(topology, nextCollections);
  if (seededCollection) {
    state.runtimePoliticalFeatureCollectionSeed = normalizedCollection;
  }
  return normalizedCollection;
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
  const cacheMatches =
    composedPoliticalCollectionCache.primaryRef === primaryTopology &&
    composedPoliticalCollectionCache.detailRef === detailTopology &&
    composedPoliticalCollectionCache.overrideRef === overrideCollection;
  if (cacheMatches && composedPoliticalCollectionCache.result) {
    return composedPoliticalCollectionCache.result;
  }
  const primaryCollection = getPoliticalFeatureCollection(primaryTopology, "primary");
  if (!detailTopology) {
    const baseFeatures = primaryCollection.features;
    const features = overrideCollection
      ? mergeOverrideFeatures(baseFeatures, overrideCollection)
      : baseFeatures;
    const result = {
      type: "FeatureCollection",
      features,
    };
    composedPoliticalCollectionCache = {
      primaryRef: primaryTopology,
      detailRef: detailTopology,
      overrideRef: overrideCollection,
      result,
    };
    return result;
  }

  const detailCollection = getPoliticalFeatureCollection(detailTopology, "detail");
  const result = composePoliticalFeatureCollections(primaryCollection, detailCollection, overrideCollection);
  composedPoliticalCollectionCache = {
    primaryRef: primaryTopology,
    detailRef: detailTopology,
    overrideRef: overrideCollection,
    result,
  };
  return result;
}

function composePoliticalFeatureCollections(primaryCollection, detailCollection = null, overrideCollection = null) {
  const normalizedPrimaryCollection = Array.isArray(primaryCollection?.features)
    ? primaryCollection
    : { type: "FeatureCollection", features: [] };
  const normalizedDetailCollection = Array.isArray(detailCollection?.features)
    ? {
      type: "FeatureCollection",
      features: detailCollection.features.map((feature) => {
        const normalizedFeature = normalizeFeatureGeometry(feature, { sourceLabel: "detail" });
        return {
          ...normalizedFeature,
          properties: {
            ...(normalizedFeature?.properties || {}),
            __source: "detail",
          },
        };
      }),
    }
    : null;
  if (!normalizedDetailCollection) {
    const baseFeatures = normalizedPrimaryCollection.features;
    const features = overrideCollection
      ? mergeOverrideFeatures(baseFeatures, overrideCollection)
      : baseFeatures;
    return {
      type: "FeatureCollection",
      features,
    };
  }
  const detailCountries = new Set();
  normalizedDetailCollection.features.forEach((feature) => {
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

  normalizedDetailCollection.features.forEach(pushIfUnique);
  normalizedPrimaryCollection.features.forEach((feature) => {
    const code = getFeatureCountryCodeNormalized(feature);
    if (code && detailCountries.has(code)) return;
    pushIfUnique(feature);
  });

  const mergedFeatures = overrideCollection
    ? mergeOverrideFeatures(features, overrideCollection)
    : features;

  const result = {
    type: "FeatureCollection",
    features: mergedFeatures,
  };
  return result;
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

  const explicitFeatures = fullCollection.features.filter((feature) =>
    isPoliticalInteractionRenderableFeature(feature, getFeatureId(feature))
  );
  const explicitCollection = explicitFeatures.length === fullCollection.features.length
    ? fullCollection
    : {
      type: "FeatureCollection",
      features: explicitFeatures,
    };
  if (!Array.isArray(explicitCollection?.features) || !explicitCollection.features.length) {
    return explicitCollection;
  }

  const filterStateByCountry = new Map();
  explicitCollection.features.forEach((feature) => {
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
    return explicitCollection;
  }

  const filteredFeatures = explicitCollection.features.filter((feature) => {
    const countryCode = getFeatureCountryCodeNormalized(feature);
    const entry = activeFilters.get(countryCode);
    if (!entry) return true;
    return !entry.blockedTiers.has(getDetailTier(feature).toLowerCase());
  });

  if (filteredFeatures.length === explicitCollection.features.length) {
    return explicitCollection;
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
  const scenarioPoliticalChunkCollection = Array.isArray(state.scenarioPoliticalChunkData?.features)
    ? state.scenarioPoliticalChunkData
    : null;

  let fullCollection = state.landDataFull || state.landData || null;
  if (runtimeTopology?.objects?.political && globalThis.topojson) {
    const runtimeCollection = getPoliticalFeatureCollection(runtimeTopology, "runtime");
    fullCollection = scenarioPoliticalChunkCollection
      ? composePoliticalFeatureCollections(runtimeCollection, scenarioPoliticalChunkCollection)
      : runtimeCollection;
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
  if (phase !== RENDER_PHASE_IDLE) {
    cancelPoliticalPathWarmup(`phase-${phase}`);
  }
  if (previousPhase !== phase && (previousPhase === RENDER_PHASE_IDLE || phase === RENDER_PHASE_IDLE)) {
    state.hoverOverlayDirty = true;
  }
  if (phase === RENDER_PHASE_IDLE && state.pendingDayNightRefresh) {
    state.pendingDayNightRefresh = false;
    invalidateRenderPasses("dayNight", "day-night-clock-deferred");
  }
}

function markOverlaysDirty({
  frontline = false,
  operationalLines = false,
  operationGraphics = false,
  unitCounters = false,
  specialZones = false,
  inspector = false,
  hover = false,
} = {}) {
  if (frontline) {
    state.frontlineOverlayDirty = true;
  }
  if (operationalLines) {
    state.operationalLinesDirty = true;
  }
  if (operationGraphics) {
    state.operationGraphicsDirty = true;
  }
  if (unitCounters) {
    state.unitCountersDirty = true;
  }
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
    frontline: true,
    operationalLines: true,
    operationGraphics: true,
    unitCounters: true,
    specialZones: true,
    inspector: true,
    hover: true,
  });
}

function getOperationalLinesOverlaySignature() {
  return [
    getOverlayProjectionSignature(),
    Number(state.dirtyRevision || 0),
    Number(state.zoomTransform?.k || 1).toFixed(3),
    Array.isArray(state.operationalLines) ? state.operationalLines.length : 0,
    !!state.operationalLineEditor?.active ? "1" : "0",
    Array.isArray(state.operationalLineEditor?.points) ? state.operationalLineEditor.points.length : 0,
    String(state.operationalLineEditor?.selectedId || ""),
  ].join("::");
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

function getFrontlineOverlaySignature() {
  return [
    getOverlayProjectionSignature(),
    String(state.activeScenarioId || ""),
    Number(state.scenarioControllerRevision || 0),
    Number(state.scenarioShellOverlayRevision || 0),
    Number(state.sovereigntyRevision || 0),
    state.annotationView?.frontlineEnabled ? "1" : "0",
    String(state.annotationView?.frontlineStyle || "clean"),
    state.annotationView?.showFrontlineLabels ? "1" : "0",
    String(state.annotationView?.labelPlacementMode || "midpoint"),
    Number(state.zoomTransform?.k || 1).toFixed(3),
  ].join("::");
}

function getOperationGraphicsOverlaySignature() {
  return [
    getOverlayProjectionSignature(),
    Number(state.dirtyRevision || 0),
    Number(state.zoomTransform?.k || 1).toFixed(3),
    Array.isArray(state.operationGraphics) ? state.operationGraphics.length : 0,
    !!state.operationGraphicsEditor?.active ? "1" : "0",
    Array.isArray(state.operationGraphicsEditor?.points) ? state.operationGraphicsEditor.points.length : 0,
    String(state.operationGraphicsEditor?.selectedId || ""),
  ].join("::");
}

function getUnitCountersOverlaySignature() {
  return [
    getOverlayProjectionSignature(),
    Number(state.dirtyRevision || 0),
    Number(state.zoomTransform?.k || 1).toFixed(3),
    Array.isArray(state.unitCounters) ? state.unitCounters.length : 0,
    String(state.annotationView?.unitRendererDefault || DEFAULT_UNIT_COUNTER_RENDERER),
    state.annotationView?.showUnitLabels ? "1" : "0",
    !!state.unitCounterEditor?.active ? "1" : "0",
    String(state.unitCounterEditor?.selectedId || ""),
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

function renderFrontlineOverlayIfNeeded({ force = false } = {}) {
  if (!force && !state.frontlineOverlayDirty && state.renderPhase !== RENDER_PHASE_IDLE) {
    return;
  }
  const nextSignature = getFrontlineOverlaySignature();
  if (!force && !state.frontlineOverlayDirty && nextSignature === lastFrontlineOverlaySignature) {
    return;
  }
  renderFrontlineOverlay();
  state.frontlineOverlayDirty = false;
  lastFrontlineOverlaySignature = nextSignature;
}

function renderOperationGraphicsIfNeeded({ force = false } = {}) {
  if (!force && !state.operationGraphicsDirty && state.renderPhase !== RENDER_PHASE_IDLE) {
    return;
  }
  const nextSignature = getOperationGraphicsOverlaySignature();
  if (!force && !state.operationGraphicsDirty && nextSignature === lastOperationGraphicsOverlaySignature) {
    return;
  }
  renderOperationGraphicsOverlay();
  state.operationGraphicsDirty = false;
  lastOperationGraphicsOverlaySignature = nextSignature;
}

function renderOperationalLinesIfNeeded({ force = false } = {}) {
  if (!force && !state.operationalLinesDirty && state.renderPhase !== RENDER_PHASE_IDLE) {
    return;
  }
  const nextSignature = getOperationalLinesOverlaySignature();
  if (!force && !state.operationalLinesDirty && nextSignature === lastOperationalLinesOverlaySignature) {
    return;
  }
  renderOperationalLinesOverlay();
  state.operationalLinesDirty = false;
  lastOperationalLinesOverlaySignature = nextSignature;
}

function renderUnitCountersIfNeeded({ force = false } = {}) {
  if (!force && !state.unitCountersDirty && state.renderPhase !== RENDER_PHASE_IDLE) {
    return;
  }
  const nextSignature = getUnitCountersOverlaySignature();
  if (!force && !state.unitCountersDirty && nextSignature === lastUnitCountersOverlaySignature) {
    return;
  }
  renderUnitCountersOverlay();
  state.unitCountersDirty = false;
  lastUnitCountersOverlaySignature = nextSignature;
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
      if (typeof state.scheduleScenarioChunkRefreshFn === "function") {
        state.scheduleScenarioChunkRefreshFn({
          reason: "render-phase-idle",
          delayMs: 0,
          flushPending: true,
        });
      }
      return;
    }
    render();
    if (typeof state.scheduleScenarioChunkRefreshFn === "function") {
      state.scheduleScenarioChunkRefreshFn({
        reason: "render-phase-idle",
        delayMs: 0,
        flushPending: true,
      });
    }
  }, RENDER_SETTLE_DURATION_MS);
}

function flushPendingScenarioChunkRefreshAfterExact(reason = "exact-after-settle") {
  if (pendingScenarioChunkFlushAfterExactHandle) {
    globalThis.clearTimeout(pendingScenarioChunkFlushAfterExactHandle);
    pendingScenarioChunkFlushAfterExactHandle = null;
  }
  if (typeof state.scheduleScenarioChunkRefreshFn !== "function") {
    return;
  }
  const loadState = state.runtimeChunkLoadState;
  const hasPendingPromotion = !!loadState?.pendingPromotion;
  const hasPendingReason = !!String(loadState?.pendingReason || "").trim();
  if (!hasPendingPromotion && !hasPendingReason) {
    return;
  }
  pendingScenarioChunkFlushAfterExactHandle = globalThis.setTimeout(() => {
    pendingScenarioChunkFlushAfterExactHandle = null;
    if (typeof state.scheduleScenarioChunkRefreshFn !== "function") {
      return;
    }
    const nextLoadState = state.runtimeChunkLoadState;
    const stillHasPendingPromotion = !!nextLoadState?.pendingPromotion;
    const stillHasPendingReason = !!String(nextLoadState?.pendingReason || "").trim();
    if (!stillHasPendingPromotion && !stillHasPendingReason) {
      return;
    }
    if (state.renderPhase !== RENDER_PHASE_IDLE || state.deferExactAfterSettle) {
      return;
    }
    state.scheduleScenarioChunkRefreshFn({
      reason,
      delayMs: 0,
      flushPending: true,
    });
  }, 0);
}

function getDisplayOwnerCode(feature, id) {
  const resolvedId = String(id || "").trim() || getFeatureId(feature);
  if (isAntarcticSectorFeature(feature, resolvedId)) {
    return "";
  }
  const mapSemanticMode = normalizeMapSemanticMode(state.mapSemanticMode);
  const isScenarioShell = isScenarioShellFeature(feature, resolvedId);
  const shellOwnerCode = String(state.scenarioAutoShellOwnerByFeatureId?.[resolvedId] || "").trim().toUpperCase();
  const directOwnerCode = canonicalCountryCode(state.sovereigntyByFeatureId?.[resolvedId] || "");
  if (mapSemanticMode === "blank") {
    if (!state.activeScenarioId || String(state.scenarioViewMode || "ownership") !== "frontline") {
      return isScenarioShell ? (directOwnerCode || shellOwnerCode || "") : directOwnerCode;
    }
    const shellControllerCode = String(state.scenarioAutoShellControllerByFeatureId?.[resolvedId] || "").trim().toUpperCase();
    const directControllerCode = canonicalCountryCode(state.scenarioControllersByFeatureId?.[resolvedId] || "");
    return isScenarioShell
      ? (directControllerCode || shellControllerCode || directOwnerCode || shellOwnerCode || "")
      : (directControllerCode || directOwnerCode || "");
  }
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
  invalidateRenderPasses(["physicalBase", "political", "contextBase"], "rebuild-colors");
  return nextColors;
}

function refreshResolvedColorsForFeatures(featureIds, { renderNow = false } = {}) {
  migrateLegacyColorState();
  ensureSovereigntyState();
  const cache = getRenderPassCacheState();

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
    cache.partialPoliticalDirtyIds.add(id);
  });

  state.colorRevision = Number(state.colorRevision || 0) + 1;
  invalidateRenderPasses(["physicalBase", "political", "contextBase"], "refresh-colors");

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
  invalidateRenderPasses("contextScenario", "refresh-colors");
  if (renderNow && context) {
    render();
  }
}

function pathBoundsInScreen(feature) {
  if (!pathSVG) return false;
  const geometryType = String(feature?.geometry?.type || "").trim();
  const bounds = getProjectedFeatureBounds(feature, { allowCompute: false }) || getProjectedFeatureBounds(feature);
  if (!bounds) {
    recordProjectedBoundsDiagnostic(feature, "missing-bounds");
    return isLineGeometryType(geometryType);
  }
  const minX = bounds.minX * state.zoomTransform.k + state.zoomTransform.x;
  const minY = bounds.minY * state.zoomTransform.k + state.zoomTransform.y;
  const maxX = bounds.maxX * state.zoomTransform.k + state.zoomTransform.x;
  const maxY = bounds.maxY * state.zoomTransform.k + state.zoomTransform.y;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    recordProjectedBoundsDiagnostic(feature, "non-finite-screen-bounds");
    return isLineGeometryType(geometryType);
  }

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

function getContourViewportScreenBounds() {
  const overscan = Math.max(
    VIEWPORT_CULL_OVERSCAN_PX,
    Math.min(state.width, state.height) * 0.08
  );
  const minX = -overscan;
  const minY = -overscan;
  const maxX = Number(state.width || 0) + overscan;
  const maxY = Number(state.height || 0) + overscan;
  return {
    x: minX,
    y: minY,
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function getContourVisibleSetCacheKey(collection, {
  k = state.zoomTransform?.k || 1,
  lowReliefCutoff = 0,
  intervalM = 0,
  excludeIntervalM = 0,
  minScreenSpanPx = 0,
  maxFeatures = 0,
} = {}) {
  return [
    Number(state.topologyRevision || 0),
    getContextBaseZoomBucketId(k),
    getTransformSignature(state.zoomTransform || globalThis.d3?.zoomIdentity),
    getViewportRenderSignature(),
    Array.isArray(collection?.features) ? collection.features.length : 0,
    Number(lowReliefCutoff || 0).toFixed(2),
    Number(intervalM || 0).toFixed(2),
    Number(excludeIntervalM || 0).toFixed(2),
    Number(minScreenSpanPx || 0).toFixed(2),
    Number(maxFeatures || 0),
  ].join("|");
}

function getContourVisibleFeatures(
  collection,
  {
    cacheSlot = "major",
    k = state.zoomTransform?.k || 1,
    lowReliefCutoff = 0,
    intervalM = 0,
    excludeIntervalM = 0,
    minScreenSpanPx = 0,
    maxFeatures = 0,
  } = {},
) {
  if (!Array.isArray(collection?.features) || collection.features.length === 0) return [];
  const cacheKey = getContourVisibleSetCacheKey(collection, {
    k,
    lowReliefCutoff,
    intervalM,
    excludeIntervalM,
    minScreenSpanPx,
    maxFeatures,
  });
  const cacheEntry = contourVisibleSetCache[cacheSlot];
  if (
    cacheEntry?.collectionRef === collection
    && cacheEntry.key === cacheKey
    && Array.isArray(cacheEntry.features)
  ) {
    return cacheEntry.features;
  }

  const viewportBounds = getContourViewportScreenBounds();
  const visibleRecords = [];
  collection.features.forEach((feature) => {
    const elevation = Number(feature?.properties?.elevation_m);
    if (Number.isFinite(elevation) && elevation < lowReliefCutoff) return;
    if (intervalM > 0 && Number.isFinite(elevation) && elevation % intervalM !== 0) return;
    if (excludeIntervalM > 0 && Number.isFinite(elevation) && elevation % excludeIntervalM === 0) return;

    const screenBounds = getFeatureScreenBounds(feature, { allowCompute: false }) || getFeatureScreenBounds(feature);
    if (!screenBounds) {
      if (minScreenSpanPx <= 0 && isLineGeometryType(String(feature?.geometry?.type || "").trim())) {
        visibleRecords.push({ feature, elevation, span: 0 });
      }
      return;
    }
    if (!rectsIntersect(screenBounds, viewportBounds)) return;
    const span = Math.max(Number(screenBounds.width || 0), Number(screenBounds.height || 0));
    if (minScreenSpanPx > 0 && !(span >= minScreenSpanPx)) return;
    visibleRecords.push({ feature, elevation, span });
  });

  if (maxFeatures > 0 && visibleRecords.length > maxFeatures) {
    const scored = visibleRecords.map(({ feature, elevation, span }) => {
      const elevationScore = Number.isFinite(elevation) ? elevation : 0;
      return {
        feature,
        score: elevationScore * 1.15 + span * 34,
      };
    });
    scored.sort((a, b) => b.score - a.score);
    const visibleFeatures = scored.slice(0, maxFeatures).map((entry) => entry.feature);
    contourVisibleSetCache[cacheSlot] = {
      collectionRef: collection,
      key: cacheKey,
      features: visibleFeatures,
    };
    return visibleFeatures;
  }

  const visibleFeatures = visibleRecords.map((entry) => entry.feature);
  contourVisibleSetCache[cacheSlot] = {
    collectionRef: collection,
    key: cacheKey,
    features: visibleFeatures,
  };
  return visibleFeatures;
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

const URBAN_CORRUPT_BOUNDS_WIDTH_DEG = 300;
const URBAN_CORRUPT_BOUNDS_HEIGHT_DEG = 150;

function createUrbanLayerCapability(overrides = {}) {
  return {
    featureCount: 0,
    hasGeometry: false,
    hasStableId: false,
    hasOwnerMeta: false,
    hasCorruptBounds: false,
    missingStableIdCount: 0,
    missingOwnerCount: 0,
    corruptBoundsCount: 0,
    adaptiveAvailable: false,
    unavailableReason: "Urban layer data unavailable.",
    ...overrides,
  };
}

function getUrbanFeatureGeoBounds(feature) {
  if (!feature || !globalThis.d3?.geoBounds) return null;
  try {
    const bounds = globalThis.d3.geoBounds(feature);
    if (!Array.isArray(bounds) || bounds.length !== 2) return null;
    const [[minLon, minLat], [maxLon, maxLat]] = bounds;
    if (![minLon, minLat, maxLon, maxLat].every(Number.isFinite)) return null;
    let width = maxLon - minLon;
    if (width < 0) width += 360;
    const height = Math.max(0, maxLat - minLat);
    return {
      width,
      height,
    };
  } catch (_error) {
    return null;
  }
}

function getUrbanCapabilityUnavailableReason(capability) {
  if (!capability?.hasGeometry) {
    return "Urban layer data unavailable.";
  }
  if (capability.hasCorruptBounds) {
    return "Urban layer geometry is corrupt; rebuild the topology before using Adaptive mode.";
  }
  if (!capability.hasStableId) {
    return "Urban layer is missing stable IDs; Adaptive mode is disabled until the topology is rebuilt.";
  }
  if (!capability.hasOwnerMeta) {
    return "Urban layer is missing country owner metadata; Adaptive mode is disabled until the topology is rebuilt.";
  }
  return "";
}

function getUrbanLayerCapability(collection) {
  const features = Array.isArray(collection?.features) ? collection.features : [];
  if (!features.length) {
    return createUrbanLayerCapability();
  }

  let missingStableIdCount = 0;
  let missingOwnerCount = 0;
  let corruptBoundsCount = 0;

  features.forEach((feature) => {
    if (!getUrbanFeatureStableId(feature)) {
      missingStableIdCount += 1;
    }
    if (!getUrbanFeatureOwnerId(feature)) {
      missingOwnerCount += 1;
    }
    const bounds = getUrbanFeatureGeoBounds(feature);
    if (
      bounds
      && (bounds.width >= URBAN_CORRUPT_BOUNDS_WIDTH_DEG || bounds.height >= URBAN_CORRUPT_BOUNDS_HEIGHT_DEG)
    ) {
      corruptBoundsCount += 1;
    }
  });

  const capability = createUrbanLayerCapability({
    featureCount: features.length,
    hasGeometry: true,
    hasStableId: missingStableIdCount === 0,
    hasOwnerMeta: missingOwnerCount === 0,
    hasCorruptBounds: corruptBoundsCount > 0,
    missingStableIdCount,
    missingOwnerCount,
    corruptBoundsCount,
  });
  capability.adaptiveAvailable = capability.hasGeometry
    && capability.hasStableId
    && capability.hasOwnerMeta
    && !capability.hasCorruptBounds;
  capability.unavailableReason = getUrbanCapabilityUnavailableReason(capability);
  return capability;
}

function canRenderUrbanCollection(capability) {
  return !!capability?.hasGeometry && !capability?.hasCorruptBounds;
}

function canPreferUrbanDetailCollection(capability) {
  return canRenderUrbanCollection(capability) && !!capability?.hasStableId && !!capability?.hasOwnerMeta;
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
  const isUrbanLayer = layerName === "urban";
  const primaryUrbanCapability = isUrbanLayer ? getUrbanLayerCapability(primaryCollection) : null;
  const detailUrbanCapability = isUrbanLayer ? getUrbanLayerCapability(detailCollection) : null;
  const externalUrbanCapability = isUrbanLayer ? getUrbanLayerCapability(externalContextCollection) : null;
  const pick = pickBestLayerSource(
    isUrbanLayer && !canRenderUrbanCollection(primaryUrbanCapability) ? null : primaryCollection,
    isUrbanLayer && !canPreferUrbanDetailCollection(detailUrbanCapability) ? null : detailCollection,
    {
    minScore: layerName === "special_zones" ? 0 : CONTEXT_LAYER_MIN_SCORE,
    preferDetailWhenPrimaryEmpty: layerName === "special_zones",
    }
  );

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
    ...(isUrbanLayer
      ? {
          primaryAdaptiveAvailable: !!primaryUrbanCapability?.adaptiveAvailable,
          detailAdaptiveAvailable: !!detailUrbanCapability?.adaptiveAvailable,
          primaryMissingStableIds: Number(primaryUrbanCapability?.missingStableIdCount || 0),
          primaryMissingOwnerMeta: Number(primaryUrbanCapability?.missingOwnerCount || 0),
          primaryCorruptBounds: Number(primaryUrbanCapability?.corruptBoundsCount || 0),
          detailMissingStableIds: Number(detailUrbanCapability?.missingStableIdCount || 0),
          detailMissingOwnerMeta: Number(detailUrbanCapability?.missingOwnerCount || 0),
          detailCorruptBounds: Number(detailUrbanCapability?.corruptBoundsCount || 0),
        }
      : {}),
  };

  if (isUrbanLayer) {
    state.urbanLayerCapability = pick.source === "detail"
      ? detailUrbanCapability
      : primaryUrbanCapability;
  }

  if (pick.source === "none" && Array.isArray(externalContextCollection?.features)) {
    if (isUrbanLayer && !canRenderUrbanCollection(externalUrbanCapability)) {
      state.urbanLayerCapability = externalUrbanCapability;
      return pick.collection;
    }
    state.contextLayerSourceByName[layerName] = "external";
    state.layerDataDiagnostics[layerName] = {
      source: "external",
      primaryCount: pick.primaryCount,
      detailCount: externalContextCollection.features.length,
      primaryScore: Number(pick.primaryScore.toFixed(3)),
      detailScore: 1,
      ...(isUrbanLayer
        ? {
            externalAdaptiveAvailable: !!externalUrbanCapability?.adaptiveAvailable,
            externalMissingStableIds: Number(externalUrbanCapability?.missingStableIdCount || 0),
            externalMissingOwnerMeta: Number(externalUrbanCapability?.missingOwnerCount || 0),
            externalCorruptBounds: Number(externalUrbanCapability?.corruptBoundsCount || 0),
          }
        : {}),
    };
    if (isUrbanLayer) {
      state.urbanLayerCapability = externalUrbanCapability;
    }
    return externalContextCollection;
  }

  if (isUrbanLayer && !state.urbanLayerCapability) {
    state.urbanLayerCapability = createUrbanLayerCapability();
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
    layerResolverCache.bundleMode === state.topologyBundleMode &&
    layerResolverCache.contextRevision === Number(state.contextLayerRevision || 0);
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
  ensureBathymetryDataAvailability({ required: false });

  const diag = state.layerDataDiagnostics || {};
  console.info(
    `${LAYER_DIAG_PREFIX} sources: ocean=${diag.ocean?.source || "none"}, `
      + `land=${diag.land?.source || "none"}, water_regions=${diag.water_regions?.source || "none"}, `
      + `rivers=${diag.rivers?.source || "none"}, `
      + `urban=${diag.urban?.source || "none"}, physical=${diag.physical?.source || "none"}, `
      + `special_zones=${diag.special_zones?.source || "none"}, `
      + `bathymetry=${state.activeBathymetrySource || "none"}`
  );
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }

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
  layerResolverCache.contextRevision = Number(state.contextLayerRevision || 0);

  if (typeof state.updateSpecialZoneEditorUIFn === "function") {
    state.updateSpecialZoneEditorUIFn();
  }
}

function invalidateContextLayerVisualState(layerName, reason = "context-layer-loaded", { renderNow = true } = {}) {
  return invalidateContextLayerVisualStateBatch([layerName], reason, { renderNow });
}

function invalidateContextLayerVisualStateBatch(layerNames, reason = "context-layer-loaded", { renderNow = true } = {}) {
  layerResolverCache.primaryRef = null;
  layerResolverCache.detailRef = null;
  layerResolverCache.bundleMode = null;
  layerResolverCache.contextRevision = Number.NaN;
  const targetPasses = new Set(["contextBase"]);
  const normalizedLayerNames = Array.isArray(layerNames) ? layerNames : [layerNames];
  normalizedLayerNames.forEach((layerName) => {
    const normalized = String(layerName || "").trim().toLowerCase();
    if (normalized === "physical" || normalized === "physical_semantics") {
      targetPasses.add("physicalBase");
      targetPasses.add("dayNight");
    }
    if (normalized === "urban") {
      targetPasses.add("dayNight");
    }
  });
  const resolvedPasses = Array.from(targetPasses);
  invalidateRenderPasses(resolvedPasses, reason);
  clearRenderPassReferenceTransforms(resolvedPasses);
  if (renderNow) {
    requestRendererRender(`context-layer-visual:${reason}`, { flush: true });
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

  strategicDefs = svg.select("defs.strategic-overlay-defs");
  if (strategicDefs.empty()) {
    strategicDefs = svg.append("defs").attr("class", "strategic-overlay-defs");
  }

  frontlineOverlayGroup = viewportGroup.select("g.frontline-overlay-layer");
  if (frontlineOverlayGroup.empty()) {
    frontlineOverlayGroup = viewportGroup.append("g").attr("class", "frontline-overlay-layer");
  }
  frontlineOverlayGroup
    .style("pointer-events", "none")
    .attr("role", "img")
    .attr("aria-label", "Strategic frontline overlay")
    .attr("aria-hidden", "true")
    .attr("focusable", "false");

  frontlineLabelsGroup = viewportGroup.select("g.frontline-labels-layer");
  if (frontlineLabelsGroup.empty()) {
    frontlineLabelsGroup = viewportGroup.append("g").attr("class", "frontline-labels-layer");
  }
  frontlineLabelsGroup
    .style("pointer-events", "none")
    .attr("role", "img")
    .attr("aria-label", "Strategic frontline labels")
    .attr("aria-hidden", "true")
    .attr("focusable", "false");

  operationalLinesGroup = viewportGroup.select("g.operational-lines-layer");
  if (operationalLinesGroup.empty()) {
    operationalLinesGroup = viewportGroup.append("g").attr("class", "operational-lines-layer");
  }
  operationalLinesGroup
    .style("pointer-events", "none")
    .attr("role", "img")
    .attr("aria-label", "Operational lines")
    .attr("aria-hidden", "true")
    .attr("focusable", "false");

  operationGraphicsGroup = viewportGroup.select("g.operation-graphics-layer");
  if (operationGraphicsGroup.empty()) {
    operationGraphicsGroup = viewportGroup.append("g").attr("class", "operation-graphics-layer");
  }
  operationGraphicsGroup
    .style("pointer-events", "none")
    .attr("role", "img")
    .attr("aria-label", "Strategic operation graphics")
    .attr("aria-hidden", "true")
    .attr("focusable", "false");

  operationGraphicsEditorGroup = viewportGroup.select("g.operation-graphics-editor-layer");
  if (operationGraphicsEditorGroup.empty()) {
    operationGraphicsEditorGroup = viewportGroup.append("g").attr("class", "operation-graphics-editor-layer");
  }
  operationGraphicsEditorGroup
    .style("pointer-events", "all")
    .attr("role", "img")
    .attr("aria-label", "Strategic operation graphics editor")
    .attr("aria-hidden", "true")
    .attr("focusable", "false");

  unitCountersGroup = viewportGroup.select("g.unit-counters-layer");
  if (unitCountersGroup.empty()) {
    unitCountersGroup = viewportGroup.append("g").attr("class", "unit-counters-layer");
  }
  unitCountersGroup
    .style("pointer-events", "all")
    .attr("role", "img")
    .attr("aria-label", "Strategic unit counters")
    .attr("aria-hidden", "true")
    .attr("focusable", "false");

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
  interactionRect
    .style("pointer-events", "all")
    // Keep the global hit surface behind editor overlays so midpoint/vertex handles can win hit-testing.
    .lower();
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
  const ownershipContext = {
    ownershipByFeatureId: state.sovereigntyByFeatureId,
    controllerByFeatureId: state.scenarioControllersByFeatureId,
    shellOwnerByFeatureId: state.scenarioAutoShellOwnerByFeatureId,
    shellControllerByFeatureId: state.scenarioAutoShellControllerByFeatureId,
    scenarioActive: !!state.activeScenarioId,
    viewMode: state.scenarioViewMode,
  };
  state.cachedDynamicOwnerBorders = buildDynamicOwnerBorderMesh(
    state.runtimePoliticalTopology,
    ownershipContext
  );
  const unresolvedEntityCount = countUnresolvedOwnerBorderEntities(
    state.runtimePoliticalTopology,
    ownershipContext
  );
  state.cachedDynamicBordersHash = nextHash;
  state.dynamicBordersDirty = false;
  state.dynamicBordersDirtyReason = "";
  updateDynamicBorderStatusUI();
  invalidateRenderPasses("borders", "dynamic-borders");
  recordRenderPerfMetric("rebuildDynamicBorders", nowMs() - startedAt, {
    enabled: true,
    cacheHit: false,
    unresolvedEntityCount,
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
  let cacheMatches = false;
  const meshPackMesh = state.activeScenarioMeshPack?.meshes?.opening_owner_borders;
  const hasMeshPackMesh = isUsableMesh(meshPackMesh);
  const shouldBuild =
    !!state.activeScenarioId
    && state.scenarioBorderMode === "scenario_owner_only"
    && String(state.scenarioViewMode || "ownership") === "ownership"
    && (hasMeshPackMesh || !!state.runtimePoliticalTopology?.objects?.political)
    && Object.keys(state.scenarioBaselineOwnersByFeatureId || {}).length > 0;

  if (shouldBuild) {
    const runtimeRef = state.runtimePoliticalTopology;
    const meshPackRef = state.activeScenarioMeshPack || null;
    const scenarioId = String(state.activeScenarioId || "");
    const baselineHash = String(state.scenarioBaselineHash || "");
    const shellRevision = Number(state.scenarioShellOverlayRevision) || 0;
    const meshSource = hasMeshPackMesh ? "mesh_pack" : "runtime";
    cacheMatches =
      scenarioOpeningOwnerBorderCache.meshSource === meshSource
      && scenarioOpeningOwnerBorderCache.scenarioId === scenarioId
      && (baselineHash
        ? scenarioOpeningOwnerBorderCache.baselineHash === baselineHash
        : scenarioOpeningOwnerBorderCache.baselineOwnersRef === state.scenarioBaselineOwnersByFeatureId)
      && scenarioOpeningOwnerBorderCache.shellRevision === shellRevision
      && (meshSource === "mesh_pack"
        ? scenarioOpeningOwnerBorderCache.meshPackRef === meshPackRef
        : scenarioOpeningOwnerBorderCache.runtimeRef === runtimeRef)
      && isUsableMesh(scenarioOpeningOwnerBorderCache.mesh);

    state.cachedScenarioOpeningOwnerBorders = cacheMatches
      ? scenarioOpeningOwnerBorderCache.mesh
      : (
        hasMeshPackMesh
          ? meshPackMesh
          : buildOwnerBorderMesh(
            runtimeRef,
            {
              ownershipByFeatureId: state.scenarioBaselineOwnersByFeatureId,
              shellOwnerByFeatureId: state.scenarioAutoShellOwnerByFeatureId,
              scenarioActive: false,
              viewMode: "ownership",
            },
            { excludeSea: true }
          )
      );

    scenarioOpeningOwnerBorderCache = {
      runtimeRef,
      meshPackRef,
      scenarioId,
      baselineHash,
      baselineOwnersRef: state.scenarioBaselineOwnersByFeatureId,
      shellRevision,
      meshSource,
      mesh: state.cachedScenarioOpeningOwnerBorders,
    };
  } else {
    state.cachedScenarioOpeningOwnerBorders = null;
  }

  invalidateRenderPasses("borders", reason || "scenario-opening-borders");
  recordRenderPerfMetric("refreshScenarioOpeningOwnerBorders", nowMs() - startedAt, {
    enabled: shouldBuild,
    cacheHit: !!shouldBuild && !!cacheMatches,
    source: hasMeshPackMesh ? "mesh_pack" : "runtime",
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

function countUnresolvedOwnerBorderEntities(runtimeTopology, ownershipContext = {}) {
  const geometries = runtimeTopology?.objects?.political?.geometries;
  if (!Array.isArray(geometries) || !geometries.length) return 0;
  let unresolvedCount = 0;
  geometries.forEach((geometry) => {
    if (shouldExcludeOwnerBorderEntity(geometry, { excludeSea: true })) return;
    if (resolveOwnerBorderCode(geometry, ownershipContext)) return;
    unresolvedCount += 1;
  });
  return unresolvedCount;
}

function buildDetailAdmBorderMesh(topology, includedCountries) {
  const object = topology?.objects?.political;
  if (!object || !globalThis.topojson || !includedCountries?.size) {
    return null;
  }

  return globalThis.topojson.mesh(topology, object, (a, b) => {
    if (!a || !b) return false;
    if (shouldExcludePoliticalInteractionFeature(asFeatureLike(a)) || shouldExcludePoliticalInteractionFeature(asFeatureLike(b))) {
      return false;
    }
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

function buildScenarioDistrictGroupingCandidate(countryCode, featureEntries) {
  const districtCountry = state.scenarioDistrictGroupsData?.countries?.[countryCode];
  if (!districtCountry || typeof districtCountry !== "object") return null;
  const idSet = new Set(featureEntries.map((entry) => entry.id));
  const featureToGroup = new Map();
  Object.entries(districtCountry.districts && typeof districtCountry.districts === "object" ? districtCountry.districts : {})
    .forEach(([districtId, rawDistrict]) => {
      const normalizedDistrictId = String(rawDistrict?.id || rawDistrict?.district_id || districtId || "").trim();
      if (!normalizedDistrictId) return;
      const featureIds = Array.isArray(rawDistrict?.feature_ids) ? rawDistrict.feature_ids : [];
      featureIds.forEach((featureId) => {
        const normalizedFeatureId = String(featureId || "").trim();
        if (!normalizedFeatureId || !idSet.has(normalizedFeatureId)) return;
        if (!featureToGroup.has(normalizedFeatureId)) {
          featureToGroup.set(normalizedFeatureId, normalizedDistrictId);
        }
      });
    });
  if (!featureToGroup.size) {
    return {
      countryCode,
      source: "scenario_district",
      featureToGroup,
      groupCounts: new Map(),
      totalCount: featureEntries.length,
      groupedCount: 0,
      groupCount: 0,
      groupCountTotal: 0,
      coverage: 0,
      dominantShare: 1,
      accepted: false,
      forcedRule: "scenario_district",
    };
  }
  return {
    ...evaluateCountryGroupingCandidate(countryCode, "scenario_district", featureEntries, featureToGroup),
    forcedRule: "scenario_district",
  };
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

  const scenarioDistrictCandidate = buildScenarioDistrictGroupingCandidate(countryCode, featureEntries);
  if (scenarioDistrictCandidate) {
    return scenarioDistrictCandidate;
  }
  if (String(state.activeScenarioId || "").trim().toLowerCase() === "tno_1962") {
    return null;
  }

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
    if (!candidate) return;

    candidate.featureToGroup.forEach((group, featureId) => {
      featureToGroup.set(featureId, group);
    });
    if (candidate.accepted) {
      supported.push(countryCode);
    }
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

function resetContourHostFillColorCache() {
  contourHostFillColorCache = new WeakMap();
}
function resetExactRefreshOptimizationState() {
  resetContourHostFillColorCache();
  resetContourVisibleSetCache();
  cancelDeferredContextBaseEnhancement({ resetFlag: true });
  detailAdmMeshBuildState = {
    signature: "",
    status: "idle",
  };
}

function resetContourVisibleSetCache() {
  contourVisibleSetCache = {
    major: { collectionRef: null, key: "", features: [] },
    minor: { collectionRef: null, key: "", features: [] },
  };
}

function cancelDeferredContextBaseEnhancement({ resetFlag = false } = {}) {
  cancelDeferredWork(deferredContextBaseEnhancementHandle);
  deferredContextBaseEnhancementHandle = null;
  if (resetFlag) {
    deferContextBaseEnhancements = false;
  }
}

function shouldDeferContextBaseEnhancementsForExactRefresh(
  reuseDecision = null,
  forceExactContextBaseRefresh = false,
) {
  const resolvedReuseDecision =
    reuseDecision && typeof reuseDecision === "object"
      ? reuseDecision
      : null;
  if (!resolvedReuseDecision && !forceExactContextBaseRefresh) {
    return false;
  }
  return !!(
    resolvedReuseDecision?.crossesZoomBucket
    || (
      Number.isFinite(Number(resolvedReuseDecision?.distancePx))
      && Number.isFinite(Number(resolvedReuseDecision?.maxDistancePx))
      && Number(resolvedReuseDecision.distancePx) > Number(resolvedReuseDecision.maxDistancePx)
    )
    || String(resolvedReuseDecision?.zoomBucket || "") === "high"
  );
}

function scheduleDeferredContextBaseEnhancements() {
  cancelDeferredContextBaseEnhancement();
  deferredContextBaseEnhancementHandle = scheduleDeferredWork(() => {
    deferredContextBaseEnhancementHandle = null;
    if (!deferContextBaseEnhancements) {
      return;
    }
    if (state.renderPhase !== RENDER_PHASE_IDLE || state.deferExactAfterSettle) {
      scheduleDeferredContextBaseEnhancements();
      return;
    }
    deferContextBaseEnhancements = false;
    invalidateRenderPasses(["contextBase", "labels"], "context-base-enhancement");
    render();
  }, {
    timeout: 180,
  });
}

function setStaticMeshSourceCountries(sourceCountries = {}) {
  staticMeshSourceCountries = {
    primary: sourceCountries.primary instanceof Set ? new Set(sourceCountries.primary) : new Set(),
    detail: sourceCountries.detail instanceof Set ? new Set(sourceCountries.detail) : new Set(),
  };
}

function resetVisibleInternalBorderMeshSignature() {
  visibleInternalBorderMeshSignature = "";
  visibleBorderCountryCodesCache = {
    signature: "",
    codes: new Set(),
  };
}

function resetDetailAdmMeshBuildState() {
  detailAdmMeshBuildState = {
    signature: "",
    status: "idle",
  };
}

function syncStaticMeshSnapshot() {
  staticMeshCache.snapshot = captureStaticMeshSnapshot();
}

function buildDetailAdmMeshSignature(visibleCountryCodes = new Set(), k = state.zoomTransform?.k || 1) {
  const detailCountries = Array.from(staticMeshSourceCountries.detail || new Set())
    .filter((countryCode) => visibleCountryCodes.has(countryCode))
    .sort((left, right) => left.localeCompare(right));
  return {
    detailCountries,
    signature: [
      Number(state.topologyRevision || 0),
      String(getContextBaseZoomBucketId(k)),
      ...detailCountries,
    ].join("|"),
  };
}

function getVisibleCountryCodesForBorderMeshes() {
  const viewportBounds = getProjectedViewportBounds({ overscanPx: VIEWPORT_CULL_OVERSCAN_PX * 0.5 });
  if (!viewportBounds) {
    return new Set();
  }
  const signature = [
    Number(state.topologyRevision || 0),
    Number(state.zoomTransform?.k || 1).toFixed(3),
    Number(viewportBounds.minX || 0).toFixed(1),
    Number(viewportBounds.minY || 0).toFixed(1),
    Number(viewportBounds.maxX || 0).toFixed(1),
    Number(viewportBounds.maxY || 0).toFixed(1),
    Array.isArray(state.spatialItems) ? state.spatialItems.length : 0,
  ].join("|");
  if (visibleBorderCountryCodesCache.signature === signature) {
    return new Set(visibleBorderCountryCodesCache.codes);
  }
  const visible = new Set();
  const minX = Number(viewportBounds.minX);
  const minY = Number(viewportBounds.minY);
  const maxX = Number(viewportBounds.maxX);
  const maxY = Number(viewportBounds.maxY);
  (state.spatialItems || []).forEach((item) => {
    const countryCode = canonicalCountryCode(item?.countryCode || "");
    if (!countryCode || visible.has(countryCode)) return;
    if (item.maxX < minX || item.maxY < minY || item.minX > maxX || item.minY > maxY) {
      return;
    }
    visible.add(countryCode);
  });
  visibleBorderCountryCodesCache = {
    signature,
    codes: new Set(visible),
  };
  return visible;
}

function ensureCountrySourceBorderMeshes(countryCode, {
  includeProvince = true,
  includeLocal = true,
} = {}) {
  const normalizedCode = canonicalCountryCode(countryCode);
  if (!normalizedCode || !globalThis.topojson) return;
  const needsProvince = includeProvince && !state.cachedProvinceBordersByCountry?.has(normalizedCode);
  const needsLocal = includeLocal && !state.cachedLocalBordersByCountry?.has(normalizedCode);
  if (!needsProvince && !needsLocal) {
    return;
  }

  const nextProvinceMeshes = [];
  const nextLocalMeshes = [];
  const sources = [
    { key: "detail", topology: state.topologyDetail },
    { key: "primary", topology: state.topologyPrimary || state.topology },
  ];
  sources.forEach(({ key, topology }) => {
    if (!topology?.objects?.political) return;
    if (!staticMeshSourceCountries[key]?.has(normalizedCode)) return;
    const meshes = buildSourceBorderMeshes(topology, new Set([normalizedCode]));
    if (!meshes) return;
    if (needsProvince) {
      const provinceMeshes = meshes.provinceMeshesByCountry?.get(normalizedCode) || [];
      provinceMeshes.forEach((mesh) => {
        if (isUsableMesh(mesh)) {
          nextProvinceMeshes.push(mesh);
          state.cachedProvinceBorders.push(mesh);
        }
      });
    }
    if (needsLocal) {
      const localMeshes = meshes.localMeshesByCountry?.get(normalizedCode) || [];
      localMeshes.forEach((mesh) => {
        if (isUsableMesh(mesh)) {
          nextLocalMeshes.push(mesh);
          state.cachedLocalBorders.push(mesh);
        }
      });
    }
  });
  if (needsProvince) {
    state.cachedProvinceBordersByCountry.set(normalizedCode, nextProvinceMeshes);
  }
  if (needsLocal) {
    state.cachedLocalBordersByCountry.set(normalizedCode, nextLocalMeshes);
    state.cachedGridLines = [...(state.cachedLocalBorders || [])];
  }
}

function cancelDeferredHeavyBorderMeshes() {
  cancelDeferredWork(deferredHeavyBorderMeshHandle);
  deferredHeavyBorderMeshHandle = null;
}

function scheduleDeferredHeavyBorderMeshes() {
  cancelDeferredHeavyBorderMeshes();
  deferredHeavyBorderMeshHandle = scheduleDeferredWork(() => {
    deferredHeavyBorderMeshHandle = null;
    if (state.renderPhase !== RENDER_PHASE_IDLE || state.deferExactAfterSettle) {
      scheduleDeferredHeavyBorderMeshes();
      return;
    }
    const visibleCountryCodes = getVisibleCountryCodesForBorderMeshes();
    if (!visibleCountryCodes.size) return;
    const currentZoom = Math.max(0.0001, Number(state.zoomTransform?.k || 1));
    const includeProvince = currentZoom >= PROVINCE_BORDERS_TRANSITION_END_ZOOM;
    const includeLocal = currentZoom >= LOCAL_BORDERS_MIN_ZOOM;
    const detailAdmMeta = currentZoom >= DETAIL_ADM_BORDERS_MIN_ZOOM
      ? buildDetailAdmMeshSignature(visibleCountryCodes, currentZoom)
      : { detailCountries: [], signature: "" };
    const includeDetailAdm =
      currentZoom >= DETAIL_ADM_BORDERS_MIN_ZOOM
      && detailAdmMeta.detailCountries.length > 0
      && (
        detailAdmMeshBuildState.signature !== detailAdmMeta.signature
        || detailAdmMeshBuildState.status === "idle"
      );
    if (!includeProvince && !includeLocal && !includeDetailAdm) return;
    let changed = false;
    let snapshotChanged = false;
    visibleCountryCodes.forEach((countryCode) => {
      const hadProvince = state.cachedProvinceBordersByCountry?.has(countryCode);
      const hadLocal = state.cachedLocalBordersByCountry?.has(countryCode);
      ensureCountrySourceBorderMeshes(countryCode, {
        includeProvince,
        includeLocal,
      });
      if ((includeProvince && !hadProvince && state.cachedProvinceBordersByCountry?.has(countryCode))
        || (includeLocal && !hadLocal && state.cachedLocalBordersByCountry?.has(countryCode))) {
        changed = true;
        snapshotChanged = true;
      }
    });
    if (includeDetailAdm) {
      const previousDetailAdmStatus = String(detailAdmMeshBuildState.status || "idle");
      const detailAdmMesh = buildDetailAdmBorderMesh(state.topologyDetail, new Set(detailAdmMeta.detailCountries));
      if (isUsableMesh(detailAdmMesh)) {
        state.cachedDetailAdmBorders = [detailAdmMesh];
        detailAdmMeshBuildState = {
          signature: detailAdmMeta.signature,
          status: "ready",
        };
        changed = true;
        snapshotChanged = true;
      } else {
        detailAdmMeshBuildState = {
          signature: detailAdmMeta.signature,
          status: "empty",
        };
        snapshotChanged =
          snapshotChanged
          || previousDetailAdmStatus !== "empty"
          || state.cachedDetailAdmBorders.length > 0;
      }
    }
    if (snapshotChanged) {
      syncStaticMeshSnapshot();
    }
    if (changed) {
      invalidateRenderPasses("borders", "deferred-country-border-meshes");
      render();
    }
  }, {
    timeout: 220,
  });
}

function serializeCountrySetSignature(countrySet) {
  return Array.from(countrySet || []).sort((left, right) => left.localeCompare(right)).join(",");
}

function getSourceCountriesSignature(sourceCountries = {}) {
  return [
    `primary:${serializeCountrySetSignature(sourceCountries.primary)}`,
    `detail:${serializeCountrySetSignature(sourceCountries.detail)}`,
  ].join("|");
}

function getCoastlineDecisionSignature(decision = null) {
  if (!decision || typeof decision !== "object") {
    return "";
  }
  return [
    String(decision.source || ""),
    String(decision.reason || ""),
    String(decision.scenarioId || ""),
    String(decision.primaryObjectName || ""),
    String(decision.runtimeObjectName || ""),
    String(decision.meshMode || ""),
    Number(decision.primaryFeatureCount || 0),
    Number(decision.runtimeFeatureCount || 0),
    Number(decision.primaryPolygonPartCount || 0),
    Number(decision.runtimePolygonPartCount || 0),
    Number(decision.primaryInteriorRingCount || 0),
    Number(decision.runtimeInteriorRingCount || 0),
    Number(decision.runtimeInteriorRingRatio || 0),
    Number(decision.areaDeltaRatio || 0),
  ].join("|");
}

function captureStaticMeshSnapshot() {
  return {
    cachedCountryBorders: [...(state.cachedCountryBorders || [])],
    cachedProvinceBorders: [...(state.cachedProvinceBorders || [])],
    cachedProvinceBordersByCountry: new Map(state.cachedProvinceBordersByCountry || []),
    cachedLocalBorders: [...(state.cachedLocalBorders || [])],
    cachedLocalBordersByCountry: new Map(state.cachedLocalBordersByCountry || []),
    cachedDetailAdmBorders: [...(state.cachedDetailAdmBorders || [])],
    cachedCoastlines: [...(state.cachedCoastlines || [])],
    cachedCoastlinesHigh: [...(state.cachedCoastlinesHigh || [])],
    cachedCoastlinesMid: [...(state.cachedCoastlinesMid || [])],
    cachedCoastlinesLow: [...(state.cachedCoastlinesLow || [])],
    cachedParentBordersByCountry: new Map(state.cachedParentBordersByCountry || []),
    cachedGridLines: [...(state.cachedGridLines || [])],
    parentGroupByFeatureId: new Map(state.parentGroupByFeatureId || []),
    parentBorderMetaByCountry: { ...(state.parentBorderMetaByCountry || {}) },
    parentBorderSupportedCountries: [...(state.parentBorderSupportedCountries || [])],
    detailAdmMeshBuildState: { ...(detailAdmMeshBuildState || { signature: "", status: "idle" }) },
  };
}

function restoreStaticMeshSnapshot(snapshot) {
  if (!snapshot) return;
  state.cachedCountryBorders = [...(snapshot.cachedCountryBorders || [])];
  state.cachedProvinceBorders = [...(snapshot.cachedProvinceBorders || [])];
  state.cachedProvinceBordersByCountry = new Map(snapshot.cachedProvinceBordersByCountry || []);
  state.cachedLocalBorders = [...(snapshot.cachedLocalBorders || [])];
  state.cachedLocalBordersByCountry = new Map(snapshot.cachedLocalBordersByCountry || []);
  state.cachedDetailAdmBorders = [...(snapshot.cachedDetailAdmBorders || [])];
  state.cachedCoastlines = [...(snapshot.cachedCoastlines || [])];
  state.cachedCoastlinesHigh = [...(snapshot.cachedCoastlinesHigh || [])];
  state.cachedCoastlinesMid = [...(snapshot.cachedCoastlinesMid || [])];
  state.cachedCoastlinesLow = [...(snapshot.cachedCoastlinesLow || [])];
  state.cachedParentBordersByCountry = new Map(snapshot.cachedParentBordersByCountry || []);
  state.cachedGridLines = [...(snapshot.cachedGridLines || [])];
  state.parentGroupByFeatureId = new Map(snapshot.parentGroupByFeatureId || []);
  state.parentBorderMetaByCountry = { ...(snapshot.parentBorderMetaByCountry || {}) };
  state.parentBorderSupportedCountries = [...(snapshot.parentBorderSupportedCountries || [])];
  detailAdmMeshBuildState = snapshot.detailAdmMeshBuildState && typeof snapshot.detailAdmMeshBuildState === "object"
    ? {
      signature: String(snapshot.detailAdmMeshBuildState.signature || ""),
      status: String(snapshot.detailAdmMeshBuildState.status || "idle"),
    }
    : { signature: "", status: "idle" };
  syncParentBorderEnabledByCountry(state.parentBorderSupportedCountries);
}

function buildSourceBorderMeshes(topology, includedCountries) {
  const object = topology?.objects?.political;
  if (!object || !globalThis.topojson || !includedCountries?.size) {
    return null;
  }
  const provinceMeshesByCountry = new Map();
  const localMeshesByCountry = new Map();
  const provinceMeshes = [];
  const localMeshes = [];

  includedCountries.forEach((countryCode) => {
    const normalizedCode = canonicalCountryCode(countryCode);
    if (!normalizedCode) return;
    const provinceMesh = globalThis.topojson.mesh(
      topology,
      object,
      (a, b) => {
        if (!a || !b) return false;
        if (shouldExcludePoliticalInteractionFeature(asFeatureLike(a)) || shouldExcludePoliticalInteractionFeature(asFeatureLike(b))) {
          return false;
        }
        const codeA = getFeatureCountryCodeNormalized(a);
        const codeB = getFeatureCountryCodeNormalized(b);
        if (!codeA || !codeB || codeA !== normalizedCode || codeB !== normalizedCode) return false;
        const groupA = getAdmin1Group(a);
        const groupB = getAdmin1Group(b);
        return !!(groupA && groupB && groupA !== groupB);
      }
    );
    if (isUsableMesh(provinceMesh)) {
      provinceMeshesByCountry.set(normalizedCode, [provinceMesh]);
      provinceMeshes.push(provinceMesh);
    }

    const localMesh = globalThis.topojson.mesh(
      topology,
      object,
      (a, b) => {
        if (!a || !b) return false;
        if (shouldExcludePoliticalInteractionFeature(asFeatureLike(a)) || shouldExcludePoliticalInteractionFeature(asFeatureLike(b))) {
          return false;
        }
        const codeA = getFeatureCountryCodeNormalized(a);
        const codeB = getFeatureCountryCodeNormalized(b);
        if (!codeA || !codeB || codeA !== normalizedCode || codeB !== normalizedCode) return false;
        const groupA = getAdmin1Group(a);
        const groupB = getAdmin1Group(b);
        return !(groupA && groupB && groupA !== groupB);
      }
    );
    if (isUsableMesh(localMesh)) {
      localMeshesByCountry.set(normalizedCode, [localMesh]);
      localMeshes.push(localMesh);
    }
  });

  return {
    provinceMeshes,
    provinceMeshesByCountry,
    localMeshes,
    localMeshesByCountry,
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

function getTopologyObjectFeatureCollection(topology, objectNames = []) {
  if (!topology?.objects || typeof globalThis.topojson?.feature !== "function") {
    return { objectName: "", collection: null };
  }
  for (const objectName of objectNames) {
    const object = topology.objects?.[objectName];
    if (!object) continue;
    try {
      const collection = globalThis.topojson.feature(topology, object);
      if (collection?.features?.length) {
        return { objectName, collection };
      }
    } catch (_error) {
      continue;
    }
  }
  return { objectName: "", collection: null };
}

function countGeometryPolygonParts(geometry) {
  if (!geometry || !geometry.type) return { polygonPartCount: 0, interiorRingCount: 0 };
  if (geometry.type === "Polygon") {
    const rings = Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
    return {
      polygonPartCount: 1,
      interiorRingCount: Math.max(0, rings - 1),
    };
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const polygonPartCount = polygons.length;
    const interiorRingCount = polygons.reduce((total, polygon) => {
      const rings = Array.isArray(polygon) ? polygon.length : 0;
      return total + Math.max(0, rings - 1);
    }, 0);
    return { polygonPartCount, interiorRingCount };
  }
  if (geometry.type === "GeometryCollection") {
    return (geometry.geometries || []).reduce((acc, child) => {
      const childCounts = countGeometryPolygonParts(child);
      acc.polygonPartCount += childCounts.polygonPartCount;
      acc.interiorRingCount += childCounts.interiorRingCount;
      return acc;
    }, { polygonPartCount: 0, interiorRingCount: 0 });
  }
  return { polygonPartCount: 0, interiorRingCount: 0 };
}

function getCoastlineTopologyMetrics(topology, objectNames = []) {
  const { objectName, collection } = getTopologyObjectFeatureCollection(topology, objectNames);
  if (!collection?.features?.length) {
    return {
      objectName: "",
      featureCount: 0,
      polygonPartCount: 0,
      interiorRingCount: 0,
      totalArea: 0,
      bounds: null,
      worldBounds: false,
    };
  }
  let totalArea = 0;
  collection.features.forEach((feature) => {
    try {
      totalArea += Number(globalThis.d3?.geoArea?.(feature)) || 0;
    } catch (_error) {
      // Ignore per-feature area failures; the gate is conservative.
    }
  });
  const counts = collection.features.reduce((acc, feature) => {
    const featureCounts = countGeometryPolygonParts(feature?.geometry);
    acc.polygonPartCount += featureCounts.polygonPartCount;
    acc.interiorRingCount += featureCounts.interiorRingCount;
    return acc;
  }, { polygonPartCount: 0, interiorRingCount: 0 });
  let bounds = null;
  try {
    bounds = globalThis.d3?.geoBounds?.(collection) || null;
  } catch (_error) {
    bounds = null;
  }
  return {
    objectName,
    featureCount: collection.features.length,
    polygonPartCount: counts.polygonPartCount,
    interiorRingCount: counts.interiorRingCount,
    totalArea,
    bounds,
    worldBounds: isWorldBounds(bounds),
  };
}

function publishScenarioCoastlineDecision(decision) {
  if (!decision || typeof decision !== "object") return decision;
  const publicDecision = { ...decision };
  delete publicDecision.topology;
  recordRenderPerfMetric("resolveScenarioCoastlineSource", 0, publicDecision);
  globalThis.__mapCoastlineDiag = publicDecision;
  if (renderDiag.enabled) {
    globalThis.__mapRenderDiag = {
      ...(globalThis.__mapRenderDiag || { enabled: true }),
      coastline: publicDecision,
    };
  }
  return decision;
}

function resolveCoastlineTopologySource() {
  const primaryTopology = state.topologyPrimary || state.topology || null;
  const runtimeTopology = state.runtimePoliticalTopology || null;
  const scenarioId = String(state.activeScenarioId || "").trim();

  const cacheMatches =
    scenarioCoastlineSourceCache.primaryRef === primaryTopology &&
    scenarioCoastlineSourceCache.runtimeRef === runtimeTopology &&
    scenarioCoastlineSourceCache.scenarioId === scenarioId;
  if (cacheMatches && scenarioCoastlineSourceCache.decision) {
    return scenarioCoastlineSourceCache.decision;
  }

  const primaryMetrics = getCoastlineTopologyMetrics(primaryTopology, ["land_mask", "land"]);
  const runtimeMaskMetrics = scenarioId
    ? getCoastlineTopologyMetrics(runtimeTopology, ["context_land_mask", "land_mask", "land"])
    : null;
  let decision = {
    source: "primary",
    reason: scenarioId ? "missing_runtime_land_mask" : "no_active_scenario",
    scenarioId,
    primaryObjectName: primaryMetrics.objectName || "",
    runtimeObjectName: runtimeMaskMetrics?.objectName || "",
    primaryFeatureCount: Number(primaryMetrics.featureCount || 0),
    runtimeFeatureCount: Number(runtimeMaskMetrics?.featureCount || 0),
    primaryPolygonPartCount: Number(primaryMetrics.polygonPartCount || 0),
    runtimePolygonPartCount: Number(runtimeMaskMetrics?.polygonPartCount || 0),
    primaryInteriorRingCount: Number(primaryMetrics.interiorRingCount || 0),
    runtimeInteriorRingCount: Number(runtimeMaskMetrics?.interiorRingCount || 0),
    runtimeInteriorRingRatio: 0,
    areaDeltaRatio: 0,
    meshMode: "mask",
    topology: primaryTopology,
  };

  if (scenarioId && runtimeMaskMetrics?.objectName && primaryMetrics.featureCount > 0) {
    const areaBase = Math.max(1e-9, Number(primaryMetrics.totalArea) || 0);
    const areaDeltaRatio = Math.abs((Number(runtimeMaskMetrics.totalArea) || 0) - areaBase) / areaBase;
    const runtimeInteriorRingRatio =
      Number(runtimeMaskMetrics.interiorRingCount || 0) / Math.max(1, Number(runtimeMaskMetrics.polygonPartCount || 0));
    let accepted = true;
    let reason = "scenario_accepted";
    if (runtimeMaskMetrics.worldBounds) {
      accepted = false;
      reason = "runtime_world_bounds";
    } else if (areaDeltaRatio > SCENARIO_COASTLINE_MAX_AREA_DELTA_RATIO) {
      accepted = false;
      reason = "area_delta_exceeded";
    } else if (Number(runtimeMaskMetrics.interiorRingCount || 0) > SCENARIO_COASTLINE_MAX_INTERIOR_RING_COUNT) {
      accepted = false;
      reason = "interior_ring_count_exceeded";
    } else if (runtimeInteriorRingRatio > SCENARIO_COASTLINE_MAX_INTERIOR_RING_RATIO) {
      accepted = false;
      reason = "interior_ring_ratio_exceeded";
    }
    decision = {
      ...decision,
        source: accepted ? "scenario" : "primary",
        reason,
        runtimeInteriorRingRatio,
        areaDeltaRatio,
        meshMode: "mask",
        topology: accepted ? runtimeTopology : primaryTopology,
      };
    }

  if (scenarioId) {
    const logKey = `${scenarioId}::${decision.source}::${decision.reason}`;
    if (!scenarioCoastlineDecisionWarnings.has(logKey)) {
      scenarioCoastlineDecisionWarnings.add(logKey);
      console.info(
        `[map_renderer] Scenario coastline source ${decision.source}: scenario=${scenarioId} reason=${decision.reason} runtimeObject=${decision.runtimeObjectName || "(none)"} areaDelta=${(Number(decision.areaDeltaRatio) || 0).toFixed(5)} interiorRings=${Number(decision.runtimeInteriorRingCount || 0)} parts=${Number(decision.runtimePolygonPartCount || 0)}`
      );
    }
  }

  scenarioCoastlineSourceCache = {
    primaryRef: primaryTopology,
    runtimeRef: runtimeTopology,
    scenarioId,
    decision: publishScenarioCoastlineDecision(decision),
  };
  return scenarioCoastlineSourceCache.decision;
}

function buildGlobalCoastlineMesh(primaryTopology) {
  const topology = primaryTopology?.topology || primaryTopology;
  const meshMode = String(primaryTopology?.meshMode || "mask");
  if (!topology?.objects || !globalThis.topojson) return null;
  if (meshMode === "political_outline" && topology.objects.political) {
    return globalThis.topojson.mesh(
      topology,
      topology.objects.political,
      // TopoJSON reports exterior arcs as a===b for mesh callbacks.
      (a, b) => !!(a && b && a === b && !shouldExcludeOwnerBorderEntity(a, { excludeSea: true }))
    );
  }
  if (topology.objects.context_land_mask) {
    return globalThis.topojson.mesh(topology, topology.objects.context_land_mask);
  }
  if (topology.objects.land_mask) {
    return globalThis.topojson.mesh(topology, topology.objects.land_mask);
  }
  if (topology.objects.land) {
    return globalThis.topojson.mesh(topology, topology.objects.land);
  }
  if (topology.objects.political) {
    return globalThis.topojson.mesh(
      topology,
      topology.objects.political,
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

function getPolylineMeanAbsLatitude(line) {
  if (!Array.isArray(line) || !line.length) return 0;
  let total = 0;
  let count = 0;
  line.forEach((point) => {
    const lat = Number(point?.[1]);
    if (!Number.isFinite(lat)) return;
    total += Math.abs(lat);
    count += 1;
  });
  return count > 0 ? total / count : 0;
}

function getLatitudeAdjustedSimplifyEpsilon(baseEpsilon, line) {
  const epsilon = Math.max(0, Number(baseEpsilon) || 0);
  if (!(epsilon > 0)) return 0;
  const meanAbsLatitude = getPolylineMeanAbsLatitude(line);
  const cosLatitude = Math.cos((meanAbsLatitude * Math.PI) / 180);
  const safeCosLatitude = clamp(Math.abs(cosLatitude), COASTLINE_SIMPLIFY_MIN_COS_LAT, 1);
  const scale = clamp(1 / safeCosLatitude, 1, COASTLINE_SIMPLIFY_LATITUDE_SCALE_MAX);
  return epsilon * scale;
}

function getTriangleArea(points, aIndex, bIndex, cIndex) {
  const a = points[aIndex];
  const b = points[bIndex];
  const c = points[cIndex];
  if (!a || !b || !c) return Infinity;
  return Math.abs(
    (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1])) * 0.5
  );
}

function pushMinHeap(heap, entry) {
  heap.push(entry);
  let index = heap.length - 1;
  while (index > 0) {
    const parentIndex = Math.floor((index - 1) / 2);
    if (heap[parentIndex][0] <= heap[index][0]) break;
    [heap[parentIndex], heap[index]] = [heap[index], heap[parentIndex]];
    index = parentIndex;
  }
}

function popMinHeap(heap) {
  if (!heap.length) return null;
  const first = heap[0];
  const last = heap.pop();
  if (heap.length && last) {
    heap[0] = last;
    let index = 0;
    while (true) {
      const leftIndex = index * 2 + 1;
      const rightIndex = leftIndex + 1;
      let smallestIndex = index;
      if (leftIndex < heap.length && heap[leftIndex][0] < heap[smallestIndex][0]) {
        smallestIndex = leftIndex;
      }
      if (rightIndex < heap.length && heap[rightIndex][0] < heap[smallestIndex][0]) {
        smallestIndex = rightIndex;
      }
      if (smallestIndex === index) break;
      [heap[index], heap[smallestIndex]] = [heap[smallestIndex], heap[index]];
      index = smallestIndex;
    }
  }
  return first;
}

function simplifyPolylineEffectiveArea(points, areaThreshold) {
  if (!Array.isArray(points) || points.length <= 2) {
    return Array.isArray(points) ? points.slice() : [];
  }
  const threshold = Math.max(0, Number(areaThreshold) || 0);
  if (!(threshold > 0)) return points.slice();

  const length = points.length;
  const previous = new Array(length);
  const next = new Array(length);
  const removed = new Array(length).fill(false);
  const areas = new Array(length).fill(Infinity);
  const heap = [];

  for (let index = 0; index < length; index += 1) {
    previous[index] = index - 1;
    next[index] = index + 1 < length ? index + 1 : -1;
  }

  const updateArea = (index) => {
    if (index <= 0 || index >= length - 1 || removed[index]) return;
    const prevIndex = previous[index];
    const nextIndex = next[index];
    if (prevIndex < 0 || nextIndex < 0 || removed[prevIndex] || removed[nextIndex]) {
      areas[index] = Infinity;
      return;
    }
    const area = getTriangleArea(points, prevIndex, index, nextIndex);
    areas[index] = area;
    pushMinHeap(heap, [area, index]);
  };

  for (let index = 1; index < length - 1; index += 1) {
    updateArea(index);
  }

  while (heap.length) {
    const entry = popMinHeap(heap);
    if (!entry) break;
    const [area, index] = entry;
    if (removed[index] || area !== areas[index]) continue;
    if (area > threshold) break;
    const prevIndex = previous[index];
    const nextIndex = next[index];
    if (prevIndex < 0 || nextIndex < 0) continue;
    removed[index] = true;
    next[prevIndex] = nextIndex;
    previous[nextIndex] = prevIndex;
    updateArea(prevIndex);
    updateArea(nextIndex);
  }

  const simplified = [];
  for (let index = 0; index < length; index += 1) {
    if (!removed[index]) simplified.push(points[index]);
  }
  return simplified.length >= 2 ? simplified : points.slice(0, 2);
}

function simplifyCoastlineMesh(mesh, { epsilon = 0, minLength = 0 } = {}) {
  if (!isUsableMesh(mesh)) return null;
  const simplifiedCoordinates = [];

  mesh.coordinates.forEach((line) => {
    const sanitized = sanitizePolyline(line);
    if (sanitized.length < 2) return;
    const adjustedEpsilon = getLatitudeAdjustedSimplifyEpsilon(epsilon, sanitized);
    const effectiveAreaThreshold = adjustedEpsilon * adjustedEpsilon * COASTLINE_EFFECTIVE_AREA_MULTIPLIER;
    const simplified = simplifyPolylineEffectiveArea(sanitized, effectiveAreaThreshold);
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
  cancelDeferredHeavyBorderMeshes();
  resetVisibleInternalBorderMeshSignature();
  if (!globalThis.topojson) {
    staticMeshCache.snapshot = null;
    setStaticMeshSourceCountries();
    state.cachedCountryBorders = [];
    state.cachedProvinceBorders = [];
    state.cachedProvinceBordersByCountry = new Map();
    state.cachedLocalBorders = [];
    state.cachedLocalBordersByCountry = new Map();
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

  const sourceCountries = getSourceCountrySets();
  setStaticMeshSourceCountries(sourceCountries);
  const coastlineSourceDecision = resolveCoastlineTopologySource();
  const sourceCountriesSignature = getSourceCountriesSignature(sourceCountries);
  const coastlineDecisionSignature = getCoastlineDecisionSignature(coastlineSourceDecision);
  const primaryTopology = state.topologyPrimary || state.topology;
  const detailTopology = state.topologyDetail || null;
  const runtimeTopology = state.runtimePoliticalTopology || null;
  const cacheMatches =
    staticMeshCache.primaryRef === primaryTopology &&
    staticMeshCache.detailRef === detailTopology &&
    staticMeshCache.runtimeRef === runtimeTopology &&
    staticMeshCache.bundleMode === String(state.topologyBundleMode || "") &&
    staticMeshCache.activeScenarioId === String(state.activeScenarioId || "") &&
    staticMeshCache.scenarioBorderMode === String(state.scenarioBorderMode || "") &&
    staticMeshCache.scenarioViewMode === String(state.scenarioViewMode || "") &&
    staticMeshCache.sourceCountriesSignature === sourceCountriesSignature &&
    staticMeshCache.coastlineDecisionSignature === coastlineDecisionSignature &&
    staticMeshCache.snapshot;
  if (cacheMatches) {
    restoreStaticMeshSnapshot(staticMeshCache.snapshot);
    const currentZoom = Math.max(0.0001, Number(state.zoomTransform?.k || 1));
    if (currentZoom >= DETAIL_ADM_BORDERS_MIN_ZOOM) {
      const detailAdmMeta = buildDetailAdmMeshSignature(getVisibleCountryCodesForBorderMeshes(), currentZoom);
      detailAdmMeshBuildState = {
        signature: detailAdmMeta.signature,
        status: state.cachedDetailAdmBorders.length
          ? "ready"
          : (detailAdmMeta.detailCountries.length ? "idle" : "empty"),
      };
    } else {
      detailAdmMeshBuildState = {
        signature: "",
        status: "idle",
      };
    }
    if (typeof state.updateParentBorderCountryListFn === "function") {
      state.updateParentBorderCountryListFn();
    }
    recordRenderPerfMetric("rebuildStaticMeshes", nowMs() - startedAt, {
      hasTopojson: true,
      cacheHit: true,
      countryMeshes: state.cachedCountryBorders.length,
      provinceMeshes: state.cachedProvinceBorders.length,
      localMeshes: state.cachedLocalBorders.length,
      coastlineMeshes: state.cachedCoastlines.length,
      coastlineSource: String(coastlineSourceDecision?.source || "primary"),
      coastlineReason: String(coastlineSourceDecision?.reason || ""),
    });
    return;
  }

  state.cachedCountryBorders = [];
  state.cachedProvinceBorders = [];
  state.cachedProvinceBordersByCountry = new Map();
  state.cachedLocalBorders = [];
  state.cachedLocalBordersByCountry = new Map();
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
  refreshParentBorderSupport();

  if (Math.max(0.0001, Number(state.zoomTransform?.k || 1)) >= DETAIL_ADM_BORDERS_MIN_ZOOM) {
    const visibleCountryCodes = getVisibleCountryCodesForBorderMeshes();
    const detailCountries = new Set(
      [...(sourceCountries.detail || new Set())].filter((countryCode) => visibleCountryCodes.has(countryCode))
    );
    const detailAdmMesh = buildDetailAdmBorderMesh(state.topologyDetail, detailCountries);
    if (isUsableMesh(detailAdmMesh)) {
      state.cachedDetailAdmBorders.push(detailAdmMesh);
      detailAdmMeshBuildState = {
        signature: buildDetailAdmMeshSignature(visibleCountryCodes, state.zoomTransform?.k || 1).signature,
        status: "ready",
      };
    } else {
      detailAdmMeshBuildState = {
        signature: buildDetailAdmMeshSignature(visibleCountryCodes, state.zoomTransform?.k || 1).signature,
        status: detailCountries.size ? "empty" : "empty",
      };
    }
  } else {
    detailAdmMeshBuildState = {
      signature: "",
      status: "idle",
    };
  }

  const unifiedBorderTopology =
    state.topologyBundleMode === "composite" && runtimeTopology?.objects?.political
      ? runtimeTopology
      : primaryTopology;
  const countryMesh = buildGlobalCountryBorderMesh(unifiedBorderTopology);
  if (isUsableMesh(countryMesh)) {
    state.cachedCountryBorders.push(countryMesh);
  }

  const coastlineMesh = buildGlobalCoastlineMesh(coastlineSourceDecision || primaryTopology);
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
  staticMeshCache = {
    primaryRef: primaryTopology,
    detailRef: detailTopology,
    runtimeRef: runtimeTopology,
    bundleMode: String(state.topologyBundleMode || ""),
    activeScenarioId: String(state.activeScenarioId || ""),
    scenarioBorderMode: String(state.scenarioBorderMode || ""),
    scenarioViewMode: String(state.scenarioViewMode || ""),
    sourceCountriesSignature,
    coastlineDecisionSignature,
    snapshot: captureStaticMeshSnapshot(),
  };
  recordRenderPerfMetric("rebuildStaticMeshes", nowMs() - startedAt, {
    hasTopojson: true,
    cacheHit: false,
    countryMeshes: state.cachedCountryBorders.length,
    provinceMeshes: state.cachedProvinceBorders.length,
    localMeshes: state.cachedLocalBorders.length,
    coastlineMeshes: state.cachedCoastlines.length,
    coastlineSource: String(coastlineSourceDecision?.source || "primary"),
    coastlineReason: String(coastlineSourceDecision?.reason || ""),
  });
  scheduleDeferredHeavyBorderMeshes();
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
    state.hitCanvasTopologyRevision = 0;
    return false;
  }

  const width = hitCanvas?.width || 0;
  const height = hitCanvas?.height || 0;
  if (width <= 0 || height <= 0) {
    state.hitCanvasDirty = false;
    state.hitCanvasTopologyRevision = 0;
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

  const visibleSpatialItems = collectVisibleLandSpatialItems();
  if (visibleSpatialItems) {
    visibleSpatialItems.forEach((item) => {
      const key = state.idToKey.get(item.id);
      if (!key || !item?.feature) return;
      hitContext.beginPath();
      pathHitCanvas(item.feature);
      hitContext.fillStyle = keyToHitColor(key);
      hitContext.fill();
    });
  } else {
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
  }

  hitContext.restore();
  state.hitCanvasDirty = false;
  state.hitCanvasTopologyRevision = Number(state.topologyRevision || 0);
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

function isHitCanvasCurrent() {
  return (
    !state.hitCanvasDirty
    && Number(state.hitCanvasTopologyRevision || 0) === Number(state.topologyRevision || 0)
  );
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
  if (
    state.renderPhase !== RENDER_PHASE_IDLE
    || (!isHitCanvasCurrent() && !ensureHitCanvasUpToDate({ force: !!forceBuild }))
    || !isHitCanvasCurrent()
  ) {
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

function getProjectedViewportBounds({
  overscanPx = Math.max(
    VIEWPORT_CULL_OVERSCAN_PX,
    Math.min(state.width || 0, state.height || 0) * 0.08
  ),
} = {}) {
  const width = Number(state.width) || 0;
  const height = Number(state.height) || 0;
  const t = state.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
  const k = Math.max(0.0001, Number(t.k) || 1);
  if (width <= 0 || height <= 0) return null;
  const minX = (-Number(t.x || 0) - overscanPx) / k;
  const minY = (-Number(t.y || 0) - overscanPx) / k;
  const maxX = (width - Number(t.x || 0) + overscanPx) / k;
  const maxY = (height - Number(t.y || 0) + overscanPx) / k;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) return null;
  return {
    minX: Math.min(minX, maxX),
    minY: Math.min(minY, maxY),
    maxX: Math.max(minX, maxX),
    maxY: Math.max(minY, maxY),
  };
}

function doesSpatialItemIntersectProjectedViewport(item, viewportBounds) {
  if (!item || !viewportBounds) return false;
  return !(
    item.maxX < viewportBounds.minX ||
    item.maxY < viewportBounds.minY ||
    item.minX > viewportBounds.maxX ||
    item.minY > viewportBounds.maxY
  );
}

function collectVisibleLandSpatialItems() {
  const meta = state.spatialGridMeta;
  const grid = state.spatialGrid;
  if (!meta || !grid || !Array.isArray(state.spatialItems)) return null;
  const { cellSize, cols, rows, globals } = meta;
  if (!cellSize || cols <= 0 || rows <= 0) return null;
  const viewportBounds = getProjectedViewportBounds();
  if (!viewportBounds) return null;
  const c0 = clamp(Math.floor(viewportBounds.minX / cellSize), 0, cols - 1);
  const c1 = clamp(Math.floor(viewportBounds.maxX / cellSize), 0, cols - 1);
  const r0 = clamp(Math.floor(viewportBounds.minY / cellSize), 0, rows - 1);
  const r1 = clamp(Math.floor(viewportBounds.maxY / cellSize), 0, rows - 1);
  const visibleItems = [];
  const seen = new Set();
  const maybePush = (item) => {
    if (!item?.id || seen.has(item.id)) return;
    seen.add(item.id);
    if (!doesSpatialItemIntersectProjectedViewport(item, viewportBounds)) return;
    visibleItems.push(item);
  };
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const bucket = grid.get(getSpatialBucketKey(col, row));
      bucket?.forEach(maybePush);
    }
  }
  globals?.forEach(maybePush);
  visibleItems.sort((left, right) => (left?.drawOrder ?? 0) - (right?.drawOrder ?? 0));
  return visibleItems;
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
    const hitGeometry = candidate.item?.hitGeometry || feature;
    let containsGeo = false;
    if (hitGeometry && lonLat && globalThis.d3?.geoContains) {
      try {
        containsGeo = !!globalThis.d3.geoContains(hitGeometry, lonLat);
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
  const resolvedId = String(candidate?.item?.featureId || candidate?.item?.id || "").trim();
  if (!resolvedId) return createHitResult();
  return createHitResult({
    id: resolvedId,
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

function shouldPreferWaterHit(landHit, waterHit, { eventType = "unknown" } = {}) {
  if (!waterHit?.id) return false;
  if (eventType === "hover" && isMacroOceanWaterRegion(waterHit.feature)) {
    return false;
  }
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
  { enableSnap = true, snapPx = HIT_SNAP_RADIUS_PX, eventType = "unknown" } = {}
) {
  if (!state.showWaterRegions) return createHitResult();
  if (!state.waterSpatialItems?.length) {
    if (state.waterRegionsById?.size) {
      scheduleSecondarySpatialIndexBuild({
        reason: "water-hit-demand",
      });
    }
    return createHitResult();
  }

  const strictCandidates = collectWaterGridCandidates(pointer.px, pointer.py, 0);
  const strictRanked = rankCandidates(strictCandidates, pointer.lonLat);
  const strictHit = strictRanked.find((candidate) => candidate.containsGeo);
  if (strictHit) {
    if (eventType === "hover" && isMacroOceanWaterRegion(strictHit.item?.feature)) {
      return createHitResult();
    }
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
  if (eventType === "hover" && isMacroOceanWaterRegion(chosen.item?.feature)) {
    return createHitResult();
  }
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
  if (!state.showScenarioSpecialRegions) return createHitResult();
  if (!state.specialSpatialItems?.length) {
    if (state.specialRegionsById?.size) {
      scheduleSecondarySpatialIndexBuild({
        reason: "special-hit-demand",
      });
    }
    return createHitResult();
  }

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

function cancelPendingIndexUiRefresh() {
  if (deferredIndexUiRefreshHandle !== null && deferredIndexUiRefreshHandle !== undefined) {
    if (typeof globalThis.cancelAnimationFrame === "function") {
      globalThis.cancelAnimationFrame(deferredIndexUiRefreshHandle);
    } else {
      globalThis.clearTimeout(deferredIndexUiRefreshHandle);
    }
    deferredIndexUiRefreshHandle = null;
  }
  deferredIndexUiRefreshState = null;
  if (pendingIndexUiRefreshHandle === null || pendingIndexUiRefreshHandle === undefined) {
    pendingIndexUiRefreshState = null;
    return;
  }
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(pendingIndexUiRefreshHandle);
  } else {
    globalThis.clearTimeout(pendingIndexUiRefreshHandle);
  }
  pendingIndexUiRefreshHandle = null;
  pendingIndexUiRefreshState = null;
}

function flushPendingIndexUiRefresh() {
  const pending = pendingIndexUiRefreshState;
  pendingIndexUiRefreshHandle = null;
  pendingIndexUiRefreshState = null;
  if (!pending) return;
  if (pending.renderCountryList && typeof state.renderCountryListFn === "function") {
    state.renderCountryListFn();
  }
  if (pending.renderWaterRegionList && typeof state.renderWaterRegionListFn === "function") {
    state.renderWaterRegionListFn();
  }
  if (pending.renderSpecialRegionList && typeof state.renderSpecialRegionListFn === "function") {
    state.renderSpecialRegionListFn();
  }
}

function scheduleIndexUiRefresh({
  renderCountryList = false,
  renderWaterRegionList = false,
  renderSpecialRegionList = false,
} = {}) {
  pendingIndexUiRefreshState = {
    renderCountryList: !!(pendingIndexUiRefreshState?.renderCountryList || renderCountryList),
    renderWaterRegionList: !!(pendingIndexUiRefreshState?.renderWaterRegionList || renderWaterRegionList),
    renderSpecialRegionList: !!(pendingIndexUiRefreshState?.renderSpecialRegionList || renderSpecialRegionList),
  };
  if (pendingIndexUiRefreshHandle !== null && pendingIndexUiRefreshHandle !== undefined) {
    return;
  }
  const callback = () => {
    flushPendingIndexUiRefresh();
  };
  pendingIndexUiRefreshHandle = typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame(callback)
    : globalThis.setTimeout(callback, 0);
}

function flushDeferredIndexUiRefresh() {
  const pending = deferredIndexUiRefreshState;
  deferredIndexUiRefreshHandle = null;
  deferredIndexUiRefreshState = null;
  if (!pending) return;
  scheduleIndexUiRefresh(pending);
}

function scheduleIndexUiRefreshAfterCoarseFrame({
  renderCountryList = false,
  renderWaterRegionList = false,
  renderSpecialRegionList = false,
} = {}) {
  deferredIndexUiRefreshState = {
    renderCountryList: !!(deferredIndexUiRefreshState?.renderCountryList || renderCountryList),
    renderWaterRegionList: !!(deferredIndexUiRefreshState?.renderWaterRegionList || renderWaterRegionList),
    renderSpecialRegionList: !!(deferredIndexUiRefreshState?.renderSpecialRegionList || renderSpecialRegionList),
  };
  if (deferredIndexUiRefreshHandle !== null && deferredIndexUiRefreshHandle !== undefined) {
    return;
  }
  const callback = () => {
    flushDeferredIndexUiRefresh();
  };
  deferredIndexUiRefreshHandle = typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame(callback)
    : globalThis.setTimeout(callback, 0);
}

function queueIndexUiRefresh(
  refreshOptions,
  scheduleUiMode = "immediate",
) {
  if (scheduleUiMode === "none") {
    return;
  }
  if (scheduleUiMode === "deferred") {
    scheduleIndexUiRefreshAfterCoarseFrame(refreshOptions);
    return;
  }
  scheduleIndexUiRefresh(refreshOptions);
}

function normalizeSidebarRefreshIds(values) {
  return Array.isArray(values)
    ? values.map((value) => String(value || "").trim()).filter(Boolean)
    : [];
}

function normalizeSidebarRefreshOwnerCodes(values) {
  return Array.isArray(values)
    ? values.map((value) => canonicalCountryCode(value)).filter(Boolean)
    : [];
}

function cancelPendingSidebarRefresh() {
  if (pendingSidebarRefreshHandle === null || pendingSidebarRefreshHandle === undefined) {
    pendingSidebarRefreshState = null;
    return;
  }
  if (typeof globalThis.cancelAnimationFrame === "function") {
    globalThis.cancelAnimationFrame(pendingSidebarRefreshHandle);
  } else {
    globalThis.clearTimeout(pendingSidebarRefreshHandle);
  }
  pendingSidebarRefreshHandle = null;
  pendingSidebarRefreshState = null;
}

function flushPendingSidebarRefresh() {
  const pending = pendingSidebarRefreshState;
  pendingSidebarRefreshHandle = null;
  pendingSidebarRefreshState = null;
  if (!pending) return;
  const countryCodes = Array.from(
    new Set([
      ...collectCountryCodesForFeatureIds(pending.featureIds),
      ...pending.ownerCodes,
    ])
  );
  if (typeof state.renderWaterRegionListFn === "function" && pending.waterRegionIds.length > 0) {
    state.renderWaterRegionListFn();
  }
  if (typeof state.renderSpecialRegionListFn === "function" && pending.specialRegionIds.length > 0) {
    state.renderSpecialRegionListFn();
  }
  if (typeof state.refreshCountryListRowsFn === "function") {
    state.refreshCountryListRowsFn({
      countryCodes,
      refreshInspector: true,
      refreshPresetTree: pending.refreshPresetTree,
    });
    return;
  }
  if (typeof state.renderCountryListFn === "function" && (countryCodes.length > 0 || pending.refreshPresetTree)) {
    state.renderCountryListFn();
  }
  if (pending.refreshPresetTree && typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
}

function scheduleSidebarRefresh({
  featureIds = [],
  waterRegionIds = [],
  specialRegionIds = [],
  ownerCodes = [],
  refreshPresetTree = false,
} = {}) {
  pendingSidebarRefreshState = {
    featureIds: Array.from(new Set([
      ...(pendingSidebarRefreshState?.featureIds || []),
      ...normalizeSidebarRefreshIds(featureIds),
    ])),
    waterRegionIds: Array.from(new Set([
      ...(pendingSidebarRefreshState?.waterRegionIds || []),
      ...normalizeSidebarRefreshIds(waterRegionIds),
    ])),
    specialRegionIds: Array.from(new Set([
      ...(pendingSidebarRefreshState?.specialRegionIds || []),
      ...normalizeSidebarRefreshIds(specialRegionIds),
    ])),
    ownerCodes: Array.from(new Set([
      ...(pendingSidebarRefreshState?.ownerCodes || []),
      ...normalizeSidebarRefreshOwnerCodes(ownerCodes),
    ])),
    refreshPresetTree: !!(pendingSidebarRefreshState?.refreshPresetTree || refreshPresetTree),
  };
  if (pendingSidebarRefreshHandle !== null && pendingSidebarRefreshHandle !== undefined) {
    return;
  }
  const callback = () => {
    flushPendingSidebarRefresh();
  };
  pendingSidebarRefreshHandle = typeof globalThis.requestAnimationFrame === "function"
    ? globalThis.requestAnimationFrame(callback)
    : globalThis.setTimeout(callback, 0);
}

function setInteractionInfrastructureState(
  stage,
  {
    ready = null,
    inFlight = null,
  } = {}
) {
  state.interactionInfrastructureStage = String(stage || "idle").trim() || "idle";
  if (ready != null) {
    state.interactionInfrastructureReady = !!ready;
  }
  if (inFlight != null) {
    state.interactionInfrastructureBuildInFlight = !!inFlight;
  }
}

async function yieldToMain() {
  if (typeof globalThis.scheduler?.yield === "function") {
    await globalThis.scheduler.yield();
    return;
  }
  await new Promise((resolve) => {
    globalThis.setTimeout(resolve, 0);
  });
}

function rebuildAuxiliaryRegionIndexes() {
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
}

function finalizeIndexBuildEffects() {
  state.devSelectionOverlayDirty = true;
  notifyDevWorkspace();
  state.hitCanvasDirty = true;
}

function buildIndex({ scheduleUiMode = "immediate" } = {}) {
  state.landIndex.clear();
  state.countryToFeatureIds.clear();
  state.idToKey.clear();
  state.keyToId.clear();
  rebuildAuxiliaryRegionIndexes();

  if (!state.landData || !state.landData.features) {
    queueIndexUiRefresh({
      renderWaterRegionList: true,
      renderSpecialRegionList: true,
    }, scheduleUiMode);
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

  queueIndexUiRefresh({
    renderCountryList: true,
    renderWaterRegionList: true,
    renderSpecialRegionList: true,
  }, scheduleUiMode);
  finalizeIndexBuildEffects();
}

function adoptRuntimePoliticalMeta(payload) {
  const featureIds = Array.isArray(payload?.featureIds) ? payload.featureIds : [];
  const featureIndexById = payload?.featureIndexById && typeof payload.featureIndexById === "object"
    ? payload.featureIndexById
    : {};
  const canonicalCountryByFeatureId =
    payload?.canonicalCountryByFeatureId && typeof payload.canonicalCountryByFeatureId === "object"
      ? payload.canonicalCountryByFeatureId
      : {};
  const neighborGraph = Array.isArray(payload?.neighborGraph) ? payload.neighborGraph : [];
  state.runtimeFeatureIndexById = new Map(Object.entries(featureIndexById));
  state.runtimeFeatureIds = featureIds.slice();
  state.runtimeNeighborGraph = neighborGraph.slice();
  state.runtimeCanonicalCountryByFeatureId = { ...canonicalCountryByFeatureId };
}

function buildRuntimePoliticalMetaFallback() {
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

function buildRuntimePoliticalMeta() {
  const seed = state.runtimePoliticalMetaSeed;
  const geometries = state.runtimePoliticalTopology?.objects?.political?.geometries || [];
  const seedMatches = Array.isArray(seed?.featureIds) && seed.featureIds.length === geometries.length;
  if (seedMatches) {
    adoptRuntimePoliticalMeta(seed);
    state.runtimePoliticalMetaReadyFromWorker = true;
    state.runtimePoliticalMetaSeed = null;
    return;
  }
  buildRuntimePoliticalMetaFallback();
  state.runtimePoliticalMetaReadyFromWorker = false;
  state.runtimePoliticalMetaSeed = null;
}

function resetSecondarySpatialIndexState() {
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
}

function buildSecondarySpatialIndexes({
  allowComputeMissingBounds = true,
} = {}) {
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
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
    const hitGeometries = collectFeatureHitGeometries(feature);
    hitGeometries.forEach((hitGeometry, partIndex) => {
      const bounds = computeProjectedGeoBounds(hitGeometry);
      if (!bounds) return;
      state.waterSpatialItems.push({
        id: `${id}::part:${partIndex}`,
        featureId: id,
        feature,
        hitGeometry,
        countryCode: "",
        source: String(feature?.properties?.__source || "primary"),
        minX: bounds.minX,
        minY: bounds.minY,
        maxX: bounds.maxX,
        maxY: bounds.maxY,
        bboxArea: bounds.area,
      });
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
    const bounds = getProjectedFeatureBounds(feature, { featureId: id, allowCompute: allowComputeMissingBounds });
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
}

function scheduleSecondarySpatialIndexBuild({
  timeout = 48,
  reason = "deferred-secondary-spatial",
} = {}) {
  cancelDeferredWork(secondarySpatialBuildHandle);
  secondarySpatialBuildHandle = scheduleDeferredWork(() => {
    secondarySpatialBuildHandle = null;
    if (state.renderPhase !== RENDER_PHASE_IDLE || state.deferExactAfterSettle) {
      scheduleSecondarySpatialIndexBuild({ timeout, reason });
      return;
    }
    const startedAt = nowMs();
    resetSecondarySpatialIndexState();
    buildSecondarySpatialIndexes({
      allowComputeMissingBounds: true,
    });
    state.hitCanvasDirty = true;
    recordRenderPerfMetric("buildSecondarySpatialIndex", nowMs() - startedAt, {
      reason,
      waterItems: state.waterSpatialItems.length,
      specialItems: state.specialSpatialItems.length,
    });
  }, { timeout });
}

function rebuildRuntimeDerivedState({
  includeRuntimePoliticalMeta = false,
  scheduleUiMode = "immediate",
  buildSpatial = true,
  includeSecondarySpatial = true,
} = {}) {
  if (includeRuntimePoliticalMeta) {
    buildRuntimePoliticalMeta();
  }

  state.landIndex.clear();
  state.countryToFeatureIds.clear();
  state.idToKey.clear();
  state.keyToId.clear();
  rebuildAuxiliaryRegionIndexes();

  ensureSovereigntyState();
  migrateLegacyColorState();
  state.sovereignBaseColors = sanitizeCountryColorMap(state.sovereignBaseColors);
  state.visualOverrides = sanitizeColorMap(state.visualOverrides);
  state.waterRegionOverrides = sanitizeColorMap(state.waterRegionOverrides);
  state.specialRegionOverrides = sanitizeColorMap(state.specialRegionOverrides);
  state.countryBaseColors = { ...state.sovereignBaseColors };
  state.featureOverrides = { ...state.visualOverrides };

  clearProjectedBoundsCache();
  const projectedBoundsCache = ensureProjectedBoundsCache();
  const nextColors = {};
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();

  if (state.landData?.features?.length) {
    state.landData.features.forEach((feature, index) => {
      const id = getFeatureId(feature) || `feature-${index}`;
      if (!id) return;
      state.landIndex.set(id, feature);
      if (!shouldExcludePoliticalInteractionFeature(feature, id)) {
        const countryCode = getFeatureCountryCodeNormalized(feature);
        if (countryCode) {
          const ids = state.countryToFeatureIds.get(countryCode) || [];
          ids.push(id);
          state.countryToFeatureIds.set(countryCode, ids);
        }
        const key = index + 1;
        state.idToKey.set(id, key);
        state.keyToId.set(key, id);
      }
      const bounds = computeProjectedFeatureBounds(feature);
      if (bounds) {
        projectedBoundsCache.set(id, bounds);
      }
      if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) {
        return;
      }
      const resolvedColor = getResolvedFeatureColor(feature, id);
      if (resolvedColor) {
        nextColors[id] = resolvedColor;
      }
    });
  }

  if (state.riversData?.features?.length) {
    state.riversData.features.forEach((feature) => {
      const featureId = getFeatureId(feature);
      if (!featureId) return;
      const bounds = computeProjectedFeatureBounds(feature);
      if (!bounds) return;
      projectedBoundsCache.set(featureId, bounds);
    });
  }

  state.colors = nextColors;
  state.colorRevision = Number(state.colorRevision || 0) + 1;
  invalidateRenderPasses(["physicalBase", "political", "contextBase"], "rebuild-colors");
  queueIndexUiRefresh({
    renderCountryList: true,
    renderWaterRegionList: true,
    renderSpecialRegionList: true,
  }, scheduleUiMode);
  finalizeIndexBuildEffects();

  if (buildSpatial) {
    buildSpatialIndex({
      includeSecondary: includeSecondarySpatial,
      allowComputeMissingBounds: false,
    });
  }
  return nextColors;
}

function buildSpatialIndex({
  includeSecondary = true,
  allowComputeMissingBounds = true,
} = {}) {
  const startedAt = nowMs();
  state.spatialItems = [];
  state.spatialIndex = null;
  state.spatialGrid = new Map();
  state.spatialGridMeta = null;
  state.spatialItemsById = new Map();
  resetSecondarySpatialIndexState();
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

  for (const [drawOrder, feature] of state.landData.features.entries()) {
    const id = getFeatureId(feature);
    if (!id) continue;
    if (shouldExcludePoliticalInteractionFeature(feature, id)) continue;
    if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) continue;
    const bounds = getProjectedFeatureBounds(feature, { featureId: id, allowCompute: allowComputeMissingBounds });
    if (!bounds) continue;

    state.spatialItems.push({
      id,
      drawOrder,
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
  if (includeSecondary) {
    buildSecondarySpatialIndexes({
      allowComputeMissingBounds,
    });
  }
  state.hitCanvasDirty = true;
  recordRenderPerfMetric("buildSpatialIndex", nowMs() - startedAt, {
    landCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
    spatialItems: state.spatialItems.length,
    waterItems: state.waterSpatialItems.length,
    specialItems: state.specialSpatialItems.length,
    skipped: false,
  });
}

async function buildIndexChunked({ scheduleUiMode = "immediate" } = {}) {
  setInteractionInfrastructureState("building-index", {
    ready: false,
    inFlight: true,
  });
  await yieldToMain();
  buildIndex({ scheduleUiMode });
  await yieldToMain();
}

async function buildSpatialIndexChunked({
  includeSecondary = true,
  allowComputeMissingBounds = true,
} = {}) {
  setInteractionInfrastructureState("building-spatial", {
    ready: false,
    inFlight: true,
  });
  await yieldToMain();
  buildSpatialIndex({
    includeSecondary,
    allowComputeMissingBounds,
  });
  await yieldToMain();
}

async function buildHitCanvasAfterStartup() {
  setInteractionInfrastructureState("building-hit-canvas", {
    ready: false,
    inFlight: true,
  });
  await yieldToMain();
  ensureHitCanvasUpToDate({ force: true });
  await yieldToMain();
}

async function buildInteractionInfrastructureAfterStartup({
  chunked = true,
  buildHitCanvas = true,
} = {}) {
  if (state.interactionInfrastructureReady && !state.interactionInfrastructureBuildInFlight) {
    return true;
  }
  if (interactionInfrastructurePromise) {
    return interactionInfrastructurePromise;
  }
  interactionInfrastructurePromise = (async () => {
    setInteractionInfrastructureState("deferred-startup", {
      ready: false,
      inFlight: true,
    });
    try {
      state.deferHitCanvasBuild = false;
      if (chunked) {
        await buildIndexChunked({ scheduleUiMode: "deferred" });
      } else {
        buildIndex({ scheduleUiMode: "deferred" });
      }
      ensureSovereigntyState({ force: true });
      rebuildResolvedColors();
      if (chunked) {
        await buildSpatialIndexChunked({
          includeSecondary: false,
        });
      } else {
        buildSpatialIndex({
          includeSecondary: false,
        });
      }
      scheduleSecondarySpatialIndexBuild({
        reason: chunked ? "startup-deferred-secondary-spatial" : "startup-secondary-spatial",
      });
      if (buildHitCanvas) {
        if (chunked) {
          await buildHitCanvasAfterStartup();
        } else {
          ensureHitCanvasUpToDate({ force: true });
        }
      } else if (state.hitCanvasDirty) {
        scheduleHitCanvasBuildIfNeeded({
          reason: chunked ? "startup-deferred-hit-canvas" : "startup-hit-canvas",
        });
      }
      setInteractionInfrastructureState("ready", {
        ready: true,
        inFlight: false,
      });
      return true;
    } catch (error) {
      setInteractionInfrastructureState("error", {
        ready: false,
        inFlight: false,
      });
      throw error;
    } finally {
      interactionInfrastructurePromise = null;
    }
  })();
  return interactionInfrastructurePromise;
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
    eventType,
  });
  if (waterHit.id && isScenarioWaterRegion(waterHit.feature) && eventType !== "hover") {
    return waterHit;
  }
  if (shouldPreferWaterHit(landHit, waterHit, { eventType })) {
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

function drawMeshCollection(meshCollection, strokeStyle, lineWidth, options = {}) {
  if (!meshCollection || !meshCollection.length) return;
  context.strokeStyle = strokeStyle;
  context.lineWidth = lineWidth;
  context.lineJoin = options.lineJoin || BOUNDARY_DEFAULT_LINE_JOIN;
  context.lineCap = options.lineCap || BOUNDARY_DEFAULT_LINE_CAP;
  context.miterLimit = Number.isFinite(Number(options.miterLimit))
    ? Number(options.miterLimit)
    : BOUNDARY_DEFAULT_MITER_LIMIT;
  const meshTransform = typeof options.transformMesh === "function" ? options.transformMesh : null;
  meshCollection.forEach((mesh) => {
    if (!mesh) return;
    const renderMesh = meshTransform ? meshTransform(mesh) : mesh;
    if (!isUsableMesh(renderMesh)) return;
    context.beginPath();
    pathCanvas(renderMesh);
    context.stroke();
  });
}

function getScreenSpaceTurnAngleDeg(previousPoint, currentPoint, nextPoint) {
  if (!previousPoint || !currentPoint || !nextPoint) return 180;
  const ax = currentPoint[0] - previousPoint[0];
  const ay = currentPoint[1] - previousPoint[1];
  const bx = nextPoint[0] - currentPoint[0];
  const by = nextPoint[1] - currentPoint[1];
  const aLength = Math.hypot(ax, ay);
  const bLength = Math.hypot(bx, by);
  if (!(aLength > 0) || !(bLength > 0)) return 180;
  const cosine = clamp((ax * bx + ay * by) / (aLength * bLength), -1, 1);
  const interiorAngleDeg = Math.acos(cosine) * (180 / Math.PI);
  return Math.abs(180 - interiorAngleDeg);
}

function declutterProjectedPolyline(line, minDistancePx, angleThresholdDeg) {
  const sanitized = sanitizePolyline(line);
  if (sanitized.length <= 2 || !projection) return sanitized;

  const projected = sanitized.map((point) => projection(point));
  const keptIndices = [0];

  for (let index = 1; index < sanitized.length - 1; index += 1) {
    const projectedPoint = projected[index];
    const previousKeptProjected = projected[keptIndices[keptIndices.length - 1]];
    const nextProjected = projected[index + 1];
    if (!projectedPoint || !previousKeptProjected || !nextProjected) {
      keptIndices.push(index);
      continue;
    }
    const distancePx = Math.hypot(
      projectedPoint[0] - previousKeptProjected[0],
      projectedPoint[1] - previousKeptProjected[1],
    );
    const turnAngleDeg = getScreenSpaceTurnAngleDeg(previousKeptProjected, projectedPoint, nextProjected);
    if (distancePx < minDistancePx && turnAngleDeg < angleThresholdDeg) {
      continue;
    }
    keptIndices.push(index);
  }

  keptIndices.push(sanitized.length - 1);
  const result = [];
  keptIndices.forEach((index) => {
    const point = sanitized[index];
    if (!point) return;
    const previousPoint = result[result.length - 1];
    if (previousPoint && previousPoint[0] === point[0] && previousPoint[1] === point[1]) return;
    result.push(point);
  });
  return result.length >= 2 ? result : sanitized.slice(0, 2);
}

function getProjectedPolylineMetrics(line) {
  const sanitized = sanitizePolyline(line);
  if (sanitized.length < 2 || !projection) {
    return {
      lengthPx: 0,
      bboxAreaPx: 0,
      maxSpanPx: 0,
    };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let lengthPx = 0;
  let previousProjected = null;
  sanitized.forEach((point) => {
    const projected = projection(point);
    if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return;
    minX = Math.min(minX, projected[0]);
    minY = Math.min(minY, projected[1]);
    maxX = Math.max(maxX, projected[0]);
    maxY = Math.max(maxY, projected[1]);
    if (previousProjected) {
      lengthPx += Math.hypot(projected[0] - previousProjected[0], projected[1] - previousProjected[1]);
    }
    previousProjected = projected;
  });
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
    return {
      lengthPx,
      bboxAreaPx: 0,
      maxSpanPx: 0,
    };
  }
  const widthPx = Math.max(0, maxX - minX);
  const heightPx = Math.max(0, maxY - minY);
  return {
    lengthPx,
    bboxAreaPx: widthPx * heightPx,
    maxSpanPx: Math.max(widthPx, heightPx),
  };
}

function buildRenderableBoundaryMesh(mesh, {
  simplifyDistancePx = 0,
  minLengthPx = 0,
  minSpanPx = 0,
  minAreaPx = 0,
  angleThresholdDeg = COASTLINE_VIEW_SIMPLIFY_COLLINEAR_ANGLE_DEG,
} = {}) {
  if (!isUsableMesh(mesh)) return null;
  const nextCoordinates = mesh.coordinates
    .map((line) => {
      const simplified = simplifyDistancePx > 0
        ? declutterProjectedPolyline(line, simplifyDistancePx, angleThresholdDeg)
        : sanitizePolyline(line);
      if (!Array.isArray(simplified) || simplified.length < 2) return null;
      const metrics = getProjectedPolylineMetrics(simplified);
      if (minLengthPx > 0 && metrics.lengthPx < minLengthPx) return null;
      if (minSpanPx > 0 && metrics.maxSpanPx < minSpanPx) return null;
      if (minAreaPx > 0 && metrics.bboxAreaPx < minAreaPx) return null;
      return simplified;
    })
    .filter((line) => Array.isArray(line) && line.length >= 2);
  if (!nextCoordinates.length) return null;
  return {
    type: "MultiLineString",
    coordinates: nextCoordinates,
  };
}

function getViewportAwareCoastlineCollection(collection, k) {
  const minDistancePx = k < COASTLINE_LOD_LOW_ZOOM_MAX
    ? COASTLINE_VIEW_SIMPLIFY_LOW_MIN_DISTANCE_PX
    : k < COASTLINE_LOD_MID_ZOOM_MAX
      ? COASTLINE_VIEW_SIMPLIFY_MID_MIN_DISTANCE_PX
      : 0;
  if (!(minDistancePx > 0) || !Array.isArray(collection) || !collection.length || !projection) {
    return collection;
  }
  return collection.map((mesh) => {
    if (!isUsableMesh(mesh)) return mesh;
    const nextCoordinates = mesh.coordinates
      .map((line) => declutterProjectedPolyline(line, minDistancePx, COASTLINE_VIEW_SIMPLIFY_COLLINEAR_ANGLE_DEG))
      .filter((line) => Array.isArray(line) && line.length >= 2);
    if (!nextCoordinates.length) return mesh;
    return {
      type: "MultiLineString",
      coordinates: nextCoordinates,
    };
  });
}

function getBoundaryMeshTransform(kind, k) {
  const zoom = Math.max(0, Number(k) || 0);
  if (kind === "internal-local") {
    if (zoom < 1.5) {
      return (mesh) => buildRenderableBoundaryMesh(mesh, {
        simplifyDistancePx: 3.6,
        minLengthPx: 22,
        minSpanPx: 5,
        minAreaPx: 20,
      });
    }
    if (zoom < 2.4) {
      return (mesh) => buildRenderableBoundaryMesh(mesh, {
        simplifyDistancePx: 2.2,
        minLengthPx: 14,
        minSpanPx: 3,
        minAreaPx: 10,
      });
    }
    return (mesh) => buildRenderableBoundaryMesh(mesh, {
      simplifyDistancePx: 0.75,
      minLengthPx: 4,
    });
  }
  if (kind === "internal-province") {
    if (zoom < 1.25) {
      return (mesh) => buildRenderableBoundaryMesh(mesh, {
        simplifyDistancePx: 2.4,
        minLengthPx: 16,
        minSpanPx: 4,
        minAreaPx: 12,
      });
    }
    if (zoom < 1.9) {
      return (mesh) => buildRenderableBoundaryMesh(mesh, {
        simplifyDistancePx: 1.6,
        minLengthPx: 10,
        minSpanPx: 2,
      });
    }
    return (mesh) => buildRenderableBoundaryMesh(mesh, {
      simplifyDistancePx: 0.6,
      minLengthPx: 4,
    });
  }
  if (kind === "empire") {
    if (zoom < 1.4) {
      return (mesh) => buildRenderableBoundaryMesh(mesh, {
        simplifyDistancePx: 1.8,
        minLengthPx: 6,
      });
    }
    if (zoom < 2.2) {
      return (mesh) => buildRenderableBoundaryMesh(mesh, {
        simplifyDistancePx: 1.1,
        minLengthPx: 4,
      });
    }
    return null;
  }
  if (kind === "coastline") {
    if (zoom < COASTLINE_LOD_LOW_ZOOM_MAX) {
      return (mesh) => buildRenderableBoundaryMesh(mesh, {
        simplifyDistancePx: 2.4,
        minLengthPx: 14,
        minSpanPx: 3,
      });
    }
    if (zoom < COASTLINE_LOD_MID_ZOOM_MAX) {
      return (mesh) => buildRenderableBoundaryMesh(mesh, {
        simplifyDistancePx: 1.2,
        minLengthPx: 8,
        minSpanPx: 2,
      });
    }
  }
  return null;
}

function getProjectedLineDensityStats(line) {
  const sanitized = sanitizePolyline(line);
  if (sanitized.length < 2 || !projection) {
    return { pointCount: 0, bboxArea: Infinity, density: 0 };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let pointCount = 0;
  sanitized.forEach((point) => {
    const projected = projection(point);
    if (!projected || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return;
    pointCount += 1;
    minX = Math.min(minX, projected[0]);
    minY = Math.min(minY, projected[1]);
    maxX = Math.max(maxX, projected[0]);
    maxY = Math.max(maxY, projected[1]);
  });
  if (!(pointCount > 1)) {
    return { pointCount, bboxArea: Infinity, density: 0 };
  }
  const bboxArea = Math.max(1, (maxX - minX) * (maxY - minY));
  return {
    pointCount,
    bboxArea,
    density: pointCount / bboxArea,
  };
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
  const provinceMeshTransform = getBoundaryMeshTransform("internal-province", k);
  const localMeshTransform = getBoundaryMeshTransform("internal-local", k);
  const empireMeshTransform = getBoundaryMeshTransform("empire", k);
  const coastlineMeshTransform = getBoundaryMeshTransform("coastline", k);

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
  let empireMeshes = dynamicOwnerMeshes || state.cachedCountryBorders;
  if (scenarioOwnerOnlyBorders) {
    empireMeshes = dynamicOwnerMeshes || openingOwnerMeshes || null;
    if (!dynamicOwnerMeshes && !openingOwnerMeshes && state.cachedCountryBorders?.length) {
      const scenarioId = String(state.activeScenarioId || "").trim() || "(unknown)";
      if (!scenarioOwnerOnlyCanonicalFallbackWarnings.has(scenarioId)) {
        scenarioOwnerOnlyCanonicalFallbackWarnings.add(scenarioId);
        console.warn(
          `[map_renderer] scenario_owner_only borders unavailable for scenario=${scenarioId}; canonical country-border fallback suppressed to preserve scenario integrity.`
        );
      }
    }
  }

  if (interactive) {
    const countryWidth = (empireWidthBase * 0.95) / kDenom;
    const coastWidth = (coastWidthBase * 0.88) / kDenom;
    const coastlineLow = state.cachedCoastlinesLow?.length
      ? state.cachedCoastlinesLow
      : (state.cachedCoastlines?.length ? state.cachedCoastlines : state.cachedCoastlinesHigh);

    context.globalAlpha = 0.88;
    drawMeshCollection(empireMeshes, empireColor, countryWidth, { transformMesh: empireMeshTransform });

    context.globalAlpha = 0.78;
    drawMeshCollection(coastlineLow, coastColor, coastWidth, { transformMesh: coastlineMeshTransform });

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
    internalOpacity * (0.08 + 0.34 * t) * lowZoomDeclutter * INTERNAL_BORDER_LOCAL_ALPHA_SCALE,
    INTERNAL_BORDER_LOCAL_MIN_ALPHA * INTERNAL_BORDER_LOCAL_ALPHA_SCALE,
    0.48 * INTERNAL_BORDER_LOCAL_ALPHA_SCALE
  );
  const parentAlpha = clamp(parentOpacity * (0.55 + 0.25 * t), 0.30, 0.90);
  const coastAlpha = clamp(0.74 + 0.12 * t, 0.74, 0.86);
  const detailAdmAlpha = clamp(
    (0.20 + 0.12 * t) * DETAIL_ADM_BORDER_ALPHA_SCALE,
    DETAIL_ADM_BORDER_TARGET_MIN_ALPHA,
    DETAIL_ADM_BORDER_TARGET_MAX_ALPHA
  );

  const countryWidth = (empireWidthBase * (0.95 + 0.40 * t)) / kDenom;
  let provinceWidth = Math.max(
    INTERNAL_BORDER_PROVINCE_MIN_WIDTH,
    internalWidthBase * (0.72 + 0.65 * t) * lowZoomWidthScale
  ) / kDenom;
  if (k < PROVINCE_BORDERS_FAR_WIDTH_MAX_ZOOM) {
    provinceWidth *= PROVINCE_BORDERS_FAR_WIDTH_SCALE;
  }
  if (k >= PROVINCE_BORDERS_NEAR_ZOOM_START) {
    provinceAlpha *= PROVINCE_BORDERS_NEAR_ALPHA_SCALE;
    provinceWidth *= PROVINCE_BORDERS_NEAR_WIDTH_SCALE;
  }
  const localWidth = Math.max(
    INTERNAL_BORDER_LOCAL_MIN_WIDTH,
    internalWidthBase * 0.40 * (0.70 + 0.55 * t) * lowZoomWidthScale
  ) * INTERNAL_BORDER_LOCAL_WIDTH_SCALE / kDenom;
  const parentWidth = (parentWidthBase * (0.90 + 0.35 * t)) / kDenom;
  const coastWidth = (coastWidthBase * (0.90 + 0.30 * t)) / kDenom;
  const detailAdmWidth = Math.max(
    DETAIL_ADM_BORDER_MIN_WIDTH,
    internalWidthBase * 0.42 * (0.72 + 0.40 * t) * lowZoomWidthScale
  ) * DETAIL_ADM_BORDER_WIDTH_SCALE / kDenom;
  const coastlineCollection = getViewportAwareCoastlineCollection(getCoastlineCollectionForZoom(k), k);
  const visibleCountryCodes = getVisibleCountryCodesForBorderMeshes();
  if (visibleCountryCodes.size > 0) {
    const includeProvinceMeshes = k >= PROVINCE_BORDERS_TRANSITION_END_ZOOM;
    const includeLocalMeshes = k >= LOCAL_BORDERS_MIN_ZOOM;
    const nextVisibleMeshSignature = [
      includeProvinceMeshes ? "province" : "country",
      includeLocalMeshes ? "local" : "nolocal",
      ...Array.from(visibleCountryCodes).sort((left, right) => left.localeCompare(right)),
    ].join("|");
    if (
      nextVisibleMeshSignature !== visibleInternalBorderMeshSignature
      && (includeProvinceMeshes || includeLocalMeshes)
    ) {
      visibleInternalBorderMeshSignature = nextVisibleMeshSignature;
      scheduleDeferredHeavyBorderMeshes();
    }
  }

  if (k >= LOCAL_BORDERS_MIN_ZOOM) {
    context.globalAlpha = localAlpha;
    visibleCountryCodes.forEach((countryCode) => {
      const meshes = state.cachedLocalBordersByCountry?.get(countryCode) || [];
      drawMeshCollection(
        meshes,
        getInternalBorderStrokeColor(countryCode, internalColor),
        localWidth,
        { transformMesh: localMeshTransform }
      );
    });
  }

  context.globalAlpha = provinceAlpha;
  visibleCountryCodes.forEach((countryCode) => {
    const meshes = state.cachedProvinceBordersByCountry?.get(countryCode) || [];
    drawMeshCollection(
      meshes,
      getInternalBorderStrokeColor(countryCode, internalColor),
      provinceWidth,
      { transformMesh: provinceMeshTransform }
    );
  });

  if (k >= DETAIL_ADM_BORDERS_MIN_ZOOM) {
    const detailAdmMeta = buildDetailAdmMeshSignature(visibleCountryCodes, k);
    const signatureChanged = detailAdmMeta.signature !== detailAdmMeshBuildState.signature;
    if (signatureChanged) {
      const hadDetailAdmBorders = state.cachedDetailAdmBorders.length > 0;
      state.cachedDetailAdmBorders = [];
      if (detailAdmMeta.detailCountries.length > 0) {
        detailAdmMeshBuildState = {
          signature: detailAdmMeta.signature,
          status: "building",
        };
        if (hadDetailAdmBorders) {
          syncStaticMeshSnapshot();
        }
        scheduleDeferredHeavyBorderMeshes();
      } else {
        detailAdmMeshBuildState = {
          signature: detailAdmMeta.signature,
          status: "empty",
        };
        if (hadDetailAdmBorders) {
          syncStaticMeshSnapshot();
        }
      }
    } else if (
      !state.cachedDetailAdmBorders.length
      && detailAdmMeshBuildState.status === "idle"
      && detailAdmMeta.detailCountries.length > 0
    ) {
      detailAdmMeshBuildState = {
        signature: detailAdmMeta.signature,
        status: "building",
      };
      scheduleDeferredHeavyBorderMeshes();
    }
  }

  if (k >= DETAIL_ADM_BORDERS_MIN_ZOOM) {
    context.globalAlpha = detailAdmAlpha;
    drawMeshCollection(state.cachedDetailAdmBorders, DETAIL_ADM_BORDER_COLOR, detailAdmWidth);
  }

  const enabledParentCountries = state.parentBordersVisible === false
    ? []
    : (state.parentBorderSupportedCountries || []).filter(
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
  drawMeshCollection(empireMeshes, empireColor, countryWidth, { transformMesh: empireMeshTransform });

  context.globalAlpha = coastAlpha;
  drawMeshCollection(coastlineCollection, coastColor, coastWidth, { transformMesh: coastlineMeshTransform });
  drawTnoCoastalAccentLayer(k, { interactive });

  context.globalAlpha = 1.0;
}

function normalizeOceanPreset(value) {
  const candidate = String(value || "flat").trim().toLowerCase();
  if (
    candidate === "flat" ||
    candidate === "bathymetry_soft" ||
    candidate === "bathymetry_contours"
  ) {
    return candidate;
  }
  return "flat";
}

function getBathymetryPresetProfile(preset = "flat") {
  return BATHYMETRY_PRESET_PROFILES[normalizeOceanPreset(preset)] || null;
}

function getBathymetryPresetStyleDefaults(preset = "flat") {
  const profile = getBathymetryPresetProfile(preset);
  if (!profile) return null;
  return {
    opacity: profile.defaultOpacity,
    scale: profile.defaultScale,
    contourStrength: profile.defaultContourStrength,
  };
}

function getOceanStyleConfig() {
  const ocean = state.styleConfig?.ocean || {};
  const preset = normalizeOceanPreset(ocean.preset);
  return {
    preset,
    opacity: clamp(Number.isFinite(Number(ocean.opacity)) ? Number(ocean.opacity) : 0.72, 0, 1),
    scale: clamp(Number.isFinite(Number(ocean.scale)) ? Number(ocean.scale) : 1, 0.6, 2.4),
    contourStrength: clamp(
      Number.isFinite(Number(ocean.contourStrength)) ? Number(ocean.contourStrength) : 0.75,
      0,
      1
    ),
    bathymetryProfile: getBathymetryPresetProfile(preset),
    experimentalAdvancedStyles: ocean.experimentalAdvancedStyles === true,
    coastalAccentEnabled: isTnoCoastalAccentEnabled(),
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

function getScenarioBathymetryTopologyUrl() {
  return String(state.activeScenarioManifest?.bathymetry_topology_url || "").trim();
}

function doesOceanStyleRequireBathymetry(oceanStyle = getOceanStyleConfig()) {
  return !!(
    oceanStyle?.experimentalAdvancedStyles
    && String(oceanStyle?.preset || "flat").trim().toLowerCase() !== "flat"
  );
}

function getDesiredBathymetryTopologyUrl(slot) {
  if (slot === "scenario") {
    return getScenarioBathymetryTopologyUrl();
  }
  return GLOBAL_BATHYMETRY_TOPOLOGY_URL;
}

function clearBathymetryStateSlot(slot) {
  if (slot === "scenario") {
    state.scenarioBathymetryTopologyData = null;
    state.scenarioBathymetryBandsData = null;
    state.scenarioBathymetryContoursData = null;
    state.scenarioBathymetryTopologyUrl = "";
    return;
  }
  state.globalBathymetryTopologyData = null;
  state.globalBathymetryBandsData = null;
  state.globalBathymetryContoursData = null;
  state.globalBathymetryTopologyUrl = "";
}

function disableActiveBathymetryState() {
  state.activeBathymetryBandsData = null;
  state.activeBathymetryContoursData = null;
  state.activeBathymetrySource = "none";
  state.activeBathymetryTopologyUrl = "";
}

function setBathymetryStateSlot(slot, url, entry) {
  if (slot === "scenario") {
    state.scenarioBathymetryTopologyData = entry?.topology || null;
    state.scenarioBathymetryBandsData = entry?.bands || null;
    state.scenarioBathymetryContoursData = entry?.contours || null;
    state.scenarioBathymetryTopologyUrl = String(url || "");
    return;
  }
  state.globalBathymetryTopologyData = entry?.topology || null;
  state.globalBathymetryBandsData = entry?.bands || null;
  state.globalBathymetryContoursData = entry?.contours || null;
  state.globalBathymetryTopologyUrl = String(url || "");
}

function cloneBathymetryFeatureWithSource(feature, source) {
  if (!feature || typeof feature !== "object") return null;
  return {
    ...feature,
    properties: {
      ...(feature.properties || {}),
      _bathymetrySource: source,
    },
  };
}

function buildBathymetryFeatureCollection(features) {
  const nextFeatures = Array.isArray(features) ? features.filter(Boolean) : [];
  if (!nextFeatures.length) return null;
  return {
    type: "FeatureCollection",
    features: nextFeatures,
  };
}

function mergeBathymetryFeatureCollections(scenarioCollection, globalCollection) {
  const scenarioFeatures = Array.isArray(scenarioCollection?.features)
    ? scenarioCollection.features.map((feature) => cloneBathymetryFeatureWithSource(feature, "scenario"))
    : [];
  const globalFeatures = Array.isArray(globalCollection?.features)
    ? globalCollection.features.map((feature) => cloneBathymetryFeatureWithSource(feature, "global"))
    : [];
  return buildBathymetryFeatureCollection([...scenarioFeatures, ...globalFeatures]);
}

function syncActiveBathymetryState() {
  const scenarioUrl = getScenarioBathymetryTopologyUrl();
  const scenarioReady =
    !!state.activeScenarioId &&
    !!scenarioUrl &&
    state.scenarioBathymetryTopologyUrl === scenarioUrl &&
    (!!state.scenarioBathymetryBandsData || !!state.scenarioBathymetryContoursData);
  const globalReady =
    state.globalBathymetryTopologyUrl === GLOBAL_BATHYMETRY_TOPOLOGY_URL &&
    (!!state.globalBathymetryBandsData || !!state.globalBathymetryContoursData);

  if (scenarioReady && globalReady) {
    state.activeBathymetryBandsData = mergeBathymetryFeatureCollections(
      state.scenarioBathymetryBandsData,
      state.globalBathymetryBandsData
    );
    state.activeBathymetryContoursData = mergeBathymetryFeatureCollections(
      state.scenarioBathymetryContoursData,
      state.globalBathymetryContoursData
    );
    state.activeBathymetrySource = "merged";
    state.activeBathymetryTopologyUrl = `${scenarioUrl}|${GLOBAL_BATHYMETRY_TOPOLOGY_URL}`;
    return;
  }
  if (scenarioReady) {
    state.activeBathymetryBandsData = mergeBathymetryFeatureCollections(state.scenarioBathymetryBandsData, null);
    state.activeBathymetryContoursData = mergeBathymetryFeatureCollections(state.scenarioBathymetryContoursData, null);
    state.activeBathymetrySource = "scenario";
    state.activeBathymetryTopologyUrl = scenarioUrl;
    return;
  }
  if (globalReady) {
    state.activeBathymetryBandsData = mergeBathymetryFeatureCollections(null, state.globalBathymetryBandsData);
    state.activeBathymetryContoursData = mergeBathymetryFeatureCollections(null, state.globalBathymetryContoursData);
    state.activeBathymetrySource = "global";
    state.activeBathymetryTopologyUrl = GLOBAL_BATHYMETRY_TOPOLOGY_URL;
    return;
  }
  state.activeBathymetryBandsData = null;
  state.activeBathymetryContoursData = null;
  state.activeBathymetrySource = "none";
  state.activeBathymetryTopologyUrl = "";
}

function getCachedBathymetryEntry(url) {
  if (!url) return null;
  const entry = bathymetryTopologyCacheByUrl.get(url);
  return entry && typeof entry === "object" ? entry : null;
}

function normalizeBathymetryTopologyEntry(url, topology) {
  if (!topology || typeof topology !== "object") {
    return null;
  }
  const bands = getLayerFeatureCollection(topology, BATHYMETRY_BANDS_OBJECT_NAME);
  const contours = getLayerFeatureCollection(topology, BATHYMETRY_CONTOURS_OBJECT_NAME);
  if (!Array.isArray(bands?.features) && !Array.isArray(contours?.features)) {
    return null;
  }
  return {
    url,
    topology,
    bands: Array.isArray(bands?.features) ? bands : null,
    contours: Array.isArray(contours?.features) ? contours : null,
  };
}

function warnBathymetryLoadFailureOnce(url, error) {
  if (!url || bathymetryLoadFailureByUrl.has(url)) return;
  bathymetryLoadFailureByUrl.add(url);
  const message = error instanceof Error ? error.message : String(error || "Unknown error");
  console.warn(`[bathymetry] Failed to load ${url}: ${message}`);
}

function applyResolvedBathymetryEntry(slot, url, entry) {
  if (!url || getDesiredBathymetryTopologyUrl(slot) !== url) {
    return false;
  }
  setBathymetryStateSlot(slot, url, entry);
  syncActiveBathymetryState();
  return true;
}

async function loadBathymetryTopology(url, { slot = "global" } = {}) {
  if (!url) return null;
  const response = await fetch(url, { cache: "default" });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  const payload = await response.json();
  const entry = normalizeBathymetryTopologyEntry(url, payload);
  if (!entry) {
    throw new Error("Missing bathymetry_bands / bathymetry_contours objects");
  }
  bathymetryTopologyCacheByUrl.set(url, entry);
  applyResolvedBathymetryEntry(slot, url, entry);
  invalidateOceanVisualState(`bathymetry-loaded:${slot}`);
  if (context) {
    render();
  }
  return entry;
}

function scheduleBathymetryTopologyLoad(url, { slot = "global" } = {}) {
  if (!url) {
    clearBathymetryStateSlot(slot);
    syncActiveBathymetryState();
    return;
  }
  const cached = getCachedBathymetryEntry(url);
  if (cached) {
    applyResolvedBathymetryEntry(slot, url, cached);
    return;
  }
  if (bathymetryLoadFailureByUrl.has(url) || bathymetryLoadPromiseByUrl.has(url)) {
    return;
  }
  const loadPromise = loadBathymetryTopology(url, { slot })
    .catch((error) => {
      warnBathymetryLoadFailureOnce(url, error);
      if (getDesiredBathymetryTopologyUrl(slot) === url) {
        clearBathymetryStateSlot(slot);
        syncActiveBathymetryState();
      }
      return null;
    })
    .finally(() => {
      bathymetryLoadPromiseByUrl.delete(url);
    });
  bathymetryLoadPromiseByUrl.set(url, loadPromise);
}

function ensureBathymetryDataAvailability({ required = doesOceanStyleRequireBathymetry() } = {}) {
  if (!required) {
    disableActiveBathymetryState();
    return false;
  }
  scheduleBathymetryTopologyLoad(GLOBAL_BATHYMETRY_TOPOLOGY_URL, { slot: "global" });
  const scenarioUrl = getScenarioBathymetryTopologyUrl();
  if (state.activeScenarioId && scenarioUrl) {
    scheduleBathymetryTopologyLoad(scenarioUrl, { slot: "scenario" });
  } else {
    clearBathymetryStateSlot("scenario");
  }
  syncActiveBathymetryState();
  return true;
}

function getBathymetryFeatureCollections() {
  return {
    bands: Array.isArray(state.activeBathymetryBandsData?.features) ? state.activeBathymetryBandsData : null,
    contours: Array.isArray(state.activeBathymetryContoursData?.features) ? state.activeBathymetryContoursData : null,
    scenarioCoverage: Array.isArray(state.scenarioBathymetryBandsData?.features) ? state.scenarioBathymetryBandsData : null,
  };
}

function getBathymetryFeatureDepthMax(feature) {
  const rawValue = Number(
    feature?.properties?.depth_max_m ??
    feature?.properties?.depth_m ??
    feature?.properties?.max_depth_m ??
    0
  );
  return Number.isFinite(rawValue) ? Math.max(0, Math.abs(rawValue)) : 0;
}

function interpolateRgbChannels(startRgb, endRgb, ratio) {
  const tRatio = clamp(Number(ratio) || 0, 0, 1);
  return {
    r: Math.round(startRgb.r + (endRgb.r - startRgb.r) * tRatio),
    g: Math.round(startRgb.g + (endRgb.g - startRgb.g) * tRatio),
    b: Math.round(startRgb.b + (endRgb.b - startRgb.b) * tRatio),
  };
}

function getBathymetryBaseRgb() {
  const oceanChannels = parseCanvasColorChannels(getOceanBaseFillColor());
  if (oceanChannels) {
    return {
      r: oceanChannels.r,
      g: oceanChannels.g,
      b: oceanChannels.b,
    };
  }
  return { r: 170, g: 218, b: 255 };
}

function isAtlantropaBathymetryFeature(feature) {
  return String(feature?.properties?.region_group || "").trim().toLowerCase().startsWith("atlantropa_");
}

function getBathymetryVisualModifiers(feature) {
  const source = String(feature?.properties?._bathymetrySource || "").trim().toLowerCase();
  const mode = String(feature?.properties?.bathymetry_mode || "").trim().toLowerCase();
  const depthMax = getBathymetryFeatureDepthMax(feature);
  if (source !== "scenario" || !isAtlantropaBathymetryFeature(feature)) {
    return {
      bandBrightness: 1,
      bandAlpha: 1,
      contourBrightness: 1,
      contourAlpha: 1,
    };
  }

  if (mode === "synthetic") {
    const shallowScale = depthMax <= 150 ? 0.92 : 1;
    return {
      bandBrightness: 0.7 * shallowScale,
      bandAlpha: 0.62 * shallowScale,
      contourBrightness: 0.64 * shallowScale,
      contourAlpha: 0.56 * shallowScale,
    };
  }

  const shallowScale = depthMax <= 150 ? 0.95 : 1;
  return {
    bandBrightness: 0.88 * shallowScale,
    bandAlpha: 0.8 * shallowScale,
    contourBrightness: 0.86 * shallowScale,
    contourAlpha: 0.8 * shallowScale,
  };
}

function getBathymetryBandFillStyle(feature, oceanStyle) {
  const profile = oceanStyle.bathymetryProfile || getBathymetryPresetProfile(oceanStyle.preset);
  const baseRgb = getBathymetryBaseRgb();
  const shallowRgb = interpolateRgbChannels(baseRgb, { r: 226, g: 242, b: 255 }, 0.88);
  const deepRgb = interpolateRgbChannels(baseRgb, { r: 12, g: 47, b: 86 }, 0.78);
  const depthRatioRaw = getBathymetryFeatureDepthMax(feature) / BATHYMETRY_MAX_REFERENCE_DEPTH_M;
  const scaledDepthRatio = clamp(
    Math.pow(clamp(depthRatioRaw, 0, 1), 1 / Math.max(0.45, oceanStyle.scale)),
    0,
    1
  );
  const visualModifiers = getBathymetryVisualModifiers(feature);
  const fillRgb = interpolateRgbChannels(
    baseRgb,
    interpolateRgbChannels(shallowRgb, deepRgb, scaledDepthRatio),
    visualModifiers.bandBrightness
  );
  const alphaBase = profile?.bandAlphaBase ?? 0.42;
  const alpha = clamp(
    oceanStyle.opacity
      * (alphaBase + scaledDepthRatio * 0.2 + (1 - scaledDepthRatio) * 0.1 + oceanStyle.contourStrength * 0.1)
      * visualModifiers.bandAlpha,
    0,
    0.96
  );
  return toRgbaString(fillRgb, alpha);
}

function getBathymetryContourStrokeStyle(feature, oceanStyle) {
  const profile = oceanStyle.bathymetryProfile || getBathymetryPresetProfile(oceanStyle.preset);
  const baseRgb = getBathymetryBaseRgb();
  const depthRatioRaw = getBathymetryFeatureDepthMax(feature) / BATHYMETRY_MAX_REFERENCE_DEPTH_M;
  const scaledDepthRatio = clamp(depthRatioRaw, 0, 1);
  const visualModifiers = getBathymetryVisualModifiers(feature);
  const strokeRgb = interpolateRgbChannels(
    baseRgb,
    interpolateRgbChannels(
      { r: 204, g: 228, b: 246 },
      { r: 58, g: 101, b: 144 },
      scaledDepthRatio
    ),
    visualModifiers.contourBrightness
  );
  const alphaBase = profile?.contourAlphaBase ?? 0.28;
  const alpha = clamp(
    oceanStyle.opacity
      * (alphaBase + oceanStyle.contourStrength * 0.46 + scaledDepthRatio * 0.08)
      * visualModifiers.contourAlpha,
    0,
    0.92
  );
  return toRgbaString(strokeRgb, alpha);
}

function sortBathymetryFeaturesForFill(collection) {
  if (!Array.isArray(collection?.features)) return [];
  return [...collection.features].sort((a, b) => getBathymetryFeatureDepthMax(b) - getBathymetryFeatureDepthMax(a));
}

function getBathymetryTuningConfig() {
  const ocean = state.styleConfig?.ocean || {};
  const shallowBandFadeEndZoom = clamp(
    Number.isFinite(Number(ocean.shallowBandFadeEndZoom)) ? Number(ocean.shallowBandFadeEndZoom) : BATHYMETRY_BAND_SHALLOW_FADE_END_ZOOM,
    BATHYMETRY_BAND_SHALLOW_FADE_START_ZOOM + 0.1,
    4.8
  );
  const midBandFadeEndZoom = clamp(
    Number.isFinite(Number(ocean.midBandFadeEndZoom)) ? Number(ocean.midBandFadeEndZoom) : BATHYMETRY_BAND_MID_FADE_END_ZOOM,
    BATHYMETRY_BAND_MID_FADE_START_ZOOM + 0.1,
    5.2
  );
  const deepBandFadeEndZoom = clamp(
    Number.isFinite(Number(ocean.deepBandFadeEndZoom)) ? Number(ocean.deepBandFadeEndZoom) : BATHYMETRY_BAND_DEEP_FADE_END_ZOOM,
    BATHYMETRY_BAND_DEEP_FADE_START_ZOOM + 0.1,
    6
  );
  const scenarioSyntheticContourFadeEndZoom = clamp(
    Number.isFinite(Number(ocean.scenarioSyntheticContourFadeEndZoom))
      ? Number(ocean.scenarioSyntheticContourFadeEndZoom)
      : BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_END_ZOOM,
    BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_START_ZOOM + 0.1,
    4.6
  );
  const scenarioShallowContourFadeEndZoom = clamp(
    Number.isFinite(Number(ocean.scenarioShallowContourFadeEndZoom))
      ? Number(ocean.scenarioShallowContourFadeEndZoom)
      : BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_END_ZOOM,
    BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_START_ZOOM + 0.1,
    5
  );
  return {
    shallowBandFadeEndZoom,
    midBandFadeEndZoom,
    deepBandFadeEndZoom,
    scenarioSyntheticContourFadeEndZoom,
    scenarioShallowContourFadeEndZoom,
  };
}

function getZoomFadeFactor(k, fadeStartZoom, fadeEndZoom) {
  if (!(k >= fadeStartZoom)) {
    return 1;
  }
  if (k >= fadeEndZoom) {
    return 0;
  }
  return clamp(
    1 - (k - fadeStartZoom) / Math.max(0.0001, fadeEndZoom - fadeStartZoom),
    0,
    1
  );
}

function getBathymetryBandVisibilityConfig(feature, k) {
  const tuning = getBathymetryTuningConfig();
  const depthMax = getBathymetryFeatureDepthMax(feature);
  if (depthMax <= BATHYMETRY_SHALLOW_DEPTH_MAX_M) {
    return { alpha: getZoomFadeFactor(k, BATHYMETRY_BAND_SHALLOW_FADE_START_ZOOM, tuning.shallowBandFadeEndZoom) };
  }
  if (depthMax <= BATHYMETRY_MID_DEPTH_MAX_M) {
    return { alpha: getZoomFadeFactor(k, BATHYMETRY_BAND_MID_FADE_START_ZOOM, tuning.midBandFadeEndZoom) };
  }
  return { alpha: getZoomFadeFactor(k, BATHYMETRY_BAND_DEEP_FADE_START_ZOOM, tuning.deepBandFadeEndZoom) };
}

function drawBathymetryBands(collection, oceanStyle) {
  const zoomK = Number(state.zoomTransform?.k) || 1;
  const features = sortBathymetryFeaturesForFill(collection);
  features.forEach((feature) => {
    const visibilityConfig = getBathymetryBandVisibilityConfig(feature, zoomK);
    if (visibilityConfig.alpha <= 0) return;
    context.save();
    context.globalAlpha *= visibilityConfig.alpha;
    context.beginPath();
    pathCanvas(feature);
    context.fillStyle = getBathymetryBandFillStyle(feature, oceanStyle);
    context.fill();
    context.restore();
  });
}

function buildVisibleBathymetryContourDepthSet(collection, oceanStyle) {
  const profile = oceanStyle.bathymetryProfile || getBathymetryPresetProfile(oceanStyle.preset);
  if (!profile?.skipAlternateContourDepths || !Array.isArray(collection?.features)) {
    return null;
  }
  const uniqueDepths = [...new Set(collection.features.map((feature) => getBathymetryFeatureDepthMax(feature)))]
    .filter((depth) => depth > 0)
    .sort((a, b) => a - b);
  if (!uniqueDepths.length) return null;
  return new Set(uniqueDepths.filter((_, index) => index % 2 === 0));
}

function getBathymetryContourVisibilityConfig(feature, k) {
  const tuning = getBathymetryTuningConfig();
  const source = String(feature?.properties?._bathymetrySource || "").trim().toLowerCase();
  if (source !== "scenario") {
    return { alpha: 1 };
  }
  const mode = String(feature?.properties?.bathymetry_mode || "").trim().toLowerCase();
  if (mode === "synthetic") {
    return {
      alpha: getZoomFadeFactor(
        k,
        BATHYMETRY_SCENARIO_SYNTHETIC_CONTOUR_FADE_START_ZOOM,
        tuning.scenarioSyntheticContourFadeEndZoom
      ),
    };
  }
  if (getBathymetryFeatureDepthMax(feature) <= BATHYMETRY_SHALLOW_DEPTH_MAX_M) {
    return {
      alpha: getZoomFadeFactor(
        k,
        BATHYMETRY_SCENARIO_SHALLOW_CONTOUR_FADE_START_ZOOM,
        tuning.scenarioShallowContourFadeEndZoom
      ),
    };
  }
  return { alpha: 1 };
}

function drawBathymetryContours(collection, oceanStyle) {
  if (!Array.isArray(collection?.features) || !collection.features.length) return;
  const zoomK = Number(state.zoomTransform?.k) || 1;
  const profile = oceanStyle.bathymetryProfile || getBathymetryPresetProfile(oceanStyle.preset);
  const lineWidthBase = (profile?.contourLineWidthBase ?? 0.45)
    + oceanStyle.contourStrength * (profile?.contourLineWidthScale ?? 0.75);
  const visibleDepths = buildVisibleBathymetryContourDepthSet(collection, oceanStyle);
  collection.features.forEach((feature) => {
    if (visibleDepths && !visibleDepths.has(getBathymetryFeatureDepthMax(feature))) {
      return;
    }
    const visibilityConfig = getBathymetryContourVisibilityConfig(feature, zoomK);
    if (visibilityConfig.alpha <= 0) return;
    context.save();
    context.globalAlpha *= visibilityConfig.alpha;
    context.beginPath();
    pathCanvas(feature);
    context.strokeStyle = getBathymetryContourStrokeStyle(feature, oceanStyle);
    context.lineWidth = lineWidthBase;
    context.stroke();
    context.restore();
  });
}

function getBathymetryCollectionBySource(collection, source) {
  if (!Array.isArray(collection?.features)) return null;
  return buildBathymetryFeatureCollection(
    collection.features.filter((feature) => String(feature?.properties?._bathymetrySource || "") === source)
  );
}

function getCoastlineCollectionForZoom(k) {
  if (k < COASTLINE_LOD_LOW_ZOOM_MAX) {
    return state.cachedCoastlinesLow?.length ? state.cachedCoastlinesLow : state.cachedCoastlines;
  }
  if (k < COASTLINE_LOD_MID_ZOOM_MAX) {
    return state.cachedCoastlinesMid?.length ? state.cachedCoastlinesMid : state.cachedCoastlines;
  }
  return state.cachedCoastlinesHigh?.length ? state.cachedCoastlinesHigh : state.cachedCoastlines;
}

function getTnoCoastalAccentLineWidth(k, { interactive = false, overlay = false } = {}) {
  const baseWidth = overlay
    ? 1.22 / Math.max(0.0001, k)
    : (interactive ? 1.05 : 1.28) / Math.max(0.0001, k);
  if (k < COASTLINE_LOD_MID_ZOOM_MAX) {
    return baseWidth;
  }
  return Math.max(baseWidth, overlay ? COASTLINE_ACCENT_OVERLAY_MIN_WIDTH_PX : COASTLINE_ACCENT_MIN_WIDTH_PX);
}

function isAtlantropaScenarioShorelineOverlay(feature) {
  if (getReliefOverlayKind(feature) !== "new_shoreline") return false;
  return String(feature?.properties?.parent_id || "").trim().toLowerCase().startsWith("atlantropa_");
}

function getFeatureProjectedDensity(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return 0;
  const lines = geometry.type === "LineString"
    ? [geometry.coordinates]
    : geometry.type === "MultiLineString"
      ? geometry.coordinates
      : [];
  let maxDensity = 0;
  lines.forEach((line) => {
    const density = getProjectedLineDensityStats(line).density;
    if (density > maxDensity) {
      maxDensity = density;
    }
  });
  return maxDensity;
}

function buildCoastalAccentStrokeBuckets(entries) {
  const buckets = new Map();
  entries.forEach((entry) => {
    if (!entry?.geometry) return;
    const alpha = clamp(Number(entry.alpha) || 0, 0, 1);
    const lineWidth = Math.max(0, Number(entry.lineWidth) || 0);
    if (!(alpha > 0) || !(lineWidth > 0)) return;
    const key = `${alpha.toFixed(4)}|${lineWidth.toFixed(4)}`;
    const bucket = buckets.get(key) || {
      alpha,
      lineWidth,
      geometries: [],
    };
    bucket.geometries.push(entry.geometry);
    buckets.set(key, bucket);
  });
  return [...buckets.values()];
}

function drawCoastalAccentStrokeBuckets(entries, { clipAtlantropa = false } = {}) {
  if (!context || !Array.isArray(entries) || !entries.length) return;
  const buckets = buildCoastalAccentStrokeBuckets(entries);
  if (!buckets.length) return;
  buckets.forEach((bucket) => {
    context.save();
    if (clipAtlantropa) {
      clipOutAtlantropaAccentRegions();
    }
    context.strokeStyle = TNO_COASTAL_ACCENT_COLOR;
    context.globalAlpha = bucket.alpha;
    context.lineWidth = bucket.lineWidth;
    context.lineJoin = "round";
    context.lineCap = "round";
    context.beginPath();
    bucket.geometries.forEach((geometry) => {
      pathCanvas(geometry);
    });
    context.stroke();
    context.restore();
  });
}

function getScenarioCoastalAccentOverlayVisualConfig(feature, k, { interactive = false } = {}) {
  const isAtlantropa = isAtlantropaScenarioShorelineOverlay(feature);
  let alpha = interactive ? 0.38 : 0.62;
  if (isAtlantropa) {
    alpha = interactive
      ? COASTLINE_OVERLAY_ATLANTROPA_ALPHA_INTERACTIVE
      : COASTLINE_OVERLAY_ATLANTROPA_ALPHA;
    if (k < COASTLINE_LOD_MID_ZOOM_MAX) {
      const densityThreshold = k < COASTLINE_LOD_LOW_ZOOM_MAX
        ? COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW
        : COASTLINE_ACCENT_DENSITY_THRESHOLD_MID;
      const densityAlpha = k < COASTLINE_LOD_LOW_ZOOM_MAX
        ? COASTLINE_OVERLAY_DENSITY_ALPHA_LOW
        : COASTLINE_OVERLAY_DENSITY_ALPHA_MID;
      if (getFeatureProjectedDensity(feature) > densityThreshold) {
        alpha *= densityAlpha;
      }
    }
  }
  return {
    alpha,
    lineWidth: getTnoCoastalAccentLineWidth(k, { interactive, overlay: true }),
  };
}

function clipOutAtlantropaAccentRegions() {
  const suppressionFeatures = getAtlantropaAccentSuppressionFeatures();
  if (!suppressionFeatures.length || !context) return false;
  const canvasWidth = Number(state.width) || context.canvas?.width || 0;
  const canvasHeight = Number(state.height) || context.canvas?.height || 0;
  if (!(canvasWidth > 0) || !(canvasHeight > 0)) return false;
  context.beginPath();
  context.rect(0, 0, canvasWidth, canvasHeight);
  suppressionFeatures.forEach((feature) => {
    if (!feature?.geometry) return;
    pathCanvas(feature);
  });
  try {
    context.clip("evenodd");
    return true;
  } catch (_) {
    return false;
  }
}

function drawScenarioCoastalAccentOverlays(k, { interactive = false } = {}) {
  const shorelineFeatures = getScenarioCoastalAccentOverlayFeatures();
  if (!shorelineFeatures.length) return;
  const entries = [];
  shorelineFeatures.forEach((feature) => {
    if (!pathBoundsInScreen(feature)) return;
    const visualConfig = getScenarioCoastalAccentOverlayVisualConfig(feature, k, { interactive });
    entries.push({
      geometry: feature,
      alpha: visualConfig.alpha,
      lineWidth: visualConfig.lineWidth,
    });
  });
  drawCoastalAccentStrokeBuckets(entries);
}

function drawTnoCoastalAccentLayer(k, { interactive = false } = {}) {
  if (!context || !isTnoCoastalAccentEnabled()) return;
  const coastlineDecision = resolveCoastlineTopologySource();
  const usesScenarioCoastlineSource = coastlineDecision?.source === "scenario";
  const coastlineCollection = interactive
    ? getCoastlineCollectionForZoom(k)
    : getViewportAwareCoastlineCollection(getCoastlineCollectionForZoom(k), k);
  const coastlineWidth = getTnoCoastalAccentLineWidth(k, { interactive });
  const densityThreshold = k < COASTLINE_LOD_LOW_ZOOM_MAX
    ? COASTLINE_ACCENT_DENSITY_THRESHOLD_LOW
    : k < COASTLINE_LOD_MID_ZOOM_MAX
      ? COASTLINE_ACCENT_DENSITY_THRESHOLD_MID
      : Infinity;
  const entries = [];
  coastlineCollection.forEach((mesh) => {
    if (!isUsableMesh(mesh)) return;
    mesh.coordinates.forEach((line) => {
      const densityStats = interactive
        ? { density: 0 }
        : getProjectedLineDensityStats(line);
      const densityScale = densityStats.density > densityThreshold
        ? (k < COASTLINE_LOD_LOW_ZOOM_MAX ? COASTLINE_ACCENT_DENSITY_ALPHA_LOW : COASTLINE_ACCENT_DENSITY_ALPHA_MID)
        : 1;
      entries.push({
        geometry: {
        type: "LineString",
        coordinates: line,
        },
        alpha: (interactive ? 0.28 : 0.4) * densityScale,
        lineWidth: coastlineWidth * (densityScale < 1 ? COASTLINE_ACCENT_DENSITY_WIDTH_SCALE : 1),
      });
    });
  });
  drawCoastalAccentStrokeBuckets(entries, { clipAtlantropa: !usesScenarioCoastlineSource });
  if (!usesScenarioCoastlineSource) {
    drawScenarioCoastalAccentOverlays(k, { interactive });
  }
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

function applyBathymetryCoverageExclusionMask(coverageCollection) {
  if (!Array.isArray(coverageCollection?.features) || !coverageCollection.features.length) return;
  context.beginPath();
  pathCanvas({ type: "Sphere" });
  pathCanvas(coverageCollection);
  try {
    context.clip("evenodd");
  } catch (error) {
    context.clip();
  }
}

function drawOceanStyle() {
  if (!context || !pathCanvas) return;
  const oceanStyle = getOceanStyleConfig();
  const bathymetryRequired = doesOceanStyleRequireBathymetry(oceanStyle);
  ensureBathymetryDataAvailability({
    required: bathymetryRequired,
  });
  if (!oceanStyle.experimentalAdvancedStyles) {
    state.oceanMaskMode = OCEAN_MASK_MODE_TOPOLOGY;
    state.oceanMaskQuality = 0;
    return;
  }
  if (oceanStyle.preset === "flat") {
    state.oceanMaskMode = OCEAN_MASK_MODE_TOPOLOGY;
    state.oceanMaskQuality = 0;
    return;
  }
  const bathymetryData = getBathymetryFeatureCollections();
  const hasBands = Array.isArray(bathymetryData.bands?.features) && bathymetryData.bands.features.length > 0;
  const hasContours =
    Array.isArray(bathymetryData.contours?.features) && bathymetryData.contours.features.length > 0;
  if (!hasBands && !hasContours) {
    state.oceanMaskMode = OCEAN_MASK_MODE_TOPOLOGY;
    state.oceanMaskQuality = 0;
    return;
  }

  const { mode: clipMaskMode } = resolveOceanMask();
  const globalBands = getBathymetryCollectionBySource(bathymetryData.bands, "global");
  const scenarioBands = getBathymetryCollectionBySource(bathymetryData.bands, "scenario");
  const globalContours = getBathymetryCollectionBySource(bathymetryData.contours, "global");
  const scenarioContours = getBathymetryCollectionBySource(bathymetryData.contours, "scenario");
  const scenarioCoverage = bathymetryData.scenarioCoverage;

  context.save();
  applyOceanClipMask(clipMaskMode);
  if (Array.isArray(globalBands?.features) && globalBands.features.length) {
    context.save();
    applyBathymetryCoverageExclusionMask(scenarioCoverage);
    drawBathymetryBands(globalBands, oceanStyle);
    context.restore();
  }
  if (Array.isArray(scenarioBands?.features) && scenarioBands.features.length) {
    drawBathymetryBands(scenarioBands, oceanStyle);
  }
  if (Array.isArray(globalContours?.features) && globalContours.features.length) {
    context.save();
    applyBathymetryCoverageExclusionMask(scenarioCoverage);
    drawBathymetryContours(globalContours, oceanStyle);
    context.restore();
  }
  if (Array.isArray(scenarioContours?.features) && scenarioContours.features.length) {
    drawBathymetryContours(scenarioContours, oceanStyle);
  }
  context.restore();
  state.oceanMaskMode = OCEAN_MASK_MODE_BATHYMETRY;
  state.oceanMaskQuality = 1;
}

const VALID_BLEND_MODES = new Set([
  "source-over",
  "source-in",
  "source-out",
  "source-atop",
  "destination-over",
  "destination-in",
  "destination-out",
  "destination-atop",
  "lighter",
  "copy",
  "xor",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
]);

function getSafeBlendMode(value, fallback = "source-over") {
  const normalizedFallback = String(fallback || "source-over").trim().toLowerCase();
  const safeFallback = VALID_BLEND_MODES.has(normalizedFallback) ? normalizedFallback : "source-over";
  const mode = String(value || "").trim().toLowerCase();
  return VALID_BLEND_MODES.has(mode) ? mode : safeFallback;
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

function getResolvedPhysicalAtlasCollection() {
  if (Array.isArray(state.physicalSemanticsData?.features) && state.physicalSemanticsData.features.length > 0) {
    return state.physicalSemanticsData;
  }
  warnMissingPhysicalContextOnce(
    "physical-semantics-missing",
    "[physical] global_physical_semantics.topo.json unavailable or deferred; disabling physical atlas instead of using the old fallback."
  );
  return null;
}

function getPhysicalPresetId(cfg) {
  const preset = String(cfg?.preset || "balanced").trim().toLowerCase();
  if (preset === "political_clean" || preset === "terrain_rich") {
    return preset;
  }
  return "balanced";
}

function getPhysicalPresetRenderProfile(cfg) {
  const preset = getPhysicalPresetId(cfg);
  if (preset === "political_clean") {
    return {
      preset,
      reliefOpacityMultiplier: 0.38,
      semanticOpacityMultiplier: 0.2,
      reliefBlendFallback: "source-over",
      semanticBlendMode: "source-over",
      majorContourOpacityMultiplier: 0.92,
      minorContourOpacityRatio: 0.52,
      minorContourMinZoom: 2.6,
    };
  }
  if (preset === "terrain_rich") {
    return {
      preset,
      reliefOpacityMultiplier: 1,
      semanticOpacityMultiplier: 0.72,
      reliefBlendFallback: "soft-light",
      semanticBlendMode: "source-over",
      majorContourOpacityMultiplier: 1.55,
      minorContourOpacityRatio: 0.8,
      minorContourMinZoom: 1.2,
    };
  }
  return {
    preset: "balanced",
    reliefOpacityMultiplier: 0.72,
    semanticOpacityMultiplier: 0.42,
    reliefBlendFallback: "source-over",
    semanticBlendMode: "source-over",
    majorContourOpacityMultiplier: 1.22,
    minorContourOpacityRatio: 0.68,
    minorContourMinZoom: 1.6,
  };
}

function getAtlasFeatureAlphaMultiplier(atlasClass, cfg) {
  const normalized = String(atlasClass || "").trim().toLowerCase();
  if (normalized === "mountain_high_relief") return 1.18;
  if (normalized === "mountain_hills") return 1.02;
  if (normalized === "desert_bare") return 1.1;
  if (normalized === "rainforest" || normalized === "rainforest_tropical") {
    return clamp(0.72 + cfg.rainforestEmphasis * 0.38, 0.2, 1.2);
  }
  if (normalized === "forest" || normalized === "forest_temperate") return 0.95;
  if (normalized === "upland_plateau") return 0.9;
  if (normalized === "badlands_canyon") return 0.98;
  if (normalized === "basin_lowlands") return 0.76;
  if (normalized === "plains_lowlands") return 0.68;
  if (normalized === "grassland_steppe") return 0.8;
  if (normalized === "wetlands_delta") return 0.92;
  if (normalized === "tundra_ice") return 0.85;
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
    getProjectionRenderSignature(),
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

function drawPhysicalAtlasCollectionLayer(
  atlasCollection,
  layerName,
  cfg,
  {
    baseOpacity = 1,
    blendMode = "source-over",
    clipAlreadyApplied = false,
  } = {}
) {
  if (!Array.isArray(atlasCollection?.features) || atlasCollection.features.length === 0) {
    return 0;
  }
  let renderedCount = 0;
  context.save();
  if (!clipAlreadyApplied) {
    applyPhysicalLandClipMask();
  }
  context.globalCompositeOperation = blendMode;
  atlasCollection.features.forEach((feature) => {
    const atlasClass = getPhysicalAtlasClass(feature);
    if (!atlasClass || cfg.atlasClassVisibility?.[atlasClass] === false) return;
    if (getPhysicalAtlasLayer(feature) !== layerName) return;
    if (!pathBoundsInScreen(feature)) return;
    const fillColor = getSafeCanvasColor(PHYSICAL_ATLAS_PALETTE[atlasClass], null);
    if (!fillColor) return;
    context.globalAlpha = clamp(
      baseOpacity * getAtlasFeatureAlphaMultiplier(atlasClass, cfg),
      0,
      1
    );
    context.fillStyle = fillColor;
    context.beginPath();
    pathCanvas(feature);
    context.fill();
    renderedCount += 1;
  });
  context.restore();
  return renderedCount;
}

function drawPhysicalBasePass(k, { interactive = false } = {}) {
  const startedAt = nowMs();
  const cfg = normalizePhysicalStyleConfig(state.styleConfig?.physical);
  const maskInfo = getPhysicalLandMaskInfo();
  if (!state.showPhysical || cfg.mode === "contours_only") {
    collectContextMetric("drawPhysicalBasePass", nowMs() - startedAt, {
      featureCount: 0,
      renderedCount: 0,
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
    collectContextMetric("drawPhysicalBasePass", nowMs() - startedAt, {
      featureCount: 0,
      renderedCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "no-data",
      maskSource: maskInfo.maskSource,
      maskFeatureCount: maskInfo.maskFeatureCount,
      maskArcRefEstimate: maskInfo.maskArcRefEstimate,
    });
    return;
  }

  const presetProfile = getPhysicalPresetRenderProfile(cfg);
  const baseOpacity = clamp(
    cfg.opacity * cfg.atlasOpacity * (interactive ? 0.7 : 1) * cfg.atlasIntensity * presetProfile.reliefOpacityMultiplier,
    0,
    1
  );
  const renderedCount = drawPhysicalAtlasCollectionLayer(atlasCollection, "relief_base", cfg, {
    baseOpacity,
    blendMode: getSafeBlendMode(cfg.blendMode, presetProfile.reliefBlendFallback),
  });
  // Keep the fill-based semantic atlas in the same pass as relief so it stays
  // beneath political fills. Contours remain in contextBase as the lightest
  // readable physical cue above political.
  drawPhysicalAtlasLayer(k, { interactive });
  collectContextMetric("drawPhysicalBasePass", nowMs() - startedAt, {
    featureCount: atlasCollection.features.length,
    renderedCount,
    interactive: !!interactive,
    skipped: renderedCount === 0,
    reason: renderedCount === 0 ? "no-relief-base" : "",
    maskSource: maskInfo.maskSource,
    maskFeatureCount: maskInfo.maskFeatureCount,
    maskArcRefEstimate: maskInfo.maskArcRefEstimate,
  });
}

function drawPhysicalAtlasLayer(k, { interactive = false, clipAlreadyApplied = false } = {}) {
  const startedAt = nowMs();
  const cfg = normalizePhysicalStyleConfig(state.styleConfig?.physical);
  const presetProfile = getPhysicalPresetRenderProfile(cfg);
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

  const semanticOpacity = clamp(
    cfg.opacity * cfg.atlasOpacity * (interactive ? 0.7 : 1) * cfg.atlasIntensity * presetProfile.semanticOpacityMultiplier,
    0,
    1
  );
  const renderedCount = drawPhysicalAtlasCollectionLayer(atlasCollection, "semantic_overlay", cfg, {
    baseOpacity: semanticOpacity,
    blendMode: getSafeBlendMode(cfg.blendMode, presetProfile.semanticBlendMode),
    clipAlreadyApplied,
  });
  collectContextMetric("drawPhysicalAtlasLayer", nowMs() - startedAt, {
    featureCount: atlasCollection.features.length,
    renderedCount,
    interactive: !!interactive,
    skipped: renderedCount === 0,
    reason: renderedCount === 0 ? "no-semantic-overlay" : "",
    maskSource: maskInfo.maskSource,
    maskFeatureCount: maskInfo.maskFeatureCount,
    maskArcRefEstimate: maskInfo.maskArcRefEstimate,
  });
}

function drawContourCollection(
  collection,
  {
    cacheSlot = "major",
    color,
    colorResolver = null,
    opacity,
    width,
    k,
    interactive = false,
    lowReliefCutoff = 0,
    intervalM = 0,
    excludeIntervalM = 0,
    minScreenSpanPx = 0,
    maxFeatures = 0,
  } = {}
) {
  if (!Array.isArray(collection?.features) || collection.features.length === 0) {
    return { drewAny: false, renderedCount: 0, selectedCount: 0 };
  }
  const visibleFeatures = getContourVisibleFeatures(collection, {
    cacheSlot,
    k,
    lowReliefCutoff,
    intervalM,
    excludeIntervalM,
    minScreenSpanPx,
    maxFeatures,
  });
  if (!visibleFeatures.length) return { drewAny: false, renderedCount: 0, selectedCount: 0 };
  const scale = Math.max(0.0001, k);
  context.globalAlpha = interactive ? Math.min(opacity, 0.22) : opacity;
  context.strokeStyle = color;
  context.lineWidth = width / scale;
  context.lineJoin = "round";
  context.lineCap = "round";

  const strokeBatches = new Map();
  visibleFeatures.forEach((feature) => {
    const strokeColor = typeof colorResolver === "function"
      ? getSafeCanvasColor(colorResolver(feature), color)
      : color;
    if (!strokeColor) return;
    if (!strokeBatches.has(strokeColor)) {
      strokeBatches.set(strokeColor, []);
    }
    strokeBatches.get(strokeColor).push(feature);
  });

  let drewAny = false;
  let renderedCount = 0;
  strokeBatches.forEach((features, strokeColor) => {
    if (!Array.isArray(features) || !features.length) return;
    context.strokeStyle = strokeColor;
    context.beginPath();
    features.forEach((feature) => {
      pathCanvas(feature);
    });
    context.stroke();
    drewAny = true;
    renderedCount += features.length;
  });
  return {
    drewAny,
    renderedCount,
    selectedCount: visibleFeatures.length,
  };
}

function drawPhysicalContourLayer(k, { interactive = false, clipAlreadyApplied = false } = {}) {
  const startedAt = nowMs();
  const cfg = normalizePhysicalStyleConfig(state.styleConfig?.physical);
  const presetProfile = getPhysicalPresetRenderProfile(cfg);
  const zoomProfile = getContourZoomStyleProfile(k);
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
      "[physical] global_contours.major.topo.json unavailable or deferred; skipping terrain contours."
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

  const contourColor = getSafeCanvasColor(cfg.contourColor, "#6b5947");
  const majorLowReliefCutoff = clamp(Number(cfg.contourMajorLowReliefCutoffM) || 0, 0, 2000);
  const minorLowReliefCutoff = clamp(Number(cfg.contourMinorLowReliefCutoffM) || 0, 0, 2000);
  const majorOpacity = clamp(
    cfg.opacity * cfg.contourOpacity * presetProfile.majorContourOpacityMultiplier * zoomProfile.majorOpacityMultiplier,
    0,
    1
  );
  const minorOpacity = clamp(
    majorOpacity * presetProfile.minorContourOpacityRatio * zoomProfile.minorOpacityMultiplier,
    0,
    1
  );
  const resolveContourColor = (feature) => getAdaptiveContourStrokeColor(feature, contourColor);
  const majorInterval = clamp(
    (clamp(Number(cfg.contourMajorIntervalM) || 500, 500, 2000) * zoomProfile.majorIntervalMultiplier),
    500,
    6000,
  );
  const minorInterval = clamp(
    (clamp(Number(cfg.contourMinorIntervalM) || 100, 100, 1000) * zoomProfile.minorIntervalMultiplier),
    100,
    3000,
  );

  context.save();
  if (!clipAlreadyApplied) {
    applyPhysicalLandClipMask();
  }
  context.globalCompositeOperation = "source-over";

  const majorDrawResult = drawContourCollection(state.physicalContourMajorData, {
    cacheSlot: "major",
    color: contourColor,
    colorResolver: resolveContourColor,
    opacity: majorOpacity,
    width: clamp((Number(cfg.contourMajorWidth) || 0.8) * zoomProfile.majorWidthMultiplier, 0.2, 3),
    k,
    interactive,
    lowReliefCutoff: majorLowReliefCutoff,
    intervalM: majorInterval,
    minScreenSpanPx: zoomProfile.majorMinScreenSpanPx,
  });

  if (cfg.contourMinorVisible && zoomProfile.minorVisible && k >= presetProfile.minorContourMinZoom) {
    if (Array.isArray(state.physicalContourMinorData?.features) && state.physicalContourMinorData.features.length > 0) {
      const dynamicMinorMaxFeatures = clamp(
        Math.round(
          Number(zoomProfile.minorMaxFeaturesBase || 0)
          + Number(majorDrawResult?.selectedCount || 0) * Number(zoomProfile.minorMaxFeaturesPerMajor || 0)
        ),
        0,
        Number(zoomProfile.minorMaxFeaturesHardCap || 0) || 100000
      );
      drawContourCollection(state.physicalContourMinorData, {
        cacheSlot: "minor",
        color: contourColor,
        colorResolver: resolveContourColor,
        opacity: minorOpacity,
        width: clamp((Number(cfg.contourMinorWidth) || 0.45) * zoomProfile.minorWidthMultiplier, 0.1, 2),
        k,
        interactive,
        lowReliefCutoff: minorLowReliefCutoff,
        intervalM: minorInterval,
        excludeIntervalM: majorInterval,
        minScreenSpanPx: zoomProfile.minorMinScreenSpanPx,
        maxFeatures: dynamicMinorMaxFeatures,
      });
    } else {
        warnMissingPhysicalContextOnce(
          "physical-contours-minor-missing",
          "[physical] global_contours.minor.topo.json unavailable or deferred; skipping minor contours."
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

function shouldForceExactContextBaseRefresh(reuseDecision = null) {
  if (!state.showPhysical) return false;
  if (state.bootBlocking || state.scenarioApplyInFlight || state.startupReadonly || state.startupReadonlyUnlockInFlight) {
    return false;
  }
  const cfg = normalizePhysicalStyleConfig(state.styleConfig?.physical);
  if (!(cfg.mode === "atlas_only" || cfg.mode === "contours_only" || cfg.mode === "atlas_and_contours")) {
    return false;
  }
  const cache = getRenderPassCacheState();
  if (cache.dirty?.physicalBase || cache.dirty?.contextBase) {
    return true;
  }
  const resolvedReuseDecision =
    reuseDecision && typeof reuseDecision === "object"
      ? reuseDecision
      : getContextBaseReuseDecision();
  return !!(resolvedReuseDecision?.crossesMinorContourThreshold || resolvedReuseDecision?.crossesZoomBucket);
}

function getPhysicalExactRefreshPasses() {
  return state.showPhysical ? ["physicalBase", "contextBase"] : ["contextBase"];
}

function getUrbanFeatureOwnerId(feature) {
  const props = feature?.properties || {};
  return String(
    props.country_owner_id ||
    props.countryOwnerId ||
    ""
  ).trim();
}

function getUrbanHostFillColor(feature) {
  const ownerFeatureId = getUrbanFeatureOwnerId(feature);
  if (!ownerFeatureId) return null;
  const hostFeature = state.landIndex?.get(ownerFeatureId);
  if (!hostFeature) return null;
  return (
    getSafeCanvasColor(state.colors?.[ownerFeatureId], null) ||
    getSafeCanvasColor(getResolvedFeatureColor(hostFeature, ownerFeatureId), null)
  );
}

function computeUrbanAdaptivePaintFromHostColor(backgroundColor, config = {}) {
  if (!backgroundColor) return null;
  const luminance = getCanvasColorRelativeLuminance(backgroundColor);
  if (!Number.isFinite(luminance)) return null;

  const strength = clamp(Number(config.adaptiveStrength) || 0, 0, 1);
  const toneBias = clamp(Number(config.toneBias) || 0, -0.3, 0.3);
  const lightenBias = Math.max(toneBias, 0);
  const deepenBias = Math.max(-toneBias, 0);
  const isDark = luminance <= 0.30;
  const isLight = luminance >= 0.62;

  if (isDark) {
    return {
      fillColor: mixCanvasColors(
        backgroundColor,
        "#f4efe3",
        clamp(0.48 + (strength * 0.18) + (lightenBias * 0.56) - (deepenBias * 0.24), 0.18, 0.96)
      ),
      strokeColor: mixCanvasColors(
        backgroundColor,
        "#fff9ef",
        clamp(0.66 + (strength * 0.14) + (lightenBias * 0.44) - (deepenBias * 0.18), 0.24, 0.98)
      ),
    };
  }
  if (isLight) {
    return {
      fillColor: mixCanvasColors(
        backgroundColor,
        "#20252b",
        clamp(0.42 + (strength * 0.16) + (deepenBias * 0.34) - (lightenBias * 0.28), 0.16, 0.94)
      ),
      strokeColor: mixCanvasColors(
        backgroundColor,
        "#0f1419",
        clamp(0.62 + (strength * 0.12) + (deepenBias * 0.26) - (lightenBias * 0.18), 0.22, 0.96)
      ),
    };
  }
  const targetFill = luminance < 0.48 ? "#ede7da" : "#272d34";
  const targetStroke = luminance < 0.48 ? "#fff7ec" : "#10151a";
  return {
    fillColor: mixCanvasColors(
      backgroundColor,
      targetFill,
      clamp(0.46 + (strength * 0.16) + (luminance < 0.48 ? (lightenBias * 0.42) - (deepenBias * 0.18) : (deepenBias * 0.26) - (lightenBias * 0.22)), 0.18, 0.95)
    ),
    strokeColor: mixCanvasColors(
      backgroundColor,
      targetStroke,
      clamp(0.66 + (strength * 0.12) + (luminance < 0.48 ? (lightenBias * 0.3) - (deepenBias * 0.14) : (deepenBias * 0.22) - (lightenBias * 0.16)), 0.24, 0.97)
    ),
  };
}

function getUrbanAdaptivePaint(feature, config = {}) {
  const backgroundColor = getUrbanHostFillColor(feature);
  return computeUrbanAdaptivePaintFromHostColor(backgroundColor, config);
}

function getEffectiveUrbanMode(config = {}, capability = state.urbanLayerCapability) {
  return config?.mode === "adaptive" && capability?.adaptiveAvailable ? "adaptive" : "manual";
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
  const cfg = normalizeUrbanStyleConfig(state.styleConfig?.urban || {});
  const capability = state.urbanLayerCapability || getUrbanLayerCapability(state.urbanData);
  const effectiveMode = getEffectiveUrbanMode(cfg, capability);
  const manualColor = getSafeCanvasColor(cfg.color, "#4b5563");
  const fillOpacity = clamp(Number.isFinite(Number(cfg.fillOpacity)) ? Number(cfg.fillOpacity) : 0.34, 0, 1);
  const strokeOpacity = clamp(Number.isFinite(Number(cfg.strokeOpacity)) ? Number(cfg.strokeOpacity) : 0.62, 0, 1);
  const minAreaPx = clamp(Number.isFinite(Number(cfg.minAreaPx)) ? Number(cfg.minAreaPx) : 8, 0, 80);
  const blendMode = effectiveMode === "manual"
    ? getSafeBlendMode(cfg.blendMode, "multiply")
    : "source-over";
  const strokeWidth = clamp(0.85 / Math.max(Math.sqrt(Math.max(Number(k) || 1, 1)), 1), 0.3, 0.85);

  context.save();
  context.globalCompositeOperation = blendMode;
  state.urbanData.features.forEach((feature) => {
    if (minAreaPx > 0 && estimateProjectedAreaPx(feature, k) < minAreaPx) return;
    if (!pathBoundsInScreen(feature)) return;
    const adaptivePaint = effectiveMode === "adaptive" ? getUrbanAdaptivePaint(feature, cfg) : null;
    const fillColor = getSafeCanvasColor(adaptivePaint?.fillColor, manualColor);
    const outlineColor = getSafeCanvasColor(adaptivePaint?.strokeColor, null);
    if (!fillColor) return;
    context.beginPath();
    pathCanvas(feature);
    context.fillStyle = fillColor;
    context.globalAlpha = interactive ? Math.min(fillOpacity, 0.15) : fillOpacity;
    context.fill();
    if (effectiveMode === "adaptive" && outlineColor) {
      context.strokeStyle = outlineColor;
      context.lineWidth = strokeWidth;
      context.globalAlpha = interactive ? Math.min(strokeOpacity, 0.18) : strokeOpacity;
      context.stroke();
    }
  });

  context.restore();
  collectContextMetric("drawUrbanLayer", nowMs() - startedAt, {
    featureCount: getFeatureCollectionFeatureCount(state.urbanData),
    interactive: !!interactive,
    skipped: false,
    mode: effectiveMode,
    requestedMode: cfg.mode,
    adaptiveAvailable: !!capability?.adaptiveAvailable,
  });
}

function getRiverZoomStyleFactors(k) {
  return RIVER_ZOOM_STYLE_FACTORS[getContextBaseZoomBucketId(k)] || RIVER_ZOOM_STYLE_FACTORS.mid;
}

function getRiverClassKind(feature) {
  const props = feature?.properties || {};
  const featureClass = String(props.featurecla || props.FEATURECLA || "").trim().toLowerCase();
  switch (featureClass) {
    case "river":
      return "river";
    case "river (intermittent)":
      return "intermittent";
    case "lake centerline":
      return "lakeCenterline";
    case "canal":
      return "canal";
    default:
      return "unknown";
  }
}

function getRiverVisibilityProfile(feature, k) {
  const props = feature?.properties || {};
  const zoomBucket = getContextBaseZoomBucketId(k);
  const classKind = getRiverClassKind(feature);
  const scalerank = clamp(
    Math.round(Number(props.scalerank ?? props.SCALERANK ?? 8)) || 8,
    0,
    12,
  );
  const minZoom = Number(props.min_zoom ?? props.minZoom);
  let visible = false;

  if (zoomBucket === "low") {
    visible = classKind === "river" && scalerank <= RIVER_LOW_MAX_SCALERANK;
  } else if (zoomBucket === "mid") {
    visible = classKind === "river"
      && (
        scalerank <= RIVER_MID_MAX_SCALERANK
        || (
          scalerank === RIVER_MID_MAX_SCALERANK + 1
          && Number.isFinite(minZoom)
          && minZoom <= 5
        )
      );
  } else {
    visible = classKind !== "unknown";
  }

  const classStyle = RIVER_CLASS_STYLE_FACTORS[classKind] || RIVER_CLASS_STYLE_FACTORS.unknown;
  return {
    visible,
    zoomBucket,
    classKind,
    scalerank,
    minZoom: Number.isFinite(minZoom) ? minZoom : null,
    widthFactor: classStyle.widthFactor,
    opacityFactor: classStyle.opacityFactor,
    outlineFactor: classStyle.outlineFactor,
  };
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
  const widthBase = clamp(Number.isFinite(Number(cfg.width)) ? Number(cfg.width) : 0.5, 0.2, 4);
  const outlineColor = getSafeCanvasColor(cfg.outlineColor, "#e2efff");
  const outlineWidth = clamp(Number.isFinite(Number(cfg.outlineWidth)) ? Number(cfg.outlineWidth) : 0.25, 0, 3);
  const dashPattern = getDashPattern(cfg.dashStyle, widthBase);
  const scale = Math.max(0.0001, k);
  const zoomStyle = getRiverZoomStyleFactors(k);
  const visibleEntries = [];

  state.riversData.features.forEach((feature) => {
    if (!pathBoundsInScreen(feature)) return;
    const profile = getRiverVisibilityProfile(feature, k);
    if (!profile.visible) return;
    visibleEntries.push({ feature, profile });
  });

  context.save();

  if (outlineWidth > 0) {
    context.strokeStyle = outlineColor;
    context.lineCap = "round";
    context.lineJoin = "round";
    context.setLineDash([]);
    visibleEntries.forEach(({ feature, profile }) => {
      const resolvedOutlineWidth = outlineWidth
        * zoomStyle.outlineWidthFactor
        * profile.outlineFactor;
      if (!(resolvedOutlineWidth > 0)) return;
      const resolvedCoreWidth = widthBase
        * zoomStyle.coreWidthFactor
        * profile.widthFactor;
      const outlineAlpha = opacity
        * zoomStyle.outlineAlphaFactor
        * profile.opacityFactor;
      context.globalAlpha = interactive ? Math.min(outlineAlpha * 0.7, 0.65) : Math.min(outlineAlpha, 0.95);
      context.lineWidth = (resolvedCoreWidth + resolvedOutlineWidth * 2) / scale;
      context.beginPath();
      pathCanvas(feature);
      context.stroke();
    });
  }

  context.strokeStyle = color;
  context.lineCap = "round";
  context.lineJoin = "round";
  context.setLineDash(dashPattern);
  visibleEntries.forEach(({ feature, profile }) => {
    const resolvedCoreWidth = widthBase
      * zoomStyle.coreWidthFactor
      * profile.widthFactor;
    context.globalAlpha = interactive
      ? Math.min(opacity * profile.opacityFactor, 0.78)
      : opacity * profile.opacityFactor;
    context.lineWidth = resolvedCoreWidth / scale;
    context.beginPath();
    pathCanvas(feature);
    context.stroke();
  });
  context.setLineDash([]);

  context.restore();
  collectContextMetric("drawRiversLayer", nowMs() - startedAt, {
    featureCount: getFeatureCollectionFeatureCount(state.riversData),
    visibleFeatureCount: visibleEntries.length,
    zoomBucket: getContextBaseZoomBucketId(k),
    coreWidthFactor: zoomStyle.coreWidthFactor,
    outlineWidthFactor: zoomStyle.outlineWidthFactor,
    outlineAlphaFactor: zoomStyle.outlineAlphaFactor,
    interactive: !!interactive,
    skipped: false,
  });
}

function getCityFeatureKey(feature, fallbackKey = "") {
  const props = feature?.properties || {};
  return String(
    props.__city_stable_key
    || props.stable_key
    || props.__city_id
    || props.id
    || feature?.id
    || fallbackKey
    || ""
  ).trim();
}

function getCityFeatureAliases(feature, key = "") {
  const props = feature?.properties || {};
  const aliases = new Set([
    key,
    props.__city_stable_key,
    props.stable_key,
    props.__city_id,
    props.id,
    props.name,
    props.label,
    props.name_en,
    props.label_en,
    props.name_zh,
    props.label_zh,
  ].filter(Boolean).map((value) => String(value).trim()));
  const extraAliases = Array.isArray(props.__city_aliases) ? props.__city_aliases : [];
  extraAliases.forEach((value) => {
    const alias = String(value || "").trim();
    if (alias) aliases.add(alias);
  });
  return Array.from(aliases);
}

function normalizeCityLabelComparisonValue(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function getCityRawLanguageLabel(feature, language = state.currentLanguage) {
  const props = feature?.properties || {};
  if (String(language || "en").trim().toLowerCase() === "zh") {
    return String(props.label_zh || props.name_zh || props.label_cn || props.name_cn || "").trim();
  }
  return String(props.label_en || props.name_en || props.label || props.name || "").trim();
}

function getCityOverrideDisplayLabel(feature) {
  const props = feature?.properties || {};
  if (!props.__city_has_display_name_override) {
    return "";
  }
  const displayName = props.__city_display_name_override && typeof props.__city_display_name_override === "object"
    ? props.__city_display_name_override
    : {};
  return String(
    state.currentLanguage === "zh"
      ? (displayName.zh || "")
      : (displayName.en || "")
  ).trim();
}

function getCityBaseLocalizedLabel(feature, { strict = false } = {}) {
  const props = feature?.properties || {};
  const baseCandidates = [
    props.__city_stable_key,
    props.stable_key,
    props.__city_id,
    props.id,
    props.name,
    props.label,
    props.name_en,
    props.label_en,
    props.name_zh,
    props.label_zh,
  ];
  const aliases = Array.isArray(props.__city_aliases) ? props.__city_aliases : [];
  return strict
    ? getStrictGeoLabel([...baseCandidates, ...aliases], "")
    : getPreferredGeoLabel([...baseCandidates, ...aliases], "");
}

function isAdministrativeCityLabelCandidate(label = "") {
  const normalizedLabel = String(label || "").trim();
  if (!normalizedLabel) return false;
  return CITY_ADMIN_LABEL_REJECT_PATTERNS.some((pattern) => pattern.test(normalizedLabel));
}

function getCityHostFeatureDisplayLabel(feature) {
  const props = feature?.properties || {};
  const hostFeatureId = String(props.__city_host_feature_id || "").trim();
  if (!hostFeatureId) return "";
  const hostLabel = getStrictGeoLabel(hostFeatureId, "");
  if (!hostLabel || isAdministrativeCityLabelCandidate(hostLabel)) {
    return "";
  }
  return hostLabel;
}

function getCityRawFallbackLabel(feature) {
  const props = feature?.properties || {};
  const currentLanguageLabel = getCityRawLanguageLabel(feature, state.currentLanguage);
  if (currentLanguageLabel) {
    return currentLanguageLabel;
  }
  const alternateLanguageLabel = getCityRawLanguageLabel(feature, state.currentLanguage === "zh" ? "en" : "zh");
  if (alternateLanguageLabel) {
    return alternateLanguageLabel;
  }
  const localeEntry = props.__city_locale && typeof props.__city_locale === "object" ? props.__city_locale : {};
  return String(
    state.currentLanguage === "zh"
      ? (localeEntry.zh || localeEntry.en || props.label_zh || props.name_zh || props.label || props.name || props.__city_id || feature?.id || "")
      : (localeEntry.en || localeEntry.zh || props.label_en || props.name_en || props.label || props.name || props.__city_id || feature?.id || "")
  ).trim();
}

function getCityDisplayLabel(feature) {
  const overrideLabel = getCityOverrideDisplayLabel(feature);
  if (overrideLabel) {
    return overrideLabel;
  }
  const baseStrict = getCityBaseLocalizedLabel(feature, { strict: true });
  const baseFallback = getCityBaseLocalizedLabel(feature);
  const rawFallback = getCityRawFallbackLabel(feature);
  const hostFeatureLabel = getCityHostFeatureDisplayLabel(feature);
  const hostComparison = normalizeCityLabelComparisonValue(hostFeatureLabel);
  const baseComparison = normalizeCityLabelComparisonValue(baseStrict || baseFallback || rawFallback);
  if (hostComparison && hostComparison !== baseComparison) {
    return hostFeatureLabel;
  }
  if (baseStrict) {
    return baseStrict;
  }
  if (baseFallback) {
    return baseFallback;
  }
  return rawFallback;
}

function cleanCityMapLabelText(label = "") {
  const rawLabel = String(label || "").trim();
  if (!rawLabel) return "";
  let cleaned = rawLabel
    .replace(/\s*\(([^)]*)\)\s*/g, " ")
    .replace(/\s*,\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  CITY_ADMIN_LABEL_PATTERNS.forEach((pattern) => {
    cleaned = cleaned.replace(pattern, " ").replace(/\s+/g, " ").trim();
  });
  cleaned = cleaned.replace(/^[\s,;:-]+|[\s,;:-]+$/g, "").trim();
  return cleaned.length >= 3 ? cleaned : rawLabel;
}

function isCjkText(value = "") {
  return /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/u.test(String(value || ""));
}

function abbreviateCityMapLabel(label = "") {
  const rawLabel = String(label || "").trim();
  if (!rawLabel || isCjkText(rawLabel) || !/[\s-]/u.test(rawLabel)) {
    return rawLabel;
  }
  const segments = rawLabel.split(/([\s-]+)/u);
  let wordIndex = 0;
  return segments.map((segment) => {
    if (!segment || /^[\s-]+$/u.test(segment)) {
      return segment;
    }
    wordIndex += 1;
    if (wordIndex === 1) {
      return segment;
    }
    const firstGlyph = Array.from(segment)[0] || "";
    return firstGlyph ? `${firstGlyph}.` : segment;
  }).join("").replace(/\s+/g, " ").trim();
}

function truncateCityLabelToWidth(text = "", maxWidthPx = 0, measureWidth = () => 0) {
  const rawText = String(text || "").trim();
  if (!rawText) return "";
  if (measureWidth(rawText) <= maxWidthPx) {
    return rawText;
  }
  const glyphs = Array.from(rawText);
  if (glyphs.length <= 4) {
    return rawText;
  }
  let truncated = rawText;
  while (glyphs.length > 4) {
    glyphs.pop();
    truncated = `${glyphs.join("")}\u2026`;
    if (measureWidth(truncated) <= maxWidthPx) {
      return truncated;
    }
  }
  return truncated;
}

function getCityMapLabelMaxWidth(entry, config = {}) {
  const densityKey = String(config.labelDensity || "balanced").trim().toLowerCase();
  const widthTable = CITY_LABEL_MAX_WIDTH_PX[densityKey] || CITY_LABEL_MAX_WIDTH_PX.balanced;
  const widthKey = entry?.isCapital ? "capital" : (String(entry?.cityTier || "minor").trim().toLowerCase());
  return Number(widthTable[widthKey] || widthTable.minor || 132);
}

function formatCityMapLabel(fullLabel, { entry = null, context: labelContext = null, config = {}, scale = 1 } = {}) {
  const rawLabel = String(fullLabel || "").trim();
  if (!rawLabel || !labelContext?.measureText) {
    return rawLabel;
  }
  const maxWidthPx = getCityMapLabelMaxWidth(entry, config);
  const measureWidth = (candidate) => Number(labelContext.measureText(String(candidate || "")).width || 0) * scale;
  const cleanedLabel = cleanCityMapLabelText(rawLabel);
  if (cleanedLabel && measureWidth(cleanedLabel) <= maxWidthPx) {
    return cleanedLabel;
  }
  const abbreviatedLabel = abbreviateCityMapLabel(cleanedLabel || rawLabel);
  if (abbreviatedLabel && measureWidth(abbreviatedLabel) <= maxWidthPx) {
    return abbreviatedLabel;
  }
  return truncateCityLabelToWidth(abbreviatedLabel || cleanedLabel || rawLabel, maxWidthPx, measureWidth);
}

function getCityCanonicalId(feature) {
  const props = feature?.properties || {};
  return String(props.__city_id || props.id || feature?.id || "").trim();
}

function getCityTier(feature) {
  const props = feature?.properties || {};
  const tier = String(props.__city_base_tier || props.base_tier || props.baseTier || "").trim().toLowerCase();
  if (tier === "major" || tier === "regional" || tier === "minor") {
    return tier;
  }
  return "minor";
}

function getCityTierWeight(feature) {
  switch (getCityTier(feature)) {
    case "major":
      return 3;
    case "regional":
      return 2;
    default:
      return 1;
  }
}

function getDefaultCityMinZoomForTier(tier) {
  switch (String(tier || "").trim().toLowerCase()) {
    case "major":
      return 0.8;
    case "regional":
      return 1.6;
    default:
      return 2.9;
  }
}

function getCityEffectiveMinZoom(feature) {
  const props = feature?.properties || {};
  const explicit = Number(props.__city_min_zoom ?? props.min_zoom ?? props.minZoom);
  if (Number.isFinite(explicit)) return explicit;
  return getDefaultCityMinZoomForTier(getCityTier(feature));
}

function getUrbanFeatureStableId(feature) {
  const directId = String(feature?.id ?? "").trim();
  if (directId) return directId;
  const props = feature?.properties || {};
  return String(props.id ?? props.ID ?? "").trim();
}

function getUrbanFeatureIndex() {
  const urbanCollection = state.urbanData;
  if (urbanFeatureIndexCache.sourceRef === urbanCollection) {
    return urbanFeatureIndexCache.byId;
  }
  const byId = new Map();
  if (Array.isArray(urbanCollection?.features)) {
    urbanCollection.features.forEach((feature) => {
      const urbanId = getUrbanFeatureStableId(feature);
      if (urbanId) {
        byId.set(urbanId, feature);
      }
    });
  }
  urbanFeatureIndexCache.sourceRef = urbanCollection;
  urbanFeatureIndexCache.byId = byId;
  return byId;
}

function getCityUrbanRuntimeInfo(feature, urbanIndex = getUrbanFeatureIndex()) {
  const props = feature?.properties || {};
  const urbanMatchId = String(
    props.__city_urban_match_id
    || props.urban_match_id
    || props.urban_area_id
    || props.urbanMatchId
    || props.urbanAreaId
    || ""
  ).trim();
  const urbanMatchMethod = String(
    props.urban_match_method
    || props.urbanMatchMethod
    || ""
  ).trim().toLowerCase();
  const urbanFeature = urbanMatchId ? (urbanIndex.get(urbanMatchId) || null) : null;
  return {
    urbanMatchId,
    urbanFeature,
    hasUrbanMatch: !!urbanFeature,
    urbanMatchMethod,
  };
}

function getCityRadiusMultiplier(feature) {
  switch (getCityTier(feature)) {
    case "major":
      return 1.45;
    case "regional":
      return 1.1;
    default:
      return 0.85;
  }
}

function getCityCapitalScore(feature) {
  const props = feature?.properties || {};
  if (props.__city_is_country_capital) return 3;
  if (props.__city_is_admin_capital) return 2;
  if (props.__city_is_capital) return 1;
  return 0;
}

function getCitySortWeight(feature) {
  const props = feature?.properties || {};
  const population = Math.max(0, Number(props.__city_population || 0));
  return (
    (props.__city_is_capital ? 2_000_000_000 : 0)
    + (getCityTierWeight(feature) * 250_000_000)
    + population
  );
}

function getCityMarkerThemeTokens(config = {}) {
  const themeKey = String(config.theme || CITY_MARKER_THEME_GRAPHITE).trim().toLowerCase();
  const baseTokens = CITY_MARKER_THEME_TOKENS[themeKey] || CITY_MARKER_THEME_TOKENS.classic_graphite;
  return {
    ...baseTokens,
    fillBottom: getSafeCanvasColor(config.color, baseTokens.fillBottom),
    capitalAccent: getSafeCanvasColor(config.capitalColor, baseTokens.capitalAccent),
  };
}

function getCityCountryGroupKey(feature) {
  const props = feature?.properties || {};
  const scenarioTag = getCityScenarioTag(feature);
  if (scenarioTag) return `tag:${scenarioTag}`;
  const countryCode = String(props.__city_country_code || props.country_code || "").trim().toUpperCase();
  if (countryCode) return `cc:${countryCode}`;
  const hostFeatureId = String(props.__city_host_feature_id || props.host_feature_id || "").trim();
  if (hostFeatureId) return `host:${hostFeatureId}`;
  return `city:${getCityCanonicalId(feature) || getCityFeatureKey(feature)}`;
}

function getScenarioFeaturedTagSet() {
  return new Set(
    Array.isArray(state.activeScenarioManifest?.featured_tags)
      ? state.activeScenarioManifest.featured_tags
        .map((value) => String(value || "").trim().toUpperCase())
        .filter(Boolean)
      : []
  );
}

function getCityCountryTierFromScenarioRecord(profile, record, { defaultCountry = "", featuredTags = new Set() } = {}) {
  if (!record || typeof record !== "object") return "";
  const tag = String(profile?.scenarioTag || "").trim().toUpperCase();
  const entryKind = String(record.entry_kind || record.entryKind || "").trim().toLowerCase();
  const controllerFeatureCount = Math.max(
    0,
    Number(record.controller_feature_count ?? record.controllerFeatureCount ?? 0) || 0
  );
  const isFeatured = !!record.featured || featuredTags.has(tag);
  if (entryKind === "controller_only" || controllerFeatureCount <= 0) {
    return "E";
  }
  if (
    tag === defaultCountry
    || (isFeatured && controllerFeatureCount >= 40)
    || (!isFeatured && controllerFeatureCount >= 150)
  ) {
    return "A";
  }
  if ((isFeatured && controllerFeatureCount < 40) || (!isFeatured && controllerFeatureCount >= 40)) {
    return "B";
  }
  if (controllerFeatureCount >= 12) return "C";
  if (controllerFeatureCount >= 1) return "D";
  return "E";
}

function getFallbackCityCountryTier(profile) {
  const maxPopulation = Math.max(0, Number(profile?.maxPopulation || 0));
  if ((profile?.hasCountryCapital && maxPopulation >= 2_500_000) || maxPopulation >= 5_000_000) {
    return "A";
  }
  if (profile?.hasCountryCapital || maxPopulation >= 1_500_000) {
    return "B";
  }
  if (maxPopulation >= 350_000) {
    return "C";
  }
  if ((profile?.featureCount || 0) > 0) {
    return "D";
  }
  return "E";
}

function getCityCountryProfileIndex(cityCollection) {
  if (!cityCollection?.features?.length) {
    return new Map();
  }
  const cached = cityCountryProfileCache.get(cityCollection);
  if (cached) {
    return cached;
  }

  const profiles = new Map();
  cityCollection.features.forEach((feature) => {
    const props = feature?.properties || {};
    const groupKey = getCityCountryGroupKey(feature);
    let profile = profiles.get(groupKey);
    if (!profile) {
      profile = {
        groupKey,
        scenarioTag: getCityScenarioTag(feature),
        countryCode: String(props.__city_country_code || props.country_code || "").trim().toUpperCase(),
        featureCount: 0,
        hasCapital: false,
        hasCountryCapital: false,
        maxPopulation: 0,
        maxTierWeight: 0,
      };
      profiles.set(groupKey, profile);
    }
    profile.featureCount += 1;
    profile.hasCapital = profile.hasCapital || !!props.__city_is_capital;
    profile.hasCountryCapital = profile.hasCountryCapital || !!props.__city_is_country_capital;
    profile.maxPopulation = Math.max(profile.maxPopulation, Math.max(0, Number(props.__city_population || 0)));
    profile.maxTierWeight = Math.max(profile.maxTierWeight, getCityTierWeight(feature));
  });

  const featuredTags = getScenarioFeaturedTagSet();
  const defaultCountry = String(state.activeScenarioManifest?.default_country || "")
    .trim()
    .toUpperCase();
  profiles.forEach((profile) => {
    const record = profile.scenarioTag ? state.scenarioCountriesByTag?.[profile.scenarioTag] : null;
    profile.countryTier = getCityCountryTierFromScenarioRecord(profile, record, {
      defaultCountry,
      featuredTags,
    }) || getFallbackCityCountryTier(profile);
    profile.countryTierRank = CITY_COUNTRY_TIER_RANK[profile.countryTier] || 0;
  });

  cityCountryProfileCache.set(cityCollection, profiles);
  return profiles;
}

function getCityRevealPhase(scale) {
  const normalizedScale = Math.max(0.0001, Number(scale || 1));
  return CITY_REVEAL_PHASES.find((phase) => normalizedScale >= phase.minScale && normalizedScale < phase.maxScale)
    || CITY_REVEAL_PHASES[CITY_REVEAL_PHASES.length - 1];
}

function getCityRevealBucket(entry, phaseId) {
  const countryTier = String(entry?.countryTier || "D").trim().toUpperCase();
  const cityTier = String(entry?.cityTier || "minor").trim().toLowerCase();
  const isCapital = !!entry?.isCapital;
  switch (String(phaseId || "P0")) {
    case "P0":
      return countryTier === "A" && isCapital ? 0 : Number.POSITIVE_INFINITY;
    case "P1":
      if ((countryTier === "A" || countryTier === "B") && isCapital) return 0;
      if ((countryTier === "C" || countryTier === "D") && isCapital) return 1;
      if (countryTier === "E" && isCapital) return 2;
      return Number.POSITIVE_INFINITY;
    case "P2":
      if ((countryTier === "A" || countryTier === "B") && isCapital) return 0;
      if ((countryTier === "C" || countryTier === "D") && isCapital) return 1;
      if (countryTier === "E" && isCapital) return 2;
      if (countryTier === "A" && cityTier === "major") return 3;
      return Number.POSITIVE_INFINITY;
    case "P3":
      if ((countryTier === "A" || countryTier === "B") && isCapital) return 0;
      if ((countryTier === "C" || countryTier === "D") && isCapital) return 1;
      if (countryTier === "E" && isCapital) return 2;
      if (countryTier === "A" && cityTier === "major") return 3;
      if (countryTier === "B" && cityTier === "major") return 4;
      return Number.POSITIVE_INFINITY;
    case "P4":
      if ((countryTier === "A" || countryTier === "B") && isCapital) return 0;
      if ((countryTier === "C" || countryTier === "D") && isCapital) return 1;
      if (countryTier === "E" && isCapital) return 2;
      if (countryTier === "A" && cityTier === "major") return 3;
      if (countryTier === "B" && cityTier === "major") return 4;
      if ((countryTier === "A" || countryTier === "B" || countryTier === "C") && (cityTier === "regional" || cityTier === "major")) {
        return 5;
      }
      return Number.POSITIVE_INFINITY;
    case "P5":
    default:
      if ((countryTier === "A" || countryTier === "B") && isCapital) return 0;
      if ((countryTier === "C" || countryTier === "D") && isCapital) return 1;
      if (countryTier === "E" && isCapital) return 2;
      if (cityTier === "major") return 3;
      if (cityTier === "regional") return 4;
      if (countryTier !== "E" && cityTier === "minor") return 5;
      return Number.POSITIVE_INFINITY;
  }
}

function getCityMarkerQuotaForTier(phaseId, countryTier) {
  const phaseQuotas = {
    P0: { A: 1, B: 1, C: 1, D: 1, E: 0 },
    P1: { A: 1, B: 1, C: 1, D: 1, E: 1 },
    P2: { A: 3, B: 1, C: 0, D: 0, E: 0 },
    P3: { A: 4, B: 2, C: 1, D: 1, E: 1 },
    P4: { A: 6, B: 4, C: 2, D: 1, E: 1 },
    P5: { A: 8, B: 6, C: 4, D: 2, E: 1 },
  };
  const quotaTable = phaseQuotas[String(phaseId || "P0")] || phaseQuotas.P0;
  return quotaTable[String(countryTier || "D").trim().toUpperCase()] ?? 0;
}

function compareCityRevealEntries(left, right) {
  const leftBucket = Number(left?.revealBucket ?? Number.POSITIVE_INFINITY);
  const rightBucket = Number(right?.revealBucket ?? Number.POSITIVE_INFINITY);
  if (leftBucket !== rightBucket) return leftBucket - rightBucket;
  const leftCountryRank = Number(left?.countryTierRank || 0);
  const rightCountryRank = Number(right?.countryTierRank || 0);
  if (leftCountryRank !== rightCountryRank) return rightCountryRank - leftCountryRank;
  if (!!left?.isCapital !== !!right?.isCapital) return left?.isCapital ? -1 : 1;
  const leftTierWeight = Number(left?.cityTierWeight || 0);
  const rightTierWeight = Number(right?.cityTierWeight || 0);
  if (leftTierWeight !== rightTierWeight) return rightTierWeight - leftTierWeight;
  const leftPopulation = Math.max(0, Number(left?.population || 0));
  const rightPopulation = Math.max(0, Number(right?.population || 0));
  if (leftPopulation !== rightPopulation) return rightPopulation - leftPopulation;
  return String(left?.cityId || "").localeCompare(String(right?.cityId || ""));
}

function getCityLabelBudget(phase, config = {}) {
  const densityKey = String(config.labelDensity || "balanced").trim().toLowerCase();
  const budgetTable = CITY_LABEL_DENSITY_BUDGETS[densityKey] || CITY_LABEL_DENSITY_BUDGETS.balanced;
  const phaseId = String(phase?.id || "");
  if (Object.prototype.hasOwnProperty.call(budgetTable, phaseId)) {
    return Math.max(0, Number(budgetTable[phaseId] || 0));
  }
  return Math.max(0, Number(phase?.labelBudget || 0));
}

function isCityLabelEligibleForPhase(entry, phaseId) {
  const cityTier = String(entry?.cityTier || "minor").trim().toLowerCase();
  if (String(phaseId || "P0") === "P4") {
    return !!entry?.isCapital || cityTier === "major";
  }
  if (String(phaseId || "P0") === "P5") {
    return true;
  }
  return false;
}

function getCityMarkerSizePx(entry, config = {}) {
  const cityTier = String(entry?.cityTier || "minor").trim().toLowerCase();
  const markerScale = clamp(Number(config.markerScale) || 1, 0.75, 1.4);
  const legacyScale = clamp((Number(config.radius) || 3.2) / 3.2, 0.75, 1.3);
  const baseSize = CITY_MARKER_BASE_SIZES_PX[cityTier] || CITY_MARKER_BASE_SIZES_PX.minor;
  const hardLimit = CITY_MARKER_SIZE_LIMITS_PX[cityTier] || CITY_MARKER_SIZE_LIMITS_PX.minor;
  const capitalLimit = entry?.isCapital ? CITY_MARKER_SIZE_LIMITS_PX.capital : hardLimit;
  const boostedSize = entry?.isCapital ? baseSize * 1.08 : baseSize;
  return Math.min(capitalLimit, boostedSize * markerScale * legacyScale);
}

function createCityMarkerSpriteCanvas(width, height) {
  if (typeof OffscreenCanvas === "function") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document !== "undefined" && typeof document.createElement === "function") {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    return canvas;
  }
  return null;
}

function getCityMarkerVisualSpec(entry, config = {}) {
  const sizePx = Math.max(4, Number(entry?.markerSizePx || getCityMarkerSizePx(entry, config)));
  const cityTier = String(entry?.cityTier || "minor").trim().toLowerCase();
  const tierScale = cityTier === "major" ? 1.18 : cityTier === "regional" ? 1 : 0.84;
  const discRadius = Math.max(3.2, sizePx * (cityTier === "major" ? 0.62 : cityTier === "regional" ? 0.56 : 0.5));
  const discHeight = Math.max(3.4, sizePx * (cityTier === "major" ? 0.66 : cityTier === "regional" ? 0.58 : 0.5));
  const widthPx = Math.max(18, Math.ceil(discRadius * 2.8 * tierScale));
  const heightPx = Math.max(16, Math.ceil((discHeight * 1.9) + (sizePx * 0.34)));
  const capitalTopExtra = entry?.isCapital ? Math.ceil(sizePx * 0.86) : 0;
  return {
    sizePx,
    cityTier,
    discRadius,
    discHeight,
    widthPx,
    heightPx,
    capitalTopExtra,
  };
}

function renderCityMarkerSprite(spriteContext, spec, tokens, entry) {
  const { sizePx, discRadius, discHeight, widthPx, heightPx, capitalTopExtra } = spec;
  const cx = widthPx / 2;
  const centerY = capitalTopExtra + Math.max(discHeight + (sizePx * 0.26), (heightPx * 0.56));
  const topY = centerY - discHeight;
  const bottomY = centerY + discHeight;
  const baseShadowY = centerY + (discHeight * 0.78);
  const bodyGradient = spriteContext.createLinearGradient(0, topY, 0, bottomY);
  bodyGradient.addColorStop(0, tokens.fillTop);
  bodyGradient.addColorStop(0.55, tokens.fillMid || tokens.fillTop);
  bodyGradient.addColorStop(1, tokens.fillBottom);

  spriteContext.save();
  spriteContext.lineJoin = "round";
  spriteContext.lineCap = "round";

  spriteContext.beginPath();
  spriteContext.ellipse(cx, baseShadowY, discRadius * 0.98, Math.max(1.5, discHeight * 0.46), 0, 0, Math.PI * 2);
  spriteContext.fillStyle = tokens.baseShadow;
  spriteContext.fill();

  spriteContext.beginPath();
  spriteContext.ellipse(cx, centerY, discRadius, discHeight, 0, 0, Math.PI * 2);
  spriteContext.fillStyle = bodyGradient;
  spriteContext.fill();
  spriteContext.strokeStyle = tokens.stroke;
  spriteContext.lineWidth = Math.max(1, sizePx * 0.08);
  spriteContext.stroke();

  spriteContext.save();
  spriteContext.globalCompositeOperation = "multiply";
  const rimGradient = spriteContext.createLinearGradient(cx, centerY - discHeight, cx, centerY + discHeight);
  rimGradient.addColorStop(0, "rgba(0, 0, 0, 0)");
  rimGradient.addColorStop(0.58, "rgba(0, 0, 0, 0)");
  rimGradient.addColorStop(1, tokens.rimDark || tokens.fillBottom);
  spriteContext.beginPath();
  spriteContext.ellipse(cx, centerY, discRadius, discHeight, 0, 0, Math.PI * 2);
  spriteContext.fillStyle = rimGradient;
  spriteContext.fill();
  spriteContext.restore();

  spriteContext.save();
  spriteContext.globalCompositeOperation = "screen";
  spriteContext.beginPath();
  spriteContext.ellipse(cx - (discRadius * 0.18), centerY - (discHeight * 0.36), discRadius * 0.52, discHeight * 0.3, -0.25, 0, Math.PI * 2);
  spriteContext.fillStyle = tokens.highlight;
  spriteContext.fill();
  spriteContext.beginPath();
  spriteContext.ellipse(cx + (discRadius * 0.08), centerY - (discHeight * 0.1), discRadius * 0.78, discHeight * 0.52, 0, Math.PI, Math.PI * 2);
  spriteContext.fillStyle = tokens.specular || tokens.highlight;
  spriteContext.fill();
  spriteContext.restore();

  if (entry?.isCapital) {
    const crownY = topY - (sizePx * 0.18);
    const crownRadiusX = Math.min(CITY_MARKER_SIZE_LIMITS_PX.capital * 0.34, discRadius * 0.76);
    const crownRadiusY = Math.max(1.6, crownRadiusX * 0.34);
    spriteContext.beginPath();
    spriteContext.ellipse(cx, crownY, crownRadiusX, crownRadiusY, 0, 0, Math.PI * 2);
    spriteContext.strokeStyle = tokens.capitalAccent;
    spriteContext.lineWidth = Math.max(1.4, sizePx * 0.11);
    spriteContext.stroke();

    spriteContext.save();
    spriteContext.globalCompositeOperation = "screen";
    spriteContext.beginPath();
    spriteContext.ellipse(cx, crownY - (crownRadiusY * 0.1), crownRadiusX * 0.74, crownRadiusY * 0.55, 0, 0, Math.PI);
    spriteContext.strokeStyle = tokens.capitalHighlight;
    spriteContext.lineWidth = Math.max(1, sizePx * 0.06);
    spriteContext.stroke();
    spriteContext.restore();

    spriteContext.beginPath();
    spriteContext.moveTo(cx - crownRadiusX * 0.7, crownY);
    spriteContext.lineTo(cx - crownRadiusX * 0.28, crownY - crownRadiusY * 1.2);
    spriteContext.lineTo(cx, crownY - crownRadiusY * 0.35);
    spriteContext.lineTo(cx + crownRadiusX * 0.28, crownY - crownRadiusY * 1.2);
    spriteContext.lineTo(cx + crownRadiusX * 0.7, crownY);
    spriteContext.strokeStyle = tokens.capitalHighlight;
    spriteContext.lineWidth = Math.max(1, sizePx * 0.055);
    spriteContext.stroke();
  }

  spriteContext.restore();
  return {
    anchorX: widthPx / 2,
    anchorY: centerY + discHeight + Math.max(2, sizePx * 0.18),
  };
}

function getCityMarkerSprite(entry, config = {}) {
  const colorRevision = Number(state.colorRevision || 0);
  if (cityMarkerSpriteCacheColorRevision !== colorRevision) {
    cityMarkerSpriteCache.clear();
    cityMarkerSpriteCacheColorRevision = colorRevision;
  }
  const spec = getCityMarkerVisualSpec(entry, config);
  const sizePx = spec.sizePx;
  const themeKey = String(config.theme || CITY_MARKER_THEME_GRAPHITE).trim().toLowerCase();
  const baseColorKey = String(config.color || "");
  const capitalColorKey = String(config.capitalColor || "");
  const markerStyle = getCityMarkerRenderStyle(entry, config);
  const backgroundKey = markerStyle.backgroundColor || "none";
  const spriteKey = [
    themeKey,
    String(entry?.cityTier || "minor"),
    entry?.isCapital ? "capital" : "regular",
    sizePx.toFixed(2),
    baseColorKey,
    capitalColorKey,
    backgroundKey,
  ].join("|");
  if (cityMarkerSpriteCache.has(spriteKey)) {
    return cityMarkerSpriteCache.get(spriteKey);
  }

  const tokens = markerStyle.tokens;
  const canvas = createCityMarkerSpriteCanvas(spec.widthPx, spec.heightPx + spec.capitalTopExtra);
  const sprite = {
    canvas,
    width: spec.widthPx,
    height: spec.heightPx + spec.capitalTopExtra,
    anchorX: spec.widthPx / 2,
    anchorY: spec.heightPx + spec.capitalTopExtra - Math.max(2, sizePx * 0.12),
  };
  if (!canvas) {
    cityMarkerSpriteCache.set(spriteKey, sprite);
    return sprite;
  }

  const spriteContext = canvas.getContext("2d");
  if (!spriteContext) {
    cityMarkerSpriteCache.set(spriteKey, sprite);
    return sprite;
  }

  const anchor = renderCityMarkerSprite(spriteContext, spec, tokens, entry);
  sprite.anchorX = anchor.anchorX;
  sprite.anchorY = anchor.anchorY;
  cityMarkerSpriteCache.set(spriteKey, sprite);
  return sprite;
}

function buildCityRevealPlan(cityCollection, scale, transform, config = {}) {
  const phase = getCityRevealPhase(scale);
  const countryProfiles = getCityCountryProfileIndex(cityCollection);
  const urbanIndex = getUrbanFeatureIndex();
  const markerEntries = [];
  const countsByCountry = new Map();
  const markerBudget = Math.max(0, Number(phase.markerBudget || 0));
  const labelBudget = getCityLabelBudget(phase, config);
  const labelEntries = [];

  const candidateEntries = cityCollection.features
    .map((feature) => {
      const anchor = getCityAnchor(feature);
      if (!anchor || !isCityAnchorInViewport(anchor, { padding: 48, transform })) {
        return null;
      }
      const profile = countryProfiles.get(getCityCountryGroupKey(feature)) || {
        countryTier: "D",
        countryTierRank: CITY_COUNTRY_TIER_RANK.D,
      };
      const isCapital = !!feature?.properties?.__city_is_capital;
      const minZoom = getCityEffectiveMinZoom(feature);
      if (!isCapital && scale < minZoom) {
        return null;
      }
      const cityTier = getCityTier(feature);
      const urbanInfo = getCityUrbanRuntimeInfo(feature, urbanIndex);
      const entry = {
        feature,
        anchor,
        screenPoint: getCityScreenPoint(anchor, transform),
        cityId: getCityCanonicalId(feature) || getCityFeatureKey(feature),
        isCapital,
        minZoom,
        cityTier,
        cityTierWeight: getCityTierWeight(feature),
        countryKey: profile.groupKey || getCityCountryGroupKey(feature),
        countryTier: profile.countryTier || "D",
        countryTierRank: profile.countryTierRank || CITY_COUNTRY_TIER_RANK.D,
        population: Math.max(0, Number(feature?.properties?.__city_population || 0)),
        sortWeight: getCitySortWeight(feature),
        urbanMatchId: urbanInfo.urbanMatchId,
        urbanFeature: urbanInfo.urbanFeature,
        hasUrbanMatch: urbanInfo.hasUrbanMatch,
        urbanMatchMethod: urbanInfo.urbanMatchMethod,
        acceptedLabelPlacement: "",
      };
      entry.revealBucket = getCityRevealBucket(entry, phase.id);
      if (!Number.isFinite(entry.revealBucket)) {
        return null;
      }
      return entry;
    })
    .filter(Boolean)
    .sort(compareCityRevealEntries);

  const capitalEntriesByCountry = new Map();
  candidateEntries.forEach((entry) => {
    if (!entry.isCapital || capitalEntriesByCountry.has(entry.countryKey)) {
      return;
    }
    capitalEntriesByCountry.set(entry.countryKey, entry);
  });
  const acceptedCityIds = new Set();
  capitalEntriesByCountry.forEach((entry) => {
    const currentCount = countsByCountry.get(entry.countryKey) || 0;
    const quota = Math.max(
      getCityMarkerQuotaForTier(phase.id, entry.countryTier),
      1
    );
    if (currentCount >= quota) return;
    entry.markerSizePx = getCityMarkerSizePx(entry, config);
    markerEntries.push(entry);
    countsByCountry.set(entry.countryKey, currentCount + 1);
    acceptedCityIds.add(entry.cityId);
  });
  const effectiveMarkerBudget = Math.max(markerBudget, markerEntries.length);

  for (const entry of candidateEntries) {
    if (markerEntries.length >= effectiveMarkerBudget) break;
    if (acceptedCityIds.has(entry.cityId)) continue;
    const currentCount = countsByCountry.get(entry.countryKey) || 0;
    const quota = Math.max(
      getCityMarkerQuotaForTier(phase.id, entry.countryTier),
      entry.isCapital ? 1 : 0
    );
    if (currentCount >= quota) continue;
    entry.markerSizePx = getCityMarkerSizePx(entry, config);
    markerEntries.push(entry);
    countsByCountry.set(entry.countryKey, currentCount + 1);
    acceptedCityIds.add(entry.cityId);
  }

  if (config.showLabels && !state.deferExactAfterSettle && labelBudget > 0 && scale >= Number(config.labelMinZoom || 0)) {
    markerEntries
      .filter((entry) => isCityLabelEligibleForPhase(entry, phase.id))
      .sort(compareCityRevealEntries)
      .some((entry) => {
        if (scale < Math.max(Number(config.labelMinZoom || 0), Number(entry.minZoom || 0))) {
          return false;
        }
        labelEntries.push(entry);
        return labelEntries.length >= labelBudget;
      });
  }

  return {
    phase,
    markerEntries,
    labelEntries,
    candidateEntries,
  };
}

function cloneCityFeature(feature, propertyPatch = {}) {
  const props = feature?.properties || {};
  return {
    ...feature,
    properties: {
      ...props,
      ...propertyPatch,
    },
  };
}

function resolveCityFeatureKey(reference, featuresByKey, aliasToKey) {
  const value = String(reference || "").trim();
  if (!value) return "";
  if (featuresByKey.has(value)) return value;
  return String(aliasToKey.get(value) || "").trim();
}

function getScenarioCountryCodesForTag(tag) {
  const record = state.scenarioCountriesByTag?.[tag];
  if (!record || typeof record !== "object") return new Set();
  return new Set(
    [record.lookup_iso2, record.base_iso2]
      .map((value) => String(value || "").trim().toUpperCase())
      .filter((value) => /^[A-Z]{2}$/.test(value))
  );
}

function getCityScenarioTag(feature) {
  const props = feature?.properties || {};
  const hostFeatureId = String(props.__city_host_feature_id || props.host_feature_id || "").trim();
  if (!hostFeatureId) return "";
  return String(
    state.scenarioControllersByFeatureId?.[hostFeatureId]
    || state.sovereigntyByFeatureId?.[hostFeatureId]
    || ""
  ).trim().toUpperCase();
}

function doesScenarioCountryHideCityPoints(tag) {
  const normalizedTag = String(tag || "").trim().toUpperCase();
  if (!normalizedTag) return false;
  return !!state.scenarioCountriesByTag?.[normalizedTag]?.hide_city_points;
}

function shouldHideCityPointForScenarioCountry(feature) {
  return doesScenarioCountryHideCityPoints(getCityScenarioTag(feature));
}

function getCapitalCandidateSortTuple(feature, preferredCountryCodes = new Set()) {
  const props = feature?.properties || {};
  const countryCode = String(props.__city_country_code || props.country_code || "").trim().toUpperCase();
  const countryPenalty = preferredCountryCodes.size > 0 && !preferredCountryCodes.has(countryCode) ? 1 : 0;
  return [
    countryPenalty,
    -getCityCapitalScore(feature),
    -getCityTierWeight(feature),
    -Math.max(0, Number(props.__city_population || 0)),
    getCityFeatureKey(feature),
  ];
}

function compareCapitalCandidateEntries(left, right, preferredCountryCodes = new Set()) {
  const leftTuple = getCapitalCandidateSortTuple(left?.feature, preferredCountryCodes);
  const rightTuple = getCapitalCandidateSortTuple(right?.feature, preferredCountryCodes);
  for (let index = 0; index < leftTuple.length; index += 1) {
    if (leftTuple[index] < rightTuple[index]) return -1;
    if (leftTuple[index] > rightTuple[index]) return 1;
  }
  return 0;
}

function applyScenarioCityOverride(feature, overrideEntry) {
  if (!feature || !overrideEntry || typeof overrideEntry !== "object") {
    return feature;
  }
  const props = feature.properties || {};
  const nextTier = ["major", "regional", "minor"].includes(String(overrideEntry.tier || "").trim().toLowerCase())
    ? String(overrideEntry.tier || "").trim().toLowerCase()
    : getCityTier(feature);
  const displayName = overrideEntry.display_name && typeof overrideEntry.display_name === "object"
    ? overrideEntry.display_name
    : {};
  const nextAliases = Array.from(new Set([
    ...(Array.isArray(props.__city_aliases) ? props.__city_aliases : []),
    ...(Array.isArray(overrideEntry.aliases) ? overrideEntry.aliases : []),
    displayName.en,
    displayName.zh,
    overrideEntry.city_id,
    overrideEntry.stable_key,
  ].filter(Boolean).map((value) => String(value).trim())));
  const overrideMinZoom = Number(overrideEntry.min_zoom ?? overrideEntry.minZoom);
  return cloneCityFeature(feature, {
    __city_aliases: nextAliases,
    __city_has_display_name_override: Object.keys(displayName).length > 0,
    __city_display_name_override: Object.keys(displayName).length > 0 ? { ...displayName } : null,
    __city_hidden: overrideEntry.hidden === undefined ? !!props.__city_hidden : !!overrideEntry.hidden,
    __city_base_tier: nextTier,
    __city_min_zoom: Number.isFinite(overrideMinZoom) ? overrideMinZoom : getDefaultCityMinZoomForTier(nextTier),
    name_en: String(displayName.en || overrideEntry.name_en || props.name_en || props.name || "").trim(),
    label_en: String(displayName.en || overrideEntry.name_en || props.label_en || props.name_en || props.name || "").trim(),
    name_zh: String(displayName.zh || overrideEntry.name_zh || props.name_zh || "").trim(),
    label_zh: String(displayName.zh || overrideEntry.name_zh || props.label_zh || props.name_zh || "").trim(),
  });
}

function getEffectiveCityCollection() {
  const baseRef = state.worldCitiesData || null;
  const scenarioRef = state.scenarioCityOverridesData || null;
  const scenarioCountriesRef = state.scenarioCountriesByTag || null;
  const scenarioId = String(state.activeScenarioId || "");
  const cityLayerRevision = Number(state.cityLayerRevision || 0);
  const scenarioControllerRevision = Number(state.scenarioControllerRevision || 0);
  const sovereigntyRevision = Number(state.sovereigntyRevision || 0);
  if (
    cityLayerCache.baseRef === baseRef
    && cityLayerCache.scenarioRef === scenarioRef
    && cityLayerCache.scenarioCountriesRef === scenarioCountriesRef
    && cityLayerCache.scenarioId === scenarioId
    && cityLayerCache.cityLayerRevision === cityLayerRevision
    && cityLayerCache.scenarioControllerRevision === scenarioControllerRevision
    && cityLayerCache.sovereigntyRevision === sovereigntyRevision
  ) {
    return cityLayerCache.merged;
  }

  const featuresByKey = new Map();
  const aliasToKey = new Map();
  const rememberFeatureAliases = (feature, key) => {
    getCityFeatureAliases(feature, key).forEach((alias) => {
      aliasToKey.set(alias, key);
    });
  };
  const setFeature = (feature, key) => {
    featuresByKey.set(key, feature);
    rememberFeatureAliases(feature, key);
  };
  const deleteByAlias = (rawAlias) => {
    const alias = String(rawAlias || "").trim();
    if (!alias) return;
    const resolvedKey = aliasToKey.get(alias) || alias;
    featuresByKey.delete(resolvedKey);
  };

  (Array.isArray(baseRef?.features) ? baseRef.features : []).forEach((feature, index) => {
    const key = getCityFeatureKey(feature, `world_city_${index + 1}`);
    if (!key || feature?.properties?.__city_hidden) return;
    setFeature(feature, key);
  });

  const legacyScenarioCollection = scenarioRef?.featureCollection || (
    Array.isArray(scenarioRef?.features) ? scenarioRef : null
  );
  (Array.isArray(legacyScenarioCollection?.features) ? legacyScenarioCollection.features : []).forEach((feature, index) => {
    const props = feature?.properties || {};
    const key = getCityFeatureKey(feature, `scenario_city_${index + 1}`);
    const replaceIds = Array.isArray(props.__city_replace_ids) ? props.__city_replace_ids : [];
    replaceIds.forEach((value) => deleteByAlias(value));
    if (!key) return;
    deleteByAlias(key);
    if (props.__city_hidden) return;
    setFeature(feature, key);
  });

  Object.values(scenarioRef?.cities || {}).forEach((overrideEntry) => {
    const replaceIds = Array.isArray(overrideEntry?.replace_ids) ? overrideEntry.replace_ids : [];
    replaceIds.forEach((value) => deleteByAlias(value));
    const key = resolveCityFeatureKey(
      overrideEntry?.city_id || overrideEntry?.stable_key || "",
      featuresByKey,
      aliasToKey
    );
    if (!key || !featuresByKey.has(key)) return;
    const nextFeature = applyScenarioCityOverride(featuresByKey.get(key), overrideEntry);
    if (nextFeature?.properties?.__city_hidden) {
      featuresByKey.delete(key);
      return;
    }
    setFeature(nextFeature, key);
  });

  const activeCapitalCityIds = new Set();
  if (scenarioId && state.scenarioCountriesByTag && typeof state.scenarioCountriesByTag === "object") {
    const candidatesByTag = new Map();
    Array.from(featuresByKey.entries()).forEach(([key, feature]) => {
      const tag = getCityScenarioTag(feature);
      if (!tag) return;
      const current = candidatesByTag.get(tag) || [];
      current.push({ key, feature });
      candidatesByTag.set(tag, current);
    });

    Object.keys(state.scenarioCountriesByTag).forEach((rawTag) => {
      const tag = String(rawTag || "").trim().toUpperCase();
      if (!tag) return;
      const explicitKey = resolveCityFeatureKey(scenarioRef?.capitals_by_tag?.[tag], featuresByKey, aliasToKey);
      const hintedKey = explicitKey
        ? ""
        : resolveCityFeatureKey(scenarioRef?.capital_city_hints?.[tag]?.city_id, featuresByKey, aliasToKey);
      let resolvedKey = explicitKey || hintedKey;
      if (!resolvedKey) {
        const candidateEntries = (candidatesByTag.get(tag) || []).slice();
        if (candidateEntries.length) {
          const preferredCountryCodes = getScenarioCountryCodesForTag(tag);
          candidateEntries.sort((left, right) => compareCapitalCandidateEntries(left, right, preferredCountryCodes));
          resolvedKey = candidateEntries[0]?.key || "";
        }
      }
      if (!resolvedKey || !featuresByKey.has(resolvedKey)) return;
      const resolvedCityId = getCityCanonicalId(featuresByKey.get(resolvedKey)) || resolvedKey;
      if (resolvedCityId) {
        activeCapitalCityIds.add(resolvedCityId);
      }
    });
  }

  const finalFeatures = [];
  Array.from(featuresByKey.entries()).forEach(([key, feature]) => {
    const cityId = getCityCanonicalId(feature) || key;
    const nextIsCapital = scenarioId ? activeCapitalCityIds.has(cityId) : !!feature?.properties?.__city_is_capital;
    const nextFeature = feature?.properties?.__city_is_capital === nextIsCapital
      ? feature
      : cloneCityFeature(feature, { __city_is_capital: nextIsCapital });
    if (!nextFeature?.properties?.__city_hidden && !shouldHideCityPointForScenarioCountry(nextFeature)) {
      finalFeatures.push(nextFeature);
    }
  });

  cityLayerCache.baseRef = baseRef;
  cityLayerCache.scenarioRef = scenarioRef;
  cityLayerCache.scenarioCountriesRef = scenarioCountriesRef;
  cityLayerCache.scenarioId = scenarioId;
  cityLayerCache.cityLayerRevision = cityLayerRevision;
  cityLayerCache.scenarioControllerRevision = scenarioControllerRevision;
  cityLayerCache.sovereigntyRevision = sovereigntyRevision;
  cityLayerCache.merged = finalFeatures.length
    ? {
      type: "FeatureCollection",
      features: finalFeatures,
    }
    : null;
  return cityLayerCache.merged;
}

function getCityAnchor(feature) {
  if (!feature || !projection) return null;
  const cached = cityAnchorCache.get(feature);
  if (cached !== undefined) {
    return cached;
  }

  let anchor = null;
  const geometry = feature.geometry;
  if (geometry?.type === "Point" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    const projected = projection(geometry.coordinates);
    if (Array.isArray(projected) && projected.every((value) => Number.isFinite(Number(value)))) {
      anchor = projected;
    }
  } else if (geometry?.type === "MultiPoint" && Array.isArray(geometry.coordinates) && geometry.coordinates.length) {
    const projectedPoints = geometry.coordinates
      .map((coords) => projection(coords))
      .filter((point) => Array.isArray(point) && point.every((value) => Number.isFinite(Number(value))));
    if (projectedPoints.length) {
      const [sumX, sumY] = projectedPoints.reduce(
        (acc, point) => [acc[0] + Number(point[0]), acc[1] + Number(point[1])],
        [0, 0]
      );
      anchor = [sumX / projectedPoints.length, sumY / projectedPoints.length];
    }
  }

  if (!anchor && pathCanvas?.centroid) {
    const centroid = pathCanvas.centroid(feature);
    if (Array.isArray(centroid) && centroid.every((value) => Number.isFinite(Number(value)))) {
      anchor = centroid;
    }
  }

  if (!anchor && globalThis.d3?.geoCentroid) {
    const geoCentroid = globalThis.d3.geoCentroid(feature);
    const projected = Array.isArray(geoCentroid) ? projection(geoCentroid) : null;
    if (Array.isArray(projected) && projected.every((value) => Number.isFinite(Number(value)))) {
      anchor = projected;
    }
  }

  cityAnchorCache.set(feature, anchor);
  return anchor;
}

function getCityScreenPoint(anchor, transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  if (!Array.isArray(anchor) || anchor.length < 2) return null;
  const scale = Math.max(0.0001, Number(transform?.k || 1));
  const x = Number(anchor[0]);
  const y = Number(anchor[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return [
    (x * scale) + Number(transform?.x || 0),
    (y * scale) + Number(transform?.y || 0),
  ];
}

function getCityGeoCoordinates(feature) {
  const geometry = feature?.geometry;
  if (geometry?.type === "Point" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    const lon = Number(geometry.coordinates[0]);
    const lat = Number(geometry.coordinates[1]);
    if (Number.isFinite(lon) && Number.isFinite(lat)) {
      return [normalizeLongitude(lon), clamp(lat, -89.999, 89.999)];
    }
  }
  if (geometry?.type === "MultiPoint" && Array.isArray(geometry.coordinates) && geometry.coordinates.length) {
    const points = geometry.coordinates
      .map((coords) => [Number(coords?.[0]), Number(coords?.[1])])
      .filter((coords) => coords.every((value) => Number.isFinite(value)));
    if (points.length) {
      const sums = points.reduce((acc, coords) => [acc[0] + coords[0], acc[1] + coords[1]], [0, 0]);
      return [
        normalizeLongitude(sums[0] / points.length),
        clamp(sums[1] / points.length, -89.999, 89.999),
      ];
    }
  }
  return getFeatureGeoCentroid(feature);
}

function buildCityLabelPlacementCandidates(entry, {
  textWidthPx,
  fontPx,
  scale,
  offsetPx,
  verticalOffsetPx,
}) {
  if (!entry?.screenPoint || !entry?.anchor) return [];
  const widthPx = Math.max(1, Number(textWidthPx || 0));
  const heightPx = fontPx + 4;
  const halfHeightPx = heightPx * 0.5;
  const placements = {
    right: {
      textAlign: "left",
      dxPx: offsetPx,
      dyPx: 0,
      boxX: entry.screenPoint[0] + offsetPx - 2,
      boxY: entry.screenPoint[1] - halfHeightPx,
    },
    left: {
      textAlign: "right",
      dxPx: -offsetPx,
      dyPx: 0,
      boxX: entry.screenPoint[0] - offsetPx - widthPx - 4,
      boxY: entry.screenPoint[1] - halfHeightPx,
    },
    "upper-right": {
      textAlign: "left",
      dxPx: offsetPx,
      dyPx: -verticalOffsetPx,
      boxX: entry.screenPoint[0] + offsetPx - 2,
      boxY: entry.screenPoint[1] - verticalOffsetPx - halfHeightPx,
    },
    "lower-right": {
      textAlign: "left",
      dxPx: offsetPx,
      dyPx: verticalOffsetPx,
      boxX: entry.screenPoint[0] + offsetPx - 2,
      boxY: entry.screenPoint[1] + verticalOffsetPx - halfHeightPx,
    },
    "upper-left": {
      textAlign: "right",
      dxPx: -offsetPx,
      dyPx: -verticalOffsetPx,
      boxX: entry.screenPoint[0] - offsetPx - widthPx - 4,
      boxY: entry.screenPoint[1] - verticalOffsetPx - halfHeightPx,
    },
    "lower-left": {
      textAlign: "right",
      dxPx: -offsetPx,
      dyPx: verticalOffsetPx,
      boxX: entry.screenPoint[0] - offsetPx - widthPx - 4,
      boxY: entry.screenPoint[1] + verticalOffsetPx - halfHeightPx,
    },
  };
  return CITY_LABEL_PLACEMENT_ORDER
    .map((placementId) => {
      const candidate = placements[placementId];
      if (!candidate) return null;
      return {
        id: placementId,
        textAlign: candidate.textAlign,
        drawX: entry.anchor[0] + (candidate.dxPx / scale),
        drawY: entry.anchor[1] + (candidate.dyPx / scale),
        box: {
          x: candidate.boxX,
          y: candidate.boxY,
          w: widthPx + 6,
          h: heightPx,
        },
      };
    })
    .filter(Boolean);
}

function isCityAnchorInViewport(anchor, { padding = 24, transform = state.zoomTransform || globalThis.d3?.zoomIdentity } = {}) {
  const screenPoint = getCityScreenPoint(anchor, transform);
  if (!screenPoint) return false;
  return (
    screenPoint[0] >= -padding
    && screenPoint[0] <= state.width + padding
    && screenPoint[1] >= -padding
    && screenPoint[1] <= state.height + padding
  );
}

function getCityCapitalDescriptor(entry) {
  if (entry?.feature?.properties?.__city_is_country_capital) {
    return state.currentLanguage === "zh" ? "\u9996\u90fd" : "Capital";
  }
  if (entry?.feature?.properties?.__city_is_admin_capital) {
    return state.currentLanguage === "zh" ? "\u884c\u653f\u4e2d\u5fc3" : "Administrative capital";
  }
  return "";
}

function getCityTooltipText(entry) {
  const fullLabel = getCityDisplayLabel(entry?.feature);
  const props = entry?.feature?.properties || {};
  const hostFeatureId = String(props.__city_host_feature_id || "").trim();
  const hostFeature = hostFeatureId ? state.landIndex?.get(hostFeatureId) : null;
  const countryCode = String(
    (hostFeature ? getDisplayOwnerCode(hostFeature, hostFeatureId) : "")
      || props.__city_scenario_tag
      || props.__city_country_code
      || props.country_code
      || ""
  ).trim().toUpperCase();
  const rawCountryName =
    getScenarioCountryDisplayName(state.scenarioCountriesByTag?.[countryCode])
    || state.countryNames?.[countryCode]
    || countryCode;
  const countryDisplayName = rawCountryName ? (t(rawCountryName, "geo") || rawCountryName) : "";
  const lines = [fullLabel];
  const capitalDescriptor = getCityCapitalDescriptor(entry);
  if (capitalDescriptor) {
    lines.push(capitalDescriptor);
  }
  if (countryDisplayName) {
    lines.push(countryCode ? `${countryDisplayName} (${countryCode})` : countryDisplayName);
  }
  return renderTooltipText({ lines: lines.filter(Boolean) });
}

function getCityLabelBackgroundColor(entry) {
  const props = entry?.feature?.properties || entry?.properties || {};
  const hostFeatureId = String(props.__city_host_feature_id || props.host_feature_id || "").trim();
  const hostFeature = hostFeatureId ? state.landIndex?.get(hostFeatureId) : null;
  if (hostFeature && hostFeatureId) {
    return (
      getSafeCanvasColor(state.colors?.[hostFeatureId], null) ||
      getSafeCanvasColor(getResolvedFeatureColor(hostFeature, hostFeatureId), null)
    );
  }

  const countryCode = String(
    props.__city_scenario_tag ||
    props.__city_country_code ||
    props.country_code ||
    props.cntr_code ||
    ""
  ).trim().toUpperCase();
  if (!countryCode) return null;
  return (
    getSafeCanvasColor(state.sovereignBaseColors?.[countryCode], null) ||
    getSafeCanvasColor(state.countryBaseColors?.[countryCode], null)
  );
}

function getCityBackgroundPaintInfo(entry) {
  const backgroundColor = getCityLabelBackgroundColor(entry) || "";
  const luminance = getCanvasColorRelativeLuminance(backgroundColor);
  const usesLightContrast = Number.isFinite(luminance) && luminance < CITY_LABEL_DARK_BACKGROUND_LUMINANCE;
  return {
    backgroundColor,
    luminance,
    usesLightContrast,
  };
}

function getCityLabelRenderStyle(entry, config = {}) {
  const tokens = getCityMarkerThemeTokens(config);
  const backgroundInfo = getCityBackgroundPaintInfo(entry);
  const { backgroundColor, luminance } = backgroundInfo;
  const usesLightLabel = backgroundInfo.usesLightContrast;

  if (!usesLightLabel) {
    return {
      fillStyle: entry?.isCapital ? tokens.capitalLabel : tokens.label,
      strokeStyle: "rgba(255, 252, 245, 0.22)",
      shadowColor: tokens.shadow,
      strokeWidthFactor: 0.1,
      shadowBlurFactor: 0.12,
      shadowOffsetYFactor: 0.04,
      usesLightLabel: false,
      backgroundColor: backgroundColor || "",
      luminance,
    };
  }

  return {
    fillStyle: entry?.isCapital ? "rgba(248, 245, 238, 0.98)" : "rgba(243, 240, 233, 0.96)",
    strokeStyle: "rgba(12, 16, 24, 0.46)",
    shadowColor: "rgba(6, 9, 14, 0.34)",
    strokeWidthFactor: 0.18,
    shadowBlurFactor: 0.18,
    shadowOffsetYFactor: 0.05,
    usesLightLabel: true,
    backgroundColor: backgroundColor || "",
    luminance,
  };
}

function getCityMarkerRenderStyle(entry, config = {}) {
  const baseTokens = getCityMarkerThemeTokens(config);
  const backgroundInfo = getCityBackgroundPaintInfo(entry);
  const { backgroundColor, luminance, usesLightContrast } = backgroundInfo;
  if (!usesLightContrast || !backgroundColor) {
    return {
      tokens: baseTokens,
      backgroundColor,
      luminance,
      usesLightContrast: false,
      adapted: false,
    };
  }

  const adaptiveBase = computeUrbanAdaptivePaintFromHostColor(backgroundColor, {
    adaptiveStrength: 1,
    toneBias: 0.08,
  });
  const fillMid = adaptiveBase?.fillColor || mixCanvasColors(backgroundColor, "#ede7da", 0.62) || baseTokens.fillMid;
  const stroke = adaptiveBase?.strokeColor || mixCanvasColors(backgroundColor, "#fff8ef", 0.78) || baseTokens.stroke;
  const fillTop = mixCanvasColors(fillMid, "#fffaf2", 0.28) || fillMid;
  const fillBottom = mixCanvasColors(fillMid, stroke, 0.46) || stroke;
  return {
    tokens: {
      ...baseTokens,
      fillTop,
      fillMid,
      fillBottom,
      rimDark: mixCanvasColors(backgroundColor, stroke, 0.82) || stroke,
      stroke,
      highlight: mixCanvasColors(stroke, "#ffffff", 0.24) || baseTokens.highlight,
      specular: mixCanvasColors(stroke, "#ffffff", 0.14) || baseTokens.specular,
      capitalAccent: mixCanvasColors(backgroundColor, "#f2e4b2", 0.84) || baseTokens.capitalAccent,
      capitalHighlight: mixCanvasColors(backgroundColor, "#fff7da", 0.88) || baseTokens.capitalHighlight,
      halo: mixCanvasColors(backgroundColor, "#fff9ef", 0.18) || baseTokens.halo,
    },
    backgroundColor,
    luminance,
    usesLightContrast: true,
    adapted: true,
  };
}

function getCityHoverRadiusPx(entry) {
  return Math.max(7, Number(entry?.markerSizePx || 0) * 0.92 + (entry?.isCapital ? 2.4 : 1.4));
}

function cacheVisibleCityHoverEntries(entries = []) {
  visibleCityHoverEntries = Array.isArray(entries)
    ? entries
      .filter((entry) => Array.isArray(entry?.screenPoint) && entry.screenPoint.length >= 2)
      .map((entry) => ({
        ...entry,
        hoverRadiusPx: getCityHoverRadiusPx(entry),
        tooltipText: getCityTooltipText(entry),
      }))
    : [];
}

function getHoveredCityEntryFromEvent(event) {
  if (!visibleCityHoverEntries.length || !mapSvg || !globalThis.d3?.pointer) {
    return null;
  }
  const [sx, sy] = globalThis.d3.pointer(event, mapSvg);
  if (![sx, sy].every(Number.isFinite)) {
    return null;
  }
  let bestEntry = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  visibleCityHoverEntries.forEach((entry) => {
    const [entryX, entryY] = entry.screenPoint || [];
    if (![entryX, entryY].every(Number.isFinite)) {
      return;
    }
    const threshold = Math.max(6, Number(entry.hoverRadiusPx || 0));
    const distance = Math.hypot(sx - entryX, sy - entryY);
    if (distance <= threshold && distance < bestDistance) {
      bestDistance = distance;
      bestEntry = entry;
    }
  });
  return bestEntry;
}

function isCityEntryEligibleForLandHit(entry, hit) {
  if (!entry || hit?.targetType !== "land") {
    return false;
  }
  const hostFeatureId = String(
    entry?.feature?.properties?.__city_host_feature_id
    || entry?.feature?.properties?.host_feature_id
    || ""
  ).trim();
  return !!hostFeatureId && hostFeatureId === String(hit?.id || "").trim();
}

function getHoveredCityTooltipEntry(event, hit) {
  const entry = getHoveredCityEntryFromEvent(event);
  return isCityEntryEligibleForLandHit(entry, hit) ? entry : null;
}

function doScreenBoxesOverlap(a, b) {
  return (
    a.x < (b.x + b.w)
    && (a.x + a.w) > b.x
    && a.y < (b.y + b.h)
    && (a.y + a.h) > b.y
  );
}

function getCityLayerRenderState(k, { interactive = false, cacheHoverEntries = false } = {}) {
  const cityCollection = getEffectiveCityCollection();
  const featureCount = getFeatureCollectionFeatureCount(cityCollection);
  if (!state.showCityPoints || !cityCollection?.features?.length || !projection) {
    if (cacheHoverEntries) {
      cacheVisibleCityHoverEntries([]);
    }
    return {
      featureCount,
      markerEntries: [],
      labelEntries: [],
      skipped: true,
      reason: !state.showCityPoints ? "hidden" : !projection ? "no-projection" : "no-data",
    };
  }

  const config = normalizeCityLayerStyleConfig(state.styleConfig?.cityPoints || {});
  const transform = state.zoomTransform || globalThis.d3?.zoomIdentity;
  const scale = Math.max(0.0001, Number(transform?.k || k || 1));
  const opacity = clamp(Number(config.opacity) || 0.92, 0, 1);
  const plan = config.revealProfile === CITY_REVEAL_PROFILE_HYBRID
    ? buildCityRevealPlan(cityCollection, scale, transform, config)
    : buildCityRevealPlan(cityCollection, scale, transform, {
      ...config,
      revealProfile: CITY_REVEAL_PROFILE_HYBRID,
    });
  const markerEntries = Array.isArray(plan?.markerEntries) ? plan.markerEntries : [];

  if (!markerEntries.length) {
    if (cacheHoverEntries) {
      cacheVisibleCityHoverEntries([]);
    }
    return {
      featureCount,
      skipped: true,
      reason: "culled",
      markerEntries,
      labelEntries: [],
      config,
      scale,
      opacity: clamp(Number(config.opacity) || 0.92, 0, 1),
    };
  }
  if (cacheHoverEntries) {
    cacheVisibleCityHoverEntries(markerEntries);
  }
  return {
    featureCount,
    markerEntries,
    labelEntries: !interactive && config.showLabels ? plan.labelEntries || [] : [],
    skipped: false,
    reason: "",
    config,
    scale,
    opacity: clamp(Number(config.opacity) || 0.92, 0, 1),
  };
}

function drawCityMarkersFromEntries(markerEntries, { config, scale, opacity, interactive = false } = {}) {
  if (!Array.isArray(markerEntries) || !markerEntries.length) return;
  context.save();
  context.globalCompositeOperation = "source-over";
  context.lineJoin = "round";
  context.lineCap = "round";
  context.globalAlpha = interactive ? Math.min(opacity, 0.8) : opacity;

  markerEntries.forEach((entry) => {
    const spriteEntry = entry.isCapital && !config.showCapitalOverlay
      ? { ...entry, isCapital: false }
      : entry;
    const sprite = getCityMarkerSprite(spriteEntry, config);
    if (!sprite?.canvas) return;
    const drawWidth = sprite.width / scale;
    const drawHeight = sprite.height / scale;
    const drawX = entry.anchor[0] - (sprite.anchorX / scale);
    const drawY = entry.anchor[1] - (sprite.anchorY / scale);
    context.drawImage(sprite.canvas, drawX, drawY, drawWidth, drawHeight);
  });
  context.restore();
}

function drawCityLabelsFromEntries(labelEntries, { config, scale } = {}) {
  if (!Array.isArray(labelEntries) || !labelEntries.length) return 0;
  let labelCount = 0;
  const fontPx = clamp((Number(config?.labelSize) || 11) - 1, 7, 23);
  context.save();
  context.globalAlpha = 1;
  context.textBaseline = "middle";
  context.lineJoin = "round";
  const occupiedBoxes = [];
  labelEntries.forEach((entry) => {
    context.font = `${entry.isCapital ? 600 : 400} ${fontPx / scale}px ${TEXTURE_LABEL_SERIF_STACK}`;
    const fullText = getCityDisplayLabel(entry.feature);
    const text = formatCityMapLabel(fullText, {
      entry,
      context,
      config,
      scale,
    });
    const labelMinZoom = Math.max(Number(config?.labelMinZoom || 2.45), Number(entry.minZoom || 0));
    if (!text || !entry.screenPoint || scale < labelMinZoom) return;
    const markerSizePx = Number(entry.markerSizePx || getCityMarkerSizePx(entry, config));
    const offsetPx = Math.max(7, markerSizePx + 4);
    const verticalOffsetPx = Math.max(fontPx + 2, markerSizePx + 6);
    const metrics = context.measureText(text);
    const candidates = buildCityLabelPlacementCandidates(entry, {
      textWidthPx: metrics.width * scale,
      fontPx,
      scale,
      offsetPx,
      verticalOffsetPx,
    });
    const acceptedPlacement = candidates.find(({ box }) => (
      !(box.x > state.width + 24
      || box.y > state.height + 24
      || (box.x + box.w) < -24
      || (box.y + box.h) < -24)
      && !occupiedBoxes.some((occupied) => doScreenBoxesOverlap(box, occupied))
    ));
    if (!acceptedPlacement) {
      return;
    }
    occupiedBoxes.push(acceptedPlacement.box);
    entry.acceptedLabelPlacement = acceptedPlacement.id;
    labelCount += 1;
    const labelStyle = getCityLabelRenderStyle(entry, config);
    context.textAlign = acceptedPlacement.textAlign;
    context.shadowColor = labelStyle.shadowColor;
    context.shadowBlur = Math.max(1.1, fontPx * labelStyle.shadowBlurFactor) / scale;
    context.shadowOffsetX = 0;
    context.shadowOffsetY = Math.max(0.5, fontPx * labelStyle.shadowOffsetYFactor) / scale;
    context.lineWidth = Math.max(0.9, fontPx * labelStyle.strokeWidthFactor) / scale;
    context.strokeStyle = labelStyle.strokeStyle;
    context.strokeText(text, acceptedPlacement.drawX, acceptedPlacement.drawY);
    context.fillStyle = labelStyle.fillStyle;
    context.fillText(text, acceptedPlacement.drawX, acceptedPlacement.drawY);
    entry.labelContrastMode = labelStyle.usesLightLabel ? "light" : "default";
  });
  context.restore();
  return labelCount;
}

function drawCityPointsLayer(k, { interactive = false } = {}) {
  const startedAt = nowMs();
  const renderState = getCityLayerRenderState(k, {
    interactive,
    cacheHoverEntries: true,
  });
  if (renderState.skipped) {
    collectContextMetric("drawCityPointsLayer", nowMs() - startedAt, {
      featureCount: renderState.featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: renderState.reason,
    });
    return;
  }
  drawCityMarkersFromEntries(renderState.markerEntries, {
    config: renderState.config,
    scale: renderState.scale,
    opacity: renderState.opacity,
    interactive,
  });
  collectContextMetric("drawCityPointsLayer", nowMs() - startedAt, {
    featureCount: renderState.featureCount,
    visibleFeatureCount: renderState.markerEntries.length,
    labelCount: 0,
    interactive: !!interactive,
    skipped: false,
  });
}

function getContextFacilityThresholdRank(threshold, allowed = []) {
  const normalized = String(threshold || "").trim().toLowerCase();
  if (allowed.includes(normalized)) {
    if (normalized === "national_core") return 3;
    if (normalized === "regional_core") return 2;
    return 1;
  }
  return 1;
}

function buildContextFacilityEntries(collection, thresholdRank = 1) {
  const featureCount = getFeatureCollectionFeatureCount(collection);
  if (!collection?.features?.length || !projection) {
    return {
      featureCount,
      entries: [],
      skipped: true,
      reason: !projection ? "no-projection" : "no-data",
    };
  }
  const viewportWidth = Number(canvas?.width || 0);
  const viewportHeight = Number(canvas?.height || 0);
  const padding = 28;
  const entries = [];
  collection.features.forEach((feature) => {
    if (feature?.geometry?.type !== "Point") return;
    const coordinates = feature.geometry.coordinates;
    if (!Array.isArray(coordinates) || coordinates.length < 2) return;
    const projected = projection([coordinates[0], coordinates[1]]);
    if (!Array.isArray(projected) || !Number.isFinite(projected[0]) || !Number.isFinite(projected[1])) return;
    const properties = feature.properties || {};
    const importanceRank = Math.max(1, Math.round(Number(properties.importance_rank || 1)));
    if (importanceRank < thresholdRank) return;
    const x = projected[0];
    const y = projected[1];
    if (
      viewportWidth > 0
      && viewportHeight > 0
      && (x < -padding || x > viewportWidth + padding || y < -padding || y > viewportHeight + padding)
    ) {
      return;
    }
    entries.push({
      x,
      y,
      label: String(properties.name || "").trim(),
      importanceRank,
      properties,
    });
  });
  entries.sort((left, right) => left.importanceRank - right.importanceRank);
  return {
    featureCount,
    entries,
    skipped: false,
    reason: "",
  };
}

function drawContextFacilityPointLayer(
  metricName,
  collection,
  k,
  {
    interactive = false,
    visible = true,
    thresholdRank = 1,
    shape = "diamond",
    fillStyle = "#2563eb",
    strokeStyle = "#eff6ff",
    labelColor = "#1e3a8a",
    opacity = 0.9,
    nationalLabelScale = 2.2,
    regionalLabelScale = 5.2,
  } = {},
) {
  const startedAt = nowMs();
  if (!visible) {
    collectContextMetric(metricName, nowMs() - startedAt, {
      featureCount: getFeatureCollectionFeatureCount(collection),
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: "hidden",
    });
    return;
  }
  if (interactive) {
    collectContextMetric(metricName, nowMs() - startedAt, {
      featureCount: getFeatureCollectionFeatureCount(collection),
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: true,
      skipped: true,
      reason: "interactive-pass",
    });
    return;
  }
  const renderState = buildContextFacilityEntries(collection, thresholdRank);
  if (renderState.skipped) {
    collectContextMetric(metricName, nowMs() - startedAt, {
      featureCount: renderState.featureCount,
      visibleFeatureCount: 0,
      labelCount: 0,
      interactive: !!interactive,
      skipped: true,
      reason: renderState.reason,
    });
    return;
  }
  let labelCount = 0;
  context.save();
  context.lineJoin = "round";
  context.lineCap = "round";
  context.globalAlpha = opacity;
  renderState.entries.forEach((entry) => {
    const radius = entry.importanceRank >= 3 ? 5.2 : entry.importanceRank === 2 ? 4.3 : 3.5;
    context.beginPath();
    if (shape === "square") {
      context.rect(entry.x - radius, entry.y - radius, radius * 2, radius * 2);
    } else {
      context.moveTo(entry.x, entry.y - radius);
      context.lineTo(entry.x + radius, entry.y);
      context.lineTo(entry.x, entry.y + radius);
      context.lineTo(entry.x - radius, entry.y);
      context.closePath();
    }
    context.fillStyle = fillStyle;
    context.strokeStyle = strokeStyle;
    context.lineWidth = entry.importanceRank >= 3 ? 1.4 : 1.1;
    context.fill();
    context.stroke();
  });
  context.restore();

  context.save();
  context.textAlign = "left";
  context.textBaseline = "middle";
  renderState.entries.forEach((entry) => {
    if (!entry.label) return;
    const shouldShowLabel = entry.importanceRank >= 3 ? k >= nationalLabelScale : k >= regionalLabelScale;
    if (!shouldShowLabel) return;
    context.font = `${entry.importanceRank >= 3 ? 600 : 500} ${entry.importanceRank >= 3 ? 11 : 10}px "IBM Plex Sans", "Noto Sans JP", sans-serif`;
    context.lineWidth = 3;
    context.strokeStyle = "rgba(255,255,255,0.92)";
    context.fillStyle = labelColor;
    context.strokeText(entry.label, entry.x + 8, entry.y);
    context.fillText(entry.label, entry.x + 8, entry.y);
    labelCount += 1;
  });
  context.restore();

  collectContextMetric(metricName, nowMs() - startedAt, {
    featureCount: renderState.featureCount,
    visibleFeatureCount: renderState.entries.length,
    labelCount,
    interactive: !!interactive,
    skipped: false,
  });
}

function drawAirportsLayer(k, { interactive = false } = {}) {
  drawContextFacilityPointLayer("drawAirportsLayer", state.airportsData, k, {
    interactive,
    visible: !!state.showAirports,
    thresholdRank: getContextFacilityThresholdRank("regional_core", ["national_core", "regional_core", "local_connector"]),
    shape: "diamond",
    fillStyle: "#1d4ed8",
    strokeStyle: "#dbeafe",
    labelColor: "#15315f",
    opacity: 0.9,
    nationalLabelScale: 2.0,
    regionalLabelScale: 5.0,
  });
}

function drawPortsLayer(k, { interactive = false } = {}) {
  drawContextFacilityPointLayer("drawPortsLayer", state.portsData, k, {
    interactive,
    visible: !!state.showPorts,
    thresholdRank: getContextFacilityThresholdRank("regional_core", ["national_core", "regional_core"]),
    shape: "square",
    fillStyle: "#b45309",
    strokeStyle: "#ffedd5",
    labelColor: "#7c2d12",
    opacity: 0.9,
    nationalLabelScale: 2.2,
    regionalLabelScale: 5.4,
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
  requestRendererRender("texture-rerender", {
    fallback: () => {
      if (context) {
        drawCanvas();
      }
    },
  });
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

function getModernCityLightsNormalizationDenominator() {
  const p90 = Number(MODERN_CITY_LIGHTS_STATS?.p90 ?? MODERN_CITY_LIGHTS_STATS?.p90_nonzero ?? 0);
  if (Number.isFinite(p90) && p90 > 0) {
    return Math.max(20, p90 * 0.82);
  }
  const maxValue = Number(MODERN_CITY_LIGHTS_STATS?.max ?? 255);
  if (Number.isFinite(maxValue) && maxValue > 0) {
    return Math.max(20, maxValue * 0.72);
  }
  return 255;
}

function normalizeModernCityLightsValue(value) {
  return clamp(Number(value || 0) / Math.max(getModernCityLightsNormalizationDenominator(), 0.0001), 0, 1);
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
  return normalizeModernCityLightsValue(top + ((bottom - top) * ty));
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
      const aspectRatio = Math.max(rx, ry) / Math.max(Math.min(rx, ry), 0.01);
      if (aspectRatio > 3.5) continue;
      const maxRadius = Math.min(rx, ry) * 2.2;
      const clampedRx = Math.min(rx, maxRadius);
      const clampedRy = Math.min(ry, maxRadius);

      let neighborCount = 0;
      const visitedNeighborIndices = new Set();
      const currentIndex = (y * MODERN_CITY_LIGHTS_GRID_WIDTH) + x;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nx = ((x + dx) % MODERN_CITY_LIGHTS_GRID_WIDTH + MODERN_CITY_LIGHTS_GRID_WIDTH) % MODERN_CITY_LIGHTS_GRID_WIDTH;
          const ny = clamp(y + dy, 0, MODERN_CITY_LIGHTS_GRID_HEIGHT - 1);
          const neighborIndex = (ny * MODERN_CITY_LIGHTS_GRID_WIDTH) + nx;
          if (neighborIndex === currentIndex) continue;
          if (visitedNeighborIndices.has(neighborIndex)) continue;
          visitedNeighborIndices.add(neighborIndex);
          if (MODERN_CITY_LIGHTS_GRID[neighborIndex] >= MODERN_CITY_LIGHTS_BASE_THRESHOLD) {
            neighborCount += 1;
          }
        }
      }

      const entry = {
        x: center[0],
        y: center[1],
        rx: clampedRx,
        ry: clampedRy,
        rotation: Math.atan2(ewDy, ewDx),
        gridX: x,
        gridY: y,
        value,
        neighborCount,
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

function getLightBlobRgb(color) {
  const normalized = ColorManager.normalizeHexColor(color);
  const rgb = normalized ? ColorManager.hexToRgb(normalized) : null;
  if (rgb) return rgb;
  return { r: 255, g: 255, b: 255 };
}

function toRgbaString(rgb, alpha = 1) {
  const resolvedAlpha = clamp(Number(alpha) || 0, 0, 1);
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${resolvedAlpha})`;
}

function drawSoftLightBlob(
  x,
  y,
  rx,
  ry,
  {
    rotation = 0,
    rgb = { r: 255, g: 255, b: 255 },
    alpha = 1,
    innerStop = 0.1,
    midStop = 0.5,
    innerAlphaScale = 0.88,
    midAlphaScale = 0.28,
  } = {},
) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  const resolvedRx = Math.max(Number(rx) || 0, 0.0001);
  const resolvedRy = Math.max(Number(ry) || 0, 0.0001);
  const resolvedAlpha = clamp(Number(alpha) || 0, 0, 1);
  if (resolvedAlpha <= 0.0001) return;

  context.save();
  context.translate(x, y);
  context.rotate(Number(rotation) || 0);
  context.scale(resolvedRx, resolvedRy);
  const gradient = context.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, toRgbaString(rgb, resolvedAlpha * innerAlphaScale));
  gradient.addColorStop(
    clamp(Number(innerStop) || 0.1, 0.01, 0.92),
    toRgbaString(rgb, resolvedAlpha * Math.max(innerAlphaScale, midAlphaScale)),
  );
  gradient.addColorStop(
    clamp(Number(midStop) || 0.5, 0.08, 0.97),
    toRgbaString(rgb, resolvedAlpha * midAlphaScale),
  );
  gradient.addColorStop(1, toRgbaString(rgb, 0));
  context.fillStyle = gradient;
  context.beginPath();
  context.arc(0, 0, 1, 0, Math.PI * 2);
  context.fill();
  context.restore();
}

function getModernCityLightsZoomProfile() {
  const zoomScale = Math.max(0.0001, Number(state.zoomTransform?.k || 1));
  const fadeT = clamp((zoomScale - 1) / 2.5, 0, 1);
  const detailT = clamp((zoomScale - 0.9) / 1.6, 0, 1);
  return {
    zoomScale,
    fadeT,
    detailT,
    textureAlphaScale: 0.82 + (fadeT * 0.28),
    corridorAlphaScale: 0.88 + (fadeT * 0.32),
    textureRadiusScale: 1.24 + (detailT * 0.42),
    corridorRadiusScale: 1.16 + (detailT * 0.36),
    textureJitterStrength: 0.2 + (detailT * 0.06),
    corridorJitterStrength: 0.12 + (detailT * 0.04),
    coreAlphaScale: 0.86 + (fadeT * 0.52),
    coreRadiusScale: 1.08 + (detailT * 0.48),
  };
}

function getModernPopulationBoostStrength(config) {
  if (!config?.cityLightsPopulationBoostEnabled) return 0;
  return clamp(Number(config.cityLightsPopulationBoostStrength) || 0, 0, 1.5);
}

function getModernCityLightsPopulationBoostData() {
  const cityCollection = getEffectiveCityCollection();
  const urbanCollection = state.urbanData;
  const cityLayerRevision = Number(state.cityLayerRevision || 0);
  const scenarioId = String(state.activeScenarioId || "");
  if (
    modernCityLightsPopulationBoostCache.cityCollection === cityCollection
    && modernCityLightsPopulationBoostCache.urbanCollection === urbanCollection
    && modernCityLightsPopulationBoostCache.cityLayerRevision === cityLayerRevision
    && modernCityLightsPopulationBoostCache.scenarioId === scenarioId
  ) {
    return modernCityLightsPopulationBoostCache;
  }

  const urbanIndex = getUrbanFeatureIndex();
  const urbanEntriesById = new Map();
  const unmatchedCityEntries = [];
  if (Array.isArray(cityCollection?.features)) {
    cityCollection.features.forEach((feature) => {
      const props = feature?.properties || {};
      const population = Math.max(0, Number(props.__city_population || 0));
      const capitalScore = getCityCapitalScore(feature);
      const urbanInfo = getCityUrbanRuntimeInfo(feature, urbanIndex);
      if (urbanInfo.hasUrbanMatch) {
        const current = urbanEntriesById.get(urbanInfo.urbanMatchId) || {
          urbanId: urbanInfo.urbanMatchId,
          urbanFeature: urbanInfo.urbanFeature,
          populationSum: 0,
          cityCount: 0,
          capitalScore: 0,
        };
        current.populationSum += population;
        current.cityCount += 1;
        current.capitalScore = Math.max(current.capitalScore, capitalScore);
        urbanEntriesById.set(urbanInfo.urbanMatchId, current);
        return;
      }
      if (capitalScore > 0 || population >= 150000) {
        unmatchedCityEntries.push({
          feature,
          population,
          capitalScore,
        });
      }
    });
  }

  const urbanEntries = Array.from(urbanEntriesById.values())
    .map((entry) => {
      const areaSqKm = Math.max(
        0.01,
        Number(entry.urbanFeature?.properties?.area_sqkm ?? entry.urbanFeature?.properties?.AREA_SQKM ?? 0.01)
      );
      return {
        ...entry,
        areaSqKm,
        density: entry.populationSum / areaSqKm,
      };
    })
    .filter((entry) => entry.populationSum >= 100000 || entry.capitalScore > 0)
    .sort((left, right) => (
      (right.populationSum + (right.density * 1200))
      - (left.populationSum + (left.density * 1200))
    ));

  unmatchedCityEntries.sort((left, right) => (
    (right.population + (right.capitalScore * 1_000_000))
    - (left.population + (left.capitalScore * 1_000_000))
  ));

  modernCityLightsPopulationBoostCache.cityCollection = cityCollection;
  modernCityLightsPopulationBoostCache.urbanCollection = urbanCollection;
  modernCityLightsPopulationBoostCache.cityLayerRevision = cityLayerRevision;
  modernCityLightsPopulationBoostCache.scenarioId = scenarioId;
  modernCityLightsPopulationBoostCache.urbanEntries = urbanEntries;
  modernCityLightsPopulationBoostCache.cityEntries = unmatchedCityEntries;
  return modernCityLightsPopulationBoostCache;
}

function getSignedHashUnit(seed) {
  return (((stringHash(seed) >>> 0) % 2001) / 1000) - 1;
}

function getModernGridEntryJitter(entry, strength = 0.18) {
  const resolvedStrength = clamp(Number(strength) || 0, 0, 0.4);
  const dx = getSignedHashUnit(`${entry?.gridX ?? 0}:${entry?.gridY ?? 0}:x`)
    * Math.max(Number(entry?.rx) || 0, 0.0001)
    * resolvedStrength;
  const dy = getSignedHashUnit(`${entry?.gridX ?? 0}:${entry?.gridY ?? 0}:y`)
    * Math.max(Number(entry?.ry) || 0, 0.0001)
    * resolvedStrength;
  return { dx, dy };
}

function getModernCityLightLatitudeFade(gridY) {
  const cellLat = 90 - ((gridY + 0.5) * MODERN_CITY_LIGHTS_STEP_LAT_DEG);
  const absLat = Math.abs(cellLat);
  if (absLat <= 72) return 1;
  return clamp(1 - ((absLat - 72) / 16), 0.15, 1);
}

function drawModernCityLightsTexture(config, intensity) {
  const textureOpacity = clamp(Number(config.cityLightsTextureOpacity) || 0, 0, 1);
  if (textureOpacity <= 0) return;
  const palette = getNightLightPalette("modern");
  const geometry = getModernCityLightsGeometry();
  const zoomProfile = getModernCityLightsZoomProfile();
  const textureRgb = getLightBlobRgb(palette.texture);
  const overscan = Math.max(32, Math.min(state.width, state.height) * 0.06);

  geometry.baseEntries.forEach((entry) => {
    if (shouldCullModernLightEntry(entry, overscan)) return;
    const normalized = normalizeModernCityLightsValue(entry.value);
    const lumaWeight = Math.pow(normalized, 0.78);
    const densityDampen = entry.neighborCount >= 7 ? 0.72
      : entry.neighborCount >= 5 ? 0.84
      : 1.0;
    const isolationAlphaBoost = entry.neighborCount <= 1 ? 0.06 : 0;
    const latFade = getModernCityLightLatitudeFade(entry.gridY);
    const alpha = clamp(
      intensity
      * (0.38 + (textureOpacity * 1.04))
      * (0.08 + (lumaWeight * 0.36))
      * zoomProfile.textureAlphaScale
      * densityDampen
      * latFade,
      0,
      0.4
    );
    if (alpha <= 0.002) return;
    const jitter = getModernGridEntryJitter(entry, zoomProfile.textureJitterStrength);
    const isolationSpread = entry.neighborCount <= 1 ? 1.38
      : entry.neighborCount <= 3 ? 1.18
      : 1.0;
    const radiusScale = (zoomProfile.textureRadiusScale + 0.12 + (lumaWeight * 0.48)) * isolationSpread;
    const blobRx = entry.rx * radiusScale;
    const blobRy = entry.ry * radiusScale;
    drawSoftLightBlob(
      entry.x + jitter.dx,
      entry.y + jitter.dy,
      blobRx,
      blobRy,
      {
        rotation: entry.rotation,
        rgb: textureRgb,
        alpha,
        innerStop: 0.06,
        midStop: 0.7,
        innerAlphaScale: clamp(0.96 + isolationAlphaBoost, 0, 1.08),
        midAlphaScale: 0.28,
      }
    );
  });
}

function drawModernCityLightsCorridors(config, intensity) {
  const corridorStrength = clamp(Number(config.cityLightsCorridorStrength) || 0, 0, 1);
  if (corridorStrength <= 0) return;
  const palette = getNightLightPalette("modern");
  const geometry = getModernCityLightsGeometry();
  const zoomProfile = getModernCityLightsZoomProfile();
  const corridorRgb = getLightBlobRgb(palette.corridor);
  const overscan = Math.max(40, Math.min(state.width, state.height) * 0.08);

  geometry.corridorEntries.forEach((entry) => {
    if (shouldCullModernLightEntry(entry, overscan)) return;
    const normalized = normalizeModernCityLightsValue(entry.value);
    const corridorWeight = Math.pow(normalized, 0.82);
    const latFade = getModernCityLightLatitudeFade(entry.gridY);
    const alpha = clamp(
      intensity
      * (0.42 + (corridorStrength * 0.88))
      * (0.06 + (corridorWeight * 0.38))
      * zoomProfile.corridorAlphaScale
      * latFade,
      0,
      0.34
    );
    if (alpha <= 0.003) return;
    const jitter = getModernGridEntryJitter(entry, zoomProfile.corridorJitterStrength);
    const baseRadius = Math.max((entry.rx + entry.ry) * 0.5, 0.0001);
    const majorRadius = baseRadius
      * (zoomProfile.corridorRadiusScale + 0.2 + (corridorStrength * 0.36) + (corridorWeight * 0.42));
    drawSoftLightBlob(
      entry.x + jitter.dx,
      entry.y + jitter.dy,
      majorRadius,
      majorRadius * 1.02,
      {
        rotation: entry.rotation * 0.18,
        rgb: corridorRgb,
        alpha,
        innerStop: 0.05,
        midStop: 0.56,
        innerAlphaScale: 0.94,
        midAlphaScale: 0.3,
      }
    );
  });
}

function collectModernUrbanCoreEntries(k, config, intensity) {
  if (!Array.isArray(state.urbanData?.features) || !state.urbanData.features.length) return [];
  const textureOpacity = clamp(Number(config.cityLightsTextureOpacity) || 0, 0, 1);
  const coreSharpness = clamp(Number(config.cityLightsCoreSharpness) || 0, 0, 1);
  const transform = state.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
  const zoomProfile = getModernCityLightsZoomProfile();
  const zoomScale = Math.max(0.0001, Number(transform?.k || 1));
  const minProjectedAreaPx = zoomScale <= 1.15 ? 4.6 : zoomScale <= 1.7 ? 3.2 : 2.2;
  const overscan = Math.max(32, Math.min(state.width, state.height) * 0.06);
  const entries = [];

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
    const sampledBoost = clamp(0.56 + (Math.pow(sample, 0.52) * 1.4), 0.8, 1.8);
    const weight = clamp(heuristicWeight * sampledBoost, 0.06, 1.4);
    if (sample <= 0.01 && heuristicWeight < 0.34) return;
    if (weight < 0.16) return;
    if (zoomScale <= 1.35 && weight < 0.44) return;

    const centroid = pathCanvas.centroid(feature);
    const cx = Number(centroid?.[0]);
    const cy = Number(centroid?.[1]);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;

    const screenX = (cx * transform.k) + transform.x;
    const screenY = (cy * transform.k) + transform.y;
    if (
      screenX < -overscan ||
      screenX > state.width + overscan ||
      screenY < -overscan ||
      screenY > state.height + overscan
    ) {
      return;
    }

    const identitySeed = String(
      feature?.properties?.nameascii ||
      feature?.properties?.name ||
      feature?.properties?.NAME ||
      feature?.id ||
      `${cx}:${cy}`
    );
    const orientation = getSignedHashUnit(`${identitySeed}:rotation`) * (Math.PI / 60);
    const baseRadiusPx = 0.88 + (weight * (1.1 + (coreSharpness * 0.82)));
    const aspectRatio = clamp(1.04 + (coreSharpness * 0.06) + (sample * 0.06), 1.04, 1.18);
    const haloAlpha = clamp(
      intensity * weight * (0.14 + (textureOpacity * 0.18) + (sample * 0.22)) * zoomProfile.coreAlphaScale,
      0,
      0.32
    );
    const coreAlpha = clamp(
      intensity * weight * (0.42 + (coreSharpness * 0.38) + (sample * 0.34)) * zoomProfile.coreAlphaScale,
      0,
      0.48
    );
    entries.push({
      feature,
      cx,
      cy,
      screenX,
      screenY,
      weight,
      sample,
      orientation,
      baseRadiusPx,
      aspectRatio,
      haloAlpha,
      coreAlpha,
    });
  });
  return entries;
}

function drawModernCityLightsCores(k, _config, _intensity, coreEntries = null) {
  const palette = getNightLightPalette("modern");
  const zoomProfile = getModernCityLightsZoomProfile();
  const haloRgb = getLightBlobRgb(palette.halo);
  const coreRgb = getLightBlobRgb(palette.core);
  const entries = Array.isArray(coreEntries) ? coreEntries : [];
  entries.forEach((entry) => {
    drawSoftLightBlob(
      entry.cx,
      entry.cy,
      (entry.baseRadiusPx * entry.aspectRatio * 1.12 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      (entry.baseRadiusPx * 1.06 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      {
        rotation: entry.orientation,
        rgb: haloRgb,
        alpha: entry.haloAlpha,
        innerStop: 0.06,
        midStop: 0.58,
        innerAlphaScale: 0.94,
        midAlphaScale: 0.28,
      }
    );

    drawSoftLightBlob(
      entry.cx,
      entry.cy,
      (entry.baseRadiusPx * entry.aspectRatio * 0.94 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      (entry.baseRadiusPx * 0.88 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      {
        rotation: entry.orientation,
        rgb: coreRgb,
        alpha: entry.coreAlpha,
        innerStop: 0.04,
        midStop: 0.46,
        innerAlphaScale: 1,
        midAlphaScale: 0.46,
      }
    );
  });
}

function drawModernCityFallbackLights(k, config, intensity, urbanCoreEntries = []) {
  const cityCollection = getEffectiveCityCollection();
  if (!Array.isArray(cityCollection?.features) || !cityCollection.features.length) return;
  const palette = getNightLightPalette("modern");
  const coreSharpness = clamp(Number(config.cityLightsCoreSharpness) || 0, 0, 1);
  const zoomProfile = getModernCityLightsZoomProfile();
  const haloRgb = getLightBlobRgb(palette.halo);
  const coreRgb = getLightBlobRgb(palette.core);
  const zoomScale = Math.max(0.0001, Number(state.zoomTransform?.k || 1));
  const overscan = Math.max(28, Math.min(state.width, state.height) * 0.05);
  const urbanIndex = getUrbanFeatureIndex();
  const minPopulation = zoomScale <= 1.1 ? 60000 : zoomScale <= 1.8 ? 30000 : 15000;

  cityCollection.features.forEach((feature) => {
    const props = feature?.properties || {};
    const population = Math.max(0, Number(props.__city_population || 0));
    const isCapital = !!props.__city_is_country_capital;
    if (!isCapital && population < minPopulation) return;
    if (getCityUrbanRuntimeInfo(feature, urbanIndex).hasUrbanMatch) return;
    const anchor = getCityAnchor(feature);
    const screenPoint = getCityScreenPoint(anchor);
    if (!anchor || !screenPoint) return;
    if (
      screenPoint[0] < -overscan ||
      screenPoint[0] > state.width + overscan ||
      screenPoint[1] < -overscan ||
      screenPoint[1] > state.height + overscan
    ) {
      return;
    }
    const overlapsUrbanCore = urbanCoreEntries.some((entry) => (
      Math.hypot(entry.screenX - screenPoint[0], entry.screenY - screenPoint[1]) <= Math.max(18, entry.baseRadiusPx * 10)
    ));
    if (overlapsUrbanCore) return;

    const populationScore = clamp(Math.log10(population + 1) / 6.5, 0.18, 1);
    const geographicCoords = getCityGeoCoordinates(feature);
    const sample = geographicCoords
      ? sampleModernCityLightsGridNormalized(geographicCoords[0], geographicCoords[1])
      : 0;
    const weight = clamp(
      (isCapital ? 0.46 : 0.28) + (populationScore * 0.52) + (sample * 0.44),
      0.2,
      1.12
    );
    if (zoomScale <= 1.1 && weight < 0.45) return;

    const identitySeed = String(
      getCityCanonicalId(feature) ||
      props.name_en ||
      props.name ||
      feature?.id ||
      `${anchor[0]}:${anchor[1]}`
    );
    const orientation = getSignedHashUnit(`${identitySeed}:rotation`) * (Math.PI / 80);
    const baseRadiusPx = 0.58 + (weight * (0.82 + (coreSharpness * 0.46)));
    const aspectRatio = clamp(1.04 + (coreSharpness * 0.05) + (sample * 0.04), 1.04, 1.14);
    const haloAlpha = clamp(
      intensity * weight * (0.08 + (sample * 0.14)) * zoomProfile.coreAlphaScale,
      0,
      0.30
    );
    const coreAlpha = clamp(
      intensity * weight * (0.22 + (sample * 0.24)) * zoomProfile.coreAlphaScale,
      0,
      0.48
    );

    drawSoftLightBlob(
      anchor[0],
      anchor[1],
      (baseRadiusPx * aspectRatio * 1.14 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      (baseRadiusPx * 1.04 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      {
        rotation: orientation,
        rgb: haloRgb,
        alpha: haloAlpha,
        innerStop: 0.05,
        midStop: 0.54,
        innerAlphaScale: 0.92,
        midAlphaScale: 0.28,
      }
    );

    drawSoftLightBlob(
      anchor[0],
      anchor[1],
      (baseRadiusPx * aspectRatio * 0.98 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      (baseRadiusPx * 0.94 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      {
        rotation: orientation,
        rgb: coreRgb,
        alpha: coreAlpha,
        innerStop: 0.04,
        midStop: 0.42,
        innerAlphaScale: 1,
        midAlphaScale: 0.44,
      }
    );
  });
}

function drawModernCityLightsPopulationBoostLayer(k, config, intensity) {
  const boostStrength = getModernPopulationBoostStrength(config);
  if (boostStrength <= 0) return;
  const palette = getNightLightPalette("modern");
  const zoomProfile = getModernCityLightsZoomProfile();
  const haloRgb = getLightBlobRgb(palette.corridor);
  const coreRgb = getLightBlobRgb(palette.glint);
  const data = getModernCityLightsPopulationBoostData();
  const transform = state.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
  const overscan = Math.max(32, Math.min(state.width, state.height) * 0.06);

  data.urbanEntries.forEach((entry) => {
    const feature = entry.urbanFeature;
    if (!feature || !pathBoundsInScreen(feature)) return;
    const centroid = pathCanvas.centroid(feature);
    const cx = Number(centroid?.[0]);
    const cy = Number(centroid?.[1]);
    if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
    const screenX = (cx * transform.k) + transform.x;
    const screenY = (cy * transform.k) + transform.y;
    if (
      screenX < -overscan
      || screenX > state.width + overscan
      || screenY < -overscan
      || screenY > state.height + overscan
    ) {
      return;
    }

    const geographicCentroid = getFeatureGeoCentroid(feature);
    const sampled = geographicCentroid
      ? sampleModernCityLightsGridNormalized(geographicCentroid[0], geographicCentroid[1])
      : 0;
    const populationScore = clamp(Math.log10(entry.populationSum + 1) / 7.35, 0.12, 1.28);
    const densityScore = clamp(Math.log10(entry.density + 1) / 4.4, 0.08, 1.24);
    const capitalBoost = entry.capitalScore >= 3 ? 0.18 : entry.capitalScore >= 2 ? 0.1 : 0;
    const boostWeight = clamp(
      (populationScore * 0.72) + (densityScore * 0.96) + (sampled * 0.4) + capitalBoost,
      0.16,
      2
    );
    const areaRadiusBoost = clamp(Math.log10(entry.areaSqKm + 1) * 0.18, 0.08, 0.74);
    const baseRadiusPx = 0.82 + (boostWeight * 1.02) + areaRadiusBoost;
    const haloAlpha = clamp(
      intensity * boostStrength * (0.08 + (boostWeight * 0.16)) * zoomProfile.coreAlphaScale,
      0,
      0.36
    );
    const coreAlpha = clamp(
      intensity * boostStrength * (0.16 + (boostWeight * 0.24)) * zoomProfile.coreAlphaScale,
      0,
      0.54
    );
    const aspectRatio = clamp(1.06 + (sampled * 0.1), 1.06, 1.22);
    drawSoftLightBlob(
      cx,
      cy,
      (baseRadiusPx * aspectRatio * 1.14 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      (baseRadiusPx * 1.02 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      {
        rotation: 0,
        rgb: haloRgb,
        alpha: haloAlpha,
        innerStop: 0.05,
        midStop: 0.56,
        innerAlphaScale: 0.82,
        midAlphaScale: 0.2,
      }
    );
    drawSoftLightBlob(
      cx,
      cy,
      (baseRadiusPx * aspectRatio * 0.88 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      (baseRadiusPx * 0.82 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      {
        rotation: 0,
        rgb: coreRgb,
        alpha: coreAlpha,
        innerStop: 0.04,
        midStop: 0.46,
        innerAlphaScale: 0.94,
        midAlphaScale: 0.36,
      }
    );
  });

  data.cityEntries.forEach((entry) => {
    const anchor = getCityAnchor(entry.feature);
    const screenPoint = getCityScreenPoint(anchor);
    if (!anchor || !screenPoint) return;
    if (
      screenPoint[0] < -overscan
      || screenPoint[0] > state.width + overscan
      || screenPoint[1] < -overscan
      || screenPoint[1] > state.height + overscan
    ) {
      return;
    }
    const geographicCoords = getCityGeoCoordinates(entry.feature);
    const sampled = geographicCoords
      ? sampleModernCityLightsGridNormalized(geographicCoords[0], geographicCoords[1])
      : 0;
    const populationScore = clamp(Math.log10(entry.population + 1) / 6.8, 0.12, 1.08);
    const capitalBoost = entry.capitalScore >= 3 ? 0.24 : entry.capitalScore >= 2 ? 0.14 : 0;
    const boostWeight = clamp((populationScore * 0.96) + (sampled * 0.48) + capitalBoost, 0.18, 1.48);
    const baseRadiusPx = 0.54 + (boostWeight * 0.72);
    const haloAlpha = clamp(
      intensity * boostStrength * (0.06 + (boostWeight * 0.11)) * zoomProfile.coreAlphaScale,
      0,
      0.24
    );
    const coreAlpha = clamp(
      intensity * boostStrength * (0.12 + (boostWeight * 0.18)) * zoomProfile.coreAlphaScale,
      0,
      0.40
    );
    drawSoftLightBlob(
      anchor[0],
      anchor[1],
      (baseRadiusPx * 1.22 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      (baseRadiusPx * 1.08 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      {
        rotation: 0,
        rgb: haloRgb,
        alpha: haloAlpha,
        innerStop: 0.05,
        midStop: 0.5,
        innerAlphaScale: 0.82,
        midAlphaScale: 0.2,
      }
    );
    drawSoftLightBlob(
      anchor[0],
      anchor[1],
      (baseRadiusPx * 0.98 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      (baseRadiusPx * 0.94 * zoomProfile.coreRadiusScale) / Math.max(0.0001, k),
      {
        rotation: 0,
        rgb: coreRgb,
        alpha: coreAlpha,
        innerStop: 0.04,
        midStop: 0.4,
        innerAlphaScale: 0.94,
        midAlphaScale: 0.36,
      }
    );
  });
}

function drawModernNightLightsLayer(k, config, solarState) {
  const nightHemisphere = buildNightHemisphereFeature(solarState, 90);
  if (!nightHemisphere) return;
  const intensity = clamp(Number(config.cityLightsIntensity) || 0, 0, 1.8);
  if (intensity <= 0) return;

  context.save();
  context.beginPath();
  pathCanvas(nightHemisphere);
  context.clip();
  context.globalCompositeOperation = getSafeBlendMode("screen", "lighter");
  drawModernCityLightsTexture(config, intensity);
  drawModernCityLightsCorridors(config, intensity);
  const urbanCoreEntries = collectModernUrbanCoreEntries(k, config, intensity);
  drawModernCityLightsCores(k, config, intensity, urbanCoreEntries);
  drawModernCityFallbackLights(k, config, intensity, urbanCoreEntries);
  drawModernCityLightsPopulationBoostLayer(k, config, intensity);
  context.restore();
}

const historicalCityLightsFallbackCache = {
  cityCollection: null,
  cityLayerRevision: -1,
  scenarioId: "",
  entries: [],
};

function getHistoricalCityLightCapitalBoost(capitalKind = "") {
  const normalizedKind = String(capitalKind || "").trim().toLowerCase();
  if (normalizedKind === "country_capital") return 0.16;
  if (normalizedKind === "admin_capital") return 0.08;
  return 0;
}

function sanitizeHistoricalCityLightEntry(rawEntry) {
  const lon = normalizeLongitude(Number(rawEntry?.lon));
  const lat = clamp(Number(rawEntry?.lat), -89.999, 89.999);
  const weight = clamp(Number(rawEntry?.weight), 0, 1.08);
  if (!Number.isFinite(lon) || !Number.isFinite(lat) || weight <= 0) {
    return null;
  }
  return {
    lon,
    lat,
    weight,
    capitalKind: String(rawEntry?.capitalKind || rawEntry?.capital_kind || "").trim().toLowerCase(),
    population: Math.max(0, Number(rawEntry?.population || 0)),
    nameAscii: String(rawEntry?.nameAscii || rawEntry?.name_ascii || rawEntry?.name || "").trim(),
  };
}

function shouldRenderHistoricalCityLightEntry(entry) {
  const capitalKind = String(entry?.capitalKind || "").trim().toLowerCase();
  const population = Math.max(0, Number(entry?.population || 0));
  const weight = clamp(Number(entry?.weight || 0), 0, 1.08);
  if (capitalKind === "country_capital") {
    return true;
  }
  if (capitalKind === "admin_capital") {
    return population >= 1000000 || weight >= 0.7;
  }
  return population >= 2200000 || weight >= 0.8;
}

function getHistoricalProxyAssetEntries() {
  if (!Array.isArray(HISTORICAL_1930_CITY_LIGHTS_ENTRIES) || !HISTORICAL_1930_CITY_LIGHTS_ENTRIES.length) {
    return [];
  }
  return HISTORICAL_1930_CITY_LIGHTS_ENTRIES
    .map(sanitizeHistoricalCityLightEntry)
    .filter((entry) => shouldRenderHistoricalCityLightEntry(entry))
    .filter(Boolean);
}

function computeHistoricalFallbackCityLightWeight(feature) {
  const props = feature?.properties || {};
  const population = Math.max(
    0,
    Number(
      props.__city_population
      ?? props.population
      ?? props.pop_max
      ?? props.POP_MAX
      ?? 0
    )
  );
  const isCountryCapital = !!(props.__city_is_country_capital ?? props.is_country_capital);
  const isAdminCapital = !!(props.__city_is_admin_capital ?? props.is_admin_capital);
  const baseTier = String(props.__city_base_tier || props.base_tier || "").trim().toLowerCase();
  const tierBoost = baseTier === "major" ? 0.1 : baseTier === "regional" ? 0.04 : 0;
  const scalerank = clamp(
    Math.round(Number(props.__city_scalerank ?? props.scalerank ?? props.SCALERANK ?? 8)) || 8,
    1,
    10
  );
  const rankBoost = scalerank <= 3 ? 0.06 : 0;
  const populationScore = clamp(Math.log10(population + 1) / 7.1, 0.16, 1);
  const capitalBoost = isCountryCapital ? 0.34 : isAdminCapital ? 0.2 : 0;
  return clamp((populationScore * 0.74) + capitalBoost + tierBoost + rankBoost, 0.18, 1.02);
}

function shouldIncludeHistoricalFallbackCity(feature) {
  const props = feature?.properties || {};
  if (!!(props.__city_is_country_capital ?? props.is_country_capital)) return true;
  if (
    !!(props.__city_is_admin_capital ?? props.is_admin_capital)
    && Math.max(
      0,
      Number(
        props.__city_population
        ?? props.population
        ?? props.pop_max
        ?? props.POP_MAX
        ?? 0
      )
    ) >= 2000000
  ) {
    return true;
  }
  const scalerank = clamp(
    Math.round(Number(props.__city_scalerank ?? props.scalerank ?? props.SCALERANK ?? 8)) || 8,
    1,
    10
  );
  if (scalerank <= 1) return true;
  const population = Math.max(
    0,
    Number(
      props.__city_population
      ?? props.population
      ?? props.pop_max
      ?? props.POP_MAX
      ?? 0
    )
  );
  return population >= 4200000;
}

function getHistoricalProxyFallbackEntries() {
  const cityCollection = getEffectiveCityCollection();
  const cityLayerRevision = Number(state.cityLayerRevision || 0);
  const scenarioId = String(state.activeScenarioId || "");
  if (
    historicalCityLightsFallbackCache.cityCollection === cityCollection
    && historicalCityLightsFallbackCache.cityLayerRevision === cityLayerRevision
    && historicalCityLightsFallbackCache.scenarioId === scenarioId
  ) {
    return historicalCityLightsFallbackCache.entries;
  }

  const entries = Array.isArray(cityCollection?.features)
    ? cityCollection.features
      .filter((feature) => shouldIncludeHistoricalFallbackCity(feature))
      .map((feature) => {
        const coordinates = getCityGeoCoordinates(feature);
        if (!coordinates) return null;
        const props = feature?.properties || {};
        return sanitizeHistoricalCityLightEntry({
          lon: coordinates[0],
          lat: coordinates[1],
          weight: computeHistoricalFallbackCityLightWeight(feature),
          capitalKind: props.__city_capital_kind || props.capital_kind || "",
          population: props.__city_population ?? props.population ?? 0,
          nameAscii: props.name_ascii || props.__city_name_ascii || props.name_en || props.name || "",
        });
      })
      .filter((entry) => shouldRenderHistoricalCityLightEntry(entry))
      .filter(Boolean)
      .sort((left, right) => right.weight - left.weight)
    : [];

  historicalCityLightsFallbackCache.cityCollection = cityCollection;
  historicalCityLightsFallbackCache.cityLayerRevision = cityLayerRevision;
  historicalCityLightsFallbackCache.scenarioId = scenarioId;
  historicalCityLightsFallbackCache.entries = entries;
  return entries;
}

function getHistoricalNightLightEntries() {
  const assetEntries = getHistoricalProxyAssetEntries();
  if (assetEntries.length) {
    return assetEntries;
  }
  return getHistoricalProxyFallbackEntries();
}

function drawHistoricalNightLightsLayer(k, config, solarState) {
  const historicalEntries = getHistoricalNightLightEntries();
  if (!historicalEntries.length) {
    return;
  }
  const nightHemisphere = buildNightHemisphereFeature(solarState, 90);
  if (!nightHemisphere) return;

  const variant = "historical_1930s";
  const intensity = clamp(Number(config.cityLightsIntensity) || 0, 0, 1.2);
  if (intensity <= 0) return;
  const palette = getNightLightPalette(variant);
  const overscan = Math.max(24, Math.min(state.width, state.height) * 0.05);

  context.save();
  context.beginPath();
  pathCanvas(nightHemisphere);
  context.clip();
  context.globalCompositeOperation = getSafeBlendMode("screen", "lighter");

  historicalEntries.forEach((entry) => {
    const projected = projection ? projection([entry.lon, entry.lat]) : null;
    if (!Array.isArray(projected) || !projected.every((value) => Number.isFinite(Number(value)))) return;
    const weight = clamp(Number(entry.weight || 0), 0, 1.08);
    if (weight <= 0) return;

    const cx = Number(projected[0]);
    const cy = Number(projected[1]);

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

    const capitalBoost = getHistoricalCityLightCapitalBoost(entry.capitalKind);
    const baseRadiusPx = 0.52 + (weight * (0.68 + (capitalBoost * 0.28)));
    const haloRadiusPx = baseRadiusPx * (1.24 + (capitalBoost * 0.3));
    const haloAlpha = clamp(intensity * weight * 0.12, 0, 0.28);
    const coreAlpha = clamp(intensity * weight * 0.22, 0, 0.52);
    const orientation = (stringHash(
      entry.nameAscii ||
      `${entry.lon}:${entry.lat}`
    ) % 180) * (Math.PI / 180);

    context.fillStyle = palette.halo;
    context.globalAlpha = haloAlpha;
    drawLightEllipse(
      cx,
      cy,
      (haloRadiusPx * 1.04) / Math.max(0.0001, k),
      (haloRadiusPx * 0.78) / Math.max(0.0001, k),
      orientation
    );

    context.fillStyle = palette.core;
    context.globalAlpha = coreAlpha;
    drawLightEllipse(
      cx,
      cy,
      baseRadiusPx / Math.max(0.0001, k),
      (baseRadiusPx * 0.64) / Math.max(0.0001, k),
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
    if (state.renderPhase !== RENDER_PHASE_IDLE) {
      state.pendingDayNightRefresh = true;
      return;
    }
    invalidateRenderPasses("dayNight", "day-night-clock");
    requestRendererRender("day-night-clock", {
      fallback: () => {
        if (context) {
          render();
        }
      },
    });
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
  if (!isBootInteractionReady()) return;
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
    Array.isArray((state.landDataFull || state.landData)?.features) &&
    (state.landDataFull || state.landData).features.length
  );
}

function shouldFallbackScenarioPoliticalBackgroundMergeShape(
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
      `[map_renderer] Scenario political background merge fallback engaged: scenario=${scenarioId || "(none)"} view=${viewMode} owner=${displayCode || "(unknown)"} fill=${fillColor || "(none)"} group=${groupSize} area=${areaText}`
    );
  }
  return true;
}

function getScenarioPoliticalBackgroundCacheKey({
  canvasWidth = 0,
  canvasHeight = 0,
} = {}) {
  return [
    String(state.activeScenarioId || ""),
    String(state.scenarioViewMode || "ownership"),
    getAtlantropaSeaPoliticalFillColor(),
    Number(state.sovereigntyRevision || 0),
    Number(state.scenarioControllerRevision || 0),
    Number(state.scenarioShellOverlayRevision || 0),
    Number(state.colorRevision || 0),
    Math.round(Number(canvasWidth || 0)),
    Math.round(Number(canvasHeight || 0)),
  ].join("::");
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

  const landCollection = state.landDataFull || state.landData;
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  const featureCount = Array.isArray(landCollection?.features) ? landCollection.features.length : 0;
  const cacheKey = getScenarioPoliticalBackgroundCacheKey({
    canvasWidth,
    canvasHeight,
  });
  if (
    scenarioPoliticalBackgroundCache.runtimeRef === landCollection
    && scenarioPoliticalBackgroundCache.cacheKey === cacheKey
  ) {
    recordRenderPerfMetric("drawScenarioPoliticalBackgroundEntries", nowMs() - startedAt, {
      cacheHit: true,
      entryCount: scenarioPoliticalBackgroundCache.entries.length,
      featureCount,
    });
    return scenarioPoliticalBackgroundCache.entries;
  }

  const entries = [];
  (landCollection?.features || []).forEach((feature, index) => {
    const id = getFeatureId(feature) || `feature-${index}`;
    if (!feature?.geometry) return;
    if (isAntarcticSectorFeature(feature, id)) return;
    if (isBaseGeographyScenarioFeature(feature)) return;
    if (shouldSkipFeature(feature, canvasWidth, canvasHeight, { forceProd: true })) return;
    const projectedBounds = getProjectedFeatureBounds(feature, {
      featureId: id,
      allowCompute: true,
    });
    if (!pathBoundsInScreen(feature)) return;
    entries.push({
      feature,
      index,
      id,
      projectedBounds,
    });
  });
  if (!entries.length) {
    scenarioPoliticalBackgroundCache = {
      runtimeRef: landCollection,
      scenarioId: state.activeScenarioId || "",
      viewMode: String(state.scenarioViewMode || "ownership"),
      oceanFillColor: getAtlantropaSeaPoliticalFillColor(),
      sovereigntyRevision: Number(state.sovereigntyRevision || 0),
      controllerRevision: Number(state.scenarioControllerRevision || 0),
      shellRevision: Number(state.scenarioShellOverlayRevision || 0),
      colorRevision: Number(state.colorRevision || 0),
      canvasWidth,
      canvasHeight,
      cacheKey,
      entries: [],
    };
    recordRenderPerfMetric("drawScenarioPoliticalBackgroundEntries", nowMs() - startedAt, {
      cacheHit: false,
      entryCount: 0,
      featureCount,
    });
    return scenarioPoliticalBackgroundCache.entries;
  }

  scenarioPoliticalBackgroundCache = {
    runtimeRef: landCollection,
    scenarioId: state.activeScenarioId || "",
    viewMode: String(state.scenarioViewMode || "ownership"),
    oceanFillColor: getAtlantropaSeaPoliticalFillColor(),
    sovereigntyRevision: Number(state.sovereigntyRevision || 0),
    controllerRevision: Number(state.scenarioControllerRevision || 0),
    shellRevision: Number(state.scenarioShellOverlayRevision || 0),
    colorRevision: Number(state.colorRevision || 0),
    canvasWidth,
    canvasHeight,
    cacheKey,
    entries,
  };
  recordRenderPerfMetric("drawScenarioPoliticalBackgroundEntries", nowMs() - startedAt, {
    cacheHit: false,
    entryCount: entries.length,
    featureCount,
  });
  return entries;
}

function drawScenarioPoliticalBackgroundFills({
  screenRects = null,
  transform = state.zoomTransform || globalThis.d3?.zoomIdentity,
} = {}) {
  const entries = buildScenarioPoliticalBackgroundEntries();
  if (!entries.length) return;
  const visibleEntries = entries.filter(({ projectedBounds }) =>
    projectedBoundsIntersectScreenRects(projectedBounds, screenRects, { transform })
  );
  drawPoliticalBackgroundFillsForEntries(visibleEntries);
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
      const mergedFeature = {
        type: "Feature",
        properties: {
          id: `admin0-background-${code}`,
          cntr_code: code,
        },
        geometry: mergedShape,
      };
      entries.push({
        code,
        mergedShape,
        mergedFeature,
        projectedBounds: getProjectedFeatureBounds(mergedFeature, { allowCompute: true }),
      });
    } catch (_e) {
      // Skip countries that fail to merge
    }
  });

  admin0MergedCache = { topologyRef: topology, featureCount: currentFeatureCount, entries };
  return entries;
}

function drawAdmin0BackgroundFills({
  screenRects = null,
  transform = state.zoomTransform || globalThis.d3?.zoomIdentity,
} = {}) {
  const entries = buildAdmin0MergedShapes();
  if (!entries.length) return;

  entries.forEach(({ code, mergedShape, mergedFeature, projectedBounds }) => {
    if (code === "ATL") return;
    if (!projectedBoundsIntersectScreenRects(projectedBounds, screenRects, { transform })) {
      return;
    }
    const color =
      (state.sovereignBaseColors && state.sovereignBaseColors[code]) ||
      (state.countryBaseColors && state.countryBaseColors[code]) ||
      null;
    const fillColor = getSafeCanvasColor(color, null) || LAND_FILL_COLOR;

    context.beginPath();
    pathCanvas(mergedFeature || {
      type: "Feature",
      properties: {
        id: `admin0-background-${code}`,
        cntr_code: code,
      },
      geometry: mergedShape,
    });
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

function getCachedPoliticalPassStaticSignature(signature) {
  const parts = String(signature || "").split("::");
  return parts.length > 1 ? parts.slice(1).join("::") : "";
}

function getFeatureScreenBounds(feature, {
  featureId = null,
  transform = state.zoomTransform || globalThis.d3?.zoomIdentity,
  allowCompute = true,
  padding = 0,
} = {}) {
  const bounds = getProjectedFeatureBounds(feature, { featureId, allowCompute });
  if (!bounds) return null;
  const normalizedTransform = cloneZoomTransform(transform);
  const rawMinX = bounds.minX * normalizedTransform.k + normalizedTransform.x;
  const rawMinY = bounds.minY * normalizedTransform.k + normalizedTransform.y;
  const rawMaxX = bounds.maxX * normalizedTransform.k + normalizedTransform.x;
  const rawMaxY = bounds.maxY * normalizedTransform.k + normalizedTransform.y;
  if (![rawMinX, rawMinY, rawMaxX, rawMaxY].every(Number.isFinite)) {
    return null;
  }
  const normalizedPadding = Math.max(0, Number(padding || 0));
  const minX = rawMinX - normalizedPadding;
  const minY = rawMinY - normalizedPadding;
  const maxX = rawMaxX + normalizedPadding;
  const maxY = rawMaxY + normalizedPadding;
  return {
    x: minX,
    y: minY,
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function getScreenBoundsFromProjectedBounds(projectedBounds, {
  transform = state.zoomTransform || globalThis.d3?.zoomIdentity,
  padding = 0,
} = {}) {
  if (!projectedBounds) return null;
  const normalizedTransform = cloneZoomTransform(transform);
  const rawMinX = Number(projectedBounds.minX) * normalizedTransform.k + normalizedTransform.x;
  const rawMinY = Number(projectedBounds.minY) * normalizedTransform.k + normalizedTransform.y;
  const rawMaxX = Number(projectedBounds.maxX) * normalizedTransform.k + normalizedTransform.x;
  const rawMaxY = Number(projectedBounds.maxY) * normalizedTransform.k + normalizedTransform.y;
  if (![rawMinX, rawMinY, rawMaxX, rawMaxY].every(Number.isFinite)) {
    return null;
  }
  const normalizedPadding = Math.max(0, Number(padding || 0));
  const minX = rawMinX - normalizedPadding;
  const minY = rawMinY - normalizedPadding;
  const maxX = rawMaxX + normalizedPadding;
  const maxY = rawMaxY + normalizedPadding;
  return {
    x: minX,
    y: minY,
    minX,
    minY,
    maxX,
    maxY,
    width: Math.max(0, maxX - minX),
    height: Math.max(0, maxY - minY),
  };
}

function rectsIntersect(a, b) {
  if (!a || !b) return false;
  return !(
    a.maxX < b.minX ||
    a.maxY < b.minY ||
    a.minX > b.maxX ||
    a.minY > b.maxY
  );
}

function projectedRectsIntersect(a, b) {
  if (!a || !b) return false;
  return !(
    Number(a.maxX) < Number(b.minX) ||
    Number(a.maxY) < Number(b.minY) ||
    Number(a.minX) > Number(b.maxX) ||
    Number(a.minY) > Number(b.maxY)
  );
}

function mergeIntersectingRects(rects = []) {
  const pending = Array.isArray(rects) ? rects.filter(Boolean).map((rect) => ({ ...rect })) : [];
  const merged = [];
  while (pending.length) {
    const next = pending.pop();
    if (!next) continue;
    let changed = true;
    while (changed) {
      changed = false;
      for (let index = pending.length - 1; index >= 0; index -= 1) {
        const candidate = pending[index];
        if (!rectsIntersect(next, candidate)) continue;
        next.minX = Math.min(next.minX, candidate.minX);
        next.minY = Math.min(next.minY, candidate.minY);
        next.maxX = Math.max(next.maxX, candidate.maxX);
        next.maxY = Math.max(next.maxY, candidate.maxY);
        next.x = next.minX;
        next.y = next.minY;
        next.width = Math.max(0, next.maxX - next.minX);
        next.height = Math.max(0, next.maxY - next.minY);
        pending.splice(index, 1);
        changed = true;
      }
    }
    merged.push(next);
  }
  return merged;
}

function getViewportCoverageForRects(rects = []) {
  const viewportArea = Math.max(1, Number(state.width || 1) * Number(state.height || 1));
  const coveredArea = (Array.isArray(rects) ? rects : []).reduce((sum, rect) => {
    if (!rect) return sum;
    const minX = clamp(rect.minX, 0, Number(state.width || 0));
    const minY = clamp(rect.minY, 0, Number(state.height || 0));
    const maxX = clamp(rect.maxX, 0, Number(state.width || 0));
    const maxY = clamp(rect.maxY, 0, Number(state.height || 0));
    if (maxX <= minX || maxY <= minY) return sum;
    return sum + ((maxX - minX) * (maxY - minY));
  }, 0);
  return clamp(coveredArea / viewportArea, 0, 1);
}

function screenRectToProjectedRect(rect, transform = state.zoomTransform || globalThis.d3?.zoomIdentity) {
  if (!rect) return null;
  const normalizedTransform = cloneZoomTransform(transform);
  const minX = (Number(rect.minX ?? rect.x ?? 0) - normalizedTransform.x) / normalizedTransform.k;
  const minY = (Number(rect.minY ?? rect.y ?? 0) - normalizedTransform.y) / normalizedTransform.k;
  const maxX = (Number(rect.maxX ?? ((rect.x || 0) + (rect.width || 0))) - normalizedTransform.x) / normalizedTransform.k;
  const maxY = (Number(rect.maxY ?? ((rect.y || 0) + (rect.height || 0))) - normalizedTransform.y) / normalizedTransform.k;
  if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
    return null;
  }
  return {
    minX: Math.min(minX, maxX),
    minY: Math.min(minY, maxY),
    maxX: Math.max(minX, maxX),
    maxY: Math.max(minY, maxY),
  };
}

function screenRectToPassRect(rect, layout) {
  if (!rect || !layout) return null;
  const minX = clamp(Number(rect.minX || rect.x || 0) + Number(layout.offsetX || 0), 0, Number(layout.paddedWidth || 0));
  const minY = clamp(Number(rect.minY || rect.y || 0) + Number(layout.offsetY || 0), 0, Number(layout.paddedHeight || 0));
  const maxX = clamp(Number(rect.maxX || ((rect.x || 0) + (rect.width || 0))) + Number(layout.offsetX || 0), 0, Number(layout.paddedWidth || 0));
  const maxY = clamp(Number(rect.maxY || ((rect.y || 0) + (rect.height || 0))) + Number(layout.offsetY || 0), 0, Number(layout.paddedHeight || 0));
  if (maxX <= minX || maxY <= minY) return null;
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function projectedBoundsIntersectScreenRects(projectedBounds, screenRects, {
  transform = state.zoomTransform || globalThis.d3?.zoomIdentity,
  padding = 0,
} = {}) {
  if (!Array.isArray(screenRects) || !screenRects.length) return true;
  const screenBounds = getScreenBoundsFromProjectedBounds(projectedBounds, { transform, padding });
  if (!screenBounds) return false;
  return screenRects.some((rect) => rectsIntersect(rect, screenBounds));
}

function collectLandSpatialItemsForProjectedRects(projectedRects = [], { maxCandidates = Infinity } = {}) {
  const meta = state.spatialGridMeta;
  const grid = state.spatialGrid;
  if (!meta || !grid || !Array.isArray(state.spatialItems)) return null;
  const { cellSize, cols, rows, globals } = meta;
  if (!cellSize || cols <= 0 || rows <= 0) return null;
  const normalizedRects = (Array.isArray(projectedRects) ? projectedRects : []).filter(Boolean);
  if (!normalizedRects.length) return { items: [], overflow: false };
  const seen = new Set();
  const candidateItems = [];
  let overflow = false;
  const maybePush = (item) => {
    if (overflow || !item?.id || seen.has(item.id)) return;
    seen.add(item.id);
    if (!normalizedRects.some((rect) => projectedRectsIntersect(item, rect))) return;
    candidateItems.push(item);
    if (candidateItems.length > maxCandidates) {
      overflow = true;
    }
  };
  normalizedRects.forEach((rect) => {
    const c0 = clamp(Math.floor(Number(rect.minX || 0) / cellSize), 0, cols - 1);
    const c1 = clamp(Math.floor(Number(rect.maxX || 0) / cellSize), 0, cols - 1);
    const r0 = clamp(Math.floor(Number(rect.minY || 0) / cellSize), 0, rows - 1);
    const r1 = clamp(Math.floor(Number(rect.maxY || 0) / cellSize), 0, rows - 1);
    for (let row = r0; row <= r1; row += 1) {
      for (let col = c0; col <= c1; col += 1) {
        const bucket = grid.get(getSpatialBucketKey(col, row));
        bucket?.forEach(maybePush);
      }
    }
  });
  globals?.forEach(maybePush);
  candidateItems.sort((left, right) => (left?.drawOrder ?? 0) - (right?.drawOrder ?? 0));
  return {
    items: candidateItems,
    overflow,
  };
}

function drawPoliticalBackgroundFills(options = {}) {
  if (debugMode !== "PROD") return;
  if (shouldUseScenarioPoliticalBackgroundMerge()) {
    drawScenarioPoliticalBackgroundFills(options);
    return;
  }
  drawAdmin0BackgroundFills(options);
}

function drawPoliticalBackgroundFillsForEntries(entries = []) {
  if (debugMode !== "PROD") return 0;
  const groupedEntries = new Map();
  (Array.isArray(entries) ? entries : []).forEach(({ feature, index, id, path = null }) => {
    if (!feature?.geometry) return;
    const resolvedId = String(id || getFeatureId(feature) || `feature-${index}`);
    const fillColor =
      (isAtlantropaSeaFeature(feature)
        ? getAtlantropaSeaPoliticalFillColor()
        : null) ||
      getSafeCanvasColor(state.colors?.[resolvedId], null) ||
      getSafeCanvasColor(getResolvedFeatureColor(feature, resolvedId), null) ||
      LAND_FILL_COLOR;
    const displayCode = shouldUseScenarioPoliticalBackgroundMerge()
      ? (
        getDisplayOwnerCode(feature, resolvedId) ||
        getFeatureCountryCodeNormalized(feature) ||
        "__NONE__"
      )
      : (
        getFeatureCountryCodeNormalized(feature) ||
        "__NONE__"
      );
    const groupKey = `${displayCode}::${fillColor}`;
    if (!groupedEntries.has(groupKey)) {
      groupedEntries.set(groupKey, {
        fillColor,
        entries: [],
      });
    }
    groupedEntries.get(groupKey).entries.push({ feature, path });
  });
  groupedEntries.forEach(({ fillColor, entries: groupEntries }) => {
    const resolvedEntries = Array.isArray(groupEntries) ? groupEntries.filter(Boolean) : [];
    if (!resolvedEntries.length) return;
    let filled = false;
    if (resolvedEntries.length === 1 && resolvedEntries[0]?.path) {
      context.fillStyle = fillColor;
      context.fill(resolvedEntries[0].path);
      filled = true;
    } else if (
      globalThis.Path2D
      && typeof globalThis.Path2D.prototype?.addPath === "function"
      && resolvedEntries.every((entry) => entry?.path)
    ) {
      const mergedPath = new globalThis.Path2D();
      resolvedEntries.forEach((entry) => {
        mergedPath.addPath(entry.path);
      });
      context.fillStyle = fillColor;
      context.fill(mergedPath);
      filled = true;
    }
    if (filled) return;
    context.beginPath();
    resolvedEntries.forEach((entry) => {
      pathCanvas(entry.feature);
    });
    context.fillStyle = fillColor;
    context.fill();
  });
  return groupedEntries.size;
}

function drawPoliticalFeature(
  feature,
  index,
  {
    k,
    canvasWidth,
    canvasHeight,
    islandNeighbors = null,
    skipScreenCheck = false,
    path = null,
    transform = state.zoomTransform || globalThis.d3?.zoomIdentity,
    useCachedPath = true,
    allowBuildPath = false,
    countPathBuild = false,
  } = {},
) {
  const id = getFeatureId(feature) || `feature-${index}`;
  if (shouldExcludePoliticalInteractionFeature(feature, id)) return false;
  if (shouldSkipFeature(feature, canvasWidth, canvasHeight)) return false;
  if (!skipScreenCheck && !pathBoundsInScreen(feature)) return false;
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

  const cachedPath =
    path
    || (useCachedPath
      ? getPoliticalFeaturePathEntry(feature, {
        featureId: id,
        transform,
        allowBuild: allowBuildPath,
        countBuild: countPathBuild,
      })?.path
      : null)
    || null;
  context.fillStyle = fillColor;
  if (cachedPath) {
    context.fill(cachedPath);
  } else {
    context.beginPath();
    pathCanvas(feature);
    context.fill();
  }

  if (debugMode === "PROD") {
    context.strokeStyle = isAtlantropaSea
      ? getAtlantropaSeaPoliticalStrokeColor()
      : fillColor;
    context.lineWidth = 0.75 / Math.max(0.0001, k);
    context.lineJoin = "round";
    context.lineCap = "round";
    if (cachedPath) {
      context.stroke(cachedPath);
    } else {
      context.stroke();
    }
  }
  return true;
}

function tryPartialPoliticalPassRepaint(transform, nextSignature, timings) {
  const cache = getRenderPassCacheState();
  const dirtyIds = Array.from(cache.partialPoliticalDirtyIds || []).filter(Boolean);
  const dirtyFeatureCount = dirtyIds.length;
  const fallback = (fallbackReason, details = {}) => {
    incrementPerfCounter("politicalPartialFallbacks");
    recordRenderPerfMetric("politicalPartialRepaint", 0, {
      applied: false,
      dirtyFeatureCount,
      dirtyRectCount: 0,
      viewportCoverage: 0,
      candidateCount: 0,
      pathCacheMisses: 0,
      pathCacheMissRatio: 0,
      fallbackReason,
      ...details,
    });
    return false;
  };
  if (state.renderPhase !== RENDER_PHASE_IDLE || state.deferExactAfterSettle) {
    return fallback("non-idle-phase");
  }
  if (debugMode !== "PROD") {
    return fallback("non-prod-mode");
  }
  if (!["refresh-colors", "rebuild-colors"].includes(String(cache.reasons?.political || ""))) {
    return fallback("non-color-invalidation");
  }
  if (!dirtyFeatureCount) {
    return fallback("no-dirty-features");
  }
  if (dirtyFeatureCount > POLITICAL_PARTIAL_REPAINT_FEATURE_THRESHOLD) {
    return fallback("dirty-feature-threshold");
  }
  const passCanvas = cache.canvases?.political;
  const passContext = passCanvas?.getContext?.("2d");
  if (!passCanvas || !passContext) {
    return fallback("missing-pass-canvas");
  }
  const layout = getRenderPassLayout("political");
  if (passCanvas.width !== layout.pixelWidth || passCanvas.height !== layout.pixelHeight) {
    return fallback("layout-mismatch");
  }
  const referenceTransform = getPassReferenceTransform("political");
  if (!referenceTransform || !areZoomTransformsEquivalent(referenceTransform, transform)) {
    return fallback("reference-transform-mismatch");
  }
  if (getCachedPoliticalPassStaticSignature(cache.signatures?.political) !== getCachedPoliticalPassStaticSignature(nextSignature)) {
    return fallback("static-signature-mismatch");
  }

  const canvasWidth = Math.max(Number(layout.paddedWidth || 0), Number(state.width || 0), 1);
  const canvasHeight = Math.max(Number(layout.paddedHeight || 0), Number(state.height || 0), 1);
  const dirtyRects = [];
  dirtyIds.forEach((id) => {
    const feature = state.landIndex?.get(id);
    if (!feature) {
      dirtyRects.push(null);
      return;
    }
    if (shouldExcludePoliticalInteractionFeature(feature, id)) return;
    if (shouldSkipFeature(feature, canvasWidth, canvasHeight)) return;
    const rect = getFeatureScreenBounds(feature, {
      featureId: id,
      transform,
      padding: POLITICAL_PARTIAL_REPAINT_PAD_PX,
    });
    if (!rect) {
      dirtyRects.push(null);
      return;
    }
    dirtyRects.push(rect);
  });
  if (dirtyRects.some((rect) => !rect)) {
    return fallback("missing-dirty-bounds");
  }
  if (!dirtyRects.length) {
    cache.signatures.political = nextSignature;
    cache.dirty.political = false;
    cache.partialPoliticalDirtyIds.clear();
    cache.reasons.political = "partial-noop";
    setPassReferenceTransform("political", transform);
    incrementPerfCounter("politicalPartialRepaints");
    recordRenderPerfMetric("politicalPartialRepaint", 0, {
      applied: true,
      dirtyFeatureCount,
      dirtyRectCount: 0,
      viewportCoverage: 0,
      affectedFeatureCount: 0,
      noop: true,
    });
    return true;
  }

  const mergedDirtyRects = mergeIntersectingRects(dirtyRects);
  const viewportCoverage = getViewportCoverageForRects(mergedDirtyRects);
  if (viewportCoverage > POLITICAL_PARTIAL_REPAINT_VIEWPORT_COVERAGE_MAX) {
    return fallback("coverage-threshold", {
      dirtyRectCount: mergedDirtyRects.length,
      viewportCoverage,
    });
  }

  const projectedDirtyRects = mergedDirtyRects.map((rect) => screenRectToProjectedRect(rect, transform));
  if (projectedDirtyRects.some((rect) => !rect)) {
    return fallback("projected-dirty-rect-missing", {
      dirtyRectCount: mergedDirtyRects.length,
      viewportCoverage,
    });
  }
  const candidateResult = collectLandSpatialItemsForProjectedRects(projectedDirtyRects, {
    maxCandidates: POLITICAL_PARTIAL_REPAINT_CANDIDATE_THRESHOLD,
  });
  if (!candidateResult) {
    return fallback("spatial-index-unavailable", {
      dirtyRectCount: mergedDirtyRects.length,
      viewportCoverage,
    });
  }
  if (candidateResult.overflow) {
    return fallback("candidate-threshold", {
      dirtyRectCount: mergedDirtyRects.length,
      viewportCoverage,
      candidateCount: candidateResult.items.length,
    });
  }
  const candidateItems = candidateResult.items;
  const candidateCount = candidateItems.length;
  incrementPerfCounter("politicalPartialCandidateCount", candidateCount);
  if (!candidateCount) {
    return fallback("no-spatial-candidates", {
      dirtyRectCount: mergedDirtyRects.length,
      viewportCoverage,
    });
  }
  if (candidateCount > POLITICAL_PARTIAL_REPAINT_CANDIDATE_THRESHOLD) {
    return fallback("candidate-threshold", {
      dirtyRectCount: mergedDirtyRects.length,
      viewportCoverage,
      candidateCount,
    });
  }
  const pathCacheHandle = getPoliticalPathCacheHandle(transform, { resetIfMismatch: true });
  let pathCacheMisses = 0;
  if (!pathCacheHandle.valid || !(pathCacheHandle.map instanceof Map)) {
    return fallback("path-cache-unavailable", {
      dirtyRectCount: mergedDirtyRects.length,
      viewportCoverage,
      candidateCount,
    });
  }
  candidateItems.forEach((item) => {
    if (!pathCacheHandle.map.get(item.id)?.path) {
      pathCacheMisses += 1;
    }
  });
  if (pathCacheMisses > 0) {
    incrementPerfCounter("politicalPartialPathCacheMisses", pathCacheMisses);
  }
  const pathCacheMissRatio = candidateCount > 0
    ? (pathCacheMisses / candidateCount)
    : 0;
  const allowSyncPartialBuild =
    candidateCount <= POLITICAL_PARTIAL_REPAINT_SYNC_BUILD_CANDIDATE_MAX
    && pathCacheMisses <= POLITICAL_PARTIAL_REPAINT_SYNC_BUILD_MISS_MAX;
  if (pathCacheMisses > 0 && !allowSyncPartialBuild) {
    return fallback("partial-build-threshold", {
      dirtyRectCount: mergedDirtyRects.length,
      viewportCoverage,
      candidateCount,
      pathCacheMisses,
      pathCacheMissRatio: Number(pathCacheMissRatio.toFixed(4)),
    });
  }
  const redrawEntries = candidateItems.map((item) => {
    let pathEntry = pathCacheHandle.map.get(item.id) || null;
    const shouldBuildPath = !pathEntry?.path && allowSyncPartialBuild;
    if (shouldBuildPath) {
      pathEntry = getPoliticalFeaturePathEntry(item.feature, {
        featureId: item.id,
        transform,
        allowBuild: true,
        countBuild: true,
      });
      if (pathEntry?.path) {
        incrementPerfCounter("politicalPartialPathBuild");
      }
    }
    if (!pathEntry?.path) return null;
    return {
      feature: item.feature,
      index: item.drawOrder,
      id: item.id,
      path: pathEntry.path,
    };
  });
  if (redrawEntries.some((entry) => !entry)) {
    return fallback("path-cache-build-failed", {
      dirtyRectCount: mergedDirtyRects.length,
      viewportCoverage,
      candidateCount,
      pathCacheMisses,
      pathCacheMissRatio: Number(pathCacheMissRatio.toFixed(4)),
    });
  }

  const passRects = mergedDirtyRects
    .map((rect) => screenRectToPassRect(rect, layout))
    .filter(Boolean);
  if (!passRects.length) {
    return fallback("pass-rect-empty", {
      dirtyRectCount: mergedDirtyRects.length,
      viewportCoverage,
    });
  }

  const startedAt = nowMs();
  let backgroundGroupCount = 0;
  passContext.save();
  passContext.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  passContext.beginPath();
  passRects.forEach((rect) => {
    passContext.rect(rect.x, rect.y, rect.width, rect.height);
  });
  passContext.clip();
  passContext.clearRect(0, 0, layout.paddedWidth, layout.paddedHeight);
  passContext.translate(layout.offsetX, layout.offsetY);
  passContext.translate(transform.x, transform.y);
  passContext.scale(transform.k, transform.k);
  withRenderTarget(passContext, () => {
    backgroundGroupCount = drawPoliticalBackgroundFillsForEntries(redrawEntries);
    redrawEntries.forEach(({ feature, index, path }) => {
      drawPoliticalFeature(feature, index, {
        k: transform.k,
        canvasWidth,
        canvasHeight,
        skipScreenCheck: true,
        path,
        transform,
      });
    });
  });
  passContext.restore();

  cache.signatures.political = nextSignature;
  cache.dirty.political = false;
  cache.partialPoliticalDirtyIds.clear();
  cache.reasons.political = "partial-repaint";
  setPassReferenceTransform("political", transform);
  incrementPerfCounter("politicalPartialRepaints");
  recordPassTiming(timings, "political", startedAt);
  recordRenderPerfMetric("politicalPartialRepaint", nowMs() - startedAt, {
    applied: true,
    dirtyFeatureCount,
    dirtyRectCount: mergedDirtyRects.length,
    viewportCoverage: Number(viewportCoverage.toFixed(4)),
      candidateCount,
      affectedFeatureCount: redrawEntries.length,
      backgroundGroupCount,
      pathCacheMisses,
      pathCacheMissRatio: Number(pathCacheMissRatio.toFixed(4)),
  });
  return true;
}

function drawPoliticalPass(k) {
  const transform = state.zoomTransform || globalThis.d3?.zoomIdentity;
  const [canvasWidth, canvasHeight] = getLogicalCanvasDimensions();
  drawPoliticalBackgroundFills();
  if (!state.landData?.features?.length) return;
  const islandNeighbors = debugMode === "ISLANDS" ? getIslandNeighborGraph() : null;
  const visibleItems = debugMode === "PROD" ? collectVisibleLandSpatialItems() : null;
  if (Array.isArray(visibleItems)) {
    visibleItems.forEach((item) => {
      drawPoliticalFeature(item.feature, item.drawOrder, {
        k,
        canvasWidth,
        canvasHeight,
        islandNeighbors,
        transform,
        skipScreenCheck: true,
        useCachedPath: true,
        allowBuildPath: false,
        countPathBuild: false,
      });
    });
    return;
  }
  state.landData.features.forEach((feature, index) => {
    drawPoliticalFeature(feature, index, {
      k,
      canvasWidth,
      canvasHeight,
      islandNeighbors,
      transform,
      useCachedPath: true,
      allowBuildPath: false,
      countPathBuild: false,
    });
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
      const fillOpacity = defaultStyle.opacity;
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
      collectContextMetric("drawCityPointsLayer", 0, {
        featureCount: getFeatureCollectionFeatureCount(getEffectiveCityCollection()),
        interactive: false,
        skipped: true,
        reason: "staged-apply",
      });
      collectContextMetric("drawAirportsLayer", 0, {
        featureCount: getFeatureCollectionFeatureCount(state.airportsData),
        interactive: false,
        skipped: true,
        reason: "staged-apply",
      });
      collectContextMetric("drawPortsLayer", 0, {
        featureCount: getFeatureCollectionFeatureCount(state.portsData),
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
      drawPhysicalContourLayer(k, { interactive });
      drawUrbanLayer(k, { interactive });
      drawRiversLayer(k, { interactive });
      drawAirportsLayer(k, { interactive });
      drawPortsLayer(k, { interactive });
      drawCityPointsLayer(k, { interactive });
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
  if (!isBootInteractionReady()) return;
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

function drawLabelsPass(k, { interactive = false } = {}) {
  const startedAt = nowMs();
  if (interactive) {
    recordRenderPerfMetric("drawLabelsPass", nowMs() - startedAt, {
      interactive: true,
      skipped: true,
      reason: "interactive",
      labelCount: 0,
    });
    return;
  }
  if (state.deferContextBasePass) {
    recordRenderPerfMetric("drawLabelsPass", nowMs() - startedAt, {
      interactive: false,
      skipped: true,
      reason: "staged-apply",
      labelCount: 0,
    });
    return;
  }
  const renderState = getCityLayerRenderState(k, {
    interactive: false,
    cacheHoverEntries: false,
  });
  if (renderState.skipped || !renderState.labelEntries.length) {
    recordRenderPerfMetric("drawLabelsPass", nowMs() - startedAt, {
      interactive: false,
      skipped: true,
      reason: renderState.skipped ? renderState.reason : "labels-hidden",
      featureCount: renderState.featureCount,
      visibleFeatureCount: renderState.markerEntries.length,
      labelCount: 0,
    });
    return;
  }
  const labelCount = drawCityLabelsFromEntries(renderState.labelEntries, {
    config: renderState.config,
    scale: renderState.scale,
  });
  recordRenderPerfMetric("drawLabelsPass", nowMs() - startedAt, {
    interactive: false,
    skipped: false,
    featureCount: renderState.featureCount,
    visibleFeatureCount: renderState.markerEntries.length,
    labelCount,
  });
}

function renderPassToCache(passName, drawFn, transform, timings) {
  const passCanvas = ensureRenderPassCanvas(passName);
  const passContext = passCanvas.getContext("2d");
  if (!passContext) return;
  const passStart = nowMs();
  const layout = getRenderPassLayout(passName);
  withRenderTarget(passContext, () => {
    const k = prepareTargetContext(passContext, transform, layout);
    drawFn(k);
  });
  setPassReferenceTransform(passName, transform);
  getRenderPassCacheState().signatures[passName] = getRenderPassSignature(passName, transform);
  getRenderPassCacheState().dirty[passName] = false;
  if (passName === "political") {
    const cache = getRenderPassCacheState();
    cache.partialPoliticalDirtyIds.clear();
    schedulePoliticalPathWarmup(transform);
  }
  recordPassTiming(timings, passName, passStart);
  getPassCounterNames(passName).forEach((counterName) => incrementPerfCounter(counterName));
}

function ensureIdleRenderPasses(timings) {
  const transform = state.zoomTransform || globalThis.d3.zoomIdentity;
  const cache = getRenderPassCacheState();
  if (state.legacyColorStateDirty) {
    rebuildResolvedColors();
  }
  const passDefinitions = [
    ["background", (k) => drawBackgroundPass(k)],
    ["physicalBase", (k) => drawPhysicalBasePass(k)],
    ["political", (k) => drawPoliticalPass(k)],
    ["effects", (k) => drawEffectsPass(k)],
    ["contextBase", (k) => drawContextBasePass(k)],
    ["contextScenario", (k) => drawContextScenarioPass(k)],
    ["dayNight", (k) => drawDayNightPass(k)],
    ["borders", (k) => drawBordersPass(k)],
    ["labels", (k) => drawLabelsPass(k)],
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
    if (
      passName === "political"
      && tryPartialPoliticalPassRepaint(transform, nextSignature, timings)
    ) {
      return;
    }
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
    const layout = getRenderPassLayout(passName);
    context.drawImage(
      passCanvas,
      Math.round(-Number(layout?.offsetX || 0) * state.dpr),
      Math.round(-Number(layout?.offsetY || 0) * state.dpr),
    );
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
  const layout = getRenderPassLayout(passName);
  const scaleRatio = current.k / Math.max(reference.k, 0.0001);
  const dx = current.x - (reference.x * scaleRatio);
  const dy = current.y - (reference.y * scaleRatio);
  context.save();
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.translate(
    (dx - Number(layout?.offsetX || 0) * scaleRatio) * state.dpr,
    (dy - Number(layout?.offsetY || 0) * scaleRatio) * state.dpr,
  );
  context.scale(scaleRatio, scaleRatio);
  context.drawImage(passCanvas, 0, 0);
  context.restore();
  return true;
}

function drawTransformedFrameFromCaches(timings, { interactiveBorders = false } = {}) {
  const currentTransform = state.zoomTransform || globalThis.d3.zoomIdentity;
  const compositeStart = nowMs();
  resetMainCanvas();
  const cache = getRenderPassCacheState();
  if (TRANSFORMED_FRAME_PASS_NAMES.some((passName) => cache.dirty?.[passName])) {
    return false;
  }
  const transformedPasses = TRANSFORMED_FRAME_PASS_NAMES.filter((passName) => passName !== "labels");
  const drewAll = transformedPasses.every((passName) =>
    drawTransformedPass(passName, currentTransform)
  );
  if (!drewAll) return false;

  if (!drawInteractionBorderSnapshot(currentTransform)) {
    const k = Math.max(0.0001, Number(currentTransform?.k || 1));
    context.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
    context.translate(currentTransform.x, currentTransform.y);
    context.scale(k, k);
    drawBordersPass(k, { interactive: !!interactiveBorders });
    context.setTransform(1, 0, 0, 1, 0, 0);
  }
  if (!drawTransformedPass("labels", currentTransform)) {
    return false;
  }
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

function shouldPromoteDeferredColorRenderToIdle() {
  const cache = getRenderPassCacheState();
  if (
    state.renderPhase !== RENDER_PHASE_SETTLING
    && !(state.renderPhase === RENDER_PHASE_IDLE && state.deferExactAfterSettle)
  ) {
    return false;
  }
  if (!cache.dirty?.political) {
    return false;
  }
  const reason = String(cache.reasons?.political || "");
  return reason === "refresh-colors" || reason === "rebuild-colors";
}

function promoteDeferredColorRenderToIdle() {
  if (!shouldPromoteDeferredColorRenderToIdle()) {
    return false;
  }
  const previousPhase = String(state.renderPhase || "");
  const previousDefer = !!state.deferExactAfterSettle;
  clearRenderPhaseTimer();
  cancelExactAfterSettleRefresh({ clearDefer: true });
  setRenderPhase(RENDER_PHASE_IDLE);
  recordRenderPerfMetric("promoteDeferredColorRenderToIdle", 0, {
    previousPhase,
    previousDefer,
    reason: String(getRenderPassCacheState().reasons?.political || ""),
  });
  return true;
}

function drawCanvas() {
  if (!context || !pathCanvas) return;
  ensureLayerDataFromTopology();
  incrementPerfCounter("drawCanvas");
  if (state.renderPhase !== RENDER_PHASE_IDLE || state.deferExactAfterSettle) {
    cancelPoliticalPathWarmup("drawCanvas-non-idle");
  }
  promoteDeferredColorRenderToIdle();
  const frameStart = nowMs();
  const frameTimings = {};
  const useTransformedFrame =
    state.renderPhase === RENDER_PHASE_INTERACTING
    || state.renderPhase === RENDER_PHASE_SETTLING
    || (state.renderPhase === RENDER_PHASE_IDLE && state.deferExactAfterSettle);
  let drewFrame = false;
  if (useTransformedFrame) {
    drewFrame = drawTransformedFrameFromCaches(frameTimings, {
      interactiveBorders: state.renderPhase !== RENDER_PHASE_IDLE || state.deferExactAfterSettle,
    });
    if (!drewFrame) {
      drewFrame = drawLastGoodFrameFallback(state.zoomTransform || globalThis.d3.zoomIdentity);
      if (!drewFrame) {
        const cache = getRenderPassCacheState();
        if (cache.lastGoodFrame?.valid) {
          noteBlackFrame("missing-fast-frame-and-fallback");
        }
      }
    }
  }

  if (!useTransformedFrame || !drewFrame) {
    ensureIdleRenderPasses(frameTimings);
    composeCachedPasses(RENDER_PASS_NAMES);
    drewFrame = true;
  }

  const cache = getRenderPassCacheState();
  cache.lastFrame = {
    phase: state.renderPhase,
    totalMs: Math.max(0, nowMs() - frameStart),
    timings: frameTimings,
    transform: cloneZoomTransform(state.zoomTransform),
  };
  if (drewFrame) {
    captureLastGoodFrame(useTransformedFrame ? "fast-frame" : "exact-frame", state.zoomTransform);
  }
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
    const forceExactContextBaseRefresh = shouldForceExactContextBaseRefresh(reuseDecision);
    const startedAt = nowMs();
    state.deferExactAfterSettle = false;
    cancelDeferredContextBaseEnhancement();
    if (forceExactContextBaseRefresh) {
      invalidateRenderPasses(["physicalBase", "contextBase"], "physical-visible-exact");
    } else if (reuseDecision.enabled) {
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
        invalidateRenderPasses(getPhysicalExactRefreshPasses(), reuseDecision.reason || "context-base-exact");
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
    const exactRefreshApplied = forceExactContextBaseRefresh || !!reuseDecision.shouldExactRefresh;
    deferContextBaseEnhancements = shouldDeferContextBaseEnhancementsForExactRefresh(
      reuseDecision,
      forceExactContextBaseRefresh,
    );
    render();
    flushPendingScenarioChunkRefreshAfterExact();
    const durationMs = Math.max(0, nowMs() - startedAt);
    recordRenderPerfMetric("settleExactRefresh", durationMs, {
      activeScenarioId: String(state.activeScenarioId || ""),
      contextBaseRefreshed: exactRefreshApplied,
      reason: forceExactContextBaseRefresh ? "physical-visible-exact" : reuseDecision.reason,
      scaleRatio: reuseDecision.scaleRatio,
      distancePx: reuseDecision.distancePx,
      maxDistancePx: reuseDecision.maxDistancePx,
      zoomBucket: reuseDecision.zoomBucket,
      referenceZoomBucket: reuseDecision.referenceZoomBucket,
      crossesZoomBucket: !!reuseDecision.crossesZoomBucket,
      crossesMinorContourThreshold: !!reuseDecision.crossesMinorContourThreshold,
    });
    if (exactRefreshApplied) {
      recordRenderPerfMetric("contextBaseExactRefresh", Number(state.renderPerfMetrics?.drawContextBasePass?.durationMs || durationMs), {
        activeScenarioId: String(state.activeScenarioId || ""),
        reason: forceExactContextBaseRefresh ? "physical-visible-exact" : reuseDecision.reason,
        scaleRatio: reuseDecision.scaleRatio,
        distancePx: reuseDecision.distancePx,
        maxDistancePx: reuseDecision.maxDistancePx,
        zoomBucket: reuseDecision.zoomBucket,
        referenceZoomBucket: reuseDecision.referenceZoomBucket,
        crossesZoomBucket: !!reuseDecision.crossesZoomBucket,
        crossesMinorContourThreshold: !!reuseDecision.crossesMinorContourThreshold,
      });
    }
    if (deferContextBaseEnhancements) {
      scheduleDeferredContextBaseEnhancements();
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

function updateStrategicOverlayUi() {
  if (typeof state.updateStrategicOverlayUIFn === "function") {
    state.updateStrategicOverlayUIFn();
  }
}

function ensureOperationGraphicsEditorState() {
  if (!state.operationGraphicsEditor || typeof state.operationGraphicsEditor !== "object") {
    state.operationGraphicsEditor = {
      active: false,
      mode: "idle",
      collection: "operationGraphics",
      points: [],
      kind: DEFAULT_OPERATION_GRAPHIC_KIND,
      label: "",
      stylePreset: DEFAULT_OPERATION_GRAPHIC_KIND,
      stroke: "",
      width: 0,
      opacity: 1,
      selectedId: null,
      selectedVertexIndex: -1,
      counter: 1,
    };
  }
  if (typeof state.operationGraphicsEditor.mode !== "string") {
    state.operationGraphicsEditor.mode = state.operationGraphicsEditor.active ? "draw" : "idle";
  }
  state.operationGraphicsEditor.collection = "operationGraphics";
  if (!Array.isArray(state.operationGraphicsEditor.points)) {
    state.operationGraphicsEditor.points = [];
  }
  if (!OPERATION_GRAPHIC_STYLE_PRESETS.includes(String(state.operationGraphicsEditor.stylePreset || "").trim())) {
    state.operationGraphicsEditor.stylePreset = String(state.operationGraphicsEditor.kind || DEFAULT_OPERATION_GRAPHIC_KIND);
  }
  state.operationGraphicsEditor.stroke = String(state.operationGraphicsEditor.stroke || "").trim();
  state.operationGraphicsEditor.width = Math.max(0, Math.min(16, Number(state.operationGraphicsEditor.width) || 0));
  state.operationGraphicsEditor.opacity = Math.max(0, Math.min(1, Number(state.operationGraphicsEditor.opacity) || 1));
  state.operationGraphicsEditor.selectedVertexIndex = Math.max(-1, Number(state.operationGraphicsEditor.selectedVertexIndex) || -1);
}

function ensureOperationalLineEditorState() {
  if (!state.operationalLineEditor || typeof state.operationalLineEditor !== "object") {
    state.operationalLineEditor = {
      active: false,
      mode: "idle",
      points: [],
      kind: DEFAULT_OPERATIONAL_LINE_KIND,
      label: "",
      stylePreset: DEFAULT_OPERATIONAL_LINE_KIND,
      stroke: "",
      width: 0,
      opacity: 1,
      selectedId: null,
      selectedVertexIndex: -1,
      counter: 1,
    };
  }
  if (typeof state.operationalLineEditor.mode !== "string") {
    state.operationalLineEditor.mode = state.operationalLineEditor.active ? "draw" : "idle";
  }
  if (!Array.isArray(state.operationalLineEditor.points)) {
    state.operationalLineEditor.points = [];
  }
  if (!OPERATIONAL_LINE_STYLE_PRESETS.includes(String(state.operationalLineEditor.stylePreset || "").trim())) {
    state.operationalLineEditor.stylePreset = String(state.operationalLineEditor.kind || DEFAULT_OPERATIONAL_LINE_KIND);
  }
  state.operationalLineEditor.stroke = String(state.operationalLineEditor.stroke || "").trim();
  state.operationalLineEditor.width = Math.max(0, Math.min(16, Number(state.operationalLineEditor.width) || 0));
  state.operationalLineEditor.opacity = Math.max(0, Math.min(1, Number(state.operationalLineEditor.opacity) || 1));
  state.operationalLineEditor.selectedVertexIndex = Math.max(-1, Number(state.operationalLineEditor.selectedVertexIndex) || -1);
}

function normalizeUnitCounterStatPercent(value, fallback = DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT) {
  const nextValue = Number(value);
  if (!Number.isFinite(nextValue)) {
    return Math.max(0, Math.min(100, Number(fallback) || 0));
  }
  return Math.max(0, Math.min(100, Math.round(nextValue)));
}

function normalizeUnitCounterStatsPresetId(value, fallback = "regular") {
  const normalizedValue = String(value || "").trim().toLowerCase();
  if (normalizedValue === "random") return "random";
  return Object.prototype.hasOwnProperty.call(UNIT_COUNTER_STATS_PRESETS, normalizedValue)
    ? normalizedValue
    : fallback;
}

function getUnitCounterStatsPreset(value, fallback = "regular") {
  const presetId = normalizeUnitCounterStatsPresetId(value, fallback);
  return UNIT_COUNTER_STATS_PRESETS[presetId] || UNIT_COUNTER_STATS_PRESETS.regular;
}

function normalizeUnitCounterBaseFillColor(value) {
  const candidate = String(value || "").trim();
  return /^#(?:[0-9a-f]{6})$/i.test(candidate) ? candidate.toLowerCase() : "";
}

function getNormalizedUnitCounterCombatState(candidate = {}) {
  const statsPresetId = normalizeUnitCounterStatsPresetId(candidate.statsPresetId || "regular");
  const presetDefaults = getUnitCounterStatsPreset(statsPresetId);
  const statsSource = ["preset", "random", "manual"].includes(String(candidate.statsSource || "").trim().toLowerCase())
    ? String(candidate.statsSource || "").trim().toLowerCase()
    : "preset";
  return {
    baseFillColor: normalizeUnitCounterBaseFillColor(candidate.baseFillColor),
    organizationPct: normalizeUnitCounterStatPercent(candidate.organizationPct, presetDefaults.organizationPct || DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT),
    equipmentPct: normalizeUnitCounterStatPercent(candidate.equipmentPct, presetDefaults.equipmentPct || DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT),
    statsPresetId,
    statsSource,
  };
}

function assignUnitCounterEditorFromCounter(counter = null) {
  ensureUnitCounterEditorState();
  if (!counter) {
    return;
  }
  const normalizedCombatState = getNormalizedUnitCounterCombatState(counter);
  state.unitCounterEditor.renderer = String(counter.renderer || DEFAULT_UNIT_COUNTER_RENDERER);
  state.unitCounterEditor.label = String(counter.label || "");
  state.unitCounterEditor.sidc = String(counter.sidc || counter.symbolCode || "").trim().toUpperCase();
  state.unitCounterEditor.symbolCode = String(counter.symbolCode || counter.sidc || "").trim().toUpperCase();
  state.unitCounterEditor.nationTag = canonicalCountryCode(counter.nationTag || "");
  state.unitCounterEditor.nationSource = normalizeUnitCounterNationSource(counter.nationSource, "display");
  state.unitCounterEditor.presetId = String(counter.presetId || DEFAULT_UNIT_COUNTER_PRESET_ID).trim().toLowerCase() || DEFAULT_UNIT_COUNTER_PRESET_ID;
  state.unitCounterEditor.iconId = String(counter.iconId || getUnitCounterPresetById(counter.presetId).iconId || "").trim().toLowerCase();
  state.unitCounterEditor.unitType = String(counter.unitType || getUnitCounterPresetById(counter.presetId).unitType || "").trim().toUpperCase();
  state.unitCounterEditor.echelon = String(counter.echelon || "").trim().toLowerCase();
  state.unitCounterEditor.subLabel = String(counter.subLabel || "");
  state.unitCounterEditor.strengthText = String(counter.strengthText || "");
  state.unitCounterEditor.layoutAnchor = counter.layoutAnchor && typeof counter.layoutAnchor === "object"
    ? { ...counter.layoutAnchor }
    : { kind: "feature", key: String(counter.anchor?.featureId || ""), slotIndex: null };
  state.unitCounterEditor.attachment = counter.attachment && typeof counter.attachment === "object"
    ? { ...counter.attachment }
    : null;
  state.unitCounterEditor.baseFillColor = normalizedCombatState.baseFillColor;
  state.unitCounterEditor.organizationPct = normalizedCombatState.organizationPct;
  state.unitCounterEditor.equipmentPct = normalizedCombatState.equipmentPct;
  state.unitCounterEditor.statsPresetId = normalizedCombatState.statsPresetId;
  state.unitCounterEditor.statsSource = normalizedCombatState.statsSource;
  state.unitCounterEditor.size = normalizeUnitCounterSizeToken(counter.size || "medium");
}

function ensureUnitCounterEditorState() {
  if (!state.unitCounterEditor || typeof state.unitCounterEditor !== "object") {
    state.unitCounterEditor = {
      active: false,
      renderer: DEFAULT_UNIT_COUNTER_RENDERER,
      label: "",
      sidc: "",
      symbolCode: "",
      nationTag: "",
      nationSource: "display",
      presetId: DEFAULT_UNIT_COUNTER_PRESET_ID,
      iconId: "",
      unitType: "",
      echelon: "",
      subLabel: "",
      strengthText: "",
      layoutAnchor: { kind: "feature", key: "", slotIndex: null },
      attachment: null,
      baseFillColor: "",
      organizationPct: DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT,
      equipmentPct: DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT,
      statsPresetId: "regular",
      statsSource: "preset",
      size: "medium",
      selectedId: null,
      returnSelectionId: null,
      counter: 1,
    };
  }
  state.unitCounterEditor.sidc = String(
    state.unitCounterEditor.sidc
    || state.unitCounterEditor.symbolCode
    || ""
  ).trim();
  state.unitCounterEditor.symbolCode = String(
    state.unitCounterEditor.symbolCode
    || state.unitCounterEditor.sidc
    || ""
  ).trim();
  state.unitCounterEditor.nationTag = canonicalCountryCode(state.unitCounterEditor.nationTag || "");
  state.unitCounterEditor.nationSource = normalizeUnitCounterNationSource(state.unitCounterEditor.nationSource, "display");
  state.unitCounterEditor.presetId = String(state.unitCounterEditor.presetId || DEFAULT_UNIT_COUNTER_PRESET_ID).trim().toLowerCase() || DEFAULT_UNIT_COUNTER_PRESET_ID;
  state.unitCounterEditor.iconId = String(
    state.unitCounterEditor.iconId
    || getUnitCounterPresetById(state.unitCounterEditor.presetId).iconId
    || ""
  ).trim().toLowerCase();
  state.unitCounterEditor.unitType = String(
    state.unitCounterEditor.unitType
    || getUnitCounterPresetById(state.unitCounterEditor.presetId).unitType
    || ""
  ).trim().toUpperCase();
  state.unitCounterEditor.echelon = String(state.unitCounterEditor.echelon || "").trim().toLowerCase();
  state.unitCounterEditor.subLabel = String(state.unitCounterEditor.subLabel || "").trim();
  state.unitCounterEditor.strengthText = String(state.unitCounterEditor.strengthText || "").trim();
  if (!state.unitCounterEditor.layoutAnchor || typeof state.unitCounterEditor.layoutAnchor !== "object") {
    state.unitCounterEditor.layoutAnchor = { kind: "feature", key: "", slotIndex: null };
  }
  state.unitCounterEditor.layoutAnchor.kind = String(state.unitCounterEditor.layoutAnchor.kind || "feature").trim().toLowerCase() || "feature";
  state.unitCounterEditor.layoutAnchor.key = String(state.unitCounterEditor.layoutAnchor.key || "").trim();
  state.unitCounterEditor.layoutAnchor.slotIndex = Number.isInteger(Number(state.unitCounterEditor.layoutAnchor.slotIndex))
    ? Math.max(0, Math.round(Number(state.unitCounterEditor.layoutAnchor.slotIndex)))
    : null;
  state.unitCounterEditor.attachment = state.unitCounterEditor.attachment && typeof state.unitCounterEditor.attachment === "object"
    ? {
      kind: String(state.unitCounterEditor.attachment.kind || STRATEGIC_COUNTER_ATTACHMENT_KIND).trim().toLowerCase() || STRATEGIC_COUNTER_ATTACHMENT_KIND,
      lineId: String(state.unitCounterEditor.attachment.lineId || "").trim(),
    }
    : null;
  state.unitCounterEditor.baseFillColor = normalizeUnitCounterBaseFillColor(state.unitCounterEditor.baseFillColor);
  state.unitCounterEditor.organizationPct = normalizeUnitCounterStatPercent(
    state.unitCounterEditor.organizationPct,
    DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT
  );
  state.unitCounterEditor.equipmentPct = normalizeUnitCounterStatPercent(
    state.unitCounterEditor.equipmentPct,
    DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT
  );
  state.unitCounterEditor.statsPresetId = normalizeUnitCounterStatsPresetId(state.unitCounterEditor.statsPresetId || "regular");
  state.unitCounterEditor.statsSource = ["preset", "random", "manual"].includes(String(state.unitCounterEditor.statsSource || "").trim().toLowerCase())
    ? String(state.unitCounterEditor.statsSource || "").trim().toLowerCase()
    : "preset";
  state.unitCounterEditor.size = normalizeUnitCounterSizeToken(state.unitCounterEditor.size);
}

function resetUnitCounterEditorState({ preserveSelection = false, preserveCounter = true } = {}) {
  ensureUnitCounterEditorState();
  const preservedSelection = preserveSelection ? String(state.unitCounterEditor.selectedId || "").trim() || null : null;
  const preservedCounter = preserveCounter ? Math.max(1, Number(state.unitCounterEditor.counter) || 1) : 1;
  state.unitCounterEditor.active = false;
  state.unitCounterEditor.renderer = DEFAULT_UNIT_COUNTER_RENDERER;
  state.unitCounterEditor.label = "";
  state.unitCounterEditor.sidc = "";
  state.unitCounterEditor.symbolCode = "";
  state.unitCounterEditor.nationTag = "";
  state.unitCounterEditor.nationSource = "display";
  state.unitCounterEditor.presetId = DEFAULT_UNIT_COUNTER_PRESET_ID;
  state.unitCounterEditor.iconId = "";
  state.unitCounterEditor.unitType = "";
  state.unitCounterEditor.echelon = "";
  state.unitCounterEditor.subLabel = "";
  state.unitCounterEditor.strengthText = "";
  state.unitCounterEditor.layoutAnchor = { kind: "feature", key: "", slotIndex: null };
  state.unitCounterEditor.attachment = null;
  state.unitCounterEditor.baseFillColor = "";
  state.unitCounterEditor.organizationPct = DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT;
  state.unitCounterEditor.equipmentPct = DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT;
  state.unitCounterEditor.statsPresetId = "regular";
  state.unitCounterEditor.statsSource = "preset";
  state.unitCounterEditor.size = "medium";
  state.unitCounterEditor.selectedId = preservedSelection;
  state.unitCounterEditor.returnSelectionId = null;
  state.unitCounterEditor.counter = preservedCounter;
  ensureUnitCounterEditorState();
}

function getFrontlineOwnershipContext() {
  return {
    ownershipByFeatureId: state.sovereigntyByFeatureId,
    controllerByFeatureId: state.scenarioControllersByFeatureId,
    shellOwnerByFeatureId: state.scenarioAutoShellOwnerByFeatureId,
    shellControllerByFeatureId: state.scenarioAutoShellControllerByFeatureId,
    scenarioActive: !!state.activeScenarioId,
    viewMode: "frontline",
  };
}

function getFrontlineMesh() {
  if (
    !state.activeScenarioId
    || !state.annotationView?.frontlineEnabled
    || !state.runtimePoliticalTopology?.objects?.political
  ) {
    state.cachedFrontlineMesh = null;
    state.cachedFrontlineMeshHash = "";
    return null;
  }
  const nextHash = [
    `scenario:${String(state.activeScenarioId || "")}`,
    `ctrl:${Number(state.scenarioControllerRevision || 0)}`,
    `shell:${Number(state.scenarioShellOverlayRevision || 0)}`,
    `sov:${Number(state.sovereigntyRevision || 0)}`,
  ].join("|");
  if (state.cachedFrontlineMesh && state.cachedFrontlineMeshHash === nextHash) {
    return state.cachedFrontlineMesh;
  }
  state.cachedFrontlineMesh = buildDynamicOwnerBorderMesh(
    state.runtimePoliticalTopology,
    getFrontlineOwnershipContext()
  );
  state.cachedFrontlineMeshHash = nextHash;
  return state.cachedFrontlineMesh;
}

function getProjectedPoint(coord) {
  const projected = projection?.(coord);
  if (!Array.isArray(projected) || projected.length < 2) return null;
  const x = Number(projected[0]);
  const y = Number(projected[1]);
  return Number.isFinite(x) && Number.isFinite(y) ? [x, y] : null;
}

function getLineMidpointFromCoordinates(coordinates = []) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) return null;
  const totalSegments = [];
  let totalLength = 0;
  for (let index = 1; index < coordinates.length; index += 1) {
    const previous = coordinates[index - 1];
    const current = coordinates[index];
    if (!Array.isArray(previous) || !Array.isArray(current)) continue;
    const dx = Number(current[0]) - Number(previous[0]);
    const dy = Number(current[1]) - Number(previous[1]);
    const segmentLength = Math.hypot(dx, dy);
    if (!Number.isFinite(segmentLength) || segmentLength <= 0) continue;
    totalSegments.push({ previous, current, segmentLength });
    totalLength += segmentLength;
  }
  if (!totalLength || !totalSegments.length) return null;
  let distance = totalLength / 2;
  for (const segment of totalSegments) {
    if (distance <= segment.segmentLength) {
      const ratio = distance / segment.segmentLength;
      return [
        Number(segment.previous[0]) + (Number(segment.current[0]) - Number(segment.previous[0])) * ratio,
        Number(segment.previous[1]) + (Number(segment.current[1]) - Number(segment.previous[1])) * ratio,
      ];
    }
    distance -= segment.segmentLength;
  }
  const last = totalSegments[totalSegments.length - 1];
  return [Number(last.current[0]), Number(last.current[1])];
}

function getMultiLineLabelAnchor(geometry, placementMode = "midpoint") {
  const lines = Array.isArray(geometry?.coordinates) ? geometry.coordinates : [];
  let bestLine = null;
  let bestLength = -1;
  lines.forEach((line) => {
    if (!Array.isArray(line) || line.length < 2) return;
    let length = 0;
    for (let index = 1; index < line.length; index += 1) {
      const previous = line[index - 1];
      const current = line[index];
      length += Math.hypot(
        Number(current?.[0] || 0) - Number(previous?.[0] || 0),
        Number(current?.[1] || 0) - Number(previous?.[1] || 0)
      );
    }
    if (length > bestLength) {
      bestLength = length;
      bestLine = line;
    }
  });
  if (!bestLine) return null;
  if (placementMode === "centroid") {
    const sums = bestLine.reduce((acc, coord) => {
      acc[0] += Number(coord?.[0] || 0);
      acc[1] += Number(coord?.[1] || 0);
      acc[2] += 1;
      return acc;
    }, [0, 0, 0]);
    return sums[2] > 0 ? [sums[0] / sums[2], sums[1] / sums[2]] : null;
  }
  return getLineMidpointFromCoordinates(bestLine);
}

function getFrontlineLabelAnchors() {
  if (
    !state.activeScenarioId
    || !state.annotationView?.frontlineEnabled
    || !state.annotationView?.showFrontlineLabels
    || !globalThis.topojson
  ) {
    state.cachedFrontlineLabelAnchors = [];
    state.cachedFrontlineLabelAnchorsHash = "";
    return [];
  }
  const nextHash = [
    `scenario:${String(state.activeScenarioId || "")}`,
    `ctrl:${Number(state.scenarioControllerRevision || 0)}`,
    `shell:${Number(state.scenarioShellOverlayRevision || 0)}`,
    `sov:${Number(state.sovereigntyRevision || 0)}`,
    `placement:${String(state.annotationView?.labelPlacementMode || "midpoint")}`,
    `lang:${String(state.currentLanguage || "")}`,
  ].join("|");
  if (
    Array.isArray(state.cachedFrontlineLabelAnchors)
    && state.cachedFrontlineLabelAnchorsHash === nextHash
  ) {
    return state.cachedFrontlineLabelAnchors;
  }
  const topology = state.runtimePoliticalTopology;
  const object = topology?.objects?.political;
  const geometries = Array.isArray(object?.geometries) ? object.geometries : [];
  const neighbors = Array.isArray(state.runtimeNeighborGraph) ? state.runtimeNeighborGraph : [];
  const ownershipContext = getFrontlineOwnershipContext();
  const anchors = [];
  const seenPairs = new Set();

  geometries.forEach((geometry, index) => {
    const featureId = getEntityFeatureId(geometry);
    if (!featureId || shouldExcludeOwnerBorderEntity(geometry, { excludeSea: true })) return;
    const ownerA = resolveOwnerBorderCode(geometry, ownershipContext);
    if (!ownerA) return;
    const neighborIndexes = Array.isArray(neighbors[index]) ? neighbors[index] : [];
    neighborIndexes.forEach((neighborIndex) => {
      if (neighborIndex <= index) return;
      const neighbor = geometries[neighborIndex];
      if (!neighbor || shouldExcludeOwnerBorderEntity(neighbor, { excludeSea: true })) return;
      const ownerB = resolveOwnerBorderCode(neighbor, ownershipContext);
      if (!ownerB || ownerA === ownerB) return;
      const pairKey = [ownerA, ownerB].sort().join("::");
      if (seenPairs.has(pairKey)) return;
      const pairMesh = globalThis.topojson.mesh(topology, object, (a, b) => (
        (a === geometry && b === neighbor) || (a === neighbor && b === geometry)
      ));
      const anchor = getMultiLineLabelAnchor(pairMesh, state.annotationView?.labelPlacementMode || "midpoint");
      if (!anchor) return;
      const projected = getProjectedPoint(anchor);
      if (!projected) return;
      seenPairs.add(pairKey);
      anchors.push({
        key: pairKey,
        coord: anchor,
        projected,
        label: `${getScenarioCountryDisplayName(ownerA) || ownerA} / ${getScenarioCountryDisplayName(ownerB) || ownerB}`,
      });
    });
  });

  state.cachedFrontlineLabelAnchorsHash = nextHash;
  state.cachedFrontlineLabelAnchors = anchors;
  return anchors;
}

function renderStrategicDefs() {
  if (!strategicDefs) return;
  const defs = [
    {
      id: "strategic-arrow-attack",
      path: "M 0 5 L 8 1.8 L 7 5 L 8 8.2 z",
      fill: "#7f1d1d",
      stroke: "#f5d7d3",
      strokeWidth: 0.45,
    },
    {
      id: "strategic-arrow-retreat",
      path: "M 1 5 L 8 2 L 6.6 5 L 8 8 z",
      fill: "#9a3412",
      stroke: "#f3dec6",
      strokeWidth: 0.45,
    },
    {
      id: "strategic-arrow-supply",
      path: "M 0 5 L 6 2.5 L 6 4.2 L 8 4.2 L 8 5.8 L 6 5.8 L 6 7.5 z",
      fill: "#475569",
      stroke: "#dbe2eb",
      strokeWidth: 0.5,
    },
    {
      id: "strategic-arrow-naval",
      path: "M 0 5 L 7 1.6 L 6 5 L 7 8.4 z",
      fill: "#1e3a8a",
      stroke: "#d8e6ff",
      strokeWidth: 0.45,
    },
  ];

  const selection = strategicDefs.selectAll("marker.strategic-marker").data(defs, (d) => d.id);
  const enter = selection
    .enter()
    .append("marker")
    .attr("class", "strategic-marker")
    .attr("markerUnits", "strokeWidth")
    .attr("orient", "auto-start-reverse")
    .attr("refX", 10)
    .attr("refY", 5)
    .attr("markerWidth", 11)
    .attr("markerHeight", 10)
    .attr("viewBox", "0 0 11 10");

  enter.append("path");
  enter.merge(selection)
    .attr("id", (d) => d.id)
    .select("path")
    .attr("d", (d) => d.path)
    .attr("fill", (d) => d.fill)
    .attr("stroke", (d) => d.stroke)
    .attr("stroke-width", (d) => d.strokeWidth);

  selection.exit().remove();
}

function getOperationGraphicPreset(kind) {
  const presets = {
    attack: {
      stroke: "#7f1d1d",
      width: 2.2,
      opacity: 0.9,
      dasharray: null,
      markerEnd: "url(#strategic-arrow-attack)",
      curved: true,
      closed: false,
    },
    retreat: {
      stroke: "#9a3412",
      width: 1.8,
      opacity: 0.82,
      dasharray: "7 5",
      markerEnd: "url(#strategic-arrow-retreat)",
      curved: true,
      closed: false,
    },
    supply: {
      stroke: "#475569",
      width: 1.4,
      opacity: 0.8,
      dasharray: "4 4",
      markerEnd: "url(#strategic-arrow-supply)",
      curved: true,
      closed: false,
    },
    naval: {
      stroke: "#1e3a8a",
      width: 1.8,
      opacity: 0.82,
      dasharray: "8 5",
      markerEnd: "url(#strategic-arrow-naval)",
      curved: true,
      closed: false,
    },
    encirclement: {
      stroke: "#4c1d95",
      width: 1.7,
      opacity: 0.76,
      dasharray: "6 4",
      markerEnd: null,
      curved: true,
      closed: true,
    },
    theater: {
      stroke: "#7c2d12",
      width: 1.9,
      opacity: 0.74,
      dasharray: "10 5",
      markerEnd: null,
      curved: true,
      closed: true,
    },
  };
  return presets[kind] || presets.attack;
}

function getOperationalLinePreset(kind) {
  const presets = {
    frontline: {
      stroke: "#6b7280",
      width: 2.1,
      opacity: 0.82,
      dasharray: "10 5",
      markerEnd: null,
      curved: true,
      closed: false,
    },
    offensive_line: {
      stroke: "#7f1d1d",
      width: 2.5,
      opacity: 0.94,
      dasharray: null,
      markerEnd: "url(#strategic-arrow-attack)",
      curved: true,
      closed: false,
    },
    spearhead_line: {
      stroke: "#991b1b",
      width: 2.9,
      opacity: 0.98,
      dasharray: "14 5 2 5",
      markerEnd: "url(#strategic-arrow-attack)",
      curved: true,
      closed: false,
    },
    defensive_line: {
      stroke: "#92400e",
      width: 1.9,
      opacity: 0.82,
      dasharray: "5 4",
      markerEnd: null,
      curved: true,
      closed: false,
    },
  };
  return presets[kind] || presets.frontline;
}

function projectStrategicPoints(points = []) {
  return points.map((point) => getProjectedPoint(point)).filter(Boolean);
}

function createOperationGraphicPath(points = [], { closed = false, curved = true } = {}) {
  const projected = projectStrategicPoints(points);
  if (projected.length < (closed ? 3 : 2) || !globalThis.d3?.line) return "";
  const curve = closed
    ? (curved ? globalThis.d3.curveCatmullRomClosed.alpha(0.5) : globalThis.d3.curveLinearClosed)
    : (curved ? globalThis.d3.curveCatmullRom.alpha(0.5) : globalThis.d3.curveLinear);
  return globalThis.d3.line().curve(curve)(projected) || "";
}

function getOperationGraphicMinPoints(kind = DEFAULT_OPERATION_GRAPHIC_KIND) {
  return kind === "encirclement" || kind === "theater" ? 3 : 2;
}

function getOperationalLineMinPoints() {
  return 2;
}

function getOperationGraphicById(id) {
  const selectedId = String(id || "").trim();
  if (!selectedId) return null;
  return (state.operationGraphics || []).find((entry) => String(entry?.id || "") === selectedId) || null;
}

function getOperationalLineById(id) {
  const selectedId = String(id || "").trim();
  if (!selectedId) return null;
  return (state.operationalLines || []).find((entry) => String(entry?.id || "") === selectedId) || null;
}

function normalizeOperationGraphicStylePreset(value, fallback = DEFAULT_OPERATION_GRAPHIC_KIND) {
  const normalized = String(value || "").trim().toLowerCase();
  if (OPERATION_GRAPHIC_STYLE_PRESETS.includes(normalized)) {
    return normalized;
  }
  return OPERATION_GRAPHIC_STYLE_PRESETS.includes(String(fallback || "").trim().toLowerCase())
    ? String(fallback || "").trim().toLowerCase()
    : DEFAULT_OPERATION_GRAPHIC_KIND;
}

function normalizeOperationalLineStylePreset(value, fallback = DEFAULT_OPERATIONAL_LINE_KIND) {
  const normalized = String(value || "").trim().toLowerCase();
  if (OPERATIONAL_LINE_STYLE_PRESETS.includes(normalized)) {
    return normalized;
  }
  return OPERATIONAL_LINE_STYLE_PRESETS.includes(String(fallback || "").trim().toLowerCase())
    ? String(fallback || "").trim().toLowerCase()
    : DEFAULT_OPERATIONAL_LINE_KIND;
}

function normalizeOperationGraphicStroke(value) {
  const candidate = String(value || "").trim();
  return /^#(?:[0-9a-f]{6})$/i.test(candidate) ? candidate.toLowerCase() : "";
}

function normalizeOperationGraphicWidth(value) {
  return Math.max(0, Math.min(16, Number(value) || 0));
}

function normalizeOperationGraphicOpacity(value) {
  return Math.max(0, Math.min(1, Number(value) || 1));
}

function getOperationGraphicEditorModel() {
  ensureOperationGraphicsEditorState();
  const isDrawing = !!state.operationGraphicsEditor.active;
  if (isDrawing) {
    const kind = String(state.operationGraphicsEditor.kind || DEFAULT_OPERATION_GRAPHIC_KIND);
    return {
      mode: "draw",
      graphic: null,
      points: Array.isArray(state.operationGraphicsEditor.points) ? state.operationGraphicsEditor.points : [],
      kind,
      stylePreset: normalizeOperationGraphicStylePreset(state.operationGraphicsEditor.stylePreset, kind),
      stroke: normalizeOperationGraphicStroke(state.operationGraphicsEditor.stroke),
      width: normalizeOperationGraphicWidth(state.operationGraphicsEditor.width),
      opacity: normalizeOperationGraphicOpacity(state.operationGraphicsEditor.opacity),
      selectedVertexIndex: -1,
    };
  }
  const graphic = getOperationGraphicById(state.operationGraphicsEditor.selectedId);
  if (!graphic) {
    return null;
  }
  const kind = String(graphic.kind || DEFAULT_OPERATION_GRAPHIC_KIND);
  return {
    mode: "edit",
    graphic,
    points: Array.isArray(graphic.points) ? graphic.points : [],
    kind,
    stylePreset: normalizeOperationGraphicStylePreset(graphic.stylePreset, kind),
    stroke: normalizeOperationGraphicStroke(graphic.stroke),
    width: normalizeOperationGraphicWidth(graphic.width),
    opacity: normalizeOperationGraphicOpacity(graphic.opacity),
    selectedVertexIndex: Math.max(-1, Number(state.operationGraphicsEditor.selectedVertexIndex) || -1),
  };
}

function getOperationGraphicEditorMidpoints(points = [], { closed = false } = {}) {
  const segments = [];
  const maxIndex = closed ? points.length : points.length - 1;
  for (let index = 0; index < maxIndex; index += 1) {
    const start = points[index];
    const end = points[(index + 1) % points.length];
    if (!Array.isArray(start) || !Array.isArray(end)) continue;
    const midpoint = [
      (Number(start[0]) + Number(end[0])) / 2,
      (Number(start[1]) + Number(end[1])) / 2,
    ];
    segments.push({
      id: `opg-midpoint-${index}`,
      insertIndex: index + 1,
      coord: midpoint,
    });
  }
  return segments;
}

function getUnitCounterSymbolToken(counter = {}) {
  return String(counter.sidc || counter.symbolCode || getUnitCounterPresetById(counter.presetId).baseSidc || "").trim();
}

function getUnitCounterEffectiveSidc(counter = {}) {
  const raw = getUnitCounterSymbolToken(counter);
  if (/^\d{30}$/.test(raw)) {
    return raw;
  }
  return UNIT_COUNTER_SIDC_ALIASES[String(raw || "").trim().toUpperCase()] || DEFAULT_MILSTD_SIDC;
}

function getMilSymbolDataUri(sidc, size = 42) {
  const normalizedSidc = String(sidc || "").trim();
  const normalizedSize = Math.max(24, Math.min(96, Number(size) || 42));
  const cacheKey = `${normalizedSidc}|${normalizedSize}`;
  if (milsymbolSvgUriCache.has(cacheKey)) {
    return milsymbolSvgUriCache.get(cacheKey);
  }
  if (!normalizedSidc || !globalThis.ms?.Symbol) {
    return "";
  }
  try {
    const symbol = new globalThis.ms.Symbol(normalizedSidc, {
      size: normalizedSize,
      frame: true,
      colorMode: "Light",
    });
    const uri = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(symbol.asSVG())}`;
    milsymbolSvgUriCache.set(cacheKey, uri);
    return uri;
  } catch (_error) {
    milsymbolSvgUriCache.set(cacheKey, "");
    return "";
  }
}

function getLandFeatureIdFromEvent(event, eventType = "unit-counter-hit") {
  const hit = getHitFromEvent(event, {
    enableSnap: true,
    snapPx: HIT_SNAP_RADIUS_CLICK_PX,
    eventType,
  });
  return hit?.targetType === "land" ? String(hit.id || "") : "";
}

function renderFrontlineOverlay() {
  if (!frontlineOverlayGroup || !frontlineLabelsGroup || !pathSVG) return;
  if (!state.annotationView?.frontlineEnabled) {
    state.cachedFrontlineMesh = null;
    state.cachedFrontlineMeshHash = "";
    state.cachedFrontlineLabelAnchors = [];
    state.cachedFrontlineLabelAnchorsHash = "";
    frontlineOverlayGroup.selectAll("*").remove();
    frontlineLabelsGroup.selectAll("*").remove();
    frontlineOverlayGroup.attr("aria-hidden", "true");
    frontlineLabelsGroup.attr("aria-hidden", "true");
    return;
  }
  const mesh = getFrontlineMesh();
  const hasMesh = !!mesh && Array.isArray(mesh.coordinates) && mesh.coordinates.length > 0;
  if (!hasMesh) {
    frontlineOverlayGroup.selectAll("*").remove();
    frontlineLabelsGroup.selectAll("*").remove();
    frontlineOverlayGroup.attr("aria-hidden", "true");
    frontlineLabelsGroup.attr("aria-hidden", "true");
    return;
  }

  const style = String(state.annotationView?.frontlineStyle || "clean");
  const zoomK = Math.max(0.1, Number(state.zoomTransform?.k || 1));
  const widthScale = zoomK >= 5 ? 1.18 : zoomK >= 2.4 ? 1.04 : zoomK >= 1.2 ? 0.92 : 0.82;
  const pathValue = pathSVG(mesh);
  const layers = style === "dual-rail"
    ? [
      { key: "base", stroke: "rgba(17, 24, 39, 0.78)", width: 4.2 * widthScale, dasharray: null },
      { key: "inner-a", stroke: "rgba(127, 29, 29, 0.46)", width: 1.5 * widthScale, dasharray: null },
      { key: "inner-b", stroke: "rgba(30, 58, 138, 0.42)", width: 0.8 * widthScale, dasharray: "10 7" },
    ]
      : style === "teeth"
      ? [
        { key: "base", stroke: "rgba(24, 32, 45, 0.82)", width: 4.1 * widthScale, dasharray: null },
        { key: "teeth", stroke: "rgba(231, 229, 221, 0.84)", width: 1.3 * widthScale, dasharray: "1.5 5.8" },
      ]
      : [
        { key: "base", stroke: "rgba(20, 29, 43, 0.78)", width: 4.3 * widthScale, dasharray: null },
        { key: "inner", stroke: "rgba(236, 232, 223, 0.9)", width: 1.7 * widthScale, dasharray: null },
      ];

  const selection = frontlineOverlayGroup
    .selectAll("path.frontline-path")
    .data(layers, (d) => d.key);

  selection
    .enter()
    .append("path")
    .attr("class", "frontline-path")
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
    .attr("vector-effect", "non-scaling-stroke")
    .merge(selection)
    .attr("d", pathValue)
    .attr("fill", "none")
    .attr("stroke", (d) => d.stroke)
    .attr("stroke-width", (d) => d.width)
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("stroke-dasharray", (d) => d.dasharray || null);

  selection.exit().remove();
  frontlineOverlayGroup.attr("aria-hidden", "false");

  const labels = state.annotationView?.showFrontlineLabels ? getFrontlineLabelAnchors() : [];
  const labelSelection = frontlineLabelsGroup
    .selectAll("g.frontline-label")
    .data(labels, (d) => d.key);

  const labelEnter = labelSelection.enter().append("g").attr("class", "frontline-label");
  labelEnter.append("rect").attr("rx", 4).attr("ry", 4);
  labelEnter.append("text");

  labelEnter.merge(labelSelection)
    .attr("transform", (d) => `translate(${d.projected[0]},${d.projected[1]})`);

  labelEnter.merge(labelSelection).select("text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", STRATEGIC_LINE_LABEL_FONT)
    .attr("font-size", 10)
    .attr("font-weight", 600)
    .attr("fill", "#f8fafc")
    .text((d) => d.label);

  labelEnter.merge(labelSelection).select("rect")
    .each(function eachLabelRect(d) {
      const textNode = globalThis.d3.select(this.parentNode).select("text").node();
      const bbox = textNode?.getBBox?.();
      const width = bbox ? bbox.width + 10 : 64;
      const height = bbox ? bbox.height + 6 : 18;
      globalThis.d3.select(this)
        .attr("x", -width / 2)
        .attr("y", -height / 2)
        .attr("width", width)
        .attr("height", height)
        .attr("fill", "rgba(15, 23, 42, 0.78)")
        .attr("stroke", "rgba(248, 250, 252, 0.18)")
        .attr("stroke-width", 0.8);
    });

  labelSelection.exit().remove();
  frontlineLabelsGroup.attr("aria-hidden", labels.length ? "false" : "true");
}

function syncInteractionLayerPointerEvents() {
  if (!interactionRect) return;
  const operationGraphicEditor = state.operationGraphicsEditor || {};
  const hasEditableOperationGraphic = !operationGraphicEditor.active
    && String(operationGraphicEditor.mode || "") === "edit"
    && !!String(operationGraphicEditor.selectedId || "").trim()
    && Array.isArray(operationGraphicEditor.points)
    && operationGraphicEditor.points.length > 0;
  interactionRect
    .style("pointer-events", hasEditableOperationGraphic ? "none" : "all")
    .lower();
}

function renderOperationGraphicsEditorOverlay() {
  if (!operationGraphicsEditorGroup) return;
  ensureOperationGraphicsEditorState();
  const editorModel = getOperationGraphicEditorModel();
  const points = Array.isArray(editorModel?.points) ? editorModel.points : [];
  const isDrawing = editorModel?.mode === "draw";
  if (!editorModel || points.length === 0) {
    operationGraphicsEditorGroup.selectAll("*").remove();
    operationGraphicsEditorGroup.attr("aria-hidden", "true");
    syncInteractionLayerPointerEvents();
    return;
  }
  const geometryPreset = getOperationGraphicPreset(editorModel.kind);
  const stylePreset = getOperationGraphicPreset(editorModel.stylePreset);
  const previewPath = createOperationGraphicPath(points, {
    closed: !!geometryPreset.closed && points.length >= 3,
    curved: true,
  });
  const previewData = previewPath ? [{ id: "preview", d: previewPath, closed: !!geometryPreset.closed && points.length >= 3 }] : [];
  const pathSelection = operationGraphicsEditorGroup
    .selectAll("path.operation-graphics-editor-path")
    .data(previewData, (d) => d.id);

  pathSelection
    .enter()
    .append("path")
    .attr("class", "operation-graphics-editor-path")
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
    .attr("pointer-events", "none")
    .attr("vector-effect", "non-scaling-stroke")
    .merge(pathSelection)
    .attr("d", (d) => d.d)
    .attr("fill", (d) => (d.closed ? "rgba(59, 130, 246, 0.08)" : "none"))
    .attr("stroke", editorModel.stroke || stylePreset.stroke)
    .attr("stroke-width", Math.max(1.5, editorModel.width || stylePreset.width))
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("stroke-dasharray", stylePreset.dasharray || "8 4")
    .attr("opacity", Number.isFinite(Number(editorModel.opacity)) ? editorModel.opacity : stylePreset.opacity);

  pathSelection.exit().remove();

  const pointSelection = operationGraphicsEditorGroup
    .selectAll("circle.operation-graphics-editor-point")
    .data(points.map((coord, index) => ({ coord, index, id: `opg-point-${index}` })), (d) => d.id);

  const pointEnter = pointSelection
    .enter()
    .append("circle")
    .attr("class", "operation-graphics-editor-point")
    .attr("role", "presentation")
    .attr("aria-hidden", "true");

  pointEnter.merge(pointSelection)
    .attr("r", 4.2)
    .attr("cx", (d) => getProjectedPoint(d.coord)?.[0] ?? -9999)
    .attr("cy", (d) => getProjectedPoint(d.coord)?.[1] ?? -9999)
    .attr("fill", (_d, index) => (index === editorModel.selectedVertexIndex ? "#0f172a" : "#ffffff"))
    .attr("stroke", editorModel.stroke || stylePreset.stroke)
    .attr("stroke-width", (_d, index) => (index === editorModel.selectedVertexIndex ? 2 : 1.3))
    .attr("pointer-events", "all")
    .style("cursor", isDrawing ? "default" : "grab");

  pointSelection.exit().remove();

  if (!isDrawing && globalThis.d3?.drag) {
    if (!renderOperationGraphicsEditorOverlay.pointDragBehavior) {
      renderOperationGraphicsEditorOverlay.pointDragBehavior = globalThis.d3.drag()
        .on("start", function onStart(event, datum) {
          event?.sourceEvent?.stopPropagation?.();
          datum.__historyBefore = captureHistoryState({ strategicOverlay: true });
          state.operationGraphicsEditor.selectedVertexIndex = datum.index;
          state.operationGraphicsDirty = true;
          globalThis.d3.select(this).style("cursor", "grabbing");
          renderOperationGraphicsIfNeeded({ force: true });
          updateStrategicOverlayUi();
        })
        .on("drag", function onDrag(event, datum) {
          const graphic = getOperationGraphicById(state.operationGraphicsEditor.selectedId);
          const coord = getMapLonLatFromEvent(event?.sourceEvent || event);
          if (!graphic || !coord || !Array.isArray(graphic.points?.[datum.index])) return;
          graphic.points[datum.index] = coord;
          state.operationGraphicsEditor.points = Array.isArray(graphic.points) ? graphic.points : [];
          state.operationGraphicsDirty = true;
          renderOperationGraphicsIfNeeded({ force: true });
        })
        .on("end", function onEnd(_event, datum) {
          globalThis.d3.select(this).style("cursor", "grab");
          pushHistoryEntry({
            kind: "move-operation-graphic-vertex",
            before: datum.__historyBefore,
            after: captureHistoryState({ strategicOverlay: true }),
          });
          datum.__historyBefore = null;
          markDirty("move-operation-graphic-vertex");
          state.operationGraphicsDirty = true;
          updateStrategicOverlayUi();
          renderOperationGraphicsIfNeeded({ force: true });
        });
    }
    pointEnter.merge(pointSelection)
      .on("click", (event, datum) => {
        event.stopPropagation();
        state.operationGraphicsEditor.selectedVertexIndex = datum.index;
        state.operationGraphicsEditor.points = points;
        state.operationGraphicsDirty = true;
        updateStrategicOverlayUi();
        renderOperationGraphicsIfNeeded({ force: true });
      })
      .call(renderOperationGraphicsEditorOverlay.pointDragBehavior);
  }

  const midpointData = !isDrawing
    ? getOperationGraphicEditorMidpoints(points, { closed: !!geometryPreset.closed && points.length >= 3 })
    : [];
  const midpointSelection = operationGraphicsEditorGroup
    .selectAll("circle.operation-graphics-editor-midpoint")
    .data(midpointData, (d) => d.id);

  midpointSelection
    .enter()
    .append("circle")
    .attr("class", "operation-graphics-editor-midpoint")
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
    .merge(midpointSelection)
    .attr("r", 10)
    .attr("cx", (d) => getProjectedPoint(d.coord)?.[0] ?? -9999)
    .attr("cy", (d) => getProjectedPoint(d.coord)?.[1] ?? -9999)
    .attr("fill", editorModel.stroke || stylePreset.stroke)
    .attr("opacity", 0.001)
    .attr("stroke", "none")
    .attr("stroke-width", 0)
    .attr("pointer-events", "all")
    .style("cursor", "copy")
    .on("pointerdown", function onPointerDown(event, datum) {
      this.dataset.skipMidpointClick = "true";
      event.stopPropagation();
      event.preventDefault?.();
      const graphic = getOperationGraphicById(state.operationGraphicsEditor.selectedId);
      if (!graphic) return;
      const before = captureHistoryState({ strategicOverlay: true });
      graphic.points.splice(datum.insertIndex, 0, datum.coord);
      state.operationGraphicsEditor.points = Array.isArray(graphic.points) ? graphic.points : [];
      state.operationGraphicsEditor.selectedVertexIndex = datum.insertIndex;
      state.operationGraphicsDirty = true;
      pushHistoryEntry({
        kind: "insert-operation-graphic-vertex",
        before,
        after: captureHistoryState({ strategicOverlay: true }),
      });
      markDirty("insert-operation-graphic-vertex");
      updateStrategicOverlayUi();
      renderOperationGraphicsIfNeeded({ force: true });
    })
    .on("click", function onClick(event, datum) {
      if (this.dataset.skipMidpointClick === "true") {
        this.dataset.skipMidpointClick = "false";
        return;
      }
      event.stopPropagation();
      const graphic = getOperationGraphicById(state.operationGraphicsEditor.selectedId);
      if (!graphic) return;
      const before = captureHistoryState({ strategicOverlay: true });
      graphic.points.splice(datum.insertIndex, 0, datum.coord);
      state.operationGraphicsEditor.points = Array.isArray(graphic.points) ? graphic.points : [];
      state.operationGraphicsEditor.selectedVertexIndex = datum.insertIndex;
      state.operationGraphicsDirty = true;
      pushHistoryEntry({
        kind: "insert-operation-graphic-vertex",
        before,
        after: captureHistoryState({ strategicOverlay: true }),
      });
      markDirty("insert-operation-graphic-vertex");
      updateStrategicOverlayUi();
      renderOperationGraphicsIfNeeded({ force: true });
    });

  const midpointVisualSelection = operationGraphicsEditorGroup
    .selectAll("circle.operation-graphics-editor-midpoint-visual")
    .data(midpointData, (d) => d.id);

  midpointVisualSelection
    .enter()
    .append("circle")
    .attr("class", "operation-graphics-editor-midpoint-visual")
    .attr("role", "presentation")
    .attr("aria-hidden", "true")
    .merge(midpointVisualSelection)
    .attr("r", 4.6)
    .attr("cx", (d) => getProjectedPoint(d.coord)?.[0] ?? -9999)
    .attr("cy", (d) => getProjectedPoint(d.coord)?.[1] ?? -9999)
    .attr("fill", editorModel.stroke || stylePreset.stroke)
    .attr("opacity", 0.72)
    .attr("stroke", "#ffffff")
    .attr("stroke-width", 1)
    .attr("pointer-events", "none");

  operationGraphicsEditorGroup.selectAll("circle.operation-graphics-editor-point").raise();

  midpointSelection.exit().remove();
  midpointVisualSelection.exit().remove();
  operationGraphicsEditorGroup.attr("aria-hidden", "false");
  syncInteractionLayerPointerEvents();
}

function getOperationGraphicLabelAnchor(projectedPoints = [], { closed = false } = {}) {
  if (!Array.isArray(projectedPoints) || projectedPoints.length === 0) {
    return null;
  }
  if (closed) {
    const [sumX, sumY] = projectedPoints.reduce(
      (acc, point) => [acc[0] + Number(point?.[0] || 0), acc[1] + Number(point?.[1] || 0)],
      [0, 0]
    );
    return [sumX / projectedPoints.length, sumY / projectedPoints.length];
  }
  if (projectedPoints.length === 1) {
    return projectedPoints[0];
  }
  const midIndex = Math.floor((projectedPoints.length - 1) / 2);
  const start = projectedPoints[midIndex];
  const end = projectedPoints[Math.min(projectedPoints.length - 1, midIndex + 1)];
  const anchorX = (Number(start?.[0] || 0) + Number(end?.[0] || 0)) / 2;
  const anchorY = (Number(start?.[1] || 0) + Number(end?.[1] || 0)) / 2;
  const dx = Number(end?.[0] || 0) - Number(start?.[0] || 0);
  const dy = Number(end?.[1] || 0) - Number(start?.[1] || 0);
  const length = Math.max(1, Math.hypot(dx, dy));
  return [anchorX - (dy / length) * 9, anchorY + (dx / length) * 9];
}

function renderOperationalLinesOverlay() {
  if (!operationalLinesGroup) return;
  renderStrategicDefs();
  ensureOperationalLineEditorState();
  const lines = Array.isArray(state.operationalLines) ? state.operationalLines : [];
  const selectedId = String(state.operationalLineEditor?.selectedId || "");
  const rendered = lines
    .map((line) => {
      const stylePreset = getOperationalLinePreset(line.stylePreset || line.kind);
      const projectedPoints = projectStrategicPoints(line.points);
      const path = createOperationGraphicPath(line.points, {
        closed: false,
        curved: stylePreset.curved !== false,
      });
      if (!path) return null;
      return {
        line,
        stylePreset,
        path,
        projectedPoints,
        labelAnchor: getOperationGraphicLabelAnchor(projectedPoints, { closed: false }),
      };
    })
    .filter(Boolean);

  const groups = operationalLinesGroup
    .selectAll("g.operational-line")
    .data(rendered, (d) => d.line.id);

  const groupEnter = groups.enter().append("g").attr("class", "operational-line");
  groupEnter.append("path").attr("class", "operational-line-casing");
  groupEnter.append("path").attr("class", "operational-line-path");
  groupEnter.append("path").attr("class", "operational-line-hit");
  const labelEnter = groupEnter.append("g").attr("class", "operational-line-label");
  labelEnter.append("rect");
  labelEnter.append("text");

  const merged = groupEnter.merge(groups);
  merged.select("path.operational-line-casing")
    .attr("d", (d) => d.path)
    .attr("fill", "none")
    .attr("stroke", (d) => (d.line.id === selectedId ? "rgba(248, 244, 233, 0.96)" : "rgba(17, 24, 39, 0.5)"))
    .attr("stroke-width", (d) => {
      const baseWidth = d.line.width > 0 ? d.line.width : d.stylePreset.width;
      return baseWidth + (d.line.id === selectedId ? 2.2 : 1.4);
    })
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("stroke-dasharray", (d) => d.stylePreset.dasharray || null)
    .attr("opacity", (d) => (d.line.id === selectedId ? 0.95 : 0.72));

  merged.select("path.operational-line-path")
    .attr("d", (d) => d.path)
    .attr("fill", "none")
    .attr("stroke", (d) => d.line.stroke || d.stylePreset.stroke)
    .attr("stroke-width", (d) => {
      const baseWidth = d.line.width > 0 ? d.line.width : d.stylePreset.width;
      return d.line.id === selectedId ? baseWidth + 0.6 : baseWidth;
    })
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("stroke-dasharray", (d) => d.stylePreset.dasharray || null)
    .attr("opacity", (d) => Number.isFinite(Number(d.line.opacity)) ? Number(d.line.opacity) : d.stylePreset.opacity)
    .attr("marker-end", (d) => d.stylePreset.markerEnd || null);

  merged.select("path.operational-line-hit")
    .attr("d", (d) => d.path)
    .attr("fill", "none")
    .attr("stroke", "transparent")
    .attr("stroke-width", (d) => Math.max(14, (d.line.width > 0 ? d.line.width : d.stylePreset.width) + 8))
    .attr("pointer-events", "stroke");

  merged.select("g.operational-line-label")
    .attr("display", (d) => (d.line.label && Array.isArray(d.labelAnchor) ? null : "none"))
    .attr("transform", (d) => `translate(${d.labelAnchor?.[0] ?? -9999},${d.labelAnchor?.[1] ?? -9999})`);

  merged.select("g.operational-line-label text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", STRATEGIC_LINE_LABEL_FONT)
    .attr("font-size", 9)
    .attr("font-weight", 700)
    .attr("letter-spacing", "0.05em")
    .attr("fill", "#1f2937")
    .text((d) => d.line.label || "");

  merged.select("g.operational-line-label rect")
    .each(function eachLabelPlate() {
      const textNode = globalThis.d3.select(this.parentNode).select("text").node();
      const bbox = textNode?.getBBox?.();
      const width = bbox ? bbox.width + 12 : 56;
      const height = bbox ? bbox.height + 6 : 16;
      globalThis.d3.select(this)
        .attr("x", -width / 2)
        .attr("y", -height / 2)
        .attr("width", width)
        .attr("height", height)
        .attr("rx", 2)
        .attr("ry", 2)
        .attr("fill", "rgba(248, 244, 233, 0.94)")
        .attr("stroke", "rgba(55, 65, 81, 0.55)")
        .attr("stroke-width", 0.8);
    });

  merged.on("click", (event, datum) => {
    event.stopPropagation();
    selectOperationalLineById(datum.line.id);
  });

  groups.exit().remove();
  operationalLinesGroup.attr("aria-hidden", rendered.length ? "false" : "true");
}

function renderOperationGraphicsOverlay() {
  if (!operationGraphicsGroup) return;
  renderStrategicDefs();
  const graphics = Array.isArray(state.operationGraphics) ? state.operationGraphics : [];
  const selectedId = String(state.operationGraphicsEditor?.selectedId || "");
  const rendered = graphics
    .map((graphic) => {
      const geometryPreset = getOperationGraphicPreset(graphic.kind);
      const stylePreset = getOperationGraphicPreset(graphic.stylePreset || graphic.kind);
      const projectedPoints = projectStrategicPoints(graphic.points);
      const path = createOperationGraphicPath(graphic.points, {
        closed: geometryPreset.closed,
        curved: geometryPreset.curved,
      });
      if (!path) return null;
      return {
        graphic,
        geometryPreset,
        stylePreset,
        path,
        projectedPoints,
        labelAnchor: getOperationGraphicLabelAnchor(projectedPoints, { closed: geometryPreset.closed }),
      };
    })
    .filter(Boolean);

  const groups = operationGraphicsGroup
    .selectAll("g.operation-graphic")
    .data(rendered, (d) => d.graphic.id);

  const groupEnter = groups.enter().append("g").attr("class", "operation-graphic");
  groupEnter.append("path").attr("class", "operation-graphic-casing");
  groupEnter.append("path").attr("class", "operation-graphic-path");
  groupEnter.append("path").attr("class", "operation-graphic-hit");
  const labelEnter = groupEnter.append("g").attr("class", "operation-graphic-label");
  labelEnter.append("rect");
  labelEnter.append("text");

  const merged = groupEnter.merge(groups);
  merged.select("path.operation-graphic-casing")
    .attr("d", (d) => d.path)
    .attr("fill", "none")
    .attr("stroke", (d) => (d.graphic.id === selectedId ? "rgba(248, 244, 233, 0.92)" : "rgba(17, 24, 39, 0.45)"))
    .attr("stroke-width", (d) => {
      const baseWidth = d.graphic.width > 0 ? d.graphic.width : d.stylePreset.width;
      return baseWidth + (d.graphic.id === selectedId ? 1.8 : 1.2);
    })
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("stroke-dasharray", (d) => d.stylePreset.dasharray || null)
    .attr("opacity", (d) => (d.graphic.id === selectedId ? 0.95 : 0.68))
    .attr("marker-end", null);

  merged.select("path.operation-graphic-path")
    .attr("d", (d) => d.path)
    .attr("fill", (d) => (d.geometryPreset.closed ? "rgba(15, 23, 42, 0.04)" : "none"))
    .attr("stroke", (d) => d.graphic.stroke || d.stylePreset.stroke)
    .attr("stroke-width", (d) => {
      const baseWidth = d.graphic.width > 0 ? d.graphic.width : d.stylePreset.width;
      return d.graphic.id === selectedId ? baseWidth + 0.4 : baseWidth;
    })
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round")
    .attr("stroke-dasharray", (d) => d.stylePreset.dasharray || null)
    .attr("opacity", (d) => Number.isFinite(Number(d.graphic.opacity)) ? Number(d.graphic.opacity) : d.stylePreset.opacity)
    .attr("marker-end", (d) => d.stylePreset.markerEnd || null);

  merged.select("path.operation-graphic-hit")
    .attr("d", (d) => d.path)
    .attr("fill", "none")
    .attr("stroke", "transparent")
    .attr("stroke-width", (d) => Math.max(10, (d.graphic.width > 0 ? d.graphic.width : d.stylePreset.width) + 7))
    .attr("pointer-events", "stroke");

  merged.select("g.operation-graphic-label")
    .attr("display", (d) => (d.graphic.label && Array.isArray(d.labelAnchor) ? null : "none"))
    .attr("transform", (d) => `translate(${d.labelAnchor?.[0] ?? -9999},${d.labelAnchor?.[1] ?? -9999})`);

  merged.select("g.operation-graphic-label text")
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", STRATEGIC_LINE_LABEL_FONT)
    .attr("font-size", 9)
    .attr("font-weight", 600)
    .attr("letter-spacing", "0.04em")
    .attr("fill", "#1f2937")
    .text((d) => d.graphic.label || "");

  merged.select("g.operation-graphic-label rect")
    .each(function eachLabelPlate() {
      const textNode = globalThis.d3.select(this.parentNode).select("text").node();
      const bbox = textNode?.getBBox?.();
      const width = bbox ? bbox.width + 10 : 48;
      const height = bbox ? bbox.height + 6 : 16;
      globalThis.d3.select(this)
        .attr("x", -width / 2)
        .attr("y", -height / 2)
        .attr("width", width)
        .attr("height", height)
        .attr("rx", 2)
        .attr("ry", 2)
        .attr("fill", "rgba(248, 244, 233, 0.92)")
        .attr("stroke", "rgba(55, 65, 81, 0.55)")
        .attr("stroke-width", 0.8);
    });

  merged.on("click", (event, datum) => {
    event.stopPropagation();
    selectOperationGraphicById(datum.graphic.id);
  });

  groups.exit().remove();
  operationGraphicsGroup.attr("aria-hidden", rendered.length ? "false" : "true");
  renderOperationGraphicsEditorOverlay();
}

function getUnitCounterNationMeta(tag) {
  const normalizedTag = canonicalCountryCode(tag);
  if (!normalizedTag) {
    return {
      tag: "",
      name: "",
      color: "#7c8ba1",
    };
  }
  const scenarioEntry = state.scenarioCountriesByTag?.[normalizedTag];
  const name = getScenarioCountryDisplayName(
    scenarioEntry,
    state.countryNames?.[normalizedTag] || normalizedTag
  ) || state.countryNames?.[normalizedTag] || normalizedTag;
  const color = String(
    scenarioEntry?.color_hex
    || scenarioEntry?.colorHex
    || state.countryPalette?.[normalizedTag]
    || ColorManager.getPoliticalFallbackColor(normalizedTag, 0)
    || "#7c8ba1"
  ).trim() || "#7c8ba1";
  return {
    tag: normalizedTag,
    name,
    color,
  };
}

function normalizeUnitCounterNationSource(value, fallback = "display") {
  const source = String(value || "").trim().toLowerCase();
  return ["display", "controller", "owner", "active", "manual"].includes(source) ? source : fallback;
}

function resolveUnitCounterNationForPlacement(featureId = "", manualTag = "", preferredSource = "display") {
  const normalizedFeatureId = String(featureId || "").trim();
  const normalizedManualTag = canonicalCountryCode(manualTag);
  if (normalizedManualTag) {
    return { tag: normalizedManualTag, source: "manual" };
  }
  const requestedSource = normalizeUnitCounterNationSource(preferredSource, "display");
  const feature = normalizedFeatureId ? state.landIndex?.get(normalizedFeatureId) || null : null;
  const displayTag = canonicalCountryCode(
    normalizedFeatureId ? getDisplayOwnerCode(feature, normalizedFeatureId) : ""
  );
  if (requestedSource === "display" && displayTag) {
    return { tag: displayTag, source: "display" };
  }
  const controllerTag = canonicalCountryCode(state.scenarioControllersByFeatureId?.[normalizedFeatureId] || "");
  if (requestedSource === "controller" && controllerTag) {
    return { tag: controllerTag, source: "controller" };
  }
  const ownerTag = canonicalCountryCode(getFeatureOwnerCode(normalizedFeatureId) || "");
  if (requestedSource === "controller" && ownerTag) {
    return { tag: ownerTag, source: "controller" };
  }
  if (requestedSource === "owner" && ownerTag) {
    return { tag: ownerTag, source: "owner" };
  }
  if (requestedSource === "display" && ownerTag) {
    return { tag: ownerTag, source: "display" };
  }
  if (requestedSource === "display" && controllerTag) {
    return { tag: controllerTag, source: "display" };
  }
  const activeTag = canonicalCountryCode(state.activeSovereignCode || state.selectedInspectorCountryCode || "");
  if (activeTag) {
    return { tag: activeTag, source: requestedSource };
  }
  return { tag: "", source: requestedSource };
}

function getUnitCounterScreenMetrics(size = "medium") {
  const token = normalizeUnitCounterSizeToken(size);
  return UNIT_COUNTER_SCREEN_SIZE[token] || UNIT_COUNTER_SCREEN_SIZE.medium;
}

function getUnitCounterCardModel(counter = {}, { stackCount = 1 } = {}) {
  const preset = getUnitCounterPresetById(counter.presetId || counter.unitType || DEFAULT_UNIT_COUNTER_PRESET_ID);
  const sizeToken = normalizeUnitCounterSizeToken(counter.size);
  const metrics = getUnitCounterScreenMetrics(sizeToken);
  const nation = getUnitCounterNationMeta(counter.nationTag);
  const renderer = String(counter.renderer || preset.defaultRenderer || DEFAULT_UNIT_COUNTER_RENDERER).trim().toLowerCase() === "milstd" ? "milstd" : "game";
  const sidc = getUnitCounterEffectiveSidc({
    ...counter,
    presetId: preset.id,
  });
  const combatState = getNormalizedUnitCounterCombatState(counter);
  return {
    counter,
    preset,
    renderer,
    metrics,
    nation,
    nationTag: nation.tag || "N/A",
    nationName: nation.name || t("Unassigned", "ui"),
    label: String(counter.label || "").trim(),
    subLabel: String(counter.subLabel || "").trim(),
    strengthText: String(counter.strengthText || "").trim(),
    baseFillColor: combatState.baseFillColor || DEFAULT_UNIT_COUNTER_BASE_FILL,
    baseFillColorOverride: combatState.baseFillColor,
    organizationPct: combatState.organizationPct,
    equipmentPct: combatState.equipmentPct,
    statsPresetId: combatState.statsPresetId,
    statsSource: combatState.statsSource,
    echelon: String(counter.echelon || preset.defaultEchelon || "").trim().toLowerCase(),
    echelonLabel: getUnitCounterEchelonLabel(counter.echelon || preset.defaultEchelon || ""),
    shortCode: String(counter.unitType || preset.shortCode || "").trim().toUpperCase() || preset.shortCode,
    iconId: String(counter.iconId || preset.iconId || "infantry").trim().toLowerCase() || "infantry",
    shellVariant: preset.shellVariant || "line",
    sidc,
    stackCount: Math.max(1, Number(stackCount) || 1),
    symbolUri: renderer === "milstd"
      ? getMilSymbolDataUri(sidc, UNIT_COUNTER_MILSTD_SIZE_BY_TOKEN[sizeToken] || UNIT_COUNTER_MILSTD_SIZE_BY_TOKEN.medium)
      : "",
    sizeToken,
  };
}

function getUnitCounterPreviewData(partialCounter = {}) {
  ensureUnitCounterEditorState();
  return getUnitCounterCardModel({
    renderer: partialCounter.renderer || state.unitCounterEditor.renderer || DEFAULT_UNIT_COUNTER_RENDERER,
    sidc: partialCounter.sidc || partialCounter.symbolCode || state.unitCounterEditor.sidc || state.unitCounterEditor.symbolCode || "",
    symbolCode: partialCounter.symbolCode || partialCounter.sidc || state.unitCounterEditor.symbolCode || state.unitCounterEditor.sidc || "",
    nationTag: partialCounter.nationTag || state.unitCounterEditor.nationTag || "",
    presetId: partialCounter.presetId || state.unitCounterEditor.presetId || DEFAULT_UNIT_COUNTER_PRESET_ID,
    unitType: partialCounter.unitType || state.unitCounterEditor.unitType || "",
    echelon: partialCounter.echelon || state.unitCounterEditor.echelon || "",
    label: partialCounter.label || state.unitCounterEditor.label || "",
    subLabel: partialCounter.subLabel || state.unitCounterEditor.subLabel || "",
    strengthText: partialCounter.strengthText || state.unitCounterEditor.strengthText || "",
    baseFillColor: partialCounter.baseFillColor ?? state.unitCounterEditor.baseFillColor ?? "",
    organizationPct: partialCounter.organizationPct ?? state.unitCounterEditor.organizationPct ?? DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT,
    equipmentPct: partialCounter.equipmentPct ?? state.unitCounterEditor.equipmentPct ?? DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT,
    statsPresetId: partialCounter.statsPresetId || state.unitCounterEditor.statsPresetId || "regular",
    statsSource: partialCounter.statsSource || state.unitCounterEditor.statsSource || "preset",
    size: partialCounter.size || state.unitCounterEditor.size || "medium",
  });
}

function getUnitCounterIconPath(iconId = "") {
  return getUnitCounterIconPathById(iconId);
}

function getOperationalLineAnchorCoord(lineId = "") {
  const line = getOperationalLineById(lineId);
  if (!line || !Array.isArray(line.points) || line.points.length < 2) return null;
  return getLineMidpointFromCoordinates(line.points);
}

function getUnitCounterRenderAnchor(counter = {}) {
  const attachedLineId = String(counter?.attachment?.lineId || "").trim();
  if (attachedLineId) {
    const lineCoord = getOperationalLineAnchorCoord(attachedLineId);
    if (lineCoord) {
      return {
        coord: lineCoord,
        key: `line:${attachedLineId}`,
      };
    }
  }
  const lon = Number(counter?.anchor?.lon || 0);
  const lat = Number(counter?.anchor?.lat || 0);
  return {
    coord: [lon, lat],
    key: String(counter?.anchor?.featureId || "").trim() || `${Math.round(lon * 3)}:${Math.round(lat * 3)}`,
  };
}

function getUnitCounterSlotOffset(slotIndex = 0, stackCount = 1, metrics = UNIT_COUNTER_SCREEN_SIZE.medium) {
  const count = Math.max(1, Number(stackCount) || 1);
  const index = Math.max(0, Number(slotIndex) || 0);
  const columns = count <= 2 ? count : count <= 4 ? 2 : 3;
  const rows = Math.max(1, Math.ceil(count / Math.max(1, columns)));
  const row = Math.floor(index / Math.max(1, columns));
  const col = index % Math.max(1, columns);
  const itemsInRow = row === rows - 1 ? Math.min(columns, count - row * columns) : columns;
  const x = (col - (itemsInRow - 1) / 2) * Math.max(metrics.width * 0.76, 18);
  const y = (row - (rows - 1) / 2) * Math.max(metrics.height * 0.84, 14);
  return [x, y];
}

function compareUnitCounterRenderOrder(left, right) {
  const zDelta = Number(left?.zIndex || 0) - Number(right?.zIndex || 0);
  if (zDelta !== 0) return zDelta;
  const leftId = String(left?.id || "");
  const rightId = String(right?.id || "");
  if (leftId < rightId) return -1;
  if (leftId > rightId) return 1;
  return 0;
}

function getUnitCounterRenderEntries() {
  const counters = Array.isArray(state.unitCounters) ? state.unitCounters : [];
  const grouped = new Map();
  counters.forEach((counter) => {
    const anchor = getUnitCounterRenderAnchor(counter);
    const key = String(anchor?.key || "");
    if (!grouped.has(key)) {
      grouped.set(key, { anchor, counters: [] });
    }
    grouped.get(key).counters.push(counter);
  });
  return Array.from(grouped.values()).flatMap((bucket) => {
    const sortedBucket = bucket.counters
      .slice()
      .sort(compareUnitCounterRenderOrder);
    return sortedBucket.map((counter, slotIndex) => ({
      counter,
      stackCount: sortedBucket.length,
      slotIndex,
      anchor: bucket.anchor,
    }));
  });
}

function getUnitCounterRenderScale(metrics, zoomK) {
  const normalizedZoom = Math.max(0.1, Number(zoomK) || 1);
  const zoomPercent = normalizedZoom * 100;
  const fixedScaleMultiplier = clamp(
    Number(state.annotationView?.unitCounterFixedScaleMultiplier) || 1.5,
    0.5,
    2.0,
  );
  const desiredScreenScale = 0.5 * fixedScaleMultiplier;

  const effectiveWidth = Number(metrics?.width || 0) * desiredScreenScale;
  const localScale = desiredScreenScale / normalizedZoom;
  const hidden = zoomPercent <= 600;
  const opacity = hidden ? 0 : 1;

  return {
    desiredScreenScale,
    localScale,
    effectiveWidth,
    hidden,
    opacity,
  };
}

// 在缩放过程中轻量更新兵牌 transform，避免 localScale 陈旧导致跳变
function getUnitCounterNodeTransform(entry) {
  const projected = Array.isArray(entry?.projected) ? entry.projected : [0, 0];
  const slotOffset = Array.isArray(entry?.slotOffset) ? entry.slotOffset : [0, 0];
  const localScale = Number(entry?.scaleModel?.localScale || 1);
  return `translate(${projected[0]},${projected[1]}) scale(${localScale}) translate(${slotOffset[0]},${slotOffset[1]})`;
}

function syncUnitCounterScalesDuringZoom() {
  if (!unitCountersGroup) return;
  const rootNode = typeof unitCountersGroup.node === "function" ? unitCountersGroup.node() : null;
  if (!rootNode?.children?.length) return;
  const zoomK = Math.max(0.1, Number(state.zoomTransform?.k || 1));
  unitCountersGroup.selectAll("g.unit-counter").each(function (d) {
    if (!d || !d.model) return;
    const previousScaleModel = d.scaleModel && typeof d.scaleModel === "object" ? d.scaleModel : null;
    const sc = getUnitCounterRenderScale(d.model.metrics, zoomK);
    d.scaleModel = sc;
    const node = this;
    const wasHidden = !!previousScaleModel?.hidden;
    if (sc.hidden) {
      if (!wasHidden || node.getAttribute("display") !== "none") {
        node.setAttribute("display", "none");
      }
      return;
    }
    if (wasHidden || node.getAttribute("display") === "none") {
      node.setAttribute("display", "");
    }
    const localScaleChanged =
      !previousScaleModel
      || Number(previousScaleModel.localScale || 1) !== Number(sc.localScale || 1);
    if (localScaleChanged || wasHidden) {
      node.setAttribute("transform", getUnitCounterNodeTransform(d));
    }
    const nextOpacity = String(sc.opacity);
    if (
      !previousScaleModel
      || wasHidden
      || String(previousScaleModel.opacity) !== nextOpacity
      || node.getAttribute("opacity") !== nextOpacity
    ) {
      node.setAttribute("opacity", nextOpacity);
    }
  });
}

function renderUnitCountersOverlay() {
  if (!unitCountersGroup) return;
  ensureUnitCounterEditorState();
  const selectedId = String(state.unitCounterEditor?.selectedId || "");
  const zoomK = Math.max(0.1, Number(state.zoomTransform?.k || 1));
  const entries = getUnitCounterRenderEntries()
    .map(({ counter, stackCount, slotIndex, anchor }) => {
      const projected = getProjectedPoint(anchor?.coord);
      if (!projected) return null;
      const model = getUnitCounterCardModel(counter, { stackCount });
      const scaleModel = getUnitCounterRenderScale(model.metrics, zoomK);
      if (scaleModel.hidden) return null;
      const slotOffset = getUnitCounterSlotOffset(slotIndex, stackCount, model.metrics);
      return {
        counter,
        projected,
        stackCount,
        slotIndex,
        slotOffset,
        model,
        scaleModel,
      };
    })
    .filter(Boolean)
    .sort((a, b) => compareUnitCounterRenderOrder(a.counter, b.counter));

  const groups = unitCountersGroup
    .selectAll("g.unit-counter")
    .data(entries, (d) => d.counter.id);

  const groupEnter = groups.enter().append("g").attr("class", "unit-counter").style("cursor", "grab");
  groupEnter.append("rect").attr("class", "unit-counter-stack-shadow is-back-2");
  groupEnter.append("rect").attr("class", "unit-counter-stack-shell is-back-2");
  groupEnter.append("rect").attr("class", "unit-counter-stack-strip is-back-2");
  groupEnter.append("rect").attr("class", "unit-counter-stack-shadow is-back-1");
  groupEnter.append("rect").attr("class", "unit-counter-stack-shell is-back-1");
  groupEnter.append("rect").attr("class", "unit-counter-stack-strip is-back-1");
  groupEnter.append("rect").attr("class", "unit-counter-shadow");
  groupEnter.append("rect").attr("class", "unit-counter-shell");
  groupEnter.append("rect").attr("class", "unit-counter-strip");
  groupEnter.append("rect").attr("class", "unit-counter-tag-pill");
  groupEnter.append("text").attr("class", "unit-counter-tag-text");
  groupEnter.append("rect").attr("class", "unit-counter-type-chip");
  groupEnter.append("text").attr("class", "unit-counter-type-text");
  groupEnter.append("image").attr("class", "unit-counter-milsymbol");
  groupEnter.append("path").attr("class", "unit-counter-icon");
  groupEnter.append("text").attr("class", "unit-counter-symbol");
  groupEnter.append("rect").attr("class", "unit-counter-org-track");
  groupEnter.append("rect").attr("class", "unit-counter-org-fill");
  groupEnter.append("rect").attr("class", "unit-counter-equip-track");
  groupEnter.append("rect").attr("class", "unit-counter-equip-fill");
  groupEnter.append("text").attr("class", "unit-counter-echelons");
  groupEnter.append("text").attr("class", "unit-counter-label");
  groupEnter.append("text").attr("class", "unit-counter-sublabel");
  groupEnter.append("circle").attr("class", "unit-counter-stack-badge");
  groupEnter.append("text").attr("class", "unit-counter-stack-text");

  const merged = groupEnter.merge(groups)
    .attr("transform", (d) => getUnitCounterNodeTransform(d))
    .attr("data-counter-id", (d) => d.counter.id)
    .attr("display", "")
    .attr("opacity", (d) => d.scaleModel.opacity)
    .attr("pointer-events", "all");

  const applyStackPlate = (selection, {
    plateIndex = 0,
    shadowClass = "rect.unit-counter-stack-shadow",
    shellClass = "rect.unit-counter-stack-shell",
    stripClass = "rect.unit-counter-stack-strip",
  } = {}) => {
    const offsetX = plateIndex === 1 ? -1.8 : -3.4;
    const offsetY = plateIndex === 1 ? -1.6 : -3.1;
    selection.select(shadowClass)
      .attr("display", "none")
      .attr("x", (d) => -d.model.metrics.width / 2 + offsetX)
      .attr("y", (d) => -d.model.metrics.height / 2 + offsetY)
      .attr("width", (d) => d.model.metrics.width)
      .attr("height", (d) => d.model.metrics.height)
      .attr("rx", 2)
      .attr("ry", 2)
      .attr("fill", "rgba(15, 23, 42, 0.18)")
      .attr("opacity", 0.38);

    selection.select(shellClass)
      .attr("display", "none")
      .attr("x", (d) => -d.model.metrics.width / 2 + offsetX)
      .attr("y", (d) => -d.model.metrics.height / 2 + offsetY)
      .attr("width", (d) => d.model.metrics.width)
      .attr("height", (d) => d.model.metrics.height)
      .attr("rx", 2)
      .attr("ry", 2)
      .attr("fill", DEFAULT_UNIT_COUNTER_BASE_FILL)
      .attr("stroke", "rgba(31, 41, 55, 0.46)")
      .attr("stroke-width", 0.75);

    selection.select(stripClass)
      .attr("display", "none")
      .attr("x", (d) => -d.model.metrics.width / 2 + offsetX)
      .attr("y", (d) => -d.model.metrics.height / 2 + offsetY)
      .attr("width", (d) => Math.max(1.6, d.model.metrics.width * 0.12))
      .attr("height", (d) => d.model.metrics.height)
      .attr("fill", (d) => d.model.nation.color);
  };

  applyStackPlate(merged, {
    plateIndex: 1,
    shadowClass: "rect.unit-counter-stack-shadow.is-back-2",
    shellClass: "rect.unit-counter-stack-shell.is-back-2",
    stripClass: "rect.unit-counter-stack-strip.is-back-2",
  });
  applyStackPlate(merged, {
    plateIndex: 0,
    shadowClass: "rect.unit-counter-stack-shadow.is-back-1",
    shellClass: "rect.unit-counter-stack-shell.is-back-1",
    stripClass: "rect.unit-counter-stack-strip.is-back-1",
  });

  merged.select("rect.unit-counter-shadow")
    .attr("x", (d) => -d.model.metrics.width / 2)
    .attr("y", (d) => -d.model.metrics.height / 2)
    .attr("width", (d) => d.model.metrics.width)
    .attr("height", (d) => d.model.metrics.height)
    .attr("rx", 2)
    .attr("ry", 2)
    .attr("fill", "rgba(15, 23, 42, 0.22)")
    .attr("opacity", 0.44)
    .attr("transform", "translate(0.9, 0.9)");

  merged.select("rect.unit-counter-shell")
    .attr("x", (d) => -d.model.metrics.width / 2)
    .attr("y", (d) => -d.model.metrics.height / 2)
    .attr("width", (d) => d.model.metrics.width)
    .attr("height", (d) => d.model.metrics.height)
    .attr("rx", 2)
    .attr("ry", 2)
    .attr("fill", (d) => d.model.baseFillColor || DEFAULT_UNIT_COUNTER_BASE_FILL)
    .attr("stroke", (d) => (d.counter.id === selectedId ? "#f5ecd7" : "rgba(31, 41, 55, 0.82)"))
    .attr("stroke-width", (d) => (d.counter.id === selectedId ? 1.3 : 0.9));

  merged.select("rect.unit-counter-strip")
    .attr("x", (d) => -d.model.metrics.width / 2)
    .attr("y", (d) => -d.model.metrics.height / 2)
    .attr("width", (d) => Math.max(1.6, d.model.metrics.width * 0.12))
    .attr("height", (d) => d.model.metrics.height)
    .attr("rx", 0)
    .attr("ry", 0)
    .attr("fill", (d) => d.model.nation.color);

  merged.select("rect.unit-counter-tag-pill")
    .attr("x", (d) => -d.model.metrics.width / 2 + Math.max(2.2, d.model.metrics.width * 0.14))
    .attr("y", (d) => -d.model.metrics.height / 2 + 2)
    .attr("width", (d) => Math.max(9, d.model.metrics.width * 0.32))
    .attr("height", 4.6)
    .attr("rx", 0.8)
    .attr("ry", 0.8)
    .attr("fill", (d) => d.model.nation.color);

  merged.select("text.unit-counter-tag-text")
    .attr("x", (d) => -d.model.metrics.width / 2 + Math.max(2.2, d.model.metrics.width * 0.14) + Math.max(9, d.model.metrics.width * 0.32) / 2)
    .attr("y", (d) => -d.model.metrics.height / 2 + 4.3)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", STRATEGIC_LINE_LABEL_FONT)
    .attr("font-size", 3.2)
    .attr("font-weight", 700)
    .attr("letter-spacing", "0.03em")
    .attr("fill", "#f8fafc")
    .text((d) => d.model.nation.tag || "AUTO");

  merged.select("rect.unit-counter-type-chip")
    .attr("x", (d) => d.model.metrics.width / 2 - Math.max(10, d.model.metrics.width * 0.36) - 2)
    .attr("y", (d) => -d.model.metrics.height / 2 + 2)
    .attr("width", (d) => Math.max(10, d.model.metrics.width * 0.36))
    .attr("height", 4.6)
    .attr("rx", 0.8)
    .attr("ry", 0.8)
    .attr("fill", "rgba(226, 221, 208, 0.96)");

  merged.select("text.unit-counter-type-text")
    .attr("x", (d) => d.model.metrics.width / 2 - 2 - Math.max(10, d.model.metrics.width * 0.36) / 2)
    .attr("y", (d) => -d.model.metrics.height / 2 + 4.3)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", STRATEGIC_LINE_LABEL_FONT)
    .attr("font-size", 3.2)
    .attr("font-weight", 700)
    .attr("letter-spacing", "0.03em")
    .attr("fill", "#111827")
    .text((d) => d.model.shortCode.slice(0, 3));

  merged.select("image.unit-counter-milsymbol")
    .attr("display", (d) => (d.model.renderer === "milstd" ? null : "none"))
    .attr("x", (d) => -(d.model.metrics.symbolBox / 2))
    .attr("y", (d) => -d.model.metrics.symbolBox / 2 + 1)
    .attr("width", (d) => d.model.metrics.symbolBox)
    .attr("height", (d) => d.model.metrics.symbolBox)
    .attr("preserveAspectRatio", "xMidYMid meet")
    .attr("href", (d) => d.model.symbolUri);

  merged.select("path.unit-counter-icon")
    .attr("display", (d) => (d.model.renderer === "game" ? null : "none"))
    .attr("d", (d) => getUnitCounterIconPath(d.model.iconId))
    .attr("transform", "translate(0, 1) scale(1)")
    .attr("fill", "none")
    .attr("stroke", "#0f172a")
    .attr("stroke-width", 0.95)
    .attr("stroke-linecap", "round")
    .attr("stroke-linejoin", "round");

  merged.select("text.unit-counter-symbol")
    .attr("display", (d) => {
      if (d.model.renderer === "milstd") {
        return d.model.symbolUri ? "none" : null;
      }
      return "none";
    })
    .attr("x", 0)
    .attr("y", 1)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", "\"Roboto Condensed\", \"Segoe UI\", sans-serif")
    .attr("font-size", (d) => (d.model.renderer === "milstd" ? 5.6 : 6.6))
    .attr("font-weight", 700)
    .attr("fill", "#0f172a")
    .text((d) => d.model.shortCode.slice(0, 3));

  merged.select("rect.unit-counter-org-track")
    .attr("x", (d) => -d.model.metrics.width / 2 + Math.max(2.8, d.model.metrics.width * 0.15))
    .attr("y", (d) => d.model.metrics.height / 2 - 7.2)
    .attr("width", (d) => d.model.metrics.width * 0.64)
    .attr("height", 1.5)
    .attr("rx", 0.75)
    .attr("ry", 0.75)
    .attr("fill", "rgba(255, 255, 255, 0.64)")
    .attr("stroke", "rgba(15, 23, 42, 0.08)")
    .attr("stroke-width", 0.22);

  merged.select("rect.unit-counter-org-fill")
    .attr("x", (d) => -d.model.metrics.width / 2 + Math.max(2.8, d.model.metrics.width * 0.15))
    .attr("y", (d) => d.model.metrics.height / 2 - 7.2)
    .attr("width", (d) => (d.model.metrics.width * 0.64) * (d.model.organizationPct / 100))
    .attr("height", 1.5)
    .attr("rx", 0.75)
    .attr("ry", 0.75)
    .attr("fill", "rgba(34, 197, 94, 0.94)");

  merged.select("rect.unit-counter-equip-track")
    .attr("x", (d) => -d.model.metrics.width / 2 + Math.max(2.8, d.model.metrics.width * 0.15))
    .attr("y", (d) => d.model.metrics.height / 2 - 4.8)
    .attr("width", (d) => d.model.metrics.width * 0.64)
    .attr("height", 1.5)
    .attr("rx", 0.75)
    .attr("ry", 0.75)
    .attr("fill", "rgba(255, 255, 255, 0.64)")
    .attr("stroke", "rgba(15, 23, 42, 0.08)")
    .attr("stroke-width", 0.22);

  merged.select("rect.unit-counter-equip-fill")
    .attr("x", (d) => -d.model.metrics.width / 2 + Math.max(2.8, d.model.metrics.width * 0.15))
    .attr("y", (d) => d.model.metrics.height / 2 - 4.8)
    .attr("width", (d) => (d.model.metrics.width * 0.64) * (d.model.equipmentPct / 100))
    .attr("height", 1.5)
    .attr("rx", 0.75)
    .attr("ry", 0.75)
    .attr("fill", "rgba(234, 179, 8, 0.96)");

  merged.select("text.unit-counter-echelons")
    .attr("display", (d) => (d.model.echelonLabel ? null : "none"))
    .attr("x", 0)
    .attr("y", (d) => d.model.metrics.height / 2 - 1.8)
    .attr("text-anchor", "middle")
    .attr("font-family", STRATEGIC_LINE_LABEL_FONT)
    .attr("font-size", 3.3)
    .attr("font-weight", 700)
    .attr("letter-spacing", "0.04em")
    .attr("fill", "rgba(17, 24, 39, 0.78)")
    .text((d) => d.model.echelonLabel.slice(0, 3).toUpperCase());

  merged.select("text.unit-counter-label")
    .attr("display", (d) => (
      state.annotationView?.showUnitLabels !== false
      && d.counter.label
      && (d.counter.id === selectedId || zoomK >= 7)
        ? null
        : "none"
    ))
    .attr("x", 0)
    .attr("y", (d) => d.model.metrics.height / 2 + 4.5)
    .attr("text-anchor", "middle")
    .attr("font-family", STRATEGIC_LINE_LABEL_FONT)
    .attr("dominant-baseline", "hanging")
    .attr("font-size", 4.2)
    .attr("font-weight", 600)
    .attr("letter-spacing", "0.03em")
    .attr("fill", "#f6f1e6")
    .attr("stroke", "rgba(17, 24, 39, 0.88)")
    .attr("stroke-width", 0.45)
    .attr("paint-order", "stroke")
    .text((d) => d.counter.label || "");

  merged.select("text.unit-counter-sublabel")
    .attr("display", (d) => (
      state.annotationView?.showUnitLabels !== false
      && d.counter.subLabel
      && (d.counter.id === selectedId || zoomK >= 10)
        ? null
        : "none"
    ))
    .attr("x", 0)
    .attr("y", (d) => d.model.metrics.height / 2 + 9.5)
    .attr("text-anchor", "middle")
    .attr("font-family", STRATEGIC_LINE_LABEL_FONT)
    .attr("dominant-baseline", "hanging")
    .attr("font-size", 3.5)
    .attr("font-weight", 500)
    .attr("fill", "rgba(243, 239, 231, 0.92)")
    .attr("stroke", "rgba(17, 24, 39, 0.78)")
    .attr("stroke-width", 0.35)
    .attr("paint-order", "stroke")
    .text((d) => d.counter.subLabel || "");

  merged.select("circle.unit-counter-stack-badge")
    .attr("display", "none")
    .attr("cx", (d) => d.model.metrics.width / 2 - 1.5)
    .attr("cy", (d) => -d.model.metrics.height / 2 + 1.5)
    .attr("r", 3.5)
    .attr("fill", "#0f172a")
    .attr("stroke", "#f8fafc")
    .attr("stroke-width", 0.6);

  merged.select("text.unit-counter-stack-text")
    .attr("display", "none")
    .attr("x", (d) => d.model.metrics.width / 2 - 1.5)
    .attr("y", (d) => -d.model.metrics.height / 2 + 1.5)
    .attr("text-anchor", "middle")
    .attr("dominant-baseline", "central")
    .attr("font-family", STRATEGIC_LINE_LABEL_FONT)
    .attr("font-size", 3.1)
    .attr("font-weight", 700)
    .attr("fill", "#f8fafc")
    .text("");

  if (globalThis.d3?.drag) {
    if (!renderUnitCountersOverlay.dragBehavior) {
      renderUnitCountersOverlay.dragBehavior = globalThis.d3.drag()
        .on("start", function onStart(event, datum) {
          ensureUnitCounterEditorState();
          datum.__historyBefore = captureHistoryState({ strategicOverlay: true });
          state.unitCounterEditor.selectedId = datum.counter.id;
          datum.__dragMoved = false;
          updateStrategicOverlayUi();
          globalThis.d3.select(this).style("cursor", "grabbing");
        })
        .on("drag", function onDrag(event, datum) {
          const sourceEvent = event?.sourceEvent || event;
          const coord = getMapLonLatFromEvent(sourceEvent);
          if (!coord) return;
          if (!datum.__dragMoved) {
            datum.__dragMoved = true;
            datum.counter.attachment = null;
            datum.counter.layoutAnchor = {
              ...(datum.counter.layoutAnchor || {}),
              kind: "feature",
              key: String(datum.counter.anchor?.featureId || ""),
              slotIndex: null,
            };
          }
          datum.counter.anchor = {
            ...(datum.counter.anchor || {}),
            lon: coord[0],
            lat: coord[1],
          };
          state.unitCountersDirty = true;
          const projected = getProjectedPoint(coord);
          if (projected) {
            datum.projected = projected;
            this.setAttribute("transform", getUnitCounterNodeTransform(datum));
          }
        })
        .on("end", function onEnd(event, datum) {
          globalThis.d3.select(this).style("cursor", "grab");
          if (datum.__dragMoved) {
            datum.counter.anchor = {
              ...(datum.counter.anchor || {}),
              featureId: getLandFeatureIdFromEvent(event?.sourceEvent || event, "unit-counter-drag-end"),
            };
            datum.counter.layoutAnchor = {
              ...(datum.counter.layoutAnchor || {}),
              kind: "feature",
              key: String(datum.counter.anchor?.featureId || ""),
              slotIndex: null,
            };
            state.unitCountersDirty = true;
            pushHistoryEntry({
              kind: "move-unit-counter",
              before: datum.__historyBefore,
              after: captureHistoryState({ strategicOverlay: true }),
            });
            markDirty("move-unit-counter");
          }
          datum.__historyBefore = null;
          datum.__dragMoved = false;
          updateStrategicOverlayUi();
          renderUnitCountersIfNeeded({ force: true });
        });
    }
    merged.call(renderUnitCountersOverlay.dragBehavior);
  }

  merged.on("click", (_event, datum) => {
    ensureUnitCounterEditorState();
    state.unitCounterEditor.selectedId = datum.counter.id;
    assignUnitCounterEditorFromCounter(datum.counter);
    state.unitCountersDirty = true;
    updateStrategicOverlayUi();
    renderUnitCountersIfNeeded({ force: true });
  });

  groups.exit().remove();
  unitCountersGroup.attr("aria-hidden", entries.length ? "false" : "true");
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
    ["labels", renderPerf.drawLabelsPass?.durationMs],
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
    `projBounds total=${Number(renderPerf.projectedBoundsDiagnostics?.total || 0)} reasons=${JSON.stringify(renderPerf.projectedBoundsDiagnostics?.byReason || {})}`,
    `invalidations ${invalidations}`,
    `render draw=${cache.counters.drawCanvas || 0} frame=${cache.counters.frames || 0} ctxBase=${cache.counters.contextBasePassRenders || 0} labels=${cache.counters.labelPassRenders || 0} ctxScenario=${cache.counters.contextScenarioPassRenders || 0} dayNight=${cache.counters.dayNightPassRenders || 0} hit=${cache.counters.hitCanvasRenders || 0} dynBorder=${cache.counters.dynamicBorderRebuilds || 0}`,
    `sidebar list=${sidebarPerf.counters.fullListRenders || 0} rows=${sidebarPerf.counters.rowRefreshes || 0} detail=${sidebarPerf.counters.inspectorRenders || 0} preset=${sidebarPerf.counters.presetTreeRenders || 0} legend=${sidebarPerf.counters.legendRenders || 0}`,
  ].join("\n");
}

function render() {
  drawCanvas();
  if (state.renderPhase === RENDER_PHASE_IDLE) {
    scheduleHitCanvasBuildIfNeeded();
  }
  renderFrontlineOverlayIfNeeded();
  renderOperationalLinesIfNeeded();
  renderOperationGraphicsIfNeeded();
  renderUnitCountersIfNeeded();
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
  markLegacyColorStateDirty();
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

function ensureOperationGraphicCounter() {
  ensureOperationGraphicsEditorState();
  const used = new Set((state.operationGraphics || []).map((graphic) => String(graphic?.id || "")));
  let counter = Math.max(1, Number(state.operationGraphicsEditor.counter) || 1);
  while (used.has(`opg_${counter}`)) {
    counter += 1;
  }
  state.operationGraphicsEditor.counter = counter;
}

function appendOperationGraphicVertexFromEvent(event) {
  ensureOperationGraphicsEditorState();
  const coord = getMapLonLatFromEvent(event);
  if (!coord) return false;
  state.operationGraphicsEditor.points.push(coord);
  state.operationGraphicsDirty = true;
  updateStrategicOverlayUi();
  renderOperationGraphicsIfNeeded({ force: true });
  return true;
}

function startOperationGraphicDraw({
  kind = DEFAULT_OPERATION_GRAPHIC_KIND,
  label = "",
  stylePreset = DEFAULT_OPERATION_GRAPHIC_KIND,
  stroke = "",
  width = 0,
  opacity = 1,
} = {}) {
  ensureOperationGraphicsEditorState();
  state.operationGraphicsEditor.active = true;
  state.operationGraphicsEditor.mode = "draw";
  state.operationGraphicsEditor.points = [];
  state.operationGraphicsEditor.kind = String(kind || DEFAULT_OPERATION_GRAPHIC_KIND);
  state.operationGraphicsEditor.label = String(label || "");
  state.operationGraphicsEditor.stylePreset = normalizeOperationGraphicStylePreset(stylePreset, kind);
  state.operationGraphicsEditor.stroke = normalizeOperationGraphicStroke(stroke);
  state.operationGraphicsEditor.width = normalizeOperationGraphicWidth(width);
  state.operationGraphicsEditor.opacity = normalizeOperationGraphicOpacity(opacity);
  state.operationGraphicsEditor.selectedId = null;
  state.operationGraphicsEditor.selectedVertexIndex = -1;
  state.operationGraphicsDirty = true;
  updateStrategicOverlayUi();
  if (context) render();
}

function undoOperationGraphicVertex() {
  ensureOperationGraphicsEditorState();
  if (!state.operationGraphicsEditor.active || !state.operationGraphicsEditor.points.length) return;
  state.operationGraphicsEditor.points.pop();
  state.operationGraphicsDirty = true;
  updateStrategicOverlayUi();
  if (context) render();
}

function cancelOperationGraphicDraw() {
  ensureOperationGraphicsEditorState();
  state.operationGraphicsEditor.active = false;
  state.operationGraphicsEditor.mode = state.operationGraphicsEditor.selectedId ? "edit" : "idle";
  state.operationGraphicsEditor.points = [];
  state.operationGraphicsEditor.selectedVertexIndex = -1;
  state.operationGraphicsDirty = true;
  updateStrategicOverlayUi();
  if (context) render();
}

function finishOperationGraphicDraw() {
  ensureOperationGraphicsEditorState();
  const kind = String(state.operationGraphicsEditor.kind || DEFAULT_OPERATION_GRAPHIC_KIND);
  const minPoints = getOperationGraphicMinPoints(kind);
  const points = Array.isArray(state.operationGraphicsEditor.points) ? state.operationGraphicsEditor.points : [];
  if (!state.operationGraphicsEditor.active || points.length < minPoints) {
    cancelOperationGraphicDraw();
    return false;
  }
  ensureOperationGraphicCounter();
  const before = captureHistoryState({ strategicOverlay: true });
  const id = `opg_${state.operationGraphicsEditor.counter}`;
  state.operationGraphics.push({
    id,
    kind,
    label: String(state.operationGraphicsEditor.label || "").trim(),
    points: [...points],
    stylePreset: normalizeOperationGraphicStylePreset(state.operationGraphicsEditor.stylePreset, kind),
    stroke: normalizeOperationGraphicStroke(state.operationGraphicsEditor.stroke) || null,
    width: normalizeOperationGraphicWidth(state.operationGraphicsEditor.width),
    opacity: normalizeOperationGraphicOpacity(state.operationGraphicsEditor.opacity),
  });
  state.operationGraphicsEditor.counter += 1;
  state.operationGraphicsEditor.selectedId = id;
  state.operationGraphicsEditor.active = false;
  state.operationGraphicsEditor.mode = "edit";
  state.operationGraphicsEditor.points = [...points];
  state.operationGraphicsEditor.selectedVertexIndex = -1;
  state.operationGraphicsDirty = true;
  commitHistoryEntry({
    kind: "finish-operation-graphic",
    before,
    after: captureHistoryState({ strategicOverlay: true }),
  });
  markDirty("finish-operation-graphic");
  updateStrategicOverlayUi();
  if (context) render();
  return true;
}

function selectOperationGraphicById(id) {
  ensureOperationGraphicsEditorState();
  const selectedId = String(id || "").trim();
  const graphic = getOperationGraphicById(selectedId);
  state.operationGraphicsEditor.selectedId = selectedId || null;
  state.operationGraphicsEditor.selectedVertexIndex = -1;
  if (graphic) {
    state.operationGraphicsEditor.kind = String(graphic.kind || DEFAULT_OPERATION_GRAPHIC_KIND);
    state.operationGraphicsEditor.label = String(graphic.label || "");
    state.operationGraphicsEditor.stylePreset = normalizeOperationGraphicStylePreset(graphic.stylePreset, graphic.kind);
    state.operationGraphicsEditor.stroke = normalizeOperationGraphicStroke(graphic.stroke);
    state.operationGraphicsEditor.width = normalizeOperationGraphicWidth(graphic.width);
    state.operationGraphicsEditor.opacity = normalizeOperationGraphicOpacity(graphic.opacity);
    state.operationGraphicsEditor.points = Array.isArray(graphic.points) ? [...graphic.points] : [];
    state.operationGraphicsEditor.mode = "edit";
  } else {
    state.operationGraphicsEditor.points = [];
    state.operationGraphicsEditor.mode = "idle";
  }
  state.operationGraphicsDirty = true;
  updateStrategicOverlayUi();
  if (context) render();
}

function deleteSelectedOperationGraphic() {
  ensureOperationGraphicsEditorState();
  const selectedId = String(state.operationGraphicsEditor.selectedId || "").trim();
  if (!selectedId) return false;
  const before = captureHistoryState({ strategicOverlay: true });
  const nextGraphics = (state.operationGraphics || []).filter((entry) => String(entry?.id || "") !== selectedId);
  if (nextGraphics.length === (state.operationGraphics || []).length) return false;
  state.operationGraphics = nextGraphics;
  state.operationGraphicsEditor.selectedId = null;
  state.operationGraphicsEditor.points = [];
  state.operationGraphicsEditor.selectedVertexIndex = -1;
  state.operationGraphicsEditor.mode = "idle";
  state.operationGraphicsDirty = true;
  commitHistoryEntry({
    kind: "delete-operation-graphic",
    before,
    after: captureHistoryState({ strategicOverlay: true }),
  });
  markDirty("delete-operation-graphic");
  updateStrategicOverlayUi();
  if (context) render();
  return true;
}

function updateSelectedOperationGraphic(partial = {}) {
  ensureOperationGraphicsEditorState();
  const selectedId = String(state.operationGraphicsEditor.selectedId || "").trim();
  if (!selectedId) return false;
  const target = (state.operationGraphics || []).find((entry) => String(entry?.id || "") === selectedId);
  if (!target) return false;
  const nextKind = partial.kind ? String(partial.kind || DEFAULT_OPERATION_GRAPHIC_KIND) : String(target.kind || DEFAULT_OPERATION_GRAPHIC_KIND);
  if (
    partial.kind
    && Array.isArray(target.points)
    && target.points.length < getOperationGraphicMinPoints(nextKind)
  ) {
    showToast(t("Add more vertices before switching this graphic to a closed style.", "ui"), {
      title: t("More points required", "ui"),
      tone: "warning",
    });
    return false;
  }
  const before = captureHistoryState({ strategicOverlay: true });
  if (partial.kind) target.kind = nextKind;
  if (partial.label !== undefined) target.label = String(partial.label || "");
  if (partial.stylePreset !== undefined) {
    target.stylePreset = normalizeOperationGraphicStylePreset(partial.stylePreset, target.kind);
  }
  if (partial.stroke !== undefined) {
    target.stroke = normalizeOperationGraphicStroke(partial.stroke) || null;
  }
  if (partial.width !== undefined) {
    target.width = normalizeOperationGraphicWidth(partial.width);
  }
  if (partial.opacity !== undefined) {
    target.opacity = normalizeOperationGraphicOpacity(partial.opacity);
  }
  state.operationGraphicsEditor.points = Array.isArray(target.points) ? [...target.points] : [];
  selectOperationGraphicById(selectedId);
  state.operationGraphicsDirty = true;
  commitHistoryEntry({
    kind: "update-operation-graphic",
    before,
    after: captureHistoryState({ strategicOverlay: true }),
  });
  markDirty("update-operation-graphic");
  updateStrategicOverlayUi();
  if (context) render();
  return true;
}

function deleteSelectedOperationGraphicVertex() {
  ensureOperationGraphicsEditorState();
  const graphic = getOperationGraphicById(state.operationGraphicsEditor.selectedId);
  const vertexIndex = Number(state.operationGraphicsEditor.selectedVertexIndex);
  if (!graphic || !Number.isInteger(vertexIndex) || vertexIndex < 0) return false;
  const minPoints = getOperationGraphicMinPoints(graphic.kind);
  if (!Array.isArray(graphic.points) || graphic.points.length <= minPoints) return false;
  const before = captureHistoryState({ strategicOverlay: true });
  graphic.points.splice(vertexIndex, 1);
  state.operationGraphicsEditor.points = Array.isArray(graphic.points) ? [...graphic.points] : [];
  state.operationGraphicsEditor.selectedVertexIndex = Math.min(vertexIndex, graphic.points.length - 1);
  state.operationGraphicsDirty = true;
  commitHistoryEntry({
    kind: "delete-operation-graphic-vertex",
    before,
    after: captureHistoryState({ strategicOverlay: true }),
  });
  markDirty("delete-operation-graphic-vertex");
  updateStrategicOverlayUi();
  if (context) render();
  return true;
}

function ensureOperationalLineCounter() {
  ensureOperationalLineEditorState();
  const used = new Set((state.operationalLines || []).map((line) => String(line?.id || "")));
  let counter = Math.max(1, Number(state.operationalLineEditor.counter) || 1);
  while (used.has(`opl_${counter}`)) {
    counter += 1;
  }
  state.operationalLineEditor.counter = counter;
}

function appendOperationalLineVertexFromEvent(event) {
  ensureOperationalLineEditorState();
  if (!state.operationalLineEditor.active) return false;
  const coord = getMapLonLatFromEvent(event);
  if (!coord) return false;
  state.operationalLineEditor.points.push(coord);
  state.operationalLinesDirty = true;
  updateStrategicOverlayUi();
  if (context) render();
  return true;
}

function startOperationalLineDraw({
  kind = DEFAULT_OPERATIONAL_LINE_KIND,
  label = "",
  stylePreset = DEFAULT_OPERATIONAL_LINE_KIND,
  stroke = "",
  width = 0,
  opacity = 1,
} = {}) {
  ensureOperationalLineEditorState();
  state.operationGraphicsEditor.selectedId = null;
  state.operationalLineEditor.active = true;
  state.operationalLineEditor.mode = "draw";
  state.operationalLineEditor.points = [];
  state.operationalLineEditor.kind = String(kind || DEFAULT_OPERATIONAL_LINE_KIND).trim().toLowerCase();
  state.operationalLineEditor.label = String(label || "");
  state.operationalLineEditor.stylePreset = normalizeOperationalLineStylePreset(stylePreset, kind);
  state.operationalLineEditor.stroke = normalizeOperationGraphicStroke(stroke);
  state.operationalLineEditor.width = normalizeOperationGraphicWidth(width);
  state.operationalLineEditor.opacity = normalizeOperationGraphicOpacity(opacity);
  state.operationalLineEditor.selectedId = null;
  state.operationalLineEditor.selectedVertexIndex = -1;
  state.strategicOverlayUi = {
    ...(state.strategicOverlayUi || {}),
    activeMode: state.operationalLineEditor.kind,
    modalEntityType: "operational-line",
    modalSection: "line",
  };
  state.operationalLinesDirty = true;
  updateStrategicOverlayUi();
  if (context) render();
}

function undoOperationalLineVertex() {
  ensureOperationalLineEditorState();
  if (!state.operationalLineEditor.active || !state.operationalLineEditor.points.length) return;
  state.operationalLineEditor.points.pop();
  state.operationalLinesDirty = true;
  updateStrategicOverlayUi();
  if (context) render();
}

function cancelOperationalLineDraw() {
  ensureOperationalLineEditorState();
  state.operationalLineEditor.active = false;
  state.operationalLineEditor.mode = state.operationalLineEditor.selectedId ? "edit" : "idle";
  state.operationalLineEditor.points = [];
  state.operationalLineEditor.selectedVertexIndex = -1;
  state.strategicOverlayUi = {
    ...(state.strategicOverlayUi || {}),
    activeMode: "idle",
  };
  state.operationalLinesDirty = true;
  updateStrategicOverlayUi();
  if (context) render();
}

function finishOperationalLineDraw() {
  ensureOperationalLineEditorState();
  const kind = String(state.operationalLineEditor.kind || DEFAULT_OPERATIONAL_LINE_KIND);
  const points = Array.isArray(state.operationalLineEditor.points) ? state.operationalLineEditor.points : [];
  if (!state.operationalLineEditor.active || points.length < getOperationalLineMinPoints(kind)) {
    return false;
  }
  ensureOperationalLineCounter();
  const before = captureHistoryState({ strategicOverlay: true });
  const id = `opl_${state.operationalLineEditor.counter}`;
  state.operationalLines.push({
    id,
    kind,
    label: String(state.operationalLineEditor.label || "").trim(),
    points: [...points],
    stylePreset: normalizeOperationalLineStylePreset(state.operationalLineEditor.stylePreset, kind),
    stroke: normalizeOperationGraphicStroke(state.operationalLineEditor.stroke) || null,
    width: normalizeOperationGraphicWidth(state.operationalLineEditor.width),
    opacity: normalizeOperationGraphicOpacity(state.operationalLineEditor.opacity),
    attachedCounterIds: [],
  });
  state.operationalLineEditor.counter += 1;
  state.operationalLineEditor.selectedId = id;
  state.operationalLineEditor.active = false;
  state.operationalLineEditor.mode = "edit";
  state.operationalLineEditor.points = [...points];
  state.operationalLineEditor.selectedVertexIndex = -1;
  state.strategicOverlayUi = {
    ...(state.strategicOverlayUi || {}),
    activeMode: "idle",
    modalEntityId: id,
    modalEntityType: "operational-line",
    modalSection: "line",
  };
  state.operationalLinesDirty = true;
  commitHistoryEntry({
    kind: "create-operational-line",
    before,
    after: captureHistoryState({ strategicOverlay: true }),
  });
  markDirty("create-operational-line");
  updateStrategicOverlayUi();
  if (context) render();
  return true;
}

function selectOperationalLineById(id) {
  ensureOperationalLineEditorState();
  state.operationGraphicsEditor.selectedId = null;
  const selectedId = String(id || "").trim();
  const line = getOperationalLineById(selectedId);
  state.operationalLineEditor.selectedId = selectedId || null;
  if (line) {
    state.operationalLineEditor.kind = String(line.kind || DEFAULT_OPERATIONAL_LINE_KIND);
    state.operationalLineEditor.label = String(line.label || "");
    state.operationalLineEditor.stylePreset = normalizeOperationalLineStylePreset(line.stylePreset, line.kind);
    state.operationalLineEditor.stroke = normalizeOperationGraphicStroke(line.stroke);
    state.operationalLineEditor.width = normalizeOperationGraphicWidth(line.width);
    state.operationalLineEditor.opacity = normalizeOperationGraphicOpacity(line.opacity);
    state.operationalLineEditor.points = Array.isArray(line.points) ? [...line.points] : [];
    state.operationalLineEditor.mode = "edit";
  } else {
    state.operationalLineEditor.points = [];
    state.operationalLineEditor.mode = "idle";
  }
  state.strategicOverlayUi = {
    ...(state.strategicOverlayUi || {}),
    modalEntityId: selectedId,
    modalEntityType: line ? "operational-line" : "",
    modalSection: "line",
  };
  state.operationalLinesDirty = true;
  updateStrategicOverlayUi();
  if (context) render();
}

function updateSelectedOperationalLine(partial = {}) {
  ensureOperationalLineEditorState();
  const selectedId = String(state.operationalLineEditor.selectedId || "").trim();
  if (!selectedId) return false;
  const line = getOperationalLineById(selectedId);
  if (!line) return false;
  const before = captureHistoryState({ strategicOverlay: true });
  const nextKind = partial.kind ? String(partial.kind || DEFAULT_OPERATIONAL_LINE_KIND).trim().toLowerCase() : String(line.kind || DEFAULT_OPERATIONAL_LINE_KIND);
  if (partial.kind !== undefined) line.kind = nextKind;
  if (partial.label !== undefined) line.label = String(partial.label || "");
  if (partial.stylePreset !== undefined) line.stylePreset = normalizeOperationalLineStylePreset(partial.stylePreset, nextKind);
  if (partial.stroke !== undefined) line.stroke = normalizeOperationGraphicStroke(partial.stroke) || null;
  if (partial.width !== undefined) line.width = normalizeOperationGraphicWidth(partial.width);
  if (partial.opacity !== undefined) line.opacity = normalizeOperationGraphicOpacity(partial.opacity);
  if (Array.isArray(partial.attachedCounterIds)) {
    line.attachedCounterIds = partial.attachedCounterIds.map((value) => String(value || "").trim()).filter(Boolean);
  }
  selectOperationalLineById(selectedId);
  state.operationalLinesDirty = true;
  commitHistoryEntry({
    kind: "update-operational-line",
    before,
    after: captureHistoryState({ strategicOverlay: true }),
  });
  markDirty("update-operational-line");
  updateStrategicOverlayUi();
  if (context) render();
  return true;
}

function deleteSelectedOperationalLine() {
  ensureOperationalLineEditorState();
  const selectedId = String(state.operationalLineEditor.selectedId || "").trim();
  if (!selectedId) return false;
  const before = captureHistoryState({ strategicOverlay: true });
  const nextLines = (state.operationalLines || []).filter((entry) => String(entry?.id || "") !== selectedId);
  if (nextLines.length === (state.operationalLines || []).length) return false;
  state.operationalLines = nextLines;
  state.unitCounters = (state.unitCounters || []).map((counter) => {
    if (String(counter?.attachment?.lineId || "") !== selectedId) return counter;
    return {
      ...counter,
      attachment: null,
      layoutAnchor: {
        ...(counter.layoutAnchor || {}),
        kind: "feature",
        key: String(counter.anchor?.featureId || ""),
      },
    };
  });
  syncOperationalLineAttachedCounterIds();
  state.operationalLineEditor.selectedId = null;
  state.operationalLineEditor.points = [];
  state.operationalLineEditor.mode = "idle";
  state.operationalLinesDirty = true;
  state.unitCountersDirty = true;
  commitHistoryEntry({
    kind: "delete-operational-line",
    before,
    after: captureHistoryState({ strategicOverlay: true }),
  });
  markDirty("delete-operational-line");
  updateStrategicOverlayUi();
  if (context) render();
  return true;
}

function syncOperationalLineAttachedCounterIds() {
  const attachedByLineId = new Map();
  (state.unitCounters || []).forEach((counter) => {
    const lineId = String(counter?.attachment?.lineId || "").trim();
    if (!lineId) return;
    if (!attachedByLineId.has(lineId)) {
      attachedByLineId.set(lineId, []);
    }
    attachedByLineId.get(lineId).push(String(counter.id || "").trim());
  });
  state.operationalLines = (state.operationalLines || []).map((line) => ({
    ...line,
    attachedCounterIds: attachedByLineId.get(String(line.id || "").trim()) || [],
  }));
}

function ensureUnitCounterCounter() {
  ensureUnitCounterEditorState();
  const used = new Set((state.unitCounters || []).map((counter) => String(counter?.id || "")));
  let counter = Math.max(1, Number(state.unitCounterEditor.counter) || 1);
  while (used.has(`unit_${counter}`)) {
    counter += 1;
  }
  state.unitCounterEditor.counter = counter;
}

function placeUnitCounterFromEvent(event) {
  ensureUnitCounterEditorState();
  if (!state.unitCounterEditor.active) return false;
  const coord = getMapLonLatFromEvent(event);
  if (!coord) return false;
  ensureUnitCounterCounter();
  const hit = getHitFromEvent(event, {
    enableSnap: true,
    snapPx: HIT_SNAP_RADIUS_CLICK_PX,
    eventType: "unit-counter-place",
  });
  const featureId = hit?.targetType === "land" ? String(hit.id || "") : "";
  const requestedNationSource = normalizeUnitCounterNationSource(state.unitCounterEditor.nationSource, "display");
  const nationResolution = requestedNationSource === "manual"
    ? resolveUnitCounterNationForPlacement("", state.unitCounterEditor.nationTag, "manual")
    : resolveUnitCounterNationForPlacement(featureId, "", requestedNationSource);
  const preset = getUnitCounterPresetById(state.unitCounterEditor.presetId || DEFAULT_UNIT_COUNTER_PRESET_ID);
  const attachment = state.unitCounterEditor.attachment?.lineId
    ? {
      kind: String(state.unitCounterEditor.attachment.kind || STRATEGIC_COUNTER_ATTACHMENT_KIND).trim().toLowerCase() || STRATEGIC_COUNTER_ATTACHMENT_KIND,
      lineId: String(state.unitCounterEditor.attachment.lineId || "").trim(),
    }
    : null;
  const before = captureHistoryState({ strategicOverlay: true });
  const id = `unit_${state.unitCounterEditor.counter}`;
  const nextToken = String(
    state.unitCounterEditor.sidc
    || state.unitCounterEditor.symbolCode
    || preset.baseSidc
    || (String(state.unitCounterEditor.renderer || "").toLowerCase() === "milstd" ? DEFAULT_MILSTD_SIDC : "")
  ).trim().toUpperCase();
  const normalizedCombatState = getNormalizedUnitCounterCombatState(state.unitCounterEditor);
  state.unitCounters.push({
    id,
    renderer: String(state.unitCounterEditor.renderer || preset.defaultRenderer || state.annotationView?.unitRendererDefault || DEFAULT_UNIT_COUNTER_RENDERER),
    sidc: nextToken,
    symbolCode: nextToken,
    label: String(state.unitCounterEditor.label || "").trim(),
    nationTag: nationResolution.tag,
    nationSource: requestedNationSource,
    presetId: preset.id,
    iconId: String(state.unitCounterEditor.iconId || preset.iconId || "").trim().toLowerCase(),
    unitType: String(state.unitCounterEditor.unitType || preset.unitType || "").trim().toUpperCase(),
    echelon: String(state.unitCounterEditor.echelon || preset.defaultEchelon || "").trim().toLowerCase(),
    subLabel: String(state.unitCounterEditor.subLabel || "").trim(),
    strengthText: String(state.unitCounterEditor.strengthText || "").trim(),
    baseFillColor: normalizedCombatState.baseFillColor,
    organizationPct: normalizedCombatState.organizationPct,
    equipmentPct: normalizedCombatState.equipmentPct,
    statsPresetId: normalizedCombatState.statsPresetId,
    statsSource: normalizedCombatState.statsSource,
    size: normalizeUnitCounterSizeToken(state.unitCounterEditor.size || "medium"),
    facing: 0,
    zIndex: state.unitCounters.length,
    anchor: {
      lon: coord[0],
      lat: coord[1],
      featureId,
    },
    layoutAnchor: {
      kind: attachment ? "attachment" : "feature",
      key: attachment?.lineId || featureId,
      slotIndex: null,
    },
    attachment,
  });
  state.unitCounterEditor.counter += 1;
  state.unitCounterEditor.selectedId = id;
  state.unitCounterEditor.returnSelectionId = null;
  state.unitCounterEditor.active = false;
  syncOperationalLineAttachedCounterIds();
  state.unitCountersDirty = true;
  state.operationalLinesDirty = true;
  commitHistoryEntry({
    kind: "place-unit-counter",
    before,
    after: captureHistoryState({ strategicOverlay: true }),
  });
  markDirty("place-unit-counter");
  updateStrategicOverlayUi();
  if (context) render();
  return true;
}

function startUnitCounterPlacement({
  renderer = DEFAULT_UNIT_COUNTER_RENDERER,
  label = "",
  sidc = "",
  symbolCode = "",
  nationTag = "",
  nationSource = "display",
  presetId = DEFAULT_UNIT_COUNTER_PRESET_ID,
  unitType = "",
  echelon = "",
  subLabel = "",
  strengthText = "",
  iconId = "",
  attachment = null,
  baseFillColor = "",
  organizationPct = DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT,
  equipmentPct = DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT,
  statsPresetId = "regular",
  statsSource = "preset",
  size = "medium",
} = {}) {
  ensureUnitCounterEditorState();
  const returnSelectionId = String(state.unitCounterEditor.selectedId || "").trim() || null;
  resetUnitCounterEditorState({ preserveSelection: false, preserveCounter: true });
  const preset = getUnitCounterPresetById(presetId || DEFAULT_UNIT_COUNTER_PRESET_ID);
  const normalizedCombatState = getNormalizedUnitCounterCombatState({
    baseFillColor,
    organizationPct,
    equipmentPct,
    statsPresetId,
    statsSource,
  });
  state.unitCounterEditor.active = true;
  state.unitCounterEditor.renderer = String(renderer || preset.defaultRenderer || DEFAULT_UNIT_COUNTER_RENDERER);
  state.unitCounterEditor.label = String(label || "");
  state.unitCounterEditor.sidc = String(sidc || symbolCode || preset.baseSidc || "").trim().toUpperCase();
  state.unitCounterEditor.symbolCode = String(symbolCode || sidc || preset.baseSidc || "").trim().toUpperCase();
  state.unitCounterEditor.nationTag = canonicalCountryCode(nationTag || "");
  state.unitCounterEditor.nationSource = normalizeUnitCounterNationSource(nationSource, "display");
  state.unitCounterEditor.presetId = preset.id;
  state.unitCounterEditor.iconId = String(iconId || preset.iconId || "").trim().toLowerCase();
  state.unitCounterEditor.unitType = String(unitType || preset.unitType || "").trim().toUpperCase();
  state.unitCounterEditor.echelon = String(echelon || preset.defaultEchelon || "").trim().toLowerCase();
  state.unitCounterEditor.subLabel = String(subLabel || "");
  state.unitCounterEditor.strengthText = String(strengthText || "");
  state.unitCounterEditor.layoutAnchor = {
    kind: attachment?.lineId ? "attachment" : "feature",
    key: String(attachment?.lineId || ""),
    slotIndex: null,
  };
  state.unitCounterEditor.attachment = attachment?.lineId
    ? {
      kind: String(attachment.kind || STRATEGIC_COUNTER_ATTACHMENT_KIND).trim().toLowerCase() || STRATEGIC_COUNTER_ATTACHMENT_KIND,
      lineId: String(attachment.lineId || "").trim(),
    }
    : null;
  state.unitCounterEditor.baseFillColor = normalizedCombatState.baseFillColor;
  state.unitCounterEditor.organizationPct = normalizedCombatState.organizationPct;
  state.unitCounterEditor.equipmentPct = normalizedCombatState.equipmentPct;
  state.unitCounterEditor.statsPresetId = normalizedCombatState.statsPresetId;
  state.unitCounterEditor.statsSource = normalizedCombatState.statsSource;
  state.unitCounterEditor.size = normalizeUnitCounterSizeToken(size || "medium");
  state.unitCounterEditor.selectedId = null;
  state.unitCounterEditor.returnSelectionId = returnSelectionId;
  state.unitCountersDirty = true;
  updateStrategicOverlayUi();
  if (context) render();
}

function cancelUnitCounterPlacement() {
  ensureUnitCounterEditorState();
  const returnSelectionId = String(state.unitCounterEditor.returnSelectionId || "").trim();
  if (returnSelectionId && (state.unitCounters || []).some((entry) => String(entry?.id || "") === returnSelectionId)) {
    state.unitCounterEditor.returnSelectionId = null;
    selectUnitCounterById(returnSelectionId);
    return;
  }
  resetUnitCounterEditorState({ preserveSelection: false, preserveCounter: true });
  state.unitCountersDirty = true;
  updateStrategicOverlayUi();
  if (context) render();
}

function selectUnitCounterById(id) {
  ensureUnitCounterEditorState();
  const selectedId = String(id || "").trim();
  const counter = (state.unitCounters || []).find((entry) => String(entry?.id || "") === selectedId) || null;
  if (counter) {
    state.unitCounterEditor.selectedId = selectedId || null;
    state.unitCounterEditor.returnSelectionId = null;
    assignUnitCounterEditorFromCounter(counter);
  } else {
    resetUnitCounterEditorState({ preserveSelection: false, preserveCounter: true });
  }
  state.unitCountersDirty = true;
  updateStrategicOverlayUi();
  if (context) render();
}

function updateSelectedUnitCounter(partial = {}) {
  ensureUnitCounterEditorState();
  const selectedId = String(state.unitCounterEditor.selectedId || "").trim();
  if (!selectedId) return false;
  const counter = (state.unitCounters || []).find((entry) => String(entry?.id || "") === selectedId);
  if (!counter) return false;
  const before = captureHistoryState({ strategicOverlay: true });
  if (partial.renderer) counter.renderer = String(partial.renderer || DEFAULT_UNIT_COUNTER_RENDERER);
  if (partial.label !== undefined) counter.label = String(partial.label || "");
  if (partial.sidc !== undefined || partial.symbolCode !== undefined) {
    const nextToken = String(partial.sidc || partial.symbolCode || "").trim().toUpperCase();
    counter.sidc = nextToken;
    counter.symbolCode = nextToken;
  }
  if (partial.nationTag !== undefined) counter.nationTag = canonicalCountryCode(partial.nationTag || "");
  if (partial.nationSource !== undefined) {
    counter.nationSource = normalizeUnitCounterNationSource(partial.nationSource, "display");
  }
  if (partial.presetId !== undefined) counter.presetId = String(partial.presetId || DEFAULT_UNIT_COUNTER_PRESET_ID).trim().toLowerCase() || DEFAULT_UNIT_COUNTER_PRESET_ID;
  if (partial.iconId !== undefined) counter.iconId = String(partial.iconId || "").trim().toLowerCase();
  if (partial.unitType !== undefined) counter.unitType = String(partial.unitType || "").trim().toUpperCase();
  if (partial.echelon !== undefined) counter.echelon = String(partial.echelon || "").trim().toLowerCase();
  if (partial.subLabel !== undefined) counter.subLabel = String(partial.subLabel || "");
  if (partial.strengthText !== undefined) counter.strengthText = String(partial.strengthText || "");
  if (partial.baseFillColor !== undefined) counter.baseFillColor = normalizeUnitCounterBaseFillColor(partial.baseFillColor);
  if (partial.organizationPct !== undefined) counter.organizationPct = normalizeUnitCounterStatPercent(partial.organizationPct, DEFAULT_UNIT_COUNTER_ORGANIZATION_PCT);
  if (partial.equipmentPct !== undefined) counter.equipmentPct = normalizeUnitCounterStatPercent(partial.equipmentPct, DEFAULT_UNIT_COUNTER_EQUIPMENT_PCT);
  if (partial.statsPresetId !== undefined) counter.statsPresetId = normalizeUnitCounterStatsPresetId(partial.statsPresetId || "regular");
  if (partial.statsSource !== undefined) {
    counter.statsSource = ["preset", "random", "manual"].includes(String(partial.statsSource || "").trim().toLowerCase())
      ? String(partial.statsSource || "").trim().toLowerCase()
      : "preset";
  }
  if (partial.size) counter.size = normalizeUnitCounterSizeToken(partial.size || "medium");
  if (partial.attachment !== undefined) {
    counter.attachment = partial.attachment?.lineId
      ? {
        kind: String(partial.attachment.kind || STRATEGIC_COUNTER_ATTACHMENT_KIND).trim().toLowerCase() || STRATEGIC_COUNTER_ATTACHMENT_KIND,
        lineId: String(partial.attachment.lineId || "").trim(),
      }
      : null;
    counter.layoutAnchor = {
      ...(counter.layoutAnchor || {}),
      kind: counter.attachment ? "attachment" : "feature",
      key: counter.attachment?.lineId || String(counter.anchor?.featureId || ""),
      slotIndex: null,
    };
  }
  syncOperationalLineAttachedCounterIds();
  selectUnitCounterById(selectedId);
  state.unitCountersDirty = true;
  state.operationalLinesDirty = true;
  commitHistoryEntry({
    kind: "update-unit-counter",
    before,
    after: captureHistoryState({ strategicOverlay: true }),
  });
  markDirty("update-unit-counter");
  updateStrategicOverlayUi();
  if (context) render();
  return true;
}

function deleteSelectedUnitCounter() {
  ensureUnitCounterEditorState();
  const selectedId = String(state.unitCounterEditor.selectedId || "").trim();
  if (!selectedId) return false;
  const before = captureHistoryState({ strategicOverlay: true });
  const nextCounters = (state.unitCounters || []).filter((entry) => String(entry?.id || "") !== selectedId);
  if (nextCounters.length === (state.unitCounters || []).length) return false;
  state.unitCounters = nextCounters;
  resetUnitCounterEditorState({ preserveSelection: false, preserveCounter: true });
  syncOperationalLineAttachedCounterIds();
  state.unitCountersDirty = true;
  state.operationalLinesDirty = true;
  commitHistoryEntry({
    kind: "delete-unit-counter",
    before,
    after: captureHistoryState({ strategicOverlay: true }),
  });
  markDirty("delete-unit-counter");
  updateStrategicOverlayUi();
  if (context) render();
  return true;
}

function cancelActiveStrategicInteractionModes() {
  let cancelled = false;
  if (state.unitCounterEditor?.active) {
    cancelUnitCounterPlacement();
    cancelled = true;
  }
  if (state.operationalLineEditor?.active) {
    cancelOperationalLineDraw();
    cancelled = true;
  }
  if (state.operationGraphicsEditor?.active) {
    cancelOperationGraphicDraw();
    cancelled = true;
  }
  return cancelled;
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

  const reducedHoverPhase =
    state.renderPhase !== RENDER_PHASE_IDLE
    || state.isInteracting
    || state.scenarioApplyInFlight
    || state.startupReadonly
    || state.startupReadonlyUnlockInFlight;
  if (reducedHoverPhase) {
    if (state.hoveredId || state.hoveredWaterRegionId || state.hoveredSpecialRegionId) {
      state.hoveredId = null;
      state.hoveredWaterRegionId = null;
      state.hoveredSpecialRegionId = null;
      state.hoverOverlayDirty = true;
      renderHoverOverlayIfNeeded();
    }
    updateDevHoverHit(null);
    queueTooltipUpdate({ visible: false });
    return;
  }
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
  const hoveredCityEntry = getHoveredCityTooltipEntry(event, hit);
  if (hoveredCityEntry?.tooltipText) {
    queueTooltipUpdate({
      visible: true,
      text: hoveredCityEntry.tooltipText,
      x: event.clientX + 12,
      y: event.clientY + 12,
    });
    return;
  }
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

function getScenarioOwnerFeatureIds(ownerTag) {
  const normalizedOwnerTag = String(ownerTag || "").trim().toUpperCase();
  if (!normalizedOwnerTag || !(state.ownerToFeatureIds instanceof Map)) return [];
  const ids = state.ownerToFeatureIds.get(normalizedOwnerTag);
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

function blockStartupReadonlyInteraction() {
  if (!state.startupReadonly) return false;
  showDetailPromotionToast(t("Detailed interactions are still loading. Pan and zoom remain available.", "ui"), {
    title: t("Startup is still read-only", "ui"),
    tone: "info",
    duration: 2200,
  });
  return true;
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
  scheduleSidebarRefresh({
    featureIds,
    waterRegionIds,
    specialRegionIds,
    ownerCodes,
    refreshPresetTree,
  });
}

function flushInteractionRender(reason = "interaction") {
  return flushRenderBoundary(reason);
}

function requestRendererRender(reason = "renderer", { flush = false, fallback = null } = {}) {
  const requested = flush ? flushRenderBoundary(reason) : requestRender(reason);
  if (requested) {
    return true;
  }
  if (typeof fallback === "function") {
    fallback();
    return true;
  }
  return false;
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
  flushInteractionRender("dev-selection-add");
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
    flushInteractionRender("dev-selection-toggle");
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
  flushInteractionRender("dev-selection-remove-last");
  return true;
}

function clearDevSelection() {
  const hadEntries = getDevSelectionIds().length > 0;
  state.devSelectionFeatureIds = new Set();
  state.devSelectionOrder = [];
  if (hadEntries) {
    setDevSelectionDirty();
    flushInteractionRender("dev-selection-clear");
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
  markLegacyColorStateDirty();
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
  const scenarioDistrictGroup = String(state.scenarioDistrictGroupByFeatureId?.get(featureId) || "").trim();
  const scenarioOwnerTag = String(state.sovereigntyByFeatureId?.[featureId] || "").trim().toUpperCase();
  const scopeCode = scenarioDistrictGroup && scenarioOwnerTag
    ? scenarioOwnerTag
    : getFeatureCountryCodeNormalized(feature);
  if (!scopeCode) return "";
  const directGroup = getAdmin1Group(feature);
  const groupName = String(scenarioDistrictGroup || state.parentGroupByFeatureId?.get(featureId) || directGroup || "").trim();
  if (!groupName) return "";
  return `${scopeCode}::${groupName}`;
}

function resolveParentGroupTargetIds(feature, featureId) {
  if (!featureId || !state.landIndex?.has(featureId)) return [];
  if (shouldExcludePoliticalInteractionFeature(feature, featureId)) return [];
  const scenarioDistrictGroup = String(state.scenarioDistrictGroupByFeatureId?.get(featureId) || "").trim();
  const scenarioOwnerTag = String(state.sovereigntyByFeatureId?.[featureId] || "").trim().toUpperCase();
  const countryCode = getFeatureCountryCodeNormalized(feature);
  const parentGroupKey = resolveParentGroupKey(feature, featureId);
  const ids = scenarioDistrictGroup && scenarioOwnerTag
    ? getScenarioOwnerFeatureIds(scenarioOwnerTag)
    : getCountryFeatureIds(countryCode);
  if (!parentGroupKey || !ids.length) return [];
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
  markLegacyColorStateDirty();
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
  flushInteractionRender(kind);
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
  flushInteractionRender(kind);
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
      markLegacyColorStateDirty();
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
    markLegacyColorStateDirty();
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
    markLegacyColorStateDirty();
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
  markLegacyColorStateDirty();
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
  requestRendererRender("brush-stroke", { flush: true });
  noteRenderAction("brush-stroke", actionStart);
}

function handleBrushPointerDown(event) {
  if (state.startupReadonly) {
    if (event?.preventDefault) event.preventDefault();
    blockStartupReadonlyInteraction();
    return;
  }
  if (!state.brushModeEnabled || state.currentTool === "eyedropper" || state.specialZoneEditor?.active) return;
  if (isBrushNavigationModifier(event)) return;
  if ((event.buttons & 1) !== 1) return;
  if (event?.preventDefault) event.preventDefault();
  ensureBrushSession(event);
}

function handleBrushPointerMove(event) {
  if (state.startupReadonly) {
    return;
  }
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

async function handleClick(event, _interactionContext = null) {
  if (state.startupReadonly) {
    if (event?.preventDefault) event.preventDefault();
    blockStartupReadonlyInteraction();
    return;
  }
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
  if (state.operationalLineEditor?.active) {
    appendOperationalLineVertexFromEvent(event);
    return;
  }
  if (state.operationGraphicsEditor?.active) {
    appendOperationGraphicVertexFromEvent(event);
    return;
  }
  if (state.unitCounterEditor?.active) {
    placeUnitCounterFromEvent(event);
    return;
  }

  const hit = getHitFromEvent(event, {
    enableSnap: true,
    snapPx: HIT_SNAP_RADIUS_CLICK_PX,
    eventType: "click",
  });
  // City points may influence hover messaging, but paint/select stays bound to
  // the canonical land/water/special hit pipeline only.
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
      flushInteractionRender("click-erase-special");
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
      flushInteractionRender("click-fill-special");
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
      flushInteractionRender("click-erase-water");
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
      markLegacyColorStateDirty();
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
      markLegacyColorStateDirty();
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
    flushInteractionRender("click-erase");
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
    markLegacyColorStateDirty();
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
  flushInteractionRender("click-fill");
  if (isSovereigntyModeActive() || (state.interactionGranularity === "country" && countryCode)) {
    refreshSidebarAfterPaint({
      featureIds: targetIds,
      ownerCodes: countryCode ? [countryCode] : [],
    });
  }
  noteRenderAction("click-fill", actionStart);
}

async function handleDoubleClick(event, _interactionContext = null) {
  if (state.startupReadonly) {
    if (event?.preventDefault) event.preventDefault();
    blockStartupReadonlyInteraction();
    return;
  }
  const actionStart = nowMs();
  if (state.specialZoneEditor?.active) {
    if (event?.preventDefault) event.preventDefault();
    finishSpecialZoneDraw();
    return;
  }
  if (state.operationalLineEditor?.active) {
    if (event?.preventDefault) event.preventDefault();
    finishOperationalLineDraw();
    return;
  }
  if (state.operationGraphicsEditor?.active) {
    if (event?.preventDefault) event.preventDefault();
    finishOperationGraphicDraw();
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

function getViewportGeoBounds() {
  if (!projection || typeof projection.invert !== "function") {
    return [-180, -90, 180, 90];
  }
  const transform = state.zoomTransform || globalThis.d3?.zoomIdentity || { x: 0, y: 0, k: 1 };
  const samplePoints = [
    [0, 0],
    [state.width, 0],
    [0, state.height],
    [state.width, state.height],
    [state.width * 0.5, state.height * 0.5],
  ];
  const longitudes = [];
  const latitudes = [];
  samplePoints.forEach(([screenX, screenY]) => {
    try {
      const mapX = (Number(screenX || 0) - Number(transform.x || 0)) / Math.max(0.0001, Number(transform.k || 1));
      const mapY = (Number(screenY || 0) - Number(transform.y || 0)) / Math.max(0.0001, Number(transform.k || 1));
      const inverted = projection.invert([mapX, mapY]);
      if (!Array.isArray(inverted) || inverted.length < 2) return;
      const [lon, lat] = inverted.map((value) => Number(value));
      if (!Number.isFinite(lon) || !Number.isFinite(lat)) return;
      longitudes.push(Math.max(-180, Math.min(180, lon)));
      latitudes.push(Math.max(-90, Math.min(90, lat)));
    } catch (_error) {
      // Ignore failed projection inversion and continue.
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

function updateMap(transform) {
  state.zoomTransform = transform;
  state.hitCanvasDirty = true;
  if (typeof state.updateZoomUIFn === "function") {
    state.updateZoomUIFn();
  }
  if (viewportGroup) {
    viewportGroup.attr("transform", `translate(${transform.x},${transform.y}) scale(${transform.k})`);
  }
  syncUnitCounterScalesDuringZoom();
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

function fitProjection({ skipSpatialIndex = false } = {}) {
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
  cityAnchorCache = new WeakMap();
  rebuildProjectedBoundsCache();
  if (!skipSpatialIndex) {
    buildSpatialIndex();
  }
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
      captureInteractionBorderSnapshot(state.zoomTransform || globalThis.d3.zoomIdentity);
      renderHoverOverlayIfNeeded({ force: true });
      if (typeof state.dismissOnboardingHintFn === "function") {
        state.dismissOnboardingHintFn();
      }
    })
    .on("zoom", (event) => {
      state.pendingZoomTransform = event.transform;
      if (state.zoomRenderScheduled) return;
      state.zoomRenderScheduled = true;
      const flushLatestZoomTransform = () => {
        const nextTransform = state.pendingZoomTransform;
        state.pendingZoomTransform = null;
        if (nextTransform) {
          updateMap(nextTransform);
        }
        if (state.pendingZoomTransform) {
          requestAnimationFrame(flushLatestZoomTransform);
          return;
        }
        state.zoomRenderScheduled = false;
      };
      requestAnimationFrame(flushLatestZoomTransform);
    })
    .on("end", (event) => {
      setRenderPhase(RENDER_PHASE_SETTLING);
      state.pendingZoomTransform = null;
      updateMap(event.transform);
      if (typeof state.scheduleScenarioChunkRefreshFn === "function") {
        state.scheduleScenarioChunkRefreshFn({
          reason: "zoom-end",
          delayMs: 0,
        });
      }
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
  bindInteractionFunnel({
    mapClick: handleClick,
    mapDoubleClick: handleDoubleClick,
  });
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
  interactionRect.on("click", dispatchMapClick);
  interactionRect.on("dblclick", dispatchMapDoubleClick);
  window.addEventListener("mouseup", flushBrushSession);
  window.addEventListener("resize", handleResize);
}

function initMap({
  containerId = "mapContainer",
  suppressRender = false,
  interactionLevel = "full",
  deferInteractionInfrastructure = false,
} = {}) {
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
  layerResolverCache.contextRevision = 0;
  resetPhysicalLandClipPathCache();
  resetExactRefreshOptimizationState();
  state.topologyRevision = Number(state.topologyRevision || 0) + 1;
  state.hitCanvasTopologyRevision = 0;
  const renderPassCache = getRenderPassCacheState();
  renderPassCache.referenceTransform = null;
  renderPassCache.referenceTransforms = {};
  renderPassCache.lastGoodFrame.valid = false;
  renderPassCache.lastGoodFrame.referenceTransform = null;
  renderPassCache.lastGoodFrame.reason = "init-map";
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
  cancelPendingIndexUiRefresh();
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

  const shouldDeferInteractionInfrastructure =
    deferInteractionInfrastructure || interactionLevel === "readonly-startup";
  buildRuntimePoliticalMeta();
  setCanvasSize();
  if (!shouldDeferInteractionInfrastructure) {
    buildIndex();
  } else {
    state.deferHitCanvasBuild = true;
    setInteractionInfrastructureState("deferred-startup", {
      ready: false,
      inFlight: false,
    });
  }
  rebuildStaticMeshes();
  invalidateBorderCache();
  updateDynamicBorderStatusUI();
  fitProjection({ skipSpatialIndex: shouldDeferInteractionInfrastructure });
  initZoom();
  bindEvents();
  state.getViewportGeoBoundsFn = getViewportGeoBounds;
  if (!shouldDeferInteractionInfrastructure) {
    setInteractionInfrastructureState("ready", {
      ready: true,
      inFlight: false,
    });
  }

  if (!suppressRender) {
    render();
  }
}

function setMapData({
  refitProjection = true,
  resetZoom = true,
  suppressRender = false,
  interactionLevel = "full",
  deferInteractionInfrastructure = false,
} = {}) {
  const startedAt = nowMs();
  clearPendingDynamicBorderTimer();
  clearRenderPhaseTimer();
  cancelPendingIndexUiRefresh();
  cancelPendingSidebarRefresh();
  setRenderPhase(RENDER_PHASE_IDLE);
  resetRenderDiagnostics();
  clearStagedMapDataTasks();
  cancelExactAfterSettleRefresh();
  cancelDeferredWork(state.hitCanvasBuildScheduled);
  state.hitCanvasBuildScheduled = null;
  cancelDeferredWork(secondarySpatialBuildHandle);
  secondarySpatialBuildHandle = null;
  state.deferContextBasePass = false;
  state.deferHitCanvasBuild = false;
  state.deferExactAfterSettle = false;
  layerResolverCache.primaryRef = null;
  layerResolverCache.detailRef = null;
  layerResolverCache.bundleMode = null;
  layerResolverCache.contextRevision = 0;
  state.devHoverHit = null;
  state.devSelectedHit = null;
  state.devSelectionFeatureIds = new Set();
  state.devSelectionOrder = [];
  state.devClipboardFallbackText = "";
  state.devClipboardPreviewFormat = "names_with_ids";
  resetPhysicalLandClipPathCache();
  resetExactRefreshOptimizationState();
  resetVisibleInternalBorderMeshSignature();
  state.topologyRevision = Number(state.topologyRevision || 0) + 1;
  state.hitCanvasTopologyRevision = 0;
  const renderPassCache = getRenderPassCacheState();
  renderPassCache.referenceTransform = null;
  renderPassCache.referenceTransforms = {};
  renderPassCache.lastGoodFrame.valid = false;
  renderPassCache.lastGoodFrame.referenceTransform = null;
  renderPassCache.lastGoodFrame.reason = "set-map-data";
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
  const shouldDeferInteractionInfrastructure =
    deferInteractionInfrastructure || interactionLevel === "readonly-startup";
  if (!shouldDeferInteractionInfrastructure) {
    buildIndex();
    ensureSovereigntyState();
  } else {
    state.deferHitCanvasBuild = true;
    setInteractionInfrastructureState("deferred-startup", {
      ready: false,
      inFlight: false,
    });
  }
  if (!refitProjection) {
    rebuildProjectedBoundsCache();
  }
  rebuildStaticMeshes();
  invalidateBorderCache();
  updateDynamicBorderStatusUI();
  rebuildResolvedColors();
  if (refitProjection) {
    fitProjection({ skipSpatialIndex: shouldDeferInteractionInfrastructure });
  } else {
    if (!shouldDeferInteractionInfrastructure) {
      buildSpatialIndex();
    }
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
  let stagedApply = false;
  if (!suppressRender) {
    stagedApply = beginStagedMapDataWarmup(startedAt);
    render();
    recordRenderPerfMetric("setMapDataFirstPaint", nowMs() - startedAt, {
      staged: stagedApply,
      activeScenarioId: String(state.activeScenarioId || ""),
    });
  }
  recordRenderPerfMetric("setMapData", nowMs() - startedAt, {
    refitProjection: !!refitProjection,
    resetZoom: !!resetZoom,
    suppressRender: !!suppressRender,
    landCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
    renderProfile: String(state.renderProfile || "auto"),
    staged: stagedApply,
  });
  if (!shouldDeferInteractionInfrastructure) {
    setInteractionInfrastructureState("ready", {
      ready: true,
      inFlight: false,
    });
  }
}

function refreshMapDataForScenarioChunkPromotion({
  suppressRender = false,
} = {}) {
  const startedAt = nowMs();
  ensureLayerDataFromTopology();
  rebuildPoliticalLandCollections();
  buildIndex();
  ensureSovereigntyState();
  resetExactRefreshOptimizationState();
  resetVisibleInternalBorderMeshSignature();
  state.topologyRevision = Number(state.topologyRevision || 0) + 1;
  state.hitCanvasDirty = true;
  state.hitCanvasTopologyRevision = 0;
  invalidateAllRenderPasses("scenario-chunk-promotion");
  markAllOverlaysDirty();
  rebuildStaticMeshes();
  refreshScenarioOpeningOwnerBorders({
    renderNow: false,
    reason: "scenario-chunk-promotion-opening",
  });
  invalidateBorderCache();
  updateDynamicBorderStatusUI();
  rebuildResolvedColors();
  buildSpatialIndex();
  updateSpecialZonesPaths();
  renderSpecialZoneEditorOverlay();
  updateZoomTranslateExtent();
  setInteractionInfrastructureState("ready", {
    ready: true,
    inFlight: false,
  });
  if (!suppressRender) {
    render();
  }
  recordRenderPerfMetric("scenarioChunkPoliticalPromotion", nowMs() - startedAt, {
    activeScenarioId: String(state.activeScenarioId || ""),
    suppressRender: !!suppressRender,
    promotedFeatureCount: Array.isArray(state.scenarioPoliticalChunkData?.features)
      ? state.scenarioPoliticalChunkData.features.length
      : 0,
  });
}

function refreshMapDataForScenarioApply({
  suppressRender = false,
} = {}) {
  const startedAt = nowMs();
  clearPendingDynamicBorderTimer();
  clearRenderPhaseTimer();
  cancelPendingIndexUiRefresh();
  cancelPendingSidebarRefresh();
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
  layerResolverCache.contextRevision = 0;
  state.devHoverHit = null;
  state.devSelectedHit = null;
  state.devSelectionFeatureIds = new Set();
  state.devSelectionOrder = [];
  state.devClipboardFallbackText = "";
  state.devClipboardPreviewFormat = "names_with_ids";
  resetPhysicalLandClipPathCache();
  ensureLayerDataFromTopology();
  rebuildPoliticalLandCollections();
  rebuildRuntimeDerivedState({
    includeRuntimePoliticalMeta: true,
    scheduleUiMode: "deferred",
    buildSpatial: true,
    includeSecondarySpatial: false,
  });
  resetExactRefreshOptimizationState();
  resetVisibleInternalBorderMeshSignature();
  state.topologyRevision = Number(state.topologyRevision || 0) + 1;
  state.hitCanvasDirty = true;
  state.hitCanvasTopologyRevision = 0;
  const targetPasses = ["background", "physicalBase", "political", "contextBase", "contextScenario", "dayNight", "borders", "labels"];
  invalidateRenderPasses(targetPasses, "scenario-apply-refresh");
  clearRenderPassReferenceTransforms(targetPasses);
  markAllOverlaysDirty();
  rebuildStaticMeshes();
  invalidateBorderCache();
  updateDynamicBorderStatusUI();
  updateSpecialZonesPaths();
  renderSpecialZoneEditorOverlay();
  updateZoomTranslateExtent();
  scheduleSecondarySpatialIndexBuild({
    reason: "scenario-apply-secondary-spatial",
  });
  if (!suppressRender) {
    render();
  }
  recordRenderPerfMetric("scenarioApplyMapRefresh", nowMs() - startedAt, {
    activeScenarioId: String(state.activeScenarioId || ""),
    suppressRender: !!suppressRender,
    landCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
  });
}

export {
  initMap,
  setMapData,
  refreshMapDataForScenarioChunkPromotion,
  refreshMapDataForScenarioApply,
  buildInteractionInfrastructureAfterStartup,
  render,
  autoFillMap,
  startOperationalLineDraw,
  undoOperationalLineVertex,
  finishOperationalLineDraw,
  cancelOperationalLineDraw,
  selectOperationalLineById,
  deleteSelectedOperationalLine,
  updateSelectedOperationalLine,
  startOperationGraphicDraw,
  undoOperationGraphicVertex,
  finishOperationGraphicDraw,
  cancelOperationGraphicDraw,
  selectOperationGraphicById,
  deleteSelectedOperationGraphic,
  deleteSelectedOperationGraphicVertex,
  updateSelectedOperationGraphic,
  startUnitCounterPlacement,
  cancelUnitCounterPlacement,
  cancelActiveStrategicInteractionModes,
  selectUnitCounterById,
  deleteSelectedUnitCounter,
  updateSelectedUnitCounter,
  getUnitCounterPreviewData,
  resolveUnitCounterNationForPlacement,
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
  invalidateContextLayerVisualState,
  invalidateContextLayerVisualStateBatch,
  invalidateOceanBackgroundVisualState,
  invalidateOceanTextureVisualState,
  invalidateOceanWaterInteractionVisualState,
  invalidateOceanCoastalAccentVisualState,
  invalidateOceanVisualState,
  getBathymetryPresetStyleDefaults,
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
  getUrbanLayerCapability,
  computeUrbanAdaptivePaintFromHostColor,
  getEffectiveUrbanMode,
  buildCityRevealPlan,
  getCityScenarioTag,
  getCityLabelRenderStyle,
  getCityMarkerRenderStyle,
  getEffectiveCityCollection,
  doesScenarioCountryHideCityPoints,
  getZoomPercent,
  resetZoomToFit,
  setZoomPercent,
  zoomByStep,
  scheduleRenderPhaseIdle,
};
