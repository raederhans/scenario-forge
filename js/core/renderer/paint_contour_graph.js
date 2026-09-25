// Geometry-only shared-edge graph for the composed land surface. No country,
// ownership, palette, projection or viewport state participates in adjacency.
// Coordinates are snapped to 1e-7 degrees for identity, not for rendering.
const SCALE = 1e7;
const keyOf = ([x, y]) => `${x},${y}`;
const compare = (a, b) => a[0] - b[0] || a[1] - b[1];
const coordinate = (point) => {
  if (!Array.isArray(point) || !Number.isFinite(point[0]) || !Number.isFinite(point[1])
    || Math.abs(point[1]) > 90 || Math.abs(point[0]) > 540) return null;
  let x = Math.round(point[0] * SCALE);
  const y = Math.round(point[1] * SCALE);
  // The two representations of the date line are the same topological vertex.
  x = ((x + 180 * SCALE) % (360 * SCALE) + 360 * SCALE) % (360 * SCALE) - 180 * SCALE;
  return [x, y];
};
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };

function ringSide(ring, hole) {
  let area = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const a = ring[i], b = ring[i + 1];
    let dx = b[0] - a[0];
    if (dx > 180) dx -= 360;
    if (dx < -180) dx += 360;
    area -= dx * (a[1] + b[1]);
  }
  return (area < 0 ? -1 : 1) * (hole ? -1 : 1);
}

function pairFor(members) {
  // Multiple polygons on the same side signal overlapping source geometry, not
  // a proven interior border. Do not invent an edge through an ambiguous face.
  const left = new Set(), right = new Set();
  for (const member of members) (member > 0 ? left : right).add(Math.abs(member) - 1);
  if (left.size !== 1 || right.size !== 1) return null;
  const a = left.values().next().value, b = right.values().next().value;
  return a === b ? null : [Math.min(a, b), Math.max(a, b)];
}

function sharedSegments(edges, diagnostics) {
  const shared = [];
  const unmatched = [];
  for (const edge of edges.values()) {
    const pair = pairFor(edge.members);
    if (pair) shared.push({ ...edge, pair });
    else if (edge.members.length === 1) unmatched.push(edge);
    else if (new Set(edge.members.map(Math.abs)).size > 1) diagnostics.ambiguousSegments += 1;
  }
  diagnostics.exactSharedSegments = shared.length;

  // Only unmatched edges need noding. An exact infinite-line key and a sweep of
  // interval endpoints handle a long edge opposite several collinear pieces.
  // This is NOT a nearest-neighbour join: close but distinct borders stay apart.
  const lines = new Map();
  for (const edge of unmatched) {
    const dx = edge.b[0] - edge.a[0], dy = edge.b[1] - edge.a[1];
    if (Math.abs(dx) > 180 * SCALE) continue;
    const divisor = gcd(dx, dy);
    if (!divisor) continue;
    const ux = dx / divisor, uy = dy / divisor;
    const offset = BigInt(ux) * BigInt(edge.a[1]) - BigInt(uy) * BigInt(edge.a[0]);
    const key = `${ux},${uy},${offset}`;
    let group = lines.get(key);
    if (!group) lines.set(key, group = []);
    group.push(edge);
  }
  let repairedSourceSegments = 0;
  for (const group of lines.values()) {
    if (group.length < 2 || !group.some(e => e.members[0] > 0) || !group.some(e => e.members[0] < 0)) continue;
    const useX = group[0].b[0] !== group[0].a[0];
    const events = new Map();
    const event = (point, original) => {
      const t = point[useX ? 0 : 1];
      if (!events.has(t)) events.set(t, { point, original, add: [], remove: [] });
      return events.get(t);
    };
    for (const edge of group) {
      event(edge.a, edge.start).add.push(edge);
      event(edge.b, edge.end).remove.push(edge);
    }
    const ordered = [...events.keys()].sort((a, b) => a - b);
    const active = new Set(), repaired = new Set();
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const current = events.get(ordered[i]), next = events.get(ordered[i + 1]);
      for (const edge of current.remove) active.delete(edge);
      for (const edge of current.add) active.add(edge);
      const pair = pairFor([...active].flatMap(e => e.members));
      if (!pair) continue;
      shared.push({ a: current.point, b: next.point, start: current.original, end: next.original, pair });
      diagnostics.nodedSharedSegments += 1;
      for (const edge of active) repaired.add(edge);
    }
    repairedSourceSegments += repaired.size;
  }
  diagnostics.oneSidedSegments = unmatched.length - repairedSourceSegments;
  return shared;
}

function packChains(segments, featureIds, diagnostics) {
  const groups = new Map();
  for (const edge of segments) {
    const key = edge.pair.join(':');
    let group = groups.get(key);
    if (!group) groups.set(key, group = { pair: edge.pair, edges: [] });
    group.edges.push(edge);
  }
  const paths = [], pairs = [];
  let pointCount = 0;
  for (const { pair, edges } of groups.values()) {
    const nodes = new Map(), used = new Set();
    edges.forEach((edge, index) => {
      for (const p of [edge.a, edge.b]) {
        const key = keyOf(p);
        if (!nodes.has(key)) nodes.set(key, []);
        nodes.get(key).push(index);
      }
    });
    function walk(start, firstIndex) {
      const points = [];
      let vertex = start, index = firstIndex;
      while (!used.has(index)) {
        used.add(index);
        const edge = edges[index], forward = keyOf(edge.a) === vertex;
        if (!points.length) points.push(forward ? edge.start : edge.end);
        points.push(forward ? edge.end : edge.start);
        vertex = keyOf(forward ? edge.b : edge.a);
        const adjacent = nodes.get(vertex);
        if (adjacent.length !== 2) break;
        const next = adjacent.find(candidate => !used.has(candidate));
        if (next === undefined) break;
        index = next;
      }
      if (points.length > 1) { paths.push(points); pairs.push(pair); pointCount += points.length; }
    }
    for (const [vertex, adjacent] of nodes) {
      if (adjacent.length === 2) continue;
      for (const index of adjacent) if (!used.has(index)) walk(vertex, index);
    }
    edges.forEach((edge, index) => { if (!used.has(index)) walk(keyOf(edge.a), index); });
  }
  const coordinates = new Float64Array(pointCount * 2);
  const offsets = new Uint32Array(paths.length + 1);
  const owners = new Uint32Array(paths.length * 2);
  let position = 0;
  paths.forEach((points, index) => {
    offsets[index] = position;
    owners[index * 2] = pairs[index][0]; owners[index * 2 + 1] = pairs[index][1];
    for (const p of points) { coordinates[position * 2] = p[0]; coordinates[position * 2 + 1] = p[1]; position += 1; }
  });
  offsets[paths.length] = position;
  return { featureIds: [...featureIds], coordinates, offsets, owners,
    diagnostics: { ...diagnostics, arcCount: paths.length, pointCount, packedBytes: coordinates.byteLength + offsets.byteLength + owners.byteLength } };
}

export function createPaintContourGraphBuilder() {
  const edges = new Map(), idToIndex = new Map(), featureIds = [], featureEdges = new Map();
  const invalidRingsById = new Map();
  function remove(featureId) {
    const id = idToIndex.get(String(featureId));
    if (id === undefined) return;
    for (const edge of featureEdges.get(id) || []) {
      edge.members = edge.members.filter(member => Math.abs(member) !== id + 1);
      if (!edge.members.length) edges.delete(edge.key);
    }
    featureEdges.delete(id); invalidRingsById.delete(id);
  }
  function add({ id: rawId, geometry }) {
    const featureId = String(rawId || '').trim();
    if (!featureId) return;
    remove(featureId);
    let id = idToIndex.get(featureId);
    if (id === undefined) { id = featureIds.length; featureIds.push(featureId); idToIndex.set(featureId, id); }
    const touched = new Set();
    let invalidRings = 0;
    function polygon(rings) {
      if (!Array.isArray(rings)) return;
      rings.forEach((ring, ringIndex) => {
        if (!Array.isArray(ring) || ring.length < 4) { invalidRings += 1; return; }
        const snapped = ring.map(coordinate);
        if (snapped.some(p => !p) || compare(snapped[0], snapped.at(-1)) !== 0) { invalidRings += 1; return; }
        const side = ringSide(ring, ringIndex > 0);
        for (let i = 0; i < snapped.length - 1; i += 1) {
          const order = compare(snapped[i], snapped[i + 1]);
          if (!order) continue;
          const forward = order < 0;
          const a = snapped[forward ? i : i + 1], b = snapped[forward ? i + 1 : i];
          const key = `${keyOf(a)};${keyOf(b)}`;
          let edge = edges.get(key);
          if (!edge) {
            edge = { key, a, b, start: ring[forward ? i : i + 1].slice(0, 2), end: ring[forward ? i + 1 : i].slice(0, 2), members: [] };
            edges.set(key, edge);
          }
          const member = (id + 1) * side * (forward ? 1 : -1);
          if (!edge.members.includes(member)) edge.members.push(member);
          touched.add(edge);
        }
      });
    }
    function visit(value) {
      if (value?.type === 'Polygon') polygon(value.coordinates);
      else if (value?.type === 'MultiPolygon') (value.coordinates || []).forEach(polygon);
      else if (value?.type === 'GeometryCollection') (value.geometries || []).forEach(visit);
    }
    visit(geometry);
    featureEdges.set(id, touched);
    invalidRingsById.set(id, invalidRings);
  }
  return Object.freeze({
    patch(features = [], removedIds = []) { removedIds.forEach(remove); features.forEach(add); },
    finish() {
      const diagnostics = { featureCount: featureEdges.size, segmentCount: edges.size, invalidRings: [...invalidRingsById.values()].reduce((sum, count) => sum + count, 0),
        ambiguousSegments: 0, exactSharedSegments: 0, nodedSharedSegments: 0, oneSidedSegments: 0 };
      return packChains(sharedSegments(edges, diagnostics), featureIds, diagnostics);
    },
  });
}

export function buildPaintContourGraph(features = []) {
  const builder = createPaintContourGraphBuilder();
  builder.patch(features);
  return builder.finish();
}
