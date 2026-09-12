import assert from "node:assert/strict";
import test from "node:test";

import { createProjectedGeometryBoundsOwner } from "../js/core/renderer/projected_geometry_bounds_owner.js";
import { markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";

function firstLon(geoObject) {
  const geometry = geoObject?.type === "Feature" ? geoObject.geometry : geoObject;
  return Number(geometry?.coordinates?.[0]?.[0]?.[0]);
}

function createHarness({
  pathBounds = () => [[1, 2], [11, 22]],
  pathCanvasEnabled = true,
  pathSvgBounds = null,
  projection = ([lon, lat]) => [lon * 10 + 1, lat * -5 + 2],
  d3 = null,
  features = {},
} = {}) {
  const harnessStore = {
    activeScenarioId: "tno_1962",
    projectedBoundsById: new Map(),
  };
  const calls = {
    pathBounds: 0,
    d3GeoArea: 0,
    d3GeoBounds: 0,
    resetHostWaterPathCaches: 0,
    metrics: [],
    warnings: [],
    svgPathBounds: 0,
  };
  const path = {
    bounds(geoObject) {
      calls.pathBounds += 1;
      return pathBounds(geoObject);
    },
  };
  const svgPath = {
    bounds(geoObject) {
      calls.svgPathBounds += 1;
      return pathSvgBounds(geoObject);
    },
  };
  const owner = createProjectedGeometryBoundsOwner({
    state: harnessStore,
    getters: {
      getProjection: () => projection,
      getPathCanvas: () => (pathCanvasEnabled ? path : null),
      getPathSvg: () => (pathSvgBounds ? svgPath : null),
      getLandFeatures: () => features.land || [],
      getRiverFeatures: () => features.rivers || [],
      getActiveScenarioId: () => harnessStore.activeScenarioId,
      getD3: () => d3,
    },
    helpers: {
      getFeatureId: (feature) => String(feature?.properties?.id || feature?.id || ""),
      recordRenderPerfMetric: (name, duration, payload) => calls.metrics.push({ name, duration, payload }),
      recordProjectedBoundsDiagnosticsState: (feature, reason) => ({ feature, reason }),
      resetHostWaterPathCaches: () => {
        calls.resetHostWaterPathCaches += 1;
      },
      warn: (...args) => calls.warnings.push(args.join(" ")),
    },
  });
  return { calls, owner, harnessStore };
}

function createFeature(id, geometry) {
  return {
    type: "Feature",
    id,
    properties: { id },
    geometry,
  };
}

function createPolygon(firstCoordinate) {
  const [lon, lat] = firstCoordinate;
  return {
    type: "Polygon",
    coordinates: [[
      [lon, lat],
      [lon + 1, lat],
      [lon + 1, lat + 1],
      [lon, lat + 1],
      [lon, lat],
    ]],
  };
}

function createD3Diagnostics() {
  const calls = { geoArea: 0, geoBounds: 0 };
  return {
    calls,
    d3: {
      geoArea(geoObject) {
        calls.geoArea += 1;
        return firstLon(geoObject) === 500 ? Math.PI * 3 : 1;
      },
      geoBounds(geoObject) {
        calls.geoBounds += 1;
        return firstLon(geoObject) === 999
          ? [[-180, -90], [180, 90]]
          : [[10, 20], [20, 30]];
      },
    },
  };
}

test("computeProjectedCoordinateBounds handles features raw geometry and missing projection", () => {
  const { owner } = createHarness();
  const geometry = createPolygon([1, 2]);
  const expectedBounds = {
    minX: 11,
    minY: -13,
    maxX: 21,
    maxY: -8,
    width: 10,
    height: 5,
    area: 50,
  };

  assert.deepEqual(owner.computeProjectedCoordinateBounds(createFeature("A", geometry)), expectedBounds);
  assert.deepEqual(owner.computeProjectedCoordinateBounds(geometry), expectedBounds);
  assert.equal(createHarness({ projection: null }).owner.computeProjectedCoordinateBounds(geometry), null);
  assert.equal(
    createHarness({ projection: () => [NaN, Infinity] }).owner.computeProjectedCoordinateBounds(geometry),
    null,
  );
});

test("getProjectedFeatureBounds caches computed bounds by feature id", () => {
  const { calls, owner, harnessStore } = createHarness();
  const feature = createFeature("A", createPolygon([0, 0]));

  assert.deepEqual(owner.getProjectedFeatureBounds(feature), {
    minX: 1,
    minY: 2,
    maxX: 11,
    maxY: 22,
    width: 10,
    height: 20,
    area: 200,
  });
  assert.equal(harnessStore.projectedBoundsById.has("A"), true);
  assert.equal(owner.getProjectedFeatureBounds(feature), harnessStore.projectedBoundsById.get("A"));
  assert.equal(calls.pathBounds, 1);
  assert.equal(owner.getProjectedFeatureBounds(createFeature("B", createPolygon([0, 0])), { allowCompute: false }), null);
});

test("public cache initialization stays lazy and preserves the spherical diagnostics holder", () => {
  const { owner, harnessStore } = createHarness();
  delete harnessStore.projectedBoundsById;
  const diagnostics = new Map([["existing", {}]]);
  harnessStore.sphericalFeatureDiagnosticsById = diagnostics;
  const feature = createFeature("A", createPolygon([0, 0]));
  const computed = owner.computeProjectedFeatureBounds(feature);
  assert.equal(Object.hasOwn(harnessStore, "projectedBoundsById"), false);
  assert.equal(owner.getProjectedFeatureBounds(feature, { allowCompute: false }), computed);
  assert.equal(harnessStore.projectedBoundsById.get("A"), computed);
  assert.equal(harnessStore.sphericalFeatureDiagnosticsById, diagnostics);
});

test("external public Map replacement is honored without recomputing or retaining the old Map", () => {
  const { owner, calls, harnessStore } = createHarness();
  const feature = createFeature("A", createPolygon([0, 0]));
  const bounds = owner.getProjectedFeatureBounds(feature);
  const oldMap = harnessStore.projectedBoundsById;
  const replacement = new Map([["external", {}]]);
  harnessStore.projectedBoundsById = replacement;
  assert.equal(owner.getProjectedFeatureBounds(feature, { allowCompute: false }), bounds);
  assert.equal(replacement.get("A"), bounds);
  assert.equal(calls.pathBounds, 1);
  owner.clearProjectedBoundsCache();
  assert.equal(replacement.size, 0);
  assert.equal(oldMap.get("A"), bounds);
  assert.equal(owner.getProjectedFeatureBounds(feature, { allowCompute: false }), null);
});

test("null bounds delete stale IDs and a failed clear does not run later host cleanup", () => {
  const { owner, calls, harnessStore } = createHarness({ projection: null, pathBounds: () => null });
  harnessStore.projectedBoundsById.set("A", {});
  assert.equal(owner.getProjectedFeatureBounds(createFeature("A", createPolygon([0, 0]))), null);
  assert.equal(harnessStore.projectedBoundsById.has("A"), false);
  class FailingMap extends Map { clear() { throw new Error("clear failed"); } }
  harnessStore.projectedBoundsById = new FailingMap();
  assert.throws(() => owner.clearProjectedBoundsCache(), /clear failed/);
  assert.equal(calls.resetHostWaterPathCaches, 0);
});

test("projected geometry cache reuses spatial precomputation but rejects replaced geometry and projection", () => {
  let offset = 0;
  const projection = (point) => point;
  const { owner, calls, harnessStore } = createHarness({ projection,
    pathBounds: (feature) => [[firstLon(feature) + offset, 0], [firstLon(feature) + offset + 1, 1]] });
  const first = createFeature("A", createPolygon([1, 0]));
  const prepared = owner.computeProjectedFeatureBounds(first);
  assert.equal(owner.getProjectedFeatureBounds(first, { allowCompute: false }), prepared);
  assert.equal(calls.pathBounds, 1);
  harnessStore.zoomTransform = { x: 200, y: -20, k: 4 };
  harnessStore.dpr = 2;
  harnessStore.colorRevision = 3;
  assert.equal(owner.getProjectedFeatureBounds({ ...first }), prepared);
  assert.equal(calls.pathBounds, 1);
  const replacement = createFeature("A", createPolygon([30, 0]));
  assert.equal(owner.getProjectedFeatureBounds(replacement, { allowCompute: false }), null);
  assert.equal(owner.getProjectedFeatureBounds(replacement).minX, 30);
  assert.equal(calls.pathBounds, 2);
  offset = 10;
  markProjectionGeometryChanged(projection);
  assert.equal(owner.getProjectedFeatureBounds(replacement, { allowCompute: false }), null);
  assert.equal(owner.getProjectedFeatureBounds(replacement).minX, 40);
  assert.equal(calls.pathBounds, 3);
  harnessStore.activeScenarioId = "other";
  assert.equal(owner.getProjectedFeatureBounds(replacement, { allowCompute: false }), null);
  owner.getProjectedFeatureBounds(replacement);
  assert.equal(calls.pathBounds, 4);
});

test("computeProjectedGeoBounds falls back to coordinate projection when path bounds fail", () => {
  const feature = createFeature("A", createPolygon([1, 2]));
  const svgHarness = createHarness({
    pathCanvasEnabled: false,
    pathSvgBounds: () => [[3, 4], [13, 24]],
  });
  assert.deepEqual(svgHarness.owner.computeProjectedGeoBounds(feature), {
    minX: 3,
    minY: 4,
    maxX: 13,
    maxY: 24,
    width: 10,
    height: 20,
    area: 200,
  });
  assert.equal(svgHarness.calls.svgPathBounds, 1);

  const throwingHarness = createHarness({
    pathBounds: () => {
      throw new Error("path unavailable");
    },
  });
  assert.deepEqual(throwingHarness.owner.computeProjectedGeoBounds(feature), {
    minX: 11,
    minY: -13,
    maxX: 21,
    maxY: -8,
    width: 10,
    height: 5,
    area: 50,
  });

  const invalidHarness = createHarness({ pathBounds: () => [[NaN, 0], [1, 1]] });
  assert.deepEqual(invalidHarness.owner.computeProjectedGeoBounds(feature), throwingHarness.owner.computeProjectedGeoBounds(feature));

  const skippedPointHarness = createHarness({
    pathBounds: () => {
      throw new Error("path unavailable");
    },
    projection: ([lon, lat]) => (lon === 2 && lat === 2 ? [NaN, 0] : [lon, lat]),
  });
  assert.deepEqual(skippedPointHarness.owner.computeProjectedGeoBounds(feature), {
    minX: 1,
    minY: 2,
    maxX: 2,
    maxY: 3,
    width: 1,
    height: 1,
    area: 1,
  });
});

test("rebuildProjectedBoundsCache rebuilds land and river feature entries", () => {
  const land = createFeature("LAND", createPolygon([0, 0]));
  const river = createFeature("RIVER", createPolygon([1, 1]));
  const missingId = createFeature("", createPolygon([2, 2]));
  const { owner, harnessStore } = createHarness({
    features: { land: [land, missingId], rivers: [river] },
  });
  harnessStore.projectedBoundsById.set("stale", { minX: 0, minY: 0, maxX: 0, maxY: 0, width: 0, height: 0, area: 0 });

  owner.rebuildProjectedBoundsCache();

  assert.deepEqual(Array.from(harnessStore.projectedBoundsById.keys()), ["LAND", "RIVER"]);
});

test("mergeProjectedBounds ignores empty lists and merges valid bounds", () => {
  const { owner } = createHarness();

  assert.equal(owner.mergeProjectedBounds([]), null);
  assert.equal(owner.mergeProjectedBounds([{ minX: "bad", minY: 0, maxX: 1, maxY: 1 }]), null);
  assert.deepEqual(owner.mergeProjectedBounds([
    { minX: 10, minY: 0, maxX: 20, maxY: 10 },
    { minX: 0, minY: 2, maxX: 12, maxY: 30 },
  ]), {
    minX: 0,
    minY: 0,
    maxX: 20,
    maxY: 30,
    width: 20,
    height: 30,
    area: 600,
  });
});

test("mergeProjectedBounds handles 150000 bounds without argument spreading", () => {
  const { owner } = createHarness();
  const bounds = Array.from({ length: 150000 }, (_, index) => ({
    minX: index, minY: -index, maxX: index + 1, maxY: 2,
  }));
  assert.deepEqual(owner.mergeProjectedBounds(bounds), {
    minX: 0, minY: -149999, maxX: 150000, maxY: 2,
    width: 150000, height: 150001, area: 22500150000,
  });
});

test("mergeProjectedBounds preserves falsy filtering and numeric coercion", () => {
  const { owner } = createHarness();
  const valid = { minX: "-2", minY: null, maxX: "3", maxY: true };
  assert.deepEqual(owner.mergeProjectedBounds([null, false, undefined, 0, valid]), {
    minX: -2, minY: 0, maxX: 3, maxY: 1, width: 5, height: 1, area: 5,
  });
  for (const invalid of [{}, { ...valid, minX: NaN }, { ...valid, maxY: Infinity }]) {
    assert.equal(owner.mergeProjectedBounds([valid, invalid]), null);
  }
  for (const empty of [null, {}, [], [null, false, undefined]]) {
    assert.equal(owner.mergeProjectedBounds(empty), null);
  }
});

test("coordinate fallback includes nested geometry and feature collections", () => {
  const collection = {
    type: "FeatureCollection",
    features: [
      createFeature("empty", null),
      createFeature("nested", {
        type: "GeometryCollection",
        geometries: [
          { type: "GeometryCollection", geometries: [] },
          { type: "Point", coordinates: ["-3", "2"] },
          { type: "GeometryCollection", geometries: [
            { type: "LineString", coordinates: [[1, 4], [5, -2]] },
            { type: "Point", coordinates: [NaN, 0] },
          ] },
        ],
      }),
    ],
  };
  const expected = {
    minX: -29, minY: -18, maxX: 51, maxY: 12,
    width: 80, height: 30, area: 2400,
  };
  for (const pathBounds of [
    () => { throw new Error("path unavailable"); },
    () => [[Infinity, Infinity], [-Infinity, -Infinity]],
  ]) {
    const { owner } = createHarness({ pathBounds });
    assert.deepEqual(owner.computeProjectedGeoBounds(collection), expected);
    assert.deepEqual(owner.computeProjectedCoordinateBounds(collection.features[1].geometry), expected);
    assert.equal(owner.computeProjectedGeoBounds({
      type: "FeatureCollection", features: [createFeature("empty", {
        type: "GeometryCollection", geometries: [{ type: "GeometryCollection", geometries: [] }],
      })],
    }), null);
  }
});

test("malformed nested path bounds use coordinate fallback", () => {
  const feature = createFeature("A", createPolygon([1, 2]));
  const expected = createHarness().owner.computeProjectedCoordinateBounds(feature);
  for (const bounds of [[null, null], [undefined, [1, 2]], [[1, 2], null], [[], []]]) {
    const { owner } = createHarness({ pathBounds: () => bounds });
    assert.deepEqual(owner.computeProjectedGeoBounds(feature), expected);
  }
});

test("spherical diagnostics cache d3 results by geo object identity", () => {
  const diagnostics = createD3Diagnostics();
  const { owner } = createHarness({ d3: diagnostics.d3 });
  const geometry = createPolygon([10, 10]);

  assert.deepEqual(owner.getSphericalGeometryDiagnostics(geometry), {
    area: 1,
    bounds: [[10, 20], [20, 30]],
    isWorldBounds: false,
    hasExcessiveSphereArea: false,
    invalid: false,
  });
  assert.equal(owner.getSphericalGeometryDiagnostics(geometry)?.invalid, false);
  assert.deepEqual(diagnostics.calls, { geoArea: 1, geoBounds: 1 });
});

test("spherical diagnostics mark world bounds and excessive sphere area invalid", () => {
  const diagnostics = createD3Diagnostics();
  const { owner } = createHarness({ d3: diagnostics.d3 });

  assert.equal(owner.getSphericalGeometryDiagnostics(createPolygon([999, 0]))?.isWorldBounds, true);
  assert.equal(owner.getSphericalGeometryDiagnostics(createPolygon([500, 0]))?.hasExcessiveSphereArea, true);
  assert.equal(owner.isSphericalGeometryUnsafe(createPolygon([999, 0])), true);
});

test("collectPolygonalGeometryParts flattens polygonal geometry collections", () => {
  const { owner } = createHarness();
  const polygon = createPolygon([0, 0]);
  const multiPolygon = {
    type: "MultiPolygon",
    coordinates: [
      createPolygon([1, 1]).coordinates,
      createPolygon([2, 2]).coordinates,
    ],
  };
  const collection = {
    type: "GeometryCollection",
    geometries: [polygon, multiPolygon, { type: "Point", coordinates: [0, 0] }],
  };

  assert.equal(owner.collectPolygonalGeometryParts(polygon).length, 1);
  assert.equal(owner.collectPolygonalGeometryParts(multiPolygon).length, 2);
  assert.equal(owner.collectPolygonalGeometryParts(collection).length, 3);
});

test("sanitizeWaterRegionFeatures removes D3-unsafe parts and warns once per scenario feature set", () => {
  const diagnostics = createD3Diagnostics();
  const { calls, owner, harnessStore } = createHarness({ d3: diagnostics.d3 });
  const feature = createFeature("WATER", {
    type: "MultiPolygon",
    coordinates: [
      createPolygon([999, 0]).coordinates,
      createPolygon([10, 0]).coordinates,
    ],
  });

  const [sanitized] = owner.sanitizeWaterRegionFeatures([feature]);

  assert.equal(sanitized.geometry.type, "Polygon");
  assert.deepEqual(sanitized.geometry.coordinates, createPolygon([10, 0]).coordinates);
  assert.deepEqual(calls.metrics, [{
    name: "waterSphericalSanitization",
    duration: 0,
    payload: {
      removedPartCount: 1,
      featureIds: ["WATER"],
    },
  }]);
  assert.equal(calls.warnings.length, 1);

  owner.sanitizeWaterRegionFeatures([feature]);
  assert.equal(calls.warnings.length, 1);

  harnessStore.activeScenarioId = "alternate";
  owner.sanitizeWaterRegionFeatures([feature]);
  assert.equal(calls.warnings.length, 2);
});

test("sanitizeWaterRegionFeature builds multipolygon when multiple safe parts remain", () => {
  const diagnostics = createD3Diagnostics();
  const { owner } = createHarness({ d3: diagnostics.d3 });
  const feature = createFeature("WATER", {
    type: "MultiPolygon",
    coordinates: [
      createPolygon([999, 0]).coordinates,
      createPolygon([10, 0]).coordinates,
      createPolygon([20, 0]).coordinates,
    ],
  });

  const partInfo = owner.collectSafeWaterRegionGeometryPartsInfo(feature);
  const sanitized = owner.sanitizeWaterRegionFeature(feature);

  assert.equal(partInfo.rawCount, 3);
  assert.equal(partInfo.removedCount, 1);
  assert.equal(partInfo.parts.length, 2);
  assert.equal(sanitized.geometry.type, "MultiPolygon");
  assert.deepEqual(sanitized.geometry.coordinates, [
    createPolygon([10, 0]).coordinates,
    createPolygon([20, 0]).coordinates,
  ]);
});

test("sanitizeWaterRegionFeatures drops features whose parts all become unsafe", () => {
  const diagnostics = createD3Diagnostics();
  const { calls, owner } = createHarness({ d3: diagnostics.d3 });
  const feature = createFeature("UNSAFE", createPolygon([999, 0]));

  assert.equal(owner.sanitizeWaterRegionFeature(feature), null);
  assert.deepEqual(owner.sanitizeWaterRegionFeatures([feature]), []);
  assert.equal(calls.metrics[0].name, "waterSphericalSanitization");
  assert.deepEqual(calls.metrics[0].payload, {
    removedPartCount: 1,
    featureIds: ["UNSAFE"],
  });
  assert.equal(calls.warnings.length, 1);
});

test("clearProjectedBoundsCache clears projected bounds and triggers host water path cleanup", () => {
  const diagnostics = createD3Diagnostics();
  const { calls, owner, harnessStore } = createHarness({ d3: diagnostics.d3 });
  const geometry = createPolygon([10, 10]);
  harnessStore.projectedBoundsById.set("A", { minX: 1, minY: 2, maxX: 3, maxY: 4, width: 2, height: 2, area: 4 });
  owner.getSphericalGeometryDiagnostics(geometry);

  owner.clearProjectedBoundsCache();
  owner.getSphericalGeometryDiagnostics(geometry);

  assert.equal(harnessStore.projectedBoundsById.size, 0);
  assert.equal(calls.resetHostWaterPathCaches, 1);
  assert.deepEqual(diagnostics.calls, { geoArea: 1, geoBounds: 1 });
});
