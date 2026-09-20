// Classic startup workers and module raster workers share the same wire format.
// Only newly allocated buffers are transferred; source GeoJSON remains usable.
var SCENARIO_FORGE_GEOMETRY_TRANSFER_CODEC_SHARED = globalThis.__scenarioForgeGeometryTransferCodecShared || (() => {
  const depths = { Point: 1, MultiPoint: 2, LineString: 2, MultiLineString: 3, Polygon: 3, MultiPolygon: 4 };
  function mapGeometry(value, transform) {
    if (!value || typeof value !== "object") return value;
    if (Object.hasOwn(depths, value.type) && Array.isArray(value.coordinates)) return transform(value, depths[value.type]);
    if (Array.isArray(value)) return value.map((item) => mapGeometry(item, transform));
    // Properties and topology arcs are opaque. Walk container objects, including
    // decodedCollections, FeatureCollections and raster update envelopes.
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
    const result = { ...value };
    for (const key of Object.keys(value)) {
      if (key !== "properties" && key !== "arcs" && key !== "coordinates") result[key] = mapGeometry(value[key], transform);
    }
    return result;
  }
  function pack(value, { minCoordinateCount = 16_384 } = {}) {
    let coordinateCount = 0, lengthCount = 0, valid = true;
    function count(array, depth) {
      if (!Array.isArray(array)) { valid = false; return; }
      lengthCount += 1;
      for (let index = 0; index < array.length; index += 1) {
        if (depth > 1) count(array[index], depth - 1);
        else if (typeof array[index] === "number") coordinateCount += 1;
        else valid = false;
      }
    }
    mapGeometry(value, (geometry, depth) => { count(geometry.coordinates, depth); return geometry; });
    // Small updates stay on the ordinary path. The cutoff is deliberately
    // conservative: measured TNO samples at 18k scalars amortize conversion;
    // sub-1k samples do not. This is a transport choice, never an LOD change.
    if (!valid || !coordinateCount || coordinateCount < minCoordinateCount) return { payload: value, transferables: [] };
    const coordinates = new Float64Array(coordinateCount);
    const lengths = new Uint32Array(lengthCount);
    let coordinateOffset = 0, lengthOffset = 0;
    function write(array, depth) {
      lengths[lengthOffset++] = array.length;
      if (depth === 1) {
        for (let i = 0; i < array.length; i += 1) coordinates[coordinateOffset++] = array[i];
      } else for (const item of array) write(item, depth - 1);
    }
    const packed = mapGeometry(value, (geometry, depth) => {
      const offset = [coordinateOffset, lengthOffset];
      write(geometry.coordinates, depth);
      return { ...geometry, coordinates: offset };
    });
    return {
      payload: { encoding: "geo-f64-v1", value: packed, coordinates, lengths },
      transferables: [coordinates.buffer, lengths.buffer],
    };
  }
  function unpack(payload) {
    if (payload?.encoding !== "geo-f64-v1") throw new Error("Unsupported geometry transport encoding.");
    const { coordinates, lengths } = payload;
    function read(depth, cursor) {
      const array = new Array(lengths[cursor[1]++]);
      for (let i = 0; i < array.length; i += 1) array[i] = depth === 1 ? coordinates[cursor[0]++] : read(depth - 1, cursor);
      return array;
    }
    return mapGeometry(payload.value, (geometry, depth) => ({ ...geometry, coordinates: read(depth, [...geometry.coordinates]) }));
  }
  return Object.freeze({ pack, unpack });
})();
globalThis.__scenarioForgeGeometryTransferCodecShared = SCENARIO_FORGE_GEOMETRY_TRANSFER_CODEC_SHARED;
