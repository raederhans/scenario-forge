import { countryNames, defaultCountryPalette, state } from "./state.js";
import { ensureSovereigntyState, markLegacyColorStateDirty } from "./sovereignty_manager.js";
import { normalizeMapSemanticMode } from "./state.js";
import {
  invalidateContextLayerVisualStateBatch,
  invalidateOceanWaterInteractionVisualState,
  recomputeDynamicBordersNow,
  refreshColorState,
  refreshResolvedColorsForFeatures,
  refreshMapDataForScenarioChunkPromotion,
  setMapData,
} from "./map_renderer.js";
import {
  loadDeferredDetailBundle,
  loadMeasuredJsonResource,
  normalizeCityText,
  normalizeScenarioCityOverridesPayload,
  normalizeScenarioGeoLocalePatchPayload,
} from "./data_loader.js";
import {
  STARTUP_CACHE_KINDS,
  createSerializableStartupScenarioBootstrapCorePayload,
  createSerializableStartupScenarioBootstrapLocalePayload,
  createStartupScenarioBootstrapCoreCacheKey,
  createStartupScenarioBootstrapLocaleCacheKey,
  isStartupCacheEnabled,
  readStartupCacheEntry,
  writeStartupCacheEntry,
} from "./startup_cache.js";
import {
  decodeRuntimeChunkViaWorker,
  loadScenarioRuntimeBootstrapViaWorker,
  shouldUseStartupWorker,
} from "./startup_worker_client.js";
import {
  getVisibleScenarioChunkLayers,
  mergeScenarioChunkPayloads,
  normalizeScenarioChunkManifest,
  normalizeScenarioContextLodManifest,
  normalizeScenarioRenderBudgetHints,
  selectScenarioChunks,
} from "./scenario_chunk_manager.js";
import {
  buildScenarioDistrictGroupByFeatureId,
  normalizeScenarioDistrictGroupsPayload,
} from "./scenario_districts.js";
import { ensureDetailTopologyBoundary, flushRenderBoundary } from "./render_boundary.js";
import { recalculateScenarioOwnerControllerDiffCount } from "./scenario_owner_metrics.js";
import { buildScenarioReleasableIndex } from "./releasable_manager.js";
import { syncScenarioLocalizationState } from "./scenario_localization_state.js";
import {
  ensureScenarioAuditUiState,
  setScenarioAuditUiState,
  syncCountryUi,
  syncScenarioUi,
} from "./scenario_ui_sync.js";
import {
  getRuntimeGeometryFeatureId,
  getScenarioRuntimeGeometryCountryCode,
  hasExplicitScenarioAssignment,
  shouldApplyHoi4FarEastSovietBackfill,
} from "./scenario_runtime_queries.js";
import { t } from "../ui/i18n.js";
const SCENARIO_REGISTRY_URL = "data/scenarios/index.json";
const DEFAULT_OCEAN_FILL_COLOR = "#aadaff";
const SCENARIO_RENDER_PROFILES = new Set(["auto", "balanced", "full"]);
const SCENARIO_BUNDLE_LEVELS = new Set(["bootstrap", "full"]);
const SCENARIO_LOAD_TIMEOUT_MS = 12_000;
const SCENARIO_DETAIL_SOURCE_FALLBACK_ORDER = ["na_v2", "na_v1", "legacy_bak", "highres"];
const SCENARIO_FATAL_RECOVERY_CODE = "SCENARIO_FATAL_RECOVERY";
const SCENARIO_CHUNK_REFRESH_DELAY_MS_INTERACTING = 180;
const SCENARIO_CHUNK_REFRESH_DELAY_MS_IDLE = 60;
const SCENARIO_OWNER_FEATURE_COVERAGE_MIN_RATIO = 0.85;
const SCENARIO_OWNER_FEATURE_COVERAGE_MIN_FEATURES = 1000;
let scenarioRegistryPromise = null;
const SCENARIO_OPTIONAL_LAYER_CONFIGS = {
  water: {
    bundleField: "waterRegionsPayload",
    stateField: "scenarioWaterRegionsData",
    urlField: "water_regions_url",
    objectName: "scenario_water",
    visibilityField: "showWaterRegions",
  },
  special: {
    bundleField: "specialRegionsPayload",
    stateField: "scenarioSpecialRegionsData",
    urlField: "special_regions_url",
    objectName: "scenario_special_land",
    visibilityField: "showScenarioSpecialRegions",
  },
  relief: {
    bundleField: "reliefOverlaysPayload",
    stateField: "scenarioReliefOverlaysData",
    urlField: "relief_overlays_url",
    objectName: "",
    visibilityField: "showScenarioReliefOverlays",
    revisionField: "scenarioReliefOverlayRevision",
  },
  cities: {
    bundleField: "cityOverridesPayload",
    stateField: "scenarioCityOverridesData",
    urlField: "city_overrides_url",
    objectName: "",
    visibilityField: "showCityPoints",
    revisionField: "cityLayerRevision",
  },
};

function cacheBust(url) {
  if (!url) return url;
  if (!shouldBypassScenarioCache()) {
    return url;
  }
  const sep = String(url).includes("?") ? "&" : "?";
  return `${url}${sep}_t=${Date.now()}`;
}

function getSearchParams() {
  try {
    return new URLSearchParams(globalThis.location?.search || "");
  } catch (_error) {
    return null;
  }
}

function shouldBypassScenarioCache() {
  const params = getSearchParams();
  if (!params) return false;
  const raw = String(params.get("dev_nocache") || "").trim().toLowerCase();
  return ["1", "true", "yes", "on"].includes(raw);
}

function normalizeScenarioBundleLevel(value, fallback = "full") {
  const normalized = String(value || fallback).trim().toLowerCase();
  return SCENARIO_BUNDLE_LEVELS.has(normalized) ? normalized : "full";
}

function getScenarioBundleHydrationRank(bundleLevel) {
  return normalizeScenarioBundleLevel(bundleLevel) === "full" ? 2 : 1;
}

function scenarioBundleSatisfiesLevel(bundle, requestedLevel) {
  return getScenarioBundleHydrationRank(bundle?.bundleLevel) >= getScenarioBundleHydrationRank(requestedLevel);
}

function normalizeScenarioCoreTag(rawValue) {
  return String(rawValue || "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function normalizeScenarioCoreValue(rawValue) {
  if (Array.isArray(rawValue)) {
    const seen = new Set();
    const tags = [];
    rawValue.forEach((entry) => {
      const tag = normalizeScenarioCoreTag(entry);
      if (!tag || seen.has(tag)) return;
      seen.add(tag);
      tags.push(tag);
    });
    return tags;
  }
  const text = String(rawValue || "").trim();
  if (!text) return [];
  if (text.startsWith("[") && text.endsWith("]")) {
    try {
      const parsed = JSON.parse(text.replace(/'/g, "\""));
      if (Array.isArray(parsed)) {
        return normalizeScenarioCoreValue(parsed);
      }
    } catch (_error) {
      const inner = text.slice(1, -1).trim();
      if (inner) {
        return normalizeScenarioCoreValue(
          inner
            .split(",")
            .map((entry) => entry.trim().replace(/^['"]|['"]$/g, ""))
            .filter(Boolean)
        );
      }
    }
  }
  const normalized = normalizeScenarioCoreTag(text);
  return normalized ? [normalized] : [];
}

function normalizeScenarioCoreMap(rawMap) {
  const cores = {};
  Object.entries(rawMap && typeof rawMap === "object" ? rawMap : {}).forEach(([rawFeatureId, rawValue]) => {
    const featureId = normalizeCityText(rawFeatureId);
    const coreTags = normalizeScenarioCoreValue(rawValue);
    if (!featureId || !coreTags.length) return;
    cores[featureId] = coreTags;
  });
  return cores;
}

function withScenarioLoadTimeout(promise, ms, { scenarioId = "", resourceLabel = "resource" } = {}) {
  let timeoutId = null;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutId = globalThis.setTimeout(() => {
      reject(new Error(`[scenario] Timed out loading "${resourceLabel}" for "${scenarioId}" after ${ms}ms.`));
    }, ms);
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId !== null) {
      globalThis.clearTimeout(timeoutId);
    }
  });
}

function loadScenarioJsonWithTimeout(d3Client, url, { scenarioId = "", resourceLabel = "resource" } = {}) {
  return withScenarioLoadTimeout(
    loadMeasuredJsonResource(cacheBust(url), {
      d3Client,
      label: `scenario:${resourceLabel}`,
    }).then((result) => result.payload),
    SCENARIO_LOAD_TIMEOUT_MS,
    { scenarioId, resourceLabel }
  );
}

function loadScenarioJsonResourceWithTimeout(
  d3Client,
  url,
  { scenarioId = "", resourceLabel = "resource" } = {}
) {
  return withScenarioLoadTimeout(
    loadMeasuredJsonResource(cacheBust(url), {
      d3Client,
      label: `scenario:${resourceLabel}`,
    }),
    SCENARIO_LOAD_TIMEOUT_MS,
    { scenarioId, resourceLabel }
  );
}

function validateScenarioRequiredResourcePayload(
  payload,
  {
    scenarioId = "",
    resourceLabel = "resource",
    requiredField = "",
  } = {}
) {
  if (!payload || typeof payload !== "object") {
    throw new Error(`[scenario] Required resource "${resourceLabel}" for "${scenarioId}" returned an invalid payload.`);
  }
  if (requiredField && (!payload[requiredField] || typeof payload[requiredField] !== "object")) {
    throw new Error(
      `[scenario] Required resource "${resourceLabel}" for "${scenarioId}" is missing "${requiredField}".`
    );
  }
  return payload;
}

async function loadRequiredScenarioResource(
  d3Client,
  url,
  {
    scenarioId = "",
    resourceLabel = "resource",
    requiredField = "",
  } = {}
) {
  if (!url) {
    throw new Error(`[scenario] Required resource "${resourceLabel}" is missing for "${scenarioId}".`);
  }
  const payload = await loadScenarioJsonWithTimeout(d3Client, url, {
    scenarioId,
    resourceLabel,
  });
  return validateScenarioRequiredResourcePayload(payload, {
    scenarioId,
    resourceLabel,
    requiredField,
  });
}

async function loadOptionalScenarioResource(
  d3Client,
  url,
  {
    scenarioId = "",
    resourceLabel = "resource",
  } = {}
) {
  if (!url) {
    return {
      ok: false,
      value: null,
      reason: "missing_url",
      errorMessage: "",
    };
  }
  try {
    const result = await loadScenarioJsonResourceWithTimeout(d3Client, url, {
      scenarioId,
      resourceLabel,
    });
    return {
      ok: true,
      value: result.payload ?? null,
      metrics: result.metrics || null,
      reason: "loaded",
      errorMessage: "",
    };
  } catch (error) {
    const errorMessage = String(error?.message || `Failed to load optional resource "${resourceLabel}".`);
    console.warn(`[scenario] Failed to load optional resource "${resourceLabel}" for "${scenarioId}".`, error);
    return {
      ok: false,
      value: null,
      metrics: null,
      reason: errorMessage.includes("Timed out") ? "timeout" : "load_error",
      errorMessage,
    };
  }
}

async function loadMeasuredRequiredScenarioResource(
  d3Client,
  url,
  {
    scenarioId = "",
    resourceLabel = "resource",
    requiredField = "",
  } = {}
) {
  if (!url) {
    throw new Error(`[scenario] Required resource "${resourceLabel}" is missing for "${scenarioId}".`);
  }
  const result = await loadScenarioJsonResourceWithTimeout(d3Client, url, {
    scenarioId,
    resourceLabel,
  });
  return {
    payload: validateScenarioRequiredResourcePayload(result.payload, {
      scenarioId,
      resourceLabel,
      requiredField,
    }),
    metrics: result.metrics || null,
  };
}

function normalizeScenarioId(value) {
  return String(value || "").trim();
}

function normalizeScenarioLanguage(value) {
  return String(value || "").trim().toLowerCase() === "zh" ? "zh" : "en";
}

function getScenarioGeoLocalePatchDescriptor(manifest, language = state.currentLanguage) {
  const normalizedLanguage = normalizeScenarioLanguage(language);
  const localeSpecificUrl = String(
    normalizedLanguage === "zh"
      ? manifest?.geo_locale_patch_url_zh || ""
      : manifest?.geo_locale_patch_url_en || ""
  ).trim();
  if (localeSpecificUrl) {
    return {
      url: localeSpecificUrl,
      language: normalizedLanguage,
      localeSpecific: true,
    };
  }
  return {
    url: String(manifest?.geo_locale_patch_url || "").trim(),
    language: normalizedLanguage,
    localeSpecific: false,
  };
}

function buildHoi4FarEastSovietOwnerBackfill(
  scenarioId,
  {
    runtimeTopology = null,
    ownersByFeatureId = {},
    controllersByFeatureId = {},
  } = {}
) {
  if (!shouldApplyHoi4FarEastSovietBackfill(scenarioId)) {
    return {};
  }
  const geometries = runtimeTopology?.objects?.political?.geometries;
  if (!Array.isArray(geometries) || !geometries.length) {
    return {};
  }
  const next = {};
  geometries.forEach((geometry) => {
    const featureId = getRuntimeGeometryFeatureId(geometry);
    if (!featureId) return;
    if (
      hasExplicitScenarioAssignment(ownersByFeatureId, featureId) ||
      hasExplicitScenarioAssignment(controllersByFeatureId, featureId)
    ) {
      return;
    }
    if (getScenarioRuntimeGeometryCountryCode(geometry) !== "RU") {
      return;
    }
    next[featureId] = "SOV";
  });
  return next;
}

function normalizeScenarioViewMode(value) {
  return String(value || "").trim().toLowerCase() === "frontline" ? "frontline" : "ownership";
}

function normalizeScenarioOceanFillColor(value, fallback = DEFAULT_OCEAN_FILL_COLOR) {
  const candidate = String(value || "").trim();
  if (/^#(?:[0-9a-f]{6})$/i.test(candidate)) return candidate.toLowerCase();
  if (/^#(?:[0-9a-f]{3})$/i.test(candidate)) {
    return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`.toLowerCase();
  }
  return fallback;
}

function normalizeScenarioRenderProfile(value, fallback = "auto") {
  const normalizedFallback = SCENARIO_RENDER_PROFILES.has(String(fallback || "").trim().toLowerCase())
    ? String(fallback || "").trim().toLowerCase()
    : "auto";
  const candidate = String(value || "").trim().toLowerCase();
  return SCENARIO_RENDER_PROFILES.has(candidate) ? candidate : normalizedFallback;
}

function ensureScenarioPerfMetrics() {
  if (!state.scenarioPerfMetrics || typeof state.scenarioPerfMetrics !== "object") {
    state.scenarioPerfMetrics = {};
  }
  return state.scenarioPerfMetrics;
}

function recordScenarioPerfMetric(name, durationMs, details = {}) {
  const metrics = ensureScenarioPerfMetrics();
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return null;
  const nextEntry = {
    durationMs: Math.max(0, Number(durationMs) || 0),
    recordedAt: Date.now(),
    ...details,
  };
  metrics[normalizedName] = nextEntry;
  globalThis.__scenarioPerfMetrics = metrics;
  return nextEntry;
}

function normalizeScenarioPerformanceHints(manifest) {
  const raw = manifest?.performance_hints;
  if (!raw || typeof raw !== "object") {
    return {
      renderProfileDefault: "",
      dynamicBordersDefault: null,
      scenarioReliefOverlaysDefault: null,
      waterRegionsDefault: null,
      specialRegionsDefault: null,
    };
  }
  const renderProfileDefault = String(raw.render_profile_default || "").trim().toLowerCase();
  return {
    renderProfileDefault: SCENARIO_RENDER_PROFILES.has(renderProfileDefault) ? renderProfileDefault : "",
    dynamicBordersDefault:
      typeof raw.dynamic_borders_default === "boolean" ? raw.dynamic_borders_default : null,
    scenarioReliefOverlaysDefault:
      typeof raw.scenario_relief_overlays_default === "boolean" ? raw.scenario_relief_overlays_default : null,
    waterRegionsDefault:
      typeof raw.water_regions_default === "boolean" ? raw.water_regions_default : null,
    specialRegionsDefault:
      typeof raw.special_regions_default === "boolean" ? raw.special_regions_default : null,
  };
}

function captureScenarioDisplaySettingsBeforeActivate() {
  if (state.activeScenarioId || state.scenarioDisplaySettingsBeforeActivate) {
    return state.scenarioDisplaySettingsBeforeActivate;
  }
  state.scenarioDisplaySettingsBeforeActivate = {
    renderProfile: normalizeScenarioRenderProfile(state.renderProfile, "auto"),
    dynamicBordersEnabled: state.dynamicBordersEnabled !== false,
    showWaterRegions: state.showWaterRegions !== false,
    showScenarioSpecialRegions: state.showScenarioSpecialRegions !== false,
    showScenarioReliefOverlays: state.showScenarioReliefOverlays !== false,
  };
  return state.scenarioDisplaySettingsBeforeActivate;
}

function applyScenarioPerformanceHints(manifest) {
  captureScenarioDisplaySettingsBeforeActivate();
  const hints = normalizeScenarioPerformanceHints(manifest);
  state.activeScenarioPerformanceHints = hints;
  if (hints.renderProfileDefault) {
    state.renderProfile = normalizeScenarioRenderProfile(hints.renderProfileDefault, state.renderProfile || "auto");
  }
  if (typeof hints.dynamicBordersDefault === "boolean") {
    state.dynamicBordersEnabled = hints.dynamicBordersDefault;
  }
  if (typeof hints.waterRegionsDefault === "boolean") {
    state.showWaterRegions = hints.waterRegionsDefault;
  }
  if (typeof hints.specialRegionsDefault === "boolean") {
    state.showScenarioSpecialRegions = hints.specialRegionsDefault;
  }
  if (typeof hints.scenarioReliefOverlaysDefault === "boolean") {
    state.showScenarioReliefOverlays = hints.scenarioReliefOverlaysDefault;
  }
  if (typeof state.updateWaterInteractionUIFn === "function") {
    state.updateWaterInteractionUIFn();
  }
  if (typeof state.updateScenarioSpecialRegionUIFn === "function") {
    state.updateScenarioSpecialRegionUIFn();
  }
  if (typeof state.updateScenarioReliefOverlayUIFn === "function") {
    state.updateScenarioReliefOverlayUIFn();
  }
  if (typeof state.updateDynamicBorderStatusUIFn === "function") {
    state.updateDynamicBorderStatusUIFn();
  }
}

function restoreScenarioDisplaySettingsAfterExit() {
  const snapshot = state.scenarioDisplaySettingsBeforeActivate;
  if (snapshot && typeof snapshot === "object") {
    state.renderProfile = normalizeScenarioRenderProfile(snapshot.renderProfile, state.renderProfile || "auto");
    state.dynamicBordersEnabled = snapshot.dynamicBordersEnabled !== false;
    state.showWaterRegions = snapshot.showWaterRegions !== false;
    state.showScenarioSpecialRegions = snapshot.showScenarioSpecialRegions !== false;
    state.showScenarioReliefOverlays = snapshot.showScenarioReliefOverlays !== false;
  }
  state.scenarioDisplaySettingsBeforeActivate = null;
  state.activeScenarioPerformanceHints = null;
  if (typeof state.updateWaterInteractionUIFn === "function") {
    state.updateWaterInteractionUIFn();
  }
  if (typeof state.updateScenarioSpecialRegionUIFn === "function") {
    state.updateScenarioSpecialRegionUIFn();
  }
  if (typeof state.updateScenarioReliefOverlayUIFn === "function") {
    state.updateScenarioReliefOverlayUIFn();
  }
  if (typeof state.updateDynamicBorderStatusUIFn === "function") {
    state.updateDynamicBorderStatusUIFn();
  }
}

function getScenarioOceanFillOverride(manifest) {
  const rawValue = String(manifest?.style_defaults?.ocean?.fillColor || "").trim();
  return rawValue ? normalizeScenarioOceanFillColor(rawValue, "") : "";
}

function syncScenarioOceanFillForActivation(manifest) {
  const nextOverride = getScenarioOceanFillOverride(manifest);
  const previousOverride = getScenarioOceanFillOverride(state.activeScenarioManifest);
  if (!state.styleConfig.ocean || typeof state.styleConfig.ocean !== "object") {
    state.styleConfig.ocean = {};
  }
  if (state.scenarioOceanFillBeforeActivate === null) {
    state.scenarioOceanFillBeforeActivate = normalizeScenarioOceanFillColor(state.styleConfig.ocean.fillColor);
  }
  if (nextOverride) {
    state.styleConfig.ocean.fillColor = nextOverride;
  } else if (previousOverride && state.scenarioOceanFillBeforeActivate !== null) {
    state.styleConfig.ocean.fillColor = normalizeScenarioOceanFillColor(state.scenarioOceanFillBeforeActivate);
  }
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
}

function restoreScenarioOceanFillAfterExit() {
  if (state.scenarioOceanFillBeforeActivate === null) {
    return;
  }
  if (!state.styleConfig.ocean || typeof state.styleConfig.ocean !== "object") {
    state.styleConfig.ocean = {};
  }
  state.styleConfig.ocean.fillColor = normalizeScenarioOceanFillColor(state.scenarioOceanFillBeforeActivate);
  state.scenarioOceanFillBeforeActivate = null;
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
}

function getScenarioDisplayOwnerByFeatureId(featureId, { fallbackOwner = "" } = {}) {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return String(fallbackOwner || "").trim().toUpperCase();
  const fallback = String(fallbackOwner || "").trim().toUpperCase();
  const directOwner = String(state.sovereigntyByFeatureId?.[normalizedId] || "").trim().toUpperCase();
  const directController = String(state.scenarioControllersByFeatureId?.[normalizedId] || "").trim().toUpperCase();
  if (!state.activeScenarioId || normalizeScenarioViewMode(state.scenarioViewMode) !== "frontline") {
    return directOwner || fallback;
  }
  return String(
    directController
    || directOwner
    || fallback
    || ""
  ).trim().toUpperCase();
}

function getScenarioRegistryEntries() {
  return Array.isArray(state.scenarioRegistry?.scenarios) ? state.scenarioRegistry.scenarios : [];
}

function getScenarioDisplayName(source, fallbackId = "") {
  const entry = source && typeof source === "object" ? source : null;
  const rawDisplayName = String(
    entry?.display_name
    || entry?.displayName
    || fallbackId
    || (!entry ? source : "")
    || ""
  ).trim();
  if (!rawDisplayName) {
    return "";
  }
  return t(rawDisplayName, "geo") || rawDisplayName;
}

function getScenarioNameMap(countryMap = {}) {
  const next = {};
  Object.entries(countryMap || {}).forEach(([tag, entry]) => {
    const normalizedTag = String(tag || "").trim().toUpperCase();
    const displayName = String(entry?.display_name || entry?.displayName || normalizedTag).trim();
    if (normalizedTag && displayName) {
      next[normalizedTag] = displayName;
    }
  });
  return next;
}

function getScenarioFixedOwnerColors(countryMap = {}) {
  const next = {};
  Object.entries(countryMap || {}).forEach(([tag, entry]) => {
    const normalizedTag = String(tag || "").trim().toUpperCase();
    const color = String(entry?.color_hex || entry?.colorHex || "").trim().toLowerCase();
    if (normalizedTag && /^#[0-9a-f]{6}$/.test(color)) {
      next[normalizedTag] = color;
    }
  });
  return next;
}

function mergeReleasableCatalogs(baseCatalog, overlayCatalog) {
  const baseEntries = Array.isArray(baseCatalog?.entries) ? baseCatalog.entries : [];
  const overlayEntries = Array.isArray(overlayCatalog?.entries) ? overlayCatalog.entries : [];
  if (!baseEntries.length && !overlayEntries.length) {
    return overlayCatalog || baseCatalog || null;
  }
  const mergedByTag = new Map();
  baseEntries.forEach((entry) => {
    const tag = String(entry?.tag || "").trim().toUpperCase();
    if (!tag) return;
    mergedByTag.set(tag, entry);
  });
  overlayEntries.forEach((entry) => {
    const tag = String(entry?.tag || "").trim().toUpperCase();
    if (!tag) return;
    mergedByTag.set(tag, entry);
  });
  const scenarioIds = Array.from(new Set([
    ...(Array.isArray(baseCatalog?.scenario_ids) ? baseCatalog.scenario_ids : []),
    ...(Array.isArray(overlayCatalog?.scenario_ids) ? overlayCatalog.scenario_ids : []),
  ]));
  return {
    ...(baseCatalog && typeof baseCatalog === "object" ? baseCatalog : {}),
    ...(overlayCatalog && typeof overlayCatalog === "object" ? overlayCatalog : {}),
    scenario_ids: scenarioIds,
    entries: Array.from(mergedByTag.values()),
  };
}

async function loadScenarioRegistry({ d3Client = globalThis.d3 } = {}) {
  if (state.scenarioRegistry) {
    return state.scenarioRegistry;
  }
  if (scenarioRegistryPromise) {
    return scenarioRegistryPromise;
  }
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available for scenario registry loading.");
  }
  scenarioRegistryPromise = loadScenarioJsonWithTimeout(d3Client, SCENARIO_REGISTRY_URL, {
    resourceLabel: "scenario_registry",
  })
    .then((registry) => {
      state.scenarioRegistry = registry || { version: 1, default_scenario_id: "", scenarios: [] };
      return state.scenarioRegistry;
    })
    .catch((error) => {
      scenarioRegistryPromise = null;
      throw error;
    });
  return scenarioRegistryPromise;
}

function getScenarioMetaById(scenarioId) {
  const targetId = normalizeScenarioId(scenarioId);
  return getScenarioRegistryEntries().find(
    (entry) => normalizeScenarioId(entry?.scenario_id) === targetId
  ) || null;
}

function getDefaultScenarioId() {
  return normalizeScenarioId(state.scenarioRegistry?.default_scenario_id);
}

function getScenarioManifestVersion(manifest) {
  const version = Number(manifest?.version || 1);
  return Number.isFinite(version) && version > 0 ? version : 1;
}

function getScenarioManifestSummary(manifest = state.activeScenarioManifest) {
  return manifest?.summary && typeof manifest.summary === "object" ? manifest.summary : {};
}

function getScenarioBaselineHashFromBundle(bundle) {
  return String(bundle?.manifest?.baseline_hash || bundle?.ownersPayload?.baseline_hash || "").trim();
}


function refreshMapDataColorsForScenarioShell(featureIds) {
  const targetIds = Array.from(new Set(
    (Array.isArray(featureIds) ? featureIds : [])
      .map((value) => String(value || "").trim())
      .filter(Boolean)
  ));
  if (!targetIds.length) {
    return;
  }
  refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
}


function getScenarioBlockerCount(summary = {}) {
  const flattened = Number(summary.blocker_count);
  if (Number.isFinite(flattened)) {
    return flattened;
  }
  return (
    Number(summary.geometry_blocker_count || 0)
    + Number(summary.topology_blocker_count || 0)
    + Number(summary.scenario_rule_blocker_count || 0)
  );
}

function getScenarioDefaultCountryCode(manifest, countryMap = {}) {
  return String(
    manifest?.default_active_country_code
    || manifest?.default_country
    || Object.keys(countryMap || {})[0]
    || ""
  ).trim().toUpperCase();
}

function getScenarioMapSemanticMode(manifest, fallback = "political") {
  return normalizeMapSemanticMode(manifest?.map_mode, fallback);
}

function normalizeScenarioFeatureCollection(payload) {
  if (!Array.isArray(payload?.features)) {
    return null;
  }
  return {
    type: "FeatureCollection",
    features: payload.features,
  };
}

function buildScenarioPoliticalPayloadFingerprint(payload) {
  const normalizedPayload = normalizeScenarioFeatureCollection(payload);
  const features = Array.isArray(normalizedPayload?.features) ? normalizedPayload.features : [];
  if (!features.length) {
    return "";
  }
  return features.map((feature) => {
    const featureId = String(feature?.id || feature?.properties?.id || "").trim();
    return [
      featureId,
      JSON.stringify(feature?.geometry || null),
      JSON.stringify(feature?.properties || null),
    ].join("::");
  }).join("|");
}

function scenarioPoliticalPayloadContentChanged(previousPayload, nextPayload) {
  const normalizedPrevious = normalizeScenarioFeatureCollection(previousPayload);
  const normalizedNext = normalizeScenarioFeatureCollection(nextPayload);
  if (normalizedPrevious === normalizedNext) {
    return false;
  }
  return buildScenarioPoliticalPayloadFingerprint(normalizedPrevious)
    !== buildScenarioPoliticalPayloadFingerprint(normalizedNext);
}

function normalizeScenarioOptionalLayerKey(value) {
  const key = String(value || "").trim().toLowerCase();
  return Object.prototype.hasOwnProperty.call(SCENARIO_OPTIONAL_LAYER_CONFIGS, key) ? key : "";
}

function getScenarioOptionalLayerConfig(layerKey) {
  const normalizedKey = normalizeScenarioOptionalLayerKey(layerKey);
  return normalizedKey ? SCENARIO_OPTIONAL_LAYER_CONFIGS[normalizedKey] : null;
}

function normalizeScenarioRuntimeTopologyPayload(payload) {
  if (!payload || typeof payload !== "object") {
    return null;
  }
  if (!payload.objects || typeof payload.objects !== "object") {
    return null;
  }
  if (
    !payload.objects.political
    && !payload.objects.scenario_water
    && !payload.objects.scenario_special_land
    && !payload.objects.land_mask
    && !payload.objects.land
  ) {
    return null;
  }
  return payload;
}

function hasScenarioRuntimePoliticalPayload(payload) {
  return !!normalizeScenarioRuntimeTopologyPayload(payload)?.objects?.political;
}

function normalizeScenarioRuntimeShell(manifest) {
  if (!manifest || typeof manifest !== "object") {
    return null;
  }
  const startupTopologyUrl = String(
    manifest.startup_topology_url
    || manifest.runtime_bootstrap_topology_url
    || manifest.runtime_topology_url
    || ""
  ).trim();
  const detailChunkManifestUrl = String(manifest.detail_chunk_manifest_url || "").trim();
  const runtimeMetaUrl = String(manifest.runtime_meta_url || "").trim();
  const meshPackUrl = String(manifest.mesh_pack_url || "").trim();
  const contextLodManifestUrl = String(manifest.context_lod_manifest || "").trim();
  if (!startupTopologyUrl && !detailChunkManifestUrl && !runtimeMetaUrl && !meshPackUrl && !contextLodManifestUrl) {
    return null;
  }
  return {
    scenarioId: normalizeScenarioId(manifest.scenario_id),
    startupTopologyUrl,
    detailChunkManifestUrl,
    runtimeMetaUrl,
    meshPackUrl,
    contextLodManifestUrl,
    renderBudgetHints: normalizeScenarioRenderBudgetHints(manifest.render_budget_hints || {}),
  };
}

function scenarioSupportsChunkedRuntime(bundleOrManifest) {
  const manifest = bundleOrManifest?.manifest || bundleOrManifest;
  return !!normalizeScenarioRuntimeShell(manifest)?.detailChunkManifestUrl;
}

function scenarioBundleHasChunkedData(bundle) {
  return Array.isArray(bundle?.chunkRegistry?.chunks) && bundle.chunkRegistry.chunks.length > 0;
}

function scenarioBundleUsesChunkedLayer(bundle, layerKey = "") {
  if (!bundle || !scenarioSupportsChunkedRuntime(bundle)) {
    return false;
  }
  const normalizedLayerKey = normalizeScenarioOptionalLayerKey(layerKey);
  if (!normalizedLayerKey) {
    return Array.isArray(bundle.chunkRegistry?.chunks) && bundle.chunkRegistry.chunks.length > 0;
  }
  return Array.isArray(bundle.chunkRegistry?.byLayer?.[normalizedLayerKey])
    && bundle.chunkRegistry.byLayer[normalizedLayerKey].length > 0;
}

function ensureRuntimeChunkLoadState() {
  if (!state.runtimeChunkLoadState || typeof state.runtimeChunkLoadState !== "object") {
    state.runtimeChunkLoadState = {
      shellStatus: "idle",
      registryStatus: "idle",
      refreshScheduled: false,
      refreshTimerId: null,
      inFlightByChunkId: {},
      errorByChunkId: {},
      lastSelection: null,
    };
  }
  if (state.runtimeChunkLoadState.refreshTimerId && typeof state.runtimeChunkLoadState.refreshTimerId !== "number") {
    state.runtimeChunkLoadState.refreshTimerId = null;
  }
  state.runtimeChunkLoadState.inFlightByChunkId =
    state.runtimeChunkLoadState.inFlightByChunkId && typeof state.runtimeChunkLoadState.inFlightByChunkId === "object"
      ? state.runtimeChunkLoadState.inFlightByChunkId
      : {};
  state.runtimeChunkLoadState.errorByChunkId =
    state.runtimeChunkLoadState.errorByChunkId && typeof state.runtimeChunkLoadState.errorByChunkId === "object"
      ? state.runtimeChunkLoadState.errorByChunkId
      : {};
  return state.runtimeChunkLoadState;
}

function recordScenarioRenderMetric(name, durationMs, details = {}) {
  if (!state.renderPerfMetrics || typeof state.renderPerfMetrics !== "object") {
    state.renderPerfMetrics = {};
  }
  state.renderPerfMetrics[String(name || "").trim()] = {
    durationMs: Math.max(0, Number(durationMs) || 0),
    recordedAt: Date.now(),
    ...details,
  };
  globalThis.__renderPerfMetrics = state.renderPerfMetrics;
}

function ensureActiveScenarioChunkState() {
  if (!state.activeScenarioChunks || typeof state.activeScenarioChunks !== "object") {
    state.activeScenarioChunks = {
      scenarioId: "",
      loadedChunkIds: [],
      payloadByChunkId: {},
      mergedLayerPayloads: {},
      lruChunkIds: [],
    };
  }
  state.activeScenarioChunks.loadedChunkIds = Array.isArray(state.activeScenarioChunks.loadedChunkIds)
    ? state.activeScenarioChunks.loadedChunkIds
    : [];
  state.activeScenarioChunks.payloadByChunkId =
    state.activeScenarioChunks.payloadByChunkId && typeof state.activeScenarioChunks.payloadByChunkId === "object"
      ? state.activeScenarioChunks.payloadByChunkId
      : {};
  state.activeScenarioChunks.mergedLayerPayloads =
    state.activeScenarioChunks.mergedLayerPayloads && typeof state.activeScenarioChunks.mergedLayerPayloads === "object"
      ? state.activeScenarioChunks.mergedLayerPayloads
      : {};
  state.activeScenarioChunks.lruChunkIds = Array.isArray(state.activeScenarioChunks.lruChunkIds)
    ? state.activeScenarioChunks.lruChunkIds
    : [];
  return state.activeScenarioChunks;
}

function ensureScenarioChunkPayloadCache(bundle) {
  if (!bundle || typeof bundle !== "object") {
    return {};
  }
  bundle.chunkPayloadCacheById = bundle.chunkPayloadCacheById && typeof bundle.chunkPayloadCacheById === "object"
    ? bundle.chunkPayloadCacheById
    : {};
  return bundle.chunkPayloadCacheById;
}

function ensureScenarioChunkPromiseCache(bundle) {
  if (!bundle || typeof bundle !== "object") {
    return {};
  }
  bundle.chunkPayloadPromisesById = bundle.chunkPayloadPromisesById && typeof bundle.chunkPayloadPromisesById === "object"
    ? bundle.chunkPayloadPromisesById
    : {};
  return bundle.chunkPayloadPromisesById;
}

function hasScenarioMergedLayerPayload(mergedLayerPayloads, layerKey) {
  return !!(
    mergedLayerPayloads
    && typeof mergedLayerPayloads === "object"
    && Object.prototype.hasOwnProperty.call(mergedLayerPayloads, layerKey)
  );
}

function getScenarioRuntimeMergedLayerPayloads(bundle = null) {
  const bundleScenarioId = getScenarioBundleId(bundle);
  const activeScenarioId = normalizeScenarioId(state.activeScenarioId);
  const chunkScenarioId = normalizeScenarioId(state.activeScenarioChunks?.scenarioId);
  if (!bundleScenarioId || bundleScenarioId !== activeScenarioId || chunkScenarioId !== bundleScenarioId) {
    return {};
  }
  return ensureActiveScenarioChunkState().mergedLayerPayloads;
}

function touchScenarioChunkLru(chunkId) {
  const chunkState = ensureActiveScenarioChunkState();
  const normalizedChunkId = String(chunkId || "").trim();
  if (!normalizedChunkId) return;
  chunkState.lruChunkIds = chunkState.lruChunkIds.filter((entry) => entry !== normalizedChunkId);
  chunkState.lruChunkIds.push(normalizedChunkId);
}

function resetScenarioChunkRuntimeState({ scenarioId = "" } = {}) {
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  state.activeScenarioChunks = {
    scenarioId: normalizedScenarioId,
    loadedChunkIds: [],
    payloadByChunkId: {},
    mergedLayerPayloads: {},
    lruChunkIds: [],
  };
  state.runtimeChunkLoadState = {
    shellStatus: normalizedScenarioId ? "ready" : "idle",
    registryStatus: normalizedScenarioId ? "ready" : "idle",
    refreshScheduled: false,
    refreshTimerId: null,
    inFlightByChunkId: {},
    errorByChunkId: {},
    lastSelection: null,
  };
}

async function loadScenarioChunkFile(
  url,
  {
    d3Client = globalThis.d3,
    scenarioId = "",
    resourceLabel = "scenario_chunk",
    useWorker = shouldUseStartupWorker(),
  } = {}
) {
  const normalizedUrl = String(url || "").trim();
  if (!normalizedUrl) return null;
  if (useWorker) {
    try {
      const workerResult = await decodeRuntimeChunkViaWorker({
        chunkUrl: normalizedUrl,
        chunkType: "scenario-chunk",
      });
      if (workerResult.chunkPayload) {
        return {
          payload: workerResult.chunkPayload,
          metrics: workerResult.metrics?.chunkPayload || workerResult.metrics || null,
          reason: "worker",
        };
      }
    } catch (error) {
      console.warn(`[scenario] Worker chunk load failed for "${normalizedUrl}". Falling back to main thread.`, error);
    }
  }
  const result = await loadMeasuredJsonResource(cacheBust(normalizedUrl), {
    d3Client,
    label: `scenario:${resourceLabel}`,
  });
  return {
    payload: result.payload,
    metrics: result.metrics || null,
    reason: "main-thread",
    scenarioId,
  };
}

async function ensureScenarioChunkRegistryLoaded(
  bundle,
  {
    d3Client = globalThis.d3,
  } = {}
) {
  if (!bundle?.manifest) return null;
  const runtimeShell = bundle.runtimeShell || normalizeScenarioRuntimeShell(bundle.manifest);
  if (!runtimeShell?.detailChunkManifestUrl) {
    return null;
  }
  bundle.runtimeShell = runtimeShell;
  if (bundle.chunkRegistry && bundle.contextLodManifest) {
    ensureRuntimeChunkLoadState().registryStatus = "ready";
    return bundle.chunkRegistry;
  }
  const chunkState = ensureRuntimeChunkLoadState();
  chunkState.registryStatus = "loading";
  const [chunkManifestResult, contextLodResult, runtimeMetaResult, meshPackResult] = await Promise.all([
    loadScenarioChunkFile(runtimeShell.detailChunkManifestUrl, {
      d3Client,
      scenarioId: runtimeShell.scenarioId,
      resourceLabel: "detail_chunk_manifest",
    }),
    runtimeShell.contextLodManifestUrl
      ? loadScenarioChunkFile(runtimeShell.contextLodManifestUrl, {
        d3Client,
        scenarioId: runtimeShell.scenarioId,
        resourceLabel: "context_lod_manifest",
      })
      : Promise.resolve(null),
    runtimeShell.runtimeMetaUrl
      ? loadScenarioChunkFile(runtimeShell.runtimeMetaUrl, {
        d3Client,
        scenarioId: runtimeShell.scenarioId,
        resourceLabel: "runtime_meta",
      })
      : Promise.resolve(null),
    runtimeShell.meshPackUrl
      ? loadScenarioChunkFile(runtimeShell.meshPackUrl, {
        d3Client,
        scenarioId: runtimeShell.scenarioId,
        resourceLabel: "mesh_pack",
      })
      : Promise.resolve(null),
  ]);
  bundle.chunkRegistry = normalizeScenarioChunkManifest(chunkManifestResult?.payload || {});
  bundle.contextLodManifest = normalizeScenarioContextLodManifest(contextLodResult?.payload || {});
  bundle.runtimeMetaPayload = runtimeMetaResult?.payload || null;
  bundle.meshPackPayload = meshPackResult?.payload || null;
  bundle.chunkRegistryLoadMetrics = {
    detailChunkManifest: chunkManifestResult?.metrics || null,
    contextLodManifest: contextLodResult?.metrics || null,
    runtimeMeta: runtimeMetaResult?.metrics || null,
    meshPack: meshPackResult?.metrics || null,
  };
  chunkState.registryStatus = scenarioBundleHasChunkedData(bundle) ? "ready" : "empty";
  return bundle.chunkRegistry;
}

function getChunkLayerStatePayload(layerKey) {
  const config = getScenarioOptionalLayerConfig(layerKey);
  return config ? state[config.stateField] || null : null;
}

function applyMergedScenarioChunkLayerPayloads(mergedLayerPayloads, { renderNow = false } = {}) {
  let changed = false;
  Object.entries(SCENARIO_OPTIONAL_LAYER_CONFIGS).forEach(([layerKey, config]) => {
    if (!hasScenarioMergedLayerPayload(mergedLayerPayloads, layerKey)) {
      return;
    }
    const nextPayload = mergedLayerPayloads[layerKey] || null;
    const currentPayload = state[config.stateField] || null;
    if (nextPayload === currentPayload) return;
    if (config.stateField === "scenarioCityOverridesData") {
      syncScenarioLocalizationState({ cityOverridesPayload: nextPayload });
      changed = true;
      return;
    }
    state[config.stateField] = nextPayload;
    if (config.revisionField) {
      state[config.revisionField] = (Number(state[config.revisionField]) || 0) + 1;
    }
    changed = true;
  });
  if (changed && renderNow) {
    flushRenderBoundary("scenario-optional-layer-apply");
  }
  return changed;
}

function applyScenarioPoliticalChunkPayload(bundle, politicalPayload, { renderNow = false, reason = "refresh" } = {}) {
  const startedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
  const normalizedPayload = normalizeScenarioFeatureCollection(politicalPayload);
  const currentPayload = normalizeScenarioFeatureCollection(state.scenarioPoliticalChunkData);
  const currentFeatures = Array.isArray(currentPayload?.features) ? currentPayload.features : [];
  const nextFeatures = Array.isArray(normalizedPayload?.features) ? normalizedPayload.features : [];
  const currentIds = currentFeatures.map((feature) => String(feature?.id || feature?.properties?.id || "").trim()).filter(Boolean);
  const nextIds = nextFeatures.map((feature) => String(feature?.id || feature?.properties?.id || "").trim()).filter(Boolean);
  const samePayload =
    currentIds.length === nextIds.length
    && currentIds.every((featureId, index) => featureId === nextIds[index]);
  if (samePayload) {
    return false;
  }
  state.scenarioPoliticalChunkData = normalizedPayload || null;
  refreshMapDataForScenarioChunkPromotion({ suppressRender: !renderNow });
  recordScenarioRenderMetric("politicalChunkPromotionMs", (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - startedAt, {
    scenarioId: getScenarioBundleId(bundle),
    reason: String(reason || "refresh"),
    promotedPoliticalFeatureCount: nextIds.length,
  });
  return true;
}

function buildMergedScenarioChunkLayerPayloads(bundle) {
  const chunkState = ensureActiveScenarioChunkState();
  const mergedLayerPayloads = {};
  const layerKeys = new Set(Object.keys(bundle?.chunkRegistry?.byLayer || {}));
  layerKeys.forEach((layerKey) => {
    const layerChunkPayloads = chunkState.loadedChunkIds
      .map((chunkId) => chunkState.payloadByChunkId?.[chunkId] || null)
      .filter((entry) => entry && entry.layerKey === layerKey)
      .map((entry) => entry.payload)
      .filter(Boolean);
    if (!layerChunkPayloads.length) {
      mergedLayerPayloads[layerKey] = null;
      return;
    }
    mergedLayerPayloads[layerKey] = mergeScenarioChunkPayloads(layerKey, layerChunkPayloads);
  });
  chunkState.mergedLayerPayloads = mergedLayerPayloads;
  return mergedLayerPayloads;
}

async function preloadScenarioCoarseChunks(
  bundle,
  {
    d3Client = globalThis.d3,
  } = {}
) {
  if (!scenarioSupportsChunkedRuntime(bundle?.manifest)) return null;
  await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
  const visibleLayers = getVisibleScenarioChunkLayers({
    includePoliticalCore: scenarioBundleUsesChunkedLayer(bundle, "political"),
    showWaterRegions: normalizeScenarioPerformanceHints(bundle.manifest).waterRegionsDefault !== false,
    showScenarioSpecialRegions: normalizeScenarioPerformanceHints(bundle.manifest).specialRegionsDefault !== false,
    showScenarioReliefOverlays: normalizeScenarioPerformanceHints(bundle.manifest).scenarioReliefOverlaysDefault === true,
    showCityPoints: state.showCityPoints !== false,
  });
  const coarseSelection = selectScenarioChunks({
    scenarioId: getScenarioBundleId(bundle),
    chunkRegistry: bundle.chunkRegistry,
    contextLodManifest: bundle.contextLodManifest,
    zoom: 1,
    viewportBbox: [-180, -90, 180, 90],
    focusCountry: getScenarioDefaultCountryCode(bundle.manifest, bundle.countriesPayload?.countries || {}),
    renderBudgetHints: bundle.runtimeShell?.renderBudgetHints || bundle.manifest?.render_budget_hints || {},
    visibleLayers,
    loadedChunkIds: [],
  });
  await Promise.all(
    coarseSelection.requiredChunks.map((chunk) => loadScenarioChunkPayload(bundle, chunk, { d3Client }))
  );
  bundle.chunkPreloaded = true;
  const bundleScenarioId = getScenarioBundleId(bundle);
  if (bundleScenarioId && bundleScenarioId === normalizeScenarioId(state.activeScenarioId)) {
    const chunkState = ensureActiveScenarioChunkState();
    chunkState.scenarioId = bundleScenarioId;
    coarseSelection.requiredChunks.forEach((chunk) => {
      const payload = bundle.chunkPayloadCacheById?.[chunk.id];
      if (!payload) return;
      chunkState.payloadByChunkId[chunk.id] = payload;
      if (!chunkState.loadedChunkIds.includes(chunk.id)) {
        chunkState.loadedChunkIds.push(chunk.id);
      }
      touchScenarioChunkLru(chunk.id);
    });
    const mergedLayerPayloads = buildMergedScenarioChunkLayerPayloads(bundle);
    applyMergedScenarioChunkLayerPayloads(mergedLayerPayloads, { renderNow: false });
    applyScenarioPoliticalChunkPayload(bundle, mergedLayerPayloads.political || null, {
      renderNow: false,
      reason: "coarse-prewarm",
    });
    return mergedLayerPayloads;
  }
  return null;
}

async function loadScenarioChunkPayload(bundle, chunkMeta, { d3Client = globalThis.d3 } = {}) {
  const normalizedChunkId = String(chunkMeta?.id || "").trim();
  if (!bundle || !normalizedChunkId) return null;
  const payloadCache = ensureScenarioChunkPayloadCache(bundle);
  if (payloadCache[normalizedChunkId]) {
    return payloadCache[normalizedChunkId];
  }
  const promiseCache = ensureScenarioChunkPromiseCache(bundle);
  if (promiseCache[normalizedChunkId]) {
    return promiseCache[normalizedChunkId];
  }
  const loadState = ensureRuntimeChunkLoadState();
  loadState.inFlightByChunkId[normalizedChunkId] = true;
  const loadPromise = (async () => {
    try {
      const result = await loadScenarioChunkFile(chunkMeta.url, {
        d3Client,
        scenarioId: getScenarioBundleId(bundle),
        resourceLabel: `chunk:${chunkMeta.layer}:${normalizedChunkId}`,
      });
      const payload = {
        layerKey: chunkMeta.layer,
        payload: result?.payload || null,
      };
      payloadCache[normalizedChunkId] = payload;
      delete loadState.errorByChunkId[normalizedChunkId];
      return payload;
    } catch (error) {
      loadState.errorByChunkId[normalizedChunkId] = String(error?.message || error || "Unknown chunk load error.");
      throw error;
    } finally {
      delete promiseCache[normalizedChunkId];
      delete loadState.inFlightByChunkId[normalizedChunkId];
    }
  })();
  promiseCache[normalizedChunkId] = loadPromise;
  return loadPromise;
}

async function refreshActiveScenarioChunks({
  reason = "refresh",
  d3Client = globalThis.d3,
  renderNow = true,
} = {}) {
  const scenarioId = normalizeScenarioId(state.activeScenarioId);
  if (!scenarioId) return null;
  const bundle = getCachedScenarioBundle(scenarioId);
  if (!bundle || !scenarioBundleUsesChunkedLayer(bundle)) return null;
  await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
  const viewportBbox = typeof state.getViewportGeoBoundsFn === "function"
    ? state.getViewportGeoBoundsFn()
    : [-180, -90, 180, 90];
  const visibleLayers = getVisibleScenarioChunkLayers({
    includePoliticalCore: scenarioBundleUsesChunkedLayer(bundle, "political"),
    showWaterRegions: state.showWaterRegions !== false,
    showScenarioSpecialRegions: state.showScenarioSpecialRegions !== false,
    showScenarioReliefOverlays: state.showScenarioReliefOverlays !== false,
    showCityPoints: state.showCityPoints !== false,
  });
  const chunkState = ensureActiveScenarioChunkState();
  chunkState.scenarioId = scenarioId;
  const selection = selectScenarioChunks({
    scenarioId,
    chunkRegistry: bundle.chunkRegistry,
    contextLodManifest: bundle.contextLodManifest,
    zoom: Number(state.zoomTransform?.k || 1),
    viewportBbox,
    focusCountry: state.activeSovereignCode || getScenarioDefaultCountryCode(bundle.manifest, bundle.countriesPayload?.countries || {}),
    renderBudgetHints: bundle.runtimeShell?.renderBudgetHints || bundle.manifest?.render_budget_hints || {},
    visibleLayers,
    loadedChunkIds: chunkState.loadedChunkIds,
  });
  ensureRuntimeChunkLoadState().lastSelection = {
    reason: String(reason || "refresh"),
    scenarioId,
    viewportBbox,
    requiredChunkIds: selection.requiredChunks.map((chunk) => chunk.id),
    optionalChunkIds: selection.optionalChunks.map((chunk) => chunk.id),
  };
  await Promise.all(selection.requiredChunks.map((chunk) => loadScenarioChunkPayload(bundle, chunk, { d3Client })));
  selection.requiredChunks.forEach((chunk) => {
    const payload = bundle.chunkPayloadCacheById?.[chunk.id];
    if (!payload) return;
    chunkState.payloadByChunkId[chunk.id] = payload;
    if (!chunkState.loadedChunkIds.includes(chunk.id)) {
      chunkState.loadedChunkIds.push(chunk.id);
    }
    touchScenarioChunkLru(chunk.id);
  });
  if (selection.evictableChunkIds.length) {
    selection.evictableChunkIds.forEach((chunkId) => {
      delete chunkState.payloadByChunkId[chunkId];
      chunkState.loadedChunkIds = chunkState.loadedChunkIds.filter((entry) => entry !== chunkId);
      chunkState.lruChunkIds = chunkState.lruChunkIds.filter((entry) => entry !== chunkId);
    });
    recordScenarioRenderMetric("chunkEvictionCount", selection.evictableChunkIds.length, {
      scenarioId,
      reason: String(reason || "refresh"),
    });
  }
  const promotionStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
  const mergedLayerPayloads = buildMergedScenarioChunkLayerPayloads(bundle);
  applyMergedScenarioChunkLayerPayloads(mergedLayerPayloads, { renderNow });
  const politicalRequired = selection.requiredChunks.some((chunk) => chunk.layer === "political");
  applyScenarioPoliticalChunkPayload(bundle, mergedLayerPayloads.political || null, {
    renderNow,
    reason,
  });
  recordScenarioRenderMetric(
    "chunkPromotionMs",
    (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - promotionStartedAt,
    {
      scenarioId,
      reason: String(reason || "refresh"),
      loadedChunkCount: chunkState.loadedChunkIds.length,
    }
  );
  if (
    politicalRequired
    && Array.isArray(mergedLayerPayloads?.political?.features)
    && !bundle?.chunkLifecycle?.politicalCoreReadyRecorded
  ) {
    const applyStartedAt = Number(bundle?.chunkLifecycle?.applyStartedAt || 0);
    if (applyStartedAt > 0) {
      recordScenarioPerfMetric(
        "timeToPoliticalCoreReady",
        (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt,
        {
          scenarioId,
          promotedPoliticalFeatureCount: mergedLayerPayloads.political.features.length,
          requiredPoliticalChunkCount: selection.requiredChunks.filter((chunk) => chunk.layer === "political").length,
        }
      );
    }
    if (bundle?.chunkLifecycle) {
      bundle.chunkLifecycle.politicalCoreReadyRecorded = true;
    }
  }
  return selection;
}

function scheduleScenarioChunkRefresh({
  reason = "refresh",
  delayMs = null,
} = {}) {
  const scenarioId = normalizeScenarioId(state.activeScenarioId);
  if (!scenarioId) return;
  const bundle = getCachedScenarioBundle(scenarioId);
  if (!bundle || !scenarioBundleUsesChunkedLayer(bundle)) return;
  const loadState = ensureRuntimeChunkLoadState();
  if (loadState.refreshTimerId) {
    globalThis.clearTimeout(loadState.refreshTimerId);
  }
  const resolvedDelayMs = Number.isFinite(Number(delayMs))
    ? Number(delayMs)
    : (String(reason || "").includes("interacting")
      ? SCENARIO_CHUNK_REFRESH_DELAY_MS_INTERACTING
      : SCENARIO_CHUNK_REFRESH_DELAY_MS_IDLE);
  loadState.refreshScheduled = true;
  loadState.refreshTimerId = globalThis.setTimeout(() => {
    loadState.refreshTimerId = null;
    loadState.refreshScheduled = false;
    void refreshActiveScenarioChunks({
      reason,
      renderNow: true,
    }).catch((error) => {
      console.warn(`[scenario] Failed to refresh active scenario chunks for "${scenarioId}".`, error);
    });
  }, resolvedDelayMs);
}

function getScenarioTopologyFeatureCollection(topologyPayload, objectName) {
  const object = topologyPayload?.objects?.[objectName];
  if (!object || typeof globalThis.topojson?.feature !== "function") {
    return null;
  }
  try {
    return normalizeScenarioFeatureCollection(globalThis.topojson.feature(topologyPayload, object));
  } catch (error) {
    console.warn(`[scenario] Failed to decode scenario topology object "${objectName}".`, error);
    return null;
  }
}

function shouldEagerLoadScenarioOptionalLayer(layerKey, manifest, runtimeTopologyPayload, hints = normalizeScenarioPerformanceHints(manifest)) {
  const config = getScenarioOptionalLayerConfig(layerKey);
  if (!config) return false;
  const visibleByDefault = config.visibilityField === "showWaterRegions"
    ? hints.waterRegionsDefault !== false
    : config.visibilityField === "showScenarioSpecialRegions"
      ? hints.specialRegionsDefault !== false
      : config.visibilityField === "showScenarioReliefOverlays"
        ? hints.scenarioReliefOverlaysDefault === true
        : config.visibilityField === "showCityPoints"
          ? state.showCityPoints !== false
          : false;
  if (!visibleByDefault) {
    return false;
  }
  if (config.objectName && getScenarioTopologyFeatureCollection(runtimeTopologyPayload, config.objectName)) {
    return false;
  }
  return !!manifest?.[config.urlField];
}

function getScenarioBundleId(bundle) {
  return normalizeScenarioId(bundle?.manifest?.scenario_id || bundle?.meta?.scenario_id);
}

function getScenarioDecodedCollection(bundle, collectionKey) {
  const decodedCollections = bundle?.runtimeDecodedCollections;
  const collection = decodedCollections?.[collectionKey];
  return Array.isArray(collection?.features) ? collection : null;
}

async function ensureScenarioGeoLocalePatchForLanguage(
  language,
  {
    d3Client = globalThis.d3,
    forceReload = false,
    renderNow = false,
  } = {}
) {
  const scenarioId = normalizeScenarioId(state.activeScenarioId);
  if (!scenarioId) return null;
  const bundle = await loadScenarioBundle(scenarioId, { d3Client, bundleLevel: "full" });
  if (!bundle?.manifest) return null;

  const descriptor = getScenarioGeoLocalePatchDescriptor(bundle.manifest, language);
  if (!descriptor.url) {
    syncScenarioLocalizationState({ geoLocalePatchPayload: null });
    syncCountryUi({ renderNow });
    if (typeof state.updateDevWorkspaceUIFn === "function") {
      state.updateDevWorkspaceUIFn();
    }
    return null;
  }

  bundle.geoLocalePatchPayloadsByLanguage =
    bundle.geoLocalePatchPayloadsByLanguage && typeof bundle.geoLocalePatchPayloadsByLanguage === "object"
      ? bundle.geoLocalePatchPayloadsByLanguage
      : {};

  let payload = !forceReload ? bundle.geoLocalePatchPayloadsByLanguage[descriptor.language] || null : null;
  if (!payload) {
    const result = await loadOptionalScenarioResource(d3Client, descriptor.url, {
      scenarioId,
      resourceLabel: descriptor.localeSpecific
        ? `geo_locale_patch_${descriptor.language}`
        : "geo_locale_patch",
    });
    payload = normalizeScenarioGeoLocalePatchPayload(result.value);
    if (payload) {
      if (descriptor.localeSpecific) {
        bundle.geoLocalePatchPayloadsByLanguage[descriptor.language] = payload;
      } else {
        bundle.geoLocalePatchPayloadsByLanguage.en = payload;
        bundle.geoLocalePatchPayloadsByLanguage.zh = payload;
      }
    }
  }

  if (normalizeScenarioId(state.activeScenarioId) !== scenarioId) {
    return payload || null;
  }
  bundle.geoLocalePatchPayload = payload || null;
  syncScenarioLocalizationState({ geoLocalePatchPayload: payload || null });
  syncCountryUi({ renderNow });
  if (typeof state.updateDevWorkspaceUIFn === "function") {
    state.updateDevWorkspaceUIFn();
  }
  return payload || null;
}

function applyBlankScenarioPresentationDefaults({ resetLocalization = true } = {}) {
  if (resetLocalization) {
    syncScenarioLocalizationState({
      cityOverridesPayload: null,
      geoLocalePatchPayload: null,
    });
  }
  state.showCityPoints = false;
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
}

function assignOptionalLayerPayloadToActiveScenario(bundle, layerKey, payload) {
  const config = getScenarioOptionalLayerConfig(layerKey);
  if (!config) return false;
  const bundleScenarioId = getScenarioBundleId(bundle);
  if (!bundleScenarioId || bundleScenarioId !== normalizeScenarioId(state.activeScenarioId)) {
    return false;
  }
  if (config.stateField === "scenarioCityOverridesData") {
    syncScenarioLocalizationState({ cityOverridesPayload: payload });
  } else {
    state[config.stateField] = payload || null;
  }
  if (config.revisionField && config.stateField !== "scenarioCityOverridesData") {
    state[config.revisionField] = (Number(state[config.revisionField]) || 0) + 1;
  }
  syncScenarioUi();
  return true;
}

async function loadScenarioOptionalLayerPayload(
  bundle,
  layerKey,
  {
    d3Client = globalThis.d3,
    forceReload = false,
    applyToActiveScenario = false,
  } = {}
) {
  const config = getScenarioOptionalLayerConfig(layerKey);
  if (!bundle || !config) return null;
  bundle.optionalLayerPromises = bundle.optionalLayerPromises && typeof bundle.optionalLayerPromises === "object"
    ? bundle.optionalLayerPromises
    : {};
  bundle.optionalLayerSettledByKey = bundle.optionalLayerSettledByKey
    && typeof bundle.optionalLayerSettledByKey === "object"
    ? bundle.optionalLayerSettledByKey
    : {};
  if (!forceReload && bundle.optionalLayerPromises[layerKey]) {
    const payload = await bundle.optionalLayerPromises[layerKey];
    if (applyToActiveScenario) {
      assignOptionalLayerPayloadToActiveScenario(bundle, layerKey, payload);
    }
    return payload;
  }
  if (forceReload) {
    delete bundle.optionalLayerSettledByKey[layerKey];
  }
  if (!forceReload && bundle.optionalLayerSettledByKey[layerKey] === true) {
    const payload = bundle[config.bundleField] ?? null;
    if (applyToActiveScenario) {
      assignOptionalLayerPayloadToActiveScenario(bundle, layerKey, payload);
    }
    return payload;
  }
  const runtimeTopologyPayload = bundle.runtimeTopologyPayload || null;
  const startedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
  const promise = (async () => {
    if (config.objectName) {
      const payload = getScenarioTopologyFeatureCollection(runtimeTopologyPayload, config.objectName);
      if (payload) {
        bundle[config.bundleField] = payload;
        bundle.optionalLayerSettledByKey[layerKey] = true;
        return payload;
      }
    }
    const requestUrl = bundle.manifest?.[config.urlField];
    if (!requestUrl || !d3Client || typeof d3Client.json !== "function") {
      bundle[config.bundleField] = null;
      bundle.optionalLayerSettledByKey[layerKey] = true;
      return null;
    }
    try {
      const { payload: rawPayload } = await loadMeasuredJsonResource(cacheBust(requestUrl), {
        d3Client,
        label: `scenario_optional:${layerKey}`,
      });
      const payload = layerKey === "cities"
        ? normalizeScenarioCityOverridesPayload(rawPayload, {
          sourceLabel: `scenario_city_overrides:${getScenarioBundleId(bundle) || "scenario"}`,
        })
        : normalizeScenarioFeatureCollection(rawPayload);
      bundle[config.bundleField] = payload;
      bundle.optionalLayerSettledByKey[layerKey] = true;
      return payload;
    } catch (error) {
      console.warn(`[scenario] Failed to load scenario ${layerKey} layer for "${getScenarioBundleId(bundle)}".`, error);
      bundle[config.bundleField] = null;
      bundle.optionalLayerSettledByKey[layerKey] = true;
      return null;
    }
  })();
  bundle.optionalLayerPromises[layerKey] = promise;
  try {
    const payload = await promise;
    recordScenarioPerfMetric("loadScenarioOptionalLayer", (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - startedAt, {
      scenarioId: getScenarioBundleId(bundle),
      layerKey,
      loaded: !!payload,
      cacheHit: false,
    });
    if (applyToActiveScenario) {
      assignOptionalLayerPayloadToActiveScenario(bundle, layerKey, payload);
    }
    return payload;
  } finally {
    delete bundle.optionalLayerPromises[layerKey];
  }
}

function prewarmScenarioOptionalLayersOnCacheHit(
  bundle,
  {
    d3Client = globalThis.d3,
    manifest = bundle?.manifest,
    runtimeTopologyPayload = bundle?.runtimeTopologyPayload,
    hints = normalizeScenarioPerformanceHints(manifest),
  } = {}
) {
  // Keep cache-hit hydration lean. Optional layers now load on demand through
  // visibility and panel-driven paths instead of auto-prewarming here.
  void d3Client;
  void manifest;
  void runtimeTopologyPayload;
  void hints;
  void bundle;
}

async function ensureActiveScenarioOptionalLayerLoaded(
  layerKey,
  {
    d3Client = globalThis.d3,
    renderNow = true,
    forceReload = false,
  } = {}
) {
  const normalizedKey = normalizeScenarioOptionalLayerKey(layerKey);
  if (!normalizedKey || !state.activeScenarioId) return null;
  const bundle = state.scenarioBundleCacheById?.[normalizeScenarioId(state.activeScenarioId)];
  if (!bundle) return null;
  if (scenarioBundleUsesChunkedLayer(bundle, normalizedKey)) {
    scheduleScenarioChunkRefresh({
      reason: `visibility:${normalizedKey}`,
      delayMs: 0,
    });
    return state[getScenarioOptionalLayerConfig(normalizedKey)?.stateField] || null;
  }
  const payload = await loadScenarioOptionalLayerPayload(bundle, normalizedKey, {
    d3Client,
    forceReload,
    applyToActiveScenario: true,
  });
  if (renderNow) {
    flushRenderBoundary(`scenario-optional-layer:${normalizedKey}`);
  }
  return payload;
}

async function ensureActiveScenarioOptionalLayersForVisibility(
  {
    bundle = null,
    d3Client = globalThis.d3,
    renderNow = true,
  } = {}
) {
  const activeScenarioId = normalizeScenarioId(state.activeScenarioId);
  const activeBundle = bundle || state.scenarioBundleCacheById?.[activeScenarioId] || null;
  if (!activeScenarioId || !activeBundle) return [];
  const requestedChunkedLayers = Object.entries(SCENARIO_OPTIONAL_LAYER_CONFIGS)
    .filter(([, config]) => state[config.visibilityField])
    .map(([layerKey]) => layerKey)
    .filter((layerKey) => scenarioBundleUsesChunkedLayer(activeBundle, layerKey));
  if (requestedChunkedLayers.length) {
    scheduleScenarioChunkRefresh({
      reason: "visibility-sync",
      delayMs: 0,
    });
  }
  const requestedLayers = Object.entries(SCENARIO_OPTIONAL_LAYER_CONFIGS)
    .filter(([, config]) => state[config.visibilityField])
    .filter(([layerKey]) => !scenarioBundleUsesChunkedLayer(activeBundle, layerKey))
    .filter(([layerKey]) => activeBundle.optionalLayerSettledByKey?.[layerKey] !== true)
    .filter(([layerKey, config]) => !activeBundle[config.bundleField] && !state[config.stateField])
    .map(([layerKey]) => layerKey);
  if (!requestedLayers.length) return [];
  const payloads = await Promise.all(
    requestedLayers.map((layerKey) =>
      loadScenarioOptionalLayerPayload(activeBundle, layerKey, {
        d3Client,
        applyToActiveScenario: true,
      })
    )
  );
  if (renderNow) {
    flushRenderBoundary("scenario-optional-layers-visibility");
  }
  return payloads;
}

function getCachedScenarioBundle(scenarioId = state.activeScenarioId) {
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  if (!normalizedScenarioId) return null;
  return state.scenarioBundleCacheById?.[normalizedScenarioId] || null;
}

function createScenarioBootstrapBundleFromCache({
  priorBundle,
  meta,
  manifest,
  bundleLevel,
  cachedCorePayload,
  cachedLocalePayload,
  geoLocalePatchDescriptor,
  runtimeTopologyUrl,
} = {}) {
  const runtimeShell = normalizeScenarioRuntimeShell(manifest);
  const runtimeTopologyPayload = normalizeScenarioRuntimeTopologyPayload(cachedCorePayload?.runtimeTopologyPayload);
  const bundle = {
    ...(priorBundle && typeof priorBundle === "object" ? priorBundle : {}),
    meta,
    manifest,
    bundleLevel,
    runtimeShell,
    chunkRegistry: priorBundle?.chunkRegistry || null,
    contextLodManifest: priorBundle?.contextLodManifest || null,
    runtimeMetaPayload: priorBundle?.runtimeMetaPayload || null,
    meshPackPayload: priorBundle?.meshPackPayload || null,
    chunkPayloadCacheById: {
      ...(priorBundle?.chunkPayloadCacheById || {}),
    },
    chunkPayloadPromisesById: {},
    chunkPreloaded: !!priorBundle?.chunkPreloaded,
    countriesPayload: cachedCorePayload?.countriesPayload || null,
    ownersPayload: cachedCorePayload?.ownersPayload || null,
    controllersPayload: cachedCorePayload?.controllersPayload || null,
    coresPayload: cachedCorePayload?.coresPayload || null,
    waterRegionsPayload: priorBundle?.waterRegionsPayload || null,
    specialRegionsPayload: priorBundle?.specialRegionsPayload || null,
    reliefOverlaysPayload: priorBundle?.reliefOverlaysPayload || null,
    cityOverridesPayload: priorBundle?.cityOverridesPayload || null,
    geoLocalePatchPayload: normalizeScenarioGeoLocalePatchPayload(cachedLocalePayload?.geoLocalePatchPayload),
    geoLocalePatchPayloadsByLanguage: {
      ...(priorBundle?.geoLocalePatchPayloadsByLanguage || {}),
    },
    runtimeTopologyPayload,
    runtimePoliticalMeta: cachedCorePayload?.runtimePoliticalMeta || null,
    runtimeDecodedCollections: priorBundle?.runtimeDecodedCollections || null,
    releasableCatalog: priorBundle?.releasableCatalog || null,
    districtGroupsPayload: priorBundle?.districtGroupsPayload || null,
    auditPayload: priorBundle?.auditPayload || null,
    optionalLayerPromises: {
      ...(priorBundle?.optionalLayerPromises || {}),
    },
    optionalLayerSettledByKey: {
      ...(priorBundle?.optionalLayerSettledByKey || {}),
    },
    loadDiagnostics: {
      optionalResources: {
        runtime_topology: {
          ok: hasScenarioRuntimePoliticalPayload(runtimeTopologyPayload),
          reason: "persistent-cache-hit",
          errorMessage: "",
          metrics: null,
          url: runtimeTopologyUrl,
        },
        geo_locale_patch: {
          ok: !!cachedLocalePayload?.geoLocalePatchPayload,
          reason: cachedLocalePayload?.geoLocalePatchPayload ? "persistent-cache-hit" : "not-cached",
          errorMessage: "",
          language: geoLocalePatchDescriptor?.language,
          localeSpecific: !!geoLocalePatchDescriptor?.localeSpecific,
          metrics: null,
        },
      },
      requiredResources: {
        manifest: null,
        countries: null,
        owners: null,
        controllers: null,
        cores: null,
      },
      bundleLevel,
      persistentCacheHit: true,
    },
  };
  if (bundle.geoLocalePatchPayload) {
    if (geoLocalePatchDescriptor?.localeSpecific) {
      bundle.geoLocalePatchPayloadsByLanguage[geoLocalePatchDescriptor.language] = bundle.geoLocalePatchPayload;
    } else {
      bundle.geoLocalePatchPayloadsByLanguage.en = bundle.geoLocalePatchPayload;
      bundle.geoLocalePatchPayloadsByLanguage.zh = bundle.geoLocalePatchPayload;
    }
  }
  return bundle;
}

function createStartupScenarioBundleFromPayload({
  scenarioId = "",
  language = "en",
  payload = null,
  runtimeDecodedCollections = null,
  runtimePoliticalMeta = null,
  loadDiagnostics = null,
} = {}) {
  const normalizedScenarioId = normalizeScenarioId(
    scenarioId
    || payload?.scenario_id
    || payload?.manifest_subset?.scenario_id
  );
  if (!normalizedScenarioId) {
    throw new Error("Startup bundle is missing a valid scenario id.");
  }
  const manifestSubset = payload?.manifest_subset && typeof payload.manifest_subset === "object"
    ? payload.manifest_subset
    : {};
  const manifest = {
    ...manifestSubset,
    scenario_id: normalizedScenarioId,
    display_name: String(
      manifestSubset.display_name
      || payload?.display_name
      || normalizedScenarioId
    ).trim(),
    generated_at: String(
      payload?.generated_at
      || manifestSubset.generated_at
      || ""
    ).trim(),
    baseline_hash: String(
      payload?.baseline_hash
      || manifestSubset.baseline_hash
      || ""
    ).trim(),
    startup_bootstrap_strategy: String(
      manifestSubset.startup_bootstrap_strategy
      || payload?.scenario?.bootstrap_strategy
      || ""
    ).trim(),
  };
  const geoLocalePatchPayload = normalizeScenarioGeoLocalePatchPayload(payload?.scenario?.geo_locale_patch);
  const runtimeTopologyPayload = normalizeScenarioRuntimeTopologyPayload(payload?.scenario?.runtime_topology_bootstrap);
  const bootstrapStrategy = String(payload?.scenario?.bootstrap_strategy || "").trim();
  const bundle = {
    meta: {
      scenario_id: normalizedScenarioId,
      display_name: manifest.display_name,
      manifest_url: "",
    },
    manifest,
    bootstrapStrategy,
    bundleLevel: "bootstrap",
    runtimeShell: normalizeScenarioRuntimeShell(manifest),
    chunkRegistry: null,
    contextLodManifest: null,
    runtimeMetaPayload: null,
    meshPackPayload: null,
    chunkPayloadCacheById: {},
    chunkPayloadPromisesById: {},
    chunkPreloaded: false,
    countriesPayload: payload?.scenario?.countries || null,
    ownersPayload: payload?.scenario?.owners || null,
    controllersPayload: payload?.scenario?.controllers || null,
    coresPayload: payload?.scenario?.cores || null,
    waterRegionsPayload: null,
    specialRegionsPayload: null,
    reliefOverlaysPayload: null,
    cityOverridesPayload: null,
    geoLocalePatchPayload,
    geoLocalePatchPayloadsByLanguage: geoLocalePatchPayload ? { [language === "zh" ? "zh" : "en"]: geoLocalePatchPayload } : {},
    runtimeTopologyPayload,
    runtimePoliticalMeta: runtimeTopologyPayload ? (runtimePoliticalMeta || null) : null,
    runtimeDecodedCollections: runtimeTopologyPayload ? (runtimeDecodedCollections || null) : null,
    releasableCatalog: null,
    districtGroupsPayload: null,
    auditPayload: null,
    startupApplySeed: payload?.scenario?.apply_seed && typeof payload.scenario.apply_seed === "object"
      ? payload.scenario.apply_seed
      : null,
    optionalLayerPromises: {},
    optionalLayerSettledByKey: {},
    loadDiagnostics: loadDiagnostics || {
      optionalResources: {
        runtime_topology: {
          ok: !!runtimeTopologyPayload,
          reason: runtimeTopologyPayload ? "startup-bundle" : (bootstrapStrategy || "deferred"),
          errorMessage: "",
          metrics: payload?.metrics?.runtimeTopology || null,
          url: "",
        },
        geo_locale_patch: {
          ok: !!geoLocalePatchPayload,
          reason: "startup-bundle",
          errorMessage: "",
          language,
          localeSpecific: true,
          metrics: payload?.metrics?.geoLocalePatch || null,
        },
      },
      requiredResources: {
        manifest: payload?.metrics?.startupBundle || null,
        countries: null,
        owners: null,
        controllers: null,
        cores: null,
      },
      bundleLevel: "bootstrap",
      startupBundle: true,
    },
  };
  return bundle;
}

async function loadScenarioRuntimeTopologyForBundle({
  d3Client,
  scenarioId,
  requestedBundleLevel,
  runtimeTopologyUrl,
} = {}) {
  const runtimeLabel = requestedBundleLevel === "bootstrap" ? "runtime_bootstrap_topology" : "runtime_topology";
  const allowWorkerDecode = !!runtimeTopologyUrl && shouldUseStartupWorker();
  if (allowWorkerDecode) {
    try {
      const workerResult = requestedBundleLevel === "bootstrap"
        ? await loadScenarioRuntimeBootstrapViaWorker({ runtimeTopologyUrl })
        : await decodeRuntimeChunkViaWorker({ runtimeTopologyUrl });
      return {
        ok: !!workerResult.runtimePoliticalTopology,
        value: workerResult.runtimePoliticalTopology || null,
        metrics: workerResult.metrics?.runtimePoliticalTopology || workerResult.metrics || null,
        reason: workerResult.runtimePoliticalTopology
          ? (requestedBundleLevel === "bootstrap" ? "worker-bootstrap" : "worker-full")
          : "empty",
        errorMessage: "",
        runtimePoliticalMeta: workerResult.runtimePoliticalMeta || null,
        decodedCollections: workerResult.decodedCollections || null,
        workerMetrics: workerResult.metrics || null,
      };
    } catch (error) {
      console.warn(`[scenario] Startup worker failed for ${runtimeLabel} of "${scenarioId}", falling back to main thread.`, error);
    }
  }
  const fallbackResult = await loadOptionalScenarioResource(d3Client, runtimeTopologyUrl, {
    scenarioId,
    resourceLabel: runtimeLabel,
  });
  return {
    ...fallbackResult,
    runtimePoliticalMeta: null,
    decodedCollections: null,
  };
}

function hydrateActiveScenarioBundle(
  bundle,
  {
    renderNow = true,
  } = {}
) {
  const bundleScenarioId = getScenarioBundleId(bundle);
  if (!bundleScenarioId || bundleScenarioId !== normalizeScenarioId(state.activeScenarioId)) {
    return false;
  }
  const runtimeTopologyPayload =
    normalizeScenarioRuntimeTopologyPayload(bundle.runtimeTopologyPayload) || state.scenarioRuntimeTopologyData || null;
  const runtimeMergedLayerPayloads = getScenarioRuntimeMergedLayerPayloads(bundle);
  const mergedWaterPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "water")
    ? runtimeMergedLayerPayloads.water || null
    : undefined;
  const mergedSpecialPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "special")
    ? runtimeMergedLayerPayloads.special || null
    : undefined;
  const mergedPoliticalPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "political")
    ? runtimeMergedLayerPayloads.political || null
    : undefined;
  const mergedReliefPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "relief")
    ? runtimeMergedLayerPayloads.relief || null
    : undefined;
  const mergedCitiesPayload = hasScenarioMergedLayerPayload(runtimeMergedLayerPayloads, "cities")
    ? runtimeMergedLayerPayloads.cities || null
    : undefined;
  let scenarioOverlayChanged = false;
  let contextBaseChanged = false;
  if (runtimeTopologyPayload) {
    const runtimeVersionTag = buildScenarioRuntimeVersionTag(bundle, runtimeTopologyPayload);
    const nextRuntimePoliticalTopology = runtimeTopologyPayload?.objects?.political
      ? runtimeTopologyPayload
      : (state.defaultRuntimePoliticalTopology || state.runtimePoliticalTopology || null);
    const nextScenarioLandMaskData =
      getScenarioDecodedCollection(bundle, "scenarioLandMaskData")
      || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "land_mask")
      || state.scenarioLandMaskData
      || null;
    const nextScenarioContextLandMaskData =
      getScenarioDecodedCollection(bundle, "scenarioContextLandMaskData")
      || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "context_land_mask")
      || state.scenarioContextLandMaskData
      || null;
    const hasBundleWaterPayload = Object.prototype.hasOwnProperty.call(bundle || {}, "waterRegionsPayload");
    const decodedWaterPayload = getScenarioDecodedCollection(bundle, "scenarioWaterRegionsData");
    const topologyWaterPayload = getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_water");
    const bundleWaterPayload = hasBundleWaterPayload ? bundle.waterRegionsPayload : undefined;
    const nextScenarioWaterRegionsData =
      mergedWaterPayload !== undefined
        ? mergedWaterPayload
        : (bundleWaterPayload != null ? bundleWaterPayload : decodedWaterPayload)
      || topologyWaterPayload
      || state.scenarioWaterRegionsData
      || null;
    const reusingCachedWaterPayload =
      nextScenarioWaterRegionsData
      && mergedWaterPayload === undefined
      && !hasBundleWaterPayload
      && !decodedWaterPayload
      && !topologyWaterPayload
      && nextScenarioWaterRegionsData === state.scenarioWaterRegionsData;
    const nextScenarioWaterOverlayVersionTag = nextScenarioWaterRegionsData
      ? (reusingCachedWaterPayload
        ? String(state.scenarioWaterOverlayVersionTag || "").trim()
        : runtimeVersionTag)
      : "";
    const nextScenarioSpecialRegionsData =
      mergedSpecialPayload !== undefined
        ? mergedSpecialPayload
        : (
          getScenarioDecodedCollection(bundle, "scenarioSpecialRegionsData")
          || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_special_land")
          || bundle.specialRegionsPayload
          || state.scenarioSpecialRegionsData
          || null
        );
    scenarioOverlayChanged =
      state.scenarioRuntimeTopologyData !== runtimeTopologyPayload
      || state.scenarioWaterRegionsData !== nextScenarioWaterRegionsData
      || state.scenarioSpecialRegionsData !== nextScenarioSpecialRegionsData;
    contextBaseChanged =
      state.scenarioRuntimeTopologyData !== runtimeTopologyPayload
      || state.runtimePoliticalTopology !== nextRuntimePoliticalTopology
      || state.scenarioLandMaskData !== nextScenarioLandMaskData
      || state.scenarioContextLandMaskData !== nextScenarioContextLandMaskData;
    state.scenarioRuntimeTopologyData = runtimeTopologyPayload;
    state.runtimePoliticalTopology = nextRuntimePoliticalTopology;
    state.runtimePoliticalMetaSeed = bundle.runtimePoliticalMeta || null;
    state.runtimePoliticalFeatureCollectionSeed = getScenarioDecodedCollection(bundle, "politicalData") || null;
    state.scenarioLandMaskData = nextScenarioLandMaskData;
    state.scenarioContextLandMaskData = nextScenarioContextLandMaskData;
    state.scenarioWaterRegionsData = nextScenarioWaterRegionsData;
    state.scenarioRuntimeTopologyVersionTag = runtimeVersionTag;
    state.scenarioWaterOverlayVersionTag = nextScenarioWaterOverlayVersionTag;
    state.scenarioSpecialRegionsData = nextScenarioSpecialRegionsData;
  }
  state.activeScenarioMeshPack = bundle.meshPackPayload || state.activeScenarioMeshPack || null;
  const nextScenarioPoliticalPayload = normalizeScenarioFeatureCollection(
    mergedPoliticalPayload !== undefined
      ? mergedPoliticalPayload
      : (
        getScenarioDecodedCollection(bundle, "politicalData")
        || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "political")
        || state.scenarioPoliticalChunkData
      )
  ) || null;
  const previousScenarioPoliticalPayload = state.scenarioPoliticalChunkData;
  const promotedScenarioPolitical = applyScenarioPoliticalChunkPayload(
    bundle,
    nextScenarioPoliticalPayload,
    {
      renderNow: false,
      reason: "scenario-hydrate-political",
    }
  );
  if (!promotedScenarioPolitical) {
    state.scenarioPoliticalChunkData = nextScenarioPoliticalPayload;
    if (
      nextScenarioPoliticalPayload
      && scenarioPoliticalPayloadContentChanged(previousScenarioPoliticalPayload, nextScenarioPoliticalPayload)
    ) {
      refreshMapDataForScenarioChunkPromotion({ suppressRender: !renderNow });
    }
  }
  if (bundle.districtGroupsPayload) {
    state.scenarioDistrictGroupsData = bundle.districtGroupsPayload;
    state.scenarioDistrictGroupByFeatureId = buildScenarioDistrictGroupByFeatureId(bundle.districtGroupsPayload);
  }
  if (bundle.releasableCatalog) {
    state.releasableCatalog = mergeReleasableCatalogs(state.defaultReleasableCatalog, bundle.releasableCatalog);
    state.scenarioReleasableIndex = buildScenarioReleasableIndex(bundleScenarioId, { excludeTags: [] });
  }
  if (bundle.auditPayload) {
    state.scenarioAudit = bundle.auditPayload;
    setScenarioAuditUiState({
      loading: false,
      loadedForScenarioId: bundleScenarioId,
      errorMessage: "",
    });
  }
  state.scenarioReliefOverlaysData = mergedReliefPayload !== undefined
    ? mergedReliefPayload
    : (bundle.reliefOverlaysPayload || state.scenarioReliefOverlaysData || null);
  if (mergedCitiesPayload !== undefined || bundle.cityOverridesPayload) {
    syncScenarioLocalizationState({
      cityOverridesPayload: mergedCitiesPayload !== undefined
        ? mergedCitiesPayload
        : (bundle.cityOverridesPayload || null),
      geoLocalePatchPayload: bundle.geoLocalePatchPayload || state.scenarioGeoLocalePatchData || null,
    });
  }
  if (contextBaseChanged) {
    invalidateContextLayerVisualStateBatch([], "scenario-hydrate-context-base", { renderNow: false });
  }
  if (scenarioOverlayChanged) {
    invalidateOceanWaterInteractionVisualState("scenario-hydrate-water");
    refreshColorState({ renderNow: false });
  }
  syncScenarioUi();
  syncCountryUi({ renderNow });
  return true;
}

function buildScenarioRuntimeVersionTag(bundle, runtimeTopologyPayload) {
  const scenarioId = normalizeScenarioId(
    bundle?.manifest?.scenario_id
    || bundle?.meta?.scenario_id
    || state.activeScenarioId
  ) || "scenario";
  const baselineHash = String(bundle?.manifest?.baseline_hash || bundle?.ownersPayload?.baseline_hash || "").trim();
  const runtimeFeatureCount = Array.isArray(runtimeTopologyPayload?.objects?.political?.geometries)
    ? runtimeTopologyPayload.objects.political.geometries.length
    : 0;
  return `${scenarioId}:${baselineHash || "no-baseline"}:${runtimeFeatureCount}`;
}

function collectFeatureIdsFromCollection(collection) {
  const features = Array.isArray(collection?.features) ? collection.features : [];
  const ids = new Set();
  features.forEach((feature) => {
    const featureId = normalizeCityText(feature?.id || feature?.properties?.id);
    if (featureId) ids.add(featureId);
  });
  return ids;
}

function evaluateScenarioOwnerFeatureCoverage() {
  const renderedFeatureIds = collectFeatureIdsFromCollection(state.landData);
  const ownerFeatureIds = new Set(
    Object.keys(state.sovereigntyByFeatureId && typeof state.sovereigntyByFeatureId === "object"
      ? state.sovereigntyByFeatureId
      : {})
      .map((featureId) => normalizeCityText(featureId))
      .filter(Boolean)
  );
  let overlapCount = 0;
  renderedFeatureIds.forEach((featureId) => {
    if (ownerFeatureIds.has(featureId)) overlapCount += 1;
  });
  const renderedFeatureCount = renderedFeatureIds.size;
  const ownerFeatureCount = ownerFeatureIds.size;
  const overlapRatio = renderedFeatureCount > 0 ? overlapCount / renderedFeatureCount : 1;
  return {
    renderedFeatureCount,
    ownerFeatureCount,
    overlapCount,
    overlapRatio,
    healthy:
      renderedFeatureCount < SCENARIO_OWNER_FEATURE_COVERAGE_MIN_FEATURES
      || overlapRatio >= SCENARIO_OWNER_FEATURE_COVERAGE_MIN_RATIO,
  };
}

function evaluateScenarioWaterOverlayConsistency() {
  const runtimeTag = String(state.scenarioRuntimeTopologyVersionTag || "").trim();
  const overlayTag = String(state.scenarioWaterOverlayVersionTag || "").trim();
  if (!state.scenarioWaterRegionsData) {
    return {
      healthy: true,
      reason: "missing-overlay",
      runtimeTag,
      overlayTag,
    };
  }
  if (!runtimeTag || !overlayTag) {
    return {
      healthy: false,
      reason: "missing-version-tag",
      runtimeTag,
      overlayTag,
    };
  }
  if (runtimeTag !== overlayTag) {
    return {
      healthy: false,
      reason: "version-mismatch",
      runtimeTag,
      overlayTag,
    };
  }
  return {
    healthy: true,
    reason: "ok",
    runtimeTag,
    overlayTag,
  };
}

async function enforceScenarioHydrationHealthGate({
  renderNow = true,
  reason = "post-ready",
  autoRetry = true,
} = {}) {
  const scenarioId = normalizeScenarioId(state.activeScenarioId);
  if (!scenarioId) {
    return { ok: true, attemptedRetry: false, degradedWaterOverlay: false, report: null };
  }
  let report = evaluateScenarioOwnerFeatureCoverage();
  let waterConsistency = evaluateScenarioWaterOverlayConsistency();
  if (report.healthy) {
    const ok = waterConsistency.healthy;
    if (ok) {
      state.scenarioHydrationHealthGate = {
        status: "ok",
        reason: "ok",
        checkedAt: Date.now(),
        attemptedRetry: false,
        ownerFeatureOverlapRatio: report.overlapRatio,
        ownerFeatureOverlapCount: report.overlapCount,
        ownerFeatureRenderedCount: report.renderedFeatureCount,
        degradedWaterOverlay: false,
      };
    }
    if (ok) {
      return { ok: true, attemptedRetry: false, degradedWaterOverlay: false, report, waterConsistency };
    }
  }
  let attemptedRetry = false;
  if (autoRetry) {
    attemptedRetry = true;
    try {
      const refreshedBundle = await loadScenarioBundle(scenarioId, {
        d3Client: globalThis.d3,
        bundleLevel: "full",
        forceReload: true,
      });
      hydrateActiveScenarioBundle(refreshedBundle, { renderNow: false });
      report = evaluateScenarioOwnerFeatureCoverage();
      waterConsistency = evaluateScenarioWaterOverlayConsistency();
    } catch (retryError) {
      console.warn(`[scenario] Hydration health gate retry failed for "${scenarioId}".`, retryError);
    }
  }
  if (report.healthy && waterConsistency.healthy) {
    if (attemptedRetry && renderNow) {
      flushRenderBoundary("scenario-health-gate-retry-recovered");
    }
    state.scenarioHydrationHealthGate = {
      status: "ok",
      reason: attemptedRetry ? "retry-recovered" : "ok",
      checkedAt: Date.now(),
      attemptedRetry,
      ownerFeatureOverlapRatio: report.overlapRatio,
      ownerFeatureOverlapCount: report.overlapCount,
      ownerFeatureRenderedCount: report.renderedFeatureCount,
      degradedWaterOverlay: false,
    };
    return { ok: true, attemptedRetry, degradedWaterOverlay: false, report, waterConsistency };
  }
  const hadScenarioWaterOverlay = !!state.scenarioWaterRegionsData;
  state.scenarioWaterRegionsData = null;
  state.scenarioWaterOverlayVersionTag = "";
  invalidateOceanWaterInteractionVisualState("scenario-health-gate-water-fallback");
  refreshColorState({ renderNow: false });
  state.startupReadonly = true;
  state.startupReadonlyReason = "scenario-health-gate";
  state.startupReadonlyUnlockInFlight = false;
  showToast(
    t("Scenario hydration mismatch detected. Applied safe water fallback; full retry is required.", "ui"),
    {
      title: t("Scenario hydration warning", "ui"),
      tone: "warning",
      duration: 6200,
    }
  );
  console.warn(
    `[scenario] Hydration health gate triggered fallback for "${scenarioId}". reason=${reason}, overlap=${report.overlapCount}/${report.renderedFeatureCount}, ratio=${report.overlapRatio.toFixed(3)}, waterConsistency=${waterConsistency.reason}.`
  );
  state.scenarioHydrationHealthGate = {
    status: "degraded",
    reason: !report.healthy ? "owner-feature-mismatch" : `water-overlay-${waterConsistency.reason}`,
    checkedAt: Date.now(),
    attemptedRetry,
    ownerFeatureOverlapRatio: report.overlapRatio,
    ownerFeatureOverlapCount: report.overlapCount,
    ownerFeatureRenderedCount: report.renderedFeatureCount,
    degradedWaterOverlay: hadScenarioWaterOverlay,
  };
  if (renderNow) {
    flushRenderBoundary("scenario-health-gate-fallback");
  }
  return {
    ok: false,
    attemptedRetry,
    degradedWaterOverlay: hadScenarioWaterOverlay,
    report,
    waterConsistency,
  };
}

function releaseScenarioAuditPayload(scenarioId = state.activeScenarioId, { syncUi = true } = {}) {
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  const bundle = getCachedScenarioBundle(normalizedScenarioId);
  if (bundle) {
    bundle.auditPayload = null;
  }
  if (!normalizedScenarioId || normalizeScenarioId(state.activeScenarioId) === normalizedScenarioId) {
    state.scenarioAudit = null;
    setScenarioAuditUiState({
      loading: false,
      loadedForScenarioId: "",
      errorMessage: "",
    });
    if (syncUi) {
      syncScenarioUi();
    }
  }
}

function syncScenarioInspectorSelection(countryCode = "") {
  const normalized = String(countryCode || "").trim().toUpperCase();
  state.selectedInspectorCountryCode = normalized;
  state.inspectorHighlightCountryCode = normalized;
  state.inspectorExpansionInitialized = false;
  if (state.expandedInspectorContinents instanceof Set) {
    state.expandedInspectorContinents.clear();
  }
  if (state.expandedInspectorReleaseParents instanceof Set) {
    state.expandedInspectorReleaseParents.clear();
  }
}

async function loadScenarioBundle(
  scenarioId,
  {
    d3Client = globalThis.d3,
    forceReload = false,
    bundleLevel = "full",
  } = {}
) {
  const loadStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
  const targetId = normalizeScenarioId(scenarioId);
  const requestedBundleLevel = normalizeScenarioBundleLevel(bundleLevel);
  if (!targetId) {
    throw new Error("Scenario id is required.");
  }
  const cachedBundle = state.scenarioBundleCacheById?.[targetId] || null;
  if (!forceReload && cachedBundle && scenarioBundleSatisfiesLevel(cachedBundle, requestedBundleLevel)) {
    if (normalizeScenarioBundleLevel(cachedBundle.bundleLevel) === "full" && !scenarioBundleUsesChunkedLayer(cachedBundle)) {
      prewarmScenarioOptionalLayersOnCacheHit(cachedBundle, { d3Client });
    }
    recordScenarioPerfMetric(
      "loadScenarioBundle",
      (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - loadStartedAt,
      {
        scenarioId: targetId,
        cacheHit: true,
        bundleLevel: requestedBundleLevel,
        hydratedLevel: normalizeScenarioBundleLevel(cachedBundle.bundleLevel),
      }
    );
    return cachedBundle;
  }
  await loadScenarioRegistry({ d3Client });
  const meta = getScenarioMetaById(targetId);
  if (!meta?.manifest_url) {
    throw new Error(`Unknown scenario id: ${targetId}`);
  }
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available for scenario loading.");
  }
  const manifestResult = await loadScenarioJsonResourceWithTimeout(d3Client, meta.manifest_url, {
    scenarioId: targetId,
    resourceLabel: "manifest",
  });
  const manifest = manifestResult.payload;
  const priorBundle = !forceReload && cachedBundle ? cachedBundle : null;
  const geoLocalePatchDescriptor = getScenarioGeoLocalePatchDescriptor(manifest);
  const hints = normalizeScenarioPerformanceHints(manifest);
  const runtimeShell = normalizeScenarioRuntimeShell(manifest);
  const runtimeTopologyUrl = String(
    requestedBundleLevel === "bootstrap"
      ? runtimeShell?.startupTopologyUrl || manifest.runtime_bootstrap_topology_url || manifest.runtime_topology_url || ""
      : manifest.runtime_topology_url || runtimeShell?.startupTopologyUrl || manifest.runtime_bootstrap_topology_url || ""
  ).trim();
  const scenarioBootstrapCoreCacheKey =
    requestedBundleLevel === "bootstrap" && isStartupCacheEnabled()
      ? createStartupScenarioBootstrapCoreCacheKey({
        scenarioRegistry: state.scenarioRegistry,
        scenarioId: targetId,
        bundleLevel: requestedBundleLevel,
        manifest,
        runtimeBootstrapTopologyUrl: runtimeTopologyUrl,
      })
      : "";
  const scenarioBootstrapLocaleCacheKey =
    requestedBundleLevel === "bootstrap" && isStartupCacheEnabled() && geoLocalePatchDescriptor.url
      ? createStartupScenarioBootstrapLocaleCacheKey({
        scenarioRegistry: state.scenarioRegistry,
        scenarioId: targetId,
        bundleLevel: requestedBundleLevel,
        manifest,
        currentLanguage: state.currentLanguage,
        geoLocalePatchUrl: geoLocalePatchDescriptor.url,
      })
      : "";
  if (requestedBundleLevel === "bootstrap" && state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
    state.startupBootCacheState.scenarioBootstrap = scenarioBootstrapCoreCacheKey ? "probe" : "disabled";
  }
  if (scenarioBootstrapCoreCacheKey) {
    try {
      const [coreEntry, localeEntry] = await Promise.all([
        readStartupCacheEntry(scenarioBootstrapCoreCacheKey),
        scenarioBootstrapLocaleCacheKey
          ? readStartupCacheEntry(scenarioBootstrapLocaleCacheKey).catch((error) => {
            console.warn(`[scenario] Startup bootstrap locale cache read failed for "${targetId}".`, error);
            return null;
          })
          : Promise.resolve(null),
      ]);
      if (
        coreEntry?.payload?.countriesPayload
        && coreEntry?.payload?.ownersPayload
        && coreEntry?.payload?.coresPayload
        && hasScenarioRuntimePoliticalPayload(coreEntry?.payload?.runtimeTopologyPayload)
      ) {
        if (state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
          state.startupBootCacheState.scenarioBootstrap = "hit";
        }
        const bundle = createScenarioBootstrapBundleFromCache({
          priorBundle,
          meta,
          manifest,
          bundleLevel: requestedBundleLevel,
          cachedCorePayload: coreEntry.payload,
          cachedLocalePayload: localeEntry?.payload || null,
          geoLocalePatchDescriptor,
          runtimeTopologyUrl,
        });
        if (!bundle.geoLocalePatchPayload && geoLocalePatchDescriptor.url) {
          const geoLocalePatchResult = await loadOptionalScenarioResource(d3Client, geoLocalePatchDescriptor.url, {
            scenarioId: targetId,
            resourceLabel: geoLocalePatchDescriptor.localeSpecific
              ? `geo_locale_patch_${geoLocalePatchDescriptor.language}`
              : "geo_locale_patch",
          });
          bundle.geoLocalePatchPayload = normalizeScenarioGeoLocalePatchPayload(geoLocalePatchResult.value);
          bundle.loadDiagnostics.optionalResources.geo_locale_patch = {
            ok: !!geoLocalePatchResult.ok,
            reason: geoLocalePatchResult.reason,
            errorMessage: geoLocalePatchResult.errorMessage,
            language: geoLocalePatchDescriptor.language,
            localeSpecific: geoLocalePatchDescriptor.localeSpecific,
            metrics: geoLocalePatchResult.metrics || null,
          };
          if (bundle.geoLocalePatchPayload) {
            if (geoLocalePatchDescriptor.localeSpecific) {
              bundle.geoLocalePatchPayloadsByLanguage[geoLocalePatchDescriptor.language] = bundle.geoLocalePatchPayload;
            } else {
              bundle.geoLocalePatchPayloadsByLanguage.en = bundle.geoLocalePatchPayload;
              bundle.geoLocalePatchPayloadsByLanguage.zh = bundle.geoLocalePatchPayload;
            }
            if (scenarioBootstrapLocaleCacheKey) {
              void writeStartupCacheEntry({
                kind: STARTUP_CACHE_KINDS.SCENARIO_BOOTSTRAP_LOCALE,
                cacheKey: scenarioBootstrapLocaleCacheKey,
                payload: createSerializableStartupScenarioBootstrapLocalePayload({
                  manifest,
                  bundleLevel: requestedBundleLevel,
                  language: state.currentLanguage,
                  geoLocalePatchPayload: bundle.geoLocalePatchPayload,
                }),
                keyParts: {
                  scenarioId: targetId,
                  bundleLevel: requestedBundleLevel,
                  role: "locale",
                  language: state.currentLanguage,
                },
              }).catch((error) => {
                console.warn(`[scenario] Startup bootstrap locale cache write failed for "${targetId}".`, error);
              });
            }
          }
        }
        bundle.runtimeShell = runtimeShell;
        if (requestedBundleLevel === "full" && scenarioSupportsChunkedRuntime(bundle)) {
          await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
        }
        state.scenarioBundleCacheById[targetId] = bundle;
        recordScenarioPerfMetric(
          "loadScenarioBundle",
          (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - loadStartedAt,
          {
            scenarioId: targetId,
            cacheHit: true,
            persistentCacheHit: true,
            bundleLevel: requestedBundleLevel,
            hydratedLevel: normalizeScenarioBundleLevel(bundle.bundleLevel),
          }
        );
        return bundle;
      }
      if (state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
        state.startupBootCacheState.scenarioBootstrap = "miss";
      }
    } catch (error) {
      console.warn(`[scenario] Startup bootstrap cache read failed for "${targetId}".`, error);
      if (state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
        state.startupBootCacheState.scenarioBootstrap = "error";
      }
    }
  }
  const [
    countriesResult,
    ownersResult,
    controllersResult,
    coresResult,
    runtimeTopologyResult,
    geoLocalePatchResult,
    releasableCatalogResult,
    districtGroupsResult,
    auditResult,
  ] = await Promise.all([
    loadMeasuredRequiredScenarioResource(d3Client, manifest.countries_url, {
      scenarioId: targetId,
      resourceLabel: "countries",
      requiredField: "countries",
    }),
    loadMeasuredRequiredScenarioResource(d3Client, manifest.owners_url, {
      scenarioId: targetId,
      resourceLabel: "owners",
      requiredField: "owners",
    }),
    manifest.controllers_url
      ? loadMeasuredRequiredScenarioResource(d3Client, manifest.controllers_url, {
        scenarioId: targetId,
        resourceLabel: "controllers",
        requiredField: "controllers",
      })
      : Promise.resolve({ payload: null, metrics: null }),
    loadMeasuredRequiredScenarioResource(d3Client, manifest.cores_url, {
      scenarioId: targetId,
      resourceLabel: "cores",
      requiredField: "cores",
    }),
    loadScenarioRuntimeTopologyForBundle({
      d3Client,
      scenarioId: targetId,
      requestedBundleLevel,
      runtimeTopologyUrl,
    }),
    loadOptionalScenarioResource(d3Client, geoLocalePatchDescriptor.url, {
      scenarioId: targetId,
      resourceLabel: geoLocalePatchDescriptor.localeSpecific
        ? `geo_locale_patch_${geoLocalePatchDescriptor.language}`
        : "geo_locale_patch",
    }),
    requestedBundleLevel === "full"
      ? loadOptionalScenarioResource(d3Client, manifest.releasable_catalog_url, {
        scenarioId: targetId,
        resourceLabel: "releasable_catalog",
      })
      : Promise.resolve({ ok: false, value: priorBundle?.releasableCatalog || null, metrics: null, reason: "deferred", errorMessage: "" }),
    requestedBundleLevel === "full"
      ? loadOptionalScenarioResource(d3Client, manifest.district_groups_url, {
        scenarioId: targetId,
        resourceLabel: "district_groups",
      })
      : Promise.resolve({ ok: false, value: priorBundle?.districtGroupsPayload || null, metrics: null, reason: "deferred", errorMessage: "" }),
    requestedBundleLevel === "full"
      ? loadOptionalScenarioResource(d3Client, manifest.audit_url, {
        scenarioId: targetId,
        resourceLabel: "audit",
      })
      : Promise.resolve({ ok: false, value: priorBundle?.auditPayload || null, metrics: null, reason: "deferred", errorMessage: "" }),
  ]);

  const bundle = {
    ...(priorBundle && typeof priorBundle === "object" ? priorBundle : {}),
    meta,
    manifest,
    bundleLevel: requestedBundleLevel,
    runtimeShell,
    chunkRegistry: priorBundle?.chunkRegistry || null,
    contextLodManifest: priorBundle?.contextLodManifest || null,
    runtimeMetaPayload: priorBundle?.runtimeMetaPayload || null,
    meshPackPayload: priorBundle?.meshPackPayload || null,
    chunkPayloadCacheById: {
      ...(priorBundle?.chunkPayloadCacheById || {}),
    },
    chunkPayloadPromisesById: {},
    chunkPreloaded: !!priorBundle?.chunkPreloaded,
    countriesPayload: countriesResult.payload,
    ownersPayload: ownersResult.payload,
    controllersPayload: controllersResult.payload,
    coresPayload: coresResult.payload,
    waterRegionsPayload: priorBundle?.waterRegionsPayload || null,
    specialRegionsPayload: priorBundle?.specialRegionsPayload || null,
    reliefOverlaysPayload: priorBundle?.reliefOverlaysPayload || null,
    cityOverridesPayload: priorBundle?.cityOverridesPayload || null,
    geoLocalePatchPayload: normalizeScenarioGeoLocalePatchPayload(geoLocalePatchResult.value),
    geoLocalePatchPayloadsByLanguage: {
      ...(priorBundle?.geoLocalePatchPayloadsByLanguage || {}),
    },
    runtimeTopologyPayload: normalizeScenarioRuntimeTopologyPayload(runtimeTopologyResult.value),
    runtimePoliticalMeta: runtimeTopologyResult.runtimePoliticalMeta || null,
    runtimeDecodedCollections: runtimeTopologyResult.decodedCollections || null,
    releasableCatalog: releasableCatalogResult.value || null,
    districtGroupsPayload: normalizeScenarioDistrictGroupsPayload(districtGroupsResult.value, targetId),
    auditPayload: auditResult.value || null,
    optionalLayerPromises: {
      ...(priorBundle?.optionalLayerPromises || {}),
    },
    optionalLayerSettledByKey: {
      ...(priorBundle?.optionalLayerSettledByKey || {}),
    },
    loadDiagnostics: {
      optionalResources: {
        runtime_topology: {
          ok: !!runtimeTopologyResult.ok,
          reason: runtimeTopologyResult.reason,
          errorMessage: runtimeTopologyResult.errorMessage,
          metrics: runtimeTopologyResult.metrics || null,
          url: runtimeTopologyUrl,
        },
        geo_locale_patch: {
          ok: !!geoLocalePatchResult.ok,
          reason: geoLocalePatchResult.reason,
          errorMessage: geoLocalePatchResult.errorMessage,
          language: geoLocalePatchDescriptor.language,
          localeSpecific: geoLocalePatchDescriptor.localeSpecific,
          metrics: geoLocalePatchResult.metrics || null,
        },
        releasable_catalog: {
          ok: !!releasableCatalogResult.ok,
          reason: releasableCatalogResult.reason,
          errorMessage: releasableCatalogResult.errorMessage,
          metrics: releasableCatalogResult.metrics || null,
        },
        district_groups: {
          ok: !!districtGroupsResult.ok,
          reason: districtGroupsResult.reason,
          errorMessage: districtGroupsResult.errorMessage,
          metrics: districtGroupsResult.metrics || null,
        },
        audit: {
          ok: !!auditResult.ok,
          reason: auditResult.reason,
          errorMessage: auditResult.errorMessage,
          metrics: auditResult.metrics || null,
        },
      },
      requiredResources: {
        manifest: manifestResult.metrics || null,
        countries: countriesResult.metrics || null,
        owners: ownersResult.metrics || null,
        controllers: controllersResult.metrics || null,
        cores: coresResult.metrics || null,
      },
      bundleLevel: requestedBundleLevel,
    },
  };
  if (bundle.geoLocalePatchPayload) {
    if (geoLocalePatchDescriptor.localeSpecific) {
      bundle.geoLocalePatchPayloadsByLanguage[geoLocalePatchDescriptor.language] = bundle.geoLocalePatchPayload;
    } else {
      bundle.geoLocalePatchPayloadsByLanguage.en = bundle.geoLocalePatchPayload;
      bundle.geoLocalePatchPayloadsByLanguage.zh = bundle.geoLocalePatchPayload;
    }
  }
  if (requestedBundleLevel === "full") {
    if (scenarioSupportsChunkedRuntime(bundle)) {
      await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
    }
  }
  const ownerCount = Object.keys(bundle.ownersPayload?.owners || {}).length;
  const controllerCount = Object.keys(bundle.controllersPayload?.controllers || {}).length;
  const countryCount = Object.keys(bundle.countriesPayload?.countries || {}).length;
  const runtimeTopologyEquivalentMs =
    Number(runtimeTopologyResult.metrics?.totalMs || runtimeTopologyResult.metrics?.durationMs || 0)
    + Number(bundle.chunkRegistryLoadMetrics?.detailChunkManifest?.totalMs || bundle.chunkRegistryLoadMetrics?.detailChunkManifest?.durationMs || 0)
    + Number(bundle.chunkRegistryLoadMetrics?.runtimeMeta?.totalMs || bundle.chunkRegistryLoadMetrics?.runtimeMeta?.durationMs || 0)
    + Number(bundle.chunkRegistryLoadMetrics?.meshPack?.totalMs || bundle.chunkRegistryLoadMetrics?.meshPack?.durationMs || 0);
  console.log(
    `[scenario] Loaded ${requestedBundleLevel} bundle "${targetId}": ${ownerCount} owner entries, ${controllerCount} controller entries, ${countryCount} countries, baseline=${String(manifest?.baseline_hash || "").slice(0, 12)}`
  );
  state.scenarioBundleCacheById[targetId] = bundle;
  if (scenarioBootstrapCoreCacheKey && requestedBundleLevel === "bootstrap") {
    if (hasScenarioRuntimePoliticalPayload(bundle.runtimeTopologyPayload)) {
      if (state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
        state.startupBootCacheState.scenarioBootstrap = "write-pending";
      }
      const cacheWrites = [
        writeStartupCacheEntry({
          kind: STARTUP_CACHE_KINDS.SCENARIO_BOOTSTRAP_CORE,
          cacheKey: scenarioBootstrapCoreCacheKey,
          payload: createSerializableStartupScenarioBootstrapCorePayload({
            manifest,
            bundleLevel: requestedBundleLevel,
            countriesPayload: bundle.countriesPayload,
            ownersPayload: bundle.ownersPayload,
            controllersPayload: bundle.controllersPayload,
            coresPayload: bundle.coresPayload,
            runtimeTopologyPayload: bundle.runtimeTopologyPayload,
            runtimePoliticalMeta: bundle.runtimePoliticalMeta,
          }),
          keyParts: {
            scenarioId: targetId,
            bundleLevel: requestedBundleLevel,
            role: "core",
          },
        }),
      ];
      if (scenarioBootstrapLocaleCacheKey && bundle.geoLocalePatchPayload) {
        cacheWrites.push(writeStartupCacheEntry({
          kind: STARTUP_CACHE_KINDS.SCENARIO_BOOTSTRAP_LOCALE,
          cacheKey: scenarioBootstrapLocaleCacheKey,
          payload: createSerializableStartupScenarioBootstrapLocalePayload({
            manifest,
            bundleLevel: requestedBundleLevel,
            language: state.currentLanguage,
            geoLocalePatchPayload: bundle.geoLocalePatchPayload,
          }),
          keyParts: {
            scenarioId: targetId,
            bundleLevel: requestedBundleLevel,
            role: "locale",
            language: state.currentLanguage,
          },
        }));
      }
      void Promise.allSettled(cacheWrites).then((results) => {
        const rejected = results.find((result) => result.status === "rejected");
        if (rejected) {
          throw rejected.reason;
        }
        if (state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
          state.startupBootCacheState.scenarioBootstrap = "written";
        }
      }).catch((error) => {
        console.warn(`[scenario] Startup bootstrap cache write failed for "${targetId}".`, error);
        if (state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
          state.startupBootCacheState.scenarioBootstrap = "write-error";
        }
      });
    } else if (state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
      state.startupBootCacheState.scenarioBootstrap = "skipped-incomplete";
    }
  }
  recordScenarioPerfMetric("loadScenarioBundle", (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - loadStartedAt, {
    scenarioId: targetId,
    cacheHit: false,
    bundleLevel: requestedBundleLevel,
    countryCount,
    ownerCount,
    controllerCount,
    workerDecodeMs: Number(runtimeTopologyResult.workerMetrics?.runtimePoliticalTopology?.totalMs || 0),
    workerMetaBuildMs: Number(runtimeTopologyResult.workerMetrics?.runtimePoliticalMeta?.buildMs || 0),
    runtimeTopologyDecodePath: String(runtimeTopologyResult.reason || "main-thread"),
    resourceMetrics: {
      manifest: manifestResult.metrics || null,
      runtimeTopology: runtimeTopologyResult.metrics || null,
      geoLocalePatch: geoLocalePatchResult.metrics || null,
      chunkRegistry: bundle.chunkRegistryLoadMetrics || null,
    },
  });
  recordScenarioPerfMetric("runtimeTopologyEquivalent", runtimeTopologyEquivalentMs, {
    scenarioId: targetId,
    bundleLevel: requestedBundleLevel,
    runtimeTopologyDecodePath: String(runtimeTopologyResult.reason || "main-thread"),
    hasChunkedRuntime: scenarioBundleHasChunkedData(bundle),
  });
  return bundle;
}

async function loadScenarioAuditPayload(
  bundleOrScenarioId,
  {
    d3Client = globalThis.d3,
    forceReload = false,
  } = {}
) {
  const bundle = typeof bundleOrScenarioId === "string"
    ? await loadScenarioBundle(bundleOrScenarioId, { d3Client, bundleLevel: "full" })
    : bundleOrScenarioId;
  const requestedScenarioId = normalizeScenarioId(
    bundle?.manifest?.scenario_id || bundle?.meta?.scenario_id
  );
  if (!bundle?.manifest?.audit_url) {
    return null;
  }
  if (bundle.auditPayload && !forceReload) {
    if (requestedScenarioId && normalizeScenarioId(state.activeScenarioId) === requestedScenarioId) {
      state.scenarioAudit = bundle.auditPayload;
      setScenarioAuditUiState({
        loading: false,
        loadedForScenarioId: requestedScenarioId,
        errorMessage: "",
      });
      syncScenarioUi();
    }
    return bundle.auditPayload;
  }
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available for scenario audit loading.");
  }

  if (requestedScenarioId && normalizeScenarioId(state.activeScenarioId) === requestedScenarioId) {
    setScenarioAuditUiState({
      loading: true,
      errorMessage: "",
    });
    syncScenarioUi();
  }

  try {
    const { payload: auditPayload } = await loadMeasuredJsonResource(cacheBust(bundle.manifest.audit_url), {
      d3Client,
      label: "scenario:audit",
    });
    bundle.auditPayload = auditPayload || null;
    if (requestedScenarioId && normalizeScenarioId(state.activeScenarioId) === requestedScenarioId) {
      state.scenarioAudit = bundle.auditPayload;
      setScenarioAuditUiState({
        loading: false,
        loadedForScenarioId: bundle.auditPayload ? requestedScenarioId : "",
        errorMessage: "",
      });
      syncScenarioUi();
    }
    return bundle.auditPayload;
  } catch (error) {
    if (requestedScenarioId && normalizeScenarioId(state.activeScenarioId) === requestedScenarioId) {
      setScenarioAuditUiState({
        loading: false,
        errorMessage: String(error?.message || "Unable to load audit details."),
      });
      syncScenarioUi();
    }
    throw error;
  }
}

async function validateImportedScenarioBaseline(projectScenario, { d3Client = globalThis.d3 } = {}) {
  const scenarioId = normalizeScenarioId(projectScenario?.id);
  if (!scenarioId) {
    return { ok: true, bundle: null, message: "" };
  }

  let bundle = null;
  try {
    bundle = await loadScenarioBundle(scenarioId, { d3Client, bundleLevel: "full" });
  } catch (error) {
    return {
      ok: false,
      bundle: null,
      message: `Scenario "${scenarioId}" is not available in the current asset set.`,
      reason: "missing_scenario",
      error,
    };
  }

  const currentVersion = getScenarioManifestVersion(bundle.manifest);
  const currentBaselineHash = getScenarioBaselineHashFromBundle(bundle);
  const expectedVersion = Number(projectScenario?.version || 1) || 1;
  const expectedBaselineHash = String(projectScenario?.baselineHash || "").trim();
  const mismatches = [];

  if (currentVersion !== expectedVersion) {
    mismatches.push(`version ${expectedVersion} -> ${currentVersion}`);
  }
  if (expectedBaselineHash !== currentBaselineHash) {
    mismatches.push("baseline hash differs");
  }

  return {
    ok: mismatches.length === 0,
    bundle,
    message: mismatches.length
      ? `Saved scenario baseline does not match current assets (${mismatches.join(", ")}).`
      : "",
    reason: mismatches.length ? "baseline_mismatch" : "",
    currentVersion,
    currentBaselineHash,
  };
}

export {
  applyBlankScenarioPresentationDefaults,
  createStartupScenarioBundleFromPayload,
  ensureRuntimeChunkLoadState,
  resetScenarioChunkRuntimeState,
  preloadScenarioCoarseChunks,
  scheduleScenarioChunkRefresh,
  scenarioBundleHasChunkedData,
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
  getScenarioDecodedCollection,
  getScenarioTopologyFeatureCollection,
  ensureActiveScenarioOptionalLayerLoaded,
  ensureActiveScenarioOptionalLayersForVisibility,
  ensureScenarioGeoLocalePatchForLanguage,
  hydrateActiveScenarioBundle,
  loadScenarioAuditPayload,
  loadScenarioBundle,
  loadScenarioRegistry,
  enforceScenarioHydrationHealthGate,
  releaseScenarioAuditPayload,
  validateImportedScenarioBaseline,
};
