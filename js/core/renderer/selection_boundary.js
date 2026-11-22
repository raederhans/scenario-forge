// isPassive marks coverage-only parcels (shell fallbacks) that no selection can name.
// With adoptPassive, such a parcel joins the selection when more of its shared
// boundary lies on members than on other parcels, so it does not get its own outline.
export function createSelectionBoundaryIndex(graph, { resolveSourceFeatureId = id => id, isPassive = () => false } = {}) {
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
  let passive = null;
  function passiveNeighbours() {
    if (passive) return passive;
    passive = new Map();
    const flags = new Map();
    const check = id => { if (!flags.has(id)) flags.set(id, id !== undefined && !!isPassive(id)); return flags.get(id); };
    for (let arc = 0; arc < graph.offsets.length - 1; arc++) {
      const { left, right } = arcs[arc];
      if (left === right || (!check(left) && !check(right))) continue;
      let length = 0;
      for (let point = graph.offsets[arc] + 1; point < graph.offsets[arc + 1]; point++) {
        length += Math.hypot(graph.coordinates[point * 2] - graph.coordinates[point * 2 - 2],
          graph.coordinates[point * 2 + 1] - graph.coordinates[point * 2 - 1]);
      }
      for (const [id, other] of [[left, right], [right, left]]) {
        if (!check(id)) continue;
        if (!passive.has(id)) passive.set(id, []);
        passive.get(id).push([other, length, check(other)]);
      }
    }
    return passive;
  }
  function adopt(members) {
    for (let changed = true; changed;) {
      changed = false;
      for (const [id, neighbours] of passiveNeighbours()) {
        if (members.has(id)) continue;
        let inside = 0, outside = 0;
        for (const [other, length, otherPassive] of neighbours) {
          if (members.has(other)) inside += length;
          else if (!otherPassive) outside += length;
        }
        if (inside > outside) { members.add(id); changed = true; }
      }
    }
  }
  let lastSignature, lastResult;
  return {
    getBoundaryLines(memberIdSet, { adoptPassive = false } = {}) {
      const members = new Set(memberIdSet);
      const signature = JSON.stringify([adoptPassive, ...[...members].sort()]);
      if (signature === lastSignature) return lastResult;
      if (adoptPassive && members.size) adopt(members);
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
