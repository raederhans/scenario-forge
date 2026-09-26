function clampToRange(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createHitResult(overrides = {}) {
  return {
    id: null,
    countryCode: null,
    runtimeCountryCode: null,
    targetType: null,
    feature: null,
    hitSource: "none",
    bboxArea: Infinity,
    viaSnap: false,
    strict: false,
    distancePx: Infinity,
    ...overrides,
  };
}

function getBBoxDistanceToPoint(item, px, py) {
  const dx = px < item.minX ? item.minX - px : px > item.maxX ? px - item.maxX : 0;
  const dy = py < item.minY ? item.minY - py : py > item.maxY ? py - item.maxY : 0;
  return Math.hypot(dx, dy);
}

function collectSpatialGridCandidates({
  grid = null,
  gridMeta = null,
  px = 0,
  py = 0,
  radiusProj = 0,
  getSpatialBucketKey = null,
  shouldIncludeItem = () => true,
} = {}) {
  if (!gridMeta || !grid || typeof getSpatialBucketKey !== "function") return [];
  const { cellSize, cols, rows, globals } = gridMeta;
  if (!cellSize || cols <= 0 || rows <= 0) return [];

  const radius = Math.max(0, radiusProj || 0);
  const minX = px - radius;
  const maxX = px + radius;
  const minY = py - radius;
  const maxY = py + radius;
  const c0 = clampToRange(Math.floor(minX / cellSize), 0, cols - 1);
  const c1 = clampToRange(Math.floor(maxX / cellSize), 0, cols - 1);
  const r0 = clampToRange(Math.floor(minY / cellSize), 0, rows - 1);
  const r1 = clampToRange(Math.floor(maxY / cellSize), 0, rows - 1);

  const buckets = [];
  for (let row = r0; row <= r1; row += 1) {
    for (let col = c0; col <= c1; col += 1) {
      const key = getSpatialBucketKey(col, row);
      const bucket = grid.get(key);
      if (bucket?.length) {
        buckets.push(bucket);
      }
    }
  }

  const seen = new Set();
  const candidates = [];
  const strict = radius <= 0;
  const maybePush = (item) => {
    if (!item?.id || seen.has(item.id) || !shouldIncludeItem(item)) return;
    seen.add(item.id);
    const distanceProj = getBBoxDistanceToPoint(item, px, py);
    if (strict) {
      if (distanceProj > 0) return;
    } else if (distanceProj > radius) {
      return;
    }
    candidates.push({ item, distanceProj });
  };

  buckets.forEach((bucket) => {
    bucket.forEach(maybePush);
  });
  globals?.forEach(maybePush);

  return candidates;
}

function getCandidateSourceRank(candidate) {
  const feature = candidate.item?.feature;
  const source = String(candidate.item?.source || feature?.properties?.__source || "primary");
  return source === "detail" ? 0 : 1;
}

function getCandidateBboxArea(candidate) {
  if (Number.isFinite(candidate.item?.bboxArea)) {
    return candidate.item.bboxArea;
  }
  return Math.max(
    0,
    (candidate.item.maxX - candidate.item.minX) * (candidate.item.maxY - candidate.item.minY)
  );
}

function compareRankedCandidates(a, b) {
  if (a.sourceRank !== b.sourceRank) return a.sourceRank - b.sourceRank;
  if (a.bboxArea !== b.bboxArea) return a.bboxArea - b.bboxArea;
  if (a.distanceProj !== b.distanceProj) return a.distanceProj - b.distanceProj;
  return String(a.item?.id || "").localeCompare(String(b.item?.id || ""));
}

function rankCandidates(
  candidates,
  lonLat,
  {
    eventType = "unknown",
    targetType = "unknown",
    geoContains = null,
    nowMs = () => 0,
    recordInteractionDurationMetric = null,
  } = {}
) {
  if (!Array.isArray(candidates) || !candidates.length) return [];

  const startedAt = nowMs();
  const canGeoContains = typeof geoContains === "function";
  let geoContainsCount = 0;
  const ranked = candidates.map((candidate) => {
    const feature = candidate.item?.feature;
    const hitGeometry = candidate.item?.hitGeometry || feature;
    let containsGeo = false;
    if (hitGeometry && lonLat && canGeoContains) {
      geoContainsCount += 1;
      try {
        containsGeo = !!geoContains(hitGeometry, lonLat);
      } catch (_error) {
        containsGeo = false;
      }
    }
    return {
      ...candidate,
      containsGeo,
      sourceRank: getCandidateSourceRank(candidate),
      bboxArea: getCandidateBboxArea(candidate),
    };
  });

  ranked.sort((a, b) => {
    if (a.containsGeo !== b.containsGeo) return a.containsGeo ? -1 : 1;
    return compareRankedCandidates(a, b);
  });

  if (
    (eventType !== "unknown" || targetType !== "unknown")
    && typeof recordInteractionDurationMetric === "function"
  ) {
    recordInteractionDurationMetric("interactionHitRankDuration", nowMs() - startedAt, {
      candidateCount: candidates.length,
      geoContainsCount,
      containsGeoCount: ranked.filter((candidate) => candidate.containsGeo).length,
      eventType,
      targetType,
    });
  }

  return ranked;
}

function findFirstContainingCandidate(
  candidates,
  lonLat,
  {
    eventType = "hover",
    targetType = "unknown",
    geoContains = null,
    nowMs = () => 0,
    recordInteractionDurationMetric = null,
  } = {}
) {
  if (!Array.isArray(candidates) || !candidates.length) return null;
  const startedAt = nowMs();
  const canGeoContains = typeof geoContains === "function";
  let geoContainsCount = 0;
  const ordered = candidates
    .map((candidate) => ({
      ...candidate,
      sourceRank: getCandidateSourceRank(candidate),
      bboxArea: getCandidateBboxArea(candidate),
    }))
    .sort(compareRankedCandidates);
  for (const candidate of ordered) {
    const feature = candidate.item?.feature;
    const hitGeometry = candidate.item?.hitGeometry || feature;
    if (!hitGeometry || !lonLat || !canGeoContains) continue;
    geoContainsCount += 1;
    try {
      if (geoContains(hitGeometry, lonLat)) {
        if (typeof recordInteractionDurationMetric === "function") {
          recordInteractionDurationMetric("interactionHitRankDuration", nowMs() - startedAt, {
            candidateCount: candidates.length,
            geoContainsCount,
            containsGeoCount: 1,
            eventType,
            targetType,
            fastPath: "hover-first-containing",
          });
        }
        return {
          ...candidate,
          containsGeo: true,
        };
      }
    } catch (_error) {
      // Ignore malformed geometry and continue with the next candidate.
    }
  }
  if (typeof recordInteractionDurationMetric === "function") {
    recordInteractionDurationMetric("interactionHitRankDuration", nowMs() - startedAt, {
      candidateCount: candidates.length,
      geoContainsCount,
      containsGeoCount: 0,
      eventType,
      targetType,
      fastPath: "hover-first-containing",
    });
  }
  return null;
}

function toHitResult(
  candidate,
  {
    viaSnap = false,
    strict = false,
    zoomK = 1,
    targetType = "land",
    canonicalCountryCode = (value) => String(value || "").trim(),
    getFeatureCountryCodeNormalized = () => "",
    getFeatureInteractionCountryCodeNormalized = () => "",
  } = {}
) {
  const resolvedId = String(candidate?.item?.featureId || candidate?.item?.id || "").trim();
  if (!resolvedId) return createHitResult();
  const feature = candidate.item.feature || null;
  const runtimeCountryCode = canonicalCountryCode(
    candidate.item.countryCode
    || getFeatureCountryCodeNormalized(feature)
    || ""
  );
  const interactionCountryCode = feature
    ? getFeatureInteractionCountryCodeNormalized(feature, resolvedId)
    : canonicalCountryCode(candidate.item.interactionCountryCode || candidate.item.borderMeshCountryCode || runtimeCountryCode || "");
  return createHitResult({
    id: resolvedId,
    countryCode: interactionCountryCode || runtimeCountryCode,
    runtimeCountryCode,
    targetType,
    feature,
    hitSource: "spatial",
    bboxArea: Number(candidate.bboxArea || candidate.item.bboxArea || Infinity),
    viaSnap,
    strict,
    distancePx: candidate.distanceProj * zoomK,
  });
}

function shouldPreferWaterHit(
  landHit,
  waterHit,
  {
    eventType = "unknown",
    isMacroOceanWaterRegion = () => false,
    getWaterRegionType = () => "",
  } = {}
) {
  if (!waterHit?.id) return false;
  if (eventType === "hover" && isMacroOceanWaterRegion(waterHit.feature)) {
    return false;
  }
  if (!landHit?.id) return true;
  const waterType = getWaterRegionType(waterHit.feature);
  if (["lake", "reservoir", "inland_sea", "strait", "chokepoint"].includes(waterType)) {
    return true;
  }
  const landArea = Number(landHit.bboxArea || Infinity);
  const waterArea = Number(waterHit.bboxArea || Infinity);
  if (waterHit.strict && Number.isFinite(waterArea) && Number.isFinite(landArea) && waterArea < landArea * 0.2) {
    return true;
  }
  return false;
}

export {
  collectSpatialGridCandidates,
  createHitResult,
  findFirstContainingCandidate,
  getBBoxDistanceToPoint,
  rankCandidates,
  shouldPreferWaterHit,
  toHitResult,
};
