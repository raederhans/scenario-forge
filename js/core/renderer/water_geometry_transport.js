// Water-only cooperative transport. Source coordinates are never detached or rounded.
const DEPTH = { Point: 1, MultiPoint: 2, LineString: 2, MultiLineString: 3, Polygon: 3, MultiPolygon: 4 };
export const yieldWaterTask = () => globalThis.scheduler?.yield
  ? globalThis.scheduler.yield()
  : new Promise(resolve => setTimeout(resolve, 0));

export async function packWaterGeometry(updates, {
  signal, yieldTask = yieldWaterTask, scalarBatchSize = 65536,
} = {}) {
  const batchSize = Math.max(1, Math.floor(scalarBatchSize));
  const checkInterval = Math.min(batchSize, 256);
  let operations = 0;
  let deadline = performance.now() + 4;
  function shouldYield() {
    operations++;
    return operations % checkInterval === 0
      && (operations % batchSize === 0 || performance.now() >= deadline);
  }
  async function checkpoint() {
    signal?.throwIfAborted();
    await yieldTask();
    signal?.throwIfAborted();
    deadline = performance.now() + 4;
  }
  function* walk(value, depth) {
    if (!Array.isArray(value)) throw new TypeError("Invalid water coordinates.");
    yield [0, value.length];
    for (const child of value) {
      if (depth > 1) yield* walk(child, depth - 1);
      else {
        if (!Number.isFinite(child)) throw new TypeError("Nonfinite water coordinate.");
        yield [1, child];
      }
    }
  }
  const sources = [];
  function* describe(geometry) {
    yield;
    if (!geometry) return null;
    if (geometry.type === "Feature") return yield* describe(geometry.geometry);
    if (geometry.type === "GeometryCollection") {
      const geometries = [];
      for (const part of geometry.geometries) geometries.push(yield* describe(part));
      return { type: geometry.type, geometries };
    }
    if (geometry.type === "Sphere") return { type: "Sphere" };
    if (!Object.hasOwn(DEPTH, geometry.type)) throw new TypeError("Unsupported water geometry.");
    const result = { type: geometry.type, coordinates: null };
    sources.push({ source: geometry.coordinates, depth: DEPTH[geometry.type], result });
    return result;
  }
  signal?.throwIfAborted();
  const value = [];
  for (const update of updates) {
    const iterator = describe(update.feature);
    let result;
    do {
      result = iterator.next();
      if (shouldYield()) await checkpoint();
    } while (!result.done);
    value.push({ id: update.id, feature: result.value });
  }
  let coordinateCount = 0, lengthCount = 0;
  for (const { source, depth } of sources) {
    for (const [kind] of walk(source, depth)) {
      if (kind) coordinateCount++; else lengthCount++;
      if (shouldYield()) await checkpoint();
    }
  }
  const coordinates = new Float64Array(coordinateCount), lengths = new Uint32Array(lengthCount);
  let c = 0, l = 0;
  for (const { source, depth, result } of sources) {
    result.coordinates = [c, l];
    for (const [kind, number] of walk(source, depth)) {
      if (kind) coordinates[c++] = number; else lengths[l++] = number;
      if (shouldYield()) await checkpoint();
    }
  }
  signal?.throwIfAborted();
  return { payload: { encoding: "geo-f64-v1", value, coordinates, lengths },
    transfer: [coordinates.buffer, lengths.buffer] };
}
