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
  normalizeIndexedCoreAssignmentPayload,
  normalizeIndexedTagAssignmentPayload,
  normalizeRuntimePoliticalMeta as normalizeStartupBundleRuntimePoliticalMeta,
} from "./startup_bundle_compaction.js";
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
import { applyActivePaletteState, setActivePaletteSource, syncResolvedDefaultCountryPalette } from "./palette_manager.js";
import { markDirty } from "./dirty_state.js";
import {
  buildScenarioReleasableIndex,
  getScenarioReleasableCountries,
} from "./releasable_manager.js";
import {
  DETAIL_POLITICAL_MIN_FEATURES,
  SCENARIO_DETAIL_MIN_RATIO_STRICT,
  evaluateScenarioDataHealth,
  hasUsablePoliticalTopology,
  refreshScenarioDataHealth,
  scenarioNeedsDetailTopology,
} from "./scenario_data_health.js";
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
  evaluateScenarioHydrationHealthGateState,
  buildScenarioRuntimeVersionTag,
  hasRenderableScenarioPoliticalTopology,
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
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
  validateImportedScenarioBaseline,
} from "./scenario_resources.js";
import { assertScenarioInteractionsAllowed, buildScenarioFatalRecoveryError, clearScenarioFatalRecoveryState, consumeScenarioTestHook, enterScenarioFatalRecovery, formatScenarioFatalRecoveryMessage, getScenarioFatalRecoveryState, validateScenarioRuntimeConsistency } from "./scenario_recovery.js";
import { captureScenarioApplyRollbackSnapshot, restoreScenarioApplyRollbackSnapshot } from "./scenario_rollback.js";
import {
  SCENARIO_RENDER_PROFILES,
  buildHoi4FarEastSovietOwnerBackfill,
  normalizeScenarioOceanFillColor,
  normalizeScenarioRenderProfile,
  recordScenarioPerfMetric as sharedRecordScenarioPerfMetric,
} from "./scenario/pure_helpers.js";
import {
  createScenarioApplyPipeline,
} from "./scenario_apply_pipeline.js";
import {
  cacheBust,
  getSearchParams,
  shouldBypassScenarioCache,
  normalizeScenarioBundleLevel,
  getScenarioBundleHydrationRank,
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
  getScenarioDefaultCountryCode as getBundleLoaderDefaultCountryCode,
} from "./scenario/bundle_loader.js";
import { t } from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";

const SCENARIO_DETAIL_SOURCE_FALLBACK_ORDER = ["na_v2", "na_v1", "legacy_bak", "highres"];
const SCENARIO_CHUNK_REFRESH_DELAY_MS_INTERACTING = 180;
const SCENARIO_CHUNK_REFRESH_DELAY_MS_IDLE = 60;
let activeScenarioApplyPromise = null;

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

function getScenarioTargetPaletteId(manifest) {
  return normalizeScenarioId(manifest?.palette_id) || "hoi4_vanilla";
}

function hasActiveScenarioPaletteLoaded(paletteId) {
  const targetPaletteId = normalizeScenarioId(paletteId);
  if (!targetPaletteId) {
    return false;
  }
  return normalizeScenarioId(state.activePaletteId) === targetPaletteId
    && !!state.activePalettePack
    && !!state.activePaletteMap;
}

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
  return getBundleLoaderScenarioRegistryEntries(state);
}

function getScenarioDisplayName(source, fallbackId = "") {
  return getBundleLoaderScenarioDisplayName(source, fallbackId, t);
}

function getScenarioNameMap(countryMap = {}) {
  return getBundleLoaderScenarioNameMap(countryMap);
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

function getScenarioFixedOwnerColors(
  countryMap = {}
) {
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


function getScenarioDefaultCountryCode(manifest, countryMap = {}) {
  return getBundleLoaderDefaultCountryCode(manifest, countryMap);
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
  const runtimePoliticalMeta = normalizeStartupBundleRuntimePoliticalMeta(cachedPayload?.runtimePoliticalMeta || null);
  const runtimeFeatureIds = Array.isArray(runtimePoliticalMeta?.featureIds)
    ? runtimePoliticalMeta.featureIds
    : [];
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
    ownersPayload: normalizeIndexedTagAssignmentPayload(cachedPayload?.ownersPayload, runtimeFeatureIds, "owners"),
    controllersPayload: normalizeIndexedTagAssignmentPayload(cachedPayload?.controllersPayload, runtimeFeatureIds, "controllers"),
    coresPayload: normalizeIndexedCoreAssignmentPayload(cachedPayload?.coresPayload, runtimeFeatureIds),
    waterRegionsPayload: priorBundle?.waterRegionsPayload || null,
    specialRegionsPayload: priorBundle?.specialRegionsPayload || null,
    reliefOverlaysPayload: priorBundle?.reliefOverlaysPayload || null,
    cityOverridesPayload: priorBundle?.cityOverridesPayload || null,
    geoLocalePatchPayload: normalizeScenarioGeoLocalePatchPayload(cachedPayload?.geoLocalePatchPayload),
    geoLocalePatchPayloadsByLanguage: {
      ...(priorBundle?.geoLocalePatchPayloadsByLanguage || {}),
    },
    runtimeTopologyPayload: normalizeScenarioRuntimeTopologyPayload(cachedPayload?.runtimeTopologyPayload),
    runtimePoliticalMeta,
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
  const syncScenarioReadyUiAfterPromotion = () => {
    refreshScenarioDataHealth({
      showWarningToast: false,
      showErrorToast: false,
    });
    syncScenarioUi();
    syncCountryUi({ renderNow: false });
  };
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
    state.detailDeferred = false;
    state.detailPromotionCompleted = true;
    syncScenarioReadyUiAfterPromotion();
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
      syncScenarioReadyUiAfterPromotion();
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

const {
  prepareScenarioApplyState,
  applyPreparedScenarioState,
} = createScenarioApplyPipeline({
  state,
  countryNames,
  normalizeScenarioId,
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
  scenarioBundleHasChunkedData,
  ensureScenarioDetailTopologyLoaded,
  hasUsablePoliticalTopology,
  scenarioNeedsDetailTopology,
  getScenarioDisplayName,
  getScenarioTargetPaletteId,
  hasActiveScenarioPaletteLoaded,
  applyActivePaletteState,
  setActivePaletteSource,
  getScenarioDefaultCountryCode,
  getScenarioMapSemanticMode,
  buildScenarioReleasableIndex,
  getScenarioReleasableCountries,
  normalizeScenarioCoreMap,
  normalizeScenarioDistrictGroupsPayload,
  getActiveScenarioMergedChunkLayerPayload,
  getScenarioDecodedCollection,
  getScenarioTopologyFeatureCollection,
  getScenarioNameMap,
  getMissingScenarioNameTags,
  getScenarioFixedOwnerColors,
  buildHoi4FarEastSovietOwnerBackfill,
  buildScenarioRuntimeVersionTag,
  mergeReleasableCatalogs,
  buildScenarioDistrictGroupByFeatureId,
  syncScenarioLocalizationState,
  applyBlankScenarioPresentationDefaults,
  setScenarioAuditUiState,
  getScenarioBaselineHashFromBundle,
  markLegacyColorStateDirty,
  syncScenarioInspectorSelection,
  disableScenarioParentBorders,
  applyScenarioPaintMode,
  syncScenarioOceanFillForActivation,
  applyScenarioPerformanceHints,
  scheduleScenarioChunkRefresh,
  resetScenarioChunkRuntimeState,
  ensureRuntimeChunkLoadState,
  recalculateScenarioOwnerControllerDiffCount,
  hasRenderableScenarioPoliticalTopology,
  normalizeScenarioFeatureCollection,
});

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

    applyPreparedScenarioState(bundle, staged);
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
    if (bundle.loadDiagnostics?.startupBundle) {
      const startupHydrationHealth = evaluateScenarioHydrationHealthGateState({
        phase: "startup",
      });
      if (!startupHydrationHealth.ok) {
        throw new Error(
          `[scenario] Startup hydration health gate failed for "${staged.scenarioId}". reason=${
            !startupHydrationHealth.report.healthy
              ? startupHydrationHealth.report.reason
              : startupHydrationHealth.overlayConsistency.reason
          }, overlap=${startupHydrationHealth.report.overlapCount}/${startupHydrationHealth.report.renderedFeatureCount}, ratio=${startupHydrationHealth.report.overlapRatio.toFixed(3)}`
        );
      }
    }
    const currentPoliticalCoreReadyMetric = state.scenarioPerfMetrics?.timeToPoliticalCoreReady;
    const hasCurrentPoliticalCoreReadyMetric =
      currentPoliticalCoreReadyMetric
      && String(currentPoliticalCoreReadyMetric.scenarioId || "") === staged.scenarioId;
    if (
      !hasCurrentPoliticalCoreReadyMetric
      && (
        hasChunkedRuntime
        || !!state.scenarioPoliticalChunkData
        || hasRenderableScenarioPoliticalTopology(state.runtimePoliticalTopology)
      )
    ) {
      recordScenarioPerfMetric(
        "timeToPoliticalCoreReady",
        (globalThis.performance?.now ? globalThis.performance.now() : Date.now()) - applyStartedAt,
        {
          scenarioId: staged.scenarioId,
          source: "post-apply-coarse-ready",
          hasChunkedRuntime,
          mapRefreshMode: scenarioMapRefreshMode,
        }
      );
      if (bundle?.chunkLifecycle) {
        bundle.chunkLifecycle.politicalCoreReadyRecorded = true;
      }
    }
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
  if (
    normalizeScenarioId(state.activeScenarioId) === normalizedScenarioId
    && !state.startupReadonly
    && !state.startupReadonlyUnlockInFlight
    && String(state.topologyBundleMode || "") === "composite"
  ) {
    return state.scenarioBundleCacheById?.[normalizedScenarioId] || null;
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
  state.scenarioRuntimeTopologyVersionTag = "";
  state.scenarioPoliticalChunkData = null;
  state.scenarioLandMaskData = null;
  state.scenarioContextLandMaskData = null;
  state.scenarioLandMaskVersionTag = "";
  state.scenarioContextLandMaskVersionTag = "";
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
  state.scenarioWaterOverlayVersionTag = "";
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
  state.scenarioHydrationHealthGate = {
    status: "idle",
    reason: "",
    checkedAt: 0,
    attemptedRetry: false,
    ownerFeatureOverlapRatio: 1,
    ownerFeatureOverlapCount: 0,
    ownerFeatureRenderedCount: 0,
    degradedWaterOverlay: false,
  };
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
  const liveHealth = evaluateScenarioDataHealth(state.activeScenarioManifest, {
    minRatio: Number(state.scenarioDataHealth?.minRatio || SCENARIO_DETAIL_MIN_RATIO_STRICT),
  });
  const warning = String(liveHealth?.warning || state.scenarioDataHealth?.warning || "").trim();
  if (
    state.scenarioHydrationHealthGate?.status === "degraded"
    && String(state.scenarioHydrationHealthGate?.reason || "").startsWith("runtime-overlay-")
  ) {
    return `${displayName} · ${t("Overlay fallback active; editing remains available.", "ui")}`;
  }
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
