const MAX_GRID_SIZE = 48;
const DEFAULT_MAX_CANDIDATES = 16;
const MAX_POLYGONS = 3;
const MAX_SEEDS_PER_POLYGON = 12;
const MAX_CANDIDATES_PER_POLYGON = 32;
const MAX_FIT_CANDIDATES = 20;
const DEFAULT_MAX_GRID_SIZE = 32;
const MAX_GLYPH_ANGLE = 75 * Math.PI / 180;
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

function preparePolygon(ringsInput, polygonIndex) {
  if (!Array.isArray(ringsInput) || ringsInput.length === 0) return null;
  const rings = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let vertexCount = 0;
  let polygonArea = 0;

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
      for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) twiceArea += ring[j].x * ring[i].y - ring[i].x * ring[j].y;
      const ringArea = Math.abs(twiceArea) / 2;
      polygonArea += rings.length === 1 ? ringArea : -ringArea;
    }
  }

  if (!rings.length || !(maxX > minX) || !(maxY > minY)) return null;
  return { polygonIndex, rings, minX, minY, maxX, maxY, width: maxX - minX, height: maxY - minY, vertexCount, area: Math.max(0, polygonArea) };
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

function rectangleCandidates(component) {
  const { minX, minY, maxX, maxY, width, height } = component;
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const candidates = [];
  const count = 32;
  const baseClearance = Math.min(width, height) / 2;
  for (const offset of [0, -0.16 * height, 0.16 * height]) {
    const y = centerY + offset;
    candidates.push(makeCandidate(component, [{ x: minX, y }, { x: maxX, y }], "horizontal", { clearance: baseClearance }));
  }
  for (const degrees of [-75, -60, -45, -30, -15, 15, 30, 45, 60, 75]) {
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
  for (const sign of [-1, 1]) {
    const points = [];
    for (let index = 0; index <= count; index += 1) {
      const distance = -width / 2 + (width * index) / count;
      const curvature = sign * 0.3 / width;
      points.push({
        x: centerX + Math.sin(curvature * distance) / curvature,
        y: centerY - (Math.cos(curvature * distance) - 1) / curvature,
      });
    }
    candidates.push(makeCandidate(component, points, "arc", { clearance: baseClearance, curvature: sign * 0.3 }));
  }
  return candidates.filter(Boolean);
}

function generateComponentCandidates(component, options) {
  if (isAxisAlignedRectangle(component)) return rectangleCandidates(component);
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
  const orientationDegrees = new Set([-75, -45, -15, 0, 15, 45, 75]);
  for (const offset of [-20, -10, 0, 10, 20]) {
    const degrees = Math.max(-75, Math.min(75, Math.round(principalAxis * 180 / Math.PI + offset)));
    orientationDegrees.add(degrees);
  }

  const generated = [];
  for (const seed of seeds) {
    for (const degrees of orientationDegrees) {
      const candidate = traceGridPath(component, grid, seed, degrees * Math.PI / 180, 0);
      if (candidate) generated.push(candidate);
    }
    for (const degrees of [principalAxis * 180 / Math.PI]) {
      const clampedDegrees = Math.max(-75, Math.min(75, degrees));
      for (const curvature of [-0.3, 0.3]) {
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
    return b.length * (0.7 + 0.3 * b.clearance / maxDimension) - a.length * (0.7 + 0.3 * a.clearance / maxDimension);
  });
  const buckets = new Map();
  for (const candidate of rankedCandidates) {
    const angleBand = Math.round((candidate.angle * 180 / Math.PI) / 15) * 15;
    const key = candidate.kind === "horizontal" ? "horizontal" : `${candidate.kind}:${angleBand}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(candidate);
  }
  const tiltedBands = [-15, 15, -30, 30, -45, 45, -60, 60, -75, 75, 0];
  const arcBands = [0, -15, 15, -30, 30, -45, 45, -60, 60, -75, 75];
  const orderedKeys = ["horizontal", ...tiltedBands.map((angle) => `tilted:${angle}`), ...arcBands.flatMap((angle) => [`arc:${angle}`, `arc:${angle + 1}`, `arc:${angle - 1}`])];
  const selected = [];
  let rank = 0;
  while (selected.length < MAX_CANDIDATES_PER_POLYGON) {
    let added = false;
    for (const key of orderedKeys) {
      const group = buckets.get(key);
      if (group && rank < group.length) {
        selected.push(group[rank]);
        added = true;
        if (selected.length >= MAX_CANDIDATES_PER_POLYGON) break;
      }
    }
    if (!added) break;
    rank += 1;
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
  const rankedComponents = normalizeMultiPolygon(polygons)
    .map((polygon, index) => preparePolygon(polygon, index))
    .filter(Boolean)
    .sort((a, b) => b.area - a.area || b.width * b.height - a.width * a.height);
  const largestArea = rankedComponents[0]?.area || 0;
  const components = rankedComponents
    .filter((component, index) => index === 0 || (largestArea > 0 && component.area >= largestArea * 0.03))
    .slice(0, MAX_POLYGONS);
  const groups = components.map((component) => generateComponentCandidates(component, { maxGridSize }));
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
  return { ...component, segments, rows, cells, indexSize };
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
  const boundaryIds = new Set();
  for (let rowOffset = -1; rowOffset <= 1; rowOffset += 1) {
    const bucket = component.rows[row + rowOffset];
    if (bucket) for (const id of bucket) boundaryIds.add(id);
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

function layoutAtSize(candidate, metrics, component, fontSize, tracking, glyphPadding, maxGlyphAngle, maxBendAngle, maxAdjacentAngle) {
  const logicalWidth = metrics.reduce((sum, glyph) => sum + glyph.advance * fontSize, 0) + Math.max(0, metrics.length - 1) * tracking * fontSize;
  if (logicalWidth > candidate.length + 1e-8) return null;
  const padding = glyphPadding * fontSize;
  let cursor = (candidate.length - logicalWidth) / 2;
  const glyphs = [];
  const angles = [];
  const allCorners = [];
  const epsilon = Math.max(component.width, component.height, 1) * 1e-10;
  for (const metric of metrics) {
    const origin = pathPointAt(candidate, cursor);
    if (!Number.isFinite(origin.angle) || Math.abs(origin.angle) > maxGlyphAngle + 1e-8) return null;
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
  const bounds = {
    minX: Math.min(...allCorners.map((point) => point.x)),
    minY: Math.min(...allCorners.map((point) => point.y)),
    maxX: Math.max(...allCorners.map((point) => point.x)),
    maxY: Math.max(...allCorners.map((point) => point.y)),
  };
  return { glyphs, bounds, fontSize, angles };
}

function resultScore(candidate, layout) {
  const maxAngle = layout.angles.reduce((value, angle) => Math.max(value, Math.abs(angle)), 0);
  const bend = layout.angles.length ? Math.max(...layout.angles) - Math.min(...layout.angles) : 0;
  const anglePenalty = 0.12 * (maxAngle / (Math.PI / 2));
  const bendPenalty = 0.08 * (bend / (Math.PI / 3));
  const kindPenalty = candidate.kind === "horizontal" ? 0 : candidate.kind === "tilted" ? 0.001 : 0.002;
  return layout.fontSize * (1 - anglePenalty - bendPenalty) - kindPenalty;
}

export function fitCountryLabel(candidates, options = {}) {
  if (!Array.isArray(candidates) || candidates.length === 0 || !Array.isArray(options.glyphs) || options.glyphs.length === 0) return null;
  const rawPolygons = normalizeMultiPolygon(options.polygons);
  if (!rawPolygons.length) return null;
  const metrics = options.glyphs.map(glyphMetric);
  const minFontSize = Math.max(0, finiteNumber(options.minFontSize, 1));
  const maxFontSize = Math.max(minFontSize, finiteNumber(options.maxFontSize, minFontSize));
  const tracking = finiteNumber(options.tracking, 0);
  const glyphPadding = Math.max(0, finiteNumber(options.glyphPadding, 0));
  const maxGlyphAngle = Math.max(0, Math.min(MAX_GLYPH_ANGLE, finiteNumber(options.maxTiltDegrees, 75) * Math.PI / 180));
  const maxBendAngle = Math.max(0, Math.min(Math.PI / 3, finiteNumber(options.maxBendDegrees, 60) * Math.PI / 180));
  const maxAdjacentAngle = Math.max(0, Math.min(Math.PI / 3, finiteNumber(options.maxAdjacentAngleDegrees, 12) * Math.PI / 180));
  const iterations = Math.max(2, Math.min(10, Math.floor(finiteNumber(options.iterations, 5))));
  const searchSteps = Math.max(2, Math.min(12, Math.floor(finiteNumber(options.searchSteps, 8))));
  const unitAdvance = metrics.reduce((sum, glyph) => sum + glyph.advance, 0) + Math.max(0, metrics.length - 1) * tracking;
  const preferredCandidateIndex = Number.isInteger(options.preferredCandidateIndex) ? options.preferredCandidateIndex : -1;
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
  for (let candidateIndex = 0; candidateIndex < validCandidates.length; candidateIndex += 1) {
    const candidate = validCandidates[candidateIndex];
    const component = prepared.get(Math.floor(finiteNumber(candidate?.polygonIndex, -1)));
    if (!component || !Array.isArray(candidate.points) || candidate.points.length < 2) continue;
    const path = { ...candidate, length: pathLength(candidate.points) };
    if (!(path.length > 0)) continue;
    if (!(unitAdvance > 0)) continue;
    const highAllowed = Math.min(maxFontSize, path.length / unitAdvance);
    if (highAllowed < minFontSize) continue;
    let best = null;
    let low = minFontSize;
    let high = highAllowed;
    let priorFailure = highAllowed;
    for (let probe = 0; probe <= searchSteps; probe += 1) {
      const size = highAllowed - ((highAllowed - minFontSize) * probe) / searchSteps;
      const attempt = layoutAtSize(path, metrics, component, size, tracking, glyphPadding, maxGlyphAngle, maxBendAngle, maxAdjacentAngle);
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
      const attempt = layoutAtSize(path, metrics, component, mid, tracking, glyphPadding, maxGlyphAngle, maxBendAngle, maxAdjacentAngle);
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
      score: resultScore(candidate, best),
      fontSize: best.fontSize,
      glyphs: best.glyphs,
      bounds: best.bounds,
      polygonIndex: component.polygonIndex,
    };
    fits.push(fit);
    if (fit.candidateKind === "horizontal" && fit.fontSize >= maxFontSize - 1e-6 && fit.glyphs.every((glyph) => Math.abs(glyph.angle) < 1e-8) && (preferredCandidateIndex < 0 || preferredCandidateIndex === candidateIndex)) return fit;
  }

  if (!fits.length) return null;
  fits.sort((a, b) => b.score - a.score || b.fontSize - a.fontSize || a.candidateIndex - b.candidateIndex);
  if (preferredCandidateIndex >= 0) {
    const preferred = fits.find((fit) => fit.candidateIndex === preferredCandidateIndex);
    const tolerance = Math.max(0, finiteNumber(options.preferredTolerance, 0.35));
    if (preferred && preferred.fontSize >= fits[0].fontSize - tolerance) return preferred;
  }
  return fits[0];
}
