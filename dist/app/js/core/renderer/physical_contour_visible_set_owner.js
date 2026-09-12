// Owns contour selection and its collection/viewport cache. Projection bounds
// remain a renderer capability: a cache hit here must not query them again.
export function createPhysicalContourVisibleSetOwner({ getFeatureScreenBounds, overscanPx }) {
  if (typeof getFeatureScreenBounds !== "function") {
    throw new TypeError("Contour visibility requires getFeatureScreenBounds");
  }
  let cache = new Map();

  function reset() {
    cache = new Map();
  }

  function select(collection, {
    cacheSlot = "major",
    lowReliefCutoff = 0,
    intervalM = 0,
    excludeIntervalM = 0,
    minScreenSpanPx = 0,
    maxFeatures = 0,
  } = {}, {
    width,
    height,
    topologyRevision,
    zoomBucket,
    transformSignature,
    viewportSignature,
  }) {
    if (!Array.isArray(collection?.features) || collection.features.length === 0) return [];
    const key = [
      Number(topologyRevision || 0),
      zoomBucket,
      transformSignature,
      viewportSignature,
      collection.features.length,
      Number(lowReliefCutoff || 0).toFixed(2),
      Number(intervalM || 0).toFixed(2),
      Number(excludeIntervalM || 0).toFixed(2),
      Number(minScreenSpanPx || 0).toFixed(2),
      Number(maxFeatures || 0),
    ].join("|");
    const cached = cache.get(cacheSlot);
    if (cached?.collectionRef === collection && cached.key === key) return cached.features;

    const overscan = Math.max(overscanPx, Math.min(width, height) * 0.08);
    const maxX = Number(width || 0) + overscan;
    const maxY = Number(height || 0) + overscan;
    const visibleRecords = [];
    collection.features.forEach((feature) => {
      const elevation = Number(feature?.properties?.elevation_m);
      if (Number.isFinite(elevation) && elevation < lowReliefCutoff) return;
      if (intervalM > 0 && Number.isFinite(elevation) && elevation % intervalM !== 0) return;
      if (excludeIntervalM > 0 && Number.isFinite(elevation) && elevation % excludeIntervalM === 0) return;

      const screenBounds = getFeatureScreenBounds(feature, { allowCompute: false }) || getFeatureScreenBounds(feature);
      if (!screenBounds) {
        const geometryType = String(feature?.geometry?.type || "").trim();
        if (minScreenSpanPx <= 0 && (geometryType === "LineString" || geometryType === "MultiLineString")) {
          visibleRecords.push({ feature, elevation, span: 0 });
        }
        return;
      }
      if (screenBounds.maxX < -overscan || screenBounds.maxY < -overscan
        || screenBounds.minX > maxX || screenBounds.minY > maxY) return;
      const span = Math.max(Number(screenBounds.width || 0), Number(screenBounds.height || 0));
      if (minScreenSpanPx > 0 && !(span >= minScreenSpanPx)) return;
      visibleRecords.push({ feature, elevation, span });
    });

    let features;
    if (maxFeatures > 0 && visibleRecords.length > maxFeatures) {
      const scored = visibleRecords.map(({ feature, elevation, span }) => ({
        feature,
        score: (Number.isFinite(elevation) ? elevation : 0) * 1.15 + span * 34,
      }));
      scored.sort((a, b) => b.score - a.score);
      features = scored.slice(0, maxFeatures).map((entry) => entry.feature);
    } else {
      features = visibleRecords.map((entry) => entry.feature);
    }
    cache.set(cacheSlot, { collectionRef: collection, key, features });
    return features;
  }

  return Object.freeze({ select, reset });
}
