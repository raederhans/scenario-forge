import {
  getRuntimeGeometryFeatureId,
  getScenarioRuntimeGeometryCountryCode,
  hasExplicitScenarioAssignment,
  shouldApplyHoi4FarEastSovietBackfill,
} from "../scenario_runtime_queries.js";

const DEFAULT_OCEAN_FILL_COLOR = "#aadaff";
const SCENARIO_RENDER_PROFILES = new Set(["auto", "balanced", "full"]);
const EMPTY_FROZEN_LIST = Object.freeze([]);
const hoi4FarEastSovietRuntimeCandidateFeatureIdsByTopology = new WeakMap();

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

function ensureScenarioPerfMetrics(state) {
  if (!state.scenarioPerfMetrics || typeof state.scenarioPerfMetrics !== "object") {
    state.scenarioPerfMetrics = {};
  }
  return state.scenarioPerfMetrics;
}

function recordScenarioPerfMetric(state, name, durationMs, details = {}) {
  const metrics = ensureScenarioPerfMetrics(state);
  const normalizedName = String(name || "").trim();
  if (!normalizedName) return null;
  const nextEntry = {
    durationMs: Math.max(0, Number(durationMs) || 0),
    recordedAt: Date.now(),
    ...details,
  };
  metrics[normalizedName] = nextEntry;
  globalThis.__scenarioPerfMetrics = metrics;
  return nextEntry;
}

export {
  SCENARIO_RENDER_PROFILES,
  buildHoi4FarEastSovietOwnerBackfill,
  getHoi4FarEastSovietRuntimeCandidateFeatureIds,
  normalizeScenarioOceanFillColor,
  normalizeScenarioRenderProfile,
  recordScenarioPerfMetric,
};
