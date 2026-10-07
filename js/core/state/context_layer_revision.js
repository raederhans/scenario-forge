// Keep the public context epoch for render consumers. Known collection
// publications need not invalidate unrelated immutable TopoJSON derivations.
// Metadata is weakly owned by the state and by each published collection.
const revisionsByState = new WeakMap();

function observeRevision(target, revision = Number(target.contextLayerRevision) || 0) {
  let tracked = revisionsByState.get(target);
  if (!tracked) {
    tracked = { observed: revision, geometry: 0, collections: new WeakMap(), decoded: new WeakMap() };
    revisionsByState.set(target, tracked);
  } else if (tracked.observed !== revision) {
    // Unmarked writers include explicit in-place edits and base hydration.
    tracked.geometry += 1;
    tracked.observed = revision;
  }
  return tracked;
}

export function recordContextLayerPublication(target, previousRevision, collections = []) {
  // Observe the previous epoch first: an intervening unknown writer must not
  // be hidden by a subsequent known publication before the resolver runs.
  const tracked = observeRevision(target, previousRevision);
  tracked.observed = Number(target.contextLayerRevision) || 0;
  for (const collection of collections) {
    if (!collection || typeof collection !== "object") continue;
    tracked.collections.set(collection, (tracked.collections.get(collection) || 0) + 1);
  }
}

export function getContextGeometryRevision(target) {
  return observeRevision(target).geometry;
}

export function getContextCollectionRevision(target, collection) {
  return observeRevision(target).collections.get(collection) || 0;
}

export function getContextTopologyObjectStamp(target, topology, object, decoder) {
  // In-place edits use the strong epoch; replaced source arrays and objects
  // invalidate by identity. No projection-dependent values are cached here.
  return [object.geometries, object.geometries?.length, topology.arcs, topology.arcs?.length,
    topology.transform, topology.transform?.scale, topology.transform?.translate,
    getContextGeometryRevision(target), decoder];
}

export function recordStartupContextCollection(target, topology, object, collection, decoder) {
  if (!topology || !object || !Array.isArray(collection?.features)) return;
  const tracked = observeRevision(target);
  let byObject = tracked.decoded.get(topology);
  if (!byObject) {
    byObject = new WeakMap();
    tracked.decoded.set(topology, byObject);
  }
  byObject.set(object, {
    stamp: getContextTopologyObjectStamp(target, topology, object, decoder),
    collectionStamp: [collection.features, collection.features.length, getContextCollectionRevision(target, collection)],
    collection,
  });
}

export function getStartupContextCollection(target, topology, object, stamp) {
  const byObject = observeRevision(target).decoded.get(topology);
  const seeded = byObject?.get(object);
  if (!seeded) return null;
  const collectionStamp = [seeded.collection.features, seeded.collection.features?.length,
    getContextCollectionRevision(target, seeded.collection)];
  if (stamp.every((value, index) => value === seeded.stamp[index])
    && collectionStamp.every((value, index) => value === seeded.collectionStamp[index])) return seeded.collection;
  // Release stale predecoded data once it can no longer seed this source.
  byObject.delete(object);
  return null;
}
