// Classic startup workers and module raster workers share the same wire format.
// Only newly allocated buffers are transferred; source GeoJSON remains usable.
var SCENARIO_FORGE_GEOMETRY_TRANSFER_CODEC_SHARED = globalThis.__scenarioForgeGeometryTransferCodecShared || (() => {
  const depths = { Point: 1, MultiPoint: 2, LineString: 2, MultiLineString: 3, Polygon: 3, MultiPolygon: 4 };
  const referenceLength = 0xFFFFFFFF;
  function mapGeometry(value, transform, includeTopologyArcs = false) {
    if (!value || typeof value !== "object") return value;
    if (Object.hasOwn(depths, value.type) && Array.isArray(value.coordinates)) return transform(value, depths[value.type]);
    if (Array.isArray(value)) return value.map((item) => mapGeometry(item, transform, includeTopologyArcs));
    // Properties are opaque. Topology arcs are opt-in for startup responses;
    // ordinary chunk/raster messages keep the original v1 contract.
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return value;
    const result = { ...value };
    for (const key of Object.keys(value)) {
      if (key !== "properties" && key !== "arcs" && key !== "coordinates") result[key] = mapGeometry(value[key], transform, includeTopologyArcs);
    }
    if (includeTopologyArcs && value.type === "Topology" && Array.isArray(value.arcs)) {
      result.arcs = transform({ type: "MultiLineString", coordinates: value.arcs }, 3).coordinates;
    }
    return result;
  }
  // shareReferences keeps arrays that several geometries share (TopoJSON arcs
  // and the collections decoded from them) as one copy: v3 writes a reference
  // record instead of repeating the points. Consumers that scan the v1 layout
  // directly (packed raster updates) keep receiving v1/v2 by default.
  function pack(value, { minCoordinateCount = 16_384, includeTopologyArcs = false, shareReferences = false } = {}) {
    let coordinateCount = 0, lengthCount = 0, valid = true;
    const counted = new Map();
    function count(array, depth, record = true) {
      if (!Array.isArray(array)) { valid = false; return; }
      const previousDepths = shareReferences ? (counted.get(array) || 0) : 0;
      if (record) lengthCount += previousDepths ? 2 : 1;
      if (previousDepths & (1 << depth)) return;
      if (shareReferences) counted.set(array, previousDepths | (1 << depth));
      const firstWrite = record && !previousDepths;
      for (let index = 0; index < array.length; index += 1) {
        if (depth > 1) count(array[index], depth - 1, firstWrite);
        else if (typeof array[index] === "number") { if (firstWrite) coordinateCount += 1; }
        else valid = false;
      }
    }
    mapGeometry(value, (geometry, depth) => { count(geometry.coordinates, depth); return geometry; }, includeTopologyArcs);
    // Small updates stay on the ordinary path. The cutoff is deliberately
    // conservative: measured TNO samples at 18k scalars amortize conversion;
    // sub-1k samples do not. This is a transport choice, never an LOD change.
    if (!valid || !coordinateCount || coordinateCount < minCoordinateCount) return { payload: value, transferables: [] };
    const coordinates = new Float64Array(coordinateCount);
    const lengths = new Uint32Array(lengthCount);
    counted.clear();
    const written = new Map();
    let coordinateOffset = 0, lengthOffset = 0;
    function write(array, depth) {
      if (shareReferences && written.has(array)) {
        lengths[lengthOffset++] = referenceLength;
        lengths[lengthOffset++] = written.get(array);
        return;
      }
      if (shareReferences) written.set(array, lengthOffset);
      lengths[lengthOffset++] = array.length;
      if (depth === 1) {
        for (let i = 0; i < array.length; i += 1) coordinates[coordinateOffset++] = array[i];
      } else for (const item of array) write(item, depth - 1);
    }
    const packed = mapGeometry(value, (geometry, depth) => {
      const offset = [coordinateOffset, lengthOffset];
      write(geometry.coordinates, depth);
      return { ...geometry, coordinates: offset };
    }, includeTopologyArcs);
    return {
      payload: shareReferences
        ? { encoding: "geo-f64-v3", includeTopologyArcs, value: packed, coordinates, lengths }
        : { encoding: includeTopologyArcs ? "geo-f64-v2" : "geo-f64-v1", value: packed, coordinates, lengths },
      transferables: [coordinates.buffer, lengths.buffer],
    };
  }
  function unpack(payload) {
    if (payload?.encoding !== "geo-f64-v1" && payload?.encoding !== "geo-f64-v2" && payload?.encoding !== "geo-f64-v3") throw new Error("Unsupported geometry transport encoding.");
    const { coordinates, lengths } = payload;
    const shared = payload.encoding === "geo-f64-v3";
    const arrays = new Map();
    function read(depth, cursor) {
      const offset = cursor[1];
      const length = lengths[cursor[1]++];
      if (shared && length === referenceLength) return arrays.get(lengths[cursor[1]++]);
      const array = new Array(length);
      if (shared) arrays.set(offset, array);
      for (let i = 0; i < array.length; i += 1) array[i] = depth === 1 ? coordinates[cursor[0]++] : read(depth - 1, cursor);
      return array;
    }
    return mapGeometry(payload.value, (geometry, depth) => ({ ...geometry, coordinates: read(depth, [...geometry.coordinates]) }), shared ? payload.includeTopologyArcs : payload.encoding === "geo-f64-v2");
  }
  function yieldToBackground() {
    if (typeof globalThis.scheduler?.postTask === "function") {
      return globalThis.scheduler.postTask(() => {}, { priority: "background" });
    }
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  async function unpackAsync(payload, { yieldControl = yieldToBackground, nowMs = () => performance.now(), sliceBudgetMs = 6 } = {}) {
    if (payload?.encoding !== "geo-f64-v1" && payload?.encoding !== "geo-f64-v2" && payload?.encoding !== "geo-f64-v3") throw new Error("Unsupported geometry transport encoding.");
    const { coordinates, lengths } = payload;
    const shared = payload.encoding === "geo-f64-v3";
    const arrays = new Map();
    const tasks = [];
    let sliceStartedAt = nowMs();
    const result = mapGeometry(payload.value, (geometry, depth) => {
      const decoded = { ...geometry, coordinates: [] };
      if (shared) {
        const start = geometry.coordinates[1];
        const offset = lengths[start] === referenceLength ? lengths[start + 1] : start;
        if (!arrays.has(offset)) arrays.set(offset, decoded.coordinates);
        decoded.coordinates = arrays.get(offset);
      }
      tasks.push({ decoded, depth, cursor: [...geometry.coordinates] });
      return decoded;
    }, shared ? payload.includeTopologyArcs : payload.encoding === "geo-f64-v2");
    function read(depth, cursor) {
      const offset = cursor[1];
      const length = lengths[cursor[1]++];
      if (shared && length === referenceLength) return arrays.get(lengths[cursor[1]++]);
      const array = (shared && arrays.get(offset)) || new Array(length);
      array.length = length;
      if (shared) arrays.set(offset, array);
      for (let i = 0; i < array.length; i += 1) array[i] = depth === 1 ? coordinates[cursor[0]++] : read(depth - 1, cursor);
      return array;
    }
    for (const { decoded, depth, cursor } of tasks) {
      if (decoded.type === "MultiLineString") {
        const lines = decoded.coordinates;
        const length = lengths[cursor[1]++];
        const reference = shared && length === referenceLength;
        if (reference) cursor[1] += 1;
        else lines.length = length;
        for (let i = 0; i < lines.length; i += 1) {
          if (!reference) lines[i] = read(depth - 1, cursor);
          if (nowMs() - sliceStartedAt >= sliceBudgetMs) {
            await yieldControl();
            sliceStartedAt = nowMs();
          }
        }
      } else {
        decoded.coordinates = read(depth, cursor);
      }
      if (nowMs() - sliceStartedAt >= sliceBudgetMs) {
        await yieldControl();
        sliceStartedAt = nowMs();
      }
    }
    return result;
  }
  return Object.freeze({ pack, unpack, unpackAsync });
})();
globalThis.__scenarioForgeGeometryTransferCodecShared = SCENARIO_FORGE_GEOMETRY_TRANSFER_CODEC_SHARED;
