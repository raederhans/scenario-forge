import { countryNames, defaultCountryPalette, state } from "./state.js";
import { ensureSovereigntyState, resetAllFeatureOwnersToCanonical } from "./sovereignty_manager.js";
import {
  recomputeDynamicBordersNow,
  refreshColorState,
  refreshScenarioOpeningOwnerBorders,
  setMapData,
} from "./map_renderer.js";
import {
  buildCityLocalizationPatch,
  loadDeferredDetailBundle,
  normalizeCityText,
  normalizeScenarioCityOverridesPayload,
  normalizeScenarioGeoLocalePatchPayload,
} from "./data_loader.js";
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
const SCENARIO_LOAD_TIMEOUT_MS = 12_000;
const SCENARIO_DETAIL_SOURCE_FALLBACK_ORDER = ["na_v2", "na_v1", "legacy_bak", "highres"];
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
  const sep = String(url).includes("?") ? "&" : "?";
  return `${url}${sep}_t=${Date.now()}`;
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
    d3Client.json(cacheBust(url)),
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
    const value = await loadScenarioJsonWithTimeout(d3Client, url, {
      scenarioId,
      resourceLabel,
    });
    return {
      ok: true,
      value: value ?? null,
      reason: "loaded",
      errorMessage: "",
    };
  } catch (error) {
    const errorMessage = String(error?.message || `Failed to load optional resource "${resourceLabel}".`);
    console.warn(`[scenario] Failed to load optional resource "${resourceLabel}" for "${scenarioId}".`, error);
    return {
      ok: false,
      value: null,
      reason: errorMessage.includes("Timed out") ? "timeout" : "load_error",
      errorMessage,
    };
  }
}

function normalizeScenarioId(value) {
  return String(value || "").trim();
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
  const registry = await d3Client.json(cacheBust(SCENARIO_REGISTRY_URL));
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
      const existingEntry = scenarioGeoPatch[targetId] || baseGeoLocales[targetId] || null;
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

  return { geo, conflicts };
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
    ...scenarioGeoPatch,
    ...patch.geo,
    ...synchronizedNamePatch.geo,
  };
  state.geoAliasToStableKey = {
    ...baseAliasMap,
    ...patch.aliasToStableKey,
  };
  if (synchronizedNamePatch.conflicts.length > 0) {
    console.info(
      `[scenario] Synchronized ${synchronizedNamePatch.conflicts.length} geo locale entr${synchronizedNamePatch.conflicts.length === 1 ? "y" : "ies"} from scenario city overrides.`
    );
  }
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
      const rawPayload = await d3Client.json(cacheBust(requestUrl));
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
  const requestedLayers = Object.entries(SCENARIO_OPTIONAL_LAYER_CONFIGS)
    .filter(([, config]) => state[config.visibilityField])
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

async function loadScenarioBundle(scenarioId, { d3Client = globalThis.d3, forceReload = false } = {}) {
  const loadStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
  const targetId = normalizeScenarioId(scenarioId);
  if (!targetId) {
    throw new Error("Scenario id is required.");
  }
  if (!forceReload && state.scenarioBundleCacheById?.[targetId]) {
    prewarmScenarioOptionalLayersOnCacheHit(state.scenarioBundleCacheById[targetId], { d3Client });
    recordScenarioPerfMetric("loadScenarioBundle", (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - loadStartedAt, {
      scenarioId: targetId,
      cacheHit: true,
    });
    return state.scenarioBundleCacheById[targetId];
  }
  await loadScenarioRegistry({ d3Client });
  const meta = getScenarioMetaById(targetId);
  if (!meta?.manifest_url) {
    throw new Error(`Unknown scenario id: ${targetId}`);
  }
  if (!d3Client || typeof d3Client.json !== "function") {
    throw new Error("d3.json is not available for scenario loading.");
  }
  const manifest = await loadScenarioJsonWithTimeout(d3Client, meta.manifest_url, {
    scenarioId: targetId,
    resourceLabel: "manifest",
  });
  const hints = normalizeScenarioPerformanceHints(manifest);
  const [
    countriesPayload,
    ownersPayload,
    controllersPayload,
    coresPayload,
    runtimeTopologyResult,
    geoLocalePatchResult,
    releasableCatalogResult,
    districtGroupsResult,
  ] =
    await Promise.all([
    loadRequiredScenarioResource(d3Client, manifest.countries_url, {
      scenarioId: targetId,
      resourceLabel: "countries",
      requiredField: "countries",
    }),
    loadRequiredScenarioResource(d3Client, manifest.owners_url, {
      scenarioId: targetId,
      resourceLabel: "owners",
      requiredField: "owners",
    }),
    manifest.controllers_url
      ? loadRequiredScenarioResource(d3Client, manifest.controllers_url, {
        scenarioId: targetId,
        resourceLabel: "controllers",
        requiredField: "controllers",
      })
      : Promise.resolve(null),
    loadRequiredScenarioResource(d3Client, manifest.cores_url, {
      scenarioId: targetId,
      resourceLabel: "cores",
      requiredField: "cores",
    }),
    loadOptionalScenarioResource(d3Client, manifest.runtime_topology_url, {
      scenarioId: targetId,
      resourceLabel: "runtime_topology",
    }),
    loadOptionalScenarioResource(d3Client, manifest.geo_locale_patch_url, {
      scenarioId: targetId,
      resourceLabel: "geo_locale_patch",
    }),
    loadOptionalScenarioResource(d3Client, manifest.releasable_catalog_url, {
      scenarioId: targetId,
      resourceLabel: "releasable_catalog",
    }),
    loadOptionalScenarioResource(d3Client, manifest.district_groups_url, {
      scenarioId: targetId,
      resourceLabel: "district_groups",
    }),
    ]);
  const bundle = {
    meta,
    manifest,
    countriesPayload,
    ownersPayload,
    controllersPayload,
    coresPayload,
    waterRegionsPayload: null,
    specialRegionsPayload: null,
    reliefOverlaysPayload: null,
    cityOverridesPayload: null,
    geoLocalePatchPayload: normalizeScenarioGeoLocalePatchPayload(geoLocalePatchResult.value),
    runtimeTopologyPayload: normalizeScenarioRuntimeTopologyPayload(runtimeTopologyResult.value),
    releasableCatalog: releasableCatalogResult.value,
    districtGroupsPayload: normalizeScenarioDistrictGroupsPayload(districtGroupsResult.value, targetId),
    auditPayload: null,
    optionalLayerPromises: {},
    optionalLayerSettledByKey: {},
    loadDiagnostics: {
      optionalResources: {
        runtime_topology: {
          ok: !!runtimeTopologyResult.ok,
          reason: runtimeTopologyResult.reason,
          errorMessage: runtimeTopologyResult.errorMessage,
        },
        geo_locale_patch: {
          ok: !!geoLocalePatchResult.ok,
          reason: geoLocalePatchResult.reason,
          errorMessage: geoLocalePatchResult.errorMessage,
        },
        releasable_catalog: {
          ok: !!releasableCatalogResult.ok,
          reason: releasableCatalogResult.reason,
          errorMessage: releasableCatalogResult.errorMessage,
        },
        district_groups: {
          ok: !!districtGroupsResult.ok,
          reason: districtGroupsResult.reason,
          errorMessage: districtGroupsResult.errorMessage,
        },
      },
    },
  };
  const eagerOptionalLayers = Object.keys(SCENARIO_OPTIONAL_LAYER_CONFIGS)
    .filter((layerKey) => shouldEagerLoadScenarioOptionalLayer(layerKey, manifest, bundle.runtimeTopologyPayload, hints));
  if (eagerOptionalLayers.length) {
    await Promise.all(
      eagerOptionalLayers.map((layerKey) => loadScenarioOptionalLayerPayload(bundle, layerKey, { d3Client }))
    );
  }
  const ownerCount = Object.keys(ownersPayload?.owners || {}).length;
  const controllerCount = Object.keys(controllersPayload?.controllers || {}).length;
  const countryCount = Object.keys(countriesPayload?.countries || {}).length;
  console.log(
    `[scenario] Loaded bundle "${targetId}": ${ownerCount} owner entries, ${controllerCount} controller entries, ${countryCount} countries, baseline=${String(manifest?.baseline_hash || "").slice(0, 12)}`
  );
  state.scenarioBundleCacheById[targetId] = bundle;
  recordScenarioPerfMetric("loadScenarioBundle", (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - loadStartedAt, {
    scenarioId: targetId,
    cacheHit: false,
    countryCount,
    ownerCount,
    controllerCount,
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
    ? await loadScenarioBundle(bundleOrScenarioId, { d3Client })
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
    const auditPayload = await d3Client.json(cacheBust(bundle.manifest.audit_url));
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
    bundle = await loadScenarioBundle(scenarioId, { d3Client });
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
    renderProfile: String(state.renderProfile || "auto"),
    dynamicBordersEnabled: state.dynamicBordersEnabled !== false,
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
  state.renderProfile = String(snapshot.renderProfile || "auto");
  state.dynamicBordersEnabled = snapshot.dynamicBordersEnabled !== false;
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
  } = {}
) {
  const detailPromoted = await ensureScenarioDetailTopologyLoaded({ applyMapData: false });
  const detailReady = (
    state.topologyBundleMode === "composite"
    && hasUsablePoliticalTopology(state.topologyDetail)
  ) || !!detailPromoted;
  if (!detailReady && scenarioNeedsDetailTopology(bundle.manifest)) {
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
  const scenarioWaterRegionsFromTopology = getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_water");
  const scenarioSpecialRegionsFromTopology = getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "scenario_special_land");
  const scenarioContextLandMaskFromTopology =
    getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "context_land_mask");
  const scenarioLandMaskFromTopology =
    getScenarioTopologyFeatureCollection(runtimeTopologyPayload, "land_mask")
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
    countryMap,
    runtimeTopologyPayload,
    districtGroupsPayload,
    scenarioWaterRegionsFromTopology,
    scenarioSpecialRegionsFromTopology,
    scenarioContextLandMaskFromTopology,
    scenarioLandMaskFromTopology,
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
    markDirtyReason = "scenario-apply",
    syncPalette = true,
    showToastOnComplete = false,
  } = {}
) {
  const applyStartedAt = globalThis.performance?.now ? globalThis.performance.now() : Date.now();
  if (!bundle?.manifest) {
    throw new Error("Scenario bundle is missing a manifest.");
  }
  const rollbackSnapshot = captureScenarioApplyRollbackSnapshot();
  let staged = null;
  try {
    staged = await prepareScenarioApplyState(bundle, { syncPalette });

    state.scenarioParentBorderEnabledBeforeActivate =
      cloneScenarioStateValue(staged.scenarioParentBorderEnabledBeforeActivate);
    state.scenarioDisplaySettingsBeforeActivate =
      cloneScenarioStateValue(staged.scenarioDisplaySettingsBeforeActivate);
    state.scenarioOceanFillBeforeActivate = staged.scenarioOceanFillBeforeActivate;
    state.activeScenarioId = staged.scenarioId;
    state.scenarioBorderMode = "scenario_owner_only";
    state.activeScenarioManifest = bundle.manifest || null;
    state.scenarioCountriesByTag = staged.countryMap;
    state.scenarioFixedOwnerColors = staged.scenarioColorMap;
    state.defaultRuntimePoliticalTopology = state.defaultRuntimePoliticalTopology || state.runtimePoliticalTopology || null;
    state.scenarioRuntimeTopologyData = staged.runtimeTopologyPayload;
    state.runtimePoliticalTopology = staged.runtimeTopologyPayload?.objects?.political
      ? staged.runtimeTopologyPayload
      : (state.defaultRuntimePoliticalTopology || state.runtimePoliticalTopology || null);
    state.scenarioLandMaskData = staged.scenarioLandMaskFromTopology || null;
    state.scenarioContextLandMaskData = staged.scenarioContextLandMaskFromTopology || null;
    state.scenarioWaterRegionsData = staged.scenarioWaterRegionsFromTopology || bundle.waterRegionsPayload || null;
    state.scenarioSpecialRegionsData = staged.scenarioSpecialRegionsFromTopology || bundle.specialRegionsPayload || null;
    state.scenarioReliefOverlaysData = bundle.reliefOverlaysPayload || null;
    state.scenarioReliefOverlayRevision = (Number(state.scenarioReliefOverlayRevision) || 0) + 1;
    state.scenarioDistrictGroupsData = staged.districtGroupsPayload;
    state.scenarioDistrictGroupByFeatureId = buildScenarioDistrictGroupByFeatureId(staged.districtGroupsPayload);
    syncScenarioLocalizationState({
      cityOverridesPayload: bundle.cityOverridesPayload || null,
      geoLocalePatchPayload: bundle.geoLocalePatchPayload || null,
    });
    state.releasableCatalog = mergeReleasableCatalogs(state.defaultReleasableCatalog, bundle.releasableCatalog);
    state.scenarioReleasableIndex = staged.releasableIndex;
    state.scenarioAudit = bundle.auditPayload || null;
    setScenarioAuditUiState({
      loading: false,
      loadedForScenarioId: bundle.auditPayload ? staged.scenarioId : "",
      errorMessage: "",
    });
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
    state.activeSovereignCode = staged.defaultCountryCode;
    state.selectedWaterRegionId = "";
    state.selectedSpecialRegionId = "";
    state.hoveredWaterRegionId = null;
    state.hoveredSpecialRegionId = null;
    syncScenarioInspectorSelection(staged.defaultCountryCode);

    disableScenarioParentBorders();
    applyScenarioPaintMode();
    syncScenarioOceanFillForActivation(bundle.manifest);
    applyScenarioPerformanceHints(bundle.manifest);
    if (Object.keys(staged.scenarioOwnerBackfill).length) {
      console.info(
        `[scenario] Applied HOI4 Far East owner backfill for "${staged.scenarioId}": ${Object.keys(staged.scenarioOwnerBackfill).length} missing RU runtime features -> SOV.`
      );
    }
    recalculateScenarioOwnerControllerDiffCount();
    refreshScenarioOpeningOwnerBorders({ renderNow: false, reason: `scenario-opening:${staged.scenarioId}` });
    setMapData({ refitProjection: false, resetZoom: false });
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
    ensureActiveScenarioOptionalLayersForVisibility({ bundle, renderNow })
      .catch((error) => {
        console.warn(`[scenario] Optional layer visibility sync failed for "${staged.scenarioId}".`, error);
      });
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
    if (markDirtyReason) {
      markDirty(markDirtyReason);
    }
    syncCountryUi({ renderNow });
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
    });
  } catch (error) {
    try {
      restoreScenarioApplyRollbackSnapshot(rollbackSnapshot, { renderNow });
    } catch (rollbackError) {
      console.error("[scenario] Failed to restore scenario apply rollback snapshot.", rollbackError);
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
    const bundle = await loadScenarioBundle(normalizedScenarioId);
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
  state.activeSovereignCode = getScenarioDefaultCountryCode(
    state.activeScenarioManifest,
    state.scenarioCountriesByTag
  ) || String(state.activeSovereignCode || "").trim().toUpperCase();
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
  state.activeScenarioId = "";
  state.scenarioBorderMode = "canonical";
  state.activeScenarioManifest = null;
  state.scenarioCountriesByTag = {};
  state.scenarioFixedOwnerColors = {};
  state.scenarioRuntimeTopologyData = null;
  state.scenarioLandMaskData = null;
  state.scenarioContextLandMaskData = null;
  state.runtimePoliticalTopology = state.defaultRuntimePoliticalTopology || null;
  state.scenarioWaterRegionsData = null;
  state.scenarioSpecialRegionsData = null;
  state.scenarioReliefOverlaysData = null;
  state.scenarioDistrictGroupsData = null;
  state.scenarioDistrictGroupByFeatureId = new Map();
  state.scenarioReliefOverlayRevision = (Number(state.scenarioReliefOverlayRevision) || 0) + 1;
  syncScenarioLocalizationState({
    cityOverridesPayload: null,
    geoLocalePatchPayload: null,
  });
  state.scenarioReleasableIndex = {
    byTag: {},
    childTagsByParent: {},
    consumedPresetNamesByParentLookup: {},
  };
  state.releasableCatalog = state.defaultReleasableCatalog || null;
  state.scenarioAudit = null;
  setScenarioAuditUiState({
    loading: false,
    loadedForScenarioId: "",
    errorMessage: "",
  });
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
  resetAllFeatureOwnersToCanonical();
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
  if (!state.activeScenarioId || !state.activeScenarioManifest) {
    return t("No scenario active", "ui");
  }
  const displayName = getScenarioDisplayName(state.activeScenarioManifest, state.activeScenarioId);
  const warning = String(state.scenarioDataHealth?.warning || "").trim();
  return warning ? `${displayName} · ${warning}` : displayName;
}

function formatScenarioAuditText() {
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
      scenarioViewModeSelect.disabled = !hasScenario || !hasControllerData || !hasSplit;
      scenarioViewModeSelect.classList.toggle("hidden", !hasScenario);
      scenarioViewModeLabel?.classList.toggle("hidden", !hasScenario);
      scenarioViewModeSelect.title = hasSplit
        ? t("Toggle legal ownership vs frontline control.", "ui")
        : t("No frontline control split in current scenario.", "ui");
    }
    if (resetScenarioBtn) {
      resetScenarioBtn.textContent = t("Reset Changes To Baseline", "ui");
      resetScenarioBtn.disabled = !state.activeScenarioId || isApplyInFlight;
      resetScenarioBtn.classList.toggle("hidden", !state.activeScenarioId);
    }
    if (clearScenarioBtn) {
      clearScenarioBtn.textContent = t("Exit Scenario", "ui");
      clearScenarioBtn.disabled = !state.activeScenarioId || isApplyInFlight;
      clearScenarioBtn.classList.toggle("hidden", !state.activeScenarioId);
    }
    if (applyScenarioBtn) {
      const selectedScenarioId = normalizeScenarioId(scenarioSelect?.value);
      const isSelectedScenarioActive =
        !!selectedScenarioId && selectedScenarioId === normalizeScenarioId(state.activeScenarioId);
      applyScenarioBtn.textContent = t("Apply", "ui");
      applyScenarioBtn.disabled = !selectedScenarioId || isSelectedScenarioActive || isApplyInFlight;
      applyScenarioBtn.classList.toggle("hidden", isSelectedScenarioActive);
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
  getDefaultScenarioId,
  getScenarioDisplayOwnerByFeatureId,
  initScenarioManager,
  loadScenarioAuditPayload,
  loadScenarioBundle,
  loadScenarioRegistry,
  recalculateScenarioOwnerControllerDiffCount,
  refreshScenarioShellOverlays,
  resetToScenarioBaseline,
  setScenarioViewMode,
  syncScenarioLocalizationState,
  validateImportedScenarioBaseline,
};
