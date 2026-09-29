import { getPoliticalGeometrySnapshot } from "../political_geometry_store.js";

// One committed derived-state baseline. Geometry payload generations may change
// independently; callers supply the scene/projection/semantic identity instead.
export function createPoliticalDerivedStateCache({ getFeatureId, onMiss = () => {} }) {
  let baseline = null;
  function capture(features) {
    return new Map((features || []).map((feature, index) => [getFeatureId(feature) || `feature-${index}`, feature]));
  }
  function matchesIdentity(identity) {
    return baseline && baseline.identity.length === identity.length
      && baseline.identity.every((value, index) => value === identity[index]);
  }
  function describe({ identity, previousCollection, collection, colors, colorRevision }) {
    const miss = (reason, identityIndex = -1) => {
      onMiss({ reason, identityIndex });
      return null;
    };
    if (!baseline) return miss("missing-baseline");
    if (baseline.collection !== previousCollection) return miss("collection-reference");
    if (baseline.colors !== colors) return miss("colors-reference");
    if (baseline.colorRevision !== colorRevision) return miss("color-revision");
    if (baseline.identity.length !== identity.length) return miss("identity-length");
    const mismatchIndex = baseline.identity.findIndex((value, index) => value !== identity[index]);
    if (mismatchIndex >= 0) return miss("identity-field", mismatchIndex);
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
  function commit({ identity, collection, colors, colorRevision }) {
    const snapshot = getPoliticalGeometrySnapshot(collection);
    baseline = { identity: [...identity], collection, colors, colorRevision,
      features: snapshot?.featuresById || capture(collection?.features), geometryRevision: snapshot?.revision || 0 };
  }
  // A complete color rebuild may finish after the geometry/index transaction
  // (e.g. startup hydration). Advance only its paint baseline; never certify a
  // different collection, scene, projection, semantic policy or index here.
  function refreshColors({ identity, collection, previousColors, previousColorRevision, colors, colorRevision }) {
    if (!matchesIdentity(identity) || baseline.collection !== collection
      || baseline.colors !== previousColors || baseline.colorRevision !== previousColorRevision
      || baseline.geometryRevision !== (getPoliticalGeometrySnapshot(collection)?.revision || 0)) return false;
    baseline.colors = colors;
    baseline.colorRevision = colorRevision;
    return true;
  }
  function reset() { baseline = null; }
  return { describe, commit, refreshColors, reset };
}
