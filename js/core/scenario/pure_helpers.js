import {
  getRuntimeGeometryFeatureId,
  getScenarioRuntimeGeometryCountryCode,
  hasExplicitScenarioAssignment,
  isScenarioWaterLikeFeature,
  shouldApplyHoi4FarEastSovietBackfill,
} from "../scenario_runtime_queries.js";
import {
  recordScenarioPerfMetricState,
} from "../state/scenario_runtime_state.js";

const DEFAULT_OCEAN_FILL_COLOR = "#aadaff";
const SCENARIO_RENDER_PROFILES = new Set(["auto", "balanced", "full"]);
const EMPTY_FROZEN_LIST = Object.freeze([]);
const hoi4FarEastSovietRuntimeCandidateFeatureIdsByTopology = new WeakMap();

function normalizeScenarioFeatureCollection(payload) {
  return Array.isArray(payload?.features)
    ? { type: "FeatureCollection", features: payload.features }
    : null;
}

function getScenarioFeatureCollectionIdentityList(payload) {
  const features = Array.isArray(payload?.features) ? payload.features : EMPTY_FROZEN_LIST;
  return features
    .map((feature) => String(feature?.id || feature?.properties?.id || "").trim())
    .filter(Boolean);
}

function areScenarioFeatureCollectionsEquivalent(leftPayload, rightPayload) {
  const left = Array.isArray(leftPayload?.features) ? leftPayload.features : EMPTY_FROZEN_LIST;
  const right = Array.isArray(rightPayload?.features) ? rightPayload.features : EMPTY_FROZEN_LIST;
  if (left.length !== right.length) return false;
  // A same-ID replacement can contain new geometry or properties. Only identical,
  // ordered feature references permit hydration to skip the payload update.
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return false;
  }
  return true;
}

function isHoi4FarEastSovietBackfillLandCandidate(geometry, featureId = "") {
  if (geometry?.properties?.render_as_base_geography === true) {
    return false;
  }
  return !isScenarioWaterLikeFeature(geometry, featureId);
}

function getHoi4FarEastSovietRuntimeCandidateFeatureIds(runtimeTopology) {
  if (!runtimeTopology || typeof runtimeTopology !== "object") {
    return EMPTY_FROZEN_LIST;
  }
  const cached = hoi4FarEastSovietRuntimeCandidateFeatureIdsByTopology.get(runtimeTopology);
  if (cached) {
    return cached;
  }
  const geometries = runtimeTopology?.objects?.political?.geometries;
  if (!Array.isArray(geometries) || !geometries.length) {
    hoi4FarEastSovietRuntimeCandidateFeatureIdsByTopology.set(runtimeTopology, EMPTY_FROZEN_LIST);
    return EMPTY_FROZEN_LIST;
  }
  const candidateFeatureIds = [];
  geometries.forEach((geometry) => {
    const featureId = getRuntimeGeometryFeatureId(geometry);
    if (!featureId) return;
    if (getScenarioRuntimeGeometryCountryCode(geometry) !== "RU") {
      return;
    }
    if (!isHoi4FarEastSovietBackfillLandCandidate(geometry, featureId)) {
      return;
    }
    candidateFeatureIds.push(featureId);
  });
  const frozenCandidateFeatureIds = Object.freeze(candidateFeatureIds);
  hoi4FarEastSovietRuntimeCandidateFeatureIdsByTopology.set(runtimeTopology, frozenCandidateFeatureIds);
  return frozenCandidateFeatureIds;
}

function buildHoi4FarEastSovietOwnerBackfill(
  scenarioId,
  {
    runtimeTopology = null,
    ownersByFeatureId = {},
    controllersByFeatureId = {},
  } = {}
) {
  if (!shouldApplyHoi4FarEastSovietBackfill(scenarioId)) {
    return {};
  }
  const candidateFeatureIds = getHoi4FarEastSovietRuntimeCandidateFeatureIds(runtimeTopology);
  if (!candidateFeatureIds.length) {
    return {};
  }
  const next = {};
  candidateFeatureIds.forEach((featureId) => {
    if (
      hasExplicitScenarioAssignment(ownersByFeatureId, featureId) ||
      hasExplicitScenarioAssignment(controllersByFeatureId, featureId)
    ) {
      return;
    }
    next[featureId] = "SOV";
  });
  return next;
}

function normalizeScenarioOceanFillColor(value, fallback = DEFAULT_OCEAN_FILL_COLOR) {
  const candidate = String(value || "").trim();
  if (/^#(?:[0-9a-f]{6})$/i.test(candidate)) return candidate.toLowerCase();
  if (/^#(?:[0-9a-f]{3})$/i.test(candidate)) {
    return `#${candidate[1]}${candidate[1]}${candidate[2]}${candidate[2]}${candidate[3]}${candidate[3]}`.toLowerCase();
  }
  return fallback;
}

function normalizeScenarioRenderProfile(value, fallback = "auto") {
  const normalizedFallback = SCENARIO_RENDER_PROFILES.has(String(fallback || "").trim().toLowerCase())
    ? String(fallback || "").trim().toLowerCase()
    : "auto";
  const candidate = String(value || "").trim().toLowerCase();
  return SCENARIO_RENDER_PROFILES.has(candidate) ? candidate : normalizedFallback;
}

function recordScenarioPerfMetric(state, name, durationMs, details = {}) {
  return recordScenarioPerfMetricState(state, name, durationMs, details);
}

export {
  SCENARIO_RENDER_PROFILES,
  normalizeScenarioFeatureCollection,
  getScenarioFeatureCollectionIdentityList,
  areScenarioFeatureCollectionsEquivalent,
  buildHoi4FarEastSovietOwnerBackfill,
  getHoi4FarEastSovietRuntimeCandidateFeatureIds,
  isHoi4FarEastSovietBackfillLandCandidate,
  normalizeScenarioOceanFillColor,
  normalizeScenarioRenderProfile,
  recordScenarioPerfMetric,
};
