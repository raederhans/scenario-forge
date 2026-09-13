// One committed derived-state baseline. Geometry payload generations may change
// independently; callers supply the scene/projection/semantic identity instead.
export function createPoliticalDerivedStateCache({ getFeatureId }) {
  let baseline = null;
  function capture(features) {
    return new Map((features || []).map((feature, index) => [getFeatureId(feature) || `feature-${index}`, feature]));
  }
  function describe({ identity, previousCollection, collection, colors }) {
    if (!baseline || baseline.collection !== previousCollection || baseline.colors !== colors
      || baseline.identity.length !== identity.length
      || baseline.identity.some((value, index) => value !== identity[index])) return null;
    const next = capture(collection?.features);
    const changedIds = [];
    const removedIds = [];
    for (const [id, feature] of next) {
      if (baseline.features.get(id) !== feature || !Object.hasOwn(colors || {}, id)) changedIds.push(id);
    }
    for (const id of baseline.features.keys()) if (!next.has(id)) removedIds.push(id);
    return { features: next, changedIds, removedIds };
  }
  function commit({ identity, collection, colors }) {
    baseline = { identity: [...identity], collection, colors, features: capture(collection?.features) };
  }
  function reset() { baseline = null; }
  return { describe, commit, reset };
}
