import { countryNames, defaultCountryPalette, state } from "./state.js";
import { ensureSovereigntyState, markLegacyColorStateDirty } from "./sovereignty_manager.js";
import { normalizeMapSemanticMode } from "./state.js";
import {
  invalidateOceanBackgroundVisualState,
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
  createSerializableStartupScenarioBootstrapPayload,
  createStartupScenarioBootstrapCacheKey,
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
import { setActivePaletteSource, syncResolvedDefaultCountryPalette } from "./palette_manager.js";
import { markDirty } from "./dirty_state.js";
import {
  buildScenarioReleasableIndex,
  getScenarioReleasableCountries,
} from "./releasable_manager.js";
import {
  DETAIL_POLITICAL_MIN_FEATURES,
  SCENARIO_DETAIL_MIN_RATIO_STRICT,
  hasUsablePoliticalTopology,
  refreshScenarioDataHealth,
  scenarioNeedsDetailTopology,
} from "./scenario_data_health.js";
import { syncScenarioLocalizationState } from "./scenario_localization_state.js";
import {
  runPostRollbackRestoreEffects,
  runPostScenarioApplyEffects,
  runPostScenarioClearEffects,
  runPostScenarioResetEffects,
} from "./scenario_post_apply_effects.js";
import {
  setScenarioAuditUiState,
  syncCountryUi,
  syncScenarioUi,
} from "./scenario_ui_sync.js";
import {
  applyBlankScenarioPresentationDefaults,
  ensureRuntimeChunkLoadState,
  ensureActiveScenarioOptionalLayerLoaded,
  ensureScenarioGeoLocalePatchForLanguage,
  getScenarioDecodedCollection,
  getScenarioTopologyFeatureCollection,
  hydrateActiveScenarioBundle,
  loadScenarioAuditPayload,
  loadScenarioBundle,
  loadScenarioRegistry,
  resetScenarioChunkRuntimeState,
  releaseScenarioAuditPayload,
  scheduleScenarioChunkRefresh,
  scenarioBundleHasChunkedData,
  scenarioBundleUsesChunkedLayer,
  validateImportedScenarioBaseline,
} from "./scenario_resources.js";
import { assertScenarioInteractionsAllowed, buildScenarioFatalRecoveryError, clearScenarioFatalRecoveryState, consumeScenarioTestHook, enterScenarioFatalRecovery, formatScenarioFatalRecoveryMessage, getScenarioFatalRecoveryState, validateScenarioRuntimeConsistency } from "./scenario_recovery.js";
import { captureScenarioApplyRollbackSnapshot, restoreScenarioApplyRollbackSnapshot } from "./scenario_rollback.js";
import {
  getRuntimeGeometryFeatureId,
  getScenarioRuntimeGeometryCountryCode,
  hasExplicitScenarioAssignment,
  shouldApplyHoi4FarEastSovietBackfill,
} from "./scenario_runtime_queries.js";
import { t } from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";

const SCENARIO_REGISTRY_URL = "data/scenarios/index.json";
const DEFAULT_OCEAN_FILL_COLOR = "#aadaff";
const SCENARIO_RENDER_PROFILES = new Set(["auto", "balanced", "full"]);
const SCENARIO_BUNDLE_LEVELS = new Set(["bootstrap", "full"]);
const SCENARIO_LOAD_TIMEOUT_MS = 12_000;
const SCENARIO_DETAIL_SOURCE_FALLBACK_ORDER = ["na_v2", "na_v1", "legacy_bak", "highres"];
const SCENARIO_CHUNK_REFRESH_DELAY_MS_INTERACTING = 180;
const SCENARIO_CHUNK_REFRESH_DELAY_MS_IDLE = 60;
let scenarioRegistryPromise = null;
let activeScenarioApplyPromise = null;

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
      parentBordersDefault: null,
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
    parentBordersDefault:
      typeof raw.parent_borders_default === "boolean" ? raw.parent_borders_default : null,
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
    parentBordersVisible: state.parentBordersVisible !== false,
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
  state.parentBordersVisible = typeof hints.parentBordersDefault === "boolean"
    ? hints.parentBordersDefault
    : false;
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
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
}

function restoreScenarioDisplaySettingsAfterExit() {
  const snapshot = state.scenarioDisplaySettingsBeforeActivate;
  if (snapshot && typeof snapshot === "object") {
    state.renderProfile = normalizeScenarioRenderProfile(snapshot.renderProfile, state.renderProfile || "auto");
    state.dynamicBordersEnabled = snapshot.dynamicBordersEnabled !== false;
    state.parentBordersVisible = snapshot.parentBordersVisible !== false;
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
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
}

function getScenarioOceanFillOverride(manifest) {
  const rawValue = String(manifest?.style_defaults?.ocean?.fillColor || "").trim();
  return rawValue ? normalizeScenarioOceanFillColor(rawValue, "") : "";
}

function updateScenarioOceanFill(fillColor, reason) {
  if (!state.styleConfig || typeof state.styleConfig !== "object") {
    state.styleConfig = {};
  }
  if (!state.styleConfig.ocean || typeof state.styleConfig.ocean !== "object") {
    state.styleConfig.ocean = {};
  }
  const previousFill = normalizeScenarioOceanFillColor(state.styleConfig.ocean.fillColor);
  const nextFill = normalizeScenarioOceanFillColor(fillColor);
  state.styleConfig.ocean.fillColor = nextFill;
  if (previousFill !== nextFill) {
    invalidateOceanBackgroundVisualState(reason);
    return true;
  }
  return false;
}

function syncScenarioOceanFillForActivation(manifest) {
  const nextOverride = getScenarioOceanFillOverride(manifest);
  const previousOverride = getScenarioOceanFillOverride(state.activeScenarioManifest);
  if (!state.styleConfig || typeof state.styleConfig !== "object") {
    state.styleConfig = {};
  }
  if (!state.styleConfig.ocean || typeof state.styleConfig.ocean !== "object") {
    state.styleConfig.ocean = {};
  }
  if (state.scenarioOceanFillBeforeActivate === null) {
    state.scenarioOceanFillBeforeActivate = normalizeScenarioOceanFillColor(state.styleConfig.ocean.fillColor);
  }
  if (nextOverride) {
    updateScenarioOceanFill(nextOverride, "scenario-ocean-fill-activate");
  } else if (previousOverride && state.scenarioOceanFillBeforeActivate !== null) {
    updateScenarioOceanFill(
      state.scenarioOceanFillBeforeActivate,
      "scenario-ocean-fill-restore-baseline"
    );
  }
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
  }
}

function restoreScenarioOceanFillAfterExit() {
  if (state.scenarioOceanFillBeforeActivate === null) {
    return;
  }
  updateScenarioOceanFill(state.scenarioOceanFillBeforeActivate, "scenario-ocean-fill-clear");
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

function getMissingScenarioNameTags(countryMap = {}, scenarioNameMap = {}) {
  const missing = [];
  Object.keys(countryMap || {}).forEach((rawTag) => {
    const normalizedTag = String(rawTag || "").trim().toUpperCase();
    if (!normalizedTag) {
      return;
    }
    const displayName = String(scenarioNameMap?.[normalizedTag] || "").trim();
    if (!displayName) {
      missing.push(normalizedTag);
    }
  });
  return missing;
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

function getActiveScenarioMergedChunkLayerPayload(layerKey, scenarioId = state.activeScenarioId) {
  const mergedLayerPayloads = state.activeScenarioChunks?.mergedLayerPayloads;
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  const normalizedChunkScenarioId = normalizeScenarioId(state.activeScenarioChunks?.scenarioId);
  if (
    !normalizedScenarioId
    || normalizedChunkScenarioId !== normalizedScenarioId
    || !mergedLayerPayloads
    || typeof mergedLayerPayloads !== "object"
    || !Object.prototype.hasOwnProperty.call(mergedLayerPayloads, layerKey)
  ) {
    return undefined;
  }
  return mergedLayerPayloads[layerKey] || null;
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
  cachedPayload,
  geoLocalePatchDescriptor,
  runtimeTopologyUrl,
} = {}) {
  const runtimeShell = normalizeScenarioRuntimeShell(manifest);
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
    countriesPayload: cachedPayload?.countriesPayload || null,
    ownersPayload: cachedPayload?.ownersPayload || null,
    controllersPayload: cachedPayload?.controllersPayload || null,
    coresPayload: cachedPayload?.coresPayload || null,
    waterRegionsPayload: priorBundle?.waterRegionsPayload || null,
    specialRegionsPayload: priorBundle?.specialRegionsPayload || null,
    reliefOverlaysPayload: priorBundle?.reliefOverlaysPayload || null,
    cityOverridesPayload: priorBundle?.cityOverridesPayload || null,
    geoLocalePatchPayload: normalizeScenarioGeoLocalePatchPayload(cachedPayload?.geoLocalePatchPayload),
    geoLocalePatchPayloadsByLanguage: {
      ...(priorBundle?.geoLocalePatchPayloadsByLanguage || {}),
    },
    runtimeTopologyPayload: normalizeScenarioRuntimeTopologyPayload(cachedPayload?.runtimeTopologyPayload),
    runtimePoliticalMeta: cachedPayload?.runtimePoliticalMeta || null,
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
          ok: !!cachedPayload?.runtimeTopologyPayload,
          reason: "persistent-cache-hit",
          errorMessage: "",
          metrics: null,
          url: runtimeTopologyUrl,
        },
        geo_locale_patch: {
          ok: !!cachedPayload?.geoLocalePatchPayload,
          reason: "persistent-cache-hit",
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

function setScenarioViewMode(
  viewMode,
  {
    renderNow = true,
    markDirtyReason = "",
  } = {}
) {
  assertScenarioInteractionsAllowed("change scenario view mode");
  const nextMode = normalizeScenarioViewMode(viewMode);
  if (!state.activeScenarioId) {
    state.scenarioViewMode = "ownership";
    return false;
  }
  if (state.scenarioViewMode === nextMode) {
    return false;
  }
  state.scenarioViewMode = nextMode;
  recalculateScenarioOwnerControllerDiffCount();
  if (markDirtyReason) {
    markDirty(markDirtyReason);
  }
  refreshColorState({ renderNow: false });
  recomputeDynamicBordersNow({ renderNow: false, reason: `scenario-view:${nextMode}` });
  syncCountryUi({ renderNow });
  return true;
}

async function ensureScenarioDetailTopologyLoaded({ applyMapData = true } = {}) {
  {
    const promoted = await ensureDetailTopologyBoundary({ applyMapData });
    if (promoted) return true;
  }
  const hasDetailNow = hasUsablePoliticalTopology(state.topologyDetail);
  if (hasDetailNow && state.topologyBundleMode !== "composite") {
    state.topologyBundleMode = "composite";
    if (applyMapData) {
      setMapData({ refitProjection: false, resetZoom: false });
    }
    return true;
  }
  if (hasDetailNow && state.topologyBundleMode === "composite") {
    return false;
  }
  if (state.detailPromotionInFlight) {
    return false;
  }
  state.detailPromotionInFlight = true;
  try {
    const detailSourceKeys = Array.from(new Set([
      String(state.detailSourceRequested || "").trim(),
      String(state.activeScenarioManifest?.detail_source || "").trim(),
      ...SCENARIO_DETAIL_SOURCE_FALLBACK_ORDER,
    ].filter(Boolean)));
    try {
      const {
        topologyDetail,
        runtimePoliticalTopology,
        detailSourceUsed,
      } = await loadDeferredDetailBundle({
        detailSourceKey: detailSourceKeys[0] || state.detailSourceRequested,
        detailSourceKeys,
      });

      const runtimeFallback = runtimePoliticalTopology || state.runtimePoliticalTopology || null;
      const resolvedDetail = hasUsablePoliticalTopology(topologyDetail)
        ? topologyDetail
        : (hasUsablePoliticalTopology(runtimeFallback) ? runtimeFallback : null);
      if (!resolvedDetail) {
        console.warn(
          `[scenario] Detail promotion resolved no usable topology. Tried sources: ${detailSourceKeys.join(", ") || "(default)"}.`
        );
        state.detailDeferred = false;
        return false;
      }

      if (!hasUsablePoliticalTopology(topologyDetail) && hasUsablePoliticalTopology(runtimeFallback)) {
        console.warn("[scenario] Detail promotion using runtime political fallback.");
      }
      state.topologyDetail = resolvedDetail;
      state.runtimePoliticalTopology = runtimeFallback;
      state.topologyBundleMode = "composite";
      state.detailDeferred = false;
      state.detailPromotionCompleted = true;
      state.detailSourceRequested = detailSourceUsed || detailSourceKeys[0] || state.detailSourceRequested;
      if (applyMapData) {
        setMapData({ refitProjection: false, resetZoom: false });
      }
      return true;
    } catch (error) {
      state.detailDeferred = false;
      console.warn(
        `[scenario] Detail topology could not be promoted. Tried sources: ${detailSourceKeys.join(", ") || "(default)"}. Staying on coarse map.`,
        error
      );
      return false;
    }
  } catch (error) {
    console.warn("Unable to force-load detail topology before scenario apply:", error);
    return false;
  } finally {
    state.detailPromotionInFlight = false;
  }
}

function disableScenarioParentBorders() {
  if (!state.activeScenarioId && state.scenarioParentBorderEnabledBeforeActivate === null) {
    state.scenarioParentBorderEnabledBeforeActivate = {
      ...(state.parentBorderEnabledByCountry || {}),
    };
  }
  const next = {};
  Object.keys(state.parentBorderEnabledByCountry || {}).forEach((countryCode) => {
    next[countryCode] = false;
  });
  state.parentBorderEnabledByCountry = next;
  if (typeof state.updateParentBorderCountryListFn === "function") {
    state.updateParentBorderCountryListFn();
  }
}

function restoreParentBordersAfterScenario() {
  if (state.scenarioParentBorderEnabledBeforeActivate && typeof state.scenarioParentBorderEnabledBeforeActivate === "object") {
    state.parentBorderEnabledByCountry = {
      ...state.scenarioParentBorderEnabledBeforeActivate,
    };
  }
  state.scenarioParentBorderEnabledBeforeActivate = null;
  if (typeof state.updateParentBorderCountryListFn === "function") {
    state.updateParentBorderCountryListFn();
  }
}

function applyScenarioPaintMode() {
  if (!state.scenarioPaintModeBeforeActivate) {
    state.scenarioPaintModeBeforeActivate = {
      paintMode: String(state.paintMode || "visual") === "sovereignty" ? "sovereignty" : "visual",
      interactionGranularity: String(state.interactionGranularity || "subdivision") === "country"
        ? "country"
        : "subdivision",
      batchFillScope: String(state.batchFillScope || "parent") === "country" ? "country" : "parent",
      politicalEditingExpanded: !!state.ui?.politicalEditingExpanded,
    };
  }
  state.paintMode = "sovereignty";
  state.interactionGranularity = "subdivision";
  if (state.ui && typeof state.ui === "object") {
    state.ui.politicalEditingExpanded = false;
    state.ui.scenarioVisualAdjustmentsOpen = false;
  }
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }
}

function restorePaintModeAfterScenario() {
  const previous = state.scenarioPaintModeBeforeActivate;
  if (previous && typeof previous === "object") {
    state.paintMode = previous.paintMode === "sovereignty" ? "sovereignty" : "visual";
    state.interactionGranularity = previous.interactionGranularity === "country"
      ? "country"
      : "subdivision";
    state.batchFillScope = previous.batchFillScope === "country" ? "country" : "parent";
    if (state.ui && typeof state.ui === "object") {
      state.ui.politicalEditingExpanded = !!previous.politicalEditingExpanded;
      state.ui.scenarioVisualAdjustmentsOpen = false;
    }
  }
  state.scenarioPaintModeBeforeActivate = null;
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }
}

function cloneScenarioStateValue(value) {
  if (value === null || value === undefined || typeof value !== "object") {
    return value;
  }
  if (typeof globalThis.structuredClone === "function") {
    return globalThis.structuredClone(value);
  }
  if (value instanceof Map) {
    return new Map(Array.from(value.entries(), ([key, entry]) => [
      cloneScenarioStateValue(key),
      cloneScenarioStateValue(entry),
    ]));
  }
  if (value instanceof Set) {
    return new Set(Array.from(value, (entry) => cloneScenarioStateValue(entry)));
  }
  if (Array.isArray(value)) {
    return value.map((entry) => cloneScenarioStateValue(entry));
  }
  const cloned = {};
  Object.entries(value).forEach(([key, entry]) => {
    cloned[key] = cloneScenarioStateValue(entry);
  });
  return cloned;
}

async function prepareScenarioApplyState(
  bundle,
  {
    syncPalette = true,
    interactionLevel = "full",
  } = {}
) {
  const startupReadonly = interactionLevel === "readonly-startup";
  const detailPromoted = startupReadonly
    ? false
    : await ensureScenarioDetailTopologyLoaded({ applyMapData: false });
  const politicalChunkedReady =
    scenarioBundleUsesChunkedLayer(bundle, "political")
    && scenarioBundleHasChunkedData(bundle);
  const detailReady = (
    state.topologyBundleMode === "composite"
    && hasUsablePoliticalTopology(state.topologyDetail)
  ) || !!detailPromoted || politicalChunkedReady;
  if (!detailReady && scenarioNeedsDetailTopology(bundle.manifest) && !startupReadonly) {
    const scenarioLabel = getScenarioDisplayName(
      bundle.manifest,
      String(bundle.manifest?.scenario_id || "Scenario").trim()
    );
    const message = `Detailed political topology could not be loaded. ${scenarioLabel} cannot be applied in coarse mode.`;
    console.error(`[scenario] ${message}`);
    throw new Error(message);
  }
  if (!detailReady && state.topologyBundleMode !== "composite") {
    console.warn("[scenario] Applying bundle without confirmed detail promotion; health gate will validate runtime topology.");
  }
  if (syncPalette) {
    const paletteApplied = await setActivePaletteSource(
      normalizeScenarioId(bundle.manifest?.palette_id) || "hoi4_vanilla",
      {
        syncUI: true,
        overwriteCountryPalette: false,
      }
    );
    if (!paletteApplied) {
      throw new Error(
        `Unable to load palette for scenario "${normalizeScenarioId(bundle.manifest?.scenario_id || bundle.meta?.scenario_id)}".`
      );
    }
  }

  const scenarioId = normalizeScenarioId(bundle.manifest.scenario_id || bundle.meta?.scenario_id);
  if (!scenarioId) {
    throw new Error("Scenario bundle is missing a scenario id.");
  }
  const baseCountryMap = bundle.countriesPayload?.countries;
  if (!baseCountryMap || typeof baseCountryMap !== "object") {
    throw new Error(`Scenario "${scenarioId}" is missing countries data.`);
  }
  const ownersPayload = bundle.ownersPayload?.owners;
  if (!ownersPayload || typeof ownersPayload !== "object") {
    throw new Error(`Scenario "${scenarioId}" is missing owner data.`);
  }
  const baseCountryTags = Object.keys(baseCountryMap);
  const owners = ownersPayload;
  const controllers = bundle.controllersPayload?.controllers && typeof bundle.controllersPayload.controllers === "object"
    ? bundle.controllersPayload.controllers
    : owners;
  const cores = bundle.coresPayload?.cores && typeof bundle.coresPayload.cores === "object"
    ? normalizeScenarioCoreMap(bundle.coresPayload.cores)
    : {};
  const startupApplySeed = bundle.startupApplySeed && typeof bundle.startupApplySeed === "object"
    ? bundle.startupApplySeed
    : null;
  const defaultCountryCode = String(
    startupApplySeed?.default_country_code
    || getScenarioDefaultCountryCode(bundle.manifest, baseCountryMap)
  ).trim().toUpperCase();
  const mapSemanticMode = String(
    startupApplySeed?.map_semantic_mode
    || getScenarioMapSemanticMode(bundle.manifest)
  ).trim().toLowerCase() || "political";
  const releasableIndex = buildScenarioReleasableIndex(scenarioId, {
    excludeTags: baseCountryTags,
  });
  const releasableCountries = getScenarioReleasableCountries(scenarioId, {
    excludeTags: baseCountryTags,
  });
  Object.keys(releasableCountries).forEach((tag) => {
    if (baseCountryMap[tag]) {
      console.warn(`[scenario] Releasable tag conflict detected for "${tag}" while applying "${scenarioId}".`);
    }
  });
  const countryMap = {
    ...baseCountryMap,
    ...releasableCountries,
  };
  const runtimeTopologyPayload = bundle.runtimeTopologyPayload || null;
  const districtGroupsPayload = normalizeScenarioDistrictGroupsPayload(bundle.districtGroupsPayload, scenarioId);
  const mergedWaterPayload = getActiveScenarioMergedChunkLayerPayload("water", scenarioId);
  const mergedSpecialPayload = getActiveScenarioMergedChunkLayerPayload("special", scenarioId);
  const mergedReliefPayload = getActiveScenarioMergedChunkLayerPayload("relief", scenarioId);
  const mergedCitiesPayload = getActiveScenarioMergedChunkLayerPayload("cities", scenarioId);
  const scenarioWaterRegionsFromTopology =
    mergedWaterPayload !== undefined
      ? mergedWaterPayload
      : (
        bundle.waterRegionsPayload
        || getScenarioDecodedCollection(bundle, "scenarioWaterRegionsData")
        || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_water")
      );
  const scenarioSpecialRegionsFromTopology =
    mergedSpecialPayload !== undefined
      ? mergedSpecialPayload
      : (
        getScenarioDecodedCollection(bundle, "scenarioSpecialRegionsData")
        || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_special_land")
      );
  const scenarioContextLandMaskFromTopology =
    getScenarioDecodedCollection(bundle, "scenarioContextLandMaskData")
    || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "context_land_mask");
  const scenarioLandMaskFromTopology =
    getScenarioDecodedCollection(bundle, "scenarioLandMaskData")
    || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "land_mask")
    || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "land");
  const scenarioNameMap = startupApplySeed?.scenario_name_map && typeof startupApplySeed.scenario_name_map === "object"
    ? { ...getScenarioNameMap(countryMap), ...startupApplySeed.scenario_name_map }
    : getScenarioNameMap(countryMap);
  const missingScenarioNameTags = getMissingScenarioNameTags(countryMap, scenarioNameMap);
  if (missingScenarioNameTags.length) {
    throw new Error(
      `Scenario "${scenarioId}" is missing display names for active tags: ${missingScenarioNameTags.slice(0, 12).join(", ")}`
    );
  }
  const scenarioColorMap = startupApplySeed?.scenario_color_map && typeof startupApplySeed.scenario_color_map === "object"
    ? { ...startupApplySeed.scenario_color_map }
    : getScenarioFixedOwnerColors(countryMap);
  const scenarioOwnerBackfill = startupApplySeed?.resolved_owners && typeof startupApplySeed.resolved_owners === "object"
    ? {}
    : buildHoi4FarEastSovietOwnerBackfill(scenarioId, {
      runtimeTopology: runtimeTopologyPayload?.objects?.political
        ? runtimeTopologyPayload
        : (state.defaultRuntimePoliticalTopology || state.runtimePoliticalTopology || null),
      ownersByFeatureId: owners,
      controllersByFeatureId: controllers,
    });
  const resolvedOwners = startupApplySeed?.resolved_owners && typeof startupApplySeed.resolved_owners === "object"
    ? { ...startupApplySeed.resolved_owners }
    : (
      Object.keys(scenarioOwnerBackfill).length
        ? {
          ...owners,
          ...scenarioOwnerBackfill,
        }
        : { ...owners }
    );
  const scenarioParentBorderEnabledBeforeActivate =
    state.scenarioParentBorderEnabledBeforeActivate === null && !state.activeScenarioId
      ? { ...(state.parentBorderEnabledByCountry || {}) }
      : cloneScenarioStateValue(state.scenarioParentBorderEnabledBeforeActivate);
  const scenarioDisplaySettingsBeforeActivate =
    !state.activeScenarioId && !state.scenarioDisplaySettingsBeforeActivate
      ? {
        renderProfile: normalizeScenarioRenderProfile(state.renderProfile, "auto"),
        dynamicBordersEnabled: state.dynamicBordersEnabled !== false,
        parentBordersVisible: state.parentBordersVisible !== false,
        showWaterRegions: state.showWaterRegions !== false,
        showScenarioSpecialRegions: state.showScenarioSpecialRegions !== false,
        showScenarioReliefOverlays: state.showScenarioReliefOverlays !== false,
      }
      : cloneScenarioStateValue(state.scenarioDisplaySettingsBeforeActivate);
  const scenarioOceanFillBeforeActivate = state.scenarioOceanFillBeforeActivate === null
    ? normalizeScenarioOceanFillColor(state.styleConfig?.ocean?.fillColor)
    : state.scenarioOceanFillBeforeActivate;
  return {
    scenarioId,
    baseCountryMap,
    defaultCountryCode,
    mapSemanticMode,
    countryMap,
    runtimeTopologyPayload,
    districtGroupsPayload,
    scenarioWaterRegionsFromTopology,
    scenarioSpecialRegionsFromTopology,
    scenarioContextLandMaskFromTopology,
    scenarioLandMaskFromTopology,
    scenarioReliefOverlaysPayload: mergedReliefPayload !== undefined
      ? mergedReliefPayload
      : (bundle.reliefOverlaysPayload || null),
    scenarioCityOverridesPayload: mergedCitiesPayload !== undefined
      ? mergedCitiesPayload
      : (bundle.cityOverridesPayload || null),
    scenarioNameMap,
    scenarioColorMap,
    scenarioOwnerBackfill,
    resolvedOwners,
    controllers,
    cores,
    releasableIndex,
    scenarioParentBorderEnabledBeforeActivate,
    scenarioDisplaySettingsBeforeActivate,
    scenarioOceanFillBeforeActivate,
  };
}

async function applyScenarioBundle(
  bundle,
  {
    renderNow = true,
    suppressRender = false,
    markDirtyReason = "scenario-apply",
    syncPalette = true,
    showToastOnComplete = false,
    interactionLevel = "full",
  } = {}
) {
  const applyStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
  if (!bundle?.manifest) {
    throw new Error("Scenario bundle is missing a manifest.");
  }
  const rollbackSnapshot = captureScenarioApplyRollbackSnapshot();
  let staged = null;
  let topologyDecodeMs = 0;
  try {
    const topologyDecodeStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
    staged = await prepareScenarioApplyState(bundle, { syncPalette, interactionLevel });
    topologyDecodeMs = (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - topologyDecodeStartedAt;

    state.scenarioParentBorderEnabledBeforeActivate =
      cloneScenarioStateValue(staged.scenarioParentBorderEnabledBeforeActivate);
    state.scenarioDisplaySettingsBeforeActivate =
      cloneScenarioStateValue(staged.scenarioDisplaySettingsBeforeActivate);
    state.scenarioOceanFillBeforeActivate = staged.scenarioOceanFillBeforeActivate;
    state.activeScenarioId = staged.scenarioId;
    state.scenarioBorderMode = "scenario_owner_only";
    state.activeScenarioManifest = bundle.manifest || null;
    state.mapSemanticMode = staged.mapSemanticMode;
    state.scenarioCountriesByTag = staged.countryMap;
    state.scenarioFixedOwnerColors = staged.scenarioColorMap;
    state.defaultRuntimePoliticalTopology = state.defaultRuntimePoliticalTopology || state.runtimePoliticalTopology || null;
    state.activeScenarioMeshPack = bundle.meshPackPayload || null;
    state.scenarioRuntimeTopologyData = staged.runtimeTopologyPayload;
    state.runtimePoliticalTopology = staged.runtimeTopologyPayload?.objects?.political
      ? staged.runtimeTopologyPayload
      : (state.defaultRuntimePoliticalTopology || state.runtimePoliticalTopology || null);
    state.scenarioPoliticalChunkData = normalizeScenarioFeatureCollection(
      getActiveScenarioMergedChunkLayerPayload("political", staged.scenarioId)
    ) || null;
    state.runtimePoliticalMetaSeed = bundle.runtimePoliticalMeta || null;
    state.runtimePoliticalFeatureCollectionSeed = getScenarioDecodedCollection(bundle, "politicalData") || null;
    state.scenarioLandMaskData = staged.scenarioLandMaskFromTopology || null;
    state.scenarioContextLandMaskData = staged.scenarioContextLandMaskFromTopology || null;
    state.scenarioWaterRegionsData = staged.scenarioWaterRegionsFromTopology || bundle.waterRegionsPayload || null;
    state.scenarioSpecialRegionsData = staged.scenarioSpecialRegionsFromTopology || bundle.specialRegionsPayload || null;
    state.scenarioReliefOverlaysData = staged.scenarioReliefOverlaysPayload || null;
    state.scenarioReliefOverlayRevision = (Number(state.scenarioReliefOverlayRevision) || 0) + 1;
    state.scenarioDistrictGroupsData = staged.districtGroupsPayload;
    state.scenarioDistrictGroupByFeatureId = buildScenarioDistrictGroupByFeatureId(staged.districtGroupsPayload);
    syncScenarioLocalizationState({
      cityOverridesPayload: staged.mapSemanticMode === "blank" ? null : (staged.scenarioCityOverridesPayload || null),
      geoLocalePatchPayload: staged.mapSemanticMode === "blank" ? null : (bundle.geoLocalePatchPayload || null),
    });
    if (staged.mapSemanticMode === "blank") {
      applyBlankScenarioPresentationDefaults({ resetLocalization: false });
    }
    state.releasableCatalog = mergeReleasableCatalogs(state.defaultReleasableCatalog, bundle.releasableCatalog);
    state.scenarioReleasableIndex = staged.releasableIndex;
    state.scenarioAudit = bundle.auditPayload || null;
    setScenarioAuditUiState({
      loading: false,
      loadedForScenarioId: bundle.auditPayload ? staged.scenarioId : "",
      errorMessage: "",
    });
    state.scenarioImportAudit = null;
    state.scenarioBaselineHash = getScenarioBaselineHashFromBundle(bundle);
    state.scenarioBaselineOwnersByFeatureId = { ...staged.resolvedOwners };
    state.scenarioControllersByFeatureId = { ...staged.controllers };
    state.scenarioAutoShellOwnerByFeatureId = {};
    state.scenarioAutoShellControllerByFeatureId = {};
    state.scenarioBaselineControllersByFeatureId = { ...staged.controllers };
    state.scenarioBaselineCoresByFeatureId = { ...staged.cores };
    state.scenarioShellOverlayRevision = (Number(state.scenarioShellOverlayRevision) || 0) + 1;
    state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
    state.scenarioViewMode = "ownership";
    // Scenario country labels must come from the active scenario pack so
    // broken packs fail loudly instead of silently falling back to modern names.
    state.countryNames = staged.mapSemanticMode === "blank"
      ? { ...countryNames }
      : { ...staged.scenarioNameMap };
    state.sovereigntyByFeatureId = { ...staged.resolvedOwners };
    state.sovereigntyInitialized = false;
    state.visualOverrides = {};
    state.featureOverrides = {};
    state.sovereignBaseColors = { ...staged.scenarioColorMap };
    state.countryBaseColors = { ...staged.scenarioColorMap };
    markLegacyColorStateDirty();
    state.activeSovereignCode = staged.mapSemanticMode === "blank" ? "" : staged.defaultCountryCode;
    state.selectedWaterRegionId = "";
    state.selectedSpecialRegionId = "";
    state.hoveredWaterRegionId = null;
    state.hoveredSpecialRegionId = null;
    syncScenarioInspectorSelection(state.activeSovereignCode);

    disableScenarioParentBorders();
    applyScenarioPaintMode();
    syncScenarioOceanFillForActivation(bundle.manifest);
    applyScenarioPerformanceHints(bundle.manifest);
    state.scheduleScenarioChunkRefreshFn = scenarioBundleUsesChunkedLayer(bundle) ? scheduleScenarioChunkRefresh : null;
    if (scenarioBundleUsesChunkedLayer(bundle)) {
      resetScenarioChunkRuntimeState({ scenarioId: staged.scenarioId });
      const chunkIds = Object.keys(bundle.chunkPayloadCacheById || {});
      if (chunkIds.length) {
        state.activeScenarioChunks.loadedChunkIds = [...chunkIds];
        state.activeScenarioChunks.payloadByChunkId = { ...(bundle.chunkPayloadCacheById || {}) };
        state.activeScenarioChunks.lruChunkIds = [...chunkIds];
      }
      ensureRuntimeChunkLoadState().shellStatus = "ready";
      ensureRuntimeChunkLoadState().registryStatus = scenarioBundleHasChunkedData(bundle) ? "ready" : "idle";
    } else {
      resetScenarioChunkRuntimeState();
    }
    if (Object.keys(staged.scenarioOwnerBackfill).length) {
      console.info(
        `[scenario] Applied HOI4 Far East owner backfill for "${staged.scenarioId}": ${Object.keys(staged.scenarioOwnerBackfill).length} missing RU runtime features -> SOV.`
      );
    }
    recalculateScenarioOwnerControllerDiffCount();
    bundle.chunkLifecycle = {
      applyStartedAt,
      politicalCoreReadyRecorded: false,
    };
    const { dataHealth, scenarioMapRefreshMode, hasChunkedRuntime } = await runPostScenarioApplyEffects({
      bundle,
      scenarioId: staged.scenarioId,
      renderNow,
      suppressRender,
    });
    recordScenarioPerfMetric(
      "timeToInteractiveCoarseFrame",
      (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt,
      {
        scenarioId: staged.scenarioId,
        hasChunkedRuntime,
        mapRefreshMode: scenarioMapRefreshMode,
      }
    );
    if (typeof document !== "undefined") {
      const presetSection = document.getElementById("selectedCountryActionsSection");
      if (presetSection && "open" in presetSection) {
        presetSection.open = true;
      }
    }

    // Diagnostic: verify key ownership/frontline assignments took effect.
    const spotChecks = [
      "SYR-134",
      "LBN-3022",
      "BY_HIST_POL_VITEBSK_WEST",
      "CN_CITY_17275852B74586174185496",
      "CN_CITY_17275852B2295538790743",
    ];
    if (String(state.debugMode || "PROD") !== "PROD") {
      spotChecks.forEach((fid) => {
        const owner = state.sovereigntyByFeatureId[fid];
        const controller = state.scenarioControllersByFeatureId?.[fid] || owner;
        if (owner) {
          const color = staged.scenarioColorMap[owner] || "(no color)";
          console.log(`[scenario] Spot-check: ${fid} -> owner=${owner}, controller=${controller}, color=${color}`);
        }
      });
    }
    if (dataHealth.warning) {
      console.warn(
        `[scenario] Detail visibility gate triggered for ${staged.scenarioId}: runtime=${dataHealth.runtimeFeatureCount}, expected=${dataHealth.expectedFeatureCount}, ratio=${dataHealth.ratio.toFixed(3)} (min=${dataHealth.minRatio}).`
      );
    }
    const applyConsistency = validateScenarioRuntimeConsistency({
      expectedScenarioId: staged.scenarioId,
      phase: "apply",
    });
    if (!applyConsistency.ok) {
      throw new Error(
        `[scenario] Scenario state consistency check failed after apply: ${applyConsistency.problems.join(" ")}`
      );
    }
    clearScenarioFatalRecoveryState();
    if (markDirtyReason) {
      markDirty(markDirtyReason);
    }
    if (typeof state.triggerScenarioGuideFn === "function") {
      state.triggerScenarioGuideFn();
    }

    if (showToastOnComplete) {
      showToast(
        t("Scenario loaded. Expand the parent country and use Activate to apply releasable territory.", "ui"),
        {
          title: t("Scenario loaded", "ui"),
          tone: "success",
          duration: 4200,
        }
      );
    }
    recordScenarioPerfMetric("applyScenarioBundle", (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt, {
      scenarioId: staged.scenarioId,
      expectedFeatureCount: Number(bundle.manifest?.summary?.feature_count || 0),
      runtimeFeatureCount: Array.isArray(state.landData?.features) ? state.landData.features.length : 0,
      topologyDecodeMs,
      mapRefreshMode: scenarioMapRefreshMode,
      applyMs: (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt,
    });
  } catch (error) {
    let rollbackRestoreError = null;
    try {
      restoreScenarioApplyRollbackSnapshot(rollbackSnapshot, {
        shouldFailRestore: consumeScenarioTestHook("failRollbackRestoreOnce"),
      });
      runPostRollbackRestoreEffects({ renderNow });
    } catch (rollbackError) {
      rollbackRestoreError = rollbackError;
      console.error("[scenario] Failed to restore scenario apply rollback snapshot.", rollbackError);
    }
    if (rollbackRestoreError) {
      enterScenarioFatalRecovery({
        phase: "rollback",
        rootError: error,
        rollbackError: rollbackRestoreError,
      });
      const fatalError = buildScenarioFatalRecoveryError("recover the previous scenario state");
      fatalError.cause = error;
      throw fatalError;
    }
    const rollbackConsistency = validateScenarioRuntimeConsistency({
      expectedScenarioId: rollbackSnapshot?.activeScenarioId,
      phase: "rollback",
    });
    if (!rollbackConsistency.ok) {
      enterScenarioFatalRecovery({
        phase: "rollback",
        rootError: error,
        consistencyReport: rollbackConsistency,
      });
      const fatalError = buildScenarioFatalRecoveryError("recover the previous scenario state");
      fatalError.cause = error;
      throw fatalError;
    }
    throw error;
  }
}

async function applyScenarioById(
  scenarioId,
  {
    renderNow = true,
    markDirtyReason = "scenario-apply",
    showToastOnComplete = false,
  } = {}
) {
  assertScenarioInteractionsAllowed("apply a scenario");
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  if (!normalizedScenarioId) {
    throw new Error("[scenario] Scenario id is required.");
  }
  if (state.scenarioApplyInFlight && activeScenarioApplyPromise) {
    return activeScenarioApplyPromise;
  }

  state.scenarioApplyInFlight = true;
  syncScenarioUi();
  activeScenarioApplyPromise = (async () => {
    const bundle = await loadScenarioBundle(normalizedScenarioId, { bundleLevel: "full" });
    await applyScenarioBundle(bundle, {
      renderNow,
      markDirtyReason,
      showToastOnComplete,
    });
    return bundle;
  })();

  try {
    return await activeScenarioApplyPromise;
  } finally {
    activeScenarioApplyPromise = null;
    state.scenarioApplyInFlight = false;
    syncScenarioUi();
  }
}

async function applyDefaultScenarioOnStartup(
  {
    renderNow = true,
    d3Client = globalThis.d3,
  } = {}
) {
  if (state.activeScenarioId) {
    return null;
  }
  const registry = await loadScenarioRegistry({ d3Client });
  const defaultScenarioId = normalizeScenarioId(registry?.default_scenario_id);
  if (!defaultScenarioId) {
    return null;
  }
  const meta = getScenarioMetaById(defaultScenarioId);
  if (!meta?.manifest_url) {
    console.warn(`[scenario] Default scenario "${defaultScenarioId}" is not registered.`);
    return null;
  }
  return applyScenarioById(defaultScenarioId, {
    renderNow,
    markDirtyReason: "",
    showToastOnComplete: false,
  });
}

function resetToScenarioBaseline(
  {
    renderNow = true,
    markDirtyReason = "scenario-reset",
    showToastOnComplete = false,
  } = {}
) {
  assertScenarioInteractionsAllowed("reset the active scenario");
  if (!state.activeScenarioId || !state.scenarioBaselineOwnersByFeatureId) {
    return false;
  }
  const previousSelectedInspectorCountryCode = String(state.selectedInspectorCountryCode || "").trim().toUpperCase();
  const previousExpandedInspectorContinents = state.expandedInspectorContinents instanceof Set
    ? new Set(state.expandedInspectorContinents)
    : new Set();
  const previousExpandedInspectorReleaseParents = state.expandedInspectorReleaseParents instanceof Set
    ? new Set(state.expandedInspectorReleaseParents)
    : new Set();
  const previousInspectorExpansionInitialized = !!state.inspectorExpansionInitialized;
  state.sovereigntyByFeatureId = { ...(state.scenarioBaselineOwnersByFeatureId || {}) };
  state.scenarioControllersByFeatureId = { ...(state.scenarioBaselineControllersByFeatureId || {}) };
  state.scenarioAutoShellOwnerByFeatureId = {};
  state.scenarioAutoShellControllerByFeatureId = {};
  state.mapSemanticMode = getScenarioMapSemanticMode(state.activeScenarioManifest, state.mapSemanticMode);
  if (state.mapSemanticMode === "blank") {
    applyBlankScenarioPresentationDefaults();
  }
  state.scenarioShellOverlayRevision = (Number(state.scenarioShellOverlayRevision) || 0) + 1;
  state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
  state.scenarioViewMode = "ownership";
  state.sovereigntyInitialized = false;
  ensureSovereigntyState({ force: true });
  recalculateScenarioOwnerControllerDiffCount();
  state.parentBordersVisible = false;
  state.visualOverrides = {};
  state.featureOverrides = {};
  state.sovereignBaseColors = { ...(state.scenarioFixedOwnerColors || {}) };
  state.countryBaseColors = { ...state.sovereignBaseColors };
  markLegacyColorStateDirty();
  state.activeSovereignCode = state.mapSemanticMode === "blank"
    ? ""
    : (
      getScenarioDefaultCountryCode(
        state.activeScenarioManifest,
        state.scenarioCountriesByTag
      ) || String(state.activeSovereignCode || "").trim().toUpperCase()
    );
  if (state.ui && typeof state.ui === "object") {
    state.ui.scenarioVisualAdjustmentsOpen = false;
  }
  const restoredInspectorCode =
    previousSelectedInspectorCountryCode && state.scenarioCountriesByTag?.[previousSelectedInspectorCountryCode]
      ? previousSelectedInspectorCountryCode
      : state.activeSovereignCode;
  state.selectedInspectorCountryCode = restoredInspectorCode;
  state.inspectorHighlightCountryCode = restoredInspectorCode;
  state.expandedInspectorContinents = previousExpandedInspectorContinents;
  state.expandedInspectorReleaseParents = previousExpandedInspectorReleaseParents;
  state.inspectorExpansionInitialized =
    previousInspectorExpansionInitialized || previousExpandedInspectorContinents.size > 0;
  setScenarioAuditUiState({
    loading: false,
    errorMessage: "",
  });
  state.scenarioBorderMode = "scenario_owner_only";
  disableScenarioParentBorders();
  runPostScenarioResetEffects({
    scenarioId: state.activeScenarioId,
    renderNow,
  });
  if (markDirtyReason) {
    markDirty(markDirtyReason);
  }
  if (showToastOnComplete) {
    showToast(t("Scenario reset to baseline.", "ui"), {
      title: t("Scenario reset", "ui"),
      tone: "success",
    });
  }
  return true;
}

function clearActiveScenario(
  {
    renderNow = true,
    markDirtyReason = "scenario-clear",
    showToastOnComplete = false,
  } = {}
) {
  assertScenarioInteractionsAllowed("exit the active scenario");
  const previousScenarioId = normalizeScenarioId(state.activeScenarioId);
  if (state.runtimeChunkLoadState?.refreshTimerId) {
    globalThis.clearTimeout(state.runtimeChunkLoadState.refreshTimerId);
  }
  releaseScenarioAuditPayload(previousScenarioId, { syncUi: false });
  state.activeScenarioId = "";
  state.scenarioBorderMode = "canonical";
  state.activeScenarioManifest = null;
  state.activeScenarioMeshPack = null;
  state.scenarioCountriesByTag = {};
  state.scenarioFixedOwnerColors = {};
  state.scenarioRuntimeTopologyData = null;
  state.scenarioPoliticalChunkData = null;
  state.scenarioLandMaskData = null;
  state.scenarioContextLandMaskData = null;
  state.mapSemanticMode = "blank";
  state.runtimePoliticalTopology = state.defaultRuntimePoliticalTopology || null;
  state.activeScenarioChunks = {
    scenarioId: "",
    loadedChunkIds: [],
    payloadByChunkId: {},
    mergedLayerPayloads: {},
    lruChunkIds: [],
  };
  state.runtimeChunkLoadState = {
    shellStatus: "idle",
    registryStatus: "idle",
    refreshScheduled: false,
    refreshTimerId: null,
    inFlightByChunkId: {},
    errorByChunkId: {},
    lastSelection: null,
  };
  state.scheduleScenarioChunkRefreshFn = null;
  state.scenarioWaterRegionsData = null;
  state.scenarioSpecialRegionsData = null;
  state.scenarioReliefOverlaysData = null;
  state.scenarioDistrictGroupsData = null;
  state.scenarioDistrictGroupByFeatureId = new Map();
  state.scenarioReliefOverlayRevision = (Number(state.scenarioReliefOverlayRevision) || 0) + 1;
  applyBlankScenarioPresentationDefaults();
  state.scenarioReleasableIndex = {
    byTag: {},
    childTagsByParent: {},
    consumedPresetNamesByParentLookup: {},
  };
  state.releasableCatalog = state.defaultReleasableCatalog || null;
  state.scenarioImportAudit = null;
  state.scenarioBaselineHash = "";
  state.scenarioBaselineOwnersByFeatureId = {};
  state.scenarioControllersByFeatureId = {};
  state.scenarioAutoShellOwnerByFeatureId = {};
  state.scenarioAutoShellControllerByFeatureId = {};
  state.scenarioBaselineControllersByFeatureId = {};
  state.scenarioBaselineCoresByFeatureId = {};
  state.scenarioShellOverlayRevision = (Number(state.scenarioShellOverlayRevision) || 0) + 1;
  state.scenarioControllerRevision = (Number(state.scenarioControllerRevision) || 0) + 1;
  state.scenarioOwnerControllerDiffCount = 0;
  state.scenarioDataHealth = {
    expectedFeatureCount: 0,
    runtimeFeatureCount: 0,
    ratio: 1,
    minRatio: SCENARIO_DETAIL_MIN_RATIO_STRICT,
    warning: "",
    severity: "",
  };
  state.scenarioViewMode = "ownership";
  state.countryNames = { ...countryNames };
  state.selectedWaterRegionId = "";
  state.selectedSpecialRegionId = "";
  state.hoveredWaterRegionId = null;
  state.hoveredSpecialRegionId = null;
  state.sovereigntyByFeatureId = {};
  state.scenarioControllersByFeatureId = {};
  state.scenarioAutoShellOwnerByFeatureId = {};
  state.scenarioAutoShellControllerByFeatureId = {};
  state.sovereigntyInitialized = false;
  state.visualOverrides = {};
  state.featureOverrides = {};
  const defaults = syncResolvedDefaultCountryPalette({ overwriteCountryPalette: false });
  state.sovereignBaseColors = { ...(defaults || state.resolvedDefaultCountryPalette || defaultCountryPalette) };
  state.countryBaseColors = { ...state.sovereignBaseColors };
  markLegacyColorStateDirty();
  state.activeSovereignCode = "";
  syncScenarioInspectorSelection("");
  restoreParentBordersAfterScenario();
  restorePaintModeAfterScenario();
  restoreScenarioOceanFillAfterExit();
  restoreScenarioDisplaySettingsAfterExit();
  runPostScenarioClearEffects({ renderNow });
  if (markDirtyReason) {
    markDirty(markDirtyReason);
  }
  if (showToastOnComplete) {
    showToast(t("Scenario cleared.", "ui"), {
      title: t("Scenario cleared", "ui"),
      tone: "success",
    });
  }
}

function formatScenarioStatusText() {
  const fatalState = getScenarioFatalRecoveryState();
  if (fatalState) {
    if (!state.activeScenarioId || !state.activeScenarioManifest) {
      return formatScenarioFatalRecoveryMessage(fatalState);
    }
    const displayName = getScenarioDisplayName(state.activeScenarioManifest, state.activeScenarioId);
    return `${displayName} - ${formatScenarioFatalRecoveryMessage(fatalState)}`;
  }
  if (!state.activeScenarioId || !state.activeScenarioManifest) {
    return t("No scenario active", "ui");
  }
  const displayName = getScenarioDisplayName(state.activeScenarioManifest, state.activeScenarioId);
  const warning = String(state.scenarioDataHealth?.warning || "").trim();
  return warning ? `${displayName} · ${warning}` : displayName;
}

function formatScenarioAuditText() {
  if (getScenarioFatalRecoveryState()) {
    return t("Scenario controls are locked until the page reloads.", "ui");
  }
  if (!state.activeScenarioId || !state.activeScenarioManifest) {
    return "";
  }
  const splitCount = Number(state.activeScenarioManifest?.summary?.owner_controller_split_feature_count || 0);
  if (splitCount > 0) {
    return `${t("Frontline", "ui")}: ${splitCount} split features.`;
  }
  return t("No frontline control split in current scenario.", "ui");
}

export {
  applyScenarioBundle,
  applyScenarioById,
  clearActiveScenario,
  formatScenarioAuditText,
  formatScenarioStatusText,
  getDefaultScenarioId,
  getScenarioDisplayName,
  getScenarioDisplayOwnerByFeatureId,
  getScenarioRegistryEntries,
  normalizeScenarioId,
  normalizeScenarioViewMode,
  resetToScenarioBaseline,
  setScenarioViewMode,
};
