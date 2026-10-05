import { getProjectionGeometryGeneration } from "./projection_geometry_identity.js";
import { pageResourceBudget } from "../runtime_resource_budget.js";
import { GeometryBudgetMap, getGeometryRetentionWeights, PROJECTED_PATH_CACHE_BUDGET } from "./geometry_cache_budget.js";

// Projected coordinates do not include the canvas camera or DPR transform.
// Stream directly into Path2D to preserve the precision of the Canvas path.
export function createProjectedGeographicPathCache({
  getProjection,
  geoPath = globalThis.d3?.geoPath,
  Path2DClass = globalThis.Path2D,
  pathCacheBudget = PROJECTED_PATH_CACHE_BUDGET,
  resourceBudget = pageResourceBudget,
} = {}) {
  const resourceOwner = Symbol("projected-geographic-paths");
  const entries = new GeometryBudgetMap({
    budget: pathCacheBudget,
    weigh: (entry) => entry?.estimatedBytes || 256,
  });
  let generation = -1;
  let stream = null;
  let hits = 0;
  let builds = 0;

  function updateResourceAccounting() {
    if (entries.retainedWeight > 0) {
      resourceBudget.update(resourceOwner, { projectedPaths: entries.retainedWeight });
    } else {
      resourceBudget.release(resourceOwner);
    }
  }

  function reset() {
    entries.clear();
    generation = -1;
    stream = null;
    updateResourceAccounting();
  }

  function getPath(object) {
    if (!object || typeof object !== "object" || typeof Path2DClass !== "function" || typeof geoPath !== "function") return null;
    const projection = getProjection?.();
    if (!projection) return null;
    const nextGeneration = getProjectionGeometryGeneration(projection);
    if (generation !== nextGeneration) {
      entries.clear();
      generation = nextGeneration;
      stream = geoPath(projection);
      updateResourceAccounting();
    }
    const key = object.type === "Feature" ? object.geometry : object;
    if (!key || typeof key !== "object") return null;
    const cached = entries.get(key);
    if (cached) {
      hits += 1;
      return cached.path;
    }
    const path = new Path2DClass();
    stream.context(path)(object);
    entries.set(key, {
      path,
      estimatedBytes: getGeometryRetentionWeights(key).path,
    });
    builds += 1;
    updateResourceAccounting();
    return path;
  }

  return Object.freeze({
    getPath,
    reset,
    getStats: () => ({ hits, builds, generation, ...entries.getStats() }),
  });
}
