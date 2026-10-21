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

// The persistent graph contains millions of edges. Keep their exact snapped
// keys, original Float64 endpoints and usual two signed owners in columns,
// rather than an object, string and several Arrays/Sets for every segment.
const EDGE_SHIFT = 12, EDGE_CHUNK = 1 << EDGE_SHIFT, EDGE_MASK = EDGE_CHUNK - 1;
const TOMBSTONE = 0xffffffff;
class ContourEdgeView {
  constructor(store, index) { this.store = store; this.index = index; }
  get key() { return this.index + 1; }
  get a() { return this.store.point(this.index, false, false); }
  get b() { return this.store.point(this.index, true, false); }
  get start() { return this.store.point(this.index, false, true); }
  get end() { return this.store.point(this.index, true, true); }
  get members() { return this.store.members(this.index); }
}
// Scalar queries must not materialize a point Array on each sort comparison.
// Temporary split edges retain their ordinary point arrays and exact values.
function edgeCoordinate(edge, second, axis, original = false) {
  return edge instanceof ContourEdgeView ? edge.store.scalar(edge.index, second, axis, original)
    : edge[original ? (second ? 'end' : 'start') : (second ? 'b' : 'a')][axis];
}
function copyEdge(edge, overrides) {
  return edge instanceof ContourEdgeView
    ? { key: edge.key, a: edge.a, b: edge.b, start: edge.start, end: edge.end, members: edge.members, ...overrides }
    : { ...edge, ...overrides };
}

function createCompactEdges() {
  const chunks = [], overflow = new Map();
  let table = new Uint32Array(2048), used = 0, size = 0, allocated = 0;
  let head = 0, tail = 0, free = 0, views = null;
  const chunk = index => chunks[index >>> EDGE_SHIFT];
  const offset = index => index & EDGE_MASK;
  function hash(ax, ay, bx, by) {
    let value = Math.imul(ax ^ 0x9e3779b9, 0x85ebca6b);
    value = Math.imul(value ^ ay, 0xc2b2ae35);
    value = Math.imul(value ^ bx, 0x85ebca6b);
    value = Math.imul(value ^ by, 0xc2b2ae35);
    return (value ^ value >>> 16) >>> 0;
  }
  function locate(ax, ay, bx, by) {
    let slot = hash(ax, ay, bx, by) & (table.length - 1), empty = -1;
    for (;;) {
      const token = table[slot];
      if (!token) return { slot: empty < 0 ? slot : empty, index: -1 };
      if (token === TOMBSTONE) { if (empty < 0) empty = slot; }
      else {
        const index = token - 1, values = chunk(index).snapped, at = offset(index) * 4;
        if (values[at] === ax && values[at + 1] === ay && values[at + 2] === bx && values[at + 3] === by) return { slot, index };
      }
      slot = (slot + 1) & (table.length - 1);
    }
  }
  function rehash(length) {
    table = new Uint32Array(length); used = size;
    for (let token = head; token; token = chunk(token - 1).links[offset(token - 1) * 2 + 1]) {
      const index = token - 1, values = chunk(index).snapped, at = offset(index) * 4;
      table[locate(values[at], values[at + 1], values[at + 2], values[at + 3]).slot] = token;
    }
  }
  function getOrAdd(a, b, start, end) {
    let found = locate(a[0], a[1], b[0], b[1]);
    if (found.index >= 0) return found.index;
    if ((used + 1) * 10 >= table.length * 7) {
      rehash((size + 1) * 10 >= table.length * 5 ? table.length * 2 : table.length);
      found = locate(a[0], a[1], b[0], b[1]);
    }
    let index;
    if (free) { index = free - 1; free = chunk(index).links[offset(index) * 2]; }
    else {
      if (allocated >= TOMBSTONE - 1) throw new RangeError('Contour edge index capacity exceeded.');
      index = allocated++;
      if (!(index & EDGE_MASK)) chunks.push({ snapped: new Int32Array(EDGE_CHUNK * 4),
        original: new Float64Array(EDGE_CHUNK * 4), owners: new Int32Array(EDGE_CHUNK * 2), links: new Uint32Array(EDGE_CHUNK * 2) });
    }
    const storage = chunk(index), at = offset(index) * 4, link = offset(index) * 2;
    storage.snapped.set([a[0], a[1], b[0], b[1]], at);
    storage.original.set([start[0], start[1], end[0], end[1]], at);
    storage.links[link] = tail; storage.links[link + 1] = 0;
    if (tail) chunk(tail - 1).links[offset(tail - 1) * 2 + 1] = index + 1;
    else head = index + 1;
    tail = index + 1;
    if (!table[found.slot]) used++;
    table[found.slot] = index + 1; size++;
    return index;
  }
  function members(index) {
    const values = chunk(index).owners, at = offset(index) * 2;
    return overflow.get(index) || (values[at + 1] ? [values[at], values[at + 1]] : [values[at]]);
  }
  function addMember(index, member) {
    const values = chunk(index).owners, at = offset(index) * 2, extra = overflow.get(index);
    if (extra) { if (extra.includes(member)) return false; extra.push(member); return true; }
    if (values[at] === member || values[at + 1] === member) return false;
    if (!values[at]) values[at] = member;
    else if (!values[at + 1]) values[at + 1] = member;
    else overflow.set(index, [values[at], values[at + 1], member]);
    return true;
  }
  function removeMember(index, owner) {
    const storage = chunk(index), at = offset(index) * 2, values = storage.owners;
    if (!values[at]) return;
    const next = members(index).filter(member => Math.abs(member) !== owner);
    values[at] = next[0] || 0; values[at + 1] = next[1] || 0;
    if (next.length > 2) overflow.set(index, next); else overflow.delete(index);
    if (next.length) return;
    const key = offset(index) * 4, coordinates = storage.snapped;
    table[locate(coordinates[key], coordinates[key + 1], coordinates[key + 2], coordinates[key + 3]).slot] = TOMBSTONE;
    const before = storage.links[at], after = storage.links[at + 1];
    if (before) chunk(before - 1).links[offset(before - 1) * 2 + 1] = after; else head = after;
    if (after) chunk(after - 1).links[offset(after - 1) * 2] = before; else tail = before;
    storage.links[at] = free; free = index + 1; size--;
  }
  return {
    get size() { return size; }, getOrAdd, addMember, removeMember, members,
    point(index, second, original) {
      const values = chunk(index)[original ? 'original' : 'snapped'], at = offset(index) * 4 + (second ? 2 : 0);
      return [values[at], values[at + 1]];
    },
    scalar(index, second, axis, original) {
      return chunk(index)[original ? 'original' : 'snapped'][offset(index) * 4 + (second ? 2 : 0) + axis];
    },
    beginRead() { views = []; }, endRead() { views = null; },
    *values() {
      for (let token = head; token; token = chunk(token - 1).links[offset(token - 1) * 2 + 1]) {
        const index = token - 1;
        yield views ? views[index] ||= new ContourEdgeView(this, index) : new ContourEdgeView(this, index);
      }
    },
    stats() { return { compactEdgeBytes: table.byteLength + chunks.reduce((sum, item) => sum + item.snapped.byteLength
      + item.original.byteLength + item.owners.byteLength + item.links.byteLength, 0),
      edgeCapacity: chunks.length * EDGE_CHUNK, overflowEdges: overflow.size }; },
  };
}

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
        for (const edge of list) remaining.push(copyEdge(edge, { a: current.point, b: next.point,
          start: current.original, end: next.original }));
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
function sourceCollinear(edge, other, second) {
  const ax = edgeCoordinate(edge, false, 0, true), ay = edgeCoordinate(edge, false, 1, true);
  const bx = edgeCoordinate(edge, true, 0, true), by = edgeCoordinate(edge, true, 1, true);
  const x = edgeCoordinate(other, second, 0, true), y = edgeCoordinate(other, second, 1, true);
  const error = representationError;
  const dx = bx - ax, dxError = error(bx) + error(ax) + error(bx - ax);
  const dy = by - ay, dyError = error(by) + error(ay) + error(by - ay);
  const px = x - ax, pxError = error(x) + error(ax) + error(x - ax);
  const py = y - ay, pyError = error(y) + error(ay) + error(y - ay);
  const left = dx * py, right = dy * px, determinant = left - right;
  const bound = Math.abs(dx) * pyError + Math.abs(py) * dxError + dxError * pyError
    + Math.abs(dy) * pxError + Math.abs(px) * dyError + dyError * pxError
    + error(left) + error(right) + error(determinant);
  return Number.isFinite(bound) && Math.abs(determinant) <= bound;
}

function sourceEdgeQuery(edges, occupied) {
  // Static x-interval tree: bbox queries retain ALL original owners, including
  // edges consumed/rejected by earlier matching. No global proximity search.
  let ordered = [...edges.values(), ...occupied.filter(edge => !edge.key)]
    .filter(edge => Math.abs(edgeCoordinate(edge, true, 0) - edgeCoordinate(edge, false, 0)) <= 180 * SCALE);
  let sortedX0 = null, maxima, size = 1;
  const int32Min = -0x80000000, int32Max = 0x7fffffff;
  const fitsInt32 = value => Number.isInteger(value) && value >= int32Min && value <= int32Max;
  let canRadixSort = true;
  if (canRadixSort) {
    // Keep keys and ordinal scratch local to this build. The signed-domain
    // check and key capture share one pass over each eligible edge.
    const keys = new Int32Array(ordered.length);
    for (let index = 0; index < ordered.length; index += 1) {
      const edge = ordered[index];
      const x0 = edgeCoordinate(edge, false, 0), x1 = edgeCoordinate(edge, true, 0);
      if (!fitsInt32(x0) || !fitsInt32(x1)) {
        canRadixSort = false;
        break;
      }
      keys[index] = x0;
    }
    if (canRadixSort) {
      // Two stable 16-bit LSD passes sort unsigned ordinals by signed x0.
      // Flipping the sign bit maps signed Int32 order to unsigned key order.
      const frequencies = new Uint32Array(1 << 16);
      let ordinals = new Uint32Array(ordered.length), scratch = new Uint32Array(ordered.length);
      for (let index = 0; index < ordinals.length; index += 1) ordinals[index] = index;
      for (let shift = 0; shift < 32; shift += 16) {
        frequencies.fill(0);
        for (const ordinal of ordinals) {
          const key = (keys[ordinal] ^ 0x80000000) >>> 0;
          frequencies[(key >>> shift) & 0xffff] += 1;
        }
        let offset = 0;
        for (let bucket = 0; bucket < frequencies.length; bucket += 1) {
          const count = frequencies[bucket]; frequencies[bucket] = offset; offset += count;
        }
        for (const ordinal of ordinals) {
          const key = (keys[ordinal] ^ 0x80000000) >>> 0;
          scratch[frequencies[(key >>> shift) & 0xffff]++] = ordinal;
        }
        const previous = ordinals; ordinals = scratch; scratch = previous;
      }

      const sorted = new Array(ordered.length);
      sortedX0 = new Int32Array(ordered.length);
      for (let index = 0; index < ordinals.length; index += 1) {
        const ordinal = ordinals[index];
        sorted[index] = ordered[ordinal];
        sortedX0[index] = keys[ordinal];
      }
      ordered = sorted;
    }
  }
  if (!canRadixSort) {
    // Coordinates beyond the exact signed-Int32 domain retain the original
    // floating comparison sort and Float64 interval maxima path.
    ordered.sort((a, b) => edgeCoordinate(a, false, 0) - edgeCoordinate(b, false, 0));
  }
  while (size < ordered.length) size *= 2;
  maxima = canRadixSort
    ? new Int32Array(size * 2).fill(int32Min)
    : new Float64Array(size * 2).fill(-Infinity);
  ordered.forEach((edge, index) => { maxima[size + index] = edgeCoordinate(edge, true, 0); });
  for (let index = size - 1; index > 0; index -= 1) maxima[index] = Math.max(maxima[index * 2], maxima[index * 2 + 1]);
  return (x0, y0, x1, y1) => {
    const result = [];
    function visit(node, lo, hi) {
      if (lo >= ordered.length || (sortedX0 ? sortedX0[lo] : edgeCoordinate(ordered[lo], false, 0)) > x1 || maxima[node] < x0) return;
      if (hi - lo === 1) {
        const edge = ordered[lo];
        const ay = edgeCoordinate(edge, false, 1), by = edgeCoordinate(edge, true, 1);
        if (Math.min(ay, by) <= y1 && Math.max(ay, by) >= y0) result.push(edge);
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
  const compatible = (a, b) => sourceCollinear(a, b, false) && sourceCollinear(a, b, true)
    && sourceCollinear(b, a, false) && sourceCollinear(b, a, true);
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
        for (const edge of list) remaining.push(copyEdge(edge, { a: current.point, b: next.point,
          start: current.original, end: next.original }));
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
  const paths = [];
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
      const steps = [];
      let vertex = start, index = firstIndex;
      while (!used.has(index)) {
        used.add(index);
        const edge = edges[index], forward = keyOf(edge.a) === vertex;
        steps.push((index + 1) * (forward ? 1 : -1));
        vertex = keyOf(forward ? edge.b : edge.a);
        const adjacent = nodes.get(vertex);
        if (adjacent.length !== 2) break;
        const next = adjacent.find(candidate => !used.has(candidate));
        if (next === undefined) break;
        index = next;
      }
      if (steps.length) { paths.push({ edges, steps: Int32Array.from(steps), pair }); pointCount += steps.length + 1; }
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
  const writePoint = point => {
    coordinates[position * 2] = point[0]; coordinates[position * 2 + 1] = point[1]; position++;
  };
  paths.forEach(({ edges, steps, pair }, index) => {
    offsets[index] = position;
    owners[index * 2] = pair[0]; owners[index * 2 + 1] = pair[1];
    for (let step = 0; step < steps.length; step++) {
      const token = steps[step], edge = edges[Math.abs(token) - 1], forward = token > 0;
      if (!step) writePoint(forward ? edge.start : edge.end);
      writePoint(forward ? edge.end : edge.start);
    }
  });
  offsets[paths.length] = position;
  return { featureIds: [...featureIds], coordinates, offsets, owners,
    diagnostics: { ...diagnostics, arcCount: paths.length, pointCount, packedBytes: coordinates.byteLength + offsets.byteLength + owners.byteLength } };
}

export function createPaintContourGraphBuilder() {
  const edges = createCompactEdges(), idToIndex = new Map(), featureIds = [], featureEdges = new Map();
  const invalidRingsById = new Map(), precisions = new Map();
  function remove(featureId) {
    const id = idToIndex.get(String(featureId));
    if (id === undefined) return;
    for (const edge of featureEdges.get(id) || []) edges.removeMember(edge, id + 1);
    featureEdges.delete(id); invalidRingsById.delete(id); precisions.delete(id);
  }
  function add({ id: rawId, geometry, coordinatePrecision = 7 }) {
    const featureId = String(rawId || '').trim();
    if (!featureId) return;
    remove(featureId);
    let id = idToIndex.get(featureId);
    if (id === undefined) { id = featureIds.length; featureIds.push(featureId); idToIndex.set(featureId, id); }
    precisions.set(id, coordinatePrecision === 4 ? 4 : 7);
    const touched = [];
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
          const edge = edges.getOrAdd(a, b, ring[forward ? i : i + 1], ring[forward ? i + 1 : i]);
          const member = (id + 1) * side * (forward ? 1 : -1);
          if (edges.addMember(edge, member)) touched.push(edge);
        }
      });
    }
    function visit(value) {
      if (value?.type === 'Polygon') polygon(value.coordinates);
      else if (value?.type === 'MultiPolygon') (value.coordinates || []).forEach(polygon);
      else if (value?.type === 'GeometryCollection') (value.geometries || []).forEach(visit);
    }
    visit(geometry);
    featureEdges.set(id, Uint32Array.from(touched));
    invalidRingsById.set(id, invalidRings);
  }
  return Object.freeze({
    patch(features = [], removedIds = []) { removedIds.forEach(remove); features.forEach(add); },
    finish() {
      const diagnostics = { featureCount: featureEdges.size, segmentCount: edges.size, invalidRings: [...invalidRingsById.values()].reduce((sum, count) => sum + count, 0),
        ambiguousSegments: 0, exactSharedSegments: 0, nodedSharedSegments: 0, sourceNodedSharedSegments: 0,
        sourceLineComparisons: 0, sourceLineMaxBucket: 0, sourceLineSkippedBuckets: 0, sourceLineSkippedGroups: 0,
        quantizedSharedSegments: 0, ambiguousQuantizedSegments: 0, oneSidedSegments: 0 };
      edges.beginRead();
      let segments;
      try { segments = sharedSegments(edges, diagnostics, precisions); }
      finally { edges.endRead(); }
      // Packing must not keep views for the unshared world coastline alive.
      // Only accepted shared segments survive into the output phase.
      return packChains(segments, featureIds, diagnostics);
    },
    getStorageStats() { return { ...edges.stats(), segmentCount: edges.size,
      featureEdgeIndexBytes: [...featureEdges.values()].reduce((sum, indices) => sum + indices.byteLength, 0) }; },
  });
}

export function buildPaintContourGraph(features = []) {
  const builder = createPaintContourGraphBuilder();
  builder.patch(features);
  return builder.finish();
}
