import { createPackedLineMesh } from './packed_line_mesh.js';

export function createBorderClassification(graph, resolveFeature, { isArcEligible = () => true } = {}) {
  const { featureIds, owners, offsets, coordinates } = graph;
  const indices = new Map(featureIds.map((id, index) => [id, index]));
  const incidents = featureIds.map(() => []);
  const values = new Array(featureIds.length);
  const assignments = new Array(offsets.length - 1);
  const buckets = { country: new Map(), parent: new Map(), province: new Map(), local: new Map(), paint: new Map() };
  let revision = 0, result = null;
  for (let arc = 0; arc < assignments.length; arc++) {
    incidents[owners[arc * 2]]?.push(arc);
    incidents[owners[arc * 2 + 1]]?.push(arc);
  }
  function update(category, key, arc, add) {
    const collection = buckets[category];
    let bucket = collection.get(key);
    if (add) {
      if (!bucket) collection.set(key, bucket = { arcs: new Set(), mesh: null });
      bucket.arcs.add(arc);
    } else {
      bucket.arcs.delete(arc);
      if (!bucket.arcs.size) collection.delete(key);
    }
    bucket.mesh = null;
  }
  function classify(arc) {
    const left = owners[arc * 2], right = owners[arc * 2 + 1];
    const a = values[left], b = values[right];
    if (!a?.borderKey || !b?.borderKey || !isArcEligible(featureIds[left], featureIds[right])) return [];
    if (a.borderKey !== b.borderKey) return [['country', '']];
    const next = [], key = a.borderKey;
    const parent = a.parentKey && b.parentKey && a.parentKey !== b.parentKey;
    const province = a.provinceKey && b.provinceKey && a.provinceKey !== b.provinceKey;
    if (parent) next.push(['parent', key]);
    if (province) next.push(['province', key]);
    if (!parent && !province) next.push(['local', key]);
    if (a.color && b.color && a.color !== b.color) next.push(['paint', '']);
    return next;
  }
  function refresh(ids = null) {
    const affected = ids == null ? null : new Set();
    for (const id of ids == null ? featureIds : new Set(ids)) {
      const index = indices.get(id);
      if (index === undefined) continue;
      const value = resolveFeature(id);
      values[index] = { ...value, color: String(value.color || '').trim().toLowerCase() };
      if (affected) for (const arc of incidents[index]) affected.add(arc);
    }
    let changed = false;
    function refreshArc(arc) {
      const previous = assignments[arc] || [], next = classify(arc);
      if (previous.length === next.length && previous.every(([category, key], index) => category === next[index][0] && key === next[index][1])) return;
      for (const [category, key] of previous) update(category, key, arc, false);
      for (const [category, key] of next) update(category, key, arc, true);
      assignments[arc] = next; changed = true;
    }
    if (affected) for (const arc of affected) refreshArc(arc);
    else for (let arc = 0; arc < assignments.length; arc++) refreshArc(arc);
    if (changed) { revision++; result = null; }
    return changed;
  }
  function mesh(bucket) {
    return bucket.mesh ||= createPackedLineMesh({ coordinates, offsets, arcs: Uint32Array.from(bucket.arcs) });
  }
  function getMeshes() {
    if (!result) result = {
      country: buckets.country.has('') ? [mesh(buckets.country.get(''))] : [],
      paint: buckets.paint.has('') ? [mesh(buckets.paint.get(''))] : [],
      parent: new Map([...buckets.parent].map(([key, bucket]) => [key, mesh(bucket)])),
      province: new Map([...buckets.province].map(([key, bucket]) => [key, mesh(bucket)])),
      local: new Map([...buckets.local].map(([key, bucket]) => [key, mesh(bucket)])),
    };
    return result;
  }
  function getCounts() {
    const counts = {};
    for (const [category, collection] of Object.entries(buckets)) {
      counts[category] = Object.fromEntries([...collection].map(([key, bucket]) => [key, bucket.arcs.size]));
    }
    return counts;
  }
  refresh();
  return { refresh, getMeshes, getCounts, getRevision: () => revision,
    getActiveArcCount: () => buckets.paint.get('')?.arcs.size || 0,
    getMesh: () => getMeshes().paint[0] };
}
