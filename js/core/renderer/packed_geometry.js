// Renderer-only Float64 storage. Project/save/edit GeoJSON is never replaced.
// Each feature owns its buffers: evicting most of an upload must not leave a
// tiny surviving view pinning the entire transport batch in memory.
const PACKED = Symbol("packed-raster-geometry");
const DEPTH = { Point: 1, MultiPoint: 2, LineString: 2, MultiLineString: 3, Polygon: 3, MultiPolygon: 4 };
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const invalid = () => { throw new TypeError("Invalid packed raster geometry."); };
export const isPackedRasterGeometry = (value) => value?.[PACKED] === true;
export const getRasterGeometryWeights = (value, fallback) => isPackedRasterGeometry(value) ? value.weights : fallback(value);

export function decodePackedRasterUpdates(payload) {
  if (payload?.encoding !== "geo-f64-v1" || !(payload.coordinates instanceof Float64Array)
    || !(payload.lengths instanceof Uint32Array) || !Array.isArray(payload.value)) invalid();
  const { coordinates, lengths } = payload;
  return payload.value.map(({ id, feature }) => {
    if (!feature) return { id, feature: null };
    const source = feature.type === "Feature" ? feature.geometry : feature;
    let minC = coordinates.length, maxC = 0, minL = lengths.length, maxL = 0, points = 0;
    function scan(cursor, depth) {
      if (!integer(cursor.c) || !integer(cursor.l) || cursor.l >= lengths.length) invalid();
      const count = lengths[cursor.l++];
      if (depth === 1) {
        if (count > coordinates.length - cursor.c) invalid();
        cursor.c += count;
        points++;
      } else {
        if (count > lengths.length - cursor.l) invalid();
        for (let i = 0; i < count; i++) scan(cursor, depth - 1);
      }
    }
    function visit(geometry) {
      if (!geometry) return;
      if (geometry.type === "GeometryCollection") {
        if (!Array.isArray(geometry.geometries)) invalid();
        geometry.geometries.forEach(visit);
      } else if (Object.hasOwn(DEPTH, geometry.type)) {
        const offset = geometry.coordinates;
        if (!Array.isArray(offset) || offset.length !== 2 || !offset.every(integer)) invalid();
        const cursor = { c: offset[0], l: offset[1] };
        if (cursor.c > coordinates.length) invalid();
        scan(cursor, DEPTH[geometry.type]);
        minC = Math.min(minC, offset[0]); maxC = Math.max(maxC, cursor.c);
        minL = Math.min(minL, offset[1]); maxL = Math.max(maxL, cursor.l);
      } else if (geometry.type !== "Sphere") invalid();
    }
    visit(source);
    if (maxL === 0) { minC = 0; minL = 0; }
    const ownedCoordinates = coordinates.slice(minC, maxC);
    const ownedLengths = lengths.slice(minL, maxL);
    function relative(geometry) {
      if (!geometry) return null;
      if (geometry.type === "GeometryCollection") return { type: geometry.type, geometries: geometry.geometries.map(relative) };
      if (geometry.type === "Sphere") return { type: "Sphere" };
      return { type: geometry.type, coordinates: [geometry.coordinates[0] - minC, geometry.coordinates[1] - minL] };
    }
    return { id, feature: { [PACKED]: true, geometry: relative(source), coordinates: ownedCoordinates, lengths: ownedLengths,
      weights: { decoded: 256 + ownedCoordinates.byteLength + ownedLengths.byteLength, path: 256 + points * 32, points } } };
  });
}

export function streamPackedRasterGeometry(value, stream) {
  if (!isPackedRasterGeometry(value)) invalid();
  const { coordinates, lengths } = value;
  function point(cursor, emit = true) {
    const size = lengths[cursor.l++];
    const start = cursor.c;
    cursor.c += size;
    if (emit) stream.point(size > 0 ? coordinates[start] : undefined,
      size > 1 ? coordinates[start + 1] : undefined, size > 2 ? coordinates[start + 2] : undefined);
  }
  function line(cursor, closed) {
    const count = lengths[cursor.l++];
    stream.lineStart();
    for (let i = 0; i < count; i++) point(cursor, !closed || i < count - 1);
    stream.lineEnd();
  }
  function polygon(cursor) {
    const count = lengths[cursor.l++];
    stream.polygonStart();
    for (let i = 0; i < count; i++) line(cursor, true);
    stream.polygonEnd();
  }
  function visit(geometry) {
    if (!geometry) return;
    if (geometry.type === "GeometryCollection") { geometry.geometries.forEach(visit); return; }
    if (geometry.type === "Sphere") { stream.sphere(); return; }
    const cursor = { c: geometry.coordinates[0], l: geometry.coordinates[1] };
    switch (geometry.type) {
      case "Point": point(cursor); break;
      case "MultiPoint": { const n = lengths[cursor.l++]; for (let i = 0; i < n; i++) point(cursor); break; }
      case "LineString": line(cursor, false); break;
      case "MultiLineString": { const n = lengths[cursor.l++]; for (let i = 0; i < n; i++) line(cursor, false); break; }
      case "Polygon": polygon(cursor); break;
      case "MultiPolygon": { const n = lengths[cursor.l++]; for (let i = 0; i < n; i++) polygon(cursor); break; }
      default: invalid();
    }
  }
  visit(value.geometry);
}

// Matches d3-geo's canvas stream contract. D3 still owns spherical clipping,
// antimeridian handling, adaptive resampling and projection. Only the source
// traversal bypasses reconstruction of thousands of nested coordinate arrays.
export function drawPackedRasterGeometry(value, projection, context, pointRadius = 2) {
  pointRadius = +pointRadius;
  let inPolygon = false, linePoint = NaN;
  const sink = {
    point(x, y) {
      if (linePoint === 0) { context.moveTo(x, y); linePoint = 1; }
      else if (linePoint === 1) context.lineTo(x, y);
      else { context.moveTo(x + pointRadius, y); context.arc(x, y, pointRadius, 0, 2 * Math.PI); }
    },
    lineStart() { linePoint = 0; },
    lineEnd() { if (inPolygon) context.closePath(); linePoint = NaN; },
    polygonStart() { inPolygon = true; },
    polygonEnd() { inPolygon = false; },
  };
  streamPackedRasterGeometry(value, projection.stream(sink));
}
