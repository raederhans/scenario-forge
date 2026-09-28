const PROJECTION_PARAMETER_NAMES = Object.freeze([
  "scale",
  "translate",
  "center",
  "rotate",
  "clipAngle",
  "clipExtent",
  "precision",
  "reflectX",
  "reflectY",
  "angle",
]);

function pointDistanceToSegmentSquared(point, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx === 0 && dy === 0) {
    const px = point[0] - start[0];
    const py = point[1] - start[1];
    return px * px + py * py;
  }

  const t = Math.max(0, Math.min(1,
    ((point[0] - start[0]) * dx + (point[1] - start[1]) * dy) / (dx * dx + dy * dy)));
  const px = point[0] - (start[0] + t * dx);
  const py = point[1] - (start[1] + t * dy);
  return px * px + py * py;
}

function simplifyOpenLine(points, toleranceSquared) {
  if (points.length <= 2) return points;

  const keep = new Uint8Array(points.length);
  const stack = [[0, points.length - 1]];
  keep[0] = 1;
  keep[points.length - 1] = 1;

  while (stack.length) {
    const [startIndex, endIndex] = stack.pop();
    let farthestIndex = -1;
    let farthestDistance = toleranceSquared;
    for (let index = startIndex + 1; index < endIndex; index += 1) {
      const distance = pointDistanceToSegmentSquared(points[index], points[startIndex], points[endIndex]);
      if (distance > farthestDistance) {
        farthestDistance = distance;
        farthestIndex = index;
      }
    }
    if (farthestIndex >= 0) {
      keep[farthestIndex] = 1;
      stack.push([startIndex, farthestIndex], [farthestIndex, endIndex]);
    }
  }

  return points.filter((_, index) => keep[index]);
}

function samePoint(left, right) {
  return Math.abs(left[0] - right[0]) <= 1e-7 && Math.abs(left[1] - right[1]) <= 1e-7;
}

function simplifyClosedRing(points, toleranceSquared) {
  const unique = points.slice(0, samePoint(points[0], points.at(-1)) ? -1 : undefined);
  if (unique.length < 4) return [...unique, unique[0]];

  let pivotIndex = 1;
  let pivotDistance = -1;
  const anchor = unique[0];
  for (let index = 1; index < unique.length; index += 1) {
    const dx = unique[index][0] - anchor[0];
    const dy = unique[index][1] - anchor[1];
    const distance = dx * dx + dy * dy;
    if (distance > pivotDistance) {
      pivotDistance = distance;
      pivotIndex = index;
    }
  }

  const firstArc = simplifyOpenLine(unique.slice(0, pivotIndex + 1), toleranceSquared);
  const secondArc = simplifyOpenLine([
    ...unique.slice(pivotIndex),
    anchor,
  ], toleranceSquared);
  const simplified = [...firstArc, ...secondArc.slice(1)];
  const simplifiedUnique = simplified.slice(0, -1);
  // A narrow ring can be nearly collinear. Keep its original shape instead of
  // collapsing a closed polygon to a line or a point.
  if (simplifiedUnique.length < 3) return [...unique, unique[0]];
  return simplified;
}

function snapshotProjection(projection) {
  const snapshot = [];
  for (const name of PROJECTION_PARAMETER_NAMES) {
    if (typeof projection?.[name] !== "function") continue;
    try {
      snapshot.push([name, projection[name]()]);
    } catch {
      snapshot.push([name, "unreadable"]);
    }
  }
  return JSON.stringify(snapshot);
}

function createProjectedLines(geometry, projection, geoStream) {
  if (!geometry?.type || typeof projection?.stream !== "function" || typeof geoStream !== "function") return null;

  const lines = [];
  let polygonDepth = 0;
  let currentLine = null;
  const sink = {
    polygonStart() { polygonDepth += 1; },
    polygonEnd() { polygonDepth = Math.max(0, polygonDepth - 1); },
    lineStart() { currentLine = { points: [], closed: polygonDepth > 0 }; },
    lineEnd() {
      if (currentLine?.points.length >= 2) lines.push(currentLine);
      currentLine = null;
    },
    point(x, y) {
      if (!currentLine || !Number.isFinite(x) || !Number.isFinite(y)) return;
      const point = [x, y];
      if (!currentLine.points.length || !samePoint(currentLine.points.at(-1), point)) currentLine.points.push(point);
    },
  };

  try {
    geoStream(geometry, projection.stream(sink));
  } catch {
    return null;
  }
  return lines;
}

function formatNumber(value, decimalPlaces) {
  const rounded = Number(value.toFixed(decimalPlaces));
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function buildDisplayResult(lines, {
  tolerancePx,
  minRingSpanPx,
  zoomScale,
}) {
  const toleranceSquared = (tolerancePx / zoomScale) ** 2;
  const decimalPlaces = Math.max(0, Math.min(15, Math.ceil(Math.log10(zoomScale * 100))));
  const polylines = [];

  for (const line of lines) {
    let points = line.points;
    if (line.closed) {
      const unique = points.slice(0, samePoint(points[0], points.at(-1)) ? -1 : undefined);
      if (unique.length < 3) continue;

      let minX = Infinity;
      let maxX = -Infinity;
      let minY = Infinity;
      let maxY = -Infinity;
      for (const [x, y] of unique) {
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
      if (Math.max(maxX - minX, maxY - minY) * zoomScale <= minRingSpanPx) continue;
      points = simplifyClosedRing(points, toleranceSquared);
    } else {
      points = simplifyOpenLine(points, toleranceSquared);
    }

    if (points.length < (line.closed ? 4 : 2)) continue;
    const frozenPoints = Object.freeze(points.map((point) => Object.freeze([...point])));
    polylines.push(Object.freeze({ points: frozenPoints, closed: line.closed }));
  }

  const svgPath = polylines.map(({ points, closed }) => {
    const [first, ...rest] = points;
    return `M${formatNumber(first[0], decimalPlaces)},${formatNumber(first[1], decimalPlaces)}`
      + rest.map(([x, y]) => `L${formatNumber(x, decimalPlaces)},${formatNumber(y, decimalPlaces)}`).join("")
      + (closed ? "Z" : "");
  }).join("");

  const frozenLines = Object.freeze(polylines);
  return Object.freeze({
    polylines: frozenLines,
    svgPath,
    trace(context) {
      if (!context) return false;
      context.beginPath?.();
      for (const { points, closed } of frozenLines) {
        context.moveTo?.(points[0][0], points[0][1]);
        for (let index = 1; index < points.length; index += 1) {
          context.lineTo?.(points[index][0], points[index][1]);
        }
        if (closed) context.closePath?.();
      }
      return frozenLines.length > 0;
    },
  });
}

/**
 * Builds reusable display-only marine outlines from D3's projected/clipped
 * stream. Feature geometry remains the source of truth for fill and hit tests.
 *
 * The returned `get(featureOrGeometry, projection, k)` accepts a GeoJSON
 * Feature or geometry and returns `svgPath`, full-precision `polylines`, and
 * `trace(context)` for canvas paths. `trace` begins a path and returns whether
 * it contains any drawable lines; callers choose stroke/fill behavior. Use
 * `clear()` when the source topology changes without replacing geometry objects.
 */
export function createWaterHighlightDisplay({
  geoStream = null,
  maxEntries = 32,
  maxCacheBytes = 8 * 1024 * 1024,
  tolerancePx = 0.42,
  minRingSpanPx = 0.85,
  zoomBucketSteps = 4,
} = {}) {
  const cache = new Map();
  const objectIds = new WeakMap();
  let nextObjectId = 1;
  let cacheBytes = 0;
  const safeMaxEntries = Math.max(1, Math.floor(Number(maxEntries) || 32));
  const safeMaxCacheBytes = Math.max(1, Number(maxCacheBytes) || 8 * 1024 * 1024);
  const safeTolerance = Math.max(0, Number(tolerancePx) || 0);
  const safeMinRingSpan = Math.max(0, Number(minRingSpanPx) || 0);
  const safeZoomSteps = Math.max(1, Math.floor(Number(zoomBucketSteps) || 4));

  function objectId(value) {
    if ((typeof value !== "object" && typeof value !== "function") || value === null) return "none";
    let id = objectIds.get(value);
    if (!id) {
      id = nextObjectId++;
      objectIds.set(value, id);
    }
    return id;
  }

  function get(featureOrGeometry, projection, k = 1) {
    const geometry = featureOrGeometry?.type === "Feature"
      ? featureOrGeometry.geometry
      : featureOrGeometry?.geometry?.type
        ? featureOrGeometry.geometry
        : featureOrGeometry;
    if (!geometry || !projection) return null;

    const currentGeoStream = geoStream || globalThis.d3?.geoStream;
    if (typeof currentGeoStream !== "function") return null;
    const numericZoom = Number(k);
    const zoom = Number.isFinite(numericZoom) && numericZoom > 0 ? numericZoom : 1;
    // Ceiling makes the representative scale at least as large as the actual
    // scale, keeping simplification error within the screen-space tolerance.
    const zoomBucket = Math.ceil(Math.log2(zoom) * safeZoomSteps);
    const bucketScale = 2 ** (zoomBucket / safeZoomSteps);
    const key = [
      objectId(geometry),
      objectId(projection),
      objectId(currentGeoStream),
      snapshotProjection(projection),
      zoomBucket,
      safeTolerance,
      safeMinRingSpan,
    ].join("|");

    if (cache.has(key)) {
      const cached = cache.get(key);
      cache.delete(key);
      cache.set(key, cached);
      return cached.result;
    }

    const projectedLines = createProjectedLines(geometry, projection, currentGeoStream);
    if (!projectedLines) return null;
    const result = buildDisplayResult(projectedLines, {
      tolerancePx: safeTolerance,
      minRingSpanPx: safeMinRingSpan,
      zoomScale: bucketScale,
    });
    const pointCount = result.polylines.reduce((count, line) => count + line.points.length, 0);
    // Count retained coordinate arrays as well as their serialized path. This
    // is a conservative cache budget estimate, not a browser heap measurement.
    const resultBytes = result.svgPath.length * 2 + pointCount * 48 + result.polylines.length * 64;
    if (resultBytes <= safeMaxCacheBytes) {
      cache.set(key, { result, bytes: resultBytes });
      cacheBytes += resultBytes;
      while (cache.size > safeMaxEntries || cacheBytes > safeMaxCacheBytes) {
        const oldestKey = cache.keys().next().value;
        const oldest = cache.get(oldestKey);
        cache.delete(oldestKey);
        cacheBytes -= oldest?.bytes || 0;
      }
    }
    return result;
  }

  function clear() {
    cache.clear();
    cacheBytes = 0;
  }

  function getCacheSize() {
    return cache.size;
  }

  function getCacheBytes() {
    return cacheBytes;
  }

  return Object.freeze({ get, clear, getCacheSize, getCacheBytes });
}
