import { state as runtimeState } from "./state.js";
import { createDefaultScenarioDataHealth } from "./state/scenario_runtime_state.js";
import { t } from "../ui/i18n.js";
import { showToast } from "../ui/toast.js";
const state = runtimeState;

const DETAIL_POLITICAL_MIN_FEATURES = 1000;
const SCENARIO_DETAIL_MIN_RATIO_STRICT = 0.7;
const SCENARIO_DETAIL_ABSOLUTE_DROP_THRESHOLD = 1000;

function getPoliticalGeometryCount(topology) {
  const geometries = topology?.objects?.political?.geometries;
  return Array.isArray(geometries) ? geometries.length : 0;
}

function hasUsablePoliticalTopology(topology, { minFeatures = DETAIL_POLITICAL_MIN_FEATURES } = {}) {
  return getPoliticalGeometryCount(topology) >= Math.max(1, Number(minFeatures) || 1);
}

function evaluateScenarioDataHealth(
  manifest = runtimeState.activeScenarioManifest,
  { minRatio = SCENARIO_DETAIL_MIN_RATIO_STRICT } = {}
) {
  const expectedFeatureCount = Number(manifest?.summary?.feature_count || 0);
  const runtimeFeatureCount = Array.isArray(runtimeState.landData?.features) ? runtimeState.landData.features.length : 0;
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

function scenarioNeedsDetailTopology(manifest = runtimeState.activeScenarioManifest) {
  return Number(manifest?.summary?.feature_count || 0) >= DETAIL_POLITICAL_MIN_FEATURES;
}

function refreshScenarioDataHealth({
  showWarningToast = false,
  showErrorToast = false,
  minRatio = SCENARIO_DETAIL_MIN_RATIO_STRICT,
} = {}) {
  if (!runtimeState.activeScenarioId || !runtimeState.activeScenarioManifest) {
    runtimeState.scenarioDataHealth = createDefaultScenarioDataHealth(SCENARIO_DETAIL_MIN_RATIO_STRICT);
    return runtimeState.scenarioDataHealth;
  }
  const health = evaluateScenarioDataHealth(runtimeState.activeScenarioManifest, { minRatio });
  runtimeState.scenarioDataHealth = health;
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

export {
  DETAIL_POLITICAL_MIN_FEATURES,
  SCENARIO_DETAIL_ABSOLUTE_DROP_THRESHOLD,
  SCENARIO_DETAIL_MIN_RATIO_STRICT,
  evaluateScenarioDataHealth,
  hasUsablePoliticalTopology,
  refreshScenarioDataHealth,
  scenarioNeedsDetailTopology,
};

