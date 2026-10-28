import { yieldToBackground } from "../background_yield.js";
// Water-only cooperative transport. Source coordinates are never detached or rounded.
const DEPTH = { Point: 1, MultiPoint: 2, LineString: 2, MultiLineString: 3, Polygon: 3, MultiPolygon: 4 };
export const yieldWaterTask = yieldToBackground;

export async function packWaterGeometry(updates, {
  signal, yieldTask = yieldWaterTask, scalarBatchSize = 65536,
} = {}) {
  const batchSize = Math.max(1, Math.floor(scalarBatchSize));
  const checkInterval = Math.min(batchSize, 4096);
  let operations = 0;
  let deadline = performance.now() + 4;
  function shouldYield() {
    return operations >= batchSize || performance.now() >= deadline;
  }
  async function checkpoint() {
    signal?.throwIfAborted();
    await yieldTask();
    signal?.throwIfAborted();
    operations = 0;
    deadline = performance.now() + 4;
  }
  let coordinateCount = 0, lengthCount = 0;
  let coordinates, lengths;
  let c = 0, l = 0;
  function* walk(value, depth, write = false) {
    if (!Array.isArray(value)) throw new TypeError("Invalid water coordinates.");
    if (write) lengths[l++] = value.length; else lengthCount++;
    operations++;
    if (depth > 2) {
      for (const child of value) yield* walk(child, depth - 1, write);
    } else {
      for (let index = 0; index < value.length; index++) {
        if (depth === 2) {
          const point = value[index];
          if (!Array.isArray(point)) throw new TypeError("Invalid water coordinates.");
          if (write) lengths[l++] = point.length; else lengthCount++;
          operations++;
          for (const number of point) {
            if (!Number.isFinite(number)) throw new TypeError("Nonfinite water coordinate.");
            if (write) coordinates[c++] = number; else coordinateCount++;
            operations++;
          }
        } else {
          const number = value[index];
          if (!Number.isFinite(number)) throw new TypeError("Nonfinite water coordinate.");
          if (write) coordinates[c++] = number; else coordinateCount++;
          operations++;
        }
        if ((index + 1) % checkInterval === 0) yield;
      }
    }
    yield;
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
      operations++;
      if (shouldYield()) await checkpoint();
    } while (!result.done);
    value.push({ id: update.id, feature: result.value });
  }
  for (const { source, depth } of sources) {
    for (const step of walk(source, depth)) {
      if (shouldYield()) await checkpoint();
    }
  }
  coordinates = new Float64Array(coordinateCount);
  lengths = new Uint32Array(lengthCount);
  for (const { source, depth, result } of sources) {
    result.coordinates = [c, l];
    for (const step of walk(source, depth, true)) {
      if (shouldYield()) await checkpoint();
    }
  }
  signal?.throwIfAborted();
  return { payload: { encoding: "geo-f64-v1", value, coordinates, lengths },
    transfer: [coordinates.buffer, lengths.buffer] };
}
