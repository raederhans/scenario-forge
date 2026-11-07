export function createSelectionBoundaryIndex(graph, { resolveSourceFeatureId = id => id } = {}) {
  const sourceIds = graph.featureIds.map(resolveSourceFeatureId);
  const incident = new Map();
  const arcs = [];
  function add(mesh, arc, left, right, overlap = false) {
    const index = arcs.length;
    arcs.push({ mesh, arc, left, right, overlap });
    for (const id of new Set([left, right])) {
      if (id === undefined) continue;
      if (!incident.has(id)) incident.set(id, []);
      incident.get(id).push(index);
    }
  }
  for (let arc = 0; arc < graph.offsets.length - 1; arc++) {
    add(graph, arc, sourceIds[graph.owners[arc * 2]], sourceIds[graph.owners[arc * 2 + 1]]);
  }
  if (graph.coast) for (let arc = 0; arc < graph.coast.offsets.length - 1; arc++) {
    add(graph.coast, arc, sourceIds[graph.coast.coastOwners[arc]], undefined);
  }
  if (graph.overlap) for (let arc = 0; arc < graph.overlap.offsets.length - 1; arc++) {
    add(graph.overlap, arc, sourceIds[graph.overlap.overlapOwners[arc]], sourceIds[graph.overlap.overlapCoverers[arc]], true);
  }
  let lastSignature, lastResult;
  return {
    getBoundaryLines(memberIdSet) {
      const members = new Set(memberIdSet);
      const signature = JSON.stringify([...members].sort());
      if (signature === lastSignature) return lastResult;
      const candidates = new Set();
      for (const id of members) for (const arc of incident.get(id) || []) candidates.add(arc);
      const coordinates = [];
      for (const index of candidates) {
        const { mesh, arc, left, right, overlap } = arcs[index];
        if (overlap && !members.has(left)) continue;
        if (members.has(left) === members.has(right)) continue;
        const line = [];
        for (let point = mesh.offsets[arc]; point < mesh.offsets[arc + 1]; point++) {
          line.push([mesh.coordinates[point * 2], mesh.coordinates[point * 2 + 1]]);
        }
        coordinates.push(line);
      }
      lastSignature = signature;
      lastResult = coordinates.length ? { type: 'MultiLineString', coordinates } : null;
      return lastResult;
    },
  };
}
