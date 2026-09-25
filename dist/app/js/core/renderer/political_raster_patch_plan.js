// Numeric bounds belong to the same immutable entry/view generation as the
// accepted bitmap. Weak keys do not keep retired frames or geometry alive.
const indexes = new WeakMap();
const intersects = (a, b) => a.maxX >= b.minX && a.minX <= b.maxX
  && a.maxY >= b.minY && a.minY <= b.maxY;

function buildIndex(entries, boundsForEntry, width, height, byteLimit) {
  const bounds = [], buckets = new Map(), spanning = [];
  // Bounded screen grid avoids a sorted tree's expensive cold construction.
  const cell = 64, columns = Math.ceil(width / cell) + 1, rows = Math.ceil(height / cell) + 1;
  const range = b => ({ x0: Math.max(0, Math.floor(b.minX / cell)),
    x1: Math.min(columns - 1, Math.floor(b.maxX / cell)),
    y0: Math.max(0, Math.floor(b.minY / cell)), y1: Math.min(rows - 1, Math.floor(b.maxY / cell)) });
  let references = 0;
  for (let i = 0; i < entries.length; i++) {
    const b = boundsForEntry(entries[i]);
    if (!b || ![b.minX, b.minY, b.maxX, b.maxY].every(Number.isFinite)
      || b.maxX < b.minX || b.maxY < b.minY) return null;
    // Copy borrowed bounds. The index owns numbers, never features or snapshots.
    bounds.push({ minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY });
    const r = range(b), cells = (r.x1-r.x0+1)*(r.y1-r.y0+1);
    if (r.x1 < r.x0 || r.y1 < r.y0) continue;
    if (cells > 16) { spanning.push(i); references++; continue; }
    for (let y=r.y0; y<=r.y1; y++) for (let x=r.x0; x<=r.x1; x++) {
      const key = y*columns+x;
      let list = buckets.get(key);
      if (!list) { list = []; buckets.set(key,list); }
      list.push(i); references++;
      if (entries.length*128 + references*16 + buckets.size*128 > byteLimit) return null;
    }
  }
  return { bounds, buckets, spanning, range, columns,
    estimatedBytes: entries.length*128 + references*16 + buckets.size*128 };
}

// Bounds are conservative projected bounds supplied by the existing renderer.
// The full structural identity scan remains deliberate: no guessed delta can
// bypass geometry, painter-order, line-width or accepted-frame validation.
export function planPoliticalRasterPatch(previous, entries, description, boundsForEntry, {
  maxCoverage = 0.18,
  maxTransientBytes = 64 * 1024 * 1024,
} = {}) {
  if (!previous || !Array.isArray(entries) || typeof boundsForEntry !== 'function'
    || !description.patchKey || previous.patchKey !== description.patchKey
    || previous.entries.length !== entries.length) return null;
  const { width, height } = description;
  if (![width, height].every(v => Number.isInteger(v) && v > 0)) return null;
  const changed = [];
  for (let i = 0; i < entries.length; i++) {
    const old = previous.entries[i], next = entries[i];
    if (old.id !== next.id || old.feature.geometry !== next.feature.geometry || old.geometryIdentity !== next.geometryIdentity
      || old.lineWidth !== next.lineWidth) return null;
    if (old.fillColor !== next.fillColor || old.strokeColor !== next.strokeColor) changed.push(i);
  }
  if (!changed.length) return null;
  // Budget the retained numeric bounds/tree conservatively as well as surfaces.
  const minimumIndexBytes = entries.length * 128;
  if ((3 * width * height) * 4 + minimumIndexBytes > maxTransientBytes) return null;
  let index = indexes.get(previous.entries);
  const reused = !!index && index.patchKey === description.patchKey && index.getter === boundsForEntry
    && index.width === width && index.height === height;
  if (!reused) {
    const built = buildIndex(entries, boundsForEntry, width, height, maxTransientBytes - 12*width*height);
    if (!built) return null;
    index = { ...built, patchKey: description.patchKey, getter: boundsForEntry, width, height };
  }
  let minX = width, minY = height, maxX = 0, maxY = 0;
  for (const i of changed) {
    const b = index.bounds[i];
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
  }
  const x = Math.max(0, Math.floor(minX)), y = Math.max(0, Math.floor(minY));
  const right = Math.min(width, Math.ceil(maxX)), bottom = Math.min(height, Math.ceil(maxY));
  const region = { x, y, width: right - x, height: bottom - y };
  if (region.width <= 0 || region.height <= 0) return null;
  const area = region.width * region.height;
  const estimatedTransientBytes = (3 * width * height + area) * 4 + index.estimatedBytes;
  if (area / (width * height) > maxCoverage || estimatedTransientBytes > maxTransientBytes) return null;
  const query = { minX: x, minY: y, maxX: right, maxY: bottom }, matched = [];
  const r = index.range(query), candidates = new Set(index.spanning);
  for (let y=r.y0; y<=r.y1; y++) for (let x=r.x0; x<=r.x1; x++) {
    for (const i of index.buckets.get(y*index.columns+x) || []) candidates.add(i);
  }
  for (const i of candidates) if (intersects(index.bounds[i], query)) matched.push(i);
  const visitedBounds = candidates.size;
  matched.sort((a, b) => a - b); // Restore exact painter order, not tree order.
  if (!matched.length || matched.length >= entries.length) return null;
  indexes.set(entries, index);
  return { region, drawEntryIds: matched.map(i => entries[i].id), changedCount: changed.length,
    coverage: area / (width * height), estimatedTransientBytes,
    boundsIndex: { reused, computedBounds: reused ? 0 : entries.length, visitedBounds, estimatedBytes: index.estimatedBytes } };
}
