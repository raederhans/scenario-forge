import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const d3 = require("../vendor/d3.v7.min.js");
const topojson = require("../vendor/topojson-client.min.js");

const RAD_TO_DEG = 180 / Math.PI;
const DEFAULT_BOUNDARY_TOLERANCE_DEG = 0.001;
const DEFAULT_MAX_EDGE_DRIFT_DEG = 0.005;
const DEFAULT_MAX_SAMPLES_PER_FEATURE = 32;
const MAX_REPORTED_ERRORS = 100;

const BUILTIN_PROFILES = Object.freeze({
  base: [
    { id: "north-pole", point: [0, 89], group: "ocean_macro", expectedCount: 1, expectedIds: ["marine_arctic_ocean"], expectedLand: false, expectedOcean: true },
    { id: "antarctic-interior", point: [90, -80], group: "ocean_macro", expectedCount: 0, expectedLand: true, expectedOcean: false },
    { id: "mid-atlantic-control", point: [-30, 30], group: "ocean_macro", expectedCount: 1, expectedLand: false, expectedOcean: true },
    { id: "dateline-east", point: [179.5, 85], group: "ocean_macro", expectedCount: 1, expectedLand: false, expectedOcean: true },
    { id: "dateline-west", point: [-179.5, 85], group: "ocean_macro", expectedCount: 1, expectedLand: false, expectedOcean: true },
  ],
  tno: [
    { id: "antarctic-indian-80e", point: [80, -70], group: "ocean_macro", expectedCount: 0, expectedLand: true },
    { id: "antarctic-indian-90e", point: [90, -75], group: "ocean_macro", expectedCount: 0, expectedLand: true },
    { id: "arctic-control", point: [0, 85], group: "ocean_macro", expectedCount: 1, expectedLand: false },
    { id: "dateline-east", point: [179.5, 75], group: "ocean_macro", expectedCount: 1, expectedLand: false },
    { id: "dateline-west", point: [-179.5, 75], group: "ocean_macro", expectedCount: 1, expectedLand: false },
    { id: "mid-atlantic-control", point: [-30, 30], group: "ocean_macro", expectedCount: 1, expectedLand: false },
  ],
});

function featureId(feature, index = 0) {
  return String(feature?.properties?.id ?? feature?.id ?? `feature-${index}`);
}

function asFeatureCollection(value, objectName, label) {
  if (!value) return null;
  if (value.topology) return asFeatureCollection(value.topology, value.objectName ?? objectName, label);
  if (value.type === "Topology") {
    const resolvedObjectName = objectName ?? (value.objects && Object.keys(value.objects).length === 1 ? Object.keys(value.objects)[0] : null);
    if (!resolvedObjectName || !value.objects?.[resolvedObjectName]) {
      throw new TypeError(`${label} Topology requires a valid objectName`);
    }
    return asFeatureCollection(topojson.feature(value, value.objects[resolvedObjectName]), undefined, label);
  }
  if (value.type === "FeatureCollection") return value;
  if (value.type === "Feature") return { type: "FeatureCollection", features: [value] };
  if (typeof value.type === "string") {
    return { type: "FeatureCollection", features: [{ type: "Feature", properties: {}, geometry: value }] };
  }
  throw new TypeError(`${label} must be GeoJSON or TopoJSON`);
}

function polygonParts(geometry) {
  if (!geometry) return [];
  if (geometry.type === "Polygon") return [geometry.coordinates];
  if (geometry.type === "MultiPolygon") return geometry.coordinates ?? [];
  if (geometry.type === "GeometryCollection") return (geometry.geometries ?? []).flatMap(polygonParts);
  return [];
}

function normalizeLongitude(lon) {
  let normalized = Number(lon);
  while (normalized > 180) normalized -= 360;
  while (normalized < -180) normalized += 360;
  return normalized;
}

function unwrapRing(ring) {
  if (!Array.isArray(ring) || ring.length === 0) return [];
  const output = [[Number(ring[0][0]), Number(ring[0][1])]];
  for (let index = 1; index < ring.length; index += 1) {
    let lon = Number(ring[index][0]);
    const lat = Number(ring[index][1]);
    const previousLon = output[index - 1][0];
    while (lon - previousLon > 180) lon -= 360;
    while (lon - previousLon < -180) lon += 360;
    output.push([lon, lat]);
  }
  return output;
}

function alignLongitude(lon, ring) {
  const mean = ring.reduce((sum, coordinate) => sum + coordinate[0], 0) / Math.max(1, ring.length);
  let aligned = Number(lon);
  while (aligned - mean > 180) aligned -= 360;
  while (aligned - mean < -180) aligned += 360;
  return aligned;
}

function pointOnSegment(point, start, end, tolerance = 1e-10) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  if (dx * dx + dy * dy <= tolerance * tolerance) {
    return Math.hypot(point[0] - start[0], point[1] - start[1]) <= tolerance;
  }
  const cross = (point[0] - start[0]) * dy - (point[1] - start[1]) * dx;
  if (Math.abs(cross) > tolerance * Math.max(1, Math.abs(dx), Math.abs(dy))) return false;
  const dot = (point[0] - start[0]) * dx + (point[1] - start[1]) * dy;
  return dot >= -tolerance && dot <= dx * dx + dy * dy + tolerance;
}

function pointInRing(point, sourceRing) {
  const ring = unwrapRing(sourceRing);
  if (ring.length < 4) return false;
  const alignedPoint = [alignLongitude(point[0], ring), Number(point[1])];
  let inside = false;
  for (let current = 0, previous = ring.length - 1; current < ring.length; previous = current, current += 1) {
    const a = ring[previous];
    const b = ring[current];
    if (pointOnSegment(alignedPoint, a, b)) return true;
    const crosses = (a[1] > alignedPoint[1]) !== (b[1] > alignedPoint[1]);
    if (crosses) {
      const crossingLon = ((b[0] - a[0]) * (alignedPoint[1] - a[1])) / (b[1] - a[1]) + a[0];
      if (alignedPoint[0] < crossingLon) inside = !inside;
    }
  }
  return inside;
}

function planarContainsPolygon(rings, point) {
  if (!Array.isArray(rings) || !rings.length || !pointInRing(point, rings[0])) return false;
  return !rings.slice(1).some((ring) => pointInRing(point, ring));
}

function planarContainsGeometry(geometry, point) {
  return polygonParts(geometry).some((rings) => planarContainsPolygon(rings, point));
}

function pointSegmentDistance(point, sourceStart, sourceEnd) {
  const referenceLat = Number(point[1]);
  const scaleX = Math.max(1e-6, Math.cos(referenceLat / RAD_TO_DEG));
  const startLon = alignLongitude(sourceStart[0], [sourceStart, sourceEnd]);
  let endLon = Number(sourceEnd[0]);
  while (endLon - startLon > 180) endLon -= 360;
  while (endLon - startLon < -180) endLon += 360;
  let pointLon = Number(point[0]);
  while (pointLon - startLon > 180) pointLon -= 360;
  while (pointLon - startLon < -180) pointLon += 360;
  const px = pointLon * scaleX;
  const py = referenceLat;
  const ax = startLon * scaleX;
  const ay = Number(sourceStart[1]);
  const bx = endLon * scaleX;
  const by = Number(sourceEnd[1]);
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const ratio = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator));
  return Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy));
}

function distanceToBoundary(point, geometry) {
  let minimum = Infinity;
  for (const rings of polygonParts(geometry)) {
    for (const ring of rings ?? []) {
      for (let index = 1; index < ring.length; index += 1) {
        minimum = Math.min(minimum, pointSegmentDistance(point, ring[index - 1], ring[index]));
      }
    }
  }
  return minimum;
}

const boundaryIndexCache = new WeakMap();

function boundaryIndex(geometry) {
  if (!geometry || typeof geometry !== "object") return [];
  const cached = boundaryIndexCache.get(geometry);
  if (cached) return cached;
  const entries = [];
  for (const rings of polygonParts(geometry)) {
    for (const sourceRing of rings ?? []) {
      const ring = unwrapRing(sourceRing);
      const bounds = ring.reduce((current, coordinate) => [
        Math.min(current[0], coordinate[0]),
        Math.min(current[1], coordinate[1]),
        Math.max(current[2], coordinate[0]),
        Math.max(current[3], coordinate[1]),
      ], [Infinity, Infinity, -Infinity, -Infinity]);
      entries.push({ ring, bounds });
    }
  }
  boundaryIndexCache.set(geometry, entries);
  return entries;
}

function isNearBoundary(point, geometry, tolerance) {
  const referenceLat = Number(point[1]);
  const scaleX = Math.max(1e-6, Math.cos(referenceLat / RAD_TO_DEG));
  const longitudeTolerance = tolerance / scaleX;
  for (const entry of boundaryIndex(geometry)) {
    const alignedLon = alignLongitude(point[0], entry.ring);
    if (alignedLon < entry.bounds[0] - longitudeTolerance || alignedLon > entry.bounds[2] + longitudeTolerance || referenceLat < entry.bounds[1] - tolerance || referenceLat > entry.bounds[3] + tolerance) continue;
    const alignedPoint = [alignedLon, referenceLat];
    for (let index = 1; index < entry.ring.length; index += 1) {
      const start = entry.ring[index - 1];
      const end = entry.ring[index];
      const ax = start[0] * scaleX;
      const ay = start[1];
      const bx = end[0] * scaleX;
      const by = end[1];
      const px = alignedPoint[0] * scaleX;
      const py = alignedPoint[1];
      const dx = bx - ax;
      const dy = by - ay;
      const denominator = dx * dx + dy * dy;
      const ratio = denominator === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / denominator));
      if (Math.hypot(px - (ax + ratio * dx), py - (ay + ratio * dy)) <= tolerance) return true;
    }
  }
  return false;
}

function ringSignedArea(sourceRing) {
  const ring = unwrapRing(sourceRing);
  let area = 0;
  for (let index = 1; index < ring.length; index += 1) {
    area += ring[index - 1][0] * ring[index][1] - ring[index][0] * ring[index - 1][1];
  }
  return area / 2;
}

function coordinatesEqual(left, right, tolerance = 1e-9) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const lonDelta = Math.abs(normalizeLongitude(Number(left[0]) - Number(right[0])));
  return lonDelta <= tolerance && Math.abs(Number(left[1]) - Number(right[1])) <= tolerance;
}

function ringErrors(feature, featureIndex) {
  const errors = [];
  const id = featureId(feature, featureIndex);
  const parts = polygonParts(feature.geometry);
  if (!parts.length) return [{ code: "non-polygon-geometry", featureId: id }];
  parts.forEach((rings, partIndex) => {
    if (!Array.isArray(rings) || !rings.length) {
      errors.push({ code: "missing-exterior-ring", featureId: id, partIndex });
      return;
    }
    rings.forEach((ring, ringIndex) => {
      if (!Array.isArray(ring) || ring.length < 4) {
        errors.push({ code: "invalid-ring-length", featureId: id, partIndex, ringIndex });
        return;
      }
      if (ring.some((coordinate) => !Array.isArray(coordinate) || coordinate.length < 2 || !Number.isFinite(Number(coordinate[0])) || !Number.isFinite(Number(coordinate[1])) || Math.abs(Number(coordinate[0])) > 180 || Math.abs(Number(coordinate[1])) > 90)) {
        errors.push({ code: "invalid-ring-coordinate", featureId: id, partIndex, ringIndex });
        return;
      }
      if (!coordinatesEqual(ring[0], ring.at(-1))) {
        errors.push({ code: "unclosed-ring", featureId: id, partIndex, ringIndex });
      }
      const distinct = new Set(ring.slice(0, -1).map((coordinate) => `${Number(coordinate[0]).toFixed(9)},${Number(coordinate[1]).toFixed(9)}`));
      if (distinct.size < 3 || Math.abs(ringSignedArea(ring)) < 1e-10) {
        errors.push({ code: "degenerate-ring", featureId: id, partIndex, ringIndex });
      }
    });
  });
  return errors;
}

function sphericalErrors(feature, featureIndex) {
  const errors = [];
  const id = featureId(feature, featureIndex);
  const projectedPath = d3.geoPath(d3.geoEqualEarth().scale(150).translate([480, 250]));
  const geometries = [{ geometry: feature.geometry, partIndex: null }, ...polygonParts(feature.geometry).map((coordinates, partIndex) => ({ geometry: { type: "Polygon", coordinates }, partIndex }))];
  geometries.forEach(({ geometry, partIndex }, index) => {
    const area = Number(d3.geoArea(geometry));
    const bounds = d3.geoBounds(geometry);
    const suffix = index === 0 ? {} : { partIndex };
    if (!Number.isFinite(area) || area <= 0) errors.push({ code: "empty-spherical-area", featureId: id, ...suffix, area });
    if (Number.isFinite(area) && area > 2 * Math.PI + 1e-9) errors.push({ code: "hemisphere-complement", featureId: id, ...suffix, area });
    if (bounds.flat().some((value) => !Number.isFinite(value))) errors.push({ code: "invalid-spherical-bounds", featureId: id, ...suffix });
  });
  const pathData = projectedPath(feature);
  const projectedArea = Number(projectedPath.area(feature));
  const projectedBounds = projectedPath.bounds(feature);
  if (!pathData || !Number.isFinite(projectedArea) || projectedArea <= 1e-9 || projectedBounds.flat().some((value) => !Number.isFinite(value))) {
    errors.push({ code: "empty-equal-earth-fill", featureId: id, projectedArea });
  }
  return errors;
}

function edgeDiagnostics(feature, maxEdgeDriftDeg) {
  const diagnostics = [];
  for (const rings of polygonParts(feature.geometry)) {
    for (const ring of rings ?? []) {
      const unwrapped = unwrapRing(ring);
      for (let index = 1; index < ring.length; index += 1) {
        const start = ring[index - 1];
        const end = ring[index];
        const unwrappedStart = unwrapped[index - 1];
        const unwrappedEnd = unwrapped[index];
        if (Math.abs(Number(start[1])) === 90 && Math.abs(Number(end[1])) === 90) continue;
        const planarMidpoint = [normalizeLongitude((unwrappedStart[0] + unwrappedEnd[0]) / 2), (unwrappedStart[1] + unwrappedEnd[1]) / 2];
        const sphericalMidpoint = d3.geoInterpolate(start, end)(0.5);
        const driftDeg = Number(d3.geoDistance(planarMidpoint, sphericalMidpoint)) * RAD_TO_DEG;
        if (Number.isFinite(driftDeg)) diagnostics.push({ start, end, planarMidpoint, sphericalMidpoint, driftDeg, exceeds: driftDeg > maxEdgeDriftDeg });
      }
    }
  }
  return diagnostics.sort((left, right) => right.driftDeg - left.driftDeg);
}

function planarBounds(rings) {
  const outer = unwrapRing(rings[0]);
  return outer.reduce((bounds, coordinate) => [
    Math.min(bounds[0], coordinate[0]),
    Math.min(bounds[1], coordinate[1]),
    Math.max(bounds[2], coordinate[0]),
    Math.max(bounds[3], coordinate[1]),
  ], [Infinity, Infinity, -Infinity, -Infinity]);
}

function sampleFeature(feature, edgeRows, boundaryToleranceDeg, maxSamples) {
  const candidates = [];
  for (const rings of polygonParts(feature.geometry)) {
    const bounds = planarBounds(rings);
    const fractions = [0.2, 0.35, 0.5, 0.65, 0.8];
    for (const xFraction of fractions) {
      for (const yFraction of fractions) {
        candidates.push([
          normalizeLongitude(bounds[0] + (bounds[2] - bounds[0]) * xFraction),
          bounds[1] + (bounds[3] - bounds[1]) * yFraction,
        ]);
      }
    }
  }
  edgeRows.slice(0, 8).forEach((row) => {
    if (row.driftDeg > boundaryToleranceDeg * 2) {
      candidates.push(d3.geoInterpolate(row.planarMidpoint, row.sphericalMidpoint)(0.5));
    }
  });
  const unique = [];
  const seen = new Set();
  for (const point of candidates) {
    const normalized = [normalizeLongitude(point[0]), Number(point[1])];
    const key = `${normalized[0].toFixed(5)},${normalized[1].toFixed(5)}`;
    if (seen.has(key) || distanceToBoundary(normalized, feature.geometry) <= boundaryToleranceDeg) continue;
    seen.add(key);
    unique.push(normalized);
    if (unique.length >= maxSamples) break;
  }
  return unique;
}

function sameLevelKey(feature) {
  const properties = feature.properties ?? {};
  const group = String(properties.region_group ?? "");
  const type = String(properties.water_type ?? "");
  if (group === "ocean_macro") return "ocean_macro|ocean";
  return `${group}|${type}|${String(properties.parent_id ?? "")}`;
}

function isOceanFeature(feature) {
  const properties = feature.properties ?? {};
  return properties.water_type === "ocean" || properties.region_group === "ocean_macro";
}

function maskContains(mask, point, boundaryToleranceDeg) {
  if (!mask) return false;
  if (isNearBoundary(point, mask, boundaryToleranceDeg)) return null;
  return d3.geoContains(mask, point);
}

function sphericalBoundsContainPoint(bounds, point, padding = 0) {
  if (!Array.isArray(bounds) || bounds.length !== 2) return true;
  const lon = normalizeLongitude(point[0]);
  const lat = Number(point[1]);
  const [west, south] = bounds[0];
  const [east, north] = bounds[1];
  if (lat < south - padding || lat > north + padding) return false;
  if (west <= east) return lon >= west - padding && lon <= east + padding;
  return lon >= west - padding || lon <= east + padding;
}

function selectProbeFeatures(features, probe) {
  return features.filter((feature) => {
    if (probe.group && feature.properties?.region_group !== probe.group) return false;
    if (probe.waterType && feature.properties?.water_type !== probe.waterType) return false;
    return true;
  });
}

/**
 * Validate final water geometry as D3 will render and hit-test it.
 *
 * `collection`, `land`, and `ocean` accept GeoJSON, TopoJSON plus an object-name
 * option, or `{ topology, objectName }`. Boundaries within
 * `boundaryToleranceDeg` are excluded from semantic and overlap assertions.
 */
export function validateWaterGeometry(collection, options = {}) {
  const boundaryToleranceDeg = Number(options.boundaryToleranceDeg ?? DEFAULT_BOUNDARY_TOLERANCE_DEG);
  const maxEdgeDriftDeg = Number(options.maxEdgeDriftDeg ?? DEFAULT_MAX_EDGE_DRIFT_DEG);
  const maxSamplesPerFeature = Number(options.maxSamplesPerFeature ?? DEFAULT_MAX_SAMPLES_PER_FEATURE);
  const featureCollection = asFeatureCollection(collection, options.objectName, "collection");
  const landCollection = asFeatureCollection(options.land, options.landObjectName, "land");
  const oceanCollection = asFeatureCollection(options.ocean, options.oceanObjectName, "ocean");
  const landGeometry = landCollection ? { type: "GeometryCollection", geometries: landCollection.features.map((feature) => feature.geometry).filter(Boolean) } : null;
  const oceanGeometry = oceanCollection ? { type: "GeometryCollection", geometries: oceanCollection.features.map((feature) => feature.geometry).filter(Boolean) } : null;
  const inputFeatures = featureCollection.features ?? [];
  const features = inputFeatures.filter((feature) => {
    const properties = feature.properties ?? {};
    if (options.featureGroup != null && properties.region_group !== options.featureGroup) return false;
    if (options.oceanOnly && !isOceanFeature(feature)) return false;
    if (typeof options.featureFilter === "function" && !options.featureFilter(properties, feature)) return false;
    return true;
  });
  const errors = [];
  const warnings = [];
  const samplesByFeature = new Map();
  const sphericalBoundsByFeature = new Map();
  let maximumEdgeDriftDeg = 0;
  let sampledPointCount = 0;

  const addError = (error) => {
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(error);
  };

  features.forEach((feature, featureIndex) => {
    ringErrors(feature, featureIndex).forEach(addError);
    if (!feature.geometry) return;
    sphericalErrors(feature, featureIndex).forEach(addError);
    sphericalBoundsByFeature.set(feature, d3.geoBounds(feature));
    const id = featureId(feature, featureIndex);
    const edgeRows = edgeDiagnostics(feature, maxEdgeDriftDeg);
    maximumEdgeDriftDeg = Math.max(maximumEdgeDriftDeg, edgeRows[0]?.driftDeg ?? 0);
    edgeRows.filter((row) => row.exceeds).slice(0, 5).forEach((row) => addError({
      code: "planar-geodesic-edge-drift",
      featureId: id,
      driftDeg: row.driftDeg,
      maxEdgeDriftDeg,
      start: row.start,
      end: row.end,
    }));
    const samples = sampleFeature(feature, edgeRows, boundaryToleranceDeg, maxSamplesPerFeature);
    samplesByFeature.set(feature, samples);
    sampledPointCount += samples.length;
    for (const point of samples) {
      const planar = planarContainsGeometry(feature.geometry, point);
      const spherical = d3.geoContains(feature, point);
      const boundaryDistanceDeg = distanceToBoundary(point, feature.geometry);
      if (planar !== spherical && boundaryDistanceDeg > boundaryToleranceDeg + maxEdgeDriftDeg) {
        addError({ code: "planar-spherical-contains-mismatch", featureId: id, point, planar, spherical, boundaryDistanceDeg });
      }
      if (!spherical) continue;
      if (isOceanFeature(feature) && landGeometry && maskContains(landGeometry, point, boundaryToleranceDeg) === true) {
        addError({ code: "ocean-intersects-land", featureId: id, point });
      }
      if (isOceanFeature(feature) && oceanGeometry && maskContains(oceanGeometry, point, boundaryToleranceDeg) === false) {
        addError({ code: "ocean-outside-physical-ocean", featureId: id, point });
      }
    }
  });

  const byLevel = new Map();
  for (const feature of features) {
    const level = sameLevelKey(feature);
    const peers = byLevel.get(level) ?? [];
    peers.push(feature);
    byLevel.set(level, peers);
  }
  for (const [level, peers] of byLevel) {
    if (peers.length < 2) continue;
    for (const source of peers) {
      for (const point of samplesByFeature.get(source) ?? []) {
        if (!d3.geoContains(source, point)) continue;
        const overlapToleranceDeg = boundaryToleranceDeg + maxEdgeDriftDeg;
        const hits = peers.filter((candidate) => sphericalBoundsContainPoint(sphericalBoundsByFeature.get(candidate), point, overlapToleranceDeg) && !isNearBoundary(point, candidate.geometry, overlapToleranceDeg) && d3.geoContains(candidate, point));
        if (hits.length > 1) {
          addError({ code: "same-level-interior-overlap", level, point, featureIds: hits.map((feature, index) => featureId(feature, index)).sort() });
        }
      }
    }
  }

  for (const probe of options.probes ?? []) {
    const point = probe.point?.map(Number);
    if (!Array.isArray(point) || point.length !== 2 || point.some((value) => !Number.isFinite(value))) {
      addError({ code: "invalid-probe", probeId: probe.id ?? "<unknown>" });
      continue;
    }
    const candidates = selectProbeFeatures(features, probe);
    const hits = candidates.filter((feature) => d3.geoContains(feature, point));
    const hitIds = hits.map((feature, index) => featureId(feature, index)).sort();
    const probeId = String(probe.id ?? point.join(","));
    if (probe.expectedCount != null && hits.length !== Number(probe.expectedCount)) {
      addError({ code: "probe-water-count", probeId, point, expected: Number(probe.expectedCount), actual: hits.length, featureIds: hitIds });
    }
    if (probe.expectedIds) {
      const expectedIds = [...probe.expectedIds].map(String).sort();
      if (JSON.stringify(hitIds) !== JSON.stringify(expectedIds)) addError({ code: "probe-water-ids", probeId, point, expected: expectedIds, actual: hitIds });
    }
    const landContains = maskContains(landGeometry, point, boundaryToleranceDeg);
    const oceanContains = maskContains(oceanGeometry, point, boundaryToleranceDeg);
    if (probe.expectedLand != null && !landGeometry) addError({ code: "probe-missing-land-mask", probeId, point });
    if (probe.expectedOcean != null && !oceanGeometry) addError({ code: "probe-missing-ocean-mask", probeId, point });
    if (probe.expectedLand != null && landContains !== Boolean(probe.expectedLand)) addError({ code: "probe-land-mask", probeId, point, expected: Boolean(probe.expectedLand), actual: landContains });
    if (probe.expectedOcean != null && oceanContains !== Boolean(probe.expectedOcean)) addError({ code: "probe-ocean-mask", probeId, point, expected: Boolean(probe.expectedOcean), actual: oceanContains });
    if (landContains === true && hits.some(isOceanFeature)) addError({ code: "probe-ocean-on-land", probeId, point, featureIds: hitIds });
    if (oceanGeometry && oceanContains === false && hits.some(isOceanFeature)) addError({ code: "probe-ocean-outside-mask", probeId, point, featureIds: hitIds });
  }

  if (errors.length === MAX_REPORTED_ERRORS) warnings.push({ code: "error-report-truncated", limit: MAX_REPORTED_ERRORS });
  return {
    ok: errors.length === 0,
    errors,
    warnings,
    stats: {
      inputFeatureCount: inputFeatures.length,
      checkedFeatureCount: features.length,
      sampledPointCount,
      maximumEdgeDriftDeg,
      boundaryToleranceDeg,
      maxEdgeDriftDeg,
    },
  };
}

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) throw new Error(`unexpected argument: ${token}`);
    const key = token.slice(2);
    const value = argv[index + 1];
    if (key === "ocean-only") {
      args[key] = true;
      continue;
    }
    if (!value || value.startsWith("--")) throw new Error(`missing value for --${key}`);
    args[key] = value;
    index += 1;
  }
  return args;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function runCli() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (!args.file) throw new Error("usage: node tools/check_water_geometry.mjs --file <topology.json> [--object water_regions] [--land-object land] [--ocean-object ocean] [--profile base|tno] [--feature-group ocean_macro] [--ocean-only]");
    const topology = readJson(args.file);
    const profile = args.profile ? BUILTIN_PROFILES[args.profile] : [];
    if (args.profile && !profile) throw new Error(`unknown profile: ${args.profile}`);
    const result = validateWaterGeometry(topology, {
      objectName: args.object ?? (topology.objects?.water_regions ? "water_regions" : "scenario_water"),
      land: args["land-object"] ? { topology, objectName: args["land-object"] } : null,
      ocean: args["ocean-object"] ? { topology, objectName: args["ocean-object"] } : null,
      probes: profile,
      featureGroup: args["feature-group"],
      oceanOnly: Boolean(args["ocean-only"]),
      boundaryToleranceDeg: args["boundary-tolerance"] == null ? undefined : Number(args["boundary-tolerance"]),
      maxEdgeDriftDeg: args["max-edge-drift"] == null ? undefined : Number(args["max-edge-drift"]),
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    process.stderr.write(`${error.stack ?? error.message ?? String(error)}\n`);
    process.exitCode = 2;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) runCli();
