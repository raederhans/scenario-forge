import { countryNames, defaultCountryPalette, state } from "./state.js";
import { ensureSovereigntyState } from "./sovereignty_manager.js";
import { normalizeMapSemanticMode } from "./state.js";
import {
  recomputeDynamicBordersNow,
  refreshColorState,
  refreshMapDataForScenarioChunkPromotion,
  refreshScenarioOpeningOwnerBorders,
  setMapData,
} from "./map_renderer.js";
import {
  buildCityLocalizationPatch,
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
import { setActivePaletteSource, syncResolvedDefaultCountryPalette } from "./palette_manager.js";
import { markDirty } from "./dirty_state.js";
import {
  buildScenarioReleasableIndex,
  getScenarioReleasableCountries,
  rebuildPresetState,
} from "./releasable_manager.js";
import { t } from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";

const SCENARIO_REGISTRY_URL = "data/scenarios/index.json";
const DETAIL_POLITICAL_MIN_FEATURES = 1000;
const SCENARIO_DETAIL_MIN_RATIO_STRICT = 0.7;
const SCENARIO_DETAIL_ABSOLUTE_DROP_THRESHOLD = 1000;
const DEFAULT_OCEAN_FILL_COLOR = "#aadaff";
const SCENARIO_RENDER_PROFILES = new Set(["auto", "balanced", "full"]);
const SCENARIO_BUNDLE_LEVELS = new Set(["bootstrap", "full"]);
const SCENARIO_LOAD_TIMEOUT_MS = 12_000;
const SCENARIO_DETAIL_SOURCE_FALLBACK_ORDER = ["na_v2", "na_v1", "legacy_bak", "highres"];
const SCENARIO_FATAL_RECOVERY_CODE = "SCENARIO_FATAL_RECOVERY";
const SCENARIO_CHUNK_REFRESH_DELAY_MS_INTERACTING = 180;
const SCENARIO_CHUNK_REFRESH_DELAY_MS_IDLE = 60;
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

function canonicalScenarioCountryCode(rawCode) {
  return normalizeCountryCodeAlias(rawCode);
}

function extractScenarioCountryCodeFromId(value) {
  const text = String(value || "").trim().toUpperCase();
  if (!text) return "";
  const prefix = text.split(/[-_]/)[0];
  if (/^[A-Z]{2,3}$/.test(prefix)) {
    return prefix;
  }
  const alphaPrefix = prefix.match(/^[A-Z]{2,3}/);
  return alphaPrefix ? alphaPrefix[0] : "";
}

function getScenarioRuntimeGeometryCountryCode(geometry) {
  const props = geometry?.properties || {};
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
  const normalizedDirect = canonicalScenarioCountryCode(direct);
  if (/^[A-Z]{2,3}$/.test(normalizedDirect) && normalizedDirect !== "ZZ" && normalizedDirect !== "XX") {
    return normalizedDirect;
  }
  return canonicalScenarioCountryCode(
    extractScenarioCountryCodeFromId(props.id) ||
    extractScenarioCountryCodeFromId(props.NUTS_ID) ||
    extractScenarioCountryCodeFromId(geometry?.id)
  );
}

function shouldApplyHoi4FarEastSovietBackfill(scenarioId) {
  const normalizedId = normalizeScenarioId(scenarioId);
  return normalizedId === "hoi4_1936" || normalizedId === "hoi4_1939";
}

function hasExplicitScenarioAssignment(featureMap, featureId) {
  return !!(
    featureMap &&
    typeof featureMap === "object" &&
    Object.prototype.hasOwnProperty.call(featureMap, featureId)
  );
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

function getPoliticalGeometryCount(topology) {
  const geometries = topology?.objects?.political?.geometries;
  return Array.isArray(geometries) ? geometries.length : 0;
}

function hasUsablePoliticalTopology(topology, { minFeatures = DETAIL_POLITICAL_MIN_FEATURES } = {}) {
  return getPoliticalGeometryCount(topology) >= Math.max(1, Number(minFeatures) || 1);
}

function countOwnerControllerSplit({
  ownersByFeatureId = state.sovereigntyByFeatureId || {},
  controllersByFeatureId = state.scenarioControllersByFeatureId || {},
} = {}) {
  let split = 0;
  const seen = new Set();
  Object.entries(ownersByFeatureId || {}).forEach(([featureId, owner]) => {
    const normalizedId = String(featureId || "").trim();
    if (!normalizedId) return;
    seen.add(normalizedId);
    const ownerTag = String(owner || "").trim().toUpperCase();
    const controllerTag = String(controllersByFeatureId?.[normalizedId] || ownerTag || "").trim().toUpperCase();
    if (ownerTag && controllerTag && ownerTag !== controllerTag) {
      split += 1;
    }
  });
  Object.entries(controllersByFeatureId || {}).forEach(([featureId, controller]) => {
    const normalizedId = String(featureId || "").trim();
    if (!normalizedId || seen.has(normalizedId)) return;
    const controllerTag = String(controller || "").trim().toUpperCase();
    const ownerTag = String(ownersByFeatureId?.[normalizedId] || controllerTag || "").trim().toUpperCase();
    if (ownerTag && controllerTag && ownerTag !== controllerTag) {
      split += 1;
    }
  });
  return split;
}

function recalculateScenarioOwnerControllerDiffCount() {
  state.scenarioOwnerControllerDiffCount = state.activeScenarioId
    ? countOwnerControllerSplit({
      ownersByFeatureId: state.sovereigntyByFeatureId,
      controllersByFeatureId: state.scenarioControllersByFeatureId,
    })
    : 0;
  return state.scenarioOwnerControllerDiffCount;
}

function evaluateScenarioDataHealth(
  manifest = state.activeScenarioManifest,
  { minRatio = SCENARIO_DETAIL_MIN_RATIO_STRICT } = {}
) {
  const expectedFeatureCount = Number(manifest?.summary?.feature_count || 0);
  const runtimeFeatureCount = Array.isArray(state.landData?.features) ? state.landData.features.length : 0;
  const ratio = expectedFeatureCount > 0 ? runtimeFeatureCount / expectedFeatureCount : 1;
  const normalizedMinRatio = Math.min(Math.max(Number(minRatio) || SCENARIO_DETAIL_MIN_RATIO_STRICT, 0.1), 1);
  let warning = "";
  let severity = "";
  if (expectedFeatureCount >= DETAIL_POLITICAL_MIN_FEATURES) {
    const severeDrop = runtimeFeatureCount > 0 && ratio < normalizedMinRatio;
    const absoluteDrop = expectedFeatureCount - runtimeFeatureCount >= SCENARIO_DETAIL_ABSOLUTE_DROP_THRESHOLD;
    if (severeDrop && absoluteDrop) {
      warning = t("Detail topology not fully loaded; scenario is shown in coarse mode.", "ui");
      severity = "error";
    }
  }
  return {
    expectedFeatureCount,
    runtimeFeatureCount,
    ratio,
    minRatio: normalizedMinRatio,
    warning,
    severity,
  };
}

function scenarioNeedsDetailTopology(manifest = state.activeScenarioManifest) {
  return Number(manifest?.summary?.feature_count || 0) >= DETAIL_POLITICAL_MIN_FEATURES;
}

function refreshScenarioDataHealth({
  showWarningToast = false,
  showErrorToast = false,
  minRatio = SCENARIO_DETAIL_MIN_RATIO_STRICT,
} = {}) {
  if (!state.activeScenarioId || !state.activeScenarioManifest) {
    state.scenarioDataHealth = {
      expectedFeatureCount: 0,
      runtimeFeatureCount: 0,
      ratio: 1,
      minRatio: SCENARIO_DETAIL_MIN_RATIO_STRICT,
      warning: "",
      severity: "",
    };
    return state.scenarioDataHealth;
  }
  const health = evaluateScenarioDataHealth(state.activeScenarioManifest, { minRatio });
  state.scenarioDataHealth = health;
  const shouldToast = health.warning && (showErrorToast || showWarningToast);
  if (shouldToast) {
    const errorLevel = showErrorToast || health.severity === "error";
    showToast(health.warning, {
      title: errorLevel
        ? t("Scenario visibility error", "ui")
        : t("Scenario visibility warning", "ui"),
      tone: errorLevel ? "error" : "warning",
      duration: errorLevel ? 6200 : 5200,
    });
  }
  return health;
}

function getRuntimeGeometryFeatureId(geometry) {
  const props = geometry?.properties || {};
  return String(props.id || geometry?.id || "").trim();
}

function getRuntimeGeometryFeatureName(geometry) {
  const props = geometry?.properties || {};
  return String(props.name || props.NAME || "").trim();
}

function isScenarioShellCandidate(featureId, featureName = "") {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return false;
  if (normalizedId.toUpperCase().startsWith("RU_ARCTIC_FB_")) return true;
  return String(featureName || "").toLowerCase().includes("shell fallback");
}

function isScenarioShellOverlayEnabled() {
  return !!state.runtimePoliticalTopology?.objects?.political;
}

function getScenarioEffectiveOwnerCodeByFeatureId(featureId) {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return "";
  return String(
    state.sovereigntyByFeatureId?.[normalizedId]
    || state.runtimeCanonicalCountryByFeatureId?.[normalizedId]
    || ""
  ).trim().toUpperCase();
}

function getScenarioEffectiveControllerCodeByFeatureId(featureId) {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return "";
  return String(
    state.scenarioControllersByFeatureId?.[normalizedId]
    || getScenarioEffectiveOwnerCodeByFeatureId(normalizedId)
    || ""
  ).trim().toUpperCase();
}

function getScenarioRuntimeNeighborGraph(geometries) {
  const runtimeGraph = Array.isArray(state.runtimeNeighborGraph) ? state.runtimeNeighborGraph : [];
  const hasPopulatedNeighbors = runtimeGraph.some((neighbors) => Array.isArray(neighbors) && neighbors.length > 0);
  if (runtimeGraph.length === geometries.length && hasPopulatedNeighbors) {
    return runtimeGraph.map((neighbors) => (Array.isArray(neighbors) ? neighbors : []));
  }
  if (typeof globalThis.topojson?.neighbors === "function") {
    try {
      const fallback = globalThis.topojson.neighbors(geometries);
      if (Array.isArray(fallback) && fallback.length === geometries.length) {
        return fallback.map((neighbors) => (Array.isArray(neighbors) ? neighbors : []));
      }
    } catch (error) {
      console.warn("[scenario] Failed to derive fallback runtime neighbors for shell overlays:", error);
    }
  }
  return new Array(geometries.length).fill(null).map(() => []);
}

function haveSameScenarioShellMapping(previousMap, nextMap) {
  const previousKeys = Object.keys(previousMap || {});
  const nextKeys = Object.keys(nextMap || {});
  if (previousKeys.length !== nextKeys.length) return false;
  for (const key of previousKeys) {
    if (String(previousMap?.[key] || "") !== String(nextMap?.[key] || "")) {
      return false;
    }
  }
  return true;
}

function incrementScenarioCodeVote(counterMap, code) {
  const normalizedCode = canonicalScenarioCountryCode(code);
  if (!normalizedCode) return;
  counterMap.set(normalizedCode, (counterMap.get(normalizedCode) || 0) + 1);
}

function pickScenarioMajorityCode(counterMap) {
  if (!(counterMap instanceof Map) || !counterMap.size) return "";
  const ranked = Array.from(counterMap.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return String(a[0]).localeCompare(String(b[0]));
  });
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    return "";
  }
  return String(ranked[0]?.[0] || "").trim().toUpperCase();
}

function buildScenarioCanonicalFallbackMaps(geometries) {
  const ownerVotesByCountry = new Map();
  const controllerVotesByCountry = new Map();

  geometries.forEach((geometry) => {
    const featureId = getRuntimeGeometryFeatureId(geometry);
    const featureName = getRuntimeGeometryFeatureName(geometry);
    if (!featureId || isScenarioShellCandidate(featureId, featureName)) return;
    const countryCode = getScenarioRuntimeGeometryCountryCode(geometry);
    if (!countryCode) return;

    const ownerCode = getScenarioEffectiveOwnerCodeByFeatureId(featureId);
    const controllerCode = getScenarioEffectiveControllerCodeByFeatureId(featureId);

    if (ownerCode) {
      let counter = ownerVotesByCountry.get(countryCode);
      if (!counter) {
        counter = new Map();
        ownerVotesByCountry.set(countryCode, counter);
      }
      incrementScenarioCodeVote(counter, ownerCode);
    }

    if (controllerCode) {
      let counter = controllerVotesByCountry.get(countryCode);
      if (!counter) {
        counter = new Map();
        controllerVotesByCountry.set(countryCode, counter);
      }
      incrementScenarioCodeVote(counter, controllerCode);
    }
  });

  const ownerFallbackByCountry = {};
  ownerVotesByCountry.forEach((counter, countryCode) => {
    const winner = pickScenarioMajorityCode(counter);
    if (winner) ownerFallbackByCountry[countryCode] = winner;
  });

  const controllerFallbackByCountry = {};
  controllerVotesByCountry.forEach((counter, countryCode) => {
    const winner = pickScenarioMajorityCode(counter);
    if (winner) controllerFallbackByCountry[countryCode] = winner;
  });

  return {
    ownerFallbackByCountry,
    controllerFallbackByCountry,
  };
}

function refreshScenarioShellOverlays({ renderNow = false, borderReason = "scenario-shell-overlay" } = {}) {
  const previousOwnerMap = state.scenarioAutoShellOwnerByFeatureId || {};
  const previousControllerMap = state.scenarioAutoShellControllerByFeatureId || {};
  let nextOwnerMap = {};
  let nextControllerMap = {};

  if (state.activeScenarioId && isScenarioShellOverlayEnabled()) {
    const geometries = state.runtimePoliticalTopology?.objects?.political?.geometries || [];
    if (Array.isArray(geometries) && geometries.length) {
      const neighborGraph = getScenarioRuntimeNeighborGraph(geometries);
      const {
        ownerFallbackByCountry,
        controllerFallbackByCountry,
      } = buildScenarioCanonicalFallbackMaps(geometries);
      geometries.forEach((geometry, index) => {
        const featureId = getRuntimeGeometryFeatureId(geometry);
        const featureName = getRuntimeGeometryFeatureName(geometry);
        if (!isScenarioShellCandidate(featureId, featureName)) return;
        const neighborIndexes = Array.isArray(neighborGraph[index]) ? neighborGraph[index] : [];
        const ownerVotes = new Map();
        const controllerVotes = new Map();
        neighborIndexes.forEach((neighborIndex) => {
          const neighborGeometry = geometries[neighborIndex];
          const neighborId = getRuntimeGeometryFeatureId(neighborGeometry);
          const neighborName = getRuntimeGeometryFeatureName(neighborGeometry);
          if (!neighborId || isScenarioShellCandidate(neighborId, neighborName)) {
            return;
          }
          const ownerCode = getScenarioEffectiveOwnerCodeByFeatureId(neighborId);
          const controllerCode = getScenarioEffectiveControllerCodeByFeatureId(neighborId);
          incrementScenarioCodeVote(ownerVotes, ownerCode);
          incrementScenarioCodeVote(controllerVotes, controllerCode);
        });

        const canonicalCountryCode = getScenarioRuntimeGeometryCountryCode(geometry);
        const directOwnerCode = canonicalScenarioCountryCode(state.sovereigntyByFeatureId?.[featureId] || "");
        const directControllerCode = canonicalScenarioCountryCode(state.scenarioControllersByFeatureId?.[featureId] || "");
        const resolvedOwnerCode =
          directOwnerCode
          || pickScenarioMajorityCode(ownerVotes)
          || ownerFallbackByCountry[canonicalCountryCode]
          || "";
        const resolvedControllerCode =
          directControllerCode
          || pickScenarioMajorityCode(controllerVotes)
          || controllerFallbackByCountry[canonicalCountryCode]
          || resolvedOwnerCode
          || "";

        if (resolvedOwnerCode) {
          nextOwnerMap[featureId] = resolvedOwnerCode;
        }
        if (resolvedControllerCode) {
          nextControllerMap[featureId] = resolvedControllerCode;
        }
      });
    }
  }

  const changed =
    !haveSameScenarioShellMapping(previousOwnerMap, nextOwnerMap)
    || !haveSameScenarioShellMapping(previousControllerMap, nextControllerMap);

  state.scenarioAutoShellOwnerByFeatureId = nextOwnerMap;
  state.scenarioAutoShellControllerByFeatureId = nextControllerMap;
  if (changed) {
    state.scenarioShellOverlayRevision = (Number(state.scenarioShellOverlayRevision) || 0) + 1;
  }
  refreshColorState({ renderNow: false });
  recomputeDynamicBordersNow({ renderNow: false, reason: borderReason });
  refreshScenarioOpeningOwnerBorders({
    renderNow: false,
    reason: borderReason ? `${borderReason}:opening` : "scenario-shell-opening",
  });
  if (renderNow && typeof state.renderNowFn === "function") {
    state.renderNowFn();
  }
  return {
    changed,
    ownerCount: Object.keys(nextOwnerMap).length,
    controllerCount: Object.keys(nextControllerMap).length,
  };
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
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available for scenario registry loading.");
  }
  const registry = await loadScenarioJsonWithTimeout(d3Client, SCENARIO_REGISTRY_URL, {
    resourceLabel: "scenario_registry",
  });
  state.scenarioRegistry = registry || { version: 1, default_scenario_id: "", scenarios: [] };
  return state.scenarioRegistry;
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

function getScenarioTestHooks() {
  return globalThis.__scenarioTestHooks && typeof globalThis.__scenarioTestHooks === "object"
    ? globalThis.__scenarioTestHooks
    : null;
}

function consumeScenarioTestHook(name) {
  const hooks = getScenarioTestHooks();
  if (!hooks || !hooks[name]) return false;
  delete hooks[name];
  return true;
}

function getScenarioFatalRecoveryState() {
  return state.scenarioFatalRecovery && typeof state.scenarioFatalRecovery === "object"
    ? state.scenarioFatalRecovery
    : null;
}

function clearScenarioFatalRecoveryState() {
  state.scenarioFatalRecovery = null;
}

function formatScenarioFatalRecoveryMessage(fatalState = getScenarioFatalRecoveryState()) {
  const baseMessage = t("Scenario state is inconsistent. Reload the page before continuing.", "ui");
  const detail = String(fatalState?.message || "").trim();
  return detail ? `${baseMessage} ${detail}` : baseMessage;
}

function buildScenarioFatalRecoveryError(actionLabel = "complete this scenario action") {
  const message = formatScenarioFatalRecoveryMessage();
  const error = new Error(message);
  error.code = SCENARIO_FATAL_RECOVERY_CODE;
  error.toastTitle = t("Scenario locked", "ui");
  error.toastTone = "error";
  error.userMessage = message;
  error.actionLabel = actionLabel;
  return error;
}

function validateScenarioRuntimeConsistency({ expectedScenarioId = "", phase = "apply" } = {}) {
  const problems = [];
  const activeScenarioId = normalizeScenarioId(state.activeScenarioId);
  const manifestScenarioId = normalizeScenarioId(state.activeScenarioManifest?.scenario_id);
  const normalizedExpectedScenarioId = normalizeScenarioId(expectedScenarioId);
  const mapSemanticMode = normalizeMapSemanticMode(state.mapSemanticMode);
  const requiredObjects = [
    ["sovereigntyByFeatureId", state.sovereigntyByFeatureId],
    ["scenarioControllersByFeatureId", state.scenarioControllersByFeatureId],
    ["scenarioBaselineOwnersByFeatureId", state.scenarioBaselineOwnersByFeatureId],
    ["scenarioBaselineControllersByFeatureId", state.scenarioBaselineControllersByFeatureId],
  ];

  if (normalizedExpectedScenarioId && activeScenarioId !== normalizedExpectedScenarioId) {
    problems.push(
      `active scenario id mismatch (${activeScenarioId || "none"} != ${normalizedExpectedScenarioId}).`
    );
  }
  if (activeScenarioId && manifestScenarioId !== activeScenarioId) {
    problems.push(
      `manifest scenario id mismatch (${manifestScenarioId || "none"} != ${activeScenarioId}).`
    );
  }
  if (activeScenarioId && !String(state.scenarioBaselineHash || "").trim()) {
    problems.push("scenarioBaselineHash is empty while a scenario is active.");
  }
  requiredObjects.forEach(([fieldName, value]) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      problems.push(`${fieldName} must be a plain object while a scenario is active.`);
    }
  });

  const sampleFeatureId =
    Object.keys(state.scenarioBaselineOwnersByFeatureId || {}).find(Boolean)
    || Object.keys(state.sovereigntyByFeatureId || {}).find(Boolean)
    || Object.keys(state.scenarioBaselineControllersByFeatureId || {}).find(Boolean)
    || Object.keys(state.scenarioControllersByFeatureId || {}).find(Boolean)
    || "";
  if (activeScenarioId && !sampleFeatureId && mapSemanticMode !== "blank") {
    problems.push("No feature assignments are available in the active scenario state.");
  } else if (sampleFeatureId) {
    if (!getScenarioEffectiveOwnerCodeByFeatureId(sampleFeatureId)) {
      problems.push(`Effective owner lookup failed for ${sampleFeatureId}.`);
    }
    if (!getScenarioEffectiveControllerCodeByFeatureId(sampleFeatureId)) {
      problems.push(`Effective controller lookup failed for ${sampleFeatureId}.`);
    }
  }

  const forcedFailureHookName =
    phase === "rollback" ? "forceRollbackConsistencyFailureOnce" : "forceApplyConsistencyFailureOnce";
  if (consumeScenarioTestHook(forcedFailureHookName)) {
    problems.push(`Injected ${phase} consistency failure.`);
  }

  return {
    ok: problems.length === 0,
    problems,
    activeScenarioId,
    manifestScenarioId,
    expectedScenarioId: normalizedExpectedScenarioId,
    phase,
  };
}

function enterScenarioFatalRecovery({
  phase = "rollback",
  rootError = null,
  rollbackError = null,
  consistencyReport = null,
} = {}) {
  const problemSummary = Array.isArray(consistencyReport?.problems) && consistencyReport.problems.length
    ? consistencyReport.problems.slice(0, 3).join(" ")
    : "";
  const detail = rollbackError
    ? t("Rollback recovery failed.", "ui")
    : problemSummary || t("Rollback validation failed.", "ui");
  state.scenarioFatalRecovery = {
    phase: String(phase || "rollback"),
    message: detail,
    recordedAt: new Date().toISOString(),
    problems: Array.isArray(consistencyReport?.problems) ? [...consistencyReport.problems] : [],
    rootErrorMessage: String(rootError?.message || "").trim(),
    rollbackErrorMessage: String(rollbackError?.message || "").trim(),
  };
  showToast(formatScenarioFatalRecoveryMessage(state.scenarioFatalRecovery), {
    title: t("Scenario recovery failed", "ui"),
    tone: "error",
    duration: 7000,
  });
  syncScenarioUi();
  return state.scenarioFatalRecovery;
}

function assertScenarioInteractionsAllowed(actionLabel = "complete this scenario action") {
  assertStartupReadonlyUnlocked(actionLabel);
  if (!getScenarioFatalRecoveryState()) return;
  throw buildScenarioFatalRecoveryError(actionLabel);
}

function assertStartupReadonlyUnlocked(actionLabel = "complete this startup action") {
  if (!state.startupReadonly) return;
  throw new Error(
    `Detailed interactions are still loading. Unable to ${actionLabel} while the startup view is read-only.`
  );
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
    const nextPayload = mergedLayerPayloads?.[layerKey] || null;
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
  if (changed && renderNow && typeof state.renderNowFn === "function") {
    state.renderNowFn();
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
  if (bundle) {
    bundle.chunkMergedLayerPayloads = bundle.chunkMergedLayerPayloads && typeof bundle.chunkMergedLayerPayloads === "object"
      ? bundle.chunkMergedLayerPayloads
      : {};
    bundle.chunkMergedLayerPayloads.political = normalizedPayload || null;
  }
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
  const layerKeys = new Set([
    ...Object.keys(SCENARIO_OPTIONAL_LAYER_CONFIGS),
    ...Object.keys(bundle?.chunkRegistry?.byLayer || {}),
  ]);
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
  bundle.chunkMergedLayerPayloads = mergedLayerPayloads;
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
  if (bundle.chunkPreloaded === true) {
    return bundle.chunkMergedLayerPayloads || null;
  }
  bundle.chunkPayloadCacheById = bundle.chunkPayloadCacheById && typeof bundle.chunkPayloadCacheById === "object"
    ? bundle.chunkPayloadCacheById
    : {};
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
    coarseSelection.requiredChunks.map(async (chunk) => {
      if (bundle.chunkPayloadCacheById?.[chunk.id]) return;
      const result = await loadScenarioChunkFile(chunk.url, {
        d3Client,
        scenarioId: getScenarioBundleId(bundle),
        resourceLabel: `chunk:${chunk.layer}:${chunk.id}`,
      });
      bundle.chunkPayloadCacheById[chunk.id] = {
        layerKey: chunk.layer,
        payload: result?.payload || null,
      };
    })
  );
  bundle.chunkMergedLayerPayloads = {};
  Object.keys(SCENARIO_OPTIONAL_LAYER_CONFIGS).forEach((layerKey) => {
    const layerPayloads = coarseSelection.requiredChunks
      .filter((chunk) => chunk.layer === layerKey)
      .map((chunk) => bundle.chunkPayloadCacheById?.[chunk.id]?.payload || null)
      .filter(Boolean);
    bundle.chunkMergedLayerPayloads[layerKey] = layerPayloads.length
      ? mergeScenarioChunkPayloads(layerKey, layerPayloads)
      : null;
  });
  bundle.chunkPreloaded = true;
  return bundle.chunkMergedLayerPayloads;
}

async function loadScenarioChunkPayload(bundle, chunkMeta, { d3Client = globalThis.d3 } = {}) {
  const normalizedChunkId = String(chunkMeta?.id || "").trim();
  if (!bundle || !normalizedChunkId) return null;
  bundle.chunkPayloadCacheById = bundle.chunkPayloadCacheById && typeof bundle.chunkPayloadCacheById === "object"
    ? bundle.chunkPayloadCacheById
    : {};
  if (bundle.chunkPayloadCacheById[normalizedChunkId]) {
    return bundle.chunkPayloadCacheById[normalizedChunkId];
  }
  const loadState = ensureRuntimeChunkLoadState();
  loadState.inFlightByChunkId[normalizedChunkId] = true;
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
    bundle.chunkPayloadCacheById[normalizedChunkId] = payload;
    delete loadState.errorByChunkId[normalizedChunkId];
    return payload;
  } catch (error) {
    loadState.errorByChunkId[normalizedChunkId] = String(error?.message || error || "Unknown chunk load error.");
    throw error;
  } finally {
    delete loadState.inFlightByChunkId[normalizedChunkId];
  }
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

function getScenarioOverrideLocaleEntry(overrideEntry) {
  const displayName = overrideEntry?.display_name && typeof overrideEntry.display_name === "object"
    ? overrideEntry.display_name
    : {};
  const en = normalizeCityText(displayName.en || overrideEntry?.name_en || overrideEntry?.name || "");
  const zh = normalizeCityText(displayName.zh || overrideEntry?.name_zh || "");
  if (!en && !zh) return null;
  return {
    en: en || zh,
    zh: zh || en,
  };
}

function getScenarioOverrideSourceCityFeature(overrideEntry) {
  const features = Array.isArray(state.worldCitiesData?.features) ? state.worldCitiesData.features : [];
  if (!features.length) return null;
  const candidates = new Set([
    normalizeCityText(overrideEntry?.city_id),
    normalizeCityText(overrideEntry?.stable_key),
  ].filter(Boolean));
  if (!candidates.size) return null;
  return features.find((feature) => {
    const props = feature?.properties || {};
    return candidates.has(normalizeCityText(props.__city_id || props.id || feature?.id))
      || candidates.has(normalizeCityText(props.__city_stable_key || props.stable_key));
  }) || null;
}

function getFeaturePointCoordinates(feature) {
  const geometry = feature?.geometry;
  if (!geometry) return null;
  if (geometry.type === "Point" && Array.isArray(geometry.coordinates) && geometry.coordinates.length >= 2) {
    return geometry.coordinates;
  }
  if (geometry.type === "MultiPoint" && Array.isArray(geometry.coordinates) && geometry.coordinates[0]?.length >= 2) {
    return geometry.coordinates[0];
  }
  return null;
}

function getAngularDistanceDegrees(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length < 2 || right.length < 2) {
    return Number.POSITIVE_INFINITY;
  }
  const avgLatRad = (((Number(left[1]) || 0) + ((Number(right[1]) || 0))) * 0.5) * (Math.PI / 180);
  const dx = ((Number(left[0]) || 0) - (Number(right[0]) || 0)) * Math.cos(avgLatRad);
  const dy = (Number(left[1]) || 0) - (Number(right[1]) || 0);
  return Math.hypot(dx, dy);
}

function resolveScenarioGeoFeatureIdForCityFeature(cityFeature) {
  const point = getFeaturePointCoordinates(cityFeature);
  const overrideFeatures = Array.isArray(state.ruCityOverrides?.features) ? state.ruCityOverrides.features : [];
  if (!point || !overrideFeatures.length) return "";

  const geoContains = globalThis.d3?.geoContains;
  const geoCentroid = globalThis.d3?.geoCentroid;
  let nearestId = "";
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const feature of overrideFeatures) {
    const featureId = normalizeCityText(feature?.properties?.id || feature?.id);
    if (!featureId || !feature?.geometry) continue;
    try {
      if (typeof geoContains === "function" && geoContains(feature, point)) {
        return featureId;
      }
    } catch (_error) {
      // Ignore invalid geometries and fall back to centroid proximity.
    }
    try {
      if (typeof geoCentroid !== "function") continue;
      const centroid = geoCentroid(feature);
      const distance = getAngularDistanceDegrees(point, centroid);
      if (distance < nearestDistance) {
        nearestDistance = distance;
        nearestId = featureId;
      }
    } catch (_error) {
      // Ignore centroid failures for malformed features.
    }
  }

  return nearestDistance <= 1.5 ? nearestId : "";
}

function buildScenarioCityNameSyncPatch({ baseGeoLocales = {}, scenarioGeoPatch = {} } = {}) {
  const geo = {};
  const conflicts = [];
  let preservedExplicitPatchCount = 0;
  const overrideEntries = Object.values(state.scenarioCityOverridesData?.cities || {});

  overrideEntries.forEach((overrideEntry) => {
    const localeEntry = getScenarioOverrideLocaleEntry(overrideEntry);
    if (!localeEntry?.en && !localeEntry?.zh) return;
    const sourceFeature = getScenarioOverrideSourceCityFeature(overrideEntry);
    if (!sourceFeature) return;

    const sourceProps = sourceFeature?.properties || {};
    const targetIds = new Set([
      normalizeCityText(sourceProps.__city_host_feature_id || sourceProps.host_feature_id),
      resolveScenarioGeoFeatureIdForCityFeature(sourceFeature),
    ].filter(Boolean));

    targetIds.forEach((targetId) => {
      const explicitPatchEntry = scenarioGeoPatch[targetId] || null;
      if (explicitPatchEntry) {
        const explicitEn = normalizeCityText(explicitPatchEntry?.en || "");
        const explicitZh = normalizeCityText(explicitPatchEntry?.zh || "");
        if (explicitEn !== localeEntry.en || explicitZh !== localeEntry.zh) {
          preservedExplicitPatchCount += 1;
        }
        return;
      }

      const existingEntry = baseGeoLocales[targetId] || null;
      const existingEn = normalizeCityText(existingEntry?.en || "");
      const existingZh = normalizeCityText(existingEntry?.zh || "");
      if (existingEn === localeEntry.en && existingZh === localeEntry.zh) {
        return;
      }
      geo[targetId] = { ...localeEntry };
      conflicts.push({
        targetId,
        previous: existingEntry,
        next: localeEntry,
      });
    });
  });

  return { geo, conflicts, preservedExplicitPatchCount };
}

function applyScenarioGeoLocalization() {
  const baseGeoLocales = state.baseGeoLocales && typeof state.baseGeoLocales === "object"
    ? state.baseGeoLocales
    : {};
  const baseAliasMap = state.baseGeoAliasToStableKey && typeof state.baseGeoAliasToStableKey === "object"
    ? state.baseGeoAliasToStableKey
    : {};
  const scenarioGeoPatch = state.scenarioGeoLocalePatchData?.geo
    && typeof state.scenarioGeoLocalePatchData.geo === "object"
    ? state.scenarioGeoLocalePatchData.geo
    : {};
  const overrideEntries = Object.values(state.scenarioCityOverridesData?.cities || {});
  const patch = buildCityLocalizationPatch({
    cityCollection: state.scenarioCityOverridesData?.featureCollection || null,
    cityAliases: { cities: overrideEntries },
  });
  const synchronizedNamePatch = buildScenarioCityNameSyncPatch({
    baseGeoLocales,
    scenarioGeoPatch,
  });
  if (!state.locales || typeof state.locales !== "object") {
    state.locales = { ui: {}, geo: {} };
  }
  state.locales.geo = {
    ...baseGeoLocales,
    ...patch.geo,
    ...synchronizedNamePatch.geo,
    ...scenarioGeoPatch,
  };
  state.geoAliasToStableKey = {
    ...baseAliasMap,
    ...patch.aliasToStableKey,
  };
  if (synchronizedNamePatch.conflicts.length > 0) {
    const preservedSuffix = synchronizedNamePatch.preservedExplicitPatchCount > 0
      ? ` Preserved ${synchronizedNamePatch.preservedExplicitPatchCount} explicit scenario patch override${synchronizedNamePatch.preservedExplicitPatchCount === 1 ? "" : "s"}.`
      : "";
    console.info(
      `[scenario] Synchronized ${synchronizedNamePatch.conflicts.length} geo locale entr${synchronizedNamePatch.conflicts.length === 1 ? "y" : "ies"} from scenario city overrides.${preservedSuffix}`
    );
  }
}

function getScenarioDecodedCollection(bundle, collectionKey) {
  const decodedCollections = bundle?.runtimeDecodedCollections;
  const collection = decodedCollections?.[collectionKey];
  return Array.isArray(collection?.features) ? collection : null;
}

function syncScenarioLocalizationState({
  cityOverridesPayload = state.scenarioCityOverridesData,
  geoLocalePatchPayload = state.scenarioGeoLocalePatchData,
} = {}) {
  state.scenarioCityOverridesData = cityOverridesPayload || null;
  state.scenarioGeoLocalePatchData = geoLocalePatchPayload || null;
  state.cityLayerRevision = (Number(state.cityLayerRevision) || 0) + 1;
  applyScenarioGeoLocalization();
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
  if (!bundle || !manifest) return;
  bundle.optionalLayerPromises = bundle.optionalLayerPromises && typeof bundle.optionalLayerPromises === "object"
    ? bundle.optionalLayerPromises
    : {};
  bundle.optionalLayerSettledByKey = bundle.optionalLayerSettledByKey
    && typeof bundle.optionalLayerSettledByKey === "object"
    ? bundle.optionalLayerSettledByKey
    : {};
  Object.keys(SCENARIO_OPTIONAL_LAYER_CONFIGS)
    .filter((layerKey) => shouldEagerLoadScenarioOptionalLayer(layerKey, manifest, runtimeTopologyPayload, hints))
    .forEach((layerKey) => {
      if (bundle.optionalLayerSettledByKey[layerKey] === true || bundle.optionalLayerPromises[layerKey]) {
        return;
      }
      loadScenarioOptionalLayerPayload(bundle, layerKey, { d3Client }).catch((error) => {
        console.warn(
          `[scenario] Failed to prewarm optional layer "${layerKey}" for "${getScenarioBundleId(bundle)}".`,
          error
        );
      });
    });
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
  if (renderNow && typeof state.renderNowFn === "function") {
    state.renderNowFn();
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
  if (renderNow && typeof state.renderNowFn === "function") {
    state.renderNowFn();
  }
  return payloads;
}

function ensureScenarioAuditUiState() {
  if (!state.scenarioAuditUi || typeof state.scenarioAuditUi !== "object") {
    state.scenarioAuditUi = {
      loading: false,
      loadedForScenarioId: "",
      errorMessage: "",
    };
  }
  if (typeof state.scenarioAuditUi.loading !== "boolean") {
    state.scenarioAuditUi.loading = false;
  }
  if (typeof state.scenarioAuditUi.loadedForScenarioId !== "string") {
    state.scenarioAuditUi.loadedForScenarioId = "";
  }
  if (typeof state.scenarioAuditUi.errorMessage !== "string") {
    state.scenarioAuditUi.errorMessage = "";
  }
  return state.scenarioAuditUi;
}

function setScenarioAuditUiState(partial = {}) {
  const current = ensureScenarioAuditUiState();
  Object.assign(current, partial);
  return current;
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
    chunkMergedLayerPayloads: priorBundle?.chunkMergedLayerPayloads || null,
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
  if (runtimeTopologyPayload) {
    state.scenarioRuntimeTopologyData = runtimeTopologyPayload;
    state.runtimePoliticalTopology = runtimeTopologyPayload?.objects?.political
      ? runtimeTopologyPayload
      : (state.defaultRuntimePoliticalTopology || state.runtimePoliticalTopology || null);
    state.runtimePoliticalMetaSeed = bundle.runtimePoliticalMeta || null;
    state.runtimePoliticalFeatureCollectionSeed = getScenarioDecodedCollection(bundle, "politicalData") || null;
    state.scenarioLandMaskData =
      getScenarioDecodedCollection(bundle, "scenarioLandMaskData")
      || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "land_mask")
      || state.scenarioLandMaskData
      || null;
    state.scenarioContextLandMaskData =
      getScenarioDecodedCollection(bundle, "scenarioContextLandMaskData")
      || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "context_land_mask")
      || state.scenarioContextLandMaskData
      || null;
    state.scenarioWaterRegionsData =
      bundle.chunkMergedLayerPayloads?.water
      || bundle.waterRegionsPayload
      || getScenarioDecodedCollection(bundle, "scenarioWaterRegionsData")
      || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_water")
      || state.scenarioWaterRegionsData
      || null;
    state.scenarioSpecialRegionsData =
      bundle.chunkMergedLayerPayloads?.special
      || getScenarioDecodedCollection(bundle, "scenarioSpecialRegionsData")
      || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_special_land")
        || bundle.specialRegionsPayload
        || state.scenarioSpecialRegionsData
        || null;
  }
  state.scenarioPoliticalChunkData = normalizeScenarioFeatureCollection(bundle.chunkMergedLayerPayloads?.political) || null;
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
  state.scenarioReliefOverlaysData = bundle.chunkMergedLayerPayloads?.relief || bundle.reliefOverlaysPayload || state.scenarioReliefOverlaysData || null;
  if (bundle.chunkMergedLayerPayloads?.cities || bundle.cityOverridesPayload) {
    syncScenarioLocalizationState({
      cityOverridesPayload: bundle.chunkMergedLayerPayloads?.cities || bundle.cityOverridesPayload || null,
      geoLocalePatchPayload: bundle.geoLocalePatchPayload || state.scenarioGeoLocalePatchData || null,
    });
  }
  syncScenarioUi();
  syncCountryUi({ renderNow });
  return true;
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
  const preferStartupTopologyForFullBundle = !!runtimeShell?.detailChunkManifestUrl;
  const runtimeTopologyUrl = String(
    requestedBundleLevel === "bootstrap"
      ? runtimeShell?.startupTopologyUrl || manifest.runtime_bootstrap_topology_url || manifest.runtime_topology_url || ""
      : preferStartupTopologyForFullBundle
        ? runtimeShell?.startupTopologyUrl || manifest.runtime_bootstrap_topology_url || manifest.runtime_topology_url || ""
        : manifest.runtime_topology_url || runtimeShell?.startupTopologyUrl || manifest.runtime_bootstrap_topology_url || ""
  ).trim();
  const scenarioBootstrapCacheKey =
    requestedBundleLevel === "bootstrap" && isStartupCacheEnabled()
      ? createStartupScenarioBootstrapCacheKey({
        scenarioRegistry: state.scenarioRegistry,
        scenarioId: targetId,
        bundleLevel: requestedBundleLevel,
        manifest,
        currentLanguage: state.currentLanguage,
        runtimeBootstrapTopologyUrl: runtimeTopologyUrl,
        geoLocalePatchUrl: geoLocalePatchDescriptor.url,
      })
      : "";
  if (requestedBundleLevel === "bootstrap" && state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
    state.startupBootCacheState.scenarioBootstrap = scenarioBootstrapCacheKey ? "probe" : "disabled";
  }
  if (scenarioBootstrapCacheKey) {
    try {
      const cacheEntry = await readStartupCacheEntry(scenarioBootstrapCacheKey);
      if (cacheEntry?.payload?.countriesPayload && cacheEntry?.payload?.ownersPayload && cacheEntry?.payload?.coresPayload) {
        if (state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
          state.startupBootCacheState.scenarioBootstrap = "hit";
        }
        const bundle = createScenarioBootstrapBundleFromCache({
          priorBundle,
          meta,
          manifest,
          bundleLevel: requestedBundleLevel,
          cachedPayload: cacheEntry.payload,
          geoLocalePatchDescriptor,
          runtimeTopologyUrl,
        });
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
    chunkMergedLayerPayloads: priorBundle?.chunkMergedLayerPayloads || null,
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
      if (scenarioBundleHasChunkedData(bundle)) {
        const eagerFallbackLayers = Object.keys(SCENARIO_OPTIONAL_LAYER_CONFIGS)
          .filter((layerKey) => !scenarioBundleUsesChunkedLayer(bundle, layerKey))
          .filter((layerKey) => shouldEagerLoadScenarioOptionalLayer(layerKey, manifest, bundle.runtimeTopologyPayload, hints));
        if (eagerFallbackLayers.length) {
          await Promise.all(
            eagerFallbackLayers.map((layerKey) => loadScenarioOptionalLayerPayload(bundle, layerKey, { d3Client }))
          );
        }
      } else {
        const eagerOptionalLayers = Object.keys(SCENARIO_OPTIONAL_LAYER_CONFIGS)
          .filter((layerKey) => shouldEagerLoadScenarioOptionalLayer(layerKey, manifest, bundle.runtimeTopologyPayload, hints));
        if (eagerOptionalLayers.length) {
          await Promise.all(
            eagerOptionalLayers.map((layerKey) => loadScenarioOptionalLayerPayload(bundle, layerKey, { d3Client }))
          );
        }
      }
    } else {
      const eagerOptionalLayers = Object.keys(SCENARIO_OPTIONAL_LAYER_CONFIGS)
        .filter((layerKey) => shouldEagerLoadScenarioOptionalLayer(layerKey, manifest, bundle.runtimeTopologyPayload, hints));
      if (eagerOptionalLayers.length) {
        await Promise.all(
          eagerOptionalLayers.map((layerKey) => loadScenarioOptionalLayerPayload(bundle, layerKey, { d3Client }))
        );
      }
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
  if (scenarioBootstrapCacheKey && requestedBundleLevel === "bootstrap") {
    if (state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
      state.startupBootCacheState.scenarioBootstrap = "write-pending";
    }
    void writeStartupCacheEntry({
      kind: "startup-scenario-bootstrap",
      cacheKey: scenarioBootstrapCacheKey,
      payload: createSerializableStartupScenarioBootstrapPayload({
        manifest,
        bundleLevel: requestedBundleLevel,
        countriesPayload: bundle.countriesPayload,
        ownersPayload: bundle.ownersPayload,
        controllersPayload: bundle.controllersPayload,
        coresPayload: bundle.coresPayload,
        geoLocalePatchPayload: bundle.geoLocalePatchPayload,
        runtimeTopologyPayload: bundle.runtimeTopologyPayload,
        runtimePoliticalMeta: bundle.runtimePoliticalMeta,
      }),
      keyParts: {
        scenarioId: targetId,
        bundleLevel: requestedBundleLevel,
        language: state.currentLanguage,
      },
    }).then(() => {
      if (state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
        state.startupBootCacheState.scenarioBootstrap = "written";
      }
    }).catch((error) => {
      console.warn(`[scenario] Startup bootstrap cache write failed for "${targetId}".`, error);
      if (state.startupBootCacheState && typeof state.startupBootCacheState === "object") {
        state.startupBootCacheState.scenarioBootstrap = "write-error";
      }
    });
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

function syncScenarioUi() {
  if (typeof state.updateScenarioUIFn === "function") {
    state.updateScenarioUIFn();
  }
  if (typeof state.renderScenarioAuditPanelFn === "function") {
    state.renderScenarioAuditPanelFn();
  }
}

function syncCountryUi({ renderNow = false } = {}) {
  if (typeof state.renderCountryListFn === "function") {
    state.renderCountryListFn();
  }
  if (typeof state.renderPresetTreeFn === "function") {
    state.renderPresetTreeFn();
  }
  if (typeof state.updateActiveSovereignUIFn === "function") {
    state.updateActiveSovereignUIFn();
  }
  if (typeof state.updateDynamicBorderStatusUIFn === "function") {
    state.updateDynamicBorderStatusUIFn();
  }
  if (typeof state.updateScenarioContextBarFn === "function") {
    state.updateScenarioContextBarFn();
  }
  syncScenarioUi();
  if (renderNow && typeof state.renderNowFn === "function") {
    state.renderNowFn();
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
  if (typeof state.ensureDetailTopologyFn === "function") {
    const promoted = await state.ensureDetailTopologyFn({ applyMapData });
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

function captureScenarioApplyRollbackSnapshot() {
  return {
    activeScenarioId: state.activeScenarioId,
    scenarioBorderMode: state.scenarioBorderMode,
    activeScenarioManifest: cloneScenarioStateValue(state.activeScenarioManifest),
    scenarioCountriesByTag: cloneScenarioStateValue(state.scenarioCountriesByTag),
    scenarioFixedOwnerColors: cloneScenarioStateValue(state.scenarioFixedOwnerColors),
    defaultRuntimePoliticalTopology: cloneScenarioStateValue(state.defaultRuntimePoliticalTopology),
    scenarioRuntimeTopologyData: cloneScenarioStateValue(state.scenarioRuntimeTopologyData),
    scenarioLandMaskData: cloneScenarioStateValue(state.scenarioLandMaskData),
    scenarioContextLandMaskData: cloneScenarioStateValue(state.scenarioContextLandMaskData),
    runtimePoliticalTopology: cloneScenarioStateValue(state.runtimePoliticalTopology),
    scenarioWaterRegionsData: cloneScenarioStateValue(state.scenarioWaterRegionsData),
    scenarioSpecialRegionsData: cloneScenarioStateValue(state.scenarioSpecialRegionsData),
    scenarioReliefOverlaysData: cloneScenarioStateValue(state.scenarioReliefOverlaysData),
    scenarioDistrictGroupsData: cloneScenarioStateValue(state.scenarioDistrictGroupsData),
    scenarioDistrictGroupByFeatureId: cloneScenarioStateValue(state.scenarioDistrictGroupByFeatureId),
    scenarioReliefOverlayRevision: Number(state.scenarioReliefOverlayRevision) || 0,
    scenarioGeoLocalePatchData: cloneScenarioStateValue(state.scenarioGeoLocalePatchData),
    scenarioCityOverridesData: cloneScenarioStateValue(state.scenarioCityOverridesData),
    cityLayerRevision: Number(state.cityLayerRevision) || 0,
    scenarioReleasableIndex: cloneScenarioStateValue(state.scenarioReleasableIndex),
    releasableCatalog: cloneScenarioStateValue(state.releasableCatalog),
    scenarioAudit: cloneScenarioStateValue(state.scenarioAudit),
    scenarioAuditUi: cloneScenarioStateValue(ensureScenarioAuditUiState()),
    scenarioImportAudit: cloneScenarioStateValue(state.scenarioImportAudit),
    scenarioBaselineHash: String(state.scenarioBaselineHash || ""),
    scenarioBaselineOwnersByFeatureId: cloneScenarioStateValue(state.scenarioBaselineOwnersByFeatureId),
    scenarioControllersByFeatureId: cloneScenarioStateValue(state.scenarioControllersByFeatureId),
    scenarioAutoShellOwnerByFeatureId: cloneScenarioStateValue(state.scenarioAutoShellOwnerByFeatureId),
    scenarioAutoShellControllerByFeatureId: cloneScenarioStateValue(state.scenarioAutoShellControllerByFeatureId),
    scenarioBaselineControllersByFeatureId: cloneScenarioStateValue(state.scenarioBaselineControllersByFeatureId),
    scenarioBaselineCoresByFeatureId: cloneScenarioStateValue(state.scenarioBaselineCoresByFeatureId),
    scenarioShellOverlayRevision: Number(state.scenarioShellOverlayRevision) || 0,
    scenarioControllerRevision: Number(state.scenarioControllerRevision) || 0,
    scenarioOwnerControllerDiffCount: Number(state.scenarioOwnerControllerDiffCount) || 0,
    scenarioDataHealth: cloneScenarioStateValue(state.scenarioDataHealth),
    scenarioViewMode: String(state.scenarioViewMode || "ownership"),
    mapSemanticMode: normalizeMapSemanticMode(state.mapSemanticMode),
    countryNames: cloneScenarioStateValue(state.countryNames),
    sovereigntyByFeatureId: cloneScenarioStateValue(state.sovereigntyByFeatureId),
    sovereigntyInitialized: !!state.sovereigntyInitialized,
    visualOverrides: cloneScenarioStateValue(state.visualOverrides),
    featureOverrides: cloneScenarioStateValue(state.featureOverrides),
    sovereignBaseColors: cloneScenarioStateValue(state.sovereignBaseColors),
    countryBaseColors: cloneScenarioStateValue(state.countryBaseColors),
    activeSovereignCode: String(state.activeSovereignCode || ""),
    selectedWaterRegionId: String(state.selectedWaterRegionId || ""),
    selectedSpecialRegionId: String(state.selectedSpecialRegionId || ""),
    hoveredWaterRegionId: state.hoveredWaterRegionId ?? null,
    hoveredSpecialRegionId: state.hoveredSpecialRegionId ?? null,
    selectedInspectorCountryCode: String(state.selectedInspectorCountryCode || ""),
    inspectorHighlightCountryCode: String(state.inspectorHighlightCountryCode || ""),
    inspectorExpansionInitialized: !!state.inspectorExpansionInitialized,
    expandedInspectorContinents: cloneScenarioStateValue(state.expandedInspectorContinents),
    expandedInspectorReleaseParents: cloneScenarioStateValue(state.expandedInspectorReleaseParents),
    scenarioParentBorderEnabledBeforeActivate: cloneScenarioStateValue(state.scenarioParentBorderEnabledBeforeActivate),
    parentBorderEnabledByCountry: cloneScenarioStateValue(state.parentBorderEnabledByCountry),
    scenarioPaintModeBeforeActivate: cloneScenarioStateValue(state.scenarioPaintModeBeforeActivate),
    paintMode: String(state.paintMode || "visual"),
    interactionGranularity: String(state.interactionGranularity || "subdivision"),
    batchFillScope: String(state.batchFillScope || "parent"),
    scenarioUiState: {
      politicalEditingExpanded: !!state.ui?.politicalEditingExpanded,
      scenarioVisualAdjustmentsOpen: !!state.ui?.scenarioVisualAdjustmentsOpen,
    },
    scenarioOceanFillBeforeActivate: state.scenarioOceanFillBeforeActivate,
    styleConfigOcean: cloneScenarioStateValue(state.styleConfig?.ocean || {}),
    locales: cloneScenarioStateValue(state.locales),
    geoAliasToStableKey: cloneScenarioStateValue(state.geoAliasToStableKey),
    scenarioDisplaySettingsBeforeActivate: cloneScenarioStateValue(state.scenarioDisplaySettingsBeforeActivate),
    activeScenarioPerformanceHints: cloneScenarioStateValue(state.activeScenarioPerformanceHints),
    scenarioPoliticalChunkData: cloneScenarioStateValue(state.scenarioPoliticalChunkData),
    activeScenarioChunks: cloneScenarioStateValue(state.activeScenarioChunks),
    runtimeChunkLoadState: cloneScenarioStateValue({
      ...(state.runtimeChunkLoadState || {}),
      refreshTimerId: null,
    }),
    renderProfile: String(state.renderProfile || "auto"),
    dynamicBordersEnabled: state.dynamicBordersEnabled !== false,
    showCityPoints: state.showCityPoints !== false,
    showWaterRegions: state.showWaterRegions !== false,
    showScenarioSpecialRegions: state.showScenarioSpecialRegions !== false,
    showScenarioReliefOverlays: state.showScenarioReliefOverlays !== false,
    activePaletteId: String(state.activePaletteId || ""),
    activePaletteMeta: cloneScenarioStateValue(state.activePaletteMeta),
    activePalettePack: cloneScenarioStateValue(state.activePalettePack),
    activePaletteMap: cloneScenarioStateValue(state.activePaletteMap),
    currentPaletteTheme: String(state.currentPaletteTheme || ""),
    activePaletteOceanMeta: cloneScenarioStateValue(state.activePaletteOceanMeta),
    fixedPaletteColorsByIso2: cloneScenarioStateValue(state.fixedPaletteColorsByIso2),
    resolvedDefaultCountryPalette: cloneScenarioStateValue(state.resolvedDefaultCountryPalette),
    paletteLibraryEntries: cloneScenarioStateValue(state.paletteLibraryEntries),
    paletteQuickSwatches: cloneScenarioStateValue(state.paletteQuickSwatches),
    paletteLoadErrorById: cloneScenarioStateValue(state.paletteLoadErrorById),
  };
}

function restoreScenarioApplyRollbackSnapshot(snapshot, { renderNow = false } = {}) {
  if (!snapshot || typeof snapshot !== "object") return;
  if (consumeScenarioTestHook("failRollbackRestoreOnce")) {
    throw new Error("Injected rollback restore failure.");
  }
  if (state.runtimeChunkLoadState?.refreshTimerId) {
    globalThis.clearTimeout(state.runtimeChunkLoadState.refreshTimerId);
  }

  state.activeScenarioId = snapshot.activeScenarioId;
  state.scenarioBorderMode = snapshot.scenarioBorderMode;
  state.activeScenarioManifest = cloneScenarioStateValue(snapshot.activeScenarioManifest);
  state.scenarioCountriesByTag = cloneScenarioStateValue(snapshot.scenarioCountriesByTag);
  state.scenarioFixedOwnerColors = cloneScenarioStateValue(snapshot.scenarioFixedOwnerColors);
  state.defaultRuntimePoliticalTopology = cloneScenarioStateValue(snapshot.defaultRuntimePoliticalTopology);
  state.scenarioRuntimeTopologyData = cloneScenarioStateValue(snapshot.scenarioRuntimeTopologyData);
  state.scenarioLandMaskData = cloneScenarioStateValue(snapshot.scenarioLandMaskData);
  state.scenarioContextLandMaskData = cloneScenarioStateValue(snapshot.scenarioContextLandMaskData);
  state.runtimePoliticalTopology = cloneScenarioStateValue(snapshot.runtimePoliticalTopology);
  state.scenarioWaterRegionsData = cloneScenarioStateValue(snapshot.scenarioWaterRegionsData);
  state.scenarioSpecialRegionsData = cloneScenarioStateValue(snapshot.scenarioSpecialRegionsData);
  state.scenarioReliefOverlaysData = cloneScenarioStateValue(snapshot.scenarioReliefOverlaysData);
  state.scenarioDistrictGroupsData = cloneScenarioStateValue(snapshot.scenarioDistrictGroupsData);
  state.scenarioDistrictGroupByFeatureId = cloneScenarioStateValue(snapshot.scenarioDistrictGroupByFeatureId) || new Map();
  state.scenarioReliefOverlayRevision = Number(snapshot.scenarioReliefOverlayRevision) || 0;
  state.scenarioGeoLocalePatchData = cloneScenarioStateValue(snapshot.scenarioGeoLocalePatchData);
  state.scenarioCityOverridesData = cloneScenarioStateValue(snapshot.scenarioCityOverridesData);
  state.cityLayerRevision = Number(snapshot.cityLayerRevision) || 0;
  state.scenarioReleasableIndex = cloneScenarioStateValue(snapshot.scenarioReleasableIndex);
  state.releasableCatalog = cloneScenarioStateValue(snapshot.releasableCatalog);
  state.scenarioAudit = cloneScenarioStateValue(snapshot.scenarioAudit);
  setScenarioAuditUiState(cloneScenarioStateValue(snapshot.scenarioAuditUi) || {});
  state.scenarioImportAudit = cloneScenarioStateValue(snapshot.scenarioImportAudit);
  state.scenarioBaselineHash = String(snapshot.scenarioBaselineHash || "");
  state.scenarioBaselineOwnersByFeatureId = cloneScenarioStateValue(snapshot.scenarioBaselineOwnersByFeatureId);
  state.scenarioControllersByFeatureId = cloneScenarioStateValue(snapshot.scenarioControllersByFeatureId);
  state.scenarioAutoShellOwnerByFeatureId = cloneScenarioStateValue(snapshot.scenarioAutoShellOwnerByFeatureId);
  state.scenarioAutoShellControllerByFeatureId = cloneScenarioStateValue(snapshot.scenarioAutoShellControllerByFeatureId);
  state.scenarioBaselineControllersByFeatureId = cloneScenarioStateValue(snapshot.scenarioBaselineControllersByFeatureId);
  state.scenarioBaselineCoresByFeatureId = cloneScenarioStateValue(snapshot.scenarioBaselineCoresByFeatureId);
  state.scenarioShellOverlayRevision = Number(snapshot.scenarioShellOverlayRevision) || 0;
  state.scenarioControllerRevision = Number(snapshot.scenarioControllerRevision) || 0;
  state.scenarioOwnerControllerDiffCount = Number(snapshot.scenarioOwnerControllerDiffCount) || 0;
  state.scenarioDataHealth = cloneScenarioStateValue(snapshot.scenarioDataHealth);
  state.scenarioViewMode = String(snapshot.scenarioViewMode || "ownership");
  state.mapSemanticMode = normalizeMapSemanticMode(snapshot.mapSemanticMode);
  state.countryNames = cloneScenarioStateValue(snapshot.countryNames) || { ...countryNames };
  state.sovereigntyByFeatureId = cloneScenarioStateValue(snapshot.sovereigntyByFeatureId);
  state.sovereigntyInitialized = !!snapshot.sovereigntyInitialized;
  state.visualOverrides = cloneScenarioStateValue(snapshot.visualOverrides);
  state.featureOverrides = cloneScenarioStateValue(snapshot.featureOverrides);
  state.sovereignBaseColors = cloneScenarioStateValue(snapshot.sovereignBaseColors);
  state.countryBaseColors = cloneScenarioStateValue(snapshot.countryBaseColors);
  state.activeSovereignCode = String(snapshot.activeSovereignCode || "");
  state.selectedWaterRegionId = String(snapshot.selectedWaterRegionId || "");
  state.selectedSpecialRegionId = String(snapshot.selectedSpecialRegionId || "");
  state.hoveredWaterRegionId = snapshot.hoveredWaterRegionId ?? null;
  state.hoveredSpecialRegionId = snapshot.hoveredSpecialRegionId ?? null;
  state.selectedInspectorCountryCode = String(snapshot.selectedInspectorCountryCode || "");
  state.inspectorHighlightCountryCode = String(snapshot.inspectorHighlightCountryCode || "");
  state.inspectorExpansionInitialized = !!snapshot.inspectorExpansionInitialized;
  state.expandedInspectorContinents =
    cloneScenarioStateValue(snapshot.expandedInspectorContinents) || new Set();
  state.expandedInspectorReleaseParents =
    cloneScenarioStateValue(snapshot.expandedInspectorReleaseParents) || new Set();
  state.scenarioParentBorderEnabledBeforeActivate =
    cloneScenarioStateValue(snapshot.scenarioParentBorderEnabledBeforeActivate);
  state.parentBorderEnabledByCountry = cloneScenarioStateValue(snapshot.parentBorderEnabledByCountry) || {};
  state.scenarioPaintModeBeforeActivate = cloneScenarioStateValue(snapshot.scenarioPaintModeBeforeActivate);
  state.paintMode = String(snapshot.paintMode || "visual");
  state.interactionGranularity = String(snapshot.interactionGranularity || "subdivision");
  state.batchFillScope = String(snapshot.batchFillScope || "parent");
  if (!state.ui || typeof state.ui !== "object") {
    state.ui = {};
  }
  state.ui.politicalEditingExpanded = !!snapshot.scenarioUiState?.politicalEditingExpanded;
  state.ui.scenarioVisualAdjustmentsOpen = !!snapshot.scenarioUiState?.scenarioVisualAdjustmentsOpen;
  state.scenarioOceanFillBeforeActivate = snapshot.scenarioOceanFillBeforeActivate;
  if (!state.styleConfig || typeof state.styleConfig !== "object") {
    state.styleConfig = {};
  }
  state.styleConfig.ocean = cloneScenarioStateValue(snapshot.styleConfigOcean) || {};
  state.locales = cloneScenarioStateValue(snapshot.locales) || { ui: {}, geo: {} };
  state.geoAliasToStableKey = cloneScenarioStateValue(snapshot.geoAliasToStableKey) || {};
  state.scenarioDisplaySettingsBeforeActivate =
    cloneScenarioStateValue(snapshot.scenarioDisplaySettingsBeforeActivate);
  state.activeScenarioPerformanceHints = cloneScenarioStateValue(snapshot.activeScenarioPerformanceHints);
  state.scenarioPoliticalChunkData = cloneScenarioStateValue(snapshot.scenarioPoliticalChunkData);
  state.activeScenarioChunks = cloneScenarioStateValue(snapshot.activeScenarioChunks) || {
    scenarioId: "",
    loadedChunkIds: [],
    payloadByChunkId: {},
    mergedLayerPayloads: {},
    lruChunkIds: [],
  };
  state.runtimeChunkLoadState = cloneScenarioStateValue(snapshot.runtimeChunkLoadState) || {
    shellStatus: "idle",
    registryStatus: "idle",
    refreshScheduled: false,
    refreshTimerId: null,
    inFlightByChunkId: {},
    errorByChunkId: {},
    lastSelection: null,
  };
  state.renderProfile = String(snapshot.renderProfile || "auto");
  state.dynamicBordersEnabled = snapshot.dynamicBordersEnabled !== false;
  state.showCityPoints = snapshot.showCityPoints !== false;
  state.showWaterRegions = snapshot.showWaterRegions !== false;
  state.showScenarioSpecialRegions = snapshot.showScenarioSpecialRegions !== false;
  state.showScenarioReliefOverlays = snapshot.showScenarioReliefOverlays !== false;
  state.activePaletteId = String(snapshot.activePaletteId || "");
  state.activePaletteMeta = cloneScenarioStateValue(snapshot.activePaletteMeta);
  state.activePalettePack = cloneScenarioStateValue(snapshot.activePalettePack);
  state.activePaletteMap = cloneScenarioStateValue(snapshot.activePaletteMap);
  state.currentPaletteTheme = String(snapshot.currentPaletteTheme || "");
  state.activePaletteOceanMeta = cloneScenarioStateValue(snapshot.activePaletteOceanMeta);
  state.fixedPaletteColorsByIso2 = cloneScenarioStateValue(snapshot.fixedPaletteColorsByIso2) || {};
  state.resolvedDefaultCountryPalette =
    cloneScenarioStateValue(snapshot.resolvedDefaultCountryPalette) || { ...defaultCountryPalette };
  state.paletteLibraryEntries = cloneScenarioStateValue(snapshot.paletteLibraryEntries) || [];
  state.paletteQuickSwatches = cloneScenarioStateValue(snapshot.paletteQuickSwatches) || [];
  state.paletteLoadErrorById = cloneScenarioStateValue(snapshot.paletteLoadErrorById) || {};
  state.scheduleScenarioChunkRefreshFn = snapshot.activeScenarioId ? scheduleScenarioChunkRefresh : null;
  syncResolvedDefaultCountryPalette({ overwriteCountryPalette: false });
  if (typeof state.renderPaletteFn === "function") {
    state.renderPaletteFn(state.currentPaletteTheme);
  }
  if (typeof state.updatePaletteLibraryUIFn === "function") {
    state.updatePaletteLibraryUIFn();
  }
  if (typeof state.updatePaletteSourceUIFn === "function") {
    state.updatePaletteSourceUIFn();
  }
  if (typeof state.updateParentBorderCountryListFn === "function") {
    state.updateParentBorderCountryListFn();
  }
  if (typeof state.updatePaintModeUIFn === "function") {
    state.updatePaintModeUIFn();
  }
  if (typeof state.updateToolbarInputsFn === "function") {
    state.updateToolbarInputsFn();
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
  setMapData({ refitProjection: false, resetZoom: false });
  rebuildPresetState();
  refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: "scenario-rollback" });
  refreshScenarioShellOverlays({ renderNow: false, borderReason: "scenario-rollback" });
  refreshScenarioDataHealth({ showWarningToast: false, showErrorToast: false });
  syncCountryUi({ renderNow });
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
  const defaultCountryCode = getScenarioDefaultCountryCode(bundle.manifest, baseCountryMap);
  const mapSemanticMode = getScenarioMapSemanticMode(bundle.manifest);
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
  const chunkMergedLayerPayloads = bundle.chunkMergedLayerPayloads || {};
  const scenarioWaterRegionsFromTopology =
    chunkMergedLayerPayloads.water
    || bundle.waterRegionsPayload
    || getScenarioDecodedCollection(bundle, "scenarioWaterRegionsData")
    || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_water");
  const scenarioSpecialRegionsFromTopology =
    chunkMergedLayerPayloads.special
    || getScenarioDecodedCollection(bundle, "scenarioSpecialRegionsData")
    || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_special_land");
  const scenarioContextLandMaskFromTopology =
    getScenarioDecodedCollection(bundle, "scenarioContextLandMaskData")
    || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "context_land_mask");
  const scenarioLandMaskFromTopology =
    getScenarioDecodedCollection(bundle, "scenarioLandMaskData")
    || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "land_mask")
    || getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "land");
  const scenarioNameMap = getScenarioNameMap(countryMap);
  const scenarioColorMap = getScenarioFixedOwnerColors(countryMap);
  const scenarioOwnerBackfill = buildHoi4FarEastSovietOwnerBackfill(scenarioId, {
    runtimeTopology: runtimeTopologyPayload?.objects?.political
      ? runtimeTopologyPayload
      : (state.defaultRuntimePoliticalTopology || state.runtimePoliticalTopology || null),
    ownersByFeatureId: owners,
    controllersByFeatureId: controllers,
  });
  const resolvedOwners = Object.keys(scenarioOwnerBackfill).length
    ? {
      ...owners,
      ...scenarioOwnerBackfill,
    }
    : { ...owners };
  const scenarioParentBorderEnabledBeforeActivate =
    state.scenarioParentBorderEnabledBeforeActivate === null && !state.activeScenarioId
      ? { ...(state.parentBorderEnabledByCountry || {}) }
      : cloneScenarioStateValue(state.scenarioParentBorderEnabledBeforeActivate);
  const scenarioDisplaySettingsBeforeActivate =
    !state.activeScenarioId && !state.scenarioDisplaySettingsBeforeActivate
      ? {
        renderProfile: normalizeScenarioRenderProfile(state.renderProfile, "auto"),
        dynamicBordersEnabled: state.dynamicBordersEnabled !== false,
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
    scenarioReliefOverlaysPayload: chunkMergedLayerPayloads.relief || bundle.reliefOverlaysPayload || null,
    scenarioCityOverridesPayload: chunkMergedLayerPayloads.cities || bundle.cityOverridesPayload || null,
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
    state.scenarioRuntimeTopologyData = staged.runtimeTopologyPayload;
    state.runtimePoliticalTopology = staged.runtimeTopologyPayload?.objects?.political
      ? staged.runtimeTopologyPayload
      : (state.defaultRuntimePoliticalTopology || state.runtimePoliticalTopology || null);
    state.scenarioPoliticalChunkData = normalizeScenarioFeatureCollection(bundle.chunkMergedLayerPayloads?.political) || null;
    state.runtimePoliticalMetaSeed = bundle.runtimePoliticalMeta || null;
    state.runtimePoliticalFeatureCollectionSeed = getScenarioDecodedCollection(bundle, "politicalData") || null;
    state.scenarioLandMaskData = staged.scenarioLandMaskFromTopology || null;
    state.scenarioContextLandMaskData = staged.scenarioContextLandMaskFromTopology || null;
    state.scenarioWaterRegionsData = bundle.waterRegionsPayload || staged.scenarioWaterRegionsFromTopology || null;
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
    state.countryNames = {
      ...countryNames,
      ...staged.scenarioNameMap,
    };
    state.sovereigntyByFeatureId = { ...staged.resolvedOwners };
    state.sovereigntyInitialized = false;
    state.visualOverrides = {};
    state.featureOverrides = {};
    state.sovereignBaseColors = { ...staged.scenarioColorMap };
    state.countryBaseColors = { ...staged.scenarioColorMap };
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
        state.activeScenarioChunks.mergedLayerPayloads = cloneScenarioStateValue(bundle.chunkMergedLayerPayloads) || {};
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
    refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: `scenario-opening:${staged.scenarioId}` });
    setMapData({ refitProjection: false, resetZoom: false, suppressRender });
    bundle.chunkLifecycle = {
      applyStartedAt,
      politicalCoreReadyRecorded: false,
    };
    recordScenarioPerfMetric(
      "timeToInteractiveCoarseFrame",
      (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt,
      {
        scenarioId: staged.scenarioId,
        hasChunkedRuntime: scenarioBundleUsesChunkedLayer(bundle),
      }
    );
    rebuildPresetState();
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
    spotChecks.forEach((fid) => {
      const owner = state.sovereigntyByFeatureId[fid];
      const controller = state.scenarioControllersByFeatureId?.[fid] || owner;
      if (owner) {
        const color = staged.scenarioColorMap[owner] || "(no color)";
        console.log(`[scenario] Spot-check: ${fid} -> owner=${owner}, controller=${controller}, color=${color}`);
      }
    });

    refreshScenarioShellOverlays({ renderNow: false, borderReason: `scenario:${staged.scenarioId}` });
    if (scenarioBundleUsesChunkedLayer(bundle)) {
      scheduleScenarioChunkRefresh({
        reason: "scenario-apply",
        delayMs: 0,
      });
    } else {
      ensureActiveScenarioOptionalLayersForVisibility({ bundle, renderNow })
        .catch((error) => {
          console.warn(`[scenario] Optional layer visibility sync failed for "${staged.scenarioId}".`, error);
        });
    }
    const dataHealth = refreshScenarioDataHealth({
      showWarningToast: true,
      showErrorToast: true,
      minRatio: SCENARIO_DETAIL_MIN_RATIO_STRICT,
    });
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
    syncCountryUi({ renderNow: renderNow && !suppressRender });
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
      applyMs: (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt,
    });
  } catch (error) {
    let rollbackRestoreError = null;
    try {
      restoreScenarioApplyRollbackSnapshot(rollbackSnapshot, { renderNow });
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
  state.visualOverrides = {};
  state.featureOverrides = {};
  state.sovereignBaseColors = { ...(state.scenarioFixedOwnerColors || {}) };
  state.countryBaseColors = { ...state.sovereignBaseColors };
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
  refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: `scenario-reset-opening:${state.activeScenarioId}` });
  disableScenarioParentBorders();
  refreshScenarioShellOverlays({ renderNow: false, borderReason: `scenario-reset:${state.activeScenarioId}` });
  refreshScenarioDataHealth({ showWarningToast: false });
  if (markDirtyReason) {
    markDirty(markDirtyReason);
  }
  syncCountryUi({ renderNow });
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
  state.activeSovereignCode = "";
  syncScenarioInspectorSelection("");
  restoreParentBordersAfterScenario();
  restorePaintModeAfterScenario();
  restoreScenarioOceanFillAfterExit();
  restoreScenarioDisplaySettingsAfterExit();
  refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: "scenario-clear-opening" });
  setMapData({ refitProjection: false, resetZoom: false });
  rebuildPresetState();
  refreshScenarioShellOverlays({ renderNow: false, borderReason: "scenario-clear" });
  if (markDirtyReason) {
    markDirty(markDirtyReason);
  }
  syncCountryUi({ renderNow });
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

function initScenarioManager({ render } = {}) {
  const scenarioSelect = document.getElementById("scenarioSelect");
  const applyScenarioBtn = document.getElementById("applyScenarioBtn");
  const resetScenarioBtn = document.getElementById("resetScenarioBtn");
  const clearScenarioBtn = document.getElementById("clearScenarioBtn");
  const scenarioStatus = document.getElementById("scenarioStatus");
  const scenarioAuditHint = document.getElementById("scenarioAuditHint");
  const scenarioViewModeLabel = document.getElementById("lblScenarioViewMode");
  const scenarioViewModeSelect = document.getElementById("scenarioViewModeSelect");

  const renderScenarioControls = () => {
    const entries = getScenarioRegistryEntries();
    const isApplyInFlight = !!state.scenarioApplyInFlight;
    const fatalState = getScenarioFatalRecoveryState();
    const isFatalLocked = !!fatalState;
    const fatalMessage = formatScenarioFatalRecoveryMessage(fatalState);
    if (scenarioSelect) {
      const pendingValue = normalizeScenarioId(scenarioSelect.value);
      const activeValue = normalizeScenarioId(state.activeScenarioId);
      const currentValue = pendingValue || activeValue;
      scenarioSelect.replaceChildren();
      const emptyOption = document.createElement("option");
      emptyOption.value = "";
      emptyOption.textContent = t("None", "ui");
      scenarioSelect.appendChild(emptyOption);
      entries.forEach((entry) => {
        const option = document.createElement("option");
        option.value = normalizeScenarioId(entry.scenario_id);
        option.textContent = getScenarioDisplayName(entry, entry.scenario_id);
        scenarioSelect.appendChild(option);
      });
      scenarioSelect.value = currentValue || "";
      scenarioSelect.disabled = isApplyInFlight || isFatalLocked;
      scenarioSelect.title = isFatalLocked ? fatalMessage : "";
    }

    if (scenarioStatus) {
      scenarioStatus.textContent = formatScenarioStatusText();
    }
    if (scenarioAuditHint) {
      const auditText = formatScenarioAuditText();
      scenarioAuditHint.textContent = auditText;
      scenarioAuditHint.classList.toggle("hidden", !auditText);
    }
    if (scenarioViewModeSelect) {
      const hasScenario = !!state.activeScenarioId;
      const hasControllerData = Object.keys(state.scenarioControllersByFeatureId || {}).length > 0;
      const hasSplit = Number(state.activeScenarioManifest?.summary?.owner_controller_split_feature_count || 0) > 0;
      scenarioViewModeSelect.value = normalizeScenarioViewMode(state.scenarioViewMode);
      scenarioViewModeSelect.disabled = isFatalLocked || !hasScenario || !hasControllerData || !hasSplit;
      scenarioViewModeSelect.classList.toggle("hidden", !hasScenario);
      scenarioViewModeLabel?.classList.toggle("hidden", !hasScenario);
      scenarioViewModeSelect.title = isFatalLocked
        ? fatalMessage
        : hasSplit
        ? t("Toggle legal ownership vs frontline control.", "ui")
        : t("No frontline control split in current scenario.", "ui");
    }
    if (resetScenarioBtn) {
      resetScenarioBtn.textContent = t("Reset", "ui");
      resetScenarioBtn.disabled = !state.activeScenarioId || isApplyInFlight || isFatalLocked;
      resetScenarioBtn.classList.toggle("hidden", !state.activeScenarioId);
      resetScenarioBtn.title = isFatalLocked ? fatalMessage : "";
    }
    if (clearScenarioBtn) {
      clearScenarioBtn.textContent = t("Exit Scenario", "ui");
      clearScenarioBtn.disabled = !state.activeScenarioId || isApplyInFlight || isFatalLocked;
      clearScenarioBtn.classList.toggle("hidden", !state.activeScenarioId);
      clearScenarioBtn.title = isFatalLocked ? fatalMessage : "";
    }
    if (applyScenarioBtn) {
      const selectedScenarioId = normalizeScenarioId(scenarioSelect?.value);
      const isSelectedScenarioActive =
        !!selectedScenarioId && selectedScenarioId === normalizeScenarioId(state.activeScenarioId);
      applyScenarioBtn.textContent = t("Apply", "ui");
      applyScenarioBtn.disabled = !selectedScenarioId || isSelectedScenarioActive || isApplyInFlight || isFatalLocked;
      applyScenarioBtn.classList.toggle("hidden", isSelectedScenarioActive);
      applyScenarioBtn.title = isFatalLocked ? fatalMessage : "";
    }
  };
  state.updateScenarioUIFn = renderScenarioControls;

  if (scenarioSelect && !scenarioSelect.dataset.bound) {
    scenarioSelect.addEventListener("change", () => {
      renderScenarioControls();
    });
    scenarioSelect.dataset.bound = "true";
  }

  if (scenarioViewModeSelect && !scenarioViewModeSelect.dataset.bound) {
    scenarioViewModeSelect.addEventListener("change", (event) => {
      const changed = setScenarioViewMode(event?.target?.value, {
        renderNow: true,
      });
      if (changed) {
        renderScenarioControls();
      }
    });
    scenarioViewModeSelect.dataset.bound = "true";
  }

  if (applyScenarioBtn && !applyScenarioBtn.dataset.bound) {
    applyScenarioBtn.addEventListener("click", async () => {
      const scenarioId = normalizeScenarioId(scenarioSelect?.value);
      if (!scenarioId) return;
      try {
        await applyScenarioById(scenarioId, {
          renderNow: true,
          markDirtyReason: "scenario-apply",
          showToastOnComplete: true,
        });
        renderScenarioControls();
        if (typeof render === "function") {
          render();
        }
      } catch (error) {
        console.error("Failed to apply scenario:", error);
        const message = String(error?.message || "").trim() || t("Unable to apply scenario.", "ui");
        showToast(message, {
          title: t("Scenario failed", "ui"),
          tone: "error",
          duration: 5200,
        });
      }
    });
    applyScenarioBtn.dataset.bound = "true";
  }

  if (resetScenarioBtn && !resetScenarioBtn.dataset.bound) {
    resetScenarioBtn.addEventListener("click", () => {
      if (!state.activeScenarioId || state.scenarioApplyInFlight) return;
      resetToScenarioBaseline({
        renderNow: true,
        markDirtyReason: "scenario-reset",
        showToastOnComplete: true,
      });
      renderScenarioControls();
      if (typeof render === "function") {
        render();
      }
    });
    resetScenarioBtn.dataset.bound = "true";
  }

  if (clearScenarioBtn && !clearScenarioBtn.dataset.bound) {
    clearScenarioBtn.addEventListener("click", () => {
      if (!state.activeScenarioId || state.scenarioApplyInFlight) return;
      clearActiveScenario({
        renderNow: true,
        markDirtyReason: "scenario-clear",
        showToastOnComplete: true,
      });
      renderScenarioControls();
      if (typeof render === "function") {
        render();
      }
    });
    clearScenarioBtn.dataset.bound = "true";
  }

  loadScenarioRegistry()
    .then(() => {
      renderScenarioControls();
    })
    .catch((error) => {
      console.warn("Unable to load scenario registry:", error);
      renderScenarioControls();
    });
}

export {
  applyScenarioBundle,
  applyDefaultScenarioOnStartup,
  applyScenarioById,
  clearActiveScenario,
  ensureActiveScenarioOptionalLayerLoaded,
  ensureActiveScenarioOptionalLayersForVisibility,
  ensureScenarioGeoLocalePatchForLanguage,
  getDefaultScenarioId,
  getScenarioDisplayOwnerByFeatureId,
  hydrateActiveScenarioBundle,
  initScenarioManager,
  loadScenarioAuditPayload,
  loadScenarioBundle,
  loadScenarioRegistry,
  recalculateScenarioOwnerControllerDiffCount,
  releaseScenarioAuditPayload,
  refreshScenarioShellOverlays,
  resetToScenarioBaseline,
  setScenarioViewMode,
  syncScenarioLocalizationState,
  validateImportedScenarioBaseline,
};
