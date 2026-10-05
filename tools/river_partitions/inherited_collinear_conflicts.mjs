// Diagnostic proof over original composed edges. This neither repairs the
// graph nor substitutes aggregate neighbor lengths for local owner evidence.
const SCALE = 1e7;
const snap = point => {
  const x = Math.round(point[0] * SCALE);
  return [((x + 180 * SCALE) % (360 * SCALE) + 360 * SCALE) % (360 * SCALE) - 180 * SCALE,
    Math.round(point[1] * SCALE)];
};
const compare = (a, b) => a[0] - b[0] || a[1] - b[1];
const identity = (a, b) => `${a};${b}`;
const gcd = (a, b) => { a = Math.abs(a); b = Math.abs(b); while (b) [a, b] = [b, a % b]; return a; };
function lineKey(a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  if (Math.abs(dx) > 180 * SCALE) return null;
  const divisor = gcd(dx, dy);
  if (!divisor) return null;
  const ux = dx / divisor, uy = dy / divisor;
  return `${ux},${uy},${BigInt(ux) * BigInt(a[1]) - BigInt(uy) * BigInt(a[0])}`;
}
function parseSegment(value) {
  const points = String(value).split(';').map(point => point.split(',').map(Number));
  if (points.length !== 2 || points.some(point => point.length !== 2
    || point.some(coordinate => !Number.isSafeInteger(coordinate)))) return null;
  if (compare(points[0], points[1]) >= 0) return null;
  const key = lineKey(...points);
  return key ? { a: points[0], b: points[1], key, axis: points[0][0] !== points[1][0] ? 0 : 1 } : null;
}
function ringSide(ring, hole) {
  let area = 0;
  for (let i = 1; i < ring.length; i++) {
    let dx = ring[i][0] - ring[i - 1][0];
    if (dx > 180) dx -= 360;
    if (dx < -180) dx += 360;
    area -= dx * (ring[i][1] + ring[i - 1][1]);
  }
  return (area < 0 ? -1 : 1) * (hole ? -1 : 1);
}
function rawEdgeIndex(features, pack, relevantLines) {
  const parents = new Map(pack.parents.flatMap(parent => parent.cells.map(cell => [cell.id, parent.parentId])));
  const lines = new Map();
  for (const feature of features) {
    const featureId = String(feature.properties?.id || feature.id || '').trim();
    const geometry = feature.geometry;
    const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
    for (const [polygonIndex, polygon] of polygons.entries()) {
      for (const [ringIndex, ring] of polygon.entries()) {
        const side = ringSide(ring, ringIndex > 0);
        for (let i = 1; i < ring.length; i++) {
          let a = snap(ring[i - 1]), b = snap(ring[i]);
          const order = compare(a, b);
          if (!order) continue;
          if (order > 0) [a, b] = [b, a];
          const key = lineKey(a, b);
          if (!key || !relevantLines.has(key)) continue;
          if (!lines.has(key)) lines.set(key, []);
          lines.get(key).push({ a, b, featureId, parentId: parents.get(featureId) || featureId,
            side: side * (order < 0 ? 1 : -1), identitySegment: identity(a, b),
            sourceStart: ring[i - 1], sourceEnd: ring[i], polygonIndex, ringIndex, edgeIndex: i - 1 });
        }
      }
    }
  }
  return lines;
}
function owners(edges) {
  const unique = new Map(edges.map(edge => [JSON.stringify([edge.parentId, edge.side]),
    { parentId: edge.parentId, side: edge.side }]));
  return [...unique.values()].sort((a, b) => a.parentId < b.parentId ? -1
    : a.parentId > b.parentId ? 1 : a.side - b.side);
}
const evidence = edges => edges.map(({ a, b, ...edge }) => edge);

export function createInheritedCollinearConflictClassifier({ baselineFeatures, candidateFeatures,
  baseline, candidate, identitySegments }) {
  const segments = identitySegments.map(parseSegment).filter(Boolean);
  const relevantLines = new Set(segments.map(segment => segment.key));
  const before = rawEdgeIndex(baselineFeatures, baseline, relevantLines);
  const after = rawEdgeIndex(candidateFeatures, candidate, relevantLines);
  return row => {
    const segment = parseSegment(row.identitySegment);
    if (!segment) return null;
    const { a, b, key, axis } = segment;
    const intersecting = edge => edge.a[axis] < b[axis] && edge.b[axis] > a[axis];
    const baselineEdges = (before.get(key) || []).filter(intersecting);
    const candidateEdges = (after.get(key) || []).filter(intersecting);
    const cuts = new Map([[a[axis], a], [b[axis], b]]);
    for (const edge of [...baselineEdges, ...candidateEdges]) {
      for (const point of [edge.a, edge.b]) {
        if (point[axis] > a[axis] && point[axis] < b[axis]) cuts.set(point[axis], point);
      }
    }
    const ordered = [...cuts.keys()].sort((left, right) => left - right);
    const coverageIntervals = [];
    let inheritedOwners = null;
    for (let i = 1; i < ordered.length; i++) {
      const lo = ordered[i - 1], hi = ordered[i];
      const covering = edge => edge.a[axis] <= lo && edge.b[axis] >= hi;
      const priorOwners = owners(baselineEdges.filter(covering));
      const nextOwners = owners(candidateEdges.filter(covering));
      const signature = JSON.stringify(priorOwners);
      if (signature !== JSON.stringify(nextOwners) || !priorOwners.length) return null;
      if (inheritedOwners && signature !== JSON.stringify(inheritedOwners)) return null;
      const parentIds = [...new Set(priorOwners.map(owner => owner.parentId))].sort();
      if (JSON.stringify(parentIds) !== JSON.stringify([...new Set(row.parentIds)].sort())) return null;
      if (![1, -1].some(side => priorOwners.filter(owner => owner.side === side).length >= 2)) return null;
      inheritedOwners = priorOwners;
      coverageIntervals.push({ identitySegment: identity(cuts.get(lo), cuts.get(hi)),
        baselineOwners: priorOwners, candidateOwners: nextOwners });
    }
    if (!coverageIntervals.length) return null;
    return { classification: 'inherited-collinear-conflict-subdivision', inheritedOwners,
      baselineEdges: evidence(baselineEdges), candidateEdges: evidence(candidateEdges), coverageIntervals };
  };
}
