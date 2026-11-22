import { state as runtimeState } from "../state.js";
import {
  createDefaultScenarioDataHealth,
  normalizeScenarioDataHealthState,
} from "../state/scenario_runtime_state.js";
import {
  setScenarioDataHealthState,
} from "../state/actions/scenario_health_actions.js";
import { t } from "../i18n.js";
import { getCountryCode, getFeatureId } from "../feature_identity.js";
import { createRuntimePoliticalFeaturePolicy } from "../renderer/political_feature_policy.js";
import {
  createPoliticalCollectionOwner, getDetailTier, INTERACTIVE_AGGREGATE_TIER_FILTERS,
} from "../renderer/political_collection_owner.js";
import { isRegionalScenario } from "./scenario_region.js";
import { callRuntimeHook } from "../state/index.js";
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

function featureIds(features) {
  return new Set((features || []).map(feature => getFeatureId(feature)).filter(Boolean));
}

function sameIds(expected, actual) {
  if (expected.size !== actual?.size) return false;
  for (const id of expected) if (!actual.has(id)) return false;
  return true;
}

export function evaluateRegionalPoliticalMembership(state, manifest = state.activeScenarioManifest) {
  if (!isRegionalScenario(manifest)) return null;
  const geometries = state.scenarioRuntimeTopologyData?.objects?.political?.geometries || [];
  const policy = createRuntimePoliticalFeaturePolicy(state);
  const view = createPoliticalCollectionOwner({
    state,
    constants: { interactiveAggregateTierFilters: INTERACTIVE_AGGREGATE_TIER_FILTERS },
    helpers: {
      getFeatureId,
      getFeatureCountryCodeNormalized: getCountryCode,
      getDetailTier,
      isPoliticalInteractionRenderableFeature: policy.isPoliticalInteractionRenderableFeature,
    },
  });
  const members = geometries.filter(feature =>
    !policy.shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(feature, getFeatureId(feature)));
  const expectedFull = featureIds(members);
  const expectedInteractive = featureIds(view.buildInteractiveLandData({ features: members }).features);
  const rendered = featureIds(state.landDataFull?.features);
  return {
    expectedFeatureCount: expectedFull.size,
    runtimeFeatureCount: rendered.size,
    healthy: expectedFull.size > 0 && sameIds(expectedFull, rendered)
      && sameIds(expectedInteractive, featureIds(state.landData?.features))
      && (!state.interactionInfrastructureReady || sameIds(expectedInteractive, state.landIndex)),
  };
}

function evaluateScenarioDataHealth(
  manifest = runtimeState.activeScenarioManifest,
  { minRatio = SCENARIO_DETAIL_MIN_RATIO_STRICT } = {}
) {
  const regional = evaluateRegionalPoliticalMembership(runtimeState, manifest);
  const expectedFeatureCount = regional?.expectedFeatureCount ?? getScenarioHealthExpectedFeatureCount(manifest);
  const runtimeFeatureCount = regional?.runtimeFeatureCount ?? getScenarioHealthRuntimeFeatureCount();
  const ratio = expectedFeatureCount > 0 ? runtimeFeatureCount / expectedFeatureCount : 1;
  const normalizedMinRatio = Math.min(Math.max(Number(minRatio) || SCENARIO_DETAIL_MIN_RATIO_STRICT, 0.1), 1);
  let warning = "";
  let severity = "";
  const unhealthy = regional
    ? !regional.healthy && !(runtimeState.bootBlocking && !runtimeState.landDataFull && !runtimeState.landData)
    : expectedFeatureCount >= DETAIL_POLITICAL_MIN_FEATURES && runtimeFeatureCount > 0 && ratio < normalizedMinRatio
      && expectedFeatureCount - runtimeFeatureCount >= SCENARIO_DETAIL_ABSOLUTE_DROP_THRESHOLD;
  if (unhealthy) {
    warning = t("Detail topology not fully loaded; scenario is shown in coarse mode.", "ui");
    severity = "error";
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

