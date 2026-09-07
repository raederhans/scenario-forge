import { getScenarioChunkOptionalLayerState } from "../state/actions/scenario_activation_actions.js";
import { loadMeasuredJsonResource, normalizeScenarioCityOverridesPayload } from "../data_loader.js";
import {
  normalizeSpecialZoneLayersState,
  resolveSpecialZoneTopologyFingerprint,
} from "../special_zone_layers.js";
import { normalizeScenarioStrategicValuesPayload } from "./strategic_values.js";
import { normalizeScenarioFeatureCollection } from "./pure_helpers.js";
import { cacheBust, normalizeScenarioId } from "./shared.js";
import { flushRenderBoundary } from "../render_boundary.js";
import { recordRenderTransactionSnapshot } from "../renderer/render_transaction_diagnostics.js";

// optional layer 的单一映射表。
// 这里同时定义 bundle 字段、runtime state 字段、manifest URL、可见性开关和 revision 语义，
// 新增 layer 时优先补这里，而不是在各条加载链里散落硬编码字符串。
export const SCENARIO_OPTIONAL_LAYER_CONFIGS = {
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

export function normalizeScenarioOptionalLayerKey(value) {
  const rawKey = String(value || "").trim().toLowerCase();
  let key = rawKey;
  if (rawKey === "special_zone_layers" || rawKey === "special-zone-layers") {
    key = "specialzonelayers";
  } else if (rawKey === "strategic_values" || rawKey === "strategic-values") {
    key = "strategicvalues";
  }
  return Object.prototype.hasOwnProperty.call(SCENARIO_OPTIONAL_LAYER_CONFIGS, key) ? key : "";
}

export function getScenarioOptionalLayerConfig(layerKey) {
  const normalizedKey = normalizeScenarioOptionalLayerKey(layerKey);
  return normalizedKey ? SCENARIO_OPTIONAL_LAYER_CONFIGS[normalizedKey] : null;
}

// Owns optional payload acquisition and visibility demand. Active-state application
// remains a fenced facade write; chunk-owned layers delegate to the chunk controller.
export function createScenarioOptionalLayerRuntime({
  state,
  getScenarioBundleId,
  getScenarioTopologyFeatureCollection,
  scenarioBundleUsesChunkedLayer,
  scheduleScenarioChunkRefresh,
  shouldContinueScenarioApplyContext,
  recordScenarioPerfMetric,
  applyScenarioOptionalLayerState,
}) {
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
    const applyLoadedPayload = (payload, reason) => {
      if (applyToActiveScenario) {
        applyScenarioOptionalLayerState(bundle, layerKey, payload, {
          scenarioApplyEpoch,
          scenarioApplyRequestId,
          isScenarioApplyRequestCurrent,
          reason,
        });
      }
      return payload;
    };
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
      return applyLoadedPayload(payload, "scenario-optional-layer-promise-cache");
    }
    if (forceReload) {
      delete bundle.optionalLayerSettledByKey[layerKey];
    }
    if (!forceReload && bundle.optionalLayerSettledByKey[layerKey] === true) {
      const payload = bundle[config.bundleField] ?? null;
      return applyLoadedPayload(payload, "scenario-optional-layer-settled-cache");
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
      return applyLoadedPayload(payload, "scenario-optional-layer-loaded");
    } finally {
      delete bundle.optionalLayerPromises[layerKey];
    }
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
    if (!normalizedKey || !state.activeScenarioId) return null;
    const bundle = state.scenarioBundleCacheById?.[normalizeScenarioId(state.activeScenarioId)];
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
    const activeScenarioId = normalizeScenarioId(state.activeScenarioId);
    const activeBundle = bundle || state.scenarioBundleCacheById?.[activeScenarioId] || null;
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
    const recordVisibilitySnapshot = (phase, extra = {}) => {
      recordRenderTransactionSnapshot(state, {
        phase,
        reason: "visibility-sync",
        expectedScenarioId: activeScenarioId,
        source: "scenario_resources",
        extra: {
          requestedChunkedLayers,
          scenarioApplyEpoch: transactionScenarioApplyEpoch,
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
          ...extra,
        },
      });
    };
    recordVisibilitySnapshot("optional-layer-visibility-sync-start");
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
      recordVisibilitySnapshot("optional-layer-visibility-sync-complete", {
        requestedLayers,
        loadedPayloadCount: 0,
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
    recordVisibilitySnapshot("optional-layer-visibility-sync-complete", {
      requestedLayers,
      loadedPayloadCount: payloads.length,
    });
    return payloads;
  }

  return {
    ensureActiveScenarioOptionalLayerLoaded,
    ensureActiveScenarioOptionalLayersForVisibility,
    isScenarioOptionalLayerRequestedForVisibility,
  };
}
