import { getMapDataBoundary } from "./map_data_boundary.js";
import { createBorderIdentityResolver } from "./renderer/border_identity.js";
import { getScenarioCountryTags } from "./state/actions/scenario_activation_actions.js";

export function createPaletteOwnerResolver(state) {
  const tags = state.activeScenarioId ? getScenarioCountryTags(state.scenarioCountriesByTag) : null;
  return createBorderIdentityResolver({
    sovereignBaseColors: state.sovereignBaseColors,
    getCountryTags: () => tags,
    getReferenceOwner: getMapDataBoundary(state).reference.getBaseGroupCode,
    getOverrideColor: id => state.visualOverrides?.[id],
  });
}

// Use reference identity, including unhydrated scenario members, never RGB.
export function getPaletteCountryTargets(state) {
  const reference = getMapDataBoundary(state).reference;
  const groups = new Map();
  const add = (code, id) => {
    if (!code || !id) return;
    if (!groups.has(code)) groups.set(code, new Set());
    groups.get(code).add(id);
  };
  for (const id of reference.getScenarioFeatureIds()) {
    add(reference.getBaseGroupCode(id), id);
  }
  for (const id of state.landIndex?.keys() || []) {
    add(reference.getBaseGroupCode(id), id);
  }
  return groups;
}
