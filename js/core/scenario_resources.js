import {
  state as runtimeState,
} from "./state.js";
import {
  patchScenarioChunkLoadState,
} from "./state/actions/scenario_chunk_runtime_actions.js";
import { getScenarioChunkOptionalLayerState } from "./state/actions/scenario_activation_actions.js";
import { commitSpecialZoneLayersState } from "./state/actions/special_zone_actions.js";
import { ensureSovereigntyState, markLegacyColorStateDirty } from "./sovereignty_manager.js";
import { normalizeMapSemanticMode } from "./state.js";
import {
  createStartupHydrationRefreshPlan,
  invalidateContextLayerVisualStateBatch,
  invalidateOceanWaterInteractionVisualState,
  refreshColorState,
  refreshMapDataForScenarioChunkPromotion,
  refreshScenarioOpeningOwnerBorders,
} from "./scenario/scenario_renderer_bridge.js";
import {
  loadMeasuredJsonResource,
  resolveScenarioRegistryUrl,
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
  mergeScenarioChunkPayloadsForViewport,
  normalizeScenarioRenderBudgetHints,
  resolveRequiredScenarioSemanticLayers,
  selectScenarioChunks,
} from "./scenario_chunk_manager.js";
import {
  buildScenarioDistrictGroupByFeatureId,
  normalizeScenarioDistrictGroupsPayload,
} from "./scenario_districts.js";
import {
  SPECIAL_ZONE_LAYER_DIAGNOSTIC_CODES,
  normalizeSpecialZoneLayersState,
  resolveSpecialZoneTopologyFingerprint,
} from "./special_zone_layers.js";
import { normalizeCountryCodeAlias } from "./country_code_aliases.js";
import {
  flushRenderBoundary,
} from "./render_boundary.js";
import { buildScenarioReleasableIndex } from "./releasable_manager.js";
import { syncScenarioLocalizationState } from "./scenario_localization_state.js";
import {
  setScenarioAuditUiState,
  syncCountryUi,
  syncScenarioUi,
} from "./scenario_ui_sync.js";
import {
  enterScenarioFatalRecovery,
} from "./scenario_recovery.js";
import {
  normalizeScenarioFeatureCollection,
  getScenarioFeatureCollectionIdentityList,
  areScenarioFeatureCollectionsEquivalent,
  recordScenarioPerfMetric as sharedRecordScenarioPerfMetric,
} from "./scenario/pure_helpers.js";
import {
  cacheBust,
  getSearchParams,
  normalizeScenarioBundleLevel,
  scenarioBundleSatisfiesLevel,
  normalizeScenarioCoreMap as sharedNormalizeScenarioCoreMap,
  loadScenarioJsonWithTimeout as sharedLoadScenarioJsonWithTimeout,
  loadScenarioJsonResourceWithTimeout as sharedLoadScenarioJsonResourceWithTimeout,
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
  createScenarioBundleRuntimeController,
} from "./scenario/bundle_runtime.js";
import {
  normalizeScenarioPerformanceHints,
} from "./scenario/presentation_hint_helpers.js";
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
import {
  normalizeScenarioStrategicValuesPayload,
} from "./scenario/strategic_values.js";
import {
  registerRenderTransactionOptionalLayerConfigs,
  recordRenderTransactionSnapshot,
} from "./renderer/render_transaction_diagnostics.js";
import { consumeScenarioTestHook } from "./scenario_recovery.js";
import { t } from "./i18n.js";
import { callRuntimeHook } from "./state/index.js";

// scenario_resources.js 现在是 scenario runtime 的聚合门面：
// bundle loader、chunk runtime、startup hydration、optional layer、audit facade 都从这里汇合；
// 真正的重事务已拆到子 controller，本文件主要负责 wiring、共享约束和对外 facade。
const state = runtimeState;

function showToast(message, options = {}) {
  callRuntimeHook(null, "showToastFn", message, options);
}

const SCENARIO_DETAIL_SOURCE_FALLBACK_ORDER = ["na_v2", "na_v1", "legacy_bak", "highres"];
const SCENARIO_FATAL_RECOVERY_CODE = "SCENARIO_FATAL_RECOVERY";
const SCENARIO_CHUNK_REFRESH_DELAY_MS_INTERACTING = 180;
const SCENARIO_CHUNK_REFRESH_DELAY_MS_IDLE = 60;
const SCENARIO_OWNER_FEATURE_COVERAGE_MIN_RATIO = 0.85;
const SCENARIO_OWNER_FEATURE_COVERAGE_MIN_FEATURES = 1000;

function getCurrentScenarioApplyRequestId() {
  return Math.max(0, Number(runtimeState.currentScenarioApplyRequestId || 0));
}

function getCurrentScenarioApplyEpoch(scenarioId = "") {
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  if (!normalizedScenarioId) return 0;
  return Math.max(
    0,
    Number(
      runtimeState.renderTransactionDiagnostics
        ?.scenarioApplyEpochByScenarioId
        ?.[normalizedScenarioId]
        || 0
    )
  );
}

function isScenarioApplyContextCurrent({
  scenarioId = "",
  scenarioApplyEpoch = 0,
  scenarioApplyRequestId = 0,
  isScenarioApplyRequestCurrent = null,
} = {}) {
  if (typeof isScenarioApplyRequestCurrent === "function" && !isScenarioApplyRequestCurrent()) {
    return false;
  }
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  if (normalizedScenarioId && normalizedScenarioId !== normalizeScenarioId(runtimeState.activeScenarioId)) {
    return false;
  }
  const expectedApplyEpoch = Math.max(0, Number(scenarioApplyEpoch || 0));
  const currentApplyEpoch = getCurrentScenarioApplyEpoch(normalizedScenarioId);
  if (expectedApplyEpoch > 0 && currentApplyEpoch > 0 && expectedApplyEpoch !== currentApplyEpoch) {
    return false;
  }
  const expectedRequestId = Math.max(0, Number(scenarioApplyRequestId || 0));
  const currentRequestId = getCurrentScenarioApplyRequestId();
  return !(expectedRequestId > 0 && currentRequestId > 0 && expectedRequestId !== currentRequestId);
}

function recordScenarioApplyDiagnostic({
  phase = "",
  reason = "scenario-resources",
  scenarioId = "",
  requestedScenarioId = "",
  searchParams = null,
  extra = {},
} = {}) {
  recordRenderTransactionSnapshot(runtimeState, {
    phase,
    reason,
    requestedScenarioId,
    expectedScenarioId: scenarioId,
    source: "scenario_resources",
    searchParams,
    extra,
  });
}

function recordScenarioApplyStaleCallbackSkipped({
  callbackPhase = "",
  reason = "scenario-resources",
  scenarioId = "",
  scenarioApplyEpoch = 0,
  scenarioApplyRequestId = 0,
  extra = {},
} = {}) {
  recordScenarioApplyDiagnostic({
    phase: "scenario-apply-stale-callback-skipped",
    reason,
    scenarioId,
    extra: {
      ...extra,
      allowScenarioMismatch: true,
      callbackPhase,
      resolution: "skipped-stale-request",
      scenarioApplyEpoch: Math.max(0, Number(scenarioApplyEpoch || 0)),
      scenarioApplyRequestId: Math.max(0, Number(scenarioApplyRequestId || 0)),
      currentScenarioApplyRequestId: getCurrentScenarioApplyRequestId(),
      activeScenarioId: normalizeScenarioId(runtimeState.activeScenarioId),
    },
  });
}

function shouldContinueScenarioApplyContext(context, callbackPhase) {
  if (isScenarioApplyContextCurrent(context)) {
    return true;
  }
  recordScenarioApplyStaleCallbackSkipped({
    ...context,
    callbackPhase,
  });
  return false;
}

// optional layer 的单一映射表。
// 这里同时定义 bundle 字段、runtime state 字段、manifest URL、可见性开关和 revision 语义，
// 新增 layer 时优先补这里，而不是在各条加载链里散落硬编码字符串。
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
  scenario_atlantropa: {
    bundleField: "scenarioAtlantropaPayload",
    stateField: "scenarioAtlantropaData",
    urlField: "scenario_atlantropa_topology_url",
    objectName: "scenario_atlantropa",
    visibilityField: "showScenarioAtlantropa",
    revisionField: "scenarioAtlantropaRevision",
  },
  specialzonelayers: {
    bundleField: "specialZoneLayersPayload",
    stateField: "specialZoneLayers",
    urlField: "special_zone_layers_url",
    objectName: "",
    visibilityField: "showSpecialZones",
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
  strategicvalues: {
    bundleField: "strategicValuesPayload",
    stateField: "scenarioStrategicValuesData",
    urlField: "strategic_values_url",
    objectName: "",
    visibilityField: "showStrategicResourceMarkers",
    revisionField: "scenarioStrategicValuesRevision",
  },
};

registerRenderTransactionOptionalLayerConfigs(runtimeState, SCENARIO_OPTIONAL_LAYER_CONFIGS);

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

async function loadOptionalScenarioResource(d3Client, url, options = {}) {
  return sharedLoadOptionalScenarioResource(loadMeasuredJsonResource, d3Client, url, options);
}

async function loadMeasuredRequiredScenarioResource(d3Client, url, options = {}) {
  return sharedLoadMeasuredRequiredScenarioResource(loadMeasuredJsonResource, d3Client, url, options);
}

function getScenarioGeoLocalePatchDescriptor(manifest, language = runtimeState.currentLanguage) {
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
  scenarioRegistryUrl: resolveScenarioRegistryUrl(),
  loadScenarioJsonWithTimeout,
});

const assembleScenarioBundle = createScenarioBundleAssembler({
  loadMeasuredRequiredScenarioResource,
  loadOptionalScenarioResource,
});

function recordScenarioPerfMetric(name, durationMs, details = {}) {
  return sharedRecordScenarioPerfMetric(state, name, durationMs, details);
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

function getScenarioManifestSummary(manifest = runtimeState.activeScenarioManifest) {
  return getBundleLoaderScenarioManifestSummary(manifest);
}



function normalizeScenarioOptionalLayerKey(value) {
  const rawKey = String(value || "").trim().toLowerCase();
  let key = rawKey;
  if (rawKey === "special_zone_layers" || rawKey === "special-zone-layers") {
    key = "specialzonelayers";
  } else if (rawKey === "strategic_values" || rawKey === "strategic-values") {
    key = "strategicvalues";
  }
  return Object.prototype.hasOwnProperty.call(SCENARIO_OPTIONAL_LAYER_CONFIGS, key) ? key : "";
}

function getScenarioOptionalLayerConfig(layerKey) {
  const normalizedKey = normalizeScenarioOptionalLayerKey(layerKey);
  return normalizedKey ? SCENARIO_OPTIONAL_LAYER_CONFIGS[normalizedKey] : null;
}

function normalizeScenarioRuntimeTopologyPayload(payload) {
  return normalizeBundleLoaderScenarioRuntimeTopologyPayload(payload);
}

function normalizeScenarioRuntimePoliticalMeta(meta) {
  return normalizeStartupBundleRuntimePoliticalMeta(meta);
}

function scheduleScenarioDeferredBundleMetadataLoad(
  bundle,
  {
    d3Client = globalThis.d3,
    scenarioApplyEpoch = 0,
    scenarioApplyRequestId = 0,
    isScenarioApplyRequestCurrent = null,
  } = {}
) {
  if (!bundle?.manifest || bundle?.bundleLevel !== "full") {
    return null;
  }
  const scenarioId = normalizeScenarioId(bundle.manifest?.scenario_id || bundle.meta?.scenario_id);
  if (!scenarioId || !d3Client || typeof d3Client.json !== "function") {
    return null;
  }
  const transactionScenarioApplyEpoch =
    Math.max(0, Number(scenarioApplyEpoch || 0))
    || getCurrentScenarioApplyEpoch(scenarioId);
  const transactionScenarioApplyRequestId =
    Math.max(0, Number(scenarioApplyRequestId || 0))
    || getCurrentScenarioApplyRequestId();
  const currentnessContext = {
    scenarioId,
    scenarioApplyEpoch: transactionScenarioApplyEpoch,
    scenarioApplyRequestId: transactionScenarioApplyRequestId,
    isScenarioApplyRequestCurrent,
    reason: "scenario-deferred-metadata",
  };
  if (!bundle.deferredMetadataLoadPromise) {
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
        resolve();
      }, 1200);
    });
  }
  const commitLeaseKey = [
    scenarioId,
    transactionScenarioApplyEpoch,
    transactionScenarioApplyRequestId,
  ].join(":");
  if (bundle.deferredMetadataCommitLease?.key === commitLeaseKey) {
    bundle.deferredMetadataCommitLease.currentnessContext = currentnessContext;
    return bundle.deferredMetadataCommitLease.promise;
  }
  const commitLease = {
    key: commitLeaseKey,
    currentnessContext,
    promise: null,
  };
  commitLease.promise = bundle.deferredMetadataLoadPromise.then(() => {
    if (bundle.deferredMetadataCommitLease !== commitLease) {
      return false;
    }
    const leaseContext = commitLease.currentnessContext;
    if (!shouldContinueScenarioApplyContext(
      leaseContext,
      "deferred-metadata-before-apply"
    )) {
      return false;
    }
    try {
      return applyDeferredScenarioMetadata(bundle, {
        scenarioId: leaseContext.scenarioId,
        scenarioApplyEpoch: leaseContext.scenarioApplyEpoch,
        scenarioApplyRequestId: leaseContext.scenarioApplyRequestId,
        isScenarioApplyRequestCurrent: leaseContext.isScenarioApplyRequestCurrent,
      });
    } catch (error) {
      recordScenarioApplyDiagnostic({
        phase: "scenario-apply-deferred-metadata-commit-failed",
        reason: leaseContext.reason,
        scenarioId: leaseContext.scenarioId,
        requestedScenarioId: leaseContext.scenarioId,
        searchParams: getSearchParams(),
        extra: {
          allowScenarioMismatch: true,
          callbackPhase: "deferred-metadata-commit",
          resolution: "commit-failed",
          errorCode: String(error?.code || ""),
          errorMessage: String(error?.message || error || "Unknown deferred metadata commit error"),
          scenarioApplyEpoch: leaseContext.scenarioApplyEpoch,
          scenarioApplyRequestId: leaseContext.scenarioApplyRequestId,
        },
      });
      console.warn(
        `[scenario] Deferred metadata commit failed for "${leaseContext.scenarioId}".`,
        error,
      );
      return false;
    }
  });
  bundle.deferredMetadataCommitLease = commitLease;
  return commitLease.promise;
}

function applyDeferredScenarioMetadata(
  bundle,
  {
    scenarioId = "",
    scenarioApplyEpoch = 0,
    scenarioApplyRequestId = 0,
    isScenarioApplyRequestCurrent = null,
  } = {}
) {
  const normalizedScenarioId = normalizeScenarioId(
    scenarioId || bundle?.manifest?.scenario_id || bundle?.meta?.scenario_id
  );
  const currentnessContext = {
    scenarioId: normalizedScenarioId,
    scenarioApplyEpoch,
    scenarioApplyRequestId,
    isScenarioApplyRequestCurrent,
    reason: "scenario-deferred-metadata",
  };
  if (!normalizedScenarioId || !shouldContinueScenarioApplyContext(
    currentnessContext,
    "deferred-metadata-commit"
  )) {
    return false;
  }
  if (bundle.releasableCatalog) {
    runtimeState.releasableCatalog = mergeReleasableCatalogs(runtimeState.defaultReleasableCatalog, bundle.releasableCatalog);
    runtimeState.scenarioReleasableIndex = buildScenarioReleasableIndex(normalizedScenarioId, { excludeTags: [] });
  }
  if (bundle.districtGroupsPayload) {
    runtimeState.scenarioDistrictGroupsData = bundle.districtGroupsPayload;
    runtimeState.scenarioDistrictGroupByFeatureId = buildScenarioDistrictGroupByFeatureId(bundle.districtGroupsPayload);
  }
  syncScenarioUi();
  return true;
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
  awaitInitialScenarioChunkVisualPromotion,
  scheduleScenarioChunkRefresh,
} = createScenarioChunkRuntimeController({
  // chunk runtime 需要反向调用 getCachedScenarioBundle / ensureScenarioChunkRegistryLoaded；
  // 后者在本文件稍后才绑定真实实现，所以这里允许先注入占位引用，再由外层 wiring 补齐闭环。
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
  resolveRequiredScenarioSemanticLayers,
  selectScenarioChunks,
  mergeScenarioChunkPayloads,
  mergeScenarioChunkPayloadsForViewport,
  normalizeScenarioRenderBudgetHints,
  loadScenarioChunkFile,
  scenarioSupportsChunkedRuntime,
  scenarioBundleUsesChunkedLayer,
  getScenarioOptionalLayerConfig,
  isScenarioOptionalLayerRequestedForVisibility,
  syncScenarioLocalizationState,
  refreshMapDataForScenarioChunkPromotion,
  flushRenderBoundary,
  recordScenarioPerfMetric,
  ensureScenarioChunkRegistryLoaded: (...args) => ensureScenarioChunkRegistryLoaded(...args),
  refreshDelayInteracting: SCENARIO_CHUNK_REFRESH_DELAY_MS_INTERACTING,
  refreshDelayIdle: SCENARIO_CHUNK_REFRESH_DELAY_MS_IDLE,
});

ensureScenarioChunkRegistryLoaded = createScenarioChunkRegistryEnsurer({
  patchRuntimeChunkLoadState: (patch, options) =>
    patchScenarioChunkLoadState(state, patch, options),
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
   * @throws {Error} Does not throw under normal flow; callers treat failed health as non-throwing runtimeState.
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
  createStartupHydrationRefreshPlan,
  refreshMapDataForScenarioChunkPromotion,
  refreshScenarioOpeningOwnerBorders,
  flushRenderBoundary,
  enterScenarioFatalRecovery,
  consumeScenarioTestHook,
  t,
  showToast,
  ownerFeatureCoverageMinRatio: SCENARIO_OWNER_FEATURE_COVERAGE_MIN_RATIO,
  ownerFeatureCoverageMinFeatures: SCENARIO_OWNER_FEATURE_COVERAGE_MIN_FEATURES,
});
const hasRenderableScenarioPoliticalTopology = hasRenderableScenarioPoliticalTopologyFromStartupHydration;

function applyScenarioOptionalLayerState(
  bundle,
  layerKey,
  payload,
  {
    scenarioApplyEpoch = 0,
    scenarioApplyRequestId = 0,
    isScenarioApplyRequestCurrent = null,
    reason = "scenario-optional-layer-apply",
  } = {},
) {
  const config = getScenarioOptionalLayerConfig(layerKey);
  if (!config) return false;
  const bundleScenarioId = getScenarioBundleId(bundle);
  const transactionScenarioApplyEpoch = Math.max(0, Number(scenarioApplyEpoch || bundle?.chunkLifecycle?.scenarioApplyEpoch || 0));
  const transactionScenarioApplyRequestId = Math.max(0, Number(scenarioApplyRequestId || bundle?.chunkLifecycle?.scenarioApplyRequestId || 0));
  if (!bundleScenarioId || !shouldContinueScenarioApplyContext({
    scenarioId: bundleScenarioId,
    scenarioApplyEpoch: transactionScenarioApplyEpoch,
    scenarioApplyRequestId: transactionScenarioApplyRequestId,
    isScenarioApplyRequestCurrent,
    reason,
    extra: {
      layerKey,
    },
  }, "optional-layer-state-apply")) {
    return false;
  }
  if (config.stateField === "scenarioCityOverridesData") {
    syncScenarioLocalizationState({ cityOverridesPayload: payload });
  } else if (config.stateField === "scenarioStrategicValuesData") {
    state[config.stateField] = normalizeScenarioStrategicValuesPayload(payload, {
      expected: {
        scenario_id: bundleScenarioId,
        baseline_hash: state.scenarioBaselineHash || bundle?.manifest?.baseline_hash || "",
      },
    });
  } else if (config.stateField === "specialZoneLayers") {
    if (!payload || typeof payload !== "object") {
      const manifestHasLayerUrl = !!String(bundle?.manifest?.[config.urlField] || "").trim();
      if (manifestHasLayerUrl) {
        const topologyFingerprint = resolveSpecialZoneTopologyFingerprint(state);
        commitSpecialZoneLayersState(state, {
          version: 1,
          layers: [],
          activeLayerId: "",
          topologyFingerprint,
          diagnostics: [
            {
              code: SPECIAL_ZONE_LAYER_DIAGNOSTIC_CODES.LOAD_FAILED,
              scenarioId: bundleScenarioId,
            },
          ],
        }, {
          defaultSource: "scenario",
          topologyFingerprint,
          validFeatureIds: state.landIndex instanceof Map ? new Set(state.landIndex.keys()) : null,
        });
      }
      syncScenarioUi();
      return false;
    }
    commitSpecialZoneLayersState(state, payload, {
      defaultSource: "scenario",
      topologyFingerprint: resolveSpecialZoneTopologyFingerprint(state),
      validFeatureIds: state.landIndex instanceof Map ? new Set(state.landIndex.keys()) : null,
    });
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
    scenarioApplyEpoch = 0,
    scenarioApplyRequestId = 0,
    isScenarioApplyRequestCurrent = null,
  } = {}
) {
  const config = getScenarioOptionalLayerConfig(layerKey);
  if (!bundle || !config) return null;
  // optional layer 允许从 3 个来源收敛到同一份 bundle/runtime state：
  // 1) 现成 promise，避免并发重复请求
  // 2) runtime topology 内嵌对象，避免再走一次磁盘/网络
  // 3) manifest URL 指向的独立 payload
  // 外部只看最终 layerKey，不需要感知实际命中的来源。
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
      applyScenarioOptionalLayerState(bundle, layerKey, payload, {
        scenarioApplyEpoch,
        scenarioApplyRequestId,
        isScenarioApplyRequestCurrent,
        reason: "scenario-optional-layer-promise-cache",
      });
    }
    return payload;
  }
  if (forceReload) {
    delete bundle.optionalLayerSettledByKey[layerKey];
  }
  if (!forceReload && bundle.optionalLayerSettledByKey[layerKey] === true) {
    const payload = bundle[config.bundleField] ?? null;
    if (applyToActiveScenario) {
      applyScenarioOptionalLayerState(bundle, layerKey, payload, {
        scenarioApplyEpoch,
        scenarioApplyRequestId,
        isScenarioApplyRequestCurrent,
        reason: "scenario-optional-layer-settled-cache",
      });
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
    if (!requestUrl) {
      bundle[config.bundleField] = null;
      bundle.optionalLayerSettledByKey[layerKey] = true;
      return null;
    }
    if (!d3Client || typeof d3Client.json !== "function") {
      bundle[config.bundleField] = null;
      delete bundle.optionalLayerSettledByKey[layerKey];
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
        : layerKey === "specialzonelayers"
          ? normalizeSpecialZoneLayersState(rawPayload, {
            defaultSource: "scenario",
            topologyFingerprint: resolveSpecialZoneTopologyFingerprint(state),
          })
          : config.stateField === "scenarioStrategicValuesData"
            ? normalizeScenarioStrategicValuesPayload(rawPayload, {
              expected: {
                scenario_id: getScenarioBundleId(bundle),
                baseline_hash: state.scenarioBaselineHash || bundle?.manifest?.baseline_hash || "",
              },
            })
          : config.objectName
            ? getScenarioTopologyFeatureCollection(rawPayload, config.objectName)
              || normalizeScenarioFeatureCollection(rawPayload)
            : normalizeScenarioFeatureCollection(rawPayload);
      bundle[config.bundleField] = payload;
      bundle.optionalLayerSettledByKey[layerKey] = true;
      return payload;
    } catch (error) {
      console.warn(`[scenario] Failed to load scenario ${layerKey} layer for "${getScenarioBundleId(bundle)}".`, error);
      bundle[config.bundleField] = null;
      delete bundle.optionalLayerSettledByKey[layerKey];
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
      applyScenarioOptionalLayerState(bundle, layerKey, payload, {
        scenarioApplyEpoch,
        scenarioApplyRequestId,
        isScenarioApplyRequestCurrent,
        reason: "scenario-optional-layer-loaded",
      });
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
  // cache hit 的首要目标是尽快恢复首屏；可选层继续按可见性和面板动作懒加载，
  // 避免“读到了 startup cache”又立刻把可选 JSON 全部拉起，抵消缓存收益。
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
    scenarioApplyEpoch = 0,
    scenarioApplyRequestId = 0,
    isScenarioApplyRequestCurrent = null,
  } = {}
) {
  const normalizedKey = normalizeScenarioOptionalLayerKey(layerKey);
  if (!normalizedKey || !runtimeState.activeScenarioId) return null;
  const bundle = runtimeState.scenarioBundleCacheById?.[normalizeScenarioId(runtimeState.activeScenarioId)];
  if (!bundle) return null;
  if (scenarioBundleUsesChunkedLayer(bundle, normalizedKey)) {
    // chunk-owned layer 的数据所有权在 chunk refresh controller，这里只发刷新请求，不直接补拉独立 JSON。
    scheduleScenarioChunkRefresh({
      reason: `visibility:${normalizedKey}`,
      delayMs: 0,
      scenarioApplyRequestId,
    });
    return getScenarioChunkOptionalLayerState(state, normalizedKey) || null;
  }
  const payload = await loadScenarioOptionalLayerPayload(bundle, normalizedKey, {
    d3Client,
    forceReload,
    applyToActiveScenario: true,
    scenarioApplyEpoch,
    scenarioApplyRequestId,
    isScenarioApplyRequestCurrent,
  });
  if (!shouldContinueScenarioApplyContext({
    scenarioId: getScenarioBundleId(bundle),
    scenarioApplyEpoch,
    scenarioApplyRequestId,
    isScenarioApplyRequestCurrent,
    reason: `scenario-optional-layer:${normalizedKey}`,
  }, "optional-layer-loaded-before-render")) {
    return payload;
  }
  if (renderNow) {
    flushRenderBoundary(`scenario-optional-layer:${normalizedKey}`);
  }
  return payload;
}

function isScenarioOptionalLayerRequestedForVisibility(layerKey, config) {
  const normalizedKey = normalizeScenarioOptionalLayerKey(layerKey);
  if (normalizedKey === "strategicvalues") {
    return !!state.showStrategicResourceMarkers || !!String(state.strategicChoroplethMetric || "").trim();
  }
  const visibilityField = String(config?.visibilityField || "").trim();
  if (!visibilityField) return false;
  if (Object.prototype.hasOwnProperty.call(state, visibilityField)) {
    return !!state[visibilityField];
  }
  return visibilityField !== "showSpecialZones" && visibilityField !== "showStrategicResourceMarkers";
}

async function ensureActiveScenarioOptionalLayersForVisibility(
  {
    bundle = null,
    d3Client = globalThis.d3,
    renderNow = true,
    scenarioApplyEpoch = 0,
    scenarioApplyRequestId = 0,
    isScenarioApplyRequestCurrent = null,
  } = {}
) {
  const activeScenarioId = normalizeScenarioId(runtimeState.activeScenarioId);
  const activeBundle = bundle || runtimeState.scenarioBundleCacheById?.[activeScenarioId] || null;
  if (!activeScenarioId || !activeBundle) return [];
  const transactionScenarioApplyEpoch = Math.max(0, Number(scenarioApplyEpoch || activeBundle?.chunkLifecycle?.scenarioApplyEpoch || 0));
  const transactionScenarioApplyRequestId = Math.max(0, Number(scenarioApplyRequestId || activeBundle?.chunkLifecycle?.scenarioApplyRequestId || 0));
  const currentnessContext = {
    scenarioId: activeScenarioId,
    scenarioApplyEpoch: transactionScenarioApplyEpoch,
    scenarioApplyRequestId: transactionScenarioApplyRequestId,
    isScenarioApplyRequestCurrent,
    reason: "visibility-sync",
  };
  if (!shouldContinueScenarioApplyContext(currentnessContext, "optional-layer-visibility-sync-start")) {
    return [];
  }
  // chunked layer 和独立 payload layer 的可见性同步路径不同：
  // 前者交给 chunk refresh 统一决策，后者才在这里补拉 payload。
  // 这样可以避免把 chunk layer 当成普通 JSON 再加载一遍。
  const requestedChunkedLayers = Object.entries(SCENARIO_OPTIONAL_LAYER_CONFIGS)
    .filter(([layerKey, config]) => isScenarioOptionalLayerRequestedForVisibility(layerKey, config))
    .map(([layerKey]) => layerKey)
    .filter((layerKey) => scenarioBundleUsesChunkedLayer(activeBundle, layerKey));
  if (requestedChunkedLayers.length) {
    scheduleScenarioChunkRefresh({
      reason: "visibility-sync",
      delayMs: 0,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
    });
  }
  recordRenderTransactionSnapshot(runtimeState, {
    phase: "optional-layer-visibility-sync-start",
    reason: "visibility-sync",
    expectedScenarioId: activeScenarioId,
    source: "scenario_resources",
    extra: {
      requestedChunkedLayers,
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
    },
  });
  const requestedLayers = Object.entries(SCENARIO_OPTIONAL_LAYER_CONFIGS)
    .filter(([layerKey, config]) => isScenarioOptionalLayerRequestedForVisibility(layerKey, config))
    .filter(([layerKey]) => !scenarioBundleUsesChunkedLayer(activeBundle, layerKey))
    .filter(([layerKey]) => activeBundle.optionalLayerSettledByKey?.[layerKey] !== true)
    .filter(([layerKey, config]) => {
      if (config.stateField === "specialZoneLayers") {
        return !activeBundle[config.bundleField];
      }
      return !activeBundle[config.bundleField] && !state[config.stateField];
    })
    .map(([layerKey]) => layerKey);
  if (!requestedLayers.length) {
    recordRenderTransactionSnapshot(runtimeState, {
      phase: "optional-layer-visibility-sync-complete",
      reason: "visibility-sync",
      expectedScenarioId: activeScenarioId,
      source: "scenario_resources",
      extra: {
        requestedChunkedLayers,
        requestedLayers,
        loadedPayloadCount: 0,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
      },
    });
    return [];
  }
  const payloads = await Promise.all(
    requestedLayers.map((layerKey) =>
      loadScenarioOptionalLayerPayload(activeBundle, layerKey, {
        d3Client,
        applyToActiveScenario: true,
        scenarioApplyEpoch: transactionScenarioApplyEpoch,
        scenarioApplyRequestId: transactionScenarioApplyRequestId,
        isScenarioApplyRequestCurrent,
      })
    )
  );
  if (!shouldContinueScenarioApplyContext(currentnessContext, "optional-layer-visibility-sync-after-load")) {
    return [];
  }
  if (renderNow) {
    flushRenderBoundary("scenario-optional-layers-visibility");
  }
  recordRenderTransactionSnapshot(runtimeState, {
    phase: "optional-layer-visibility-sync-complete",
    reason: "visibility-sync",
    expectedScenarioId: activeScenarioId,
    source: "scenario_resources",
    extra: {
      requestedChunkedLayers,
      requestedLayers,
      loadedPayloadCount: payloads.length,
      scenarioApplyEpoch: transactionScenarioApplyEpoch,
      scenarioApplyRequestId: transactionScenarioApplyRequestId,
    },
  });
  return payloads;
}

function getCachedScenarioBundle(scenarioId = runtimeState.activeScenarioId) {
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  if (!normalizedScenarioId) return null;
  return runtimeState.scenarioBundleCacheById?.[normalizedScenarioId] || null;
}

function releaseScenarioAuditPayload(scenarioId = runtimeState.activeScenarioId, { syncUi = true } = {}) {
  const normalizedScenarioId = normalizeScenarioId(scenarioId);
  const bundle = getCachedScenarioBundle(normalizedScenarioId);
  if (bundle) {
    bundle.auditPayload = null;
  }
  // 当前激活场景的 audit 还会驱动 sidebar/panel 状态；
  // 释放缓存时要同步把 runtimeState 和 UI facade 一起清空，避免旧场景报告残留到新场景。
  if (!normalizedScenarioId || normalizeScenarioId(runtimeState.activeScenarioId) === normalizedScenarioId) {
    runtimeState.scenarioAudit = null;
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

const {
  loadScenarioBundle,
} = createScenarioBundleRuntimeController({
  // bundle_runtime 拥有 bundle 事务、startup cache 读写和 registry 解析；
  // scenario_resources 保留的职责只是把 facade 暴露给上层，并补齐 optional layer / deferred metadata 这些共享接线。
  state,
  STARTUP_CACHE_KINDS,
  normalizeScenarioId,
  normalizeScenarioBundleLevel,
  normalizeScenarioLanguage,
  scenarioBundleSatisfiesLevel,
  scenarioBundleUsesChunkedLayer,
  scenarioSupportsChunkedRuntime,
  scenarioBundleHasChunkedData,
  prewarmScenarioOptionalLayersOnCacheHit,
  recordScenarioPerfMetric,
  loadScenarioRegistry,
  getScenarioMetaById,
  loadScenarioJsonResourceWithTimeout,
  getScenarioGeoLocalePatchDescriptor,
  normalizeScenarioRuntimeShell,
  isStartupCacheEnabled,
  createStartupScenarioBootstrapCoreCacheKey,
  createStartupScenarioBootstrapLocaleCacheKey,
  readStartupCacheEntry,
  writeStartupCacheEntry,
  hasScenarioRuntimeShellContract,
  createScenarioBootstrapBundleFromCache,
  createSerializableStartupScenarioBootstrapCorePayload,
  createSerializableStartupScenarioBootstrapLocalePayload,
  loadOptionalScenarioResource,
  normalizeScenarioGeoLocalePatchPayload,
  ensureScenarioChunkRegistryLoaded,
  assembleScenarioBundle,
  scheduleScenarioDeferredBundleMetadataLoad,
});

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
  awaitInitialScenarioChunkVisualPromotion,
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
  scheduleScenarioDeferredBundleMetadataLoad,
  validateImportedScenarioBaseline,
};
