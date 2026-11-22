import { getScenarioRegion, isRegionalScenario } from "../scenario/scenario_region.js";
import { getContextTopologyObjectStamp, getStartupContextCollection } from "../state/context_layer_revision.js";
import { getDefaultBorderWorkerSources } from "./border_mesh_queries.js";
import { isLakeRegion } from "./effective_water_regions.js";

const primaryLandCache = new WeakMap();
export const OCEAN_MASK_MODE_SPHERE_MINUS_LAND = "sphere_minus_land";

export function getOceanMaskMode(state, defaultMode) {
  return isRegionalScenario(state.activeScenarioManifest) ? OCEAN_MASK_MODE_SPHERE_MINUS_LAND : defaultMode;
}

export function clipOceanOutsideLand(surface, sphere, land, exclusionPath) {
  const context = surface.getContext();
  if (exclusionPath) {
    context.clip(exclusionPath, "evenodd");
  } else {
    surface.getPathCanvas()(sphere);
    surface.getPathCanvas()(land);
    try {
      context.clip("evenodd");
    } catch (error) {
      context.clip();
    }
  }
}

export function usesRegionalMarineMask(state, feature) {
  return isRegionalScenario(state.activeScenarioManifest) && !isLakeRegion(feature);
}

export function isRegionalMarineHitOnLand(state, feature, lonLat) {
  if (!usesRegionalMarineMask(state, feature)) return false;
  const { collection } = getRegionalBackdrop(state);
  return !!collection && globalThis.d3.geoContains(collection, lonLat);
}

export function getRegionalBackdrop(state, topojson = globalThis.topojson) {
  const region = getScenarioRegion(state.activeScenarioManifest);
  if (!region) return null;
  const topology = state.topologyPrimary || state.topology;
  const land = topology?.objects?.land;
  let collection = null;
  if (land && topojson) {
    const decode = topojson.feature;
    const stamp = getContextTopologyObjectStamp(state, topology, land, decode);
    const cached = primaryLandCache.get(topology);
    if (cached?.land === land && stamp.every((value, index) => value === cached.stamp[index])) {
      collection = cached.collection;
    } else {
      collection = getStartupContextCollection(state, topology, land, stamp) || decode(topology, land);
      primaryLandCache.set(topology, { land, stamp, collection });
    }
  }
  return { collection, fill: region.backdrop_fill || "#b9b7b2", maskSource: "primary-land",
    maskFeatureCount: collection?.features?.length || 0 };
}

export function selectPoliticalBorderTopology(state, globalTopology) {
  return isRegionalScenario(state.activeScenarioManifest) ? state.scenarioRuntimeTopologyData : globalTopology;
}

export function getPoliticalBorderSources(state) {
  return isRegionalScenario(state.activeScenarioManifest)
    ? [{ key: "detail", topology: state.scenarioRuntimeTopologyData }]
    : getDefaultBorderWorkerSources(state);
}

export function getRegionalCoastlineDecision(state) {
  if (!isRegionalScenario(state.activeScenarioManifest)) return null;
  const primary = state.topologyPrimary || state.topology;
  return { source: "primary", reason: "regional-primary-land", primaryObjectName: "land",
    scenarioId: state.activeScenarioId, topology: primary?.objects?.land ? primary : null };
}
