function* packContourPolygonsSteps(collection) {
  const polygons = [];
  function visit(value) {
    if (!value) return;
    if (Array.isArray(value)) value.forEach(visit);
    else if (value.type === 'FeatureCollection') value.features.forEach(visit);
    else if (value.type === 'Feature') visit(value.geometry);
    else if (value.type === 'GeometryCollection') value.geometries.forEach(visit);
    else if (value.type === 'Polygon') polygons.push(value.coordinates);
    else if (value.type === 'MultiPolygon') polygons.push(...value.coordinates);
  }
  visit(collection);
  let count = 0, rings = 0;
  for (const polygon of polygons) for (const ring of polygon) { count += ring.length; rings++; }
  const coordinates = new Float64Array(count * 2), ringOffsets = new Uint32Array(rings + 1);
  const polygonOffsets = new Uint32Array(polygons.length + 1);
  let point = 0, r = 0;
  for (let p = 0; p < polygons.length; p++) {
    const polygon = polygons[p];
    polygonOffsets[p] = r;
    for (const ring of polygon) {
      ringOffsets[r++] = point;
      let previous = polygon[0]?.[0]?.[0] || 0;
      for (const coordinate of ring) {
        let x = coordinate[0];
        while (x - previous > 180) x -= 360;
        while (x - previous < -180) x += 360;
        coordinates[point * 2] = x; coordinates[point++ * 2 + 1] = coordinate[1]; previous = x;
        if (point % 4096 === 0) yield;
      }
    }
  }
  ringOffsets[r] = point; polygonOffsets[polygons.length] = r;
  return { coordinates, ringOffsets, polygonOffsets };
}

export function packContourPolygons(collection) {
  const steps = packContourPolygonsSteps(collection);
  let next = steps.next(); while (!next.done) next = steps.next(); return next.value;
}

export function createContourPolygonQuery(packed, cacheCells = true) {
  const { coordinates: c, ringOffsets, polygonOffsets } = packed;
  const latitudeIndex = new Map(), boundaryCells = new Set(), cells = new Map();
  const cellKey = (x, y) => (((x + 720) % 1440 + 1440) % 1440) * 1024 + y + 360;
  for (let p = 0; p < polygonOffsets.length - 1; p++) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const rows = new Map();
    for (let r = polygonOffsets[p]; r < polygonOffsets[p + 1]; r++) {
      for (let i = ringOffsets[r]; i < ringOffsets[r + 1] - 1; i++) {
        const x = c[i * 2], y = c[i * 2 + 1], ny = c[i * 2 + 3];
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
        const nx = c[i * 2 + 2];
        for (let row = Math.floor(Math.min(y, ny) * 4); row <= Math.floor(Math.max(y, ny) * 4); row++) {
          for (let column = Math.floor(Math.min(x, nx) * 4); cacheCells && column <= Math.floor(Math.max(x, nx) * 4); column++) boundaryCells.add(cellKey(column, row));
        }
        if (y === ny) continue;
        for (let row = Math.floor(Math.min(y, ny) * 4); row <= Math.floor(Math.max(y, ny) * 4); row++) {
          let edges = rows.get(row); if (!edges) rows.set(row, edges = []); edges.push(i);
        }
      }
    }
    const polygon = { x0, x1, y0, y1, rows };
    for (let row = Math.floor(y0 * 4); row <= Math.floor(y1 * 4); row++) {
      let bucket = latitudeIndex.get(row); if (!bucket) latitudeIndex.set(row, bucket = []); bucket.push(polygon);
    }
  }
  function exact(x, y) {
    for (const polygon of latitudeIndex.get(Math.floor(y * 4)) || []) {
      if (y < polygon.y0 || y > polygon.y1) continue;
      const px = x + 360 * Math.round(((polygon.x0 + polygon.x1) / 2 - x) / 360);
      if (px < polygon.x0 || px > polygon.x1) continue;
      let inside = false;
      for (const i of polygon.rows.get(Math.floor(y * 4)) || []) {
        const ax = c[i * 2], ay = c[i * 2 + 1], bx = c[i * 2 + 2], by = c[i * 2 + 3];
        if ((ay > y) !== (by > y) && px < ax + (y - ay) * (bx - ax) / (by - ay)) inside = !inside;
      }
      if (inside) return true;
    }
    return false;
  }
  if (!cacheCells) return exact;
  return (x, y) => {
    const key = cellKey(Math.floor(x * 4), Math.floor(y * 4));
    if (boundaryCells.has(key)) return exact(x, y);
    if (!cells.has(key)) cells.set(key, exact(x, y));
    return cells.get(key);
  };
}

export function packContourWaterMask({ land = null, water = null, addedLand = null } = {}) {
  const packedLand = packContourPolygons([land, addedLand]), packedWater = packContourPolygons(water);
  if (packedLand.polygonOffsets.length === 1 && packedWater.polygonOffsets.length === 1) return null;
  return { land: packedLand, water: packedWater };
}

export async function packContourWaterMaskCooperatively({ land = null, water = null, addedLand = null } = {}, yieldControl) {
  const result = [];
  for (const source of [[land, addedLand], water]) {
    const steps = packContourPolygonsSteps(source);
    let next = steps.next(), started = performance.now();
    while (!next.done) {
      if (performance.now() - started >= 4) { await yieldControl(); started = performance.now(); }
      next = steps.next();
    }
    result.push(next.value);
  }
  return result.every(p => p.polygonOffsets.length === 1) ? null : { land: result[0], water: result[1] };
}

export function createContourWaterQuery(mask) {
  if (!mask) return null;
  const land = createContourPolygonQuery(mask.land), water = createContourPolygonQuery(mask.water);
  const hasLand = mask.land.polygonOffsets.length > 1;
  return (x, y) => (hasLand ? land(x, y) : true) && !water(x, y);
}
