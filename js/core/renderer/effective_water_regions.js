// Ordinary lakes share one geometry set across scenarios. Scenario-only waters
// remain in their owning scenario; exclusive mode applies to marine regions.
export function isLakeRegion(feature) {
  return ["lake", "reservoir", "inland_sea"].includes(
    String(feature?.properties?.water_type || "").trim().toLowerCase(),
  );
}

export function isLakeInteractionEnabled(state) {
  return state?.styleConfig?.lakes?.interactive === true;
}

export function isLakeVisibleInScenarioYear(feature, scenarioYear) {
  if (scenarioYear === null) return true;
  const { year_built, year_removed } = feature.properties;
  return !(year_built > scenarioYear || year_removed <= scenarioYear);
}

export function getScenarioWaterYear(state) {
  if (!state.activeScenarioId) return null;
  const year = Number(String(state.activeScenarioManifest?.bookmark_date).split(/[.-]/)[0]);
  return Number.isInteger(year) && year > 0 ? year : null;
}

export function resolveEffectiveWaterRegionFeatures({
  baseFeatures = [],
  scenarioFeatures = [],
  globalLakeFeatures = [],
  activeScenarioId = "",
  scenarioYear = null,
  regionFilter = null,
  exclusive = false,
  isExcluded = () => false,
} = {}) {
  const result = new Map();
  const add = (feature) => {
    const props = feature?.properties || {};
    const id = props.id || feature?.id;
    if (!id || (props.scenario_id && props.scenario_id !== activeScenarioId)) return;
    if (id === "congo_lake" && activeScenarioId !== "tno_1962") return;
    if (regionFilter && isLakeRegion(feature) && !isLakeVisibleInScenarioYear(feature, scenarioYear)) return;
    if (isExcluded(feature)) return;
    result.set(id, feature);
  };
  if (!exclusive) baseFeatures.forEach(add);
  scenarioFeatures.forEach(add);
  // The existing TNO exclusions prevent duplicate clones. They must not hide
  // the common lake collection, which now replaces those clones by stable ID.
  const lakesById = new Map();
  for (const feature of globalLakeFeatures) {
    const id = feature.properties.id;
    if (id === "congo_lake" || feature.properties.scenario_id) continue;
    if (isLakeVisibleInScenarioYear(feature, scenarioYear)) lakesById.set(id, feature);
    else if (!lakesById.has(id)) lakesById.set(id, null);
  }
  for (const [id, feature] of lakesById) {
    if (feature) result.set(id, feature);
    else result.delete(id);
  }
  if (regionFilter) {
    for (const feature of scenarioFeatures) {
      if (isLakeRegion(feature) && lakesById.get(feature.properties.id) !== null) add(feature);
    }
    return [...result.values()].filter(regionFilter.includesWater);
  }
  return [...result.values()];
}
