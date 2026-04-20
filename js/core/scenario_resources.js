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
  getVisibleScenarioChunkLayers,
  mergeScenarioChunkPayloads,
  normalizeScenarioRenderBudgetHints,
  selectScenarioChunks,
} from "./scenario_chunk_manager.js";
import {
  buildScenarioDistrictGroupByFeatureId,
  normalizeScenarioDistrictGroupsPayload,
} from "./scenario_districts.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
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
  enterScenarioFatalRecovery,
} from "./scenario_recovery.js";
import {
  SCENARIO_RENDER_PROFILES,
  buildHoi4FarEastSovietOwnerBackfill,
  normalizeScenarioOceanFillColor,
  normalizeScenarioRenderProfile,
  recordScenarioPerfMetric as sharedRecordScenarioPerfMetric,
} from "./scenario/pure_helpers.js";
import {
  cacheBust,
  getSearchParams,
  normalizeScenarioBundleLevel,
  scenarioBundleSatisfiesLevel,
  normalizeScenarioCoreTag,
  normalizeScenarioCoreValue,
  normalizeScenarioCoreMap as sharedNormalizeScenarioCoreMap,
  loadScenarioJsonWithTimeout as sharedLoadScenarioJsonWithTimeout,
  loadScenarioJsonResourceWithTimeout as sharedLoadScenarioJsonResourceWithTimeout,
  validateScenarioRequiredResourcePayload,
  loadRequiredScenarioResource as sharedLoadRequiredScenarioResource,
  loadOptionalScenarioResource as sharedLoadOptionalScenarioResource,
  loadMeasuredRequiredScenarioResource as sharedLoadMeasuredRequiredScenarioResource,
  normalizeScenarioId,
  normalizeScenarioLanguage,
  getScenarioGeoLocalePatchDescriptor as sharedGetScenarioGeoLocalePatchDescriptor,
} from "./scenario/shared.js";
import {
  createScenarioChunkRuntimeController,
} from "./scenario/chunk_runtime.js";
import {
  createScenarioStartupHydrationController,
} from "./scenario/startup_hydration.js";
import {
  getScenarioRegistryEntries as getBundleLoaderScenarioRegistryEntries,
  getScenarioDisplayName as getBundleLoaderScenarioDisplayName,
  getScenarioNameMap as getBundleLoaderScenarioNameMap,
  getScenarioFixedOwnerColors as getBundleLoaderScenarioFixedOwnerColors,
  mergeReleasableCatalogs,
  getScenarioMetaById as getBundleLoaderScenarioMetaById,
  getDefaultScenarioId as getBundleLoaderDefaultScenarioId,
  getScenarioManifestVersion,
  getScenarioManifestSummary as getBundleLoaderScenarioManifestSummary,
  getScenarioBaselineHashFromBundle,
  getScenarioBlockerCount,
  getScenarioDefaultCountryCode,
  normalizeScenarioRuntimeTopologyPayload as normalizeBundleLoaderScenarioRuntimeTopologyPayload,
  normalizeScenarioRuntimePoliticalMeta as normalizeBundleLoaderScenarioRuntimePoliticalMeta,
  getScenarioRuntimePoliticalFeatureCount as getBundleLoaderScenarioRuntimePoliticalFeatureCount,
  validateScenarioRuntimeShellContract as validateBundleLoaderScenarioRuntimeShellContract,
  hasScenarioRuntimeShellContract as hasBundleLoaderScenarioRuntimeShellContract,
  normalizeScenarioRuntimeShell as normalizeBundleLoaderScenarioRuntimeShell,
  scenarioSupportsChunkedRuntime as bundleLoaderScenarioSupportsChunkedRuntime,
  scenarioBundleHasChunkedData as bundleLoaderScenarioBundleHasChunkedData,
  getScenarioBundleId as getBundleLoaderScenarioBundleId,
  getScenarioDecodedCollection as getBundleLoaderScenarioDecodedCollection,
  loadScenarioChunkFile,
  createScenarioChunkRegistryEnsurer,
  createScenarioBootstrapBundleFromCache,
  createStartupScenarioBundleFromPayload,
  createScenarioBundleAssembler,
  createScenarioRegistryLoader,
  createScenarioAuditPayloadLoader,
  createImportedScenarioBaselineValidator,
} from "./scenario/bundle_loader.js";
import { consumeScenarioTestHook } from "./scenario_recovery.js";
import { t } from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";
const SCENARIO_REGISTRY_URL = "data/scenarios/index.json";
const SCENARIO_DETAIL_SOURCE_FALLBACK_ORDER = ["na_v2", "na_v1", "legacy_bak", "highres"];
const SCENARIO_FATAL_RECOVERY_CODE = "SCENARIO_FATAL_RECOVERY";
const SCENARIO_CHUNK_REFRESH_DELAY_MS_INTERACTING = 180;
const SCENARIO_CHUNK_REFRESH_DELAY_MS_IDLE = 60;
const SCENARIO_OWNER_FEATURE_COVERAGE_MIN_RATIO = 0.85;
const SCENARIO_OWNER_FEATURE_COVERAGE_MIN_FEATURES = 1000;
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

const normalizeStartupBundleRuntimePoliticalMeta = normalizeBundleLoaderScenarioRuntimePoliticalMeta;

function normalizeScenarioCoreMap(rawMap) {
  return sharedNormalizeScenarioCoreMap(rawMap, { normalizeFeatureText: normalizeCityText });
}

function loadScenarioJsonWithTimeout(d3Client, url, options = {}) {
  return sharedLoadScenarioJsonWithTimeout(loadMeasuredJsonResource, d3Client, url, options);
}

function loadScenarioJsonResourceWithTimeout(d3Client, url, options = {}) {
  return sharedLoadScenarioJsonResourceWithTimeout(loadMeasuredJsonResource, d3Client, url, options);
}

async function loadRequiredScenarioResource(d3Client, url, options = {}) {
  return sharedLoadRequiredScenarioResource(loadMeasuredJsonResource, d3Client, url, options);
}

async function loadOptionalScenarioResource(d3Client, url, options = {}) {
  return sharedLoadOptionalScenarioResource(loadMeasuredJsonResource, d3Client, url, options);
}

async function loadMeasuredRequiredScenarioResource(d3Client, url, options = {}) {
  return sharedLoadMeasuredRequiredScenarioResource(loadMeasuredJsonResource, d3Client, url, options);
}

function getScenarioGeoLocalePatchDescriptor(manifest, language = state.currentLanguage) {
  return sharedGetScenarioGeoLocalePatchDescriptor(manifest, language);
}

function getScenarioBundleId(bundle) {
  return getBundleLoaderScenarioBundleId(bundle, { normalizeScenarioId });
}

function getScenarioDecodedCollection(bundle, collectionKey) {
  return getBundleLoaderScenarioDecodedCollection(bundle, collectionKey);
}

/**
 * Load and cache scenario registry metadata used by bundle resolution.
 * @param {{ d3Client?: { json: Function } }} [options]
 * @returns {Promise<object>} Registry payload with scenario entries and default scenario metadata.
 * @throws {Error} Propagates fetch or parse errors from the registry loader.
 */
const loadScenarioRegistry = createScenarioRegistryLoader({
  state,
  scenarioRegistryUrl: SCENARIO_REGISTRY_URL,
  loadScenarioJsonWithTimeout,
});

const assembleScenarioBundle = createScenarioBundleAssembler({
  loadMeasuredRequiredScenarioResource,
  loadOptionalScenarioResource,
});

function normalizeScenarioViewMode(value) {
  return String(value || "").trim().toLowerCase() === "frontline" ? "frontline" : "ownership";
}

function recordScenarioPerfMetric(name, durationMs, details = {}) {
  return sharedRecordScenarioPerfMetric(state, name, durationMs, details);
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
  return getBundleLoaderScenarioRegistryEntries(state);
}

function getScenarioDisplayName(source, fallbackId = "") {
  return getBundleLoaderScenarioDisplayName(source, fallbackId, t);
}

function getScenarioNameMap(countryMap = {}) {
  return getBundleLoaderScenarioNameMap(countryMap);
}

function getScenarioFixedOwnerColors(countryMap = {}) {
  return getBundleLoaderScenarioFixedOwnerColors(countryMap);
}

function getScenarioMetaById(scenarioId) {
  return getBundleLoaderScenarioMetaById(state, normalizeScenarioId, scenarioId);
}

function getDefaultScenarioId() {
  return getBundleLoaderDefaultScenarioId(state, normalizeScenarioId);
}

function getScenarioManifestSummary(manifest = state.activeScenarioManifest) {
  return getBundleLoaderScenarioManifestSummary(manifest);
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

function getScenarioFeatureCollectionIdentityList(payload) {
  const normalizedPayload = normalizeScenarioFeatureCollection(payload);
  const features = Array.isArray(normalizedPayload?.features) ? normalizedPayload.features : [];
  return features
    .map((feature) => String(feature?.id || feature?.properties?.id || "").trim())
    .filter(Boolean);
}

function areScenarioFeatureCollectionIdentitiesEqual(leftPayload, rightPayload) {
  const leftIds = getScenarioFeatureCollectionIdentityList(leftPayload);
  const rightIds = getScenarioFeatureCollectionIdentityList(rightPayload);
  return (
    leftIds.length === rightIds.length
    && leftIds.every((featureId, index) => featureId === rightIds[index])
  );
}

function areScenarioFeatureCollectionFeatureReferencesEqual(leftPayload, rightPayload) {
  const leftNormalized = normalizeScenarioFeatureCollection(leftPayload);
  const rightNormalized = normalizeScenarioFeatureCollection(rightPayload);
  const leftFeatures = Array.isArray(leftNormalized?.features) ? leftNormalized.features : [];
  const rightFeatures = Array.isArray(rightNormalized?.features) ? rightNormalized.features : [];
  return (
    leftFeatures.length === rightFeatures.length
    && leftFeatures.every((feature, index) => feature === rightFeatures[index])
  );
}

function areScenarioFeatureCollectionsEquivalent(leftPayload, rightPayload) {
  return (
    areScenarioFeatureCollectionIdentitiesEqual(leftPayload, rightPayload)
    && areScenarioFeatureCollectionFeatureReferencesEqual(leftPayload, rightPayload)
  );
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
  return normalizeBundleLoaderScenarioRuntimeTopologyPayload(payload);
}

function hasScenarioRuntimePoliticalPayload(payload) {
  return !!normalizeScenarioRuntimeTopologyPayload(payload)?.objects?.political;
}

function normalizeScenarioRuntimePoliticalMeta(meta) {
  return normalizeStartupBundleRuntimePoliticalMeta(meta);
}

function scheduleScenarioDeferredBundleMetadataLoad(bundle, { d3Client = globalThis.d3 } = {}) {
  if (!bundle?.manifest || bundle?.bundleLevel !== "full") {
    return;
  }
  if (bundle.deferredMetadataLoadPromise) {
    return;
  }
  const scenarioId = normalizeScenarioId(bundle.manifest?.scenario_id || bundle.meta?.scenario_id);
  if (!scenarioId || !d3Client || typeof d3Client.json !== "function") {
    return;
  }
  bundle.deferredMetadataLoadPromise = new Promise((resolve) => {
    globalThis.setTimeout(async () => {
      const [releasableCatalogResult, districtGroupsResult] = await Promise.all([
        bundle.manifest?.releasable_catalog_url
          ? loadOptionalScenarioResource(d3Client, bundle.manifest.releasable_catalog_url, {
            scenarioId,
            resourceLabel: "releasable_catalog",
          })
          : Promise.resolve({ ok: false, value: null, metrics: null, reason: "missing-url", errorMessage: "" }),
        bundle.manifest?.district_groups_url
          ? loadOptionalScenarioResource(d3Client, bundle.manifest.district_groups_url, {
            scenarioId,
            resourceLabel: "district_groups",
          })
          : Promise.resolve({ ok: false, value: null, metrics: null, reason: "missing-url", errorMessage: "" }),
      ]);
      if (releasableCatalogResult.ok) {
        bundle.releasableCatalog = releasableCatalogResult.value || null;
        if (bundle.loadDiagnostics?.optionalResources?.releasable_catalog) {
          bundle.loadDiagnostics.optionalResources.releasable_catalog = {
            ok: true,
            reason: releasableCatalogResult.reason,
            errorMessage: releasableCatalogResult.errorMessage,
            metrics: releasableCatalogResult.metrics || null,
          };
        }
      }
      if (districtGroupsResult.ok) {
        bundle.districtGroupsPayload = normalizeScenarioDistrictGroupsPayload(districtGroupsResult.value, scenarioId);
        if (bundle.loadDiagnostics?.optionalResources?.district_groups) {
          bundle.loadDiagnostics.optionalResources.district_groups = {
            ok: true,
            reason: districtGroupsResult.reason,
            errorMessage: districtGroupsResult.errorMessage,
            metrics: districtGroupsResult.metrics || null,
          };
        }
      }
      if (normalizeScenarioId(state.activeScenarioId) === scenarioId) {
        if (bundle.releasableCatalog) {
          state.releasableCatalog = mergeReleasableCatalogs(state.defaultReleasableCatalog, bundle.releasableCatalog);
          state.scenarioReleasableIndex = buildScenarioReleasableIndex(scenarioId, { excludeTags: [] });
        }
        if (bundle.districtGroupsPayload) {
          state.scenarioDistrictGroupsData = bundle.districtGroupsPayload;
          state.scenarioDistrictGroupByFeatureId = buildScenarioDistrictGroupByFeatureId(bundle.districtGroupsPayload);
        }
        syncScenarioUi();
      }
      resolve();
    }, 1200);
  });
}

function getScenarioRuntimePoliticalFeatureCount(runtimeTopologyPayload, runtimePoliticalMeta = null) {
  return getBundleLoaderScenarioRuntimePoliticalFeatureCount(runtimeTopologyPayload, runtimePoliticalMeta);
}

function validateScenarioRuntimeShellContract({
  runtimeTopologyPayload = null,
  runtimePoliticalMeta = null,
} = {}) {
  return validateBundleLoaderScenarioRuntimeShellContract({
    runtimeTopologyPayload,
    runtimePoliticalMeta,
  });
}

function hasScenarioRuntimeShellContract({
  runtimeTopologyPayload = null,
  runtimePoliticalMeta = null,
} = {}) {
  return hasBundleLoaderScenarioRuntimeShellContract({
    runtimeTopologyPayload,
    runtimePoliticalMeta,
  });
}

function normalizeScenarioRuntimeShell(manifest) {
  return normalizeBundleLoaderScenarioRuntimeShell(manifest, { normalizeScenarioId });
}

function scenarioSupportsChunkedRuntime(bundleOrManifest) {
  return bundleLoaderScenarioSupportsChunkedRuntime(bundleOrManifest, { normalizeScenarioId });
}

function scenarioBundleHasChunkedData(bundle) {
  return bundleLoaderScenarioBundleHasChunkedData(bundle);
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

let ensureScenarioChunkRegistryLoaded = null;

const {
  ensureRuntimeChunkLoadState,
  hasScenarioMergedLayerPayload,
  getScenarioRuntimeMergedLayerPayloads,
  applyScenarioPoliticalChunkPayload,
  resetScenarioChunkRuntimeState,
  preloadScenarioCoarseChunks,
  preloadScenarioFocusCountryPoliticalDetailChunk,
  scheduleScenarioChunkRefresh,
} = createScenarioChunkRuntimeController({
  state,
  getSearchParams,
  normalizeScenarioId,
  normalizeCountryCodeAlias,
  normalizeScenarioPerformanceHints,
  normalizeScenarioFeatureCollection,
  getScenarioFeatureCollectionIdentityList,
  areScenarioFeatureCollectionsEquivalent: areScenarioFeatureCollectionsEquivalent,
  getScenarioDefaultCountryCode,
  getScenarioBundleId,
  getCachedScenarioBundle,
  getVisibleScenarioChunkLayers,
  selectScenarioChunks,
  mergeScenarioChunkPayloads,
  normalizeScenarioRenderBudgetHints,
  loadScenarioChunkFile,
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
  getScenarioOptionalLayerConfig,
  syncScenarioLocalizationState,
  refreshMapDataForScenarioChunkPromotion,
  flushRenderBoundary,
  recordScenarioPerfMetric,
  ensureScenarioChunkRegistryLoaded: (...args) => ensureScenarioChunkRegistryLoaded(...args),
  refreshDelayInteracting: SCENARIO_CHUNK_REFRESH_DELAY_MS_INTERACTING,
  refreshDelayIdle: SCENARIO_CHUNK_REFRESH_DELAY_MS_IDLE,
});

ensureScenarioChunkRegistryLoaded = createScenarioChunkRegistryEnsurer({
  ensureRuntimeChunkLoadState,
});

let loadScenarioBundleForStartupHydration = null;

const {
  getScenarioTopologyFeatureCollection,
  ensureScenarioGeoLocalePatchForLanguage,
  applyBlankScenarioPresentationDefaults,
  /**
   * Hydrate active scenario runtime payloads into state from a startup bundle.
   * @param {{ bundle: object, scenarioId?: string, phase?: string }} [options]
   * @returns {Promise<{ ok: boolean, reason: string, appliedLayerKeys: string[] }>} Hydration outcome and applied payload summary.
   * @throws {Error} Throws when startup hydration cannot satisfy required runtime shell constraints.
   */
  hydrateActiveScenarioBundle,
  buildScenarioRuntimeVersionTag,
  hasRenderableScenarioPoliticalTopology: hasRenderableScenarioPoliticalTopologyFromStartupHydration,
  /**
   * Evaluate startup hydration health gate from active runtime ownership/controller coverage.
   * @param {{ phase?: string }} [options]
   * @returns {{ ok: boolean, report: object, overlayConsistency: object }} Health gate verdict and diagnostics.
   * @throws {Error} Does not throw under normal flow; callers treat failed health as non-throwing state.
   */
  evaluateScenarioHydrationHealthGateState,
  enforceScenarioHydrationHealthGate,
} = createScenarioStartupHydrationController({
  state,
  normalizeScenarioId,
  normalizeScenarioRuntimeTopologyPayload,
  normalizeScenarioGeoLocalePatchPayload,
  normalizeFeatureText: normalizeCityText,
  normalizeScenarioFeatureCollection,
  getScenarioRuntimePoliticalFeatureCount,
  getScenarioDecodedCollection,
  getScenarioRuntimeMergedLayerPayloads,
  hasScenarioMergedLayerPayload,
  areScenarioFeatureCollectionsEquivalent,
  applyScenarioPoliticalChunkPayload,
  loadOptionalScenarioResource,
  getScenarioGeoLocalePatchDescriptor,
  getLoadScenarioBundle: () => loadScenarioBundleForStartupHydration,
  syncScenarioLocalizationState,
  syncCountryUi,
  syncScenarioUi,
  setScenarioAuditUiState,
  mergeReleasableCatalogs,
  buildScenarioDistrictGroupByFeatureId,
  buildScenarioReleasableIndex,
  invalidateContextLayerVisualStateBatch,
  invalidateOceanWaterInteractionVisualState,
  refreshColorState,
  refreshMapDataForScenarioChunkPromotion,
  flushRenderBoundary,
  enterScenarioFatalRecovery,
  consumeScenarioTestHook,
  t,
  showToast,
  ownerFeatureCoverageMinRatio: SCENARIO_OWNER_FEATURE_COVERAGE_MIN_RATIO,
  ownerFeatureCoverageMinFeatures: SCENARIO_OWNER_FEATURE_COVERAGE_MIN_FEATURES,
});
const hasRenderableScenarioPoliticalTopology = hasRenderableScenarioPoliticalTopologyFromStartupHydration;

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

/**
 * Load scenario bundle data for bootstrap or full flow and cache by scenario id.
 *
 * bundleLevel path terms:
 * - "bootstrap": startup bundle path for startup bundle hydration.
 * - "full": full bundle path for complete runtime payloads.
 *
 * runtime topology URL fallback order keeps startup bundle/legacy fallback naming aligned with manifest fields.
 * @param {string} scenarioId
 * @param {{ d3Client?: { json: Function }, forceReload?: boolean, bundleLevel?: "bootstrap"|"full" }} [options]
 * @returns {Promise<object>} Scenario bundle with manifest, core payloads, runtime payloads, diagnostics, and chunk metadata.
 * @throws {Error} Throws for unknown scenario id, unavailable d3 client, required resource load failures, and invalid runtime shell payloads.
 */
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
  const runtimeShell = normalizeScenarioRuntimeShell(manifest);
  // bootstrap/full runtime topology resolution, with startup bundle/legacy fallback ordering from manifest/runtime shell fields.
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
        && hasScenarioRuntimeShellContract({
          runtimeTopologyPayload: coreEntry?.payload?.runtimeTopologyPayload,
          runtimePoliticalMeta: coreEntry?.payload?.runtimePoliticalMeta || null,
        })
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
  const {
    bundle,
    countriesResult,
    ownersResult,
    controllersResult,
    coresResult,
    runtimeTopologyResult,
    geoLocalePatchResult,
    ownerCount,
    controllerCount,
    countryCount,
  } = await assembleScenarioBundle({
    d3Client,
    targetId,
    requestedBundleLevel,
    meta,
    manifest,
    priorBundle,
    runtimeShell,
    runtimeTopologyUrl,
    geoLocalePatchDescriptor,
  });
  bundle.loadDiagnostics.requiredResources.manifest = manifestResult.metrics || null;
  if (requestedBundleLevel === "full") {
    if (scenarioSupportsChunkedRuntime(bundle)) {
      await ensureScenarioChunkRegistryLoaded(bundle, { d3Client });
    }
    scheduleScenarioDeferredBundleMetadataLoad(bundle, { d3Client });
  }
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
    if (hasScenarioRuntimeShellContract({
      runtimeTopologyPayload: bundle.runtimeTopologyPayload,
      runtimePoliticalMeta: bundle.runtimePoliticalMeta,
    })) {
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

loadScenarioBundleForStartupHydration = loadScenarioBundle;

const loadScenarioAuditPayload = createScenarioAuditPayloadLoader({
  state,
  normalizeScenarioId,
  loadScenarioBundle,
  setScenarioAuditUiState,
  syncScenarioUi,
  loadMeasuredJsonResource,
  cacheBust,
});

const validateImportedScenarioBaseline = createImportedScenarioBaselineValidator({
  normalizeScenarioId,
  loadScenarioBundle,
  getScenarioManifestVersion,
  getScenarioBaselineHashFromBundle,
});

export {
  applyBlankScenarioPresentationDefaults,
  createStartupScenarioBundleFromPayload,
  ensureRuntimeChunkLoadState,
  resetScenarioChunkRuntimeState,
  preloadScenarioCoarseChunks,
  preloadScenarioFocusCountryPoliticalDetailChunk,
  scheduleScenarioChunkRefresh,
  scenarioBundleHasChunkedData,
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
  getScenarioDecodedCollection,
  getScenarioTopologyFeatureCollection,
  ensureActiveScenarioOptionalLayerLoaded,
  ensureActiveScenarioOptionalLayersForVisibility,
  ensureScenarioGeoLocalePatchForLanguage,
  evaluateScenarioHydrationHealthGateState,
  buildScenarioRuntimeVersionTag,
  hasRenderableScenarioPoliticalTopology,
  hasScenarioRuntimeShellContract,
  validateScenarioRuntimeShellContract,
  hydrateActiveScenarioBundle,
  loadScenarioAuditPayload,
  loadScenarioBundle,
  loadScenarioRegistry,
  enforceScenarioHydrationHealthGate,
  releaseScenarioAuditPayload,
  validateImportedScenarioBaseline,
};
