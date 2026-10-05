const MAX_GRID_SIZE = 48;
const DEFAULT_MAX_CANDIDATES = 16;
const MAX_POLYGONS = 3;
const MAX_SEEDS_PER_POLYGON = 12;
const MAX_CANDIDATES_PER_POLYGON = 32;
const MAX_FIT_CANDIDATES = 20;
const DEFAULT_MAX_GRID_SIZE = 32;
const MAX_GLYPH_ANGLE = 30 * Math.PI / 180;
const TAU = Math.PI * 2;

function finiteNumber(value, fallback = 0) {
  return Number.isFinite(Number(value)) ? Number(value) : fallback;
}

function isPosition(value) {
  return Array.isArray(value) && typeof value[0] === "number" && typeof value[1] === "number" && Number.isFinite(value[0]) && Number.isFinite(value[1]);
}

function normalizeMultiPolygon(coordinates) {
  if (!Array.isArray(coordinates) || coordinates.length === 0) return [];
  if (isPosition(coordinates[0]?.[0])) return [coordinates];
  return coordinates;
}

export function filterCountryLabelHoles(polygons, minHoleArea = 0) {
  const normalized = normalizeMultiPolygon(polygons);
  const threshold = Math.max(0, finiteNumber(minHoleArea));
  if (!threshold) return normalized;
  return normalized.map((polygon) => [polygon[0], ...polygon.slice(1).filter((ring) => {
    let twiceArea = 0;
    for (let index = 0, prior = ring.length - 1; index < ring.length; prior = index++) {
      if (!isPosition(ring[index]) || !isPosition(ring[prior])) return true;
      twiceArea += ring[prior][0] * ring[index][1] - ring[index][0] * ring[prior][1];
    }
    return Math.abs(twiceArea) / 2 >= threshold;
  })]);
}

function preparePolygon(ringsInput, polygonIndex) {
  if (!Array.isArray(ringsInput) || ringsInput.length === 0) return null;
  const rings = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let vertexCount = 0;
  let polygonArea = 0;
  let centerWeightX = 0;
  let centerWeightY = 0;

  for (const inputRing of ringsInput) {
    if (!Array.isArray(inputRing) || inputRing.length < 3) continue;
    const ring = [];
    for (const point of inputRing) {
      if (!isPosition(point)) continue;
      const x = Number(point[0]);
      const y = Number(point[1]);
      if (ring.length && ring[ring.length - 1].x === x && ring[ring.length - 1].y === y) continue;
      ring.push({ x, y });
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    if (ring.length > 1 && ring[0].x === ring[ring.length - 1].x && ring[0].y === ring[ring.length - 1].y) ring.pop();
    if (ring.length >= 3) {
      rings.push(ring);
      vertexCount += ring.length;
      let twiceArea = 0;
      let momentX = 0;
      let momentY = 0;
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const cross = ring[j].x * ring[i].y - ring[i].x * ring[j].y;
        twiceArea += cross;
        momentX += (ring[j].x + ring[i].x) * cross;
        momentY += (ring[j].y + ring[i].y) * cross;
      }
      const ringArea = Math.abs(twiceArea) / 2;
      const weight = rings.length === 1 ? ringArea : -ringArea;
      polygonArea += weight;
      if (Math.abs(twiceArea) > 1e-12) {
        centerWeightX += weight * momentX / (3 * twiceArea);
        centerWeightY += weight * momentY / (3 * twiceArea);
      }
    }
  }

  if (!rings.length || !(maxX > minX) || !(maxY > minY)) return null;
  return { polygonIndex, rings, minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, vertexCount, area: Math.max(0, polygonArea),
    centerX: polygonArea > 1e-12 ? centerWeightX / polygonArea : (minX + maxX) / 2,
    centerY: polygonArea > 1e-12 ? centerWeightY / polygonArea : (minY + maxY) / 2 };
}

function pointInRings(x, y, rings) {
  let inside = false;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j];
      const b = ring[i];
      if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
    }
  }
  return inside;
}

function isAxisAlignedRectangle(component) {
  if (component.rings.length !== 1 || component.rings[0].length !== 4) return false;
  const { minX, minY, maxX, maxY } = component;
  const expected = new Set([
    `${minX},${minY}`, `${minX},${maxY}`, `${maxX},${minY}`, `${maxX},${maxY}`,
  ]);
  return component.rings[0].every((point) => expected.has(`${point.x},${point.y}`));
}

function pathLength(points) {
  let length = 0;
  for (let i = 1; i < points.length; i += 1) length += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  return length;
}

function makeCandidate(component, points, kind, metadata = {}) {
  if (!Array.isArray(points) || points.length < 2) return null;
  const length = pathLength(points);
  if (!(length > 0) || !Number.isFinite(length)) return null;
  return {
    polygonIndex: component.polygonIndex,
    kind,
    points,
    length,
    clearance: Math.max(0, finiteNumber(metadata.clearance)),
    angle: finiteNumber(metadata.angle),
    curvature: finiteNumber(metadata.curvature),
  };
}

function rasterComponent(component, maxGridSize) {
  const maxDimension = Math.max(component.width, component.height);
  const nx = Math.max(3, Math.min(maxGridSize, Math.ceil((component.width / maxDimension) * maxGridSize)));
  const ny = Math.max(3, Math.min(maxGridSize, Math.ceil((component.height / maxDimension) * maxGridSize)));
  const cellX = component.width / nx;
  const cellY = component.height / ny;
  const inside = new Uint8Array(nx * ny);

  // Scanline filling keeps work linear in the bounded raster plus a capped boundary sample.
  const totalVertices = component.vertexCount;
  const boundaryBudget = 1600;
  const stride = Math.max(1, Math.ceil(totalVertices / boundaryBudget));
  const maskRings = component.rings.map((ring) => {
    if (stride === 1 || ring.length <= 3) return ring;
    const sampled = ring.filter((_, index) => index % stride === 0);
    return sampled.length >= 3 ? sampled : ring;
  });

  for (let row = 0; row < ny; row += 1) {
    const y = component.minY + (row + 0.5) * cellY;
    const crossings = [];
    for (const ring of maskRings) {
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[j];
        const b = ring[i];
        if ((a.y > y) !== (b.y > y)) crossings.push(a.x + ((y - a.y) * (b.x - a.x)) / (b.y - a.y));
      }
    }
    crossings.sort((a, b) => a - b);
    let crossingIndex = 0;
    let isInside = false;
    for (let column = 0; column < nx; column += 1) {
      const x = component.minX + (column + 0.5) * cellX;
      while (crossingIndex < crossings.length && crossings[crossingIndex] <= x) {
        isInside = !isInside;
        crossingIndex += 1;
      }
      if (isInside) inside[row * nx + column] = 1;
    }
  }

  // A two-pass chamfer distance field provides a bounded medial-ridge score.
  const distance = new Float32Array(nx * ny);
  distance.fill(Infinity);
  const diagonal = Math.SQRT2;
  for (let row = 0; row < ny; row += 1) {
    for (let column = 0; column < nx; column += 1) {
      const index = row * nx + column;
      if (!inside[index]) continue;
      let boundary = false;
      for (let dy = -1; dy <= 1 && !boundary; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) {
          if (!dx && !dy) continue;
          const x = column + dx;
          const y = row + dy;
          if (x < 0 || y < 0 || x >= nx || y >= ny || !inside[y * nx + x]) {
            boundary = true;
            break;
          }
        }
      }
      if (boundary) distance[index] = 0;
    }
  }
  for (let row = 0; row < ny; row += 1) {
    for (let column = 0; column < nx; column += 1) {
      const index = row * nx + column;
      if (!inside[index]) continue;
      if (column > 0) distance[index] = Math.min(distance[index], distance[index - 1] + cellX);
      if (row > 0) distance[index] = Math.min(distance[index], distance[index - nx] + cellY);
      if (column > 0 && row > 0) distance[index] = Math.min(distance[index], distance[index - nx - 1] + Math.hypot(cellX, cellY));
      if (column + 1 < nx && row > 0) distance[index] = Math.min(distance[index], distance[index - nx + 1] + Math.hypot(cellX, cellY));
    }
  }
  for (let row = ny - 1; row >= 0; row -= 1) {
    for (let column = nx - 1; column >= 0; column -= 1) {
      const index = row * nx + column;
      if (!inside[index]) continue;
      if (column + 1 < nx) distance[index] = Math.min(distance[index], distance[index + 1] + cellX);
      if (row + 1 < ny) distance[index] = Math.min(distance[index], distance[index + nx] + cellY);
      if (column + 1 < nx && row + 1 < ny) distance[index] = Math.min(distance[index], distance[index + nx + 1] + Math.hypot(cellX, cellY));
      if (column > 0 && row + 1 < ny) distance[index] = Math.min(distance[index], distance[index + nx - 1] + Math.hypot(cellX, cellY));
    }
  }
  return { nx, ny, cellX, cellY, inside, distance };
}

function gridCell(grid, component, x, y) {
  const column = Math.floor((x - component.minX) / grid.cellX);
  const row = Math.floor((y - component.minY) / grid.cellY);
  if (column < 0 || row < 0 || column >= grid.nx || row >= grid.ny) return -1;
  const index = row * grid.nx + column;
  return grid.inside[index] ? index : -1;
}

function traceGridPath(component, grid, seed, angle, curvature = 0) {
  const maxDimension = Math.max(component.width, component.height);
  const span = Math.hypot(component.width, component.height);
  const step = Math.max(maxDimension / 96, Math.min(grid.cellX, grid.cellY) * 0.35);
  const maxSteps = Math.min(160, Math.ceil((span / 2) / step));
  const circleCurvature = curvature / span;
  const getPoint = (offset) => {
    if (Math.abs(circleCurvature) < 1e-10) {
      return { x: seed.x + Math.cos(angle) * offset, y: seed.y + Math.sin(angle) * offset };
    }
    const tangent = angle + circleCurvature * offset;
    return {
      x: seed.x + (Math.sin(tangent) - Math.sin(angle)) / circleCurvature,
      y: seed.y - (Math.cos(tangent) - Math.cos(angle)) / circleCurvature,
    };
  };
  const negative = [];
  const positive = [];
  negative.push(getPoint(0));
  positive.push(getPoint(0));
  for (let n = 1; n <= maxSteps; n += 1) {
    const point = getPoint(-n * step);
    if (gridCell(grid, component, point.x, point.y) < 0) break;
    negative.push(point);
  }
  for (let n = 1; n <= maxSteps; n += 1) {
    const point = getPoint(n * step);
    if (gridCell(grid, component, point.x, point.y) < 0) break;
    positive.push(point);
  }
  negative.reverse();
  const points = negative.concat(positive.slice(1));
  if (points.length < 2) return null;
  const mid = gridCell(grid, component, seed.x, seed.y);
  const clearance = mid >= 0 ? grid.distance[mid] : 0;
  const kind = curvature ? "arc" : (Math.abs(angle) < 1e-9 ? "horizontal" : "tilted");
  return makeCandidate(component, points, kind, { clearance, angle, curvature });
}

function rectangleCandidates(component, options) {
  const { minX, minY, maxX, maxY, width, height } = component;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const candidates = [];
  const count = 32;
  const baseClearance = Math.min(width, height) / 2;
  for (const offset of [0, -0.16 * height, 0.16 * height, -0.3 * height, 0.3 * height]) {
    const y = centerY + offset;
    candidates.push(makeCandidate(component, [{ x: minX, y }, { x: maxX, y }], "horizontal", {
      clearance: Math.min(width / 2, y - minY, maxY - y),
    }));
  }
  const degreesList = Math.max(width, height) / Math.min(width, height) >= 2.5
    ? [-15, 15, -30, 30] : [-15, 15];
  for (const degrees of degreesList) {
    const radians = degrees * Math.PI / 180;
    const half = Math.min(
      Math.abs(Math.cos(radians)) < 1e-8 ? Infinity : (width / 2) / Math.abs(Math.cos(radians)),
      Math.abs(Math.sin(radians)) < 1e-8 ? Infinity : (height / 2) / Math.abs(Math.sin(radians)),
    );
    const safeHalf = Number.isFinite(half) ? half : width / 2;
    candidates.push(makeCandidate(component, [
      { x: centerX - Math.cos(radians) * safeHalf, y: centerY - Math.sin(radians) * safeHalf },
      { x: centerX + Math.cos(radians) * safeHalf, y: centerY + Math.sin(radians) * safeHalf },
    ], "tilted", { clearance: baseClearance, angle: radians }));
  }
  for (const sign of options.allowArcs ? [-1, 1] : []) {
    const points = [];
    for (let index = 0; index <= count; index += 1) {
      const distance = -width / 2 + (width * index) / count;
      const curvature = sign * 0.24 / width;
      points.push({
        x: centerX + Math.sin(curvature * distance) / curvature,
        y: centerY - (Math.cos(curvature * distance) - 1) / curvature,
      });
    }
    candidates.push(makeCandidate(component, points, "arc", { clearance: baseClearance, curvature: sign * 0.24 }));
  }
  const valid = candidates.filter(Boolean);
  return options.allowArcs ? [valid[0], ...valid.filter((candidate) => candidate.kind === "arc"),
    ...valid.slice(1).filter((candidate) => candidate.kind !== "arc")] : valid;
}

function generateComponentCandidates(component, options) {
  if (isAxisAlignedRectangle(component)) return rectangleCandidates(component, options);
  const grid = rasterComponent(component, options.maxGridSize);
  const seedCandidates = [];
  for (let row = 0; row < grid.ny; row += 1) {
    let best = -1;
    for (let column = 0; column < grid.nx; column += 1) {
      const index = row * grid.nx + column;
      if (grid.inside[index] && (best < 0 || grid.distance[index] > grid.distance[best])) best = index;
    }
    if (best >= 0 && row % Math.max(1, Math.floor(grid.ny / 18)) === 0) {
      const column = best % grid.nx;
      seedCandidates.push({ x: component.minX + (column + 0.5) * grid.cellX, y: component.minY + (row + 0.5) * grid.cellY, clearance: grid.distance[best], index: best });
    }
  }
  for (let column = 0; column < grid.nx; column += 1) {
    let best = -1;
    for (let row = 0; row < grid.ny; row += 1) {
      const index = row * grid.nx + column;
      if (grid.inside[index] && (best < 0 || grid.distance[index] > grid.distance[best])) best = index;
    }
    if (best >= 0 && column % Math.max(1, Math.floor(grid.nx / 18)) === 0) {
      const row = Math.floor(best / grid.nx);
      seedCandidates.push({ x: component.minX + (column + 0.5) * grid.cellX, y: component.minY + (row + 0.5) * grid.cellY, clearance: grid.distance[best], index: best });
    }
  }
  const ranked = [];
  for (let index = 0; index < grid.inside.length; index += 1) {
    if (grid.inside[index]) ranked.push(index);
  }
  ranked.sort((a, b) => grid.distance[b] - grid.distance[a] || a - b);
  for (const index of ranked.slice(0, 16)) {
    const column = index % grid.nx;
    const row = Math.floor(index / grid.nx);
    seedCandidates.push({ x: component.minX + (column + 0.5) * grid.cellX, y: component.minY + (row + 0.5) * grid.cellY, clearance: grid.distance[index], index });
  }
  const minSeparation = Math.max(grid.cellX, grid.cellY) * 1.4;
  const seeds = [];
  const uniqueSeeds = [];
  for (const seed of seedCandidates) {
    if (uniqueSeeds.every((other) => Math.hypot(other.x - seed.x, other.y - seed.y) >= minSeparation * 0.35)) uniqueSeeds.push(seed);
  }
  while (seeds.length < MAX_SEEDS_PER_POLYGON && uniqueSeeds.length) {
    let bestIndex = 0;
    let bestScore = -Infinity;
    for (let index = 0; index < uniqueSeeds.length; index += 1) {
      const seed = uniqueSeeds[index];
      const nearest = seeds.length ? Math.min(...seeds.map((other) => Math.hypot(other.x - seed.x, other.y - seed.y))) : 0;
      const score = seed.clearance + nearest * 0.18;
      if (score > bestScore) {
        bestScore = score;
        bestIndex = index;
      }
    }
    const [seed] = uniqueSeeds.splice(bestIndex, 1);
    if (seeds.every((other) => Math.hypot(other.x - seed.x, other.y - seed.y) >= minSeparation)) seeds.push(seed);
  }

  let meanX = 0;
  let meanY = 0;
  let insideCount = 0;
  for (let index = 0; index < grid.inside.length; index += 1) {
    if (!grid.inside[index]) continue;
    const column = index % grid.nx;
    const row = Math.floor(index / grid.nx);
    meanX += component.minX + (column + 0.5) * grid.cellX;
    meanY += component.minY + (row + 0.5) * grid.cellY;
    insideCount += 1;
  }
  meanX /= Math.max(1, insideCount);
  meanY /= Math.max(1, insideCount);
  let covarianceXX = 0;
  let covarianceYY = 0;
  let covarianceXY = 0;
  for (let index = 0; index < grid.inside.length; index += 1) {
    if (!grid.inside[index]) continue;
    const column = index % grid.nx;
    const row = Math.floor(index / grid.nx);
    const dx = component.minX + (column + 0.5) * grid.cellX - meanX;
    const dy = component.minY + (row + 0.5) * grid.cellY - meanY;
    covarianceXX += dx * dx;
    covarianceYY += dy * dy;
    covarianceXY += dx * dy;
  }
  const principalAxis = 0.5 * Math.atan2(2 * covarianceXY, covarianceXX - covarianceYY);
  const covarianceTrace = covarianceXX + covarianceYY;
  const covarianceSpan = Math.hypot(covarianceXX - covarianceYY, 2 * covarianceXY);
  const elongated = covarianceTrace + covarianceSpan >= 6.25 * Math.max(1e-8, covarianceTrace - covarianceSpan);
  const orientationDegrees = new Set([0, -15, 15]);
  if (elongated) {
    orientationDegrees.add(-30);
    orientationDegrees.add(30);
    const degrees = Math.max(-30, Math.min(30, Math.round(principalAxis * 180 / Math.PI)));
    orientationDegrees.add(degrees);
  }

  const generated = [];
  for (const seed of seeds) {
    for (const degrees of orientationDegrees) {
      const candidate = traceGridPath(component, grid, seed, degrees * Math.PI / 180, 0);
      if (candidate) generated.push(candidate);
    }
    for (const degrees of options.allowArcs ? new Set([0, principalAxis * 180 / Math.PI]) : []) {
      // Preserve the glyph-angle budget for a gentle bend, rather than
      // spending it on the baseline's principal-axis tilt.
      const clampedDegrees = Math.max(-3, Math.min(3, degrees));
      for (const curvature of [-0.24, 0.24]) {
        const candidate = traceGridPath(component, grid, seed, clampedDegrees * Math.PI / 180, curvature);
        if (candidate) generated.push(candidate);
      }
    }
  }

  const unique = new Map();
  for (const candidate of generated) {
    const first = candidate.points[0];
    const middle = candidate.points[Math.floor(candidate.points.length / 2)];
    const last = candidate.points[candidate.points.length - 1];
    const key = `${candidate.kind}:${Math.round(first.x / grid.cellX)}:${Math.round(first.y / grid.cellY)}:${Math.round(middle.x / grid.cellX)}:${Math.round(middle.y / grid.cellY)}:${Math.round(last.x / grid.cellX)}:${Math.round(last.y / grid.cellY)}`;
    const prior = unique.get(key);
    if (!prior || candidate.length > prior.length) unique.set(key, candidate);
  }
  const rankedCandidates = [...unique.values()].sort((a, b) => {
    const maxDimension = Math.max(component.width, component.height);
    const score = (candidate) => {
      const center = candidate.points[Math.floor(candidate.points.length / 2)];
      const distance = Math.hypot((center.x - component.centerX) / component.width, (center.y - component.centerY) / component.height);
      return candidate.length * (0.7 + 0.3 * candidate.clearance / maxDimension) * (1 - Math.min(0.25, distance * 0.2));
    };
    return score(b) - score(a);
  });
  const buckets = new Map();
  for (const candidate of rankedCandidates) {
    const angleBand = Math.round((candidate.angle * 180 / Math.PI) / 15) * 15;
    const key = candidate.kind === "horizontal" ? "horizontal" : candidate.kind === "arc"
      ? `arc:${Math.sign(candidate.curvature)}` : `${candidate.kind}:${angleBand}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(candidate);
  }
  const horizontalPositions = [];
  const nearbyPositions = [];
  const positionSeparation = Math.min(component.width, component.height) * 0.12;
  for (const candidate of buckets.get("horizontal") || []) {
    const center = candidate.points[Math.floor(candidate.points.length / 2)];
    const distinct = horizontalPositions.every((prior) => {
      const other = prior.points[Math.floor(prior.points.length / 2)];
      return Math.hypot(center.x - other.x, center.y - other.y) >= positionSeparation;
    });
    (distinct ? horizontalPositions : nearbyPositions).push(candidate);
  }
  buckets.set("horizontal", [...horizontalPositions, ...nearbyPositions]);
  // Reserve several different horizontal positions before spending the bounded
  // budget on orientations. Angle diversity alone cannot recover a collision.
  const orderedKeys = options.allowArcs
    ? ["horizontal", "arc:-1", "arc:1", "horizontal", "horizontal", "tilted:-15", "tilted:15", "horizontal", "tilted:-30", "tilted:30", "tilted:0"]
    : ["horizontal", "horizontal", "horizontal", "tilted:-15", "horizontal", "tilted:15", "horizontal", "tilted:-30", "tilted:30", "tilted:0"];
  const selected = [];
  const cursors = new Map();
  while (selected.length < MAX_CANDIDATES_PER_POLYGON) {
    let added = false;
    for (const key of orderedKeys) {
      const group = buckets.get(key);
      const rank = cursors.get(key) || 0;
      if (group && rank < group.length) {
        selected.push(group[rank]);
        cursors.set(key, rank + 1);
        added = true;
        if (selected.length >= MAX_CANDIDATES_PER_POLYGON) break;
      }
    }
    if (!added) break;
  }
  return selected;
}

function interleavePolygonCandidates(groups, limit) {
  const result = [];
  let rank = 0;
  while (result.length < limit) {
    let added = false;
    for (const group of groups) {
      if (rank < group.length) {
        result.push(group[rank]);
        added = true;
        if (result.length >= limit) break;
      }
    }
    if (!added) break;
    rank += 1;
  }
  return result;
}

export function buildCountryLabelCandidates(polygons, options = {}) {
  const maxCandidates = Math.max(1, Math.min(128, Math.floor(finiteNumber(options.maxCandidates, DEFAULT_MAX_CANDIDATES))));
  const maxGridSize = Math.max(12, Math.min(MAX_GRID_SIZE, Math.floor(finiteNumber(options.maxGridSize, DEFAULT_MAX_GRID_SIZE))));
  const rankedComponents = filterCountryLabelHoles(polygons, options.minHoleArea)
    .map((polygon, index) => preparePolygon(polygon, index))
    .filter(Boolean)
    .sort((a, b) => b.area - a.area || b.width * b.height - a.width * a.height);
  const largestArea = rankedComponents[0]?.area || 0;
  const components = rankedComponents
    .filter((component, index) => index === 0 || (largestArea > 0 && component.area >= largestArea * 0.03))
    .slice(0, MAX_POLYGONS);
  const groups = components.map((component) => generateComponentCandidates(component, { maxGridSize, allowArcs: options.allowArcs === true }));
  const candidates = interleavePolygonCandidates(groups, maxCandidates);
  return candidates.map((candidate, candidateIndex) => ({ ...candidate, candidateIndex }));
}

function buildSegmentIndex(component, indexSize = 24) {
  const segments = [];
  const rows = Array.from({ length: indexSize }, () => []);
  const cells = Array.from({ length: indexSize * indexSize }, () => []);
  const { minX, minY, width, height } = component;
  for (let ringIndex = 0; ringIndex < component.rings.length; ringIndex += 1) {
    const ring = component.rings[ringIndex];
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[j];
      const b = ring[i];
      const segment = {
        a, b, ringIndex,
        minX: Math.min(a.x, b.x), maxX: Math.max(a.x, b.x),
        minY: Math.min(a.y, b.y), maxY: Math.max(a.y, b.y),
      };
      const id = segments.length;
      segments.push(segment);
      const rowStart = Math.max(0, Math.min(indexSize - 1, Math.floor(((segment.minY - minY) / height) * indexSize)));
      const rowEnd = Math.max(0, Math.min(indexSize - 1, Math.floor(((segment.maxY - minY) / height) * indexSize)));
      for (let row = rowStart; row <= rowEnd; row += 1) rows[row].push(id);
      const colStart = Math.max(0, Math.min(indexSize - 1, Math.floor(((segment.minX - minX) / width) * indexSize)));
      const colEnd = Math.max(0, Math.min(indexSize - 1, Math.floor(((segment.maxX - minX) / width) * indexSize)));
      for (let row = rowStart; row <= rowEnd; row += 1) {
        for (let column = colStart; column <= colEnd; column += 1) cells[row * indexSize + column].push(id);
      }
    }
  }
  return { ...component, segments, rows, cells, indexSize, boundaryRows: [] };
}

function pointOnSegment(point, a, b, epsilon) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared ? Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)) : 0;
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy)) <= epsilon;
}

function pointInIndexedRegion(x, y, component, epsilon) {
  if (x <= component.minX || x >= component.maxX || y <= component.minY || y >= component.maxY) return false;
  const row = Math.max(0, Math.min(component.indexSize - 1, Math.floor(((y - component.minY) / component.height) * component.indexSize)));
  let boundaryIds = component.boundaryRows[row];
  if (!boundaryIds) {
    const ids = new Set();
    for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
      const bucket = component.rows[row + rowOffset];
      if (bucket) for (const id of bucket) ids.add(id);
    }
    // This component's index is immutable for the fit. Reuse the same ordered
    // boundary candidates across glyph corners and font-size probes.
    boundaryIds = component.boundaryRows[row] = [...ids];
  }
  for (const id of boundaryIds) {
    const segment = component.segments[id];
    if (x >= segment.minX - epsilon && x <= segment.maxX + epsilon && y >= segment.minY - epsilon && y <= segment.maxY + epsilon && pointOnSegment({ x, y }, segment.a, segment.b, epsilon)) return false;
  }

  let inside = false;
  for (const id of component.rows[row]) {
    const segment = component.segments[id];
    const { a, b } = segment;
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function segmentIntersectsBox(segment, origin, angle, minX, maxX, minY, maxY, epsilon) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const toLocal = (point) => {
    const dx = point.x - origin.x;
    const dy = point.y - origin.y;
    return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
  };
  const a = toLocal(segment.a);
  const b = toLocal(segment.b);
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const clips = [
    [-dx, a.x - (minX - epsilon)], [dx, (maxX + epsilon) - a.x],
    [-dy, a.y - (minY - epsilon)], [dy, (maxY + epsilon) - a.y],
  ];
  for (const [p, q] of clips) {
    if (Math.abs(p) < 1e-14) {
      if (q < 0) return false;
      continue;
    }
    const t = q / p;
    if (p < 0) t0 = Math.max(t0, t);
    else t1 = Math.min(t1, t);
    if (t0 > t1) return false;
  }
  return true;
}

function glyphMetric(glyph) {
  const advance = Math.max(0, finiteNumber(glyph?.advance, finiteNumber(glyph?.width, 0)));
  const left = Math.max(0, finiteNumber(glyph?.left, 0));
  const right = Math.max(0, finiteNumber(glyph?.right, advance));
  const ascent = Math.max(0, finiteNumber(glyph?.ascent, 0.72));
  const descent = Math.max(0, finiteNumber(glyph?.descent, 0.22));
  return { text: String(glyph?.text ?? ""), advance, left, right, ascent, descent };
}

function pathPointAt(candidate, targetDistance) {
  let traversed = 0;
  for (let index = 1; index < candidate.points.length; index += 1) {
    const a = candidate.points[index - 1];
    const b = candidate.points[index];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const length = Math.hypot(dx, dy);
    if (targetDistance <= traversed + length || index === candidate.points.length - 1) {
      const ratio = length ? Math.max(0, Math.min(1, (targetDistance - traversed) / length)) : 0;
      return { x: a.x + dx * ratio, y: a.y + dy * ratio, angle: Math.atan2(dy, dx) };
    }
    traversed += length;
  }
  const last = candidate.points[candidate.points.length - 1];
  const prior = candidate.points[candidate.points.length - 2] || last;
  return { x: last.x, y: last.y, angle: Math.atan2(last.y - prior.y, last.x - prior.x) };
}

function envelopeInside(component, origin, angle, minX, maxX, minY, maxY, epsilon) {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const corners = [
    [minX, minY], [maxX, minY], [maxX, maxY], [minX, maxY],
  ].map(([x, y]) => ({ x: origin.x + x * cos - y * sin, y: origin.y + x * sin + y * cos }));
  const worldMinX = Math.min(...corners.map((point) => point.x));
  const worldMaxX = Math.max(...corners.map((point) => point.x));
  const worldMinY = Math.min(...corners.map((point) => point.y));
  const worldMaxY = Math.max(...corners.map((point) => point.y));
  if (worldMinX <= component.minX || worldMaxX >= component.maxX || worldMinY <= component.minY || worldMaxY >= component.maxY) return null;
  for (const corner of corners) {
    if (!pointInIndexedRegion(corner.x, corner.y, component, epsilon)) return null;
  }

  const indexSize = component.indexSize;
  const columnStart = Math.max(0, Math.min(indexSize - 1, Math.floor(((worldMinX - component.minX) / component.width) * indexSize)));
  const columnEnd = Math.max(0, Math.min(indexSize - 1, Math.floor(((worldMaxX - component.minX) / component.width) * indexSize)));
  const rowStart = Math.max(0, Math.min(indexSize - 1, Math.floor(((worldMinY - component.minY) / component.height) * indexSize)));
  const rowEnd = Math.max(0, Math.min(indexSize - 1, Math.floor(((worldMaxY - component.minY) / component.height) * indexSize)));
  const candidates = new Set();
  for (let row = rowStart; row <= rowEnd; row += 1) {
    for (let column = columnStart; column <= columnEnd; column += 1) {
      for (const id of component.cells[row * indexSize + column]) candidates.add(id);
    }
  }
  for (const id of candidates) {
    const segment = component.segments[id];
    if (segment.maxX < worldMinX - epsilon || segment.minX > worldMaxX + epsilon || segment.maxY < worldMinY - epsilon || segment.minY > worldMaxY + epsilon) continue;
    if (segmentIntersectsBox(segment, origin, angle, minX, maxX, minY, maxY, epsilon)) return null;
  }
  return corners;
}

function layoutAtSize(candidate, metrics, component, fontSize, tracking, glyphPadding, maxGlyphAngle, maxBendAngle, maxAdjacentAngle, offset = 0) {
  const logicalWidth = metrics.reduce((sum, glyph) => sum + glyph.advance * fontSize, 0) + Math.max(0, metrics.length - 1) * tracking * fontSize;
  if (logicalWidth > candidate.length + 1e-8) return null;
  const padding = glyphPadding * fontSize;
  let cursor = (candidate.length - logicalWidth) / 2 + offset;
  const glyphs = [];
  const angles = [];
  const allCorners = [];
  const epsilon = Math.max(component.width, component.height, 1) * 1e-10;
  for (const metric of metrics) {
    const origin = pathPointAt(candidate, cursor);
    if (!Number.isFinite(origin.angle) || Math.abs(origin.angle) > maxGlyphAngle + 1e-8) return null;
    if (!metric.text.trim()) {
      glyphs.push({ text: metric.text, x: origin.x, y: origin.y, angle: origin.angle,
        box: { x: origin.x, y: origin.y, w: 0, h: 0, corners: [] } });
      cursor += (metric.advance + tracking) * fontSize;
      continue;
    }
    const minX = -metric.left * fontSize - padding;
    const maxX = metric.right * fontSize + padding;
    const minY = -metric.ascent * fontSize - padding;
    const maxY = metric.descent * fontSize + padding;
    const corners = envelopeInside(component, origin, origin.angle, minX, maxX, minY, maxY, epsilon);
    if (!corners) return null;
    const boxMinX = Math.min(...corners.map((point) => point.x));
    const boxMinY = Math.min(...corners.map((point) => point.y));
    const boxMaxX = Math.max(...corners.map((point) => point.x));
    const boxMaxY = Math.max(...corners.map((point) => point.y));
    glyphs.push({
      text: metric.text,
      x: origin.x,
      y: origin.y,
      angle: origin.angle,
      width: metric.left * fontSize + metric.right * fontSize,
      height: (metric.ascent + metric.descent) * fontSize,
      box: {
        x: boxMinX,
        y: boxMinY,
        w: boxMaxX - boxMinX,
        h: boxMaxY - boxMinY,
        corners,
        padding,
        width: (metric.left + metric.right) * fontSize + padding * 2,
        height: (metric.ascent + metric.descent) * fontSize + padding * 2,
      },
    });
    angles.push(origin.angle);
    allCorners.push(...corners);
    cursor += (metric.advance + tracking) * fontSize;
  }
  if (angles.length && Math.max(...angles) - Math.min(...angles) > maxBendAngle + 1e-8) return null;
  for (let index = 1; index < angles.length; index += 1) {
    if (Math.abs(angles[index] - angles[index - 1]) > maxAdjacentAngle + 1e-8) return null;
  }
  if (!allCorners.length) return null;
  const bounds = {
    minX: Math.min(...allCorners.map((point) => point.x)),
    minY: Math.min(...allCorners.map((point) => point.y)),
    maxX: Math.max(...allCorners.map((point) => point.x)),
    maxY: Math.max(...allCorners.map((point) => point.y)),
  };
  return { glyphs, bounds, fontSize, angles };
}

function labelLine(metrics, start, end) {
  const line = metrics.slice(start, end);
  // Keep the source text, including separators, without expanding blank tails.
  for (let index = line.length - 1; index >= 0 && !line[index].text.trim(); index -= 1) {
    line[index] = { ...line[index], advance: 0 };
  }
  return line;
}

function twoLabelLines(metrics, tracking) {
  const text = metrics.map((metric) => metric.text).join("");
  let split = -1;
  if (/\p{Script=Han}/u.test(text) && metrics.length >= 6) {
    const suffix = ["无政府地区", "无政府地带", "专员辖区", "军事指挥部", "共和国", "合众国", "自治领", "联邦", "王国", "帝国"].find((suffix) => text.endsWith(suffix));
    const colonialPrefix = /^(意属|法属|英属|德属)/u.test(text);
    const suffixStart = suffix ? text.length - suffix.length : colonialPrefix ? 2 : -1;
    split = suffixStart >= 2 ? metrics.findIndex((_metric, index) => metrics.slice(0, index).map((metric) => metric.text).join("").length === suffixStart)
      : Math.floor(metrics.length / 2);
  } else if (!/\p{Script=Han}/u.test(text)) {
    let bestDifference = Infinity;
    for (let index = 1; index < metrics.length - 1; index += 1) {
      if (metrics[index].text.trim()) continue;
      const first = metrics.slice(0, index).reduce((sum, metric) => sum + metric.advance + tracking, 0);
      const second = metrics.slice(index + 1).reduce((sum, metric) => sum + metric.advance + tracking, 0);
      if (first > 0 && second > 0 && Math.abs(first - second) < bestDifference) {
        split = index + 1;
        bestDifference = Math.abs(first - second);
      }
    }
  }
  if (split <= 0 || split >= metrics.length) return null;
  return [labelLine(metrics, 0, split), labelLine(metrics, split, metrics.length)];
}

function threeEnglishLabelLines(metrics, tracking) {
  if (metrics.some((metric) => /\p{Script=Han}/u.test(metric.text))) return [];
  const prefix = [0];
  const trailingBlankAdvance = [0];
  const breaks = [];
  for (let index = 0; index < metrics.length; index += 1) {
    prefix.push(prefix[index] + metrics[index].advance + tracking);
    trailingBlankAdvance.push(metrics[index].text.trim() ? 0 : trailingBlankAdvance[index] + metrics[index].advance);
    if (index > 0 && !metrics[index].text.trim() && metrics[index + 1]?.text.trim()) breaks.push(index + 1);
  }
  if (breaks.length < 2) return [];
  const total = prefix.at(-1);
  const lineWidth = (start, end) => prefix[end] - prefix[start] - trailingBlankAdvance[end] - tracking;
  // Only three first-cut proposals, each with one balanced remaining cut.
  // This stays linear in text length rather than enumerating every word pair.
  const firstCuts = [];
  for (const candidate of breaks.slice(0, -1)) {
    firstCuts.push(candidate);
    firstCuts.sort((a, b) => Math.abs(prefix[a] - total / 3) - Math.abs(prefix[b] - total / 3) || a - b);
    firstCuts.length = Math.min(3, firstCuts.length);
  }
  return firstCuts.map((first) => {
    let second = -1;
    for (const candidate of breaks) {
      if (candidate <= first) continue;
      const width = Math.max(lineWidth(first, candidate), lineWidth(candidate, metrics.length));
      const previousWidth = second < 0 ? Infinity : Math.max(lineWidth(first, second), lineWidth(second, metrics.length));
      if (width < previousWidth) second = candidate;
    }
    return [labelLine(metrics, 0, first), labelLine(metrics, first, second), labelLine(metrics, second, metrics.length)];
  }).sort((a, b) => {
    const width = (lines) => Math.max(...lines.map((line) => line.reduce((sum, metric) => sum + metric.advance + tracking, 0)));
    return width(a) - width(b);
  });
}

function layoutLabelLines(candidate, lines, component, fontSize, tracking, glyphPadding, maxGlyphAngle, maxBendAngle, maxAdjacentAngle, allowPositionShift) {
  const maxWidth = Math.max(...lines.map((line) => line.reduce((sum, metric) => sum + metric.advance, 0) + Math.max(0, line.length - 1) * tracking)) * fontSize;
  const slack = Math.max(0, candidate.length - maxWidth);
  const lineInk = lines.map((line) => {
    const visible = line.filter((metric) => metric.text.trim());
    return { ascent: Math.max(0, ...visible.map((metric) => metric.ascent)),
      descent: Math.max(0, ...visible.map((metric) => metric.descent)) };
  });
  const spacing = Math.max(1.2, ...lineInk.map((ink) => ink.ascent + ink.descent + glyphPadding * 2 + 0.15)) * fontSize;
  const centers = lines.map((_line, index) => (index - (lines.length - 1) / 2) * spacing);
  const top = Math.min(...lineInk.map((ink, index) => centers[index] - (ink.ascent + ink.descent) * fontSize / 2));
  const bottom = Math.max(...lineInk.map((ink, index) => centers[index] + (ink.ascent + ink.descent) * fontSize / 2));
  const blockOffset = (top + bottom) / 2;
  const first = candidate.points[0];
  const last = candidate.points.at(-1);
  const angle = candidate.kind === "tilted" ? Math.atan2(last.y - first.y, last.x - first.x) : 0;
  const offsets = allowPositionShift && candidate.kind === "horizontal" ? [0, -0.2 * slack, 0.2 * slack] : [0];
  // Prefer optical centering, but retain the original baseline as a second
  // placement in irregular regions where shifting the ink crosses a boundary.
  const placements = (candidate.kind === "arc" ? [false] : [true, false])
    .flatMap((centered) => offsets.map((offset) => ({ centered, offset })));
  for (const { centered, offset } of placements) {
    const layouts = lines.map((line, index) => {
      // Candidates mark the visual center, not the alphabetic baseline. Center
      // each visible line and then the whole block; blank glyph metrics do not
      // affect its height. Tilted straight lines shift along their normal.
      const ink = lineInk[index];
      const baseline = centered ? centers[index] - blockOffset + (ink.ascent - ink.descent) * fontSize / 2 : centers[index];
      const path = baseline ? { ...candidate, points: candidate.points.map((point) => ({
        x: point.x - Math.sin(angle) * baseline, y: point.y + Math.cos(angle) * baseline,
      })) } : candidate;
      return layoutAtSize(path, line, component, fontSize, tracking, glyphPadding, maxGlyphAngle, maxBendAngle, maxAdjacentAngle, offset);
    });
    if (layouts.some((layout) => !layout)) continue;
    return { fontSize, lineCount: lines.length, glyphs: layouts.flatMap((layout) => layout.glyphs),
      angles: layouts.flatMap((layout) => layout.angles),
      bounds: {
        minX: Math.min(...layouts.map((layout) => layout.bounds.minX)), minY: Math.min(...layouts.map((layout) => layout.bounds.minY)),
        maxX: Math.max(...layouts.map((layout) => layout.bounds.maxX)), maxY: Math.max(...layouts.map((layout) => layout.bounds.maxY)),
      } };
  }
  return null;
}

function resultScore(candidate, layout, component, gentleArc = false) {
  const maxAngle = layout.angles.reduce((value, angle) => Math.max(value, Math.abs(angle)), 0);
  const bend = layout.angles.length ? Math.max(...layout.angles) - Math.min(...layout.angles) : 0;
  const anglePenalty = (gentleArc ? 0.06 : 0.28) * (maxAngle / MAX_GLYPH_ANGLE);
  const bendPenalty = (gentleArc ? 0.04 : 0.15) * (bend / (Math.PI / 3));
  const kindPenalty = candidate.kind === "horizontal" || gentleArc ? 0 : candidate.kind === "tilted" ? 0.12 : 0.2;
  const wrapPenalty = Math.max(0, layout.lineCount - 1) * 0.1;
  const centerX = (layout.bounds.minX + layout.bounds.maxX) / 2;
  const centerY = (layout.bounds.minY + layout.bounds.maxY) / 2;
  const centerDistance = Math.hypot((centerX - component.centerX) / (component.width / 2),
    (centerY - component.centerY) / (component.height / 2));
  const centerPenalty = Math.min(1, centerDistance) * 0.16;
  const margin = Math.min(layout.bounds.minX - component.minX, component.maxX - layout.bounds.maxX,
    layout.bounds.minY - component.minY, component.maxY - layout.bounds.maxY);
  const insetPenalty = 0.06 * (1 - Math.max(0, Math.min(1, margin / (layout.fontSize * 0.5))));
  const clearancePenalty = Number.isFinite(candidate.clearance)
    ? 0.04 * (1 - Math.max(0, Math.min(1, candidate.clearance / (layout.fontSize * 1.2)))) : 0;
  return layout.fontSize * (1 - anglePenalty - bendPenalty - kindPenalty - wrapPenalty - centerPenalty - insetPenalty - clearancePenalty
    + (gentleArc ? 0.06 : 0));
}

function layoutWithTracking(candidate, lines, component, fontSize, options) {
  const availableTracking = Math.min(...lines.map((line) => line.length > 1
    ? (candidate.length * 0.78 / fontSize - line.reduce((sum, glyph) => sum + glyph.advance, 0)) / (line.length - 1)
    : options.tracking));
  const tracking = Math.max(options.tracking, Math.min(options.maxTracking, availableTracking));
  for (const spacing of tracking > options.tracking + 1e-8 ? [tracking, options.tracking] : [options.tracking]) {
    const layout = layoutLabelLines(candidate, lines, component, fontSize, spacing, options.glyphPadding,
      options.maxGlyphAngle, options.maxBendAngle, options.maxAdjacentAngle, options.allowPositionShift);
    if (layout) return { ...layout, tracking: spacing };
  }
  return null;
}

export function fitCountryLabel(candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0 || !Array.isArray(options.glyphs) || options.glyphs.length === 0) return null;
  const minHoleArea = Math.max(0, finiteNumber(options.minHoleArea));
  const originalPolygons = normalizeMultiPolygon(options.polygons);
  const rawPolygons = filterCountryLabelHoles(originalPolygons, minHoleArea);
  if (!rawPolygons.length) return null;
  const metrics = options.glyphs.map(glyphMetric);
  const minFontSize = Math.max(0, finiteNumber(options.minFontSize, 1));
  const maxFontSize = Math.max(minFontSize, finiteNumber(options.maxFontSize, minFontSize));
  const tracking = finiteNumber(options.tracking, 0);
  const maxTracking = Math.max(tracking, Math.min(0.24, finiteNumber(options.maxTracking, tracking)));
  const glyphPadding = Math.max(0, finiteNumber(options.glyphPadding, 0));
  const maxGlyphAngle = Math.max(0, Math.min(MAX_GLYPH_ANGLE, finiteNumber(options.maxTiltDegrees, 30) * Math.PI / 180));
  const maxBendAngle = Math.max(0, Math.min(Math.PI / 3, finiteNumber(options.maxBendDegrees, 60) * Math.PI / 180));
  const maxAdjacentAngle = Math.max(0, Math.min(Math.PI / 3, finiteNumber(options.maxAdjacentAngleDegrees, 12) * Math.PI / 180));
  const iterations = Math.max(2, Math.min(10, Math.floor(finiteNumber(options.iterations, 5))));
  const searchSteps = Math.max(2, Math.min(12, Math.floor(finiteNumber(options.searchSteps, 8))));
  const unitAdvance = metrics.reduce((sum, glyph) => sum + glyph.advance, 0) + Math.max(0, metrics.length - 1) * tracking;
  const wrappedLines = options.allowMultiline === true ? twoLabelLines(metrics, tracking) : null;
  const threeLineOptions = options.allowMultiline === true ? threeEnglishLabelLines(metrics, tracking) : [];
  const readableFontSize = Math.max(minFontSize, finiteNumber(options.readableFontSize, 10));
  const preferGentleArcs = options.preferGentleArcs === true;
  const minArcComponentArea = Math.max(0, finiteNumber(options.minArcComponentArea));
  const visibleGlyphCount = metrics.filter((metric) => metric.text.trim()).length;
  const preferredCandidateIndex = Number.isInteger(options.preferredCandidateIndex) ? options.preferredCandidateIndex : -1;
  const maxAlternatives = Math.max(0, Math.min(3, Math.floor(finiteNumber(options.maxAlternatives, 0))));
  const prepared = new Map();
  const validCandidates = candidates.slice(0, MAX_FIT_CANDIDATES);
  for (const candidate of validCandidates) {
    const index = Math.floor(finiteNumber(candidate?.polygonIndex, -1));
    if (index < 0 || index >= rawPolygons.length) continue;
    if (!prepared.has(index)) {
      const component = preparePolygon(rawPolygons[index], index);
      if (component) prepared.set(index, buildSegmentIndex(component));
    }
  }

  const fits = [];
  for (const lines of [[metrics], ...(wrappedLines ? [wrappedLines] : []), ...threeLineOptions]) {
    for (let candidateIndex = 0; candidateIndex < validCandidates.length; candidateIndex += 1) {
      const candidate = validCandidates[candidateIndex];
      if (candidate?.kind === "arc" && options.allowArcs !== true) continue;
      const component = prepared.get(Math.floor(finiteNumber(candidate?.polygonIndex, -1)));
      if (!component || !Array.isArray(candidate.points) || candidate.points.length < 2) continue;
      // A readable overseas line must not suppress the mainland's wrapping.
      if (lines.length > 1 && fits.some((fit) => fit.polygonIndex === component.polygonIndex
        && fit.lineCount < lines.length && fit.fontSize >= readableFontSize)) continue;
      const path = { ...candidate, length: pathLength(candidate.points) };
      if (!(path.length > 0) || !(unitAdvance > 0)) continue;
      if (lines.length > 1 && candidate.kind !== "horizontal") continue;
      const arc = candidate.kind === "arc";
      const layoutOptions = { tracking, maxTracking, glyphPadding, allowPositionShift: options.allowPositionShift === true,
        maxGlyphAngle: arc ? Math.min(maxGlyphAngle, Math.max(0, finiteNumber(options.maxArcTiltDegrees, 30)) * Math.PI / 180) : maxGlyphAngle,
        maxBendAngle: arc ? Math.min(maxBendAngle, Math.max(0, finiteNumber(options.maxArcBendDegrees, 60)) * Math.PI / 180) : maxBendAngle,
        maxAdjacentAngle };
      const longestLineAdvance = Math.max(...lines.map((line) => line.reduce((sum, metric) => sum + metric.advance, 0) + Math.max(0, line.length - 1) * tracking));
      const highAllowed = Math.min(maxFontSize, path.length / longestLineAdvance);
      if (highAllowed < minFontSize) continue;
      let best = null;
      let low = minFontSize;
      let high = highAllowed;
      let priorFailure = highAllowed;
      for (let probe = 0; probe <= searchSteps; probe += 1) {
        const size = highAllowed - ((highAllowed - minFontSize) * probe) / searchSteps;
        const attempt = layoutWithTracking(path, lines, component, size, layoutOptions);
        if (attempt) {
          best = attempt;
          low = size;
          high = priorFailure;
          break;
        }
        priorFailure = size;
      }
      if (!best) continue;
      for (let iteration = 0; iteration < iterations && high - low > 1e-6; iteration += 1) {
        const mid = (low + high) / 2;
        const attempt = layoutWithTracking(path, lines, component, mid, layoutOptions);
        if (attempt) {
          low = mid;
          best = attempt;
        } else {
          high = mid;
        }
      }
      const fit = {
        candidateIndex,
        candidateKind: candidate.kind || "horizontal",
        score: resultScore(candidate, best, component),
        gentleArcScore: preferGentleArcs && arc && lines.length === 1 && visibleGlyphCount >= 4
          && component.area >= minArcComponentArea && component.width >= best.fontSize * 8
          && component.height >= best.fontSize * 3
          ? resultScore(candidate, best, component, true) : undefined,
        fontSize: best.fontSize,
        glyphs: best.glyphs,
        bounds: best.bounds,
        lineCount: best.lineCount,
        tracking: best.tracking,
        minHoleArea: rawPolygons[component.polygonIndex].length !== originalPolygons[component.polygonIndex].length ? minHoleArea : 0,
        polygonIndex: component.polygonIndex,
      };
      fits.push(fit);
    }
  }

  if (!fits.length) return null;
  // Keep independent, bounded placements for each significant territory.
  const byComponent = new Map();
  for (const fit of fits) {
    if (!byComponent.has(fit.polygonIndex)) byComponent.set(fit.polygonIndex, []);
    byComponent.get(fit.polygonIndex).push(fit);
  }
  const componentFits = [...byComponent.values()].map((group) => selectComponentFit(group, {
    readableFontSize, preferredCandidateIndex, maxAlternatives,
    preferredTolerance: options.preferredTolerance,
    component: prepared.get(group[0].polygonIndex),
  })).sort((a, b) => Number(b.fontSize >= readableFontSize) - Number(a.fontSize >= readableFontSize)
    || prepared.get(b.polygonIndex).area - prepared.get(a.polygonIndex).area
    || a.polygonIndex - b.polygonIndex).slice(0, MAX_POLYGONS);
  const selected = componentFits[0];
  return maxAlternatives ? { ...selected, componentFits } : selected;
}

function translatedFit(fit, component, dx, dy) {
  const epsilon = Math.max(component.width, component.height, 1) * 1e-10;
  const glyphs = [];
  for (const glyph of fit.glyphs) {
    const origin = { x: glyph.x + dx, y: glyph.y + dy };
    if (!glyph.text.trim()) {
      glyphs.push({ ...glyph, ...origin, box: { ...glyph.box, x: glyph.box.x + dx, y: glyph.box.y + dy } });
      continue;
    }
    const cos = Math.cos(glyph.angle), sin = Math.sin(glyph.angle);
    const local = glyph.box.corners.map(corner => ({
      x: (corner.x - glyph.x) * cos + (corner.y - glyph.y) * sin,
      y: -(corner.x - glyph.x) * sin + (corner.y - glyph.y) * cos,
    }));
    const corners = envelopeInside(component, origin, glyph.angle,
      Math.min(...local.map(p => p.x)), Math.max(...local.map(p => p.x)),
      Math.min(...local.map(p => p.y)), Math.max(...local.map(p => p.y)), epsilon);
    if (!corners) return null;
    glyphs.push({ ...glyph, ...origin, box: { ...glyph.box, x: glyph.box.x + dx, y: glyph.box.y + dy, corners } });
  }
  return { ...fit, glyphs, bounds: { minX: fit.bounds.minX + dx, maxX: fit.bounds.maxX + dx,
    minY: fit.bounds.minY + dy, maxY: fit.bounds.maxY + dy } };
}

function selectComponentFit(fits, { readableFontSize, preferredCandidateIndex, maxAlternatives, preferredTolerance, component }) {
  const readableFits = fits.filter((fit) => fit.fontSize >= readableFontSize);
  const eligible = readableFits.length ? readableFits : fits;
  const largestReadableFont = readableFits.length ? Math.max(...readableFits.map((fit) => fit.fontSize)) : Infinity;
  const eligibleFits = eligible.map(({ gentleArcScore, ...fit }) => ({ ...fit,
    score: Number.isFinite(gentleArcScore) && fit.fontSize >= largestReadableFont * 0.94 ? gentleArcScore : fit.score,
  }));
  eligibleFits.sort((a, b) => b.score - a.score || b.fontSize - a.fontSize || a.candidateIndex - b.candidateIndex);
  let selected = eligibleFits[0];
  if (preferredCandidateIndex >= 0) {
    const preferred = eligibleFits.find((fit) => fit.candidateIndex === preferredCandidateIndex);
    const tolerance = Math.max(0, finiteNumber(preferredTolerance, 0.35));
    if (preferred && preferred.fontSize >= eligibleFits[0].fontSize - tolerance
      && preferred.score >= eligibleFits[0].score - tolerance) selected = preferred;
  }
  if (!maxAlternatives) return selected;
  // Retain a few independently validated positions during preparation. Drawing
  // can try these cached fits without repeating polygon containment or fitting.
  const alternatives = [];
  const shifted = [[0, -1.25], [0, 1.25], [-1.5, 0], [1.5, 0], [-2.5, -2.5], [2.5, 2.5], [-2.5, 2.5], [2.5, -2.5]]
    .map(([x, y]) => translatedFit(selected, component, x * selected.fontSize, y * selected.fontSize)).filter(Boolean);
  const pool = [...shifted.slice(0, 2), ...eligibleFits.filter(fit => fit !== selected), ...shifted.slice(2)];
  const delta = fit => ({ x: (fit.bounds.minX + fit.bounds.maxX - selected.bounds.minX - selected.bounds.maxX) / 2,
    y: (fit.bounds.minY + fit.bounds.maxY - selected.bounds.minY - selected.bounds.maxY) / 2 });
  while (pool.length && alternatives.length < maxAlternatives) {
    // After one direction succeeds, try the opposite side before filling the
    // remaining slot. Coastlines and holes may legitimately prevent that side.
    const first = alternatives[0] && delta(alternatives[0]);
    let index = alternatives.length === 1 ? pool.findIndex(fit => {
      const offset = delta(fit); return first.x * offset.x + first.y * offset.y < 0;
    }) : 0;
    if (alternatives.length === 2) {
      // The last retry provides distance from crowded central positions,
      // rather than repeating another nearby candidate in the same cluster.
      let separation = -Infinity;
      pool.forEach((fit, candidateIndex) => {
        if (fit.fontSize < selected.fontSize * 0.75) return;
        const offset = delta(fit);
        const distance = Math.min(...[selected, ...alternatives].map(prior => {
          const other = delta(prior); return Math.hypot(offset.x - other.x, offset.y - other.y);
        }));
        if (distance > separation) { separation = distance; index = candidateIndex; }
      });
    }
    const [fit] = pool.splice(index >= 0 ? index : 0, 1);
    if (fit === selected || fit.fontSize < selected.fontSize * 0.75) continue;
    const distinct = [selected, ...alternatives].every((prior) => {
      const dx = (fit.bounds.minX + fit.bounds.maxX - prior.bounds.minX - prior.bounds.maxX) / 2;
      const dy = (fit.bounds.minY + fit.bounds.maxY - prior.bounds.minY - prior.bounds.maxY) / 2;
      return Math.hypot(dx, dy) >= Math.min(fit.fontSize, prior.fontSize);
    });
    if (distinct) alternatives.push(fit);
  }
  return { ...selected, alternatives };
}
