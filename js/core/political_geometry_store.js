import { getFeatureId } from "./feature_identity.js";

// Sidecar metadata never enters saved projects, JSON assets or state snapshots.
// Revisions, rather than references to previous collections, avoid retaining an
// unbounded chain of old high-resolution geometry after repeated promotions.
const snapshots = new WeakMap();
let nextRevision = 1;
export const getPoliticalGeometrySnapshot = (collection) => snapshots.get(collection) || null;

export function registerPoliticalGeometrySnapshot(collection, snapshot) {
  // Normalizers can replace the index with wrapped features. Do not retain a
  // lookup bound to the unnormalized source view in that derived snapshot.
  const index = Object.getOwnPropertyDescriptor(snapshot, "featuresById")?.value;
  snapshots.set(collection, index instanceof Map
    ? { ...snapshot, getFeature: (id) => index.get(id), featureCount: index.size }
    : snapshot);
  return collection;
}

export function createPoliticalGeometryStore() {
  const sources = new WeakMap();
  let previousSources = [];
  const winners = new Map();
  let previousView = null;
  let previousRevision = 0;
  function index(payload) {
    if (sources.has(payload)) return sources.get(payload);
    const byId = new Map();
    for (const [position, feature] of payload.features.entries()) {
      const id = String(getFeatureId(feature) || feature?.properties?.feature_id || position).trim();
      if (!byId.has(id)) byId.set(id, feature);
    }
    const result = { payload, byId };
    sources.set(payload, result);
    return result;
  }
  return {
    compose(payloads) {
      const orderedSources = payloads.map(index);
      const touched = new Set();
      const oldPositions = new Map(previousSources.map((source, i) => [source, i]));
      const newPositions = new Map(orderedSources.map((source, i) => [source, i]));
      const commonBefore = previousSources.filter((source) => newPositions.has(source));
      const commonAfter = orderedSources.filter((source) => oldPositions.has(source));
      const reordered = commonBefore.some((source, i) => source !== commonAfter[i]);
      for (const source of new Set([...previousSources, ...orderedSources])) {
        if (!oldPositions.has(source) || !newPositions.has(source) || reordered) {
          for (const id of source.byId.keys()) touched.add(id);
        }
      }

      const changedIds = [];
      const removedIds = [];
      for (const id of touched) {
        const source = orderedSources.find((entry) => entry.byId.has(id));
        const feature = source?.byId.get(id);
        const previous = winners.get(id);
        if (source) {
          winners.set(id, { source, feature });
          if (previous?.feature !== feature) changedIds.push(id);
        } else {
          winners.delete(id);
          if (previous) removedIds.push(id);
        }
      }
      // A view owns immutable source indexes, not a link to an earlier view.
      // The live winner table is updated only for touched IDs. Consumers of
      // the delta do not pay for a full Map copy or a compatibility array.
      const sameOrder = orderedSources.length === previousSources.length
        && orderedSources.every((source, i) => source === previousSources[i]);
      const viewSources = [...orderedSources];
      let view = sameOrder ? previousView : null;
      if (!view) {
        let byId = null, features = null;
        view = {
          get featuresById() {
            if (!byId) {
              byId = new Map();
              for (const source of viewSources) {
                for (const [id, feature] of source.byId) if (!byId.has(id)) byId.set(id, feature);
              }
            }
            return byId;
          },
          get features() { return features ||= [...this.featuresById.values()]; },
          getFeature(id) {
            for (const source of viewSources) if (source.byId.has(id)) return source.byId.get(id);
            return undefined;
          },
        };
      }
      const revision = nextRevision++;
      const collection = { type: "FeatureCollection", get features() { return view.features; }, globalCoverage: true };
      registerPoliticalGeometrySnapshot(collection, {
        revision, previousRevision, get featuresById() { return view.featuresById; }, changedIds, removedIds,
        getFeature: view.getFeature, featureCount: winners.size, sourceCount: orderedSources.length,
      });
      previousView = view;
      previousSources = orderedSources;
      previousRevision = revision;
      return collection;
    },
  };
}
