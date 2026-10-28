import { getProjectionGeometryGeneration } from "./projection_geometry_identity.js";
import { pageResourceBudget } from "../runtime_resource_budget.js";
import { GeometryBudgetMap, getGeometryRetentionWeights, PROJECTED_PATH_CACHE_BUDGET } from "./geometry_cache_budget.js";
import { yieldToBackground } from "../background_yield.js";

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

  // Build a collection's path over several background slices so a large mask
  // (the TNO ocean is about 0.4 s of geoPath streaming) is ready before the
  // frame that needs it. getPath() still builds synchronously when asked first.
  async function prepare(object, {
    yieldControl = yieldToBackground,
    nowMs = () => globalThis.performance?.now?.() ?? Date.now(),
    sliceBudgetMs = 6,
  } = {}) {
    if (!object || typeof object !== "object" || typeof Path2DClass !== "function" || typeof geoPath !== "function") return null;
    if (object.type !== "FeatureCollection" || !Array.isArray(object.features)
      || typeof Path2DClass.prototype?.addPath !== "function") {
      return getPath(object);
    }
    const projection = getProjection?.();
    if (!projection) return null;
    const startGeneration = getProjectionGeometryGeneration(projection);
    if (generation !== startGeneration) {
      entries.clear();
      generation = startGeneration;
      stream = geoPath(projection);
      updateResourceAccounting();
    }
    const existing = entries.get(object);
    if (existing) {
      hits += 1;
      return existing.path;
    }
    const combined = new Path2DClass();
    let sliceStartedAt = nowMs();
    for (const feature of object.features) {
      if (nowMs() - sliceStartedAt >= sliceBudgetMs) {
        await yieldControl();
        const current = getProjection?.();
        if (!current || generation !== startGeneration || getProjectionGeometryGeneration(current) !== startGeneration) return null;
        sliceStartedAt = nowMs();
      }
      const part = new Path2DClass();
      stream.context(part)(feature);
      combined.addPath(part);
    }
    const built = entries.get(object);
    if (built) return built.path;
    entries.set(object, {
      path: combined,
      estimatedBytes: getGeometryRetentionWeights(object).path,
    });
    builds += 1;
    updateResourceAccounting();
    return combined;
  }

  return Object.freeze({
    getPath,
    prepare,
    reset,
    getStats: () => ({ hits, builds, generation, ...entries.getStats() }),
  });
}
