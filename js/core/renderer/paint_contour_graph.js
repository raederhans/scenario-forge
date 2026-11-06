import { packContourPolygons, createContourPolygonQuery, createContourWaterQuery } from './paint_contour_water_mask.js';

// Geometry-only shared-edge graph for the composed land surface. No country,
// ownership, palette, projection or viewport state participates in adjacency.
// Coordinates are snapped to 1e-7 degrees for identity, not for rendering.
const SCALE = 1e7;
const INCREMENTAL_FEATURE_RATIO = 0.2;
// A closure that widens the context past this share of all features falls
// back to a full finish, which then costs about the same.
const INCREMENTAL_CONTEXT_RATIO = 0.5;
// Small graphs finish fast either way; the fallback only guards large ones.
const INCREMENTAL_CONTEXT_MINIMUM = 1000;
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
  constructor(store, index) {
    const storage = store.storage(index);
    this.index = index; this.at = (index & EDGE_MASK) * 4;
    this.snapped = storage.snapped; this.original = storage.original;
    const members = store.members(index);
    this.members = members.length > 2 ? [...members] : members;
    this.cachedA = null; this.cachedB = null; this.pair = null; this.lineKey = null; this.stale = false;
  }
  get key() { return this.index + 1; }
  get a() { return this.cachedA ||= [this.snapped[this.at], this.snapped[this.at + 1]]; }
  get b() { return this.cachedB ||= [this.snapped[this.at + 2], this.snapped[this.at + 3]]; }
  get start() { return [this.original[this.at], this.original[this.at + 1]]; }
  get end() { return [this.original[this.at + 2], this.original[this.at + 3]]; }
}
// Scalar queries must not materialize a point Array on each sort comparison.
// Temporary split edges retain their ordinary point arrays and exact values.
function edgeCoordinate(edge, second, axis, original = false) {
  return edge instanceof ContourEdgeView ? (original ? edge.original : edge.snapped)[edge.at + (second ? 2 : 0) + axis]
    : edge[original ? (second ? 'end' : 'start') : (second ? 'b' : 'a')][axis];
}
function copyEdge(edge, overrides) {
  return edge instanceof ContourEdgeView
    ? { key: edge.key, a: edge.a, b: edge.b, start: edge.start, end: edge.end, members: edge.members, ...overrides }
    : { ...edge, ...overrides };
}

function createCompactEdges() {
  const chunks = [], overflow = new Map(), sources = new Map();
  let table = new Uint32Array(2048), used = 0, size = 0, allocated = 0;
  let head = 0, tail = 0, free = 0, views = null;
  const retainedViews = [];
  function markStale(index) {
    // The retained view stays as the edge's line bookkeeping (lineKey and the
    // members cached at construction) from the last finish; a later read
    // replaces it with a fresh view. Cached groups that hold it involve an
    // owner adjacent to this edit, so they are recomputed, never re-read.
    const view = retainedViews.length ? retainedViews[index] : undefined;
    if (view) view.stale = true;
  }
  const chunk = index => chunks[index >>> EDGE_SHIFT];
  function fresh(index) {
    const view = views[index];
    return view && !view.stale ? view : (views[index] = new ContourEdgeView(store, index));
  }
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
        original: new Float64Array(EDGE_CHUNK * 4), owners: new Int32Array(EDGE_CHUNK * 2), links: new Uint32Array(EDGE_CHUNK * 2), marks: null, picks: null, varied: null });
    }
    const storage = chunk(index), at = offset(index) * 4, link = offset(index) * 2;
    storage.snapped[at] = a[0]; storage.snapped[at + 1] = a[1];
    storage.snapped[at + 2] = b[0]; storage.snapped[at + 3] = b[1];
    storage.original[at] = start[0]; storage.original[at + 1] = start[1];
    storage.original[at + 2] = end[0]; storage.original[at + 3] = end[1];
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
  function addMember(index, member, start, end) {
    const values = chunk(index).owners, at = offset(index) * 2, extra = overflow.get(index);
    if (extra ? extra.includes(member) : values[at] === member || values[at + 1] === member) return false;
    markStale(index);
    if (start && values[at]) joinSource(index, member, start, end);
    if (extra) { extra.push(member); return true; }
    if (!values[at]) values[at] = member;
    else if (!values[at + 1]) values[at + 1] = member;
    else overflow.set(index, [values[at], values[at + 1], member]);
    return true;
  }
  // Owners of one snapped edge can carry different Float64 inputs. Keep every
  // variant only when they differ, and store the lowest owner's, so the edge
  // does not depend on which owner happened to be added first.
  function joinSource(index, member, start, end) {
    const storage = chunk(index), original = storage.original, position = offset(index) * 4;
    const varied = storage.varied?.[offset(index)];
    if (!varied && original[position] === start[0] && original[position + 1] === start[1]
      && original[position + 2] === end[0] && original[position + 3] === end[1]) return;
    let variants = varied ? sources.get(index) : undefined;
    if (!variants) {
      variants = [];
      for (const owner of members(index)) variants.push(Math.abs(owner), original[position], original[position + 1], original[position + 2], original[position + 3]);
      sources.set(index, variants);
      (storage.varied ||= new Uint8Array(EDGE_CHUNK))[offset(index)] = 1;
    }
    variants.push(Math.abs(member), start[0], start[1], end[0], end[1]);
    restoreSource(original, position, variants);
  }
  function restoreSource(original, position, variants) {
    let first = 0;
    for (let i = 5; i < variants.length; i += 5) if (variants[i] < variants[first]) first = i;
    for (let i = 0; i < 4; i++) original[position + i] = variants[first + i + 1];
  }
  function removeMember(index, owner) {
    const storage = chunk(index), at = offset(index) * 2, values = storage.owners;
    if (!values[at]) return;
    markStale(index);
    const next = members(index).filter(member => Math.abs(member) !== owner);
    if (storage.varied?.[offset(index)]) {
      const variants = sources.get(index);
      for (let i = 0; i < variants.length; i += 5) if (variants[i] === owner) { variants.splice(i, 5); break; }
      if (variants.length) restoreSource(storage.original, offset(index) * 4, variants);
      if (variants.length <= 5) { sources.delete(index); storage.varied[offset(index)] = 0; }
    }
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
  const store = {
    get size() { return size; }, getOrAdd, addMember, removeMember, members,
    storage: chunk,
    beginRead() { views = retainedViews; }, endRead() { views = null; },
    // The given edges in list (insertion) order, which is the order a full
    // finish visits them in. One walk of the links; no per-edge sequence.
    inListOrder(lists, cycle) {
      for (const list of lists) for (const index of list) {
        const storage = chunk(index);
        (storage.picks ||= new Uint32Array(EDGE_CHUNK))[offset(index)] = cycle;
      }
      const result = [];
      for (let token = head; token; token = chunk(token - 1).links[offset(token - 1) * 2 + 1]) {
        const picks = chunk(token - 1).picks;
        if (picks && picks[offset(token - 1)] === cycle) result.push(fresh(token - 1));
      }
      return result;
    },
    // One stamp per edge and finish cycle: a typed-array test, not a Map entry.
    mark(index, cycle) {
      const storage = chunk(index), at = offset(index);
      const marks = storage.marks ||= new Uint32Array(EDGE_CHUNK);
      if (marks[at] === cycle) return false;
      marks[at] = cycle; return true;
    },
    view(index) { return views ? fresh(index) : new ContourEdgeView(this, index); },
    retained(index) { return retainedViews[index]; },
    dropViews() { retainedViews.length = 0; },
    *values() {
      for (let token = head; token; token = chunk(token - 1).links[offset(token - 1) * 2 + 1]) {
        const index = token - 1;
        yield views ? fresh(index) : new ContourEdgeView(this, index);
      }
    },
    stats() { return { compactEdgeBytes: table.byteLength + chunks.reduce((sum, item) => sum + item.snapped.byteLength
      + item.original.byteLength + item.owners.byteLength + item.links.byteLength + (item.marks?.byteLength || 0) + (item.picks?.byteLength || 0) + (item.varied?.byteLength || 0), 0),
      edgeCapacity: chunks.length * EDGE_CHUNK, overflowEdges: overflow.size, sourceVariantEdges: sources.size }; },
  };
  return store;
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

function exactLineKey(edge) {
  const dx = edge.b[0] - edge.a[0], dy = edge.b[1] - edge.a[1];
  if (Math.abs(dx) > 180 * SCALE) return null;
  const divisor = gcd(dx, dy);
  if (!divisor) return null;
  const ux = dx / divisor, uy = dy / divisor;
  return `${ux},${uy},${BigInt(ux) * BigInt(edge.a[1]) - BigInt(uy) * BigInt(edge.a[0])}`;
}

function quantizedLine(edge) {
  let ax = Math.round(edge.a[0] / 1000), ay = Math.round(edge.a[1] / 1000);
  let bx = Math.round(edge.b[0] / 1000), by = Math.round(edge.b[1] / 1000);
  if (ax > bx || (ax === bx && ay > by)) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; }
  const dx = bx - ax, dy = by - ay, divisor = gcd(dx, dy);
  if (!divisor || Math.abs(dx) > 1800000) return null;
  const ux = dx / divisor, uy = dy / divisor;
  return { key: `${ux},${uy},${ux * ay - uy * ax}`, segment: `${ax},${ay},${bx},${by},${Math.sign(edge.members[0])}` };
}

const lineCount = (line, side) => line instanceof ContourEdgeView
  ? Number((line.members[0] > 0 ? 0 : 1) === side) : line?.[side] || 0;

// Several sources can meet at one snapped vertex with sub-1e-7 differences in
// their Float64 input. Keep the lexicographically smallest one, so the emitted
// coordinates depend on the set of edges rather than on their insertion order.
function eventAt(events, t, point, original) {
  let entry = events.get(t);
  if (!entry) events.set(t, entry = { point, original, add: [], remove: [] });
  else if (original[0] < entry.original[0] || (original[0] === entry.original[0] && original[1] < entry.original[1])) entry.original = original;
  return entry;
}

function nodeEdges(unmatched, diagnostics, accept = () => true, metric = 'nodedSharedSegments', lineSides = null, registerLine = null) {
  // Exact line sweep also handles unequal segmentation. No distance search.
  const shared = [], lines = new Map(), repaired = new Set(), remaining = [];
  for (const edge of unmatched) {
    const dx = edge.b[0] - edge.a[0], dy = edge.b[1] - edge.a[1];
    if (Math.abs(dx) > 180 * SCALE) { remaining.push(edge); continue; }
    const divisor = gcd(dx, dy);
    if (!divisor) continue;
    const ux = dx / divisor, uy = dy / divisor;
    const offset = BigInt(ux) * BigInt(edge.a[1]) - BigInt(uy) * BigInt(edge.a[0]);
    const key = `${ux},${uy},${offset}`;
    if (registerLine) registerLine(edge, key);
    const previous = lines.get(key);
    // Most coast segments are unique. Avoid allocating an Array per coastline.
    if (!previous) lines.set(key, edge);
    else if (Array.isArray(previous)) previous.push(edge);
    else lines.set(key, [previous, edge]);
  }
  for (const [key, group] of lines) {
    if (!Array.isArray(group)) { remaining.push(group); continue; }
    const sides = lineSides?.get(key);
    if (!accept(group) || !(sides ? lineCount(sides, 0) : group.some(e => e.members[0] > 0))
      || !(sides ? lineCount(sides, 1) : group.some(e => e.members[0] < 0))) {
      for (const edge of group) remaining.push(edge);
      continue;
    }
    const useX = group[0].b[0] !== group[0].a[0];
    const events = new Map();
    const event = (point, original) => {
      const t = point[useX ? 0 : 1];
      return eventAt(events, t, point, original);
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
  const minimaY = new Float64Array(size * 2).fill(Infinity), maximaY = new Float64Array(size * 2).fill(-Infinity);
  ordered.forEach((edge, index) => {
    const ay = edgeCoordinate(edge, false, 1), by = edgeCoordinate(edge, true, 1);
    maxima[size + index] = edgeCoordinate(edge, true, 0);
    minimaY[size + index] = Math.min(ay, by); maximaY[size + index] = Math.max(ay, by);
  });
  for (let index = size - 1; index > 0; index -= 1) {
    maxima[index] = Math.max(maxima[index * 2], maxima[index * 2 + 1]);
    minimaY[index] = Math.min(minimaY[index * 2], minimaY[index * 2 + 1]);
    maximaY[index] = Math.max(maximaY[index * 2], maximaY[index * 2 + 1]);
  }
  return (x0, y0, x1, y1) => {
    const result = [];
    function visit(node, lo, hi) {
      if (lo >= ordered.length || (sortedX0 ? sortedX0[lo] : edgeCoordinate(ordered[lo], false, 0)) > x1 || maxima[node] < x0
        || minimaY[node] > y1 || maximaY[node] < y0) return;
      if (hi - lo === 1) {
        if (minimaY[node] <= y1 && maximaY[node] >= y0) result.push(ordered[lo]);
        return;
      }
      const mid = (lo + hi) >>> 1;
      visit(node * 2, lo, mid); visit(node * 2 + 1, mid, hi);
    }
    visit(1, 0, size);
    return result;
  };
}

function nodeSourceEdges(unmatched, diagnostics, precisions, originalEdges, occupiedSegments, onGroup = null) {
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
  // Report every connected group. It is decisive when over the comparison
  // budget or not pairwise compatible: any larger group containing it is then
  // left unmatched in the same way, so its extent cannot change the result.
  if (onGroup) for (const group of groups.values()) {
    if (group.length < 2) continue;
    const decisive = group.length * (group.length - 1) / 2 > maxComparisonsPerGroup
      || !group.every((edge, index) => group.slice(index + 1).every(other => compatible(edge, other)));
    onGroup(group, decisive);
  }
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
    const event = (point, original) => eventAt(events, point[axis], point, original);
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

function nearSeamSegments(edges, shared, diagnostics, tolerance, land, polygons, consumed) {
  if (!(tolerance > 0)) return [];
  const distanceLimit = (tolerance + 1e-12) ** 2;
  const started = performance.now(), memory = globalThis.process?.memoryUsage?.();
  const grid = new Map(), queries = new Map(), pairs = new Map();
  const ax = new Float64Array(edges.length), ay = new Float64Array(edges.length);
  const bx = new Float64Array(edges.length), by = new Float64Array(edges.length);
  const vx = new Float64Array(edges.length), vy = new Float64Array(edges.length);
  const lengths = new Float64Array(edges.length), owners = new Uint32Array(edges.length);
  const signs = new Int8Array(edges.length);
  const sourceEdges = consumed ? [] : null;
  function consume(index, lo, hi) {
    const source = sourceEdges[index];
    let ranges = consumed.get(source);
    if (!ranges) consumed.set(source, ranges = []);
    const last = ranges.at(-1);
    if (last && lo <= last[1] && hi >= last[0]) {
      last[0] = Math.min(last[0], lo); last[1] = Math.max(last[1], hi);
    } else ranges.push([lo, hi]);
  }
  const cellKey = (x, y) => x * 65536 + y;
  const gridSize = tolerance * 4;
  const padding = tolerance + 1e-12;
  let size = 0, ownerCount = 0, gridEntries = 0;
  for (const edge of edges) {
    const x0 = edgeCoordinate(edge, false, 0, true), y0 = edgeCoordinate(edge, false, 1, true);
    const x1 = edgeCoordinate(edge, true, 0, true), y1 = edgeCoordinate(edge, true, 1, true);
    const dx = x1 - x0, dy = y1 - y0, length = Math.hypot(dx, dy);
    if (!length || Math.abs(dx) > 180) continue;
    const member = edge.members[0], owner = Math.abs(member) - 1, index = size++;
    if (sourceEdges) sourceEdges[index] = edge;
    ax[index] = x0; ay[index] = y0; bx[index] = x1; by[index] = y1;
    vx[index] = dx; vy[index] = dy; lengths[index] = length;
    owners[index] = owner; signs[index] = Math.sign(member);
    ownerCount = Math.max(ownerCount, owner + 1);
    for (let x = Math.floor(Math.min(x0, x1) / gridSize); x <= Math.floor(Math.max(x0, x1) / gridSize); x++) {
      for (let y = Math.floor(Math.min(y0, y1) / gridSize); y <= Math.floor(Math.max(y0, y1) / gridSize); y++) {
        const key = cellKey(x, y);
        grid.set(key, (grid.get(key) || 0) + 1); gridEntries++;
      }
    }
  }
  for (const owner of polygons.keys()) ownerCount = Math.max(ownerCount, owner + 1);
  const buckets = new Uint32Array(grid.size * 2 + gridEntries);
  let offset = 0;
  for (const [key, count] of grid) { grid.set(key, offset); offset += count + 2; }
  for (let index = 0; index < size; index++) {
    for (let x = Math.floor(Math.min(ax[index], bx[index]) / gridSize); x <= Math.floor(Math.max(ax[index], bx[index]) / gridSize); x++) {
      for (let y = Math.floor(Math.min(ay[index], by[index]) / gridSize); y <= Math.floor(Math.max(ay[index], by[index]) / gridSize); y++) {
        const at = grid.get(cellKey(x, y)), count = buckets[at + 1]++;
        if (!count) buckets[at] = owners[index];
        else if (buckets[at] !== owners[index]) buckets[at] = 0xffffffff;
        buckets[at + 2 + count] = index;
      }
    }
  }
  function contains(owner, x, y) {
    let query = queries.get(owner);
    if (!query) { query = createContourPolygonQuery(polygons.get(owner), false); queries.set(owner, query); }
    return query(x, y);
  }
  diagnostics.nearSeamIndexMs = performance.now() - started;
  const seen = new Uint32Array(size);
  const order = new Uint32Array(size), ownerOffsets = new Uint32Array(ownerCount + 1);
  for (let i = 0; i < size; i++) ownerOffsets[owners[i] + 1]++;
  for (let i = 1; i <= ownerCount; i++) ownerOffsets[i] += ownerOffsets[i - 1];
  for (let i = 0; i < size; i++) order[ownerOffsets[owners[i]]++] = i;
  let candidateEdges = new Uint32Array(64), candidateLo = new Float64Array(64), candidateHi = new Float64Array(64);
  let candidateNext = new Int32Array(64), activeCandidates = new Uint32Array(64);
  const groupHead = new Int32Array(ownerCount), groupTail = new Int32Array(ownerCount);
  groupHead.fill(-1);
  const groups = [], cuts = [];
  for (const index of order) {
    let candidateCount = 0;
    groups.length = 0;
    const dx = vx[index], dy = vy[index], length = lengths[index], owner = owners[index], sign = signs[index];
    const minX = Math.min(ax[index], bx[index]) - padding, maxX = Math.max(ax[index], bx[index]) + padding;
    const minY = Math.min(ay[index], by[index]) - padding, maxY = Math.max(ay[index], by[index]) + padding;
    const distanceAt = (other, t) => {
      const x = ax[index] + dx * t - ax[other], y = ay[index] + dy * t - ay[other];
      const u = Math.max(0, Math.min(1, (x * vx[other] + y * vy[other]) / (lengths[other] * lengths[other])));
      return (x - vx[other] * u) ** 2 + (y - vy[other] * u) ** 2;
    };
    for (let x = Math.floor(minX / gridSize); x <= Math.floor(maxX / gridSize); x++) {
      for (let y = Math.floor(minY / gridSize); y <= Math.floor(maxY / gridSize); y++) {
        const bucket = grid.get(cellKey(x, y));
        if (bucket === undefined || buckets[bucket] === owner) continue;
        for (let slot = bucket + 2, end = slot + buckets[bucket + 1]; slot < end; slot++) {
          const otherIndex = buckets[slot];
          if (seen[otherIndex] === index + 1) continue;
          seen[otherIndex] = index + 1;
          const other = otherIndex;
          if ((ax[other] < minX && bx[other] < minX) || (ax[other] > maxX && bx[other] > maxX)
            || (ay[other] < minY && by[other] < minY) || (ay[other] > maxY && by[other] > maxY)) continue;
          if (owner === owners[other] || (dx * vx[other] + dy * vy[other]) * sign * signs[other] >= -0.5 * length * lengths[other]) continue;
          if (owner > owners[other] && pairs.get(owners[other] * ownerCount + owner)?.sides[0].length) continue;
          const t0 = ((ax[other] - ax[index]) * dx + (ay[other] - ay[index]) * dy) / (length * length);
          const t1 = ((bx[other] - ax[index]) * dx + (by[other] - ay[index]) * dy) / (length * length);
          let lo = Math.max(0, Math.min(t0, t1)), hi = Math.min(1, Math.max(t0, t1));
          if (hi - lo <= 1e-12) continue;
          const d0 = ((ax[index] + dx * lo - ax[other]) * vy[other] - (ay[index] + dy * lo - ay[other]) * vx[other]) / lengths[other];
          const d1 = ((ax[index] + dx * hi - ax[other]) * vy[other] - (ay[index] + dy * hi - ay[other]) * vx[other]) / lengths[other];
          if (d0 * d1 > 0 && Math.min(d0 * d0, d1 * d1) > distanceLimit) continue;
          const limit = distanceLimit, leftDistance = distanceAt(other, lo), rightDistance = distanceAt(other, hi);
          if (leftDistance > limit || rightDistance > limit) {
            const middle = d0 === d1 ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, lo - d0 * (hi - lo) / (d1 - d0)));
            let inside = leftDistance < rightDistance ? lo : hi;
            if (distanceAt(other, middle) < distanceAt(other, inside)) inside = middle;
            if (distanceAt(other, inside) > limit) continue;
            if (leftDistance > limit) {
              let outside = lo, hit = inside;
              while (hit - outside > 1e-12) {
                const t = (outside + hit) / 2;
                if (distanceAt(other, t) <= limit) hit = t; else outside = t;
              }
              lo = hit;
            }
            if (rightDistance > limit) {
              let outside = hi, hit = inside;
              while (outside - hit > 1e-12) {
                const t = (outside + hit) / 2;
                if (distanceAt(other, t) <= limit) hit = t; else outside = t;
              }
              hi = hit;
            }
          }
          if (candidateCount === candidateEdges.length) {
            const capacity = candidateCount * 2;
            const nextEdges = new Uint32Array(capacity), nextLo = new Float64Array(capacity), nextHi = new Float64Array(capacity), nextLinks = new Int32Array(capacity);
            nextEdges.set(candidateEdges); nextLo.set(candidateLo); nextHi.set(candidateHi); nextLinks.set(candidateNext);
            candidateEdges = nextEdges; candidateLo = nextLo; candidateHi = nextHi; candidateNext = nextLinks;
            activeCandidates = new Uint32Array(capacity);
          }
          const c = candidateCount++, otherOwner = owners[other];
          candidateEdges[c] = other; candidateLo[c] = lo; candidateHi[c] = hi; candidateNext[c] = -1;
          if (groupHead[otherOwner] < 0) { groupHead[otherOwner] = c; groups.push(otherOwner); }
          else candidateNext[groupTail[otherOwner]] = c;
          groupTail[otherOwner] = c;
        }
      }
    }
    for (const otherOwner of groups) {
      const head = groupHead[otherOwner];
      groupHead[otherOwner] = -1;
      cuts.length = 0;
      for (let c = head; c >= 0; c = candidateNext[c]) cuts.push(candidateLo[c], candidateHi[c]);
      cuts.sort((a, b) => a - b);
      let run = null;
      function emit() {
        if (!run) return;
        const pair = [Math.min(owner, run.owner), Math.max(owner, run.owner)], key = pair[0] * ownerCount + pair[1];
        let entry = pairs.get(key); if (!entry) pairs.set(key, entry = { pair, sides: [[], []] });
        entry.sides[owner === pair[0] ? 0 : 1].push({
          start: [ax[index] + dx * run.lo, ay[index] + dy * run.lo], end: [ax[index] + dx * run.hi, ay[index] + dy * run.hi], pair, a: null, b: null, startSlot: 0, endSlot: 0,
        });
        run = null;
      }
      for (let cut = 1; cut < cuts.length; cut++) {
        const lo = cuts[cut - 1], hi = cuts[cut];
        if (hi - lo <= 1e-12) continue;
        let activeCount = 0;
        const middle = (lo + hi) / 2;
        for (let c = head; c >= 0; c = candidateNext[c]) {
          if (middle >= candidateLo[c] && middle <= candidateHi[c]) activeCandidates[activeCount++] = candidateEdges[c];
        }
        if (!activeCount) { emit(); continue; }
        const count = Math.max(1, Math.ceil((hi - lo) * length / (tolerance / 4)));
        for (let sample = 0; sample < count; sample++) {
          const from = lo + (hi - lo) * sample / count, to = lo + (hi - lo) * (sample + 1) / count;
          const t = (from + to) / 2, px = ax[index] + dx * t, py = ay[index] + dy * t;
          let nearest = -1, nearestEdge = -1, nx = 0, ny = 0, distance = distanceLimit;
          for (let c = 0; c < activeCount; c++) {
            const other = activeCandidates[c];
            const u = Math.max(0, Math.min(1, ((px - ax[other]) * vx[other] + (py - ay[other]) * vy[other]) / (lengths[other] * lengths[other])));
            const qx = ax[other] + vx[other] * u, qy = ay[other] + vy[other] * u;
            const d = (qx - px) ** 2 + (qy - py) ** 2;
            if (d <= distance) { nearest = owners[other]; nearestEdge = other; nx = (px + qx) / 2; ny = (py + qy) / 2; distance = d; }
          }
          if (nearest >= 0) {
            const x = nx, y = ny;
            const accepted = (land ? land(x, y) : distance <= (0.01 + 1e-12) ** 2)
              || contains(owner, x, y) || contains(nearest, x, y);
            if (!accepted) { diagnostics.nearSeamRejectedWater++; nearest = -1; }
          }
          if (run && run.owner !== nearest) emit();
          if (nearest >= 0) {
            if (consumed) {
              consume(index, from, to);
              const project = t => Math.max(0, Math.min(1, ((ax[index] + dx * t - ax[nearestEdge]) * vx[nearestEdge]
                + (ay[index] + dy * t - ay[nearestEdge]) * vy[nearestEdge]) / lengths[nearestEdge] ** 2));
              const a = project(from), b = project(to);
              consume(nearestEdge, Math.min(a, b), Math.max(a, b));
            }
            if (!run) run = { owner: nearest, lo: from, hi: to };
            else run.hi = to;
          }
        }
      }
      emit();
    }
  }
  const searchedAt = performance.now();
  diagnostics.nearSeamSearchMs = searchedAt - started - diagnostics.nearSeamIndexMs;
  let vertexCapacity = 8, endpointCount = 0;
  for (const entry of pairs.values()) endpointCount += (entry.sides[0].length || entry.sides[1].length) * 2;
  while (vertexCapacity < endpointCount * 2) vertexCapacity *= 2;
  const vertexX = new Int32Array(vertexCapacity), vertexY = new Int32Array(vertexCapacity);
  const vertexPair = new Uint32Array(vertexCapacity), degrees = new Uint32Array(vertexCapacity);
  function vertexSlot(pair, x, y) {
    let slot = (Math.imul(x, 0x85ebca6b) ^ Math.imul(y, 0xc2b2ae35) ^ Math.imul(pair, 0x9e3779b9)) >>> 0;
    slot = (slot ^ slot >>> 16) & (vertexCapacity - 1);
    while (vertexPair[slot] && (vertexPair[slot] !== pair || vertexX[slot] !== x || vertexY[slot] !== y)) slot = (slot + 1) & (vertexCapacity - 1);
    vertexPair[slot] = pair; vertexX[slot] = x; vertexY[slot] = y;
    return slot;
  }
  let pairIndex = 0;
  for (const entry of pairs.values()) {
    const selected = entry.sides[0].length ? entry.sides[0] : entry.sides[1];
    pairIndex++;
    entry.selected = selected; entry.joinCells = new Set(); entry.points = new Map();
    for (const edge of selected) {
      edge.a = coordinate(edge.start); edge.b = coordinate(edge.end);
      edge.startSlot = vertexSlot(pairIndex, edge.a[0], edge.a[1]);
      edge.endSlot = vertexSlot(pairIndex, edge.b[0], edge.b[1]);
      degrees[edge.startSlot]++; degrees[edge.endSlot]++;
    }
  }
  for (const entry of pairs.values()) {
    for (const edge of entry.selected) for (let end = 0; end < 2; end++) {
      if (degrees[end ? edge.endSlot : edge.startSlot] !== 1) continue;
      const point = end ? edge.end : edge.start, radius = tolerance + 1 / SCALE;
      for (let x = Math.floor((point[0] - radius) / gridSize); x <= Math.floor((point[0] + radius) / gridSize); x++) {
        for (let y = Math.floor((point[1] - radius) / gridSize); y <= Math.floor((point[1] + radius) / gridSize); y++) entry.joinCells.add(cellKey(x, y));
      }
    }
  }
  for (const edge of shared) {
    const entry = pairs.get(edge.pair[0] * ownerCount + edge.pair[1]);
    if (!entry) continue;
    for (let end = 0; end < 2; end++) {
      const x = edgeCoordinate(edge, !!end, 0), y = edgeCoordinate(edge, !!end, 1);
      if (!entry.joinCells.has(cellKey(Math.floor(x / SCALE / gridSize), Math.floor(y / SCALE / gridSize)))) continue;
      const key = `${x},${y}`;
      if (entry.points.has(key)) entry.points.delete(key);
      else entry.points.set(key, end ? edge.end : edge.start);
    }
  }
  const result = [];
  for (const { selected, points: endpointMap } of pairs.values()) {
    const points = [...endpointMap.values()];
    for (const edge of selected) {
      let insertions = null;
      const origin = edge.start, dx = edge.end[0] - origin[0], dy = edge.end[1] - origin[1];
      for (let side = 0; side < 2; side++) {
        const end = side ? 'end' : 'start';
        if (degrees[side ? edge.endSlot : edge.startSlot] !== 1) continue;
        let distance = tolerance ** 2, nearest = null;
        for (const point of points) {
          const d = (edge[end][0] - point[0]) ** 2 + (edge[end][1] - point[1]) ** 2;
          if (d < distance) { nearest = point; distance = d; }
        }
        if (nearest) {
          const t = ((nearest[0] - origin[0]) * dx + (nearest[1] - origin[1]) * dy) / (dx * dx + dy * dy);
          if (t > 0 && t < 1) {
            if (!insertions) insertions = [{ t, point: nearest }];
            else if (!insertions.some(entry => entry.point === nearest)) insertions.push({ t, point: nearest });
          } else if ((end === 'start' && t <= 0) || (end === 'end' && t >= 1)) {
            edge[end] = nearest; edge[end === 'start' ? 'a' : 'b'] = coordinate(nearest);
          }
        }
      }
      if (!insertions) {
        if (compare(edge.a, edge.b)) result.push(edge);
        continue;
      }
      insertions.sort((a, b) => a.t - b.t);
      const path = [edge.start, ...insertions.map(entry => entry.point), edge.end];
      for (let i = 1; i < path.length; i++) {
        const start = path[i - 1], end = path[i], a = coordinate(start), b = coordinate(end);
        if (compare(a, b)) result.push({ start, end, a, b, pair: edge.pair });
      }
    }
  }
  diagnostics.nearSeamSegments = result.length;
  diagnostics.nearSeamJoinMs = performance.now() - searchedAt;
  diagnostics.nearSeamMs = performance.now() - started;
  if (memory) {
    const after = globalThis.process.memoryUsage();
    diagnostics.nearSeamHeapDeltaBytes = after.heapUsed - memory.heapUsed;
    diagnostics.nearSeamArrayBufferDeltaBytes = after.arrayBuffers - memory.arrayBuffers;
  }
  return result;
}

function politicalCoverageQuery(polygons) {
  const rows = new Map(), queries = new Map();
  for (const [id, packed] of polygons) {
    const { coordinates, ringOffsets, polygonOffsets } = packed;
    for (let p = 0; p < polygonOffsets.length - 1; p++) {
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (let i = ringOffsets[polygonOffsets[p]]; i < ringOffsets[polygonOffsets[p + 1]]; i++) {
        x0 = Math.min(x0, coordinates[i * 2]); x1 = Math.max(x1, coordinates[i * 2]);
        y0 = Math.min(y0, coordinates[i * 2 + 1]); y1 = Math.max(y1, coordinates[i * 2 + 1]);
      }
      const entry = { id, x0, x1, y0, y1 };
      for (let row = Math.floor(y0); row <= Math.floor(y1); row++) {
        let entries = rows.get(row);
        if (!entries) rows.set(row, entries = []);
        entries.push(entry);
      }
    }
  }
  return (x, y) => {
    for (const { id, x0, x1, y0, y1 } of rows.get(Math.floor(y)) || []) {
      const px = x + 360 * Math.round(((x0 + x1) / 2 - x) / 360);
      if (px < x0 || px > x1 || y < y0 || y > y1) continue;
      let query = queries.get(id);
      if (!query) queries.set(id, query = createContourPolygonQuery(polygons.get(id), false));
      if (query(x, y)) return true;
    }
    return false;
  };
}

function geometrySegments(edges, diagnostics, precisions, lineSides, registerLine, onSourceGroup = null) {
  const shared = [], unmatched = [];
  for (const edge of edges.values()) {
    const pair = pairFor(edge.members);
    if (pair) { edge.pair = pair; shared.push(edge); }
    else if (edge.members.length === 1) unmatched.push(edge);
    else if (edge.members.some(member => Math.abs(member) !== Math.abs(edge.members[0]))) diagnostics.ambiguousSegments += 1;
  }
  diagnostics.exactSharedSegments = shared.length;
  const exact = nodeEdges(unmatched, diagnostics, undefined, undefined, lineSides, registerLine);
  for (const edge of exact.shared) shared.push(edge);
  const source = nodeSourceEdges(exact.remaining, diagnostics, precisions, edges, shared, onSourceGroup);
  for (const edge of source.shared) shared.push(edge);
  return { shared, remaining: source.remaining };
}

function quantizedSegments(geometry, diagnostics, precisions) {
  // Cross-LOD joins are allowed ONLY by the actual coarse source's declared
  // coordinate grid. Fine/fine boundaries retain 1e-7 identity, even if close.
  // Compare unresolved edges at that grid, require two unique opposite sides,
  // and render the coarser line. Ambiguous overlaps are never welded.
  let remaining = geometry.remaining;
  const coarseEdges = remaining.filter(edge => precisions.get(Math.abs(edge.members[0]) - 1) === 4);
  if (!coarseEdges.length) return geometry;
  const shared = [...geometry.shared];
  if (coarseEdges.length) {
    const grid = 1000;
    const snap = point => point.map(n => Math.round(n / grid) * grid);
    const candidates = new Map();
    const unquantized = [];
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
      const q = quantize(edge); if (!q) { unquantized.push(edge); continue; }
      const key = `${keyOf(q.a)};${keyOf(q.b)}`;
      const group = candidates.get(key);
      if (group) group.push(q); else candidates.set(key, [q]);
    }
    const leftover = [];
    const validMixed = list => list.some(e => e.coarse) && list.some(e => !e.coarse);
    for (const group of candidates.values()) {
      const pair = validMixed(group) ? pairFor(group.flatMap(e => e.members)) : null;
      if (pair) {
        const edge = group.find(e => e.coarse);
        shared.push({ ...edge, pair }); diagnostics.quantizedSharedSegments += 1;
      } else if (group.length === 1) leftover.push(group[0]);
      else {
        unquantized.push(...group.map(edge => edge.source));
        if (validMixed(group)) diagnostics.ambiguousQuantizedSegments += 1;
      }
    }
    const quantized = nodeEdges(leftover, diagnostics, validMixed, 'quantizedSharedSegments');
    for (const edge of quantized.shared) shared.push(edge);
    remaining = unquantized;
    const untouched = new Set(leftover);
    for (const edge of quantized.remaining) {
      // A leftover edge that no mixed-precision sweep split is still exactly its
      // source edge. Re-interpolating it would round a + (b - a) and could flip
      // its orientation, so a coarse feature anywhere on the map would perturb
      // every unrelated fine coast: a global dependency no neighbourhood covers.
      if (untouched.has(edge)) { remaining.push(edge.source); continue; }
      const original = edge.source, q = quantize(original);
      const axis = Math.abs(q.b[0] - q.a[0]) >= Math.abs(q.b[1] - q.a[1]) ? 0 : 1;
      const forward = q.members[0] === original.members[0];
      const first = forward ? original.start : original.end, last = forward ? original.end : original.start;
      const interpolate = point => {
        const t = (point[axis] - q.a[axis]) / (q.b[axis] - q.a[axis]);
        if (t === 0) return [first[0], first[1]];
        if (t === 1) return [last[0], last[1]];
        return [first[0] + (last[0] - first[0]) * t, first[1] + (last[1] - first[1]) * t];
      };
      const start = interpolate(edge.a), end = interpolate(edge.b);
      remaining.push(copyEdge(original, { start, end, a: coordinate(start), b: coordinate(end), members: q.members }));
    }
  }
  return { shared, remaining };
}

function sharedSegments(geometry, diagnostics, options, polygons) {
  const shared = [...geometry.shared], remaining = geometry.remaining;
  diagnostics.oneSidedSegments = remaining.length;
  const consumed = options.land ? new Map() : null;
  for (const edge of nearSeamSegments(remaining, shared, diagnostics, options.nearSeamTolerance, options.land, polygons, consumed)) shared.push(edge);
  const coast = [];
  const covered = options.land ? politicalCoverageQuery(polygons) : null;
  if (options.land) for (const edge of remaining) {
    const start = edge.start, end = edge.end;
    let dx = end[0] - start[0];
    if (dx > 180) dx -= 360;
    if (dx < -180) dx += 360;
    const dy = end[1] - start[1], length = Math.hypot(dx, dy);
    const sign = Math.sign(edge.members[0]);
    const point = t => t === 0 ? start : t === 1 ? end : [start[0] + dx * t, start[1] + dy * t];
    const emit = (lo, hi) => {
      if (hi <= lo) return;
      const t = (lo + hi) / 2;
      let x = start[0] + dx * t + sign * dy / length * 1e-5;
      x = ((x + 180) % 360 + 360) % 360 - 180;
      if (covered(x, start[1] + dy * t - sign * dx / length * 1e-5)) return;
      const a = point(lo), b = point(hi);
      coast.push({ start: a, end: b, a: coordinate(a), b: coordinate(b), owner: Math.abs(edge.members[0]) - 1 });
    };
    let cursor = 0;
    for (const [lo, hi] of (consumed.get(edge) || []).sort((a, b) => a[0] - b[0])) {
      emit(cursor, lo); cursor = Math.max(cursor, hi);
    }
    emit(cursor, 1);
  }
  return { shared, coast: options.land ? coast : null };
}

function packChains(groups, featureIds, diagnostics, coast) {
  const paths = [];
  let pointCount = 0;
  const orderedGroups = [...groups.values()].sort((a, b) => coast ? a[0].owner - b[0].owner
    : a[0].pair[0] - b[0].pair[0] || a[0].pair[1] - b[0].pair[1]);
  const compareEdges = (a, b) => edgeCoordinate(a, false, 0) - edgeCoordinate(b, false, 0)
    || edgeCoordinate(a, false, 1) - edgeCoordinate(b, false, 1)
    || edgeCoordinate(a, true, 0) - edgeCoordinate(b, true, 0)
    || edgeCoordinate(a, true, 1) - edgeCoordinate(b, true, 1)
    || edgeCoordinate(a, false, 0, true) - edgeCoordinate(b, false, 0, true)
    || edgeCoordinate(a, false, 1, true) - edgeCoordinate(b, false, 1, true)
    || edgeCoordinate(a, true, 0, true) - edgeCoordinate(b, true, 0, true)
    || edgeCoordinate(a, true, 1, true) - edgeCoordinate(b, true, 1, true);
  for (const originalEdges of orderedGroups) {
    // Walked chains live on their group array: a replaced group takes them
    // along, with no WeakMap for the collector to trace.
    const cached = originalEdges.paths;
    if (cached) {
      for (const path of cached) { paths.push(path); pointCount += path.steps.length + 1; }
      continue;
    }
    const pair = originalEdges[0].pair, groupPaths = [];
    let edges = originalEdges;
    for (let i = 1; i < edges.length; i++) if (compareEdges(edges[i - 1], edges[i]) > 0) {
      edges = [...originalEdges].sort(compareEdges); break;
    }
    const nodes = new Map(), used = new Uint8Array(edges.length), ends = new Array(edges.length * 2);
    edges.forEach((edge, index) => {
      for (let end = 0; end < 2; end++) {
        const key = `${edgeCoordinate(edge, !!end, 0)},${edgeCoordinate(edge, !!end, 1)}`;
        let adjacent = nodes.get(key);
        if (!adjacent) nodes.set(key, adjacent = []);
        adjacent.push(index); ends[index * 2 + end] = adjacent;
      }
    });
    function walk(start, firstIndex) {
      const steps = [];
      let vertex = start, index = firstIndex;
      while (!used[index]) {
        used[index] = 1;
        const forward = ends[index * 2] === vertex;
        steps.push((index + 1) * (forward ? 1 : -1));
        vertex = ends[index * 2 + (forward ? 1 : 0)];
        const adjacent = vertex;
        if (adjacent.length !== 2) break;
        const next = adjacent[0] === index ? adjacent[1] : adjacent[0];
        if (used[next]) break;
        index = next;
      }
      if (steps.length) {
        const path = { edges, steps: Int32Array.from(steps), pair };
        paths.push(path); groupPaths.push(path); pointCount += steps.length + 1;
      }
    }
    for (const adjacent of nodes.values()) {
      if (adjacent.length === 2) continue;
      for (const index of adjacent) if (!used[index]) walk(adjacent, index);
    }
    for (let index = 0; index < edges.length; index++) if (!used[index]) walk(ends[index * 2], index);
    originalEdges.paths = groupPaths;
  }
  const coordinates = new Float64Array(pointCount * 2);
  const offsets = new Uint32Array(paths.length + 1);
  const owners = new Uint32Array(coast ? 0 : paths.length * 2);
  let position = 0;
  const writePoint = (edge, second) => {
    coordinates[position * 2] = edgeCoordinate(edge, second, 0, true);
    coordinates[position * 2 + 1] = edgeCoordinate(edge, second, 1, true); position++;
  };
  paths.forEach(({ edges, steps, pair }, index) => {
    offsets[index] = position;
    if (!coast) { owners[index * 2] = pair[0]; owners[index * 2 + 1] = pair[1]; }
    for (let step = 0; step < steps.length; step++) {
      const token = steps[step], edge = edges[Math.abs(token) - 1], forward = token > 0;
      if (!step) writePoint(edge, !forward);
      writePoint(edge, forward);
    }
  });
  offsets[paths.length] = position;
  if (coast) return { coordinates, offsets, arcs: Uint32Array.from(paths, (_, index) => index) };
  return { featureIds: [...featureIds], coordinates, offsets, owners,
    diagnostics: { ...diagnostics, arcCount: paths.length, pointCount, packedBytes: coordinates.byteLength + offsets.byteLength + owners.byteLength } };
}

export function createPaintContourGraphBuilder({ nearSeamTolerance = 0, waterMask = null } = {}) {
  const edges = createCompactEdges(), idToIndex = new Map(), featureIds = [], featureEdges = new Map();
  const invalidRingsById = new Map(), precisions = new Map();
  const polygons = new Map();
  const bounds = new Map(), dirty = new Set(), dirtyBounds = [];
  const boundaryBounds = new Map(), boundaryCells = new Map();
  const dirtyEdges = [], lineSides = new Map();
  const pendingBounds = [];
  // Edge index -> its source-collinear group at the last finish that computed
  // it: the owners (the extent bound used by local finishes) and whether the
  // group was decisive, i.e. left unmatched whatever its extent.
  const sourceOwners = new Map();
  function recordSourceGroup(group, decisive, partial = false) {
    const owners = new Set();
    for (const edge of group) {
      owners.add(Math.abs(edge.members[0]) - 1);
      if (partial) for (const id of sourceOwners.get(edge.key - 1)?.owners || []) if (featureEdges.has(id)) owners.add(id);
    }
    const record = { owners, decisive };
    for (const edge of group) if (edge.key) sourceOwners.set(edge.key - 1, record);
  }
  let cycle = 1, liveEntries = 0, deadEntries = 0;
  const quantizedLines = new Map(), quantizedOwners = new Map();
  let geometryCache = null, segmentCache = null, quantizedInput = null, waterChanged = false;
  let land = createContourWaterQuery(waterMask);
  function registerLine(edge, key) {
    const side = edge.members[0] > 0 ? 0 : 1;
    let sides = lineSides.get(key);
    if (!sides) lineSides.set(key, edge);
    else {
      if (sides instanceof ContourEdgeView) {
        const previous = sides;
        sides = [lineCount(previous, 0), lineCount(previous, 1)];
        sides.indices = new Set([previous.index]); lineSides.set(key, sides);
      }
      sides.indices.add(edge.index); sides[side]++;
    }
    edge.lineKey = key;
  }
  function updateLines() {
    const before = new Map();
    for (const list of dirtyEdges) for (const index of list) {
      if (!edges.mark(index, cycle)) continue;
      const previous = edges.retained(index), edge = edges.view(index);
      if (previous?.lineKey) {
        const key = previous.lineKey, sides = lineSides.get(key);
        if (!before.has(key)) before.set(key, !!(lineCount(sides, 0) && lineCount(sides, 1)));
        if (sides instanceof ContourEdgeView) lineSides.delete(key);
        else {
          sides[previous.members[0] > 0 ? 0 : 1]--;
          sides.indices.delete(edge.index);
          if (!sides[0] && !sides[1]) lineSides.delete(key);
        }
      }
      const members = edge.members;
      if (members.length !== 1 || !members[0]) continue;
      const key = exactLineKey(edge);
      if (key === null) continue;
      const sides = lineSides.get(key);
      if (!before.has(key)) before.set(key, !!(lineCount(sides, 0) && lineCount(sides, 1)));
      registerLine(edge, key);
    }
    const changed = new Set();
    for (const [key, active] of before) {
      const sides = lineSides.get(key);
      if (active === !!(lineCount(sides, 0) && lineCount(sides, 1))) continue;
      if (sides instanceof ContourEdgeView) changed.add(Math.abs(sides.members[0]) - 1);
      else for (const index of sides?.indices || []) changed.add(Math.abs(edges.members(index)[0]) - 1);
    }
    return changed;
  }
  // featureIds never shrinks and bounds every later feature count, so once the
  // dirty set exceeds the ratio of it, this finish is certainly a full build.
  // Dropping the incremental state then keeps a bulk patch as cheap as a
  // first build; the full finish rebuilds every cache from scratch.
  function dropIncrementalState() {
    geometryCache = null; segmentCache = null; quantizedInput = null;
    bounds.clear(); boundaryBounds.clear(); boundaryCells.clear(); liveEntries = 0; deadEntries = 0;
    dirty.clear(); dirtyEdges.length = 0; dirtyBounds.length = 0; pendingBounds.length = 0; cycle++;
    lineSides.clear(); quantizedLines.clear(); quantizedOwners.clear(); sourceOwners.clear();
    edges.dropViews();
  }
  function markDirty(id) {
    if (!geometryCache) return;
    dirty.add(id);
    if (dirty.size > featureIds.length * INCREMENTAL_FEATURE_RATIO) { dropIncrementalState(); return; }
    for (const box of bounds.get(id) || []) dirtyBounds.push(box);
  }
  function visitCells(box, padding, visit) {
    const x0 = Math.floor((box[0] - padding) / 4), x1 = Math.min(x0 + 89, Math.floor((box[2] + padding) / 4));
    for (let x = x0; x <= x1; x++) for (let y = Math.floor((box[1] - padding) / 4); y <= Math.floor((box[3] + padding) / 4); y++) {
      visit(((x % 90 + 90) % 90) * 64 + y + 24);
    }
  }
  function indexEntry(entry) {
    liveEntries++;
    visitCells(entry.box, 0, key => {
      let bucket = boundaryCells.get(key);
      if (!bucket) boundaryCells.set(key, bucket = []);
      bucket.push(entry);
    });
  }
  function compactBoundaryCells() {
    if (deadEntries <= liveEntries) return;
    boundaryCells.clear(); liveEntries = 0; deadEntries = 0;
    for (const entries of boundaryBounds.values()) for (const entry of entries) indexEntry(entry);
  }
  function indexBounds(id, packed) {
    const areas = [], entries = [], c = packed.coordinates, rings = packed.ringOffsets, polys = packed.polygonOffsets;
    for (let p = 0; p < polys.length - 1; p++) {
      const area = [Infinity, Infinity, -Infinity, -Infinity];
      for (let r = polys[p]; r < polys[p + 1]; r++) {
        for (let begin = rings[r]; begin < rings[r + 1] - 1; begin += 64) {
          const box = [Infinity, Infinity, -Infinity, -Infinity];
          for (let i = begin, end = Math.min(begin + 65, rings[r + 1]); i < end; i++) {
            box[0] = Math.min(box[0], c[i * 2]); box[2] = Math.max(box[2], c[i * 2]);
            box[1] = Math.min(box[1], c[i * 2 + 1]); box[3] = Math.max(box[3], c[i * 2 + 1]);
          }
          area[0] = Math.min(area[0], box[0]); area[2] = Math.max(area[2], box[2]);
          area[1] = Math.min(area[1], box[1]); area[3] = Math.max(area[3], box[3]);
          const entry = { id, box }; entries.push(entry);
          indexEntry(entry);
        }
      }
      areas.push(area);
    }
    bounds.set(id, areas); boundaryBounds.set(id, entries);
    if (geometryCache) for (const box of areas) dirtyBounds.push(box);
  }
  function neighbors(boxes) {
    const result = new Set(), padding = Math.max(nearSeamTolerance, 1e-4) + 1e-7;
    for (const a of boxes) visitCells(a, padding, key => {
      for (const { id, box: b, dead } of boundaryCells.get(key) || []) {
        if (dead || result.has(id)) continue;
        const shift = 360 * Math.round(((a[0] + a[2]) - (b[0] + b[2])) / 720);
        if (a[1] - padding <= b[3] && a[3] + padding >= b[1]
          && a[0] - padding <= b[2] + shift && a[2] + padding >= b[0] + shift) result.add(id);
      }
    });
    return result;
  }
  function indexSegments(segments, key) {
    const groups = new Map();
    for (const edge of segments) {
      const id = key(edge);
      let group = groups.get(id);
      if (!group) groups.set(id, group = []);
      group.push(edge);
    }
    return groups;
  }
  const pairKey = edge => edge.pair.join(':');
  const ownerKey = edge => Math.abs(edge.members[0]) - 1;
  function quantizedRecords(remaining, fineOnly = false) {
    const records = new Map();
    for (const edge of remaining) {
      const line = quantizedLine(edge);
      if (!line) continue;
      const id = ownerKey(edge);
      let record = records.get(id);
      if (!record) records.set(id, record = { coarse: !fineOnly && precisions.get(id) === 4, lines: new Map() });
      let segments = record.lines.get(line.key);
      if (!segments) record.lines.set(line.key, segments = []);
      segments.push(line.segment);
    }
    for (const record of records.values()) for (const segments of record.lines.values()) segments.sort();
    return records;
  }
  function replaceQuantizedOwner(id, record) {
    const previous = quantizedOwners.get(id);
    if (previous) for (const [key, segments] of previous.lines) {
      const line = quantizedLines.get(key);
      line[previous.coarse ? 'coarse' : 'fine'] -= segments.length;
      line.owners.delete(id);
      if (!line.owners.size) quantizedLines.delete(key);
    }
    quantizedOwners.delete(id);
    if (record) {
      quantizedOwners.set(id, record);
      for (const [key, segments] of record.lines) {
        let line = quantizedLines.get(key);
        if (!line) quantizedLines.set(key, line = { coarse: 0, fine: 0, owners: new Set() });
        line[record.coarse ? 'coarse' : 'fine'] += segments.length;
        line.owners.add(id);
      }
    }
  }
  function quantizedChanges(records, affected) {
    const changes = new Map(), owners = new Set();
    for (const id of affected) {
      const previous = quantizedOwners.get(id), next = records.get(id);
      for (const key of new Set([...(previous?.lines.keys() || []), ...(next?.lines.keys() || [])])) {
        const a = previous?.lines.get(key), b = next?.lines.get(key);
        if (previous?.coarse === next?.coarse && a?.length === b?.length && a?.every((value, i) => value === b[i])) continue;
        if (!changes.has(key)) {
          const line = quantizedLines.get(key);
          changes.set(key, { coarse: line?.coarse || 0, fine: line?.fine || 0 });
          if (line?.coarse && line.fine) for (const owner of line.owners) owners.add(owner);
        }
        const counts = changes.get(key);
        if (a) counts[previous.coarse ? 'coarse' : 'fine'] -= a.length;
        if (b) counts[next.coarse ? 'coarse' : 'fine'] += b.length;
      }
    }
    for (const [key, counts] of changes) if (counts.coarse && counts.fine) {
      for (const owner of quantizedLines.get(key)?.owners || []) owners.add(owner);
    }
    return owners;
  }
  function cacheGeometry(geometry) {
    return { shared: indexSegments(geometry.shared, pairKey), remaining: indexSegments(geometry.remaining, ownerKey) };
  }
  function cacheSegments(segments) {
    const shared = indexSegments(segments.shared, pairKey);
    for (const [key, group] of shared) {
      const previous = segmentCache?.shared.get(key);
      if (previous?.length === group.length && group.every((edge, i) => edge === previous[i])) shared.set(key, previous);
    }
    return { shared, coast: segments.coast && indexSegments(segments.coast, edge => edge.owner) };
  }
  function mergeGroups(previous, next, affected, paired) {
    for (const [key, group] of previous) {
      if (paired ? group[0].pair.some(id => affected.has(id)) : affected.has(key)) previous.delete(key);
    }
    for (const [key, group] of next) {
      if (paired ? group[0].pair.some(id => affected.has(id)) : affected.has(key)) previous.set(key, group);
    }
  }
  function remove(featureId) {
    const id = idToIndex.get(String(featureId));
    if (id === undefined) return;
    markDirty(id);
    // Only the edge lists are recorded here; finish() dedupes them and reads
    // each retained view, which modifications mark stale but keep.
    const owned = featureEdges.get(id);
    if (geometryCache && owned) dirtyEdges.push(owned);
    for (const edge of owned || []) edges.removeMember(edge, id + 1);
    featureEdges.delete(id); invalidRingsById.delete(id); precisions.delete(id);
    polygons.delete(id);
    bounds.delete(id);
    // Tombstone the cell entries; neighbors() skips them and they are dropped
    // with the whole index when the state is reset or rebuilt.
    for (const entry of boundaryBounds.get(id) || []) { entry.dead = true; liveEntries--; deadEntries++; }
    boundaryBounds.delete(id);
  }
  function add({ id: rawId, geometry, coordinatePrecision = 7 }) {
    const featureId = String(rawId || '').trim();
    if (!featureId) return;
    remove(featureId);
    let id = idToIndex.get(featureId);
    if (id === undefined) { id = featureIds.length; featureIds.push(featureId); idToIndex.set(featureId, id); }
    markDirty(id);
    precisions.set(id, coordinatePrecision === 4 ? 4 : 7);
    const touched = [];
    const containmentPolygons = [];
    let invalidRings = 0;
    function polygon(rings) {
      if (!Array.isArray(rings)) return;
      const validRings = [];
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
        validRings.push(ring);
        for (let i = 0; i < snapped.length - 1; i += 1) {
          const order = compare(snapped[i], snapped[i + 1]);
          if (!order) continue;
          const forward = order < 0;
          const a = snapped[forward ? i : i + 1], b = snapped[forward ? i + 1 : i];
          const edge = edges.getOrAdd(a, b, ring[forward ? i : i + 1], ring[forward ? i + 1 : i]);
          const member = (id + 1) * side * (forward ? 1 : -1);
          if (edges.addMember(edge, member, ring[forward ? i : i + 1], ring[forward ? i + 1 : i])) touched.push(edge);
        }
      });
      if (validRings.length) containmentPolygons.push(validRings);
    }
    function visit(value) {
      if (value?.type === 'Polygon') polygon(value.coordinates);
      else if (value?.type === 'MultiPolygon') (value.coordinates || []).forEach(polygon);
      else if (value?.type === 'GeometryCollection') (value.geometries || []).forEach(visit);
    }
    visit(geometry);
    const packed = packContourPolygons({ type: 'MultiPolygon', coordinates: containmentPolygons });
    polygons.set(id, packed);
    // Indexed when an incremental finish needs it; a bulk patch never does.
    if (geometryCache) pendingBounds.push(id);
    const owned = Uint32Array.from(touched);
    featureEdges.set(id, owned);
    if (geometryCache) dirtyEdges.push(owned);
    invalidRingsById.set(id, invalidRings);
  }
  return Object.freeze({
    setWaterMask(mask) { waterMask = mask; land = createContourWaterQuery(mask); waterChanged = true; },
    patch(features = [], removedIds = []) {
      // Decide a bulk patch up front, so none of it pays for incremental
      // bookkeeping that the following full finish would discard.
      if (geometryCache) {
        const ids = new Set();
        let added = 0;
        for (const raw of removedIds) { const id = idToIndex.get(String(raw)); if (id !== undefined && !dirty.has(id)) ids.add(id); }
        for (const feature of features) {
          const key = String(feature?.id || '').trim();
          if (!key) continue;
          const id = idToIndex.get(key);
          if (id === undefined) { if (!ids.has(key)) { ids.add(key); added++; } }
          else if (!dirty.has(id)) ids.add(id);
        }
        if (dirty.size + ids.size > (featureIds.length + added) * INCREMENTAL_FEATURE_RATIO) dropIncrementalState();
      }
      removedIds.forEach(remove); features.forEach(add);
    },
    finish() {
      const diagnostics = { featureCount: featureEdges.size, segmentCount: edges.size, invalidRings: [...invalidRingsById.values()].reduce((sum, count) => sum + count, 0),
        ambiguousSegments: 0, exactSharedSegments: 0, nodedSharedSegments: 0, sourceNodedSharedSegments: 0,
        sourceLineComparisons: 0, sourceLineMaxBucket: 0, sourceLineSkippedBuckets: 0, sourceLineSkippedGroups: 0,
        quantizedSharedSegments: 0, ambiguousQuantizedSegments: 0, oneSidedSegments: 0,
        nearSeamSegments: 0, nearSeamRejectedWater: 0, nearSeamMaskMissing: !waterMask, nearSeamMs: 0,
        incremental: false, incrementalFeatureCount: 0 };
      edges.beginRead();
      let segments, neighborMs = 0;
      const options = { nearSeamTolerance, land };
      try {
        let fullFallback = !(geometryCache && dirty.size && dirty.size <= featureEdges.size * INCREMENTAL_FEATURE_RATIO && !waterChanged);
        if (!fullFallback) local: {
          for (const id of pendingBounds) if (polygons.has(id) && !bounds.has(id)) indexBounds(id, polygons.get(id));
          const lineChanges = updateLines();
          let neighborStart = performance.now();
          const affected = neighbors([...dirtyBounds, ...[...lineChanges].flatMap(id => bounds.get(id))]);
          for (const id of dirty) affected.add(id);
          neighborMs += performance.now() - neighborStart;
          const quantization = quantizedOwners.size || [...precisions.values()].includes(4);
          if (quantization && !quantizedOwners.size) {
            quantizedInput ||= { shared: new Map(geometryCache.shared), remaining: new Map(geometryCache.remaining) };
            // No coarse source existed at the last finish, so no quantized line
            // was mixed. Edges this patch modified are recomputed below; their
            // stale views would read slots the patch may already have reused.
            const before = [];
            for (const group of quantizedInput.remaining.values()) for (const edge of group) if (!edge.stale) before.push(edge);
            for (const [id, record] of quantizedRecords(before, true)) replaceQuantizedOwner(id, record);
          }
          // A source-collinear group joins edges through shared vertices and is
          // accepted or skipped as a whole, so it can reach past any fixed
          // neighbourhood. Every owner of a group that touches an affected owner
          // becomes affected too (with its neighbours as context) until the
          // groups close; one that grows too far falls back to a full build.
          // A source-collinear group joins edges through shared vertices and is
          // accepted or skipped as a whole, so it can reach past any fixed
          // neighbourhood. The owners each edge's group had at its last finish
          // bound the group's current extent: edges nobody changed connect as
          // before, and every new connection runs through an affected edge.
          // Those owners (and their neighbours, for blockers) join the context
          // in one step; only affected owners' results are merged, so the
          // closure does not cascade. A closure that grows too far falls back.
          // base: owners whose source-stage input may have changed. A group that
          // touches one may change its decision, so all its owners are merged
          // (unless it was and still is decisive). A group that touches only
          // later-merged owners is unchanged and need only be complete. Each
          // group's remembered owners bound its current extent; they and their
          // neighbours join the context, so blockers are present too.
          const counters = { ...diagnostics }, base = new Set(affected), complete = new Set(affected);
          const remembered = edge => sourceOwners.get(edge.key - 1);
          const owned = id => featureEdges.has(id);
          for (const id of base) for (const index of featureEdges.get(id) || []) {
            const record = sourceOwners.get(index);
            if (record && !record.decisive) for (const owner of record.owners) if (owned(owner)) { affected.add(owner); complete.add(owner); }
          }
          let context, geometry = null, expanded = false, touching = null;
          for (;;) {
            neighborStart = performance.now();
            context = neighbors([...complete].flatMap(id => (boundaryBounds.get(id) || []).map(entry => entry.box)));
            for (const id of complete) context.add(id);
            neighborMs += performance.now() - neighborStart;
            if (expanded && context.size > Math.max(featureEdges.size * INCREMENTAL_CONTEXT_RATIO, INCREMENTAL_CONTEXT_MINIMUM)) break;
            const lists = [];
            for (const id of context) { const list = featureEdges.get(id); if (list) lists.push(list); }
            // List order, as a full finish would visit them; near-seam ties and
            // join toggles are resolved by visiting order.
            const subset = edges.inListOrder(lists, cycle);
            diagnostics.incrementalSubsetFeatureCount = context.size;
            diagnostics.incrementalSubsetEdgeCount = subset.length;
            let grown = false;
            touching = [];
            geometry = geometrySegments(subset, diagnostics, precisions, lineSides, null, (group, decisive) => {
              const ownerOf = edge => Math.abs(edge.members[0]) - 1;
              if (!group.some(edge => affected.has(ownerOf(edge)))) return;
              const changes = group.some(edge => base.has(ownerOf(edge)));
              // A decisive group may be only partly in this context; its record
              // then keeps the owners it had.
              touching.push([group, decisive, !decisive]);
              const add = id => {
                if (!owned(id)) return;
                if (!complete.has(id)) { complete.add(id); grown = true; }
                if (changes && !affected.has(id)) { affected.add(id); grown = true; }
              };
              // A remembered group that was matched (within budget) had at most
              // 91 edges: all its owners join at once, and when it may change
              // they are merged, since its decision may now differ for them.
              for (const edge of group) {
                const record = remembered(edge);
                if (record && !record.decisive && (changes || !decisive)) for (const id of record.owners) add(id);
              }
              // Any larger group containing a decisive one is decisive too, so
              // it needs no more context. Otherwise its own owners become
              // complete, which brings every edge at its vertices in next time;
              // once all of them are complete the group is closed.
              if (!decisive) for (const edge of group) add(ownerOf(edge));
            });
            if (!grown) break;
            expanded = true;
            Object.assign(diagnostics, counters); geometry = null;
          }
          if (!geometry) { Object.assign(diagnostics, counters, { incrementalFallback: true }); fullFallback = true; break local; }
          for (const id of affected) for (const index of featureEdges.get(id) || []) sourceOwners.delete(index);
          for (const [group, decisive, complete] of touching) recordSourceGroup(group, decisive, !complete);
          if (quantization) {
            // Owners whose quantized lines change mixed status are added after
            // the merge and read from quantizedInput. Their source intervals are
            // current: an owner's source result changes only next to an edit, on
            // a changed exact line, or in a changed source group, and all those
            // owners are already affected (merged) above.
            const records = quantizedRecords(geometry.remaining), changed = quantizedChanges(records, affected);
            for (const id of affected) replaceQuantizedOwner(id, records.get(id));
            const source = cacheGeometry(geometry);
            mergeGroups(quantizedInput.shared, source.shared, affected, true);
            mergeGroups(quantizedInput.remaining, source.remaining, affected, false);
            for (const id of neighbors([...changed].flatMap(id => (boundaryBounds.get(id) || []).map(entry => entry.box)))) affected.add(id);
            for (const id of changed) affected.add(id);
            context = neighbors([...affected].flatMap(id => (boundaryBounds.get(id) || []).map(entry => entry.box)));
            for (const id of affected) context.add(id);
            neighborStart = performance.now();
            for (const id of [...context]) for (const key of quantizedOwners.get(id)?.lines.keys() || []) {
              const line = quantizedLines.get(key);
              if (line.coarse && line.fine) for (const owner of line.owners) context.add(owner);
            }
            neighborMs += performance.now() - neighborStart;
            geometry = { shared: [...quantizedInput.shared.values()].filter(group => group[0].pair.some(id => context.has(id))).flat(),
              remaining: [...context].flatMap(id => quantizedInput.remaining.get(id) || []) };
          }
          geometry = quantizedSegments(geometry, diagnostics, precisions);
          const local = cacheSegments(sharedSegments(geometry, diagnostics, options, polygons));
          const cached = cacheGeometry(geometry);
          mergeGroups(geometryCache.shared, cached.shared, affected, true);
          mergeGroups(geometryCache.remaining, cached.remaining, affected, false);
          mergeGroups(segmentCache.shared, local.shared, affected, true);
          if (local.coast) mergeGroups(segmentCache.coast, local.coast, affected, false);
          diagnostics.incremental = true; diagnostics.incrementalFeatureCount = dirty.size;
        }
        if (!fullFallback) {
          // The local finish above has merged its results into the caches.
        } else if (geometryCache && !dirty.size && !waterChanged) {
          diagnostics.incremental = true;
          diagnostics.incrementalSubsetFeatureCount = 0; diagnostics.incrementalSubsetEdgeCount = 0;
        } else {
          let geometry;
          if (geometryCache && !dirty.size && waterChanged) {
            geometry = { shared: [...geometryCache.shared.values()].flat(), remaining: [...geometryCache.remaining.values()].flat() };
            diagnostics.incremental = true;
            diagnostics.incrementalSubsetFeatureCount = 0; diagnostics.incrementalSubsetEdgeCount = 0;
          } else {
            for (const [id, packed] of polygons) if (!bounds.has(id)) indexBounds(id, packed);
            // A full rebuild re-registers every live edge. Views of slots freed
            // since the last finish would keep a lineKey no index holds any more,
            // and a later reuse of the slot would unregister it a second time.
            edges.dropViews(); lineSides.clear();
            sourceOwners.clear();
            geometry = geometrySegments(edges, diagnostics, precisions, null, registerLine, recordSourceGroup);
            quantizedInput = null;
            quantizedLines.clear(); quantizedOwners.clear();
            if ([...precisions.values()].includes(4)) {
              quantizedInput = cacheGeometry(geometry);
              for (const [id, record] of quantizedRecords(geometry.remaining)) replaceQuantizedOwner(id, record);
            }
            geometry = quantizedSegments(geometry, diagnostics, precisions);
            geometryCache = cacheGeometry(geometry);
          }
          segments = sharedSegments(geometry, diagnostics, options, polygons);
          segmentCache = cacheSegments(segments);
        }
      }
      finally { edges.endRead(); }
      const graph = packChains(segmentCache.shared, featureIds, diagnostics, false);
      const coastStart = performance.now();
      graph.coast = segmentCache.coast ? packChains(segmentCache.coast, featureIds, diagnostics, true) : null;
      if (diagnostics.incremental) Object.defineProperties(graph.diagnostics, {
        incrementalNeighborMs: { value: neighborMs },
        incrementalCoastPackMs: { value: performance.now() - coastStart },
      });
      dirty.clear(); dirtyEdges.length = 0; dirtyBounds.length = 0; pendingBounds.length = 0; waterChanged = false; cycle++;
      if (geometryCache) compactBoundaryCells();
      return graph;
    },
    getStorageStats() { return { ...edges.stats(), segmentCount: edges.size,
      featureEdgeIndexBytes: [...featureEdges.values()].reduce((sum, indices) => sum + indices.byteLength, 0) }; },
  });
}

export function buildPaintContourGraph(features = [], options) {
  const builder = createPaintContourGraphBuilder(options);
  builder.patch(features);
  return builder.finish();
}
