import { getPoliticalGeometrySnapshot } from "../political_geometry_store.js";

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
    const snapshot = getPoliticalGeometrySnapshot(collection);
    const next = snapshot?.featuresById || capture(collection?.features);
    const changedIds = [];
    const removedIds = [];
    const hasDelta = snapshot && baseline.geometryRevision > 0 && snapshot.previousRevision === baseline.geometryRevision;
    const candidates = hasDelta ? snapshot.changedIds.map((id) => [id, next.get(id)]) : next;
    for (const [id, feature] of candidates) {
      if (!next.has(id)) continue;
      if (baseline.features.get(id) !== feature || !Object.hasOwn(colors || {}, id)) changedIds.push(id);
    }
    for (const id of hasDelta ? snapshot.removedIds : baseline.features.keys()) if (!next.has(id)) removedIds.push(id);
    return { features: next, changedIds, removedIds };
  }
  function commit({ identity, collection, colors }) {
    const snapshot = getPoliticalGeometrySnapshot(collection);
    baseline = { identity: [...identity], collection, colors,
      features: snapshot?.featuresById || capture(collection?.features), geometryRevision: snapshot?.revision || 0 };
  }
  function reset() { baseline = null; }
  return { describe, commit, reset };
}
