// Ordinary lakes share one geometry set across scenarios. Scenario-only waters
// remain in their owning scenario; exclusive mode applies to marine regions.
export function resolveEffectiveWaterRegionFeatures({
  baseFeatures = [],
  scenarioFeatures = [],
  globalLakeFeatures = [],
  activeScenarioId = "",
  exclusive = false,
  isExcluded = () => false,
} = {}) {
  const lakesById = new Map(globalLakeFeatures.map((feature) => [feature.properties.id, feature]));
  const result = new Map();
  const add = (feature) => {
    const props = feature?.properties || {};
    const id = props.id || feature?.id;
    if (!id || (props.scenario_id && props.scenario_id !== activeScenarioId)) return;
    if (id === "congo_lake" && activeScenarioId !== "tno_1962") return;
    if (isExcluded(feature)) return;
    result.set(id, feature);
  };
  if (!exclusive) baseFeatures.forEach(add);
  scenarioFeatures.forEach(add);
  // The existing TNO exclusions prevent duplicate clones. They must not hide
  // the common lake collection, which now replaces those clones by stable ID.
  for (const [id, feature] of lakesById) {
    if (id !== "congo_lake" && !feature.properties.scenario_id) result.set(id, feature);
  }
  return [...result.values()];
}
