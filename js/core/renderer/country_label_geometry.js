export const getCountryLabelPolygons = geometry => geometry?.type === 'Polygon' ? [geometry.coordinates]
  : geometry?.type === 'MultiPolygon' ? geometry.coordinates || [] : [];

function clockwise(ring) {
  let area = 0;
  for (let i = 1; i < ring.length; i++) {
    let dx = ring[i][0] - ring[i - 1][0];
    if (dx > 180) dx -= 360;
    if (dx < -180) dx += 360;
    area += dx * (ring[i][1] + ring[i - 1][1]);
  }
  return area >= 0;
}

function normalizeGeometry(geometry, geoArea) {
  const coordinates = [];
  for (const rings of getCountryLabelPolygons(geometry)) {
    const normalized = [];
    for (let i = 0; i < rings.length; i++) {
      const ring = rings[i];
      let result = clockwise(ring) === (i === 0) ? ring : [...ring].reverse();
      if (geoArea) {
        // Normalize individual rings: a reversed island or a degenerate hole
        // must never turn a tiny polygon into a spherical complement.
        const reverse = [...ring].reverse();
        const area = geoArea({ type: 'Polygon', coordinates: [ring] });
        const reversedArea = geoArea({ type: 'Polygon', coordinates: [reverse] });
        if (!Number.isFinite(area) || !Number.isFinite(reversedArea) || Math.min(area, reversedArea) === 0) {
          if (i === 0) break;
          continue;
        }
        result = (i === 0 ? area <= reversedArea : area >= reversedArea) ? ring : reverse;
      }
      normalized.push(result);
    }
    // Quantized source slivers can produce a collapsed exterior whose holes
    // exceed it. Such an invalid component cannot provide a label surface;
    // omit it instead of accepting the nearly whole-world complement.
    if (normalized.length && (!geoArea || geoArea({ type: 'Polygon', coordinates: normalized }) <= 2 * Math.PI)) {
      coordinates.push(normalized);
    }
  }
  return { type: 'MultiPolygon', coordinates };
}

// Coarse chunks are GeoJSON, but the shared border vertices still come from one
// quantized topology. Recreate exact shared segments to let topojson dissolve
// provinces. Normalize each province before indexing: inconsistent ring
// directions would make a shared edge erase part of its neighboring province.
// Coordinates and holes remain intact.
// Work one country at a time so temporary edge indexes can be released early.
async function mergeFeatures(features, topojson, geoArea, yieldTask) {
  if (features.length === 1) {
    return { type: 'MultiPolygon', coordinates: getCountryLabelPolygons(features[0].geometry) };
  }
  const arcs = [], index = new Map(), geometries = [];
  let sliceStarted = performance.now();
  for (const feature of features) {
    const normalized = normalizeGeometry(feature.geometry, geoArea);
    geometries.push({ type: 'MultiPolygon',
    arcs: normalized.coordinates.map(rings => rings.map(ring => {
      const references = [];
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i];
        const ka = JSON.stringify(a), kb = JSON.stringify(b);
        if (ka === kb) continue;
        const forward = ka < kb, key = forward ? `${ka};${kb}` : `${kb};${ka}`;
        let arc = index.get(key);
        if (arc === undefined) {
          arc = arcs.length; index.set(key, arc); arcs.push(forward ? [a, b] : [b, a]);
        }
        references.push(forward ? arc : ~arc);
      }
      return references;
    })) });
    if (performance.now() - sliceStarted > 12) {
      await yieldTask(); sliceStarted = performance.now();
    }
  }
  return topojson.merge({ type: 'Topology', arcs, objects: {} }, geometries);
}

export async function mergeCountryLabelGroups(groups, { topology = null, topojson, geoArea, yieldTask = () => Promise.resolve(), isCurrent = () => true } = {}) {
  const records = []; let sliceStarted = performance.now();
  for (const [countryCode, members] of groups.sort(([a], [b]) => a.localeCompare(b))) {
    if (!isCurrent()) throw new DOMException('Stale country label geometry', 'AbortError');
    const merged = topology ? topojson.merge(topology, members) : await mergeFeatures(members, topojson, geoArea, yieldTask);
    const geometry = normalizeGeometry(merged, geoArea);
    if (geometry.coordinates.length) records.push({ countryCode, geometry });
    if (performance.now() - sliceStarted > 12) { await yieldTask(); sliceStarted = performance.now(); }
  }
  return records;
}

export function unpackCountryLabelTransport(payload) {
  if (payload?.encoding === 'geo-f64-batches-v1') return payload.batches.flatMap(unpackCountryLabelTransport);
  return payload?.encoding === 'geo-f64-v1' ? globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(payload) : payload;
}
