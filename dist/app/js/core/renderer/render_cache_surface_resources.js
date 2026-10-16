// Owns internal surface retention and accounting across visible and export roots.
export function createRenderCacheSurfaceResources({
  initialCache, getValidatedCacheState, renderPassNames, resourceBudget,
  invalidateInteractionComposite, invalidateLastGoodFrame,
}) {
  const surfaceResourceOwner = Symbol("render-cache-surfaces");
  const retainedSurfaceCaches = new Map();
  let surfaceCacheRoot = initialCache;

  function collectSurfaceCanvases(cache, surfaces = new Set()) {
    if (!cache || typeof cache !== "object") return surfaces;
    for (const canvas of Object.values(cache.canvases || {})) if (canvas) surfaces.add(canvas);
    for (const entry of Object.values(cache.contextScenarioLayerCache || {})) if (entry?.canvas) surfaces.add(entry.canvas);
    for (const name of ["lastGoodFrame", "interactionComposite", "compositeBuffer", "borderSnapshot"]) {
      if (cache[name]?.canvas) surfaces.add(cache[name].canvas);
    }
    return surfaces;
  }

  function collectPoliticalPathCaches(cache, pathCaches = new Set()) {
    if (cache?.politicalPathCache instanceof Map) pathCaches.add(cache.politicalPathCache);
    return pathCaches;
  }

  function getProtectedSurfaceCanvases(excludedCache) {
    const surfaces = new Set();
    if (surfaceCacheRoot !== excludedCache) collectSurfaceCanvases(surfaceCacheRoot, surfaces);
    for (const cache of retainedSurfaceCaches.keys()) {
      if (cache !== excludedCache) collectSurfaceCanvases(cache, surfaces);
    }
    return surfaces;
  }

  function getProtectedPoliticalPathCaches(excludedCache) {
    const pathCaches = new Set();
    if (surfaceCacheRoot !== excludedCache) collectPoliticalPathCaches(surfaceCacheRoot, pathCaches);
    for (const cache of retainedSurfaceCaches.keys()) {
      if (cache !== excludedCache) collectPoliticalPathCaches(cache, pathCaches);
    }
    return pathCaches;
  }

  function releaseCanvasBackings(surfaces, protectedSurfaces = new Set()) {
    for (const canvas of surfaces) {
      if (protectedSurfaces.has(canvas)) continue;
      canvas.width = 0;
      canvas.height = 0;
    }
  }

  function releaseCacheSurfaces(cache) {
    if (!cache || typeof cache !== "object" || retainedSurfaceCaches.has(cache)) return false;
    const surfaces = collectSurfaceCanvases(cache);
    releaseCanvasBackings(surfaces, getProtectedSurfaceCanvases(cache));
    const politicalPathCache = cache.politicalPathCache;
    const releasedPoliticalPathCache = politicalPathCache instanceof Map
      && politicalPathCache.size > 0
      && !getProtectedPoliticalPathCaches(cache).has(politicalPathCache);
    if (releasedPoliticalPathCache) politicalPathCache.clear();
    cache.canvases = {};
    cache.contextScenarioLayerCache = {};
    cache.referenceTransform = null;
    cache.referenceTransforms = {};
    cache.fullReferenceTransforms = {};
    cache.signatures = {};
    cache.layouts = {};
    for (const passName of renderPassNames) {
      if (cache.dirty) cache.dirty[passName] = true;
      if (cache.reasons) cache.reasons[passName] = "surface-released";
    }
    for (const name of ["lastGoodFrame", "interactionComposite", "compositeBuffer", "borderSnapshot"]) {
      const entry = cache[name];
      if (!entry || typeof entry !== "object") continue;
      entry.canvas = null;
      entry.layout = null;
      entry.coverage = null;
      entry.referenceTransform = null;
      entry.valid = false;
      entry.signature = "";
      entry.reason = "surface-released";
    }
    return surfaces.size > 0 || releasedPoliticalPathCache;
  }

  function updateSurfaceResourceAccounting() {
    const surfaces = collectSurfaceCanvases(surfaceCacheRoot);
    for (const cache of retainedSurfaceCaches.keys()) collectSurfaceCanvases(cache, surfaces);
    let bytes = 0;
    for (const canvas of surfaces) {
      const width = Number(canvas.width);
      const height = Number(canvas.height);
      if (Number.isSafeInteger(width) && width > 0 && Number.isSafeInteger(height) && height > 0) {
        bytes += width * height * 4;
      }
    }
    if (bytes > 0) resourceBudget.update(surfaceResourceOwner, { bitmaps: bytes });
    else resourceBudget.release(surfaceResourceOwner);
    return bytes;
  }

  function getRenderPassCacheState() {
    const cache = getValidatedCacheState();
    if (cache !== surfaceCacheRoot) {
      const previous = surfaceCacheRoot;
      surfaceCacheRoot = cache;
      releaseCacheSurfaces(previous);
      updateSurfaceResourceAccounting();
    }
    return cache;
  }

  function syncSurfaceResourceAccounting() {
    getRenderPassCacheState();
    return updateSurfaceResourceAccounting();
  }

  // Export may temporarily replace the current root; retain the visible root
  // until the caller restores it in finally and ends this scope.
  function retainSurfaceCacheForScope(cache) {
    retainedSurfaceCaches.set(cache, (retainedSurfaceCaches.get(cache) || 0) + 1);
    syncSurfaceResourceAccounting();
    let ended = false;
    return () => {
      if (ended) return;
      ended = true;
      getRenderPassCacheState();
      const count = retainedSurfaceCaches.get(cache) || 0;
      if (count > 1) retainedSurfaceCaches.set(cache, count - 1);
      else {
        retainedSurfaceCaches.delete(cache);
        if (cache !== surfaceCacheRoot) releaseCacheSurfaces(cache);
      }
      updateSurfaceResourceAccounting();
    };
  }

  // Only internal cache surfaces are traversed; the returned export canvas is
  // owned by the caller and is not a member of this cache.
  function releaseSurfaceCache(cache) {
    getRenderPassCacheState();
    const changed = releaseCacheSurfaces(cache);
    updateSurfaceResourceAccounting();
    return changed;
  }

  function clearContextScenarioLayerSurfaces(cache) {
    const entries = Object.values(cache.contextScenarioLayerCache || {});
    const surfaces = new Set(entries.map((entry) => entry?.canvas).filter(Boolean));
    cache.contextScenarioLayerCache = {};
    const protectedSurfaces = getProtectedSurfaceCanvases(cache);
    collectSurfaceCanvases(cache, protectedSurfaces);
    releaseCanvasBackings(surfaces, protectedSurfaces);
  }

  function releaseInactivePassSurfaces(activePassNames) {
    const cache = getRenderPassCacheState();
    const active = new Set(activePassNames);
    const releasedSurfaces = new Set();
    let changed = false;
    for (const passName of renderPassNames) {
      if (active.has(passName)) continue;
      for (const field of ["canvases", "referenceTransforms", "fullReferenceTransforms", "signatures", "layouts"]) {
        if (Object.hasOwn(cache[field] || {}, passName)) {
          if (field === "canvases" && cache[field][passName]) releasedSurfaces.add(cache[field][passName]);
          delete cache[field][passName];
          changed = true;
        }
      }
      cache.dirty[passName] = true;
      cache.reasons[passName] = "pass-inactive";
      if (passName === "contextScenario" && Object.keys(cache.contextScenarioLayerCache || {}).length) {
        clearContextScenarioLayerSurfaces(cache);
        changed = true;
      }
    }
    const protectedSurfaces = getProtectedSurfaceCanvases(cache);
    collectSurfaceCanvases(cache, protectedSurfaces);
    releaseCanvasBackings(releasedSurfaces, protectedSurfaces);
    if (changed) {
      invalidateInteractionComposite("pass-inactive");
      invalidateLastGoodFrame("pass-inactive");
    }
    updateSurfaceResourceAccounting();
    return changed;
  }

  function getContextScenarioLayerCacheEntry(layerName) {
    const cache = getRenderPassCacheState();
    const resolvedLayerName = String(layerName || "default").trim() || "default";
    const existing = cache.contextScenarioLayerCache?.[resolvedLayerName];
    if (existing && typeof existing === "object") {
      return existing;
    }
    const next = {
      canvas: null,
      signature: "",
      referenceTransform: null,
      renderedCount: 0,
    };
    cache.contextScenarioLayerCache[resolvedLayerName] = next;
    return next;
  }

  function clearContextScenarioLayerIdentity(entry) {
    entry.signature = "";
    entry.referenceTransform = null;
    entry.renderedCount = 0;
  }

  return Object.freeze({
    getRenderPassCacheState, syncSurfaceResourceAccounting, retainSurfaceCacheForScope,
    releaseSurfaceCache, releaseInactivePassSurfaces, clearContextScenarioLayerSurfaces,
    getContextScenarioLayerCacheEntry, clearContextScenarioLayerIdentity,
  });
}
