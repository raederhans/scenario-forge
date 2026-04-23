function getTopologyObjectFeatureCollection(topology, objectNames = []) {
  if (!topology?.objects || typeof globalThis.topojson?.feature !== "function") {
    return { objectName: "", collection: null };
  }
  for (const objectName of objectNames) {
    const object = topology.objects?.[objectName];
    if (!object) continue;
    try {
      const collection = globalThis.topojson.feature(topology, object);
      if (collection?.features?.length) {
        return { objectName, collection };
      }
    } catch (_error) {
      continue;
    }
  }
  return { objectName: "", collection: null };
}

function countGeometryPolygonParts(geometry) {
  if (!geometry || !geometry.type) return { polygonPartCount: 0, interiorRingCount: 0 };
  if (geometry.type === "Polygon") {
    const rings = Array.isArray(geometry.coordinates) ? geometry.coordinates.length : 0;
    return {
      polygonPartCount: 1,
      interiorRingCount: Math.max(0, rings - 1),
    };
  }
  if (geometry.type === "MultiPolygon") {
    const polygons = Array.isArray(geometry.coordinates) ? geometry.coordinates : [];
    const polygonPartCount = polygons.length;
    const interiorRingCount = polygons.reduce((total, polygon) => {
      const rings = Array.isArray(polygon) ? polygon.length : 0;
      return total + Math.max(0, rings - 1);
    }, 0);
    return { polygonPartCount, interiorRingCount };
  }
  if (geometry.type === "GeometryCollection") {
    return (geometry.geometries || []).reduce((acc, child) => {
      const childCounts = countGeometryPolygonParts(child);
      acc.polygonPartCount += childCounts.polygonPartCount;
      acc.interiorRingCount += childCounts.interiorRingCount;
      return acc;
    }, { polygonPartCount: 0, interiorRingCount: 0 });
  }
  return { polygonPartCount: 0, interiorRingCount: 0 };
}

export function getCoastlineTopologyMetrics({
  topology,
  objectNames = [],
  isWorldBounds = () => false,
} = {}) {
  const { objectName, collection } = getTopologyObjectFeatureCollection(topology, objectNames);
  if (!collection?.features?.length) {
    return {
      objectName: "",
      featureCount: 0,
      polygonPartCount: 0,
      interiorRingCount: 0,
      totalArea: 0,
      bounds: null,
      worldBounds: false,
    };
  }
  let totalArea = 0;
  collection.features.forEach((feature) => {
    try {
      totalArea += Number(globalThis.d3?.geoArea?.(feature)) || 0;
    } catch (_error) {
      // 单个 feature 失败时，继续保留整体诊断结果。
    }
  });
  const counts = collection.features.reduce((acc, feature) => {
    const featureCounts = countGeometryPolygonParts(feature?.geometry);
    acc.polygonPartCount += featureCounts.polygonPartCount;
    acc.interiorRingCount += featureCounts.interiorRingCount;
    return acc;
  }, { polygonPartCount: 0, interiorRingCount: 0 });
  let bounds = null;
  try {
    bounds = globalThis.d3?.geoBounds?.(collection) || null;
  } catch (_error) {
    bounds = null;
  }
  return {
    objectName,
    featureCount: collection.features.length,
    polygonPartCount: counts.polygonPartCount,
    interiorRingCount: counts.interiorRingCount,
    totalArea,
    bounds,
    worldBounds: isWorldBounds(bounds),
  };
}

export function evaluateCoastlineTopologySource({
  primaryTopology,
  runtimeTopology,
  scenarioId = "",
  scenarioCoastlineMaxAreaDeltaRatio = 0.02,
  scenarioCoastlineMaxInteriorRingCount = 500,
  scenarioCoastlineMaxInteriorRingRatio = 0.25,
  isWorldBounds = () => false,
} = {}) {
  const primaryMetrics = getCoastlineTopologyMetrics({
    topology: primaryTopology,
    objectNames: ["land_mask", "land"],
    isWorldBounds,
  });
  const runtimeMaskMetrics = scenarioId
    ? getCoastlineTopologyMetrics({
      topology: runtimeTopology,
      objectNames: ["context_land_mask", "land_mask", "land"],
      isWorldBounds,
    })
    : null;

  let decision = {
    source: "primary",
    reason: scenarioId ? "missing_runtime_land_mask" : "no_active_scenario",
    scenarioId,
    primaryObjectName: primaryMetrics.objectName || "",
    runtimeObjectName: runtimeMaskMetrics?.objectName || "",
    primaryFeatureCount: Number(primaryMetrics.featureCount || 0),
    runtimeFeatureCount: Number(runtimeMaskMetrics?.featureCount || 0),
    primaryPolygonPartCount: Number(primaryMetrics.polygonPartCount || 0),
    runtimePolygonPartCount: Number(runtimeMaskMetrics?.polygonPartCount || 0),
    primaryInteriorRingCount: Number(primaryMetrics.interiorRingCount || 0),
    runtimeInteriorRingCount: Number(runtimeMaskMetrics?.interiorRingCount || 0),
    runtimeInteriorRingRatio: 0,
    areaDeltaRatio: 0,
    meshMode: "mask",
    topology: primaryTopology,
  };

  if (scenarioId && runtimeMaskMetrics?.objectName && primaryMetrics.featureCount > 0) {
    const areaBase = Math.max(1e-9, Number(primaryMetrics.totalArea) || 0);
    const areaDeltaRatio = Math.abs((Number(runtimeMaskMetrics.totalArea) || 0) - areaBase) / areaBase;
    const runtimeInteriorRingRatio =
      Number(runtimeMaskMetrics.interiorRingCount || 0) / Math.max(1, Number(runtimeMaskMetrics.polygonPartCount || 0));
    let accepted = true;
    let reason = "scenario_accepted";
    if (runtimeMaskMetrics.worldBounds) {
      accepted = false;
      reason = "runtime_world_bounds";
    } else if (areaDeltaRatio > scenarioCoastlineMaxAreaDeltaRatio) {
      accepted = false;
      reason = "area_delta_exceeded";
    } else if (Number(runtimeMaskMetrics.interiorRingCount || 0) > scenarioCoastlineMaxInteriorRingCount) {
      accepted = false;
      reason = "interior_ring_count_exceeded";
    } else if (runtimeInteriorRingRatio > scenarioCoastlineMaxInteriorRingRatio) {
      accepted = false;
      reason = "interior_ring_ratio_exceeded";
    }
    decision = {
      ...decision,
      source: accepted ? "scenario" : "primary",
      reason,
      runtimeInteriorRingRatio,
      areaDeltaRatio,
      meshMode: "mask",
      topology: accepted ? runtimeTopology : primaryTopology,
    };
  }

  return {
    decision,
    primaryMetrics,
    runtimeMaskMetrics,
  };
}
