import { restoreScenarioFields, validateScenarioSnapshot } from "./scenario_snapshot.js";

// Canonical scenario readiness state authority.
// Transaction ordering, async work, observers, and recovery stay in scenario composition roots.

export const SCENARIO_READINESS_STATE_KEYS = Object.freeze([
  "topologyDetail",
  "topologyBundleMode",
  "detailDeferred",
  "detailPromotionCompleted",
  "detailPromotionInFlight",
  "detailSourceRequested",
]);

const hasOwn = (target, key) =>
  Object.hasOwn(target, key);

function assertStateTarget(target) {
  if (!target || typeof target !== "object" || Array.isArray(target)) {
    throw new TypeError("[scenario_readiness_actions] target must be an object");
  }
}

function validateCompletePatch(patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
    throw new TypeError("[scenario_readiness_actions] patch must be an object");
  }
  for (const key of SCENARIO_READINESS_STATE_KEYS) {
    if (!hasOwn(patch, key)) {
      throw new Error(
        `[scenario_readiness_actions] commitScenarioReadinessState missing required key: ${key}`,
      );
    }
  }
}

function validateSnapshot(snapshot) {
  return validateScenarioSnapshot(snapshot, SCENARIO_READINESS_STATE_KEYS,
    "scenario_readiness_actions", "restoreScenarioReadinessState");
}

export function captureScenarioReadinessState(target) {
  assertStateTarget(target);
  const presentKeys = SCENARIO_READINESS_STATE_KEYS.filter((key) =>
    hasOwn(target, key)
  );
  const values = Object.fromEntries(
    SCENARIO_READINESS_STATE_KEYS.map((key) => [key, target[key]]),
  );
  return Object.freeze({
    values: Object.freeze(values),
    presentKeys: Object.freeze(presentKeys),
  });
}

export function commitScenarioReadinessState(target, patch) {
  assertStateTarget(target);
  validateCompletePatch(patch);
  target.topologyDetail = patch.topologyDetail;
  target.topologyBundleMode = patch.topologyBundleMode;
  target.detailDeferred = patch.detailDeferred;
  target.detailPromotionCompleted = patch.detailPromotionCompleted;
  target.detailPromotionInFlight = patch.detailPromotionInFlight;
  target.detailSourceRequested = patch.detailSourceRequested;
  return true;
}

export function restoreScenarioReadinessState(target, snapshot) {
  assertStateTarget(target);
  const { values, presentKeys } = validateSnapshot(snapshot);
  restoreScenarioFields(target, values, presentKeys, SCENARIO_READINESS_STATE_KEYS);
  return true;
}
