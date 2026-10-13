import { state as runtimeState } from "./state.js";
import {
  createDefaultScenarioDataHealth,
  normalizeScenarioDataHealthState,
} from "./state/scenario_runtime_state.js";
import {
  setScenarioDataHealthState,
} from "./state/actions/scenario_health_actions.js";
import { t } from "./i18n.js";
import { callRuntimeHook } from "./state/runtime_hooks.js";
const state = runtimeState;

function showToast(message, options = {}) {
  callRuntimeHook(null, "showToastFn", message, options);
}

const DETAIL_POLITICAL_MIN_FEATURES = 1000;
const SCENARIO_DETAIL_MIN_RATIO_STRICT = 0.7;
const SCENARIO_DETAIL_ABSOLUTE_DROP_THRESHOLD = 1000;

function getPoliticalGeometryCount(topology) {
  const geometries = topology?.objects?.political?.geometries;
  return Array.isArray(geometries) ? geometries.length : 0;
}

function getFeatureCollectionCount(collection) {
  return Array.isArray(collection?.features) ? collection.features.length : 0;
}

function getChunkedPoliticalExpectedFeatureCount() {
  return Math.max(
    getFeatureCollectionCount(runtimeState.scenarioPoliticalChunkData),
    getFeatureCollectionCount(runtimeState.activeScenarioChunks?.mergedLayerPayloads?.political),
  );
}

function getCurrentPoliticalCollectionFeatureCount() {
  return Math.max(
    getFeatureCollectionCount(runtimeState.landDataFull),
    getFeatureCollectionCount(runtimeState.landData),
  );
}

function getScenarioHealthExpectedFeatureCount(manifest) {
  const manifestFeatureCount = Number(manifest?.summary?.feature_count || 0);
  if (String(manifest?.detail_chunk_manifest_url || "").trim()) {
    const chunkedExpectedFeatureCount = getChunkedPoliticalExpectedFeatureCount();
    if (chunkedExpectedFeatureCount > 0) {
      return chunkedExpectedFeatureCount;
    }
    const currentPoliticalFeatureCount = getCurrentPoliticalCollectionFeatureCount();
    if (currentPoliticalFeatureCount > 0) {
      return currentPoliticalFeatureCount;
    }
  }
  return manifestFeatureCount;
}

function getScenarioHealthRuntimeFeatureCount() {
  return Math.max(
    getFeatureCollectionCount(runtimeState.landDataFull),
    getPoliticalGeometryCount(runtimeState.runtimePoliticalTopology),
    getFeatureCollectionCount(runtimeState.landData)
  );
}

function hasUsablePoliticalTopology(topology, { minFeatures = DETAIL_POLITICAL_MIN_FEATURES } = {}) {
  return getPoliticalGeometryCount(topology) >= Math.max(1, Number(minFeatures) || 1);
}

function evaluateScenarioDataHealth(
  manifest = runtimeState.activeScenarioManifest,
  { minRatio = SCENARIO_DETAIL_MIN_RATIO_STRICT } = {}
) {
  const expectedFeatureCount = getScenarioHealthExpectedFeatureCount(manifest);
  const runtimeFeatureCount = getScenarioHealthRuntimeFeatureCount();
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
    generatedColorTags: Array.isArray(runtimeState.scenarioGeneratedColorTags)
      ? [...runtimeState.scenarioGeneratedColorTags]
      : [],
    warning,
    severity,
  };
}

function scenarioNeedsDetailTopology(manifest = runtimeState.activeScenarioManifest) {
  return Number(manifest?.summary?.feature_count || 0) >= DETAIL_POLITICAL_MIN_FEATURES;
}

function refreshScenarioDataHealth({
  showWarningToast = false,
  showErrorToast = false,
  minRatio = SCENARIO_DETAIL_MIN_RATIO_STRICT,
} = {}) {
  if (!runtimeState.activeScenarioId || !runtimeState.activeScenarioManifest) {
    return setScenarioDataHealthState(
      runtimeState,
      createDefaultScenarioDataHealth(SCENARIO_DETAIL_MIN_RATIO_STRICT),
    );
  }
  const health = evaluateScenarioDataHealth(runtimeState.activeScenarioManifest, { minRatio });
  setScenarioDataHealthState(
    runtimeState,
    normalizeScenarioDataHealthState(health, minRatio),
  );
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
  return runtimeState.scenarioDataHealth;
}

export {
  DETAIL_POLITICAL_MIN_FEATURES,
  SCENARIO_DETAIL_ABSOLUTE_DROP_THRESHOLD,
  SCENARIO_DETAIL_MIN_RATIO_STRICT,
  evaluateScenarioDataHealth,
  hasUsablePoliticalTopology,
  refreshScenarioDataHealth,
  scenarioNeedsDetailTopology,
};

