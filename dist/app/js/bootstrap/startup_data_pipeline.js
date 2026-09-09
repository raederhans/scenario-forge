import {
  buildCityLocalizationPatch,
  loadCitySupportData,
  loadContextLayerPack,
  loadLocalizationData,
  normalizeRequestedContextLayerNames,
  loadMapData,
  resolveScenarioRegistryUrl,
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
import {
  SCENARIO_STARTUP_BUNDLE_MANIFEST_LANGUAGE_FIELDS,
  SCENARIO_STARTUP_GEO_ALIASES_FILENAME,
  SCENARIO_STARTUP_LOCALES_FILENAME,
} from "../core/scenario/locale_asset_contract.js";
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
  shouldDisableConfiguredDefaultScenario,
} from "./startup_bootstrap_support.js";
import {
  beginBaseCitySupportLoad,
  beginFullLocalizationLoad,
  commitBaseCitySupportData,
  commitContextLayerCollection,
  commitFullLocalizationData,
  decodeStartupPrimaryCollectionsIntoState,
  failBaseCitySupportLoad,
  failFullLocalizationLoad,
  hydrateStartupBaseContentState,
  setBaseCityDataPromise,
  setBaseLocalizationDataPromise,
  setContextLayerLoadPromise,
  setContextLayerLoadState,
} from "../core/state/content_state.js";
import { hydrateStartupPaletteState } from "../core/state/color_state.js";
import {
  finishBaseCitySupportLoad,
  finishFullLocalizationLoad,
  finishContextLayerLoad,
} from "../core/state/actions/content_load_actions.js";
import { hydrateStartupReleasableCatalogState } from "../core/state_catalog.js";
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
  // 这个 owner 只负责“启动期把数据送进 state”：
  // - base 资源首屏注入
  // - ready 之后按需补齐完整本地化 / 场景 bundle / context layers
  // 真正的地图渲染、场景 apply 和 ready 解锁仍由其他 owner 持有。
  const {
    checkpointBootMetric,
    finishBootMetric,
    invalidateContextLayerVisualStateBatch,
    requestMainRender,
    startBootMetric,
  } = helpers;

  // Page resources can serve several callers. Cancellation removes a receiver,
  // rather than aborting a fetch that another current receiver still needs.
  const resourceReceivers = new Map();
  function receiverIsCurrent({ taskContext, signal, isCurrent } = {}) {
    return !signal?.aborted && (!isCurrent || isCurrent())
      && (!taskContext || taskContext.isCurrent());
  }
  function assertReceiverCurrent(options) {
    if (!receiverIsCurrent(options)) {
      throw Object.assign(new Error("Hydration receiver is no longer current."), { name: "AbortError" });
    }
  }
  function registerResourceReceiver(key, options, pending) {
    if (!pending || !resourceReceivers.has(key)) resourceReceivers.set(key, new Set());
    const receivers = resourceReceivers.get(key);
    receivers.add(options);
    return {
      canCommit: () => [...receivers].some(receiverIsCurrent),
      shouldRender: () => [...receivers].some((receiver) => receiverIsCurrent(receiver) && receiver.renderNow !== false),
    };
  }

  async function ensureBaseCityDataReady(options = {}) {
    const { reason = "manual", renderNow = true } = options;
    assertReceiverCurrent(options);
    if (state.worldCitiesData && state.baseCityDataState === "loaded") {
      if (renderNow) {
        requestMainRender?.(`base-city-ready:${reason}`, { flush: true });
      }
      return state.worldCitiesData;
    }
    const { canCommit, shouldRender } = registerResourceReceiver("cities", options, state.baseCityDataPromise);
    if (state.baseCityDataPromise) {
      return state.baseCityDataPromise;
    }
    beginBaseCitySupportLoad(state);
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
        if (!canCommit()) return null;
        commitBaseCitySupportData(state, result, {
          scenarioActive: !!state.activeScenarioId,
        });
        if (state.activeScenarioId) {
          syncScenarioLocalizationState({
            cityOverridesPayload: state.scenarioCityOverridesData,
            geoLocalePatchPayload: state.scenarioGeoLocalePatchData,
          });
        }
        emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_DEV_WORKSPACE_UI);
        if (shouldRender()) {
          requestMainRender?.(`base-city-loaded:${reason}`, { flush: true });
        }
        console.info(`[boot] Base city support data loaded on demand. reason=${reason}`);
        return state.worldCitiesData;
      })
      .catch((error) => {
        if (!canCommit()) return null;
        failBaseCitySupportLoad(state, error);
        console.warn(`[boot] Failed to load base city support data. reason=${reason}`, error);
        throw error;
      }).finally(() => {
        finishBaseCitySupportLoad(state, { expectedPromise: promise, cancelled: !canCommit() });
      });
    setBaseCityDataPromise(state, promise);
    return promise;
  }

  async function ensureFullLocalizationDataReady(options = {}) {
    const { reason = "post-ready", renderNow = true } = options;
    assertReceiverCurrent(options);
    if (state.baseLocalizationLevel === "full" && state.baseLocalizationDataState === "loaded") {
      return {
        locales: state.locales,
        geoAliases: { alias_to_stable_key: state.geoAliasToStableKey || {} },
      };
    }
    const { canCommit, shouldRender } = registerResourceReceiver("localization", options, state.baseLocalizationDataPromise);
    if (state.baseLocalizationDataPromise) {
      return state.baseLocalizationDataPromise;
    }
    beginFullLocalizationLoad(state);
    startBootMetric?.("localization:full:load");
    const promise = loadLocalizationData({
      d3Client: globalThis.d3,
      localeLevel: "full",
    })
      .then((result) => {
        if (!canCommit()) return null;
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
        commitFullLocalizationData(state, {
          uiLocales: fullUiLocales,
          geoLocales: fullBaseGeoLocales,
          aliasToStableKey: fullBaseAliasMap,
          scenarioActive: !!state.activeScenarioId,
        });
        if (state.activeScenarioId) {
          syncScenarioLocalizationState({
            cityOverridesPayload: state.scenarioCityOverridesData,
            geoLocalePatchPayload: state.scenarioGeoLocalePatchData,
          });
        }
        finishBootMetric?.("localization:full:load", {
          reason,
          resourceMetrics: result.resourceMetrics || {},
        });
        emitStateBusEvent(STATE_BUS_EVENTS.UPDATE_DEV_WORKSPACE_UI);
        if (shouldRender()) {
          requestMainRender?.(`localization-full-ready:${reason}`, { flush: true });
        }
        return result;
      })
      .catch((error) => {
        if (!canCommit()) return null;
        const errorMessage = failFullLocalizationLoad(state, error);
        finishBootMetric?.("localization:full:load", {
          reason,
          failed: true,
          errorMessage,
        });
        console.warn(`[boot] Failed to hydrate full localization data. reason=${reason}`, error);
        throw error;
      }).finally(() => {
        finishFullLocalizationLoad(state, { expectedPromise: promise, cancelled: !canCommit() });
      });
    setBaseLocalizationDataPromise(state, promise);
    return promise;
  }

  async function ensureActiveScenarioBundleHydrated(options = {}) {
    const { reason = "post-ready", renderNow = true } = options;
    const scenarioId = String(state.activeScenarioId || "").trim();
    if (!scenarioId) return null;
    const requestId = state.currentScenarioApplyRequestId;
    const scenarioApplyEpoch = state.renderTransactionDiagnostics?.scenarioApplyEpoch ?? 0;
    const isCurrent = () => receiverIsCurrent(options)
      && String(state.activeScenarioId || "").trim() === scenarioId
      && state.currentScenarioApplyRequestId === requestId
      && (state.renderTransactionDiagnostics?.scenarioApplyEpoch ?? 0) === scenarioApplyEpoch;
    assertReceiverCurrent({ isCurrent });
    startBootMetric?.("scenario:full:hydrate");
    try {
      const bundle = await loadScenarioBundle(scenarioId, {
        d3Client: globalThis.d3,
        bundleLevel: "full",
      });
      assertReceiverCurrent({ isCurrent });
      hydrateActiveScenarioBundle(bundle, { renderNow });
      const healthGateResult = await enforceScenarioHydrationHealthGate({
        renderNow,
        reason,
        autoRetry: true,
        isCurrent,
      });
      assertReceiverCurrent({ isCurrent });
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
      assertReceiverCurrent({ isCurrent });
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
    options = {}
  ) {
    const { reason = "manual", renderNow = true } = options;
    assertReceiverCurrent(options);
    // 这里把“已在 topology 内的层”和“需要额外请求的 deferred pack”统一成同一个调用面，
    // 上层不必关心某个图层究竟来自首屏拓扑还是后续外部资源。
    const layerNames = expandDeferredContextLayerNames(requestedLayerNames);
    const results = {};
    const pendingEntries = [];
    for (const layerName of layerNames) {
      if (Array.isArray(state.contextLayerExternalDataByName?.[layerName]?.features)) {
        results[layerName] = state.contextLayerExternalDataByName[layerName];
        continue;
      }
      if (topologyAlreadyProvidesContextLayer(layerName)) {
        setContextLayerLoadState(state, layerName, "loaded", { clearError: true });
        results[layerName] = null;
        continue;
      }
      const { canCommit } = registerResourceReceiver(`context:${layerName}`, options, state.contextLayerLoadPromiseByName?.[layerName]);
      if (state.contextLayerLoadPromiseByName?.[layerName]) {
        pendingEntries.push({
          layerName,
          promise: state.contextLayerLoadPromiseByName[layerName],
        });
        continue;
      }
      setContextLayerLoadState(state, layerName, "loading", { clearError: true });
      startBootMetric?.(`layer:${layerName}:load`);
      const promise = loadContextLayerPack(layerName, globalThis.d3)
        .then((collection) => {
          if (!canCommit()) return null;
          if (!Array.isArray(collection?.features)) {
            setContextLayerLoadState(state, layerName, "error", {
              errorMessage: `Deferred context layer "${layerName}" is unavailable.`,
            });
            finishBootMetric?.(`layer:${layerName}:load`, {
              failed: true,
              reason,
            });
            return null;
          }
          commitContextLayerCollection(state, layerName, collection, { bumpRevision: true });
          setContextLayerLoadState(state, layerName, "loaded", { clearError: true });
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
          if (!canCommit()) return null;
          setContextLayerLoadState(state, layerName, "error", {
            errorMessage: error?.message || String(error || "Unknown context layer error."),
          });
          finishBootMetric?.(`layer:${layerName}:load`, {
            failed: true,
            reason,
          });
          console.warn(`[boot] Deferred context layer failed to load: ${layerName}. reason=${reason}`, error);
          return null;
        })
        .finally(() => {
          finishContextLayerLoad(state, layerName, { expectedPromise: promise, cancelled: !canCommit() });
        });
      setContextLayerLoadPromise(state, layerName, promise);
      pendingEntries.push({ layerName, promise });
    }

    if (pendingEntries.length) {
      const settled = await Promise.allSettled(pendingEntries.map(({ promise }) => promise));
      assertReceiverCurrent(options);
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

  function findScenarioRegistryEntry(registry, scenarioId) {
    const normalizedId = String(scenarioId || "").trim();
    if (!normalizedId) return null;
    return (Array.isArray(registry?.scenarios) ? registry.scenarios : [])
      .find((entry) => String(entry?.scenario_id || "").trim() === normalizedId) || null;
  }

  async function loadStartupScenarioManifestFromRegistry({
    d3Client,
    scenarioRegistryPromise,
    scenarioId,
  } = {}) {
    const registry = await scenarioRegistryPromise;
    const entry = findScenarioRegistryEntry(registry, scenarioId);
    const manifestUrl = String(entry?.manifest_url || "").trim();
    if (!manifestUrl) return null;
    if (!d3Client || typeof d3Client.json !== "function") {
      throw new Error("d3.json is not available for startup scenario manifest loading.");
    }
    return d3Client.json(manifestUrl);
  }

  function resolveStartupBundleUrlFromManifest(manifest, language, scenarioId) {
    if (!manifest) {
      return getStartupBundleUrl(scenarioId, language);
    }
    const normalizedLanguage = String(language || "en").trim().toLowerCase() === "zh" ? "zh" : "en";
    const languageField = SCENARIO_STARTUP_BUNDLE_MANIFEST_LANGUAGE_FIELDS[normalizedLanguage];
    return String(
      manifest?.[languageField]
      || manifest?.startup_bundle_url
      || ""
    ).trim();
  }

  /**
   * Startup阶段：场景引导解析。
   * 位置：base-data 入口，早于基础拓扑注入与场景 apply。
   * 状态副作用字段：返回启动 promise 组合，驱动后续 scenarioBundle/source 选择与 fallback 路径。
   */
  function resolveStartupScenarioBootstrap({ d3Client } = {}) {
    // 启动场景有两条来源：
    // 1) 优先走 startup bundle worker，尽量把首屏所需数据一次带齐；
    // 2) 若 bundle 缺失或 contract 不达标，则回退到 legacy bootstrap bundle。
    // 返回 promise 组而不是直接 await，是为了让主启动链能并行准备 registry、bundle 和 fallback 信息。
    const defaultScenarioDisabled = shouldDisableConfiguredDefaultScenario();
    const configuredDefaultScenarioId = defaultScenarioDisabled ? "" : getConfiguredDefaultScenarioId();
    const scenarioRegistryPromise = loadScenarioRegistry({ d3Client });
    const registryDefaultScenarioIdPromise = defaultScenarioDisabled
      ? Promise.resolve("")
      : configuredDefaultScenarioId
      ? Promise.resolve(configuredDefaultScenarioId)
      : scenarioRegistryPromise.then((registry) => {
        const defaultScenarioId = String(registry?.default_scenario_id || "").trim();
        if (!defaultScenarioId) {
          throw new Error(`Default scenario is not configured in ${resolveScenarioRegistryUrl()}.`);
        }
        return defaultScenarioId;
      });
    const requestedDefaultScenarioIdPromise = defaultScenarioDisabled
      ? Promise.resolve("")
      : configuredDefaultScenarioId
      ? Promise.resolve(configuredDefaultScenarioId)
      : registryDefaultScenarioIdPromise;
    const startupBundleLanguage = getStartupBundleLanguage();
    startBootMetric?.("scenario-bundle");
    const startupBundleResultPromise = requestedDefaultScenarioIdPromise
      .then(async (defaultScenarioId) => {
        if (!defaultScenarioId) {
          return {
            ok: true,
            skipped: true,
            scenarioId: "",
            source: "default-scenario-disabled",
          };
        }
        const startupScenarioManifest = await loadStartupScenarioManifestFromRegistry({
          d3Client,
          scenarioRegistryPromise,
          scenarioId: defaultScenarioId,
        });
        const startupBundleUrl = resolveStartupBundleUrlFromManifest(
          startupScenarioManifest,
          startupBundleLanguage,
          defaultScenarioId
        );
        if (!startupBundleUrl) {
          return {
            ok: false,
            skipped: true,
            scenarioId: defaultScenarioId,
            source: "manifest-no-startup-bundle",
            manifest: startupScenarioManifest,
          };
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
        if (!defaultScenarioId) {
          return {
            ok: true,
            skipped: true,
            scenarioId: "",
            source: "default-scenario-disabled",
          };
        }
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
    const startupBundleResult = await startupBundleResultPromise;
    const useScenarioStartupSupport = startupBundleResult?.ok === true;
    const startupScenarioLocalesUrl = getStartupScenarioSupportUrl(
      startupFallbackScenarioId,
      SCENARIO_STARTUP_LOCALES_FILENAME
    );
    const startupScenarioGeoAliasesUrl = getStartupScenarioSupportUrl(
      startupFallbackScenarioId,
      SCENARIO_STARTUP_GEO_ALIASES_FILENAME
    );
    return loadMapData({
      currentLanguage: state.currentLanguage || "en",
      d3Client,
      includeCityData: false,
      includeContextLayers: ["urban"],
      localeLevel: "startup",
      localesUrl: startupScenarioLocalesUrl || null,
      geoAliasesUrl: startupScenarioGeoAliasesUrl || null,
      useStartupWorker: true,
      useStartupCache: true,
      startupBootArtifactsOverride: Promise.resolve(
        useScenarioStartupSupport ? startupBundleResult.startupBootArtifactsOverride : null
      ),
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
    // 这里是启动链真正把 base payload 落到 runtimeState 的收口点。
    // 后续模块不该重复猜测这些字段来自哪里，而应通过这里注册的 hook 继续按需补齐。
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
    hydrateStartupReleasableCatalogState(state, releasableCatalog);
    hydrateStartupPaletteState(state, {
      paletteRegistry,
      activePaletteMeta,
      activePalettePack,
      activePaletteMap,
    });
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
