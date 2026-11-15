export function buildTransportLineViewportIndex(features, getBounds) {
  const cellSize = 128;
  const cells = new Map();
  const bounds = features.map(getBounds);
  let minCellX = Infinity;
  let minCellY = Infinity;
  let maxCellX = -Infinity;
  let maxCellY = -Infinity;
  bounds.forEach(([[minX, minY], [maxX, maxY]], index) => {
    const left = Math.floor(minX / cellSize);
    const right = Math.floor(maxX / cellSize);
    const top = Math.floor(minY / cellSize);
    const bottom = Math.floor(maxY / cellSize);
    minCellX = Math.min(minCellX, left);
    maxCellX = Math.max(maxCellX, right);
    minCellY = Math.min(minCellY, top);
    maxCellY = Math.max(maxCellY, bottom);
    for (let x = left; x <= right; x += 1) {
      for (let y = top; y <= bottom; y += 1) {
        const key = `${x},${y}`;
        if (!cells.has(key)) cells.set(key, []);
        cells.get(key).push(index);
      }
    }
  });
  return {
    query({ minX, minY, maxX, maxY }) {
      const visited = new Set();
      for (let x = Math.max(minCellX, Math.floor(minX / cellSize)); x <= Math.min(maxCellX, Math.floor(maxX / cellSize)); x += 1) {
        for (let y = Math.max(minCellY, Math.floor(minY / cellSize)); y <= Math.min(maxCellY, Math.floor(maxY / cellSize)); y += 1) {
          for (const index of cells.get(`${x},${y}`) || []) visited.add(index);
        }
      }
      const indices = [...visited].filter((index) => {
        const [[left, top], [right, bottom]] = bounds[index];
        return left <= maxX && right >= minX && top <= maxY && bottom >= minY;
      }).sort((left, right) => left - right);
      return { features: indices.map((index) => features[index]), visitedFeatureCount: visited.size };
    },
  };
}

export function getTransportLineLabelGridSize(labelDensity) {
  switch (String(labelDensity || "").trim().toLowerCase()) {
    case "dense":
      return 112;
    case "sparse":
      return 176;
    default:
      return 144;
  }
}

export function resolveTransportOverviewLineCoordinateWidth(screenWidthPx, k, floorPx = 0.75) {
  const safeZoom = Math.max(0.0001, Number(k || 1));
  const normalizedScreenWidth = Math.max(Number(floorPx) || 0, Number(screenWidthPx) || 0);
  return normalizedScreenWidth / safeZoom;
}

export function resolveTransportOverviewLineDash(dashPx, k) {
  if (!Array.isArray(dashPx) || !dashPx.length) return [];
  const safeZoom = Math.max(0.0001, Number(k || 1));
  return dashPx
    .map((value) => Math.max(0, Number(value) || 0) / safeZoom)
    .filter((value) => value > 0);
}

export function buildTransportOverviewLineStrokeSpecs(style, {
  baseOpacity,
  strategy,
  k,
  widthFloorPx = 0.75,
} = {}) {
  const opacity = Number(baseOpacity || 0) * Number(style?.opacity || 0) * Number(strategy?.opacityMultiplier || 0);
  return [
    {
      strokeStyle: style?.casingStroke,
      lineWidth: resolveTransportOverviewLineCoordinateWidth(Number(style?.casingWidth || 0) * Number(strategy?.widthMultiplier || 0), k, widthFloorPx + 0.7),
      opacity: opacity * 0.82,
      dash: [],
    },
    {
      strokeStyle: style?.innerStroke,
      lineWidth: resolveTransportOverviewLineCoordinateWidth(Number(style?.innerWidth || 0) * Number(strategy?.widthMultiplier || 0), k, widthFloorPx),
      opacity,
      dash: resolveTransportOverviewLineDash(style?.dashPx, k),
    },
  ];
}

export function projectTransportLineGeometry(geometry, projectPoint) {
  if (typeof projectPoint !== "function" || !geometry || typeof geometry !== "object") return [];
  const rawLines = geometry.type === "LineString"
    ? [geometry.coordinates || []]
    : geometry.type === "MultiLineString"
      ? (geometry.coordinates || [])
      : [];
  return rawLines
    .map((line) => (Array.isArray(line) ? line : [])
      .map((coord) => projectPoint(coord))
      .filter((point) => Array.isArray(point) && point.length >= 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])))
    .filter((line) => line.length >= 2);
}

export function measureProjectedLineSetLength(lines) {
  let total = 0;
  (Array.isArray(lines) ? lines : []).forEach((line) => {
    for (let index = 1; index < line.length; index += 1) {
      const previous = line[index - 1];
      const current = line[index];
      total += Math.hypot(
        Number(current?.[0] || 0) - Number(previous?.[0] || 0),
        Number(current?.[1] || 0) - Number(previous?.[1] || 0),
      );
    }
  });
  return total;
}

export function getTransportLineFeatureLabelAnchor(
  feature,
  {
    getLineMidpointFromCoordinates,
    getMultiLineLabelAnchor,
  } = {},
) {
  const geometry = feature?.geometry;
  if (!geometry || typeof geometry !== "object") return null;
  if (geometry.type === "LineString") {
    return typeof getLineMidpointFromCoordinates === "function"
      ? getLineMidpointFromCoordinates(Array.isArray(geometry.coordinates) ? geometry.coordinates : [])
      : null;
  }
  return typeof getMultiLineLabelAnchor === "function"
    ? getMultiLineLabelAnchor(geometry, "midpoint")
    : null;
}

export function getTransportOverviewRailLabelText(properties = {}, mode = "name") {
  const name = String(properties.name || "").trim();
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized === "ref") return name;
  return name;
}

export function getTransportOverviewRoadLabelText(properties = {}, mode = "ref") {
  const ref = String(properties.ref || properties.route_ref || "").trim();
  const name = String(properties.name || properties.road_name || "").trim();
  const normalized = String(mode || "").trim().toLowerCase();
  if (normalized === "name") return name || ref;
  if (normalized === "both") return ref && name ? `${ref} · ${name}` : (ref || name);
  return ref || name;
}

export function getRoadLabelClassPriority(roadClass) {
  switch (String(roadClass || "").trim().toLowerCase()) {
    case "motorway":
      return 4;
    case "trunk":
      return 3;
    case "primary":
      return 2;
    default:
      return 1;
  }
}

export function getRoadLabelClassFromPriority(priority) {
  if (priority >= 4) return "motorway";
  if (priority >= 3) return "trunk";
  if (priority >= 2) return "primary";
  return "secondary";
}

export function resolveTransportRoadLabelClassAndPriority(properties = {}) {
  const explicitRoadClass = String(properties.class || properties.road_class || properties.highway || "").trim().toLowerCase();
  if (explicitRoadClass) {
    return {
      roadClass: explicitRoadClass,
      priority: getRoadLabelClassPriority(explicitRoadClass),
    };
  }
  const rawPriority = Number(properties.priority ?? properties.label_priority ?? properties.rank);
  const priority = Number.isFinite(rawPriority)
    ? Math.max(1, Math.min(4, Math.round(rawPriority)))
    : 1;
  return {
    roadClass: getRoadLabelClassFromPriority(priority),
    priority,
  };
}
