import { state } from "./state.js";
import {
  recomputeDynamicBordersNow,
  refreshResolvedColorsForFeatures,
  refreshScenarioOpeningOwnerBorders,
} from "./scenario/scenario_renderer_bridge.js";
import { flushRenderBoundary } from "./render_boundary.js";
import {
  canonicalScenarioCountryCode,
  getRuntimeGeometryFeatureId,
  getScenarioEffectiveControllerCodeByFeatureId,
  getScenarioEffectiveOwnerCodeByFeatureId,
  getScenarioRuntimeGeometryCountryCode,
} from "./scenario_runtime_queries.js";

function getRuntimeGeometryFeatureName(geometry) {
  const props = geometry?.properties || {};
  return String(props.name || props.NAME || "").trim();
}

function isScenarioShellCandidate(featureId, featureName = "") {
  const normalizedId = String(featureId || "").trim();
  if (!normalizedId) return false;
  if (normalizedId.toUpperCase().startsWith("RU_ARCTIC_FB_")) return true;
  return String(featureName || "").toLowerCase().includes("shell fallback");
}

function isScenarioShellOverlayEnabled() {
  return !!state.runtimePoliticalTopology?.objects?.political;
}

function getScenarioRuntimeNeighborGraph(geometries) {
  const runtimeGraph = Array.isArray(state.runtimeNeighborGraph) ? state.runtimeNeighborGraph : [];
  const hasPopulatedNeighbors = runtimeGraph.some((neighbors) => Array.isArray(neighbors) && neighbors.length > 0);
  if (runtimeGraph.length === geometries.length && hasPopulatedNeighbors) {
    return runtimeGraph.map((neighbors) => (Array.isArray(neighbors) ? neighbors : []));
  }
  if (typeof globalThis.topojson?.neighbors === "function") {
    try {
      const fallback = globalThis.topojson.neighbors(geometries);
      if (Array.isArray(fallback) && fallback.length === geometries.length) {
        return fallback.map((neighbors) => (Array.isArray(neighbors) ? neighbors : []));
      }
    } catch (error) {
      console.warn("[scenario] Failed to derive fallback runtime neighbors for shell overlays:", error);
    }
  }
  return new Array(geometries.length).fill(null).map(() => []);
}

function haveSameScenarioShellMapping(previousMap, nextMap) {
  const previousKeys = Object.keys(previousMap || {});
  const nextKeys = Object.keys(nextMap || {});
  if (previousKeys.length !== nextKeys.length) return false;
  for (const key of previousKeys) {
    if (String(previousMap?.[key] || "") !== String(nextMap?.[key] || "")) {
      return false;
    }
  }
  return true;
}

function incrementScenarioCodeVote(counterMap, code) {
  const normalizedCode = canonicalScenarioCountryCode(code);
  if (!normalizedCode) return;
  counterMap.set(normalizedCode, (counterMap.get(normalizedCode) || 0) + 1);
}

function pickScenarioMajorityCode(counterMap) {
  if (!(counterMap instanceof Map) || !counterMap.size) return "";
  const ranked = Array.from(counterMap.entries()).sort((a, b) => {
    if (b[1] !== a[1]) return b[1] - a[1];
    return String(a[0]).localeCompare(String(b[0]));
  });
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) {
    return "";
  }
  return String(ranked[0]?.[0] || "").trim().toUpperCase();
}

function buildScenarioCanonicalFallbackMaps(geometries) {
  const ownerVotesByCountry = new Map();
  const controllerVotesByCountry = new Map();

  geometries.forEach((geometry) => {
    const featureId = getRuntimeGeometryFeatureId(geometry);
    const featureName = getRuntimeGeometryFeatureName(geometry);
    if (!featureId || isScenarioShellCandidate(featureId, featureName)) return;
    const countryCode = getScenarioRuntimeGeometryCountryCode(geometry);
    if (!countryCode) return;

    const ownerCode = getScenarioEffectiveOwnerCodeByFeatureId(featureId);
    const controllerCode = getScenarioEffectiveControllerCodeByFeatureId(featureId);

    if (ownerCode) {
      let counter = ownerVotesByCountry.get(countryCode);
      if (!counter) {
        counter = new Map();
        ownerVotesByCountry.set(countryCode, counter);
      }
      incrementScenarioCodeVote(counter, ownerCode);
    }

    if (controllerCode) {
      let counter = controllerVotesByCountry.get(countryCode);
      if (!counter) {
        counter = new Map();
        controllerVotesByCountry.set(countryCode, counter);
      }
      incrementScenarioCodeVote(counter, controllerCode);
    }
  });

  const ownerFallbackByCountry = {};
  ownerVotesByCountry.forEach((counter, countryCode) => {
    const winner = pickScenarioMajorityCode(counter);
    if (winner) ownerFallbackByCountry[countryCode] = winner;
  });

  const controllerFallbackByCountry = {};
  controllerVotesByCountry.forEach((counter, countryCode) => {
    const winner = pickScenarioMajorityCode(counter);
    if (winner) controllerFallbackByCountry[countryCode] = winner;
  });

  return {
    ownerFallbackByCountry,
    controllerFallbackByCountry,
  };
}

function refreshMapDataColorsForScenarioShell(featureIds) {
  const targetIds = Array.from(
    new Set(
      (Array.isArray(featureIds) ? featureIds : [])
        .map((value) => String(value || "").trim())
        .filter(Boolean)
    )
  );
  if (!targetIds.length) return;
  refreshResolvedColorsForFeatures(targetIds, { renderNow: false });
}

export function refreshScenarioShellOverlays({
  renderNow = false,
  borderReason = "scenario-shell-overlay",
} = {}) {
  const previousOwnerMap = state.scenarioAutoShellOwnerByFeatureId || {};
  const previousControllerMap = state.scenarioAutoShellControllerByFeatureId || {};
  let nextOwnerMap = {};
  let nextControllerMap = {};

  if (state.activeScenarioId && isScenarioShellOverlayEnabled()) {
    const geometries = state.runtimePoliticalTopology?.objects?.political?.geometries || [];
    if (Array.isArray(geometries) && geometries.length) {
      const neighborGraph = getScenarioRuntimeNeighborGraph(geometries);
      const { ownerFallbackByCountry, controllerFallbackByCountry } = buildScenarioCanonicalFallbackMaps(geometries);
      geometries.forEach((geometry, index) => {
        const featureId = getRuntimeGeometryFeatureId(geometry);
        const featureName = getRuntimeGeometryFeatureName(geometry);
        if (!isScenarioShellCandidate(featureId, featureName)) return;

        const ownerVotes = new Map();
        const controllerVotes = new Map();
        const neighborIndexes = Array.isArray(neighborGraph[index]) ? neighborGraph[index] : [];
        neighborIndexes.forEach((neighborIndex) => {
          const neighborGeometry = geometries[neighborIndex];
          const neighborId = getRuntimeGeometryFeatureId(neighborGeometry);
          const neighborName = getRuntimeGeometryFeatureName(neighborGeometry);
          if (!neighborId || isScenarioShellCandidate(neighborId, neighborName)) return;
          incrementScenarioCodeVote(ownerVotes, getScenarioEffectiveOwnerCodeByFeatureId(neighborId));
          incrementScenarioCodeVote(controllerVotes, getScenarioEffectiveControllerCodeByFeatureId(neighborId));
        });

        const canonicalCountryCode = getScenarioRuntimeGeometryCountryCode(geometry);
        const directOwnerCode = canonicalScenarioCountryCode(state.sovereigntyByFeatureId?.[featureId] || "");
        const directControllerCode = canonicalScenarioCountryCode(
          state.scenarioControllersByFeatureId?.[featureId] || ""
        );
        const resolvedOwnerCode =
          directOwnerCode || pickScenarioMajorityCode(ownerVotes) || ownerFallbackByCountry[canonicalCountryCode] || "";
        const resolvedControllerCode =
          directControllerCode ||
          pickScenarioMajorityCode(controllerVotes) ||
          controllerFallbackByCountry[canonicalCountryCode] ||
          resolvedOwnerCode ||
          "";

        if (resolvedOwnerCode) {
          nextOwnerMap[featureId] = resolvedOwnerCode;
        }
        if (resolvedControllerCode) {
          nextControllerMap[featureId] = resolvedControllerCode;
        }
      });
    }
  }

  const changed =
    !haveSameScenarioShellMapping(previousOwnerMap, nextOwnerMap) ||
    !haveSameScenarioShellMapping(previousControllerMap, nextControllerMap);

  state.scenarioAutoShellOwnerByFeatureId = nextOwnerMap;
  state.scenarioAutoShellControllerByFeatureId = nextControllerMap;
  if (changed) {
    state.scenarioShellOverlayRevision = (Number(state.scenarioShellOverlayRevision) || 0) + 1;
    const affectedFeatureIds = Array.from(
      new Set([
        ...Object.keys(previousOwnerMap),
        ...Object.keys(previousControllerMap),
        ...Object.keys(nextOwnerMap),
        ...Object.keys(nextControllerMap),
      ])
    );
    if (affectedFeatureIds.length) {
      refreshMapDataColorsForScenarioShell(affectedFeatureIds);
    }
  }
  recomputeDynamicBordersNow({ renderNow: false, reason: borderReason });
  refreshScenarioOpeningOwnerBorders({
    renderNow: false,
    reason: borderReason ? `${borderReason}:opening` : "scenario-shell-opening",
  });
  if (renderNow) {
    flushRenderBoundary(borderReason ? `${borderReason}:shell-overlay` : "scenario-shell-overlay");
  }
  return {
    changed,
    ownerCount: Object.keys(nextOwnerMap).length,
    controllerCount: Object.keys(nextControllerMap).length,
  };
}
