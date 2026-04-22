import {
  buildCityLocalizationPatch,
  loadCitySupportData,
  loadContextLayerPack,
  loadLocalizationData,
  normalizeRequestedContextLayerNames,
  loadMapData,
} from "../core/data_loader.js";
import {
  createStartupScenarioBundleFromPayload,
  enforceScenarioHydrationHealthGate,
  hydrateActiveScenarioBundle,
  loadScenarioBundle,
  loadScenarioRegistry,
  validateScenarioRuntimeShellContract,
} from "../core/scenario_resources.js";
import { syncScenarioLocalizationState } from "../core/scenario_localization_state.js";
import { applyActivePaletteState } from "../core/palette_manager.js";
import { loadStartupBundleViaWorker } from "../core/startup_worker_client.js";
import {
  createStartupBootArtifactsOverride,
  createStartupBundleLoadDiagnostics,
  formatStartupRuntimeShellContractFailure,
  getConfiguredDefaultScenarioId,
  getStartupBundleLanguage,
  getStartupBundleUrl,
  getStartupScenarioSupportUrl,
  hydrateViewSettings,
  nowMs,
  processHierarchyData,
} from "./startup_bootstrap_support.js";
import {
  decodeStartupPrimaryCollectionsIntoState,
  hydrateStartupBaseContentState,
} from "../core/state/content_state.js";
import {
  STATE_BUS_EVENTS,
  emitStateBusEvent,
  registerRuntimeHook,
} from "../core/state/index.js";

const CONTEXT_LAYER_LOAD_ORDER = [
  "rivers",
  "roads",
  "railways",
  "rail_stations_major",
  "urban",
  "physical",
  "physical_semantics",
  "physical_contours_major",
  "physical_contours_minor",
];

const PHYSICAL_CONTEXT_LAYER_SET = [
  "physical",
  "physical_semantics",
];

const PHYSICAL_CONTOUR_LAYER_SET = [
  "physical_contours_major",
  "physical_contours_minor",
];

export function createStartupDataPipelineOwner({
  state,
  helpers = {},
} = {}) {
  const {
    checkpointBootMetric,
    finishBootMetric,
    invalidateContextLayerVisualStateBatch,
    requestMainRender,
    startBootMetric,
  } = helpers;

  async function ensureBaseCityDataReady({ reason = "manual", renderNow = true } = {}) {
    if (state.worldCitiesData && state.baseCityDataState === "loaded") {
      if (renderNow) {
        requestMainRender?.(`base-city-ready:${reason}`, { flush: true });
      }
      return state.worldCitiesData;
    }
    if (state.baseCityDataPromise) {
      return state.baseCityDataPromise;
    }
    state.baseCityDataState = "loading";
    state.baseCityDataError = "";
    const promise = loadCitySupportData({
      d3Client: globalThis.d3,
      locales: {
        ui: state.locales?.ui || {},
        geo: state.baseGeoLocales && typeof state.baseGeoLocales === "object"
          ? state.baseGeoLocales
          : (state.locales?.geo || {}),
      },
      geoAliases: {
        alias_to_stable_key: state.baseGeoAliasToStableKey && typeof state.baseGeoAliasToStableKey === "object"
          ? state.baseGeoAliasToStableKey
          : (state.geoAliasToStableKey || {}),
      },
    })
      .then((result) => {
        state.worldCitiesData = result.worldCities || null;
        state.baseCityAliasesData = result.cityAliases || null;
        state.baseGeoLocales = {
          ...(
            result.locales?.geo && typeof result.locales.geo === "object"
              ? result.locales.geo
              : (state.baseGeoLocales || {})
          ),
        };
        state.baseGeoAliasToStableKey = {
          ...(
            result.geoAliases?.alias_to_stable_key && typeof result.geoAliases.alias_to_stable_key === "object"
              ? result.geoAliases.alias_to_stable_key
              : (state.baseGeoAliasToStableKey || {})
          ),
        };
        if (state.activeScenarioId) {
          syncScenarioLocalizationState({
            cityOverridesPayload: state.scenarioCityOverridesData,
            geoLocalePatchPayload: state.scenarioGeoLocalePatchData,
          });
        } else {
          state.locales = {
            ...(state.locales || {}),
            geo: { ...state.baseGeoLocales },
          };
          state.geoAliasToStableKey = { ...state.baseGeoAliasToStableKey };
          state.cityLayerRevision = (Number(state.cityLayerRevision) || 0) + 1;
        }
        state.baseCityDataState = "loaded";
        state.baseCityDataPromise = null;
        emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_DEV_WORKSPACE_UI);
        if (renderNow) {
          requestMainRender?.(`base-city-loaded:${reason}`, { flush: true });
        }
        console.info(`[boot] Base city support data loaded on demand. reason=${reason}`);
        return state.worldCitiesData;
      })
      .catch((error) => {
        state.baseCityDataState = "error";
        state.baseCityDataError = error?.message || String(error || "Unknown city data loading error.");
        state.baseCityDataPromise = null;
        console.warn(`[boot] Failed to load base city support data. reason=${reason}`, error);
        throw error;
      });
    state.baseCityDataPromise = promise;
    return promise;
  }

  async function ensureFullLocalizationDataReady({ reason = "post-ready", renderNow = true } = {}) {
    if (state.baseLocalizationLevel === "full" && state.baseLocalizationDataState === "loaded") {
      return {
        locales: state.locales,
        geoAliases: { alias_to_stable_key: state.geoAliasToStableKey || {} },
      };
    }
    if (state.baseLocalizationDataPromise) {
      return state.baseLocalizationDataPromise;
    }
    state.baseLocalizationDataState = "loading";
    state.baseLocalizationDataError = "";
    startBootMetric?.("localization:full:load");
    const promise = loadLocalizationData({
      d3Client: globalThis.d3,
      localeLevel: "full",
    })
      .then((result) => {
        const fullBaseGeoLocales =
          result.locales?.geo && typeof result.locales.geo === "object"
            ? { ...result.locales.geo }
            : {};
        const fullUiLocales =
          result.locales?.ui && typeof result.locales.ui === "object"
            ? { ...result.locales.ui }
            : (state.locales?.ui || {});
        const fullBaseAliasMap =
          result.geoAliases?.alias_to_stable_key && typeof result.geoAliases.alias_to_stable_key === "object"
            ? { ...result.geoAliases.alias_to_stable_key }
            : {};
        if (state.worldCitiesData || state.baseCityAliasesData) {
          const cityPatch = buildCityLocalizationPatch({
            cityCollection: state.worldCitiesData || null,
            cityAliases: state.baseCityAliasesData || null,
          });
          Object.assign(fullBaseGeoLocales, cityPatch.geo || {});
          Object.assign(fullBaseAliasMap, cityPatch.aliasToStableKey || {});
        }
        state.baseGeoLocales = fullBaseGeoLocales;
        state.baseGeoAliasToStableKey = fullBaseAliasMap;
        state.baseLocalizationLevel = "full";
        state.locales = {
          ...(state.locales || {}),
          ui: fullUiLocales,
        };
        if (state.activeScenarioId) {
          syncScenarioLocalizationState({
            cityOverridesPayload: state.scenarioCityOverridesData,
            geoLocalePatchPayload: state.scenarioGeoLocalePatchData,
          });
        } else {
          state.locales = {
            ...(state.locales || {}),
            ui: fullUiLocales,
            geo: { ...state.baseGeoLocales },
          };
          state.geoAliasToStableKey = { ...state.baseGeoAliasToStableKey };
        }
        state.baseLocalizationDataState = "loaded";
        state.baseLocalizationDataError = "";
        state.baseLocalizationDataPromise = null;
        finishBootMetric?.("localization:full:load", {
          reason,
          resourceMetrics: result.resourceMetrics || {},
        });
        emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_DEV_WORKSPACE_UI);
        if (renderNow) {
          requestMainRender?.(`localization-full-ready:${reason}`, { flush: true });
        }
        return result;
      })
      .catch((error) => {
        state.baseLocalizationDataState = "error";
        state.baseLocalizationDataError = error?.message || String(error || "Unknown localization hydration error.");
        state.baseLocalizationDataPromise = null;
        finishBootMetric?.("localization:full:load", {
          reason,
          failed: true,
          errorMessage: state.baseLocalizationDataError,
        });
        console.warn(`[boot] Failed to hydrate full localization data. reason=${reason}`, error);
        throw error;
      });
    state.baseLocalizationDataPromise = promise;
    return promise;
  }

  async function ensureActiveScenarioBundleHydrated({ reason = "post-ready", renderNow = true } = {}) {
    const scenarioId = String(state.activeScenarioId || "").trim();
    if (!scenarioId) return null;
    startBootMetric?.("scenario:full:hydrate");
    try {
      const bundle = await loadScenarioBundle(scenarioId, {
        d3Client: globalThis.d3,
        bundleLevel: "full",
      });
      hydrateActiveScenarioBundle(bundle, { renderNow });
      const healthGateResult = await enforceScenarioHydrationHealthGate({
        renderNow,
        reason,
        autoRetry: true,
      });
      finishBootMetric?.("scenario:full:hydrate", {
        reason,
        bundleLevel: bundle?.bundleLevel || "full",
        healthGateOk: healthGateResult?.ok !== false,
        healthGateRetried: !!healthGateResult?.attemptedRetry,
        ownerFeatureOverlapRatio: Number(healthGateResult?.report?.overlapRatio || 0),
        ownerFeatureOverlapCount: Number(healthGateResult?.report?.overlapCount || 0),
        ownerFeatureRenderedCount: Number(healthGateResult?.report?.renderedFeatureCount || 0),
        waterConsistency: String(healthGateResult?.waterConsistency?.reason || "unknown"),
      });
      return bundle;
    } catch (error) {
      finishBootMetric?.("scenario:full:hydrate", {
        reason,
        failed: true,
        errorMessage: error?.message || String(error || "Unknown scenario hydration error."),
      });
      console.warn(`[boot] Failed to hydrate active scenario bundle. reason=${reason}`, error);
      throw error;
    }
  }

  function hasHydrationFeatureCollectionData(collection) {
    return Array.isArray(collection?.features) && collection.features.length > 0;
  }

  function shouldFastTrackScenarioHydration() {
    const manifest = state.activeScenarioManifest;
    if (!manifest || !String(state.activeScenarioId || "").trim()) {
      return false;
    }
    const runtimeTopologyUrl = String(
      manifest.runtime_topology_url
      || manifest.runtime_bootstrap_topology_url
      || manifest.startup_topology_url
      || ""
    ).trim();
    if (!runtimeTopologyUrl) {
      return false;
    }
    return (
      !hasHydrationFeatureCollectionData(state.scenarioLandMaskData)
      || !hasHydrationFeatureCollectionData(state.scenarioContextLandMaskData)
    );
  }

  function expandDeferredContextLayerNames(requestedLayerNames) {
    const requested = Array.isArray(requestedLayerNames) ? requestedLayerNames : [requestedLayerNames];
    const expanded = requested.flatMap((name) => {
      const normalized = String(name || "").trim().toLowerCase();
      if (!normalized) return [];
      if (normalized === "physical-set") {
        return PHYSICAL_CONTEXT_LAYER_SET;
      }
      if (normalized === "physical-contours-set") {
        return PHYSICAL_CONTOUR_LAYER_SET;
      }
      return [normalized];
    });
    const normalized = normalizeRequestedContextLayerNames(expanded);
    return normalized.sort((left, right) => {
      const leftIndex = CONTEXT_LAYER_LOAD_ORDER.indexOf(left);
      const rightIndex = CONTEXT_LAYER_LOAD_ORDER.indexOf(right);
      return (leftIndex < 0 ? 999 : leftIndex) - (rightIndex < 0 ? 999 : rightIndex);
    });
  }

  function updateContextLayerDerivedState(layerName, collection) {
    state.contextLayerExternalDataByName = {
      ...(state.contextLayerExternalDataByName || {}),
      [layerName]: collection,
    };
    if (layerName === "rivers") {
      state.riversData = collection;
    } else if (layerName === "airports") {
      state.airportsData = collection;
    } else if (layerName === "ports") {
      state.portsData = collection;
    } else if (layerName === "roads") {
      state.roadsData = collection;
    } else if (layerName === "road_labels") {
      state.roadLabelsData = collection;
    } else if (layerName === "railways") {
      state.railwaysData = collection;
    } else if (layerName === "rail_stations_major") {
      state.railStationsMajorData = collection;
    } else if (layerName === "urban") {
      state.urbanData = collection;
    } else if (layerName === "physical") {
      state.physicalData = collection;
    } else if (layerName === "physical_semantics") {
      state.physicalSemanticsData = collection;
    } else if (layerName === "physical_contours_major") {
      state.physicalContourMajorData = collection;
    } else if (layerName === "physical_contours_minor") {
      state.physicalContourMinorData = collection;
    }
  }

  function topologyAlreadyProvidesContextLayer(layerName) {
    const primaryTopology = state.topologyPrimary || state.topology;
    const detailTopology = state.topologyDetail;
    return Boolean(
      primaryTopology?.objects?.[layerName]
      || detailTopology?.objects?.[layerName]
    );
  }

  async function ensureContextLayerDataReady(
    requestedLayerNames,
    { reason = "manual", renderNow = true } = {}
  ) {
    const layerNames = expandDeferredContextLayerNames(requestedLayerNames);
    const results = {};
    const pendingEntries = [];
    for (const layerName of layerNames) {
      if (Array.isArray(state.contextLayerExternalDataByName?.[layerName]?.features)) {
        results[layerName] = state.contextLayerExternalDataByName[layerName];
        continue;
      }
      if (topologyAlreadyProvidesContextLayer(layerName)) {
        state.contextLayerLoadStateByName[layerName] = "loaded";
        results[layerName] = null;
        continue;
      }
      if (state.contextLayerLoadPromiseByName?.[layerName]) {
        pendingEntries.push({
          layerName,
          promise: state.contextLayerLoadPromiseByName[layerName],
        });
        continue;
      }
      state.contextLayerLoadStateByName[layerName] = "loading";
      state.contextLayerLoadErrorByName[layerName] = "";
      startBootMetric?.(`layer:${layerName}:load`);
      const promise = loadContextLayerPack(layerName, globalThis.d3)
        .then((collection) => {
          if (!Array.isArray(collection?.features)) {
            state.contextLayerLoadStateByName[layerName] = "error";
            state.contextLayerLoadErrorByName[layerName] = `Deferred context layer "${layerName}" is unavailable.`;
            finishBootMetric?.(`layer:${layerName}:load`, {
              failed: true,
              reason,
            });
            return null;
          }
          updateContextLayerDerivedState(layerName, collection);
          state.contextLayerRevision = (Number(state.contextLayerRevision) || 0) + 1;
          state.contextLayerLoadStateByName[layerName] = "loaded";
          if (
            layerName === "airports"
            || layerName === "ports"
            || layerName === "roads"
            || layerName === "railways"
            || layerName === "rail_stations_major"
          ) {
            emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_TRANSPORT_APPEARANCE_UI);
          }
          finishBootMetric?.(`layer:${layerName}:load`, {
            featureCount: collection.features.length,
            reason,
          });
          return collection;
        })
        .catch((error) => {
          state.contextLayerLoadStateByName[layerName] = "error";
          state.contextLayerLoadErrorByName[layerName] = error?.message || String(error || "Unknown context layer error.");
          finishBootMetric?.(`layer:${layerName}:load`, {
            failed: true,
            reason,
          });
          console.warn(`[boot] Deferred context layer failed to load: ${layerName}. reason=${reason}`, error);
          return null;
        })
        .finally(() => {
          delete state.contextLayerLoadPromiseByName[layerName];
        });
      state.contextLayerLoadPromiseByName[layerName] = promise;
      pendingEntries.push({ layerName, promise });
    }

    if (pendingEntries.length) {
      const settled = await Promise.allSettled(pendingEntries.map(({ promise }) => promise));
      const loadedLayerNames = [];
      settled.forEach((entry, index) => {
        const { layerName } = pendingEntries[index];
        const value = entry.status === "fulfilled" ? entry.value : null;
        results[layerName] = value;
        if (Array.isArray(value?.features)) {
          loadedLayerNames.push(layerName);
        }
      });
      if (loadedLayerNames.length) {
        invalidateContextLayerVisualStateBatch?.(loadedLayerNames, `context-layer:${reason}`, {
          renderNow,
        });
        if (renderNow) {
          loadedLayerNames.forEach((layerName) => {
            checkpointBootMetric?.(`layer:${layerName}:first-render-after-load`);
          });
        }
      }
    }
    return results;
  }

  /**
   * Startup阶段：场景引导解析。
   * 位置：base-data 入口，早于基础拓扑注入与场景 apply。
   * 状态副作用字段：返回启动 promise 组合，驱动后续 scenarioBundle/source 选择与 fallback 路径。
   */
  function resolveStartupScenarioBootstrap({ d3Client } = {}) {
    const configuredDefaultScenarioId = getConfiguredDefaultScenarioId();
    const scenarioRegistryPromise = configuredDefaultScenarioId
      ? Promise.resolve(null)
      : loadScenarioRegistry({ d3Client });
    const registryDefaultScenarioIdPromise = configuredDefaultScenarioId
      ? Promise.resolve(configuredDefaultScenarioId)
      : scenarioRegistryPromise.then((registry) => {
        const defaultScenarioId = String(registry?.default_scenario_id || "").trim();
        if (!defaultScenarioId) {
          throw new Error("Default scenario is not configured in data/scenarios/index.json.");
        }
        return defaultScenarioId;
      });
    const requestedDefaultScenarioIdPromise = configuredDefaultScenarioId
      ? Promise.resolve(configuredDefaultScenarioId)
      : registryDefaultScenarioIdPromise;
    const startupBundleLanguage = getStartupBundleLanguage();
    startBootMetric?.("scenario-bundle");
    const startupBundleResultPromise = requestedDefaultScenarioIdPromise
      .then(async (defaultScenarioId) => {
        const startupBundleUrl = getStartupBundleUrl(defaultScenarioId, startupBundleLanguage);
        if (!startupBundleUrl) {
          throw new Error("Default startup scenario bundle URL could not be resolved.");
        }
        const startupBundleResult = await loadStartupBundleViaWorker({
          startupBundleUrl,
          scenarioId: defaultScenarioId,
          language: startupBundleLanguage,
        });
        if (!startupBundleResult.payload) {
          throw new Error(`Startup bundle "${startupBundleUrl}" did not return a payload.`);
        }
        const loadDiagnostics = createStartupBundleLoadDiagnostics({
          startupBundleUrl,
          language: startupBundleLanguage,
          metrics: startupBundleResult.metrics,
        });
        const startupScenarioBundle = await createStartupScenarioBundleFromPayload({
          scenarioId: defaultScenarioId,
          language: startupBundleLanguage,
          payload: startupBundleResult.payload,
          runtimeDecodedCollections: startupBundleResult.runtimeDecodedCollections,
          runtimePoliticalMeta: startupBundleResult.runtimePoliticalMeta,
          loadDiagnostics,
          d3Client,
        });
        const runtimeShellContract = validateScenarioRuntimeShellContract({
          runtimeTopologyPayload: startupScenarioBundle.runtimeTopologyPayload,
          runtimePoliticalMeta: startupScenarioBundle.runtimePoliticalMeta,
        });
        if (
          String(startupScenarioBundle.bootstrapStrategy || "").trim() === "chunked-coarse-first"
          && !runtimeShellContract.ok
        ) {
          throw new Error(
            `[boot] Startup bundle for "${defaultScenarioId}" is missing the minimum runtime shell (${formatStartupRuntimeShellContractFailure(runtimeShellContract)}).`
          );
        }
        return {
          ok: true,
          scenarioId: defaultScenarioId,
          source: "startup-bundle",
          startupBundleUrl,
          startupBootArtifactsOverride: createStartupBootArtifactsOverride({
            payload: startupBundleResult.payload,
            baseDecodedCollections: startupBundleResult.baseDecodedCollections,
            metrics: startupBundleResult.metrics,
          }),
          bundle: startupScenarioBundle,
        };
      })
      .catch((error) => ({
        ok: false,
        source: "startup-bundle",
        error,
      }));
    const scenarioBundlePromise = requestedDefaultScenarioIdPromise
      .then(async (defaultScenarioId) => {
        const startupBundleResult = await startupBundleResultPromise;
        if (startupBundleResult.ok && startupBundleResult.bundle?.manifest) {
          return startupBundleResult;
        }
        if (startupBundleResult.error) {
          console.warn(
            `[boot] Startup bundle failed for "${defaultScenarioId}", falling back to legacy bootstrap bundle.`,
            startupBundleResult.error
          );
        }
        const bundle = await loadScenarioBundle(defaultScenarioId, {
          d3Client,
          bundleLevel: "bootstrap",
        });
        return {
          ok: true,
          scenarioId: defaultScenarioId,
          source: "legacy",
          bundle,
        };
      })
      .catch((error) => ({ ok: false, error }));

    return {
      configuredDefaultScenarioId,
      requestedDefaultScenarioIdPromise,
      registryDefaultScenarioIdPromise,
      scenarioBundlePromise,
      scenarioRegistryPromise,
      startupBundleResultPromise,
    };
  }

  /**
   * Startup阶段：基础资源加载。
   * 位置：场景引导解析之后、基础 state hydrate 之前。
   * 状态副作用字段：函数本身无直接写入；返回的 startupBaseData 将被下一阶段写入 state.topology/state.locales 等字段。
   */
  async function loadStartupBaseData({
    d3Client,
    startupFallbackScenarioId,
    startupBundleResultPromise,
  } = {}) {
    return loadMapData({
      currentLanguage: state.currentLanguage || "en",
      d3Client,
      includeCityData: false,
      includeContextLayers: ["urban"],
      localeLevel: "startup",
      localesUrl: getStartupScenarioSupportUrl(startupFallbackScenarioId, "locales.startup.json"),
      geoAliasesUrl: getStartupScenarioSupportUrl(startupFallbackScenarioId, "geo_aliases.startup.json"),
      useStartupWorker: true,
      useStartupCache: true,
      startupBootArtifactsOverride: startupBundleResultPromise.then((result) => (
        result.ok ? result.startupBootArtifactsOverride : null
      )),
    });
  }

  /**
   * Startup阶段：基础状态注入。
   * 位置：基础资源加载之后、地图初始化与场景 apply 之前。
   * 状态副作用字段：写入 topology/topologyPrimary/topologyDetail/runtimePoliticalTopology、
   * topologyBundleMode/detailDeferred/detailPromotionCompleted、locales/baseLocalization*、
   * contextLayer*、baseCity*、palette* 与启动期函数句柄（ensureBaseCityDataFn 等）。
   */
  function hydrateStartupBaseState({
    ensureBaseCityDataReadyFn,
    ensureContextLayerDataReadyFn,
    persistViewSettingsFn,
    startupBaseData,
  } = {}) {
    const {
      topology,
      topologyPrimary,
      topologyDetail,
      runtimePoliticalTopology,
      topologyBundleMode,
      renderProfile,
      detailDeferred,
      detailSourceRequested,
      locales,
      geoAliases,
      hierarchy,
      ruCityOverrides,
      specialZones,
      contextLayerExternal,
      paletteRegistry,
      releasableCatalog,
      activePaletteMeta,
      activePalettePack,
      activePaletteMap,
      localeLevel,
      startupBootCacheState,
    } = startupBaseData || {};

    hydrateStartupBaseContentState(state, {
      topology,
      topologyPrimary,
      topologyDetail,
      runtimePoliticalTopology,
      topologyBundleMode,
      renderProfile,
      detailDeferred,
      detailSourceRequested,
      locales,
      geoAliases,
      localeLevel,
      startupBootCacheState,
      ruCityOverrides,
      specialZones,
      contextLayerExternal,
    });
    state.paletteRegistry = paletteRegistry || null;
    state.defaultReleasableCatalog = releasableCatalog || null;
    state.releasableCatalog = releasableCatalog || null;
    state.activePaletteMeta = activePaletteMeta || null;
    state.activePalettePack = activePalettePack || null;
    state.activePaletteMap = activePaletteMap || null;
    state.activePaletteId = String(
      activePaletteMeta?.palette_id
      || paletteRegistry?.default_palette_id
      || state.activePaletteId
      || "hoi4_vanilla"
    ).trim();
    state.currentPaletteTheme = String(
      activePaletteMeta?.display_name
      || state.currentPaletteTheme
      || "HOI4 Vanilla"
    );
    state.palettePackCacheById = state.palettePackCacheById || {};
    state.paletteMapCacheById = state.paletteMapCacheById || {};
    state.paletteLoadErrorById = state.paletteLoadErrorById || {};
    if (state.activePaletteId && activePalettePack) {
      state.palettePackCacheById[state.activePaletteId] = activePalettePack;
    }
    if (state.activePaletteId && activePaletteMap) {
      state.paletteMapCacheById[state.activePaletteId] = activePaletteMap;
    }
    applyActivePaletteState({ overwriteCountryPalette: true });
    processHierarchyData(hierarchy);
    hydrateViewSettings();
    registerRuntimeHook(state, "persistViewSettingsFn", persistViewSettingsFn);
    registerRuntimeHook(state, "ensureBaseCityDataFn", ensureBaseCityDataReadyFn);
    registerRuntimeHook(state, "ensureContextLayerDataFn", ensureContextLayerDataReadyFn);
  }

  function decodeStartupPrimaryCollections({
    resourceMetrics = {},
    startupDecodedCollections = null,
  } = {}) {
    if (!state.topologyPrimary) {
      throw new Error("CRITICAL: TopoJSON file loaded but is null/undefined");
    }

    const objects = state.topologyPrimary.objects || {};
    if (!objects.political) {
      throw new Error("CRITICAL: 'political' object missing from TopoJSON");
    }
    const primaryCount = Array.isArray(objects.political.geometries)
      ? objects.political.geometries.length
      : 0;
    const detailCount =
      state.topologyDetail?.objects?.political?.geometries &&
      Array.isArray(state.topologyDetail.objects.political.geometries)
        ? state.topologyDetail.objects.political.geometries.length
        : 0;
    const overrideCount = Array.isArray(state.ruCityOverrides?.features)
      ? state.ruCityOverrides.features.length
      : 0;
    console.log(
      `[main] Loaded topology bundle mode=${state.topologyBundleMode}, primary=${primaryCount}, detail=${detailCount}, ruOverrides=${overrideCount}.`
    );

    const baseTopologyDecodeStartedAt = nowMs();
    decodeStartupPrimaryCollectionsIntoState(state, {
      startupDecodedCollections,
      topojsonClient: globalThis.topojson,
    });
    const baseTopologyDecodeMs = nowMs() - baseTopologyDecodeStartedAt;
    finishBootMetric?.("base-data", {
      topologyBundleMode: state.topologyBundleMode,
      primaryCount,
      detailCount,
      topologyDecodeMs: baseTopologyDecodeMs,
      resourceMetrics: resourceMetrics || {},
    });
  }

  return {
    decodeStartupPrimaryCollections,
    ensureBaseCityDataReady,
    ensureFullLocalizationDataReady,
    ensureActiveScenarioBundleHydrated,
    ensureContextLayerDataReady,
    hydrateStartupBaseState,
    loadStartupBaseData,
    resolveStartupScenarioBootstrap,
    shouldFastTrackScenarioHydration,
  };
}
