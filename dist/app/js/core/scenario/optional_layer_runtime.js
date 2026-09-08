import { getScenarioChunkOptionalLayerState } from "../state/actions/scenario_activation_actions.js";
import { normalizeScenarioId } from "./shared.js";
import { flushRenderBoundary } from "../render_boundary.js";

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

// Owns visibility demand and completion fences. The facade owns request/cache
// settlement; chunk-owned layers delegate to the chunk controller.
export function createScenarioOptionalLayerRuntime(state, {
  getScenarioBundleId,
  scenarioBundleUsesChunkedLayer,
  scheduleScenarioChunkRefresh,
  shouldContinueScenarioApplyContext,
  loadScenarioOptionalLayerPayloadById,
  recordOptionalLayerVisibilitySnapshot,
}) {
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
    const payload = await loadScenarioOptionalLayerPayloadById(String(getScenarioBundleId(bundle)), normalizedKey, {
      d3Client,
      forceReload,
      applyToActiveScenario: true,
      scenarioApplyEpoch,
      scenarioApplyRequestId,
      isScenarioApplyRequestCurrent,
    });
    if (state.scenarioBundleCacheById?.[getScenarioBundleId(bundle)] !== bundle) return payload;
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
    if (state.scenarioBundleCacheById?.[activeScenarioId] !== activeBundle) return [];
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
      recordOptionalLayerVisibilitySnapshot({
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
        loadScenarioOptionalLayerPayloadById(activeScenarioId, layerKey, {
          d3Client,
          applyToActiveScenario: true,
          scenarioApplyEpoch: transactionScenarioApplyEpoch,
          scenarioApplyRequestId: transactionScenarioApplyRequestId,
          isScenarioApplyRequestCurrent,
        })
      )
    );
    if (!shouldContinueScenarioApplyContext(currentnessContext, "optional-layer-visibility-sync-after-load")
      || state.scenarioBundleCacheById?.[activeScenarioId] !== activeBundle) {
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
