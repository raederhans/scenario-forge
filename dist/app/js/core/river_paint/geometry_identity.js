// Coordinate identity only. Rendering continues to use unsnapped source points.
const geometryKeys = new WeakMap();
const compare = (a, b) => {
  if (!Array.isArray(a)) return a - b;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const result = compare(a[i], b[i]);
    if (result) return result;
  }
  return a.length - b.length;
};

function canonicalRing(ring) {
  let points = ring.map(p => [Math.round(p[0] * 1e7), Math.round(p[1] * 1e7)]);
  while (points.length > 1 && compare(points[0], points.at(-1)) === 0) points.pop();
  points = points.filter((p, i) => !i || compare(p, points[i - 1]) !== 0);
  if (!points.length) throw new TypeError('Empty river partition ring');
  const minimum = points.reduce((a, b) => compare(a, b) < 0 ? a : b);
  let best = null;
  for (const sequence of [points, [...points].reverse()]) {
    sequence.forEach((p, i) => {
      if (compare(p, minimum)) return;
      const rotated = [...sequence.slice(i), ...sequence.slice(0, i)];
      if (!best || compare(rotated, best) < 0) best = rotated;
    });
  }
  return best;
}

export function canonicalRiverGeometry(geometry) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) throw new TypeError('Expected polygon geometry');
  if (geometryKeys.has(geometry)) return geometryKeys.get(geometry);
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  const normalized = polygons.map(polygon => [canonicalRing(polygon[0]), ...polygon.slice(1).map(canonicalRing).sort(compare)]).sort(compare);
  const key = JSON.stringify(normalized);
  // Published source geometries and normalized packs are immutable by contract.
  geometryKeys.set(geometry, key);
  return key;
}

export function sameRiverParentGeometry(a, b) {
  if (a === b) return true;
  try { return canonicalRiverGeometry(a) === canonicalRiverGeometry(b); }
  catch { return false; }
}

export async function riverGeometryFingerprint(geometry) {
  const bytes = new TextEncoder().encode(canonicalRiverGeometry(geometry));
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)].map(n => n.toString(16).padStart(2, '0')).join('')}`;
}
