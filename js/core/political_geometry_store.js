import { getFeatureId } from "./feature_identity.js";

// Sidecar metadata never enters saved projects, JSON assets or state snapshots.
// Revisions, rather than references to previous collections, avoid retaining an
// unbounded chain of old high-resolution geometry after repeated promotions.
const snapshots = new WeakMap();
let nextRevision = 1;
export const getPoliticalGeometrySnapshot = (collection) => snapshots.get(collection) || null;

export function registerPoliticalGeometrySnapshot(collection, snapshot) {
  snapshots.set(collection, snapshot);
  return collection;
}

export function createPoliticalGeometryStore() {
  const sources = new WeakMap();
  let previousSources = [];
  let winners = new Map();
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
      const nextWinners = new Map(winners);
      const changedIds = [];
      const removedIds = [];
      for (const id of touched) {
        const source = orderedSources.find((entry) => entry.byId.has(id));
        const feature = source?.byId.get(id);
        const previous = winners.get(id);
        if (source) {
          nextWinners.set(id, { source, feature });
          if (previous?.feature !== feature) changedIds.push(id);
        } else {
          nextWinners.delete(id);
          if (previous) removedIds.push(id);
        }
      }
      // Legacy draw order remains detail-first, then unmasked coarse features.
      // Only the compatibility array is materialized; base IDs and geometry are
      // indexed once and unchanged detail sources keep their own indexed view.
      const features = [];
      const featuresById = new Map();
      const emittedSources = new Set();
      for (const source of orderedSources) {
        if (emittedSources.has(source)) continue;
        emittedSources.add(source);
        for (const [id, feature] of source.byId) {
          if (nextWinners.get(id)?.source !== source) continue;
          features.push(feature);
          featuresById.set(id, feature);
        }
      }
      const revision = nextRevision++;
      const collection = { type: "FeatureCollection", features, globalCoverage: true };
      registerPoliticalGeometrySnapshot(collection, {
        revision, previousRevision, featuresById, changedIds, removedIds,
        sourceCount: orderedSources.length,
      });
      previousSources = orderedSources;
      previousRevision = revision;
      winners = nextWinners;
      return collection;
    },
  };
}
