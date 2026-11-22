import { normalizeCountryCodeAlias } from "../country_code_aliases.js";
import { getActiveRiverPack, getRiverParentCompatibility } from "../river_paint/partition_model.js";
import { isRiverPaintSourceCompatible } from "../river_paint/pilot_manifest.js";
import { getParentMergedParents as readMergedParents } from "./parent_merged_presentation.js";

export function createCityTerritoryQuery({
  state, resolveBorderIdentity, getParentMergedParents = readMergedParents, getSuppressedCodes,
}) {
  function cellsFor(id, feature) {
    const pack = getActiveRiverPack(state.riverPaint, state.activeScenarioId, state.scenarioBaselineHash || "");
    if (!pack || !isRiverPaintSourceCompatible(pack, state.activeScenarioManifest)) return null;
    const { parent, status } = getRiverParentCompatibility(pack, feature, id);
    return status === "ready" ? parent.cells : null;
  }

  function matches(tag, hostId, host, cell) {
    const feature = cell ? { ...host, id: cell.id, geometry: cell.geometry,
      properties: { ...host.properties, id: cell.id, __riverParentId: hostId } } : host;
    const identity = resolveBorderIdentity(cell?.id || hostId, feature);
    if (identity?.startsWith("color:")) {
      return normalizeCountryCodeAlias(state.sovereigntyByFeatureId?.[hostId]) === tag
        && !getSuppressedCodes?.()?.has(tag);
    }
    return identity === tag || getParentMergedParents(state.scenarioCountriesByTag).get(identity) === tag;
  }

  return function inTerritory(city, tag) {
    const hostId = city.properties.__city_host_feature_id;
    if (hostId) {
      const host = state.landIndex?.get(hostId);
      const cells = cellsFor(hostId, host);
      const hits = cells?.filter(cell => globalThis.d3.geoContains(cell.geometry, city.geometry.coordinates));
      return matches(tag, hostId, host, hits?.length === 1 ? hits[0] : null);
    }
    if (city.properties.__city_source !== "project") return false;
    for (const [id, feature] of state.landIndex || []) {
      const cells = cellsFor(id, feature);
      if (cells ? cells.some(cell => matches(tag, id, feature, cell)) : matches(tag, id, feature)) return true;
    }
    return false;
  };
}

export function createCapitalVisibility(options) {
  const inTerritory = createCityTerritoryQuery(options);
  function getCapitalTag(city) {
    const tags = city?.properties?.__city_capital_tags || [];
    return tags.length > 1 ? tags.find(tag => inTerritory(city, tag)) || tags[0] : tags[0] || "";
  }
  function isCapitalVisible(city) {
    if (!options.state.activeScenarioId) return !!city?.properties?.__city_is_capital;
    return !!city?.properties?.__city_capital_tags?.some(tag => inTerritory(city, tag));
  }
  return { getCapitalTag, isCapitalVisible };
}
