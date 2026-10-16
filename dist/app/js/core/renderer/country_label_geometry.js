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

function boundsContain(outer, inner) {
  if (inner[0][1] < outer[0][1] - 1e-9 || inner[1][1] > outer[1][1] + 1e-9) return false;
  // A spherical bounding interval may cross 180 degrees. Compare spans from
  // the parent's west edge instead of treating its longitudes as planar x.
  const span = bounds => bounds[1][0] - bounds[0][0] + (bounds[1][0] < bounds[0][0] ? 360 : 0);
  const outerSpan = span(outer);
  if (outerSpan >= 360 - 1e-9) return true;
  const offset = ((inner[0][0] - outer[0][0]) % 360 + 360) % 360;
  return offset + span(inner) <= outerSpan + 1e-9;
}

function indexedRingContains(node, point, geoContains) {
  if (node.contains === undefined) {
    const bounds = node.bounds, west = bounds[0][0], east = bounds[1][0];
    const longitude = (west + (east - west + (east < west ? 360 : 0)) / 2) * Math.PI / 180;
    const latitude = (bounds[0][1] + bounds[1][1]) / 2 * Math.PI / 180;
    const sinCenter = Math.sin(latitude), cosCenter = Math.cos(latitude);
    const project = ([lon, lat]) => {
      const phi = lat * Math.PI / 180, delta = lon * Math.PI / 180 - longitude;
      const sin = Math.sin(phi), cos = Math.cos(phi), denominator = sinCenter * sin + cosCenter * cos * Math.cos(delta);
      return denominator > 1e-8 ? [cos * Math.sin(delta) / denominator,
        (cosCenter * sin - sinCenter * cos * Math.cos(delta)) / denominator] : null;
    };
    const vertices = node.ring.map(project);
    node.contains = null;
    if (vertices.every(Boolean)) {
      // Gnomonic projection makes spherical great-circle edges straight. A
      // row index reuses that exact local boundary for thousands of holes.
      const minY = Math.min(...vertices.map(p => p[1])), maxY = Math.max(...vertices.map(p => p[1]));
      const step = (maxY - minY) / 32, rows = Array.from({ length: 32 }, () => []);
      if (step > 0) {
        for (let i = 1; i < vertices.length; i++) {
          const a = vertices[i - 1], b = vertices[i];
          const first = Math.max(0, Math.min(31, Math.floor((Math.min(a[1], b[1]) - minY) / step)));
          const last = Math.max(0, Math.min(31, Math.floor((Math.max(a[1], b[1]) - minY) / step)));
          for (let row = first; row <= last; row++) rows[row].push([a, b]);
        }
        node.contains = p => {
          const projected = project(p);
          if (!projected) return geoContains(node.surface, p);
          const [x, y] = projected;
          if (y < minY || y > maxY) return false;
          let winding = 0;
          for (const [a, b] of rows[Math.max(0, Math.min(31, Math.floor((y - minY) / step)))]) {
            const cross = (x - a[0]) * (b[1] - a[1]) - (y - a[1]) * (b[0] - a[0]);
            if (Math.abs(cross) < 1e-12 && x >= Math.min(a[0], b[0]) && x <= Math.max(a[0], b[0])
              && y >= Math.min(a[1], b[1]) && y <= Math.max(a[1], b[1])) return geoContains(node.surface, p);
            if ((a[1] > y) !== (b[1] > y) && x < a[0] + (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1])) winding += b[1] > a[1] ? 1 : -1;
          }
          return winding !== 0;
        };
      }
    }
  }
  return node.contains ? node.contains(point) : geoContains(node.surface, point);
}

async function normalizeMergedGeometry(geometry, { geoArea, geoContains, geoBounds, yieldTask }) {
  if (!geoArea || !geoContains || !geoBounds) return normalizeGeometry(geometry, geoArea);
  const coordinates = [];
  let sliceStarted = performance.now();
  const yieldIfNeeded = async () => {
    if (performance.now() - sliceStarted > 12) { await yieldTask(); sliceStarted = performance.now(); }
  };
  for (const rings of getCountryLabelPolygons(geometry)) {
    // Dissolution can return several exterior loops in one stitched group.
    // Its first ring is not sufficient to identify all the remaining holes.
    const nodes = [];
    for (const ring of rings) {
      const normalized = normalizeGeometry({ type: 'Polygon', coordinates: [ring] }, geoArea);
      if (normalized.coordinates.length) {
        const surface = { type: 'Polygon', coordinates: normalized.coordinates[0] };
        nodes.push({ ring: surface.coordinates[0], surface, area: geoArea(surface),
          bounds: geoBounds(surface), parent: null, depth: 0 });
      }
      await yieldIfNeeded();
    }
    nodes.sort((a, b) => b.area - a.area);
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      for (let prior = index - 1; prior >= 0; prior--) {
        const parent = nodes[prior];
        if (parent.area <= node.area || !boundsContain(parent.bounds, node.bounds)) continue;
        if (!indexedRingContains(parent, node.ring[0], geoContains)
          || !indexedRingContains(parent, node.ring[Math.floor((node.ring.length - 1) / 2)], geoContains)) continue;
        node.parent = parent; node.depth = parent.depth + 1; break;
      }
      await yieldIfNeeded();
    }
    const byExterior = new Map(nodes.filter(node => node.depth % 2 === 0).map(node => [node, [node.ring]]));
    for (const node of nodes) if (node.depth % 2 === 1) byExterior.get(node.parent).push([...node.ring].reverse());
    coordinates.push(...byExterior.values());
  }
  return { type: 'MultiPolygon', coordinates };
}

// Coarse chunks are GeoJSON, but the shared border vertices still come from one
// quantized topology. Recreate exact shared segments to let topojson dissolve
// provinces. Normalize each province before indexing: inconsistent ring
// directions would make a shared edge erase part of its neighboring province.
// Coarse and detail borders may use different endpoints on one exact axial
// line. Split only reverse overlaps at existing endpoints; never snap coordinates
// or bridge gaps, and retain unrelated coastlines on the same axis.
// Work one country at a time so temporary edge indexes can be released early.
async function mergeFeatures(features, topojson, geoArea, yieldTask) {
  if (features.length === 1) {
    return { type: 'MultiPolygon', coordinates: getCountryLabelPolygons(features[0].geometry) };
  }
  const arcs = [], index = new Map(), geometries = [], normalizedFeatures = [];
  const axialEndpoints = [new Map(), new Map()];
  let sliceStarted = performance.now();
  for (const feature of features) {
    const normalized = normalizeGeometry(feature.geometry, geoArea);
    normalizedFeatures.push(normalized);
    const featureIndex = normalizedFeatures.length - 1;
    for (const rings of normalized.coordinates) for (const ring of rings) {
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i];
        const axis = a[0] === b[0] ? 0 : a[1] === b[1] && Math.abs(a[0] - b[0]) <= 180 ? 1 : -1;
        if (axis < 0 || a[1 - axis] === b[1 - axis]) continue;
        let endpoints = axialEndpoints[axis].get(a[axis]);
        if (!endpoints) axialEndpoints[axis].set(a[axis], endpoints = new Map());
        const direction = a[1 - axis] < b[1 - axis] ? 0 : 1;
        for (const value of [a[1 - axis], b[1 - axis]]) {
          let endpoint = endpoints.get(value);
          if (!endpoint) endpoints.set(value, endpoint = { value, owners: [new Set(), new Set()] });
          endpoint.owners[direction].add(featureIndex);
        }
      }
    }
    if (performance.now() - sliceStarted > 12) { await yieldTask(); sliceStarted = performance.now(); }
  }
  for (const lines of axialEndpoints) for (const [constant, endpoints] of lines) {
    lines.set(constant, [...endpoints.values()].sort((a, b) => a.value - b.value));
  }
  const lowerBound = (values, value) => {
    let low = 0, high = values.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (values[middle].value < value) low = middle + 1; else high = middle;
    }
    return low;
  };
  const addArc = (references, a, b) => {
    const ka = JSON.stringify(a), kb = JSON.stringify(b);
    if (ka === kb) return;
    const forward = ka < kb, key = forward ? `${ka};${kb}` : `${kb};${ka}`;
    let arc = index.get(key);
    if (arc === undefined) {
      arc = arcs.length; index.set(key, arc); arcs.push(forward ? [a, b] : [b, a]);
    }
    references.push(forward ? arc : ~arc);
  };
  for (const [featureIndex, normalized] of normalizedFeatures.entries()) {
    geometries.push({ type: 'MultiPolygon',
    arcs: normalized.coordinates.map(rings => rings.map(ring => {
      const references = [];
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1], b = ring[i];
        const axis = a[0] === b[0] ? 0 : a[1] === b[1] && Math.abs(a[0] - b[0]) <= 180 ? 1 : -1;
        let previous = a;
        if (axis >= 0 && a[1 - axis] !== b[1 - axis]) {
          const endpoints = axialEndpoints[axis].get(a[axis]);
          const min = Math.min(a[1 - axis], b[1 - axis]), max = Math.max(a[1 - axis], b[1 - axis]);
          const first = lowerBound(endpoints, min) + 1, end = lowerBound(endpoints, max);
          const forward = a[1 - axis] < b[1 - axis];
          for (let j = forward ? first : end - 1; forward ? j < end : j >= first; j += forward ? 1 : -1) {
            const endpoint = endpoints[j], opposingOwners = endpoint.owners[forward ? 1 : 0];
            // The endpoint must belong to a different, oppositely oriented
            // feature edge overlapping this interval. Unrelated coastlines
            // on the same latitude/longitude must keep their original edges.
            if (!opposingOwners.size || (opposingOwners.size === 1 && opposingOwners.has(featureIndex))) continue;
            const point = axis === 0 ? [a[0], endpoint.value] : [endpoint.value, a[1]];
            addArc(references, previous, point); previous = point;
          }
        }
        addArc(references, previous, b);
      }
      return references;
    })) });
    if (performance.now() - sliceStarted > 12) {
      await yieldTask(); sliceStarted = performance.now();
    }
  }
  return topojson.merge({ type: 'Topology', arcs, objects: {} }, geometries);
}

export async function mergeCountryLabelGroups(groups, { topology = null, topojson, geoArea,
  geoContains = globalThis.d3?.geoContains, geoBounds = globalThis.d3?.geoBounds,
  yieldTask = () => Promise.resolve(), isCurrent = () => true } = {}) {
  const records = []; let sliceStarted = performance.now();
  for (const [countryCode, members] of groups.sort(([a], [b]) => a.localeCompare(b))) {
    if (!isCurrent()) throw new DOMException('Stale country label geometry', 'AbortError');
    const merged = topology ? topojson.merge(topology, members) : await mergeFeatures(members, topojson, geoArea, yieldTask);
    const geometry = await normalizeMergedGeometry(merged, { geoArea, geoContains, geoBounds, yieldTask });
    if (geometry.coordinates.length) records.push({ countryCode, geometry });
    if (performance.now() - sliceStarted > 12) { await yieldTask(); sliceStarted = performance.now(); }
  }
  return records;
}

export function unpackCountryLabelTransport(payload) {
  if (payload?.encoding === 'geo-f64-batches-v1') return payload.batches.flatMap(unpackCountryLabelTransport);
  return payload?.encoding === 'geo-f64-v1' ? globalThis.__scenarioForgeGeometryTransferCodecShared.unpack(payload) : payload;
}
