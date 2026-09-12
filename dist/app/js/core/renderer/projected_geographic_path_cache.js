import { getProjectionGeometryGeneration } from "./projection_geometry_identity.js";

// Projected coordinates do not include the canvas camera or DPR transform.
// Stream directly into Path2D to preserve the precision of the Canvas path.
export function createProjectedGeographicPathCache({
  getProjection,
  geoPath = globalThis.d3?.geoPath,
  Path2DClass = globalThis.Path2D,
} = {}) {
  let entries = new WeakMap();
  let generation = -1;
  let stream = null;
  let hits = 0;
  let builds = 0;

  function reset() {
    entries = new WeakMap();
    generation = -1;
    stream = null;
  }

  function getPath(object) {
    if (!object || typeof object !== "object" || typeof Path2DClass !== "function" || typeof geoPath !== "function") return null;
    const projection = getProjection?.();
    if (!projection) return null;
    const nextGeneration = getProjectionGeometryGeneration(projection);
    if (generation !== nextGeneration) {
      entries = new WeakMap();
      generation = nextGeneration;
      stream = geoPath(projection);
    }
    const key = object.type === "Feature" ? object.geometry : object;
    if (!key || typeof key !== "object") return null;
    const cached = entries.get(key);
    if (cached) {
      hits += 1;
      return cached;
    }
    const path = new Path2DClass();
    stream.context(path)(object);
    entries.set(key, path);
    builds += 1;
    return path;
  }

  return Object.freeze({
    getPath,
    reset,
    getStats: () => ({ hits, builds, generation }),
  });
}
