// The compact geometry graph is immutable. Paint and display ownership only
// choose which of its shared arcs are visible.
export function createPaintContourMesh(graph, resolveColor, {
  resolveBoundaryKey = () => null,
  separatePoliticalBorders = () => false,
} = {}) {
  const { featureIds, offsets, owners, coordinates } = graph;
  if (!(coordinates instanceof Float64Array) || !(offsets instanceof Uint32Array)
    || !(owners instanceof Uint32Array) || owners.length !== (offsets.length - 1) * 2
    || coordinates.length !== offsets.at(-1) * 2) throw new TypeError('Invalid paint contour graph');
  const incidents = new Map(), colors = new Array(featureIds.length), boundaryKeys = new Array(featureIds.length), active = new Map();
  let revision = 0, mesh = null, bordersSeparated = false;
  for (let i = 0; i < owners.length; i += 1) {
    const id = featureIds[owners[i]];
    if (!incidents.has(id)) incidents.set(id, []);
    incidents.get(id).push(i >> 1);
  }
  const normalize = value => /^#[0-9a-f]{6}$/i.test(String(value || '').trim()) ? String(value).trim().toLowerCase() : null;
  const normalizeBoundaryKey = value => String(value ?? '').trim() || null;
  const indices = new Map(featureIds.map((id, i) => [id, i]));
  function refresh(featureIdsToRefresh = null) {
    const nextBordersSeparated = !!separatePoliticalBorders();
    const modeChanged = nextBordersSeparated !== bordersSeparated;
    bordersSeparated = nextBordersSeparated;
    const candidates = featureIdsToRefresh == null ? featureIds : new Set(featureIdsToRefresh);
    const affected = new Set();
    for (const id of candidates) {
      const index = indices.get(id);
      if (index === undefined) continue;
      const nextColor = normalize(resolveColor(id));
      const nextBoundaryKey = normalizeBoundaryKey(resolveBoundaryKey(id));
      if (nextColor === colors[index] && nextBoundaryKey === boundaryKeys[index]) continue;
      colors[index] = nextColor;
      boundaryKeys[index] = nextBoundaryKey;
      for (const arc of incidents.get(id) || []) affected.add(arc);
    }
    if (modeChanged) for (let arc = 0; arc < offsets.length - 1; arc += 1) affected.add(arc);
    let changed = false;
    for (const arc of affected) {
      const a = colors[owners[arc * 2]], b = colors[owners[arc * 2 + 1]];
      const ownerA = boundaryKeys[owners[arc * 2]], ownerB = boundaryKeys[owners[arc * 2 + 1]];
      const enabled = !!a && !!b && a !== b
        && (!bordersSeparated || (!!ownerA && !!ownerB && ownerA === ownerB));
      if (enabled === active.has(arc)) continue;
      changed = true;
      if (!enabled) { active.delete(arc); continue; }
      const line = [];
      for (let i = offsets[arc]; i < offsets[arc + 1]; i += 1) line.push([coordinates[i * 2], coordinates[i * 2 + 1]]);
      active.set(arc, line);
    }
    if (changed) { revision += 1; mesh = null; }
    return changed;
  }
  refresh();
  return Object.freeze({
    refresh,
    getRevision: () => revision,
    getActiveArcCount: () => active.size,
    getMesh() {
      if (!mesh) mesh = { type: 'MultiLineString', coordinates: [...active.values()] };
      return mesh;
    },
  });
}
