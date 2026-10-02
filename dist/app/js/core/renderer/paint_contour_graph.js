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
  let left = -1, right = -1;
  for (const member of members) {
    const id = Math.abs(member) - 1;
    if (member > 0) { if (left !== -1 && left !== id) return null; left = id; }
    else { if (right !== -1 && right !== id) return null; right = id; }
  }
  return left < 0 || right < 0 || left === right ? null : [Math.min(left, right), Math.max(left, right)];
}

function nodeEdges(unmatched, diagnostics, accept = () => true, metric = 'nodedSharedSegments') {
  // Exact line sweep also handles unequal segmentation. No distance search.
  const shared = [], lines = new Map(), repaired = new Set(), remaining = [];
  for (const edge of unmatched) {
    const dx = edge.b[0] - edge.a[0], dy = edge.b[1] - edge.a[1];
    if (Math.abs(dx) > 180 * SCALE) continue;
    const divisor = gcd(dx, dy);
    if (!divisor) continue;
    const ux = dx / divisor, uy = dy / divisor;
    const offset = BigInt(ux) * BigInt(edge.a[1]) - BigInt(uy) * BigInt(edge.a[0]);
    const key = `${ux},${uy},${offset}`;
    const previous = lines.get(key);
    // Most coast segments are unique. Avoid allocating an Array per coastline.
    if (!previous) lines.set(key, edge);
    else if (Array.isArray(previous)) previous.push(edge);
    else lines.set(key, [previous, edge]);
  }
  for (const group of lines.values()) {
    if (!Array.isArray(group)) { remaining.push(group); continue; }
    if (!accept(group) || !group.some(e => e.members[0] > 0) || !group.some(e => e.members[0] < 0)) {
      for (const edge of group) remaining.push(edge);
      continue;
    }
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
    const active = new Set();
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const current = events.get(ordered[i]), next = events.get(ordered[i + 1]);
      for (const edge of current.remove) active.delete(edge);
      for (const edge of current.add) active.add(edge);
      const list = [...active];
      const pair = accept(list) ? pairFor(list.flatMap(e => e.members)) : null;
      if (!pair) {
        // Keep unmatched subintervals. Dropping an entire partly matched edge
        // would hide a later coarse/fine seam along its remaining portion.
        for (const edge of list) remaining.push({ ...edge, a: current.point, b: next.point,
          start: current.original, end: next.original });
        continue;
      }
      shared.push({ a: current.point, b: next.point, start: current.original, end: next.original, pair });
      diagnostics[metric] += 1;
      for (const edge of active) repaired.add(edge);
    }
  }
  return { shared, repaired, remaining };
}

// Input coordinates can differ by their floating representation error even
// when they describe subdivisions of the same source line. Propagate one ULP
// of input uncertainty through subtraction, multiplication and the determinant;
// this is a numerical error bound, not a geographic snapping distance.
const representationError = value => Math.max(Number.MIN_VALUE, Math.abs(value) * Number.EPSILON);
function sourceCollinear(edge, point) {
  const [a, b] = [edge.start, edge.end];
  const error = representationError;
  const difference = (x, y) => [x - y, error(x) + error(y) + error(x - y)];
  const [dx, dxError] = difference(b[0], a[0]), [dy, dyError] = difference(b[1], a[1]);
  const [px, pxError] = difference(point[0], a[0]), [py, pyError] = difference(point[1], a[1]);
  const left = dx * py, right = dy * px, determinant = left - right;
  const bound = Math.abs(dx) * pyError + Math.abs(py) * dxError + dxError * pyError
    + Math.abs(dy) * pxError + Math.abs(px) * dyError + dyError * pxError
    + error(left) + error(right) + error(determinant);
  return Number.isFinite(bound) && Math.abs(determinant) <= bound;
}

function sourceEdgeQuery(edges, occupied) {
  // Static x-interval tree: bbox queries retain ALL original owners, including
  // edges consumed/rejected by earlier matching. No global proximity search.
  const ordered = [...edges.values(), ...occupied.filter(edge => !edge.key)]
    .filter(edge => Math.abs(edge.b[0] - edge.a[0]) <= 180 * SCALE)
    .sort((a, b) => a.a[0] - b.a[0]);
  let size = 1; while (size < ordered.length) size *= 2;
  const maxima = new Float64Array(size * 2).fill(-Infinity);
  ordered.forEach((edge, index) => { maxima[size + index] = edge.b[0]; });
  for (let index = size - 1; index > 0; index -= 1) maxima[index] = Math.max(maxima[index * 2], maxima[index * 2 + 1]);
  return (x0, y0, x1, y1) => {
    const result = [];
    function visit(node, lo, hi) {
      if (lo >= ordered.length || ordered[lo].a[0] > x1 || maxima[node] < x0) return;
      if (hi - lo === 1) {
        const edge = ordered[lo];
        if (Math.min(edge.a[1], edge.b[1]) <= y1 && Math.max(edge.a[1], edge.b[1]) >= y0) result.push(edge);
        return;
      }
      const mid = (lo + hi) >>> 1;
      visit(node * 2, lo, mid); visit(node * 2 + 1, mid, hi);
    }
    visit(1, 0, size);
    return result;
  };
}

function nodeSourceEdges(unmatched, diagnostics, precisions, originalEdges, occupiedSegments) {
  // Exceeding this bounded fallback work leaves the original graph unchanged.
  // It is not an input rejection or a relaxed geometric acceptance threshold.
  const maxComparisonsPerGroup = 4096;
  const buckets = new Map(), parents = unmatched.map((_, index) => index);
  const find = index => { while (parents[index] !== index) { parents[index] = parents[parents[index]]; index = parents[index]; } return index; };
  const compatible = (a, b) => sourceCollinear(a, b.start) && sourceCollinear(a, b.end)
    && sourceCollinear(b, a.start) && sourceCollinear(b, a.end);
  for (let index = 0; index < unmatched.length; index += 1) {
    const edge = unmatched[index];
    if (precisions.get(Math.abs(edge.members[0]) - 1) !== 7 || Math.abs(edge.b[0] - edge.a[0]) > 180 * SCALE) continue;
    for (const identity of [edge.a, edge.b]) {
      // The existing identity vertex supplies candidates only. Independently
      // calculated cuts can differ along the same source line; the two complete
      // source lines must still pass the floating collinearity bound below.
      const key = keyOf(identity);
      let bucket = buckets.get(key);
      if (!bucket) buckets.set(key, bucket = []);
      bucket.push(index);
      diagnostics.sourceLineMaxBucket = Math.max(diagnostics.sourceLineMaxBucket, bucket.length);
    }
  }
  for (const bucket of buckets.values()) {
    if (bucket.length * (bucket.length - 1) / 2 > maxComparisonsPerGroup) {
      diagnostics.sourceLineSkippedBuckets += 1; continue;
    }
    for (let i = 0; i < bucket.length; i += 1) for (let j = i + 1; j < bucket.length; j += 1) {
      diagnostics.sourceLineComparisons += 1;
      if (compatible(unmatched[bucket[i]], unmatched[bucket[j]])) parents[find(bucket[i])] = find(bucket[j]);
    }
  }
  const groups = new Map();
  unmatched.forEach((edge, index) => {
    const root = find(index);
    let group = groups.get(root);
    if (!group) groups.set(root, group = []);
    group.push(edge);
  });
  const shared = [], remaining = [], occupied = new Set(occupiedSegments);
  let query = null;
  for (const group of groups.values()) {
    // Reject an approximate transitive chain: every source line in the group
    // must agree directly with every other one before any interval is accepted.
    if (group.length * (group.length - 1) / 2 > maxComparisonsPerGroup) {
      diagnostics.sourceLineSkippedGroups += 1; remaining.push(...group); continue;
    }
    if (group.length < 2 || !group.some(e => e.members[0] > 0) || !group.some(e => e.members[0] < 0)
      || !group.every((edge, index) => group.slice(index + 1).every(other => {
        diagnostics.sourceLineComparisons += 1; return compatible(edge, other);
      }))) {
      remaining.push(...group); continue;
    }
    query ||= sourceEdgeQuery(originalEdges, occupiedSegments);
    const xs = group.flatMap(edge => [edge.a[0], edge.b[0]]), ys = group.flatMap(edge => [edge.a[1], edge.b[1]]);
    const blockers = query(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys))
      .filter(edge => compatible(group[0], edge));
    const candidates = new Set(group);
    const useX = group[0].b[0] !== group[0].a[0], axis = useX ? 0 : 1;
    const events = new Map();
    const event = (point, original) => {
      const t = point[axis];
      if (!events.has(t)) events.set(t, { point, original, add: [], remove: [] });
      return events.get(t);
    };
    for (const edge of new Set([...group, ...blockers])) {
      event(edge.a, edge.start).add.push(edge);
      event(edge.b, edge.end).remove.push(edge);
    }
    const ordered = [...events.keys()].sort((a, b) => a - b), active = new Set();
    for (let i = 0; i < ordered.length - 1; i += 1) {
      const current = events.get(ordered[i]), next = events.get(ordered[i + 1]);
      for (const edge of current.remove) active.delete(edge);
      for (const edge of current.add) active.add(edge);
      const list = [...active].filter(edge => candidates.has(edge));
      if (!list.length) continue;
      const candidatePair = pairFor(list.flatMap(edge => edge.members));
      const pair = candidatePair && ![...active].some(edge => occupied.has(edge))
        ? pairFor([...active].flatMap(edge => edge.members || [])) : null;
      if (pair) {
        shared.push({ a: current.point, b: next.point, start: current.original, end: next.original, pair });
        diagnostics.sourceNodedSharedSegments += 1;
      } else {
        for (const edge of list) remaining.push({ ...edge, a: current.point, b: next.point,
          start: current.original, end: next.original });
      }
    }
  }
  return { shared, remaining };
}

function sharedSegments(edges, diagnostics, precisions) {
  const shared = [], unmatched = [];
  for (const edge of edges.values()) {
    const pair = pairFor(edge.members);
    if (pair) { edge.pair = pair; shared.push(edge); }
    else if (edge.members.length === 1) unmatched.push(edge);
    else if (edge.members.some(member => Math.abs(member) !== Math.abs(edge.members[0]))) diagnostics.ambiguousSegments += 1;
  }
  diagnostics.exactSharedSegments = shared.length;
  const exact = nodeEdges(unmatched, diagnostics);
  for (const edge of exact.shared) shared.push(edge);
  const source = nodeSourceEdges(exact.remaining, diagnostics, precisions, edges, shared);
  for (const edge of source.shared) shared.push(edge);

  // Cross-LOD joins are allowed ONLY by the actual coarse source's declared
  // coordinate grid. Fine/fine boundaries retain 1e-7 identity, even if close.
  // Compare unresolved edges at that grid, require two unique opposite sides,
  // and render the coarser line. Ambiguous overlaps are never welded.
  const remaining = source.remaining;
  const coarseEdges = remaining.filter(edge => precisions.get(Math.abs(edge.members[0]) - 1) === 4);
  let joinedSources = 0;
  if (coarseEdges.length) {
    const grid = 1000;
    const snap = point => point.map(n => Math.round(n / grid) * grid);
    const candidates = new Map();
    const quantize = edge => {
      let a = snap(edge.a), b = snap(edge.b);
      const order = compare(a, b);
      if (!order) return null;
      const forward = order < 0;
      if (!forward) [a, b] = [b, a];
      return { a, b, start: a.map(n => n / SCALE), end: b.map(n => n / SCALE),
        members: forward ? edge.members : edge.members.map(n => -n),
        coarse: precisions.get(Math.abs(edge.members[0]) - 1) === 4, source: edge };
    };
    for (const edge of remaining) {
      const q = quantize(edge); if (!q) continue;
      const key = `${keyOf(q.a)};${keyOf(q.b)}`;
      const group = candidates.get(key);
      if (group) group.push(q); else candidates.set(key, [q]);
    }
    const leftover = [];
    const validMixed = list => list.some(e => e.coarse) && list.some(e => !e.coarse);
    const joined = new Set();
    for (const group of candidates.values()) {
      const pair = validMixed(group) ? pairFor(group.flatMap(e => e.members)) : null;
      if (pair) {
        const edge = group.find(e => e.coarse);
        shared.push({ ...edge, pair }); diagnostics.quantizedSharedSegments += 1;
        for (const candidate of group) joined.add(candidate.source);
      } else if (group.length === 1) leftover.push(group[0]);
      else if (validMixed(group)) diagnostics.ambiguousQuantizedSegments += 1;
    }
    const quantized = nodeEdges(leftover, diagnostics, validMixed, 'quantizedSharedSegments');
    for (const edge of quantized.shared) shared.push(edge);
    for (const edge of quantized.repaired) joined.add(edge.source);
    joinedSources = joined.size;
  }
  diagnostics.oneSidedSegments = remaining.length - joinedSources;
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
  const invalidRingsById = new Map(), precisions = new Map();
  function remove(featureId) {
    const id = idToIndex.get(String(featureId));
    if (id === undefined) return;
    for (const edge of featureEdges.get(id) || []) {
      edge.members = edge.members.filter(member => Math.abs(member) !== id + 1);
      if (!edge.members.length) edges.delete(edge.key);
    }
    featureEdges.delete(id); invalidRingsById.delete(id); precisions.delete(id);
  }
  function add({ id: rawId, geometry, coordinatePrecision = 7 }) {
    const featureId = String(rawId || '').trim();
    if (!featureId) return;
    remove(featureId);
    let id = idToIndex.get(featureId);
    if (id === undefined) { id = featureIds.length; featureIds.push(featureId); idToIndex.set(featureId, id); }
    precisions.set(id, coordinatePrecision === 4 ? 4 : 7);
    const touched = new Set();
    let invalidRings = 0;
    function polygon(rings) {
      if (!Array.isArray(rings)) return;
      rings.forEach((ring, ringIndex) => {
        if (!Array.isArray(ring) || ring.length < 4) { invalidRings += 1; return; }
        let snapped = ring.map(coordinate);
        if (snapped.some(p => !p)) { invalidRings += 1; return; }
        if (compare(snapped[0], snapped.at(-1)) !== 0) {
          // d3.geoStream consumes ring.length - 1 vertices then closes it. Match
          // the actual filled surface for malformed open input, not an invented
          // last-to-first segment that the renderer never draws. Keep diagnosis.
          invalidRings += 1;
          ring = [...ring.slice(0, -1), ring[0]];
          snapped = [...snapped.slice(0, -1), snapped[0]];
        }
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
        ambiguousSegments: 0, exactSharedSegments: 0, nodedSharedSegments: 0, sourceNodedSharedSegments: 0,
        sourceLineComparisons: 0, sourceLineMaxBucket: 0, sourceLineSkippedBuckets: 0, sourceLineSkippedGroups: 0,
        quantizedSharedSegments: 0, ambiguousQuantizedSegments: 0, oneSidedSegments: 0 };
      return packChains(sharedSegments(edges, diagnostics, precisions), featureIds, diagnostics);
    },
  });
}

export function buildPaintContourGraph(features = []) {
  const builder = createPaintContourGraphBuilder();
  builder.patch(features);
  return builder.finish();
}
