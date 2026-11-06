import { createHitTestingOwner } from "../js/core/map_renderer/hit_testing_owner.js";
import test from "node:test";
import assert from "node:assert/strict";
import { getRiverPaintRuntime } from "../js/core/river_paint/runtime.js";
import {
  collectSpatialGridCandidates,
  createHitResult,
  findFirstContainingCandidate,
  rankCandidates,
  shouldPreferWaterHit,
  toHitResult,
} from "../js/core/map_renderer/interaction_hit_candidates.js";

function makeCandidate(id, {
  source = "primary",
  bboxArea = 100,
  distanceProj = 0,
  contains = true,
} = {}) {
  return {
    item: {
      id,
      featureId: id,
      feature: {
        properties: {
          __source: source,
          contains,
        },
      },
      minX: 0,
      minY: 0,
      maxX: 10,
      maxY: 10,
      bboxArea,
    },
    distanceProj,
  };
}

test("collectSpatialGridCandidates dedupes bucket and global items inside radius", () => {
  const local = { id: "local", minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const hidden = { id: "hidden", minX: 0, minY: 0, maxX: 10, maxY: 10 };
  const far = { id: "far", minX: 40, minY: 40, maxX: 50, maxY: 50 };
  const grid = new Map([
    ["0:0", [local, hidden, far]],
  ]);
  const candidates = collectSpatialGridCandidates({
    grid,
    gridMeta: {
      cellSize: 20,
      cols: 2,
      rows: 2,
      globals: [local],
    },
    px: 5,
    py: 5,
    radiusProj: 0,
    getSpatialBucketKey: (col, row) => `${col}:${row}`,
    shouldIncludeItem: (item) => item.id !== "hidden",
  });

  assert.deepEqual(candidates.map((candidate) => candidate.item.id), ["local"]);
});

test("rankCandidates prefers containing detail candidates and records metric shape", () => {
  const calls = [];
  const ranked = rankCandidates(
    [
      makeCandidate("primary-small", { source: "primary", bboxArea: 10, contains: true }),
      makeCandidate("detail-large", { source: "detail", bboxArea: 50, contains: true }),
      makeCandidate("outside", { source: "detail", bboxArea: 1, contains: false }),
    ],
    [0, 0],
    {
      eventType: "click",
      targetType: "land",
      geoContains: (feature) => !!feature?.properties?.contains,
      nowMs: () => 10,
      recordInteractionDurationMetric: (...args) => calls.push(args),
    },
  );

  assert.deepEqual(ranked.map((candidate) => candidate.item.id), [
    "detail-large",
    "primary-small",
    "outside",
  ]);
  assert.equal(calls[0][0], "interactionHitRankDuration");
  assert.equal(calls[0][2].candidateCount, 3);
  assert.equal(calls[0][2].geoContainsCount, 3);
  assert.equal(calls[0][2].containsGeoCount, 2);
});

test("findFirstContainingCandidate keeps hover fast path metric", () => {
  const calls = [];
  const match = findFirstContainingCandidate(
    [
      makeCandidate("outside-detail", { source: "detail", contains: false }),
      makeCandidate("inside-primary", { source: "primary", contains: true }),
    ],
    [0, 0],
    {
      eventType: "hover",
      targetType: "water",
      geoContains: (feature) => !!feature?.properties?.contains,
      nowMs: () => 20,
      recordInteractionDurationMetric: (...args) => calls.push(args),
    },
  );

  assert.equal(match.item.id, "inside-primary");
  assert.equal(match.containsGeo, true);
  assert.equal(calls[0][2].fastPath, "hover-first-containing");
  assert.equal(calls[0][2].geoContainsCount, 2);
});

test("toHitResult resolves runtime and interaction country codes through injected policy", () => {
  const hit = toHitResult(makeCandidate("F1"), {
    targetType: "land",
    zoomK: 2,
    strict: true,
    canonicalCountryCode: (value) => String(value || "").toUpperCase(),
    getFeatureCountryCodeNormalized: () => "aa",
    getFeatureInteractionCountryCodeNormalized: () => "BB",
  });

  assert.equal(hit.id, "F1");
  assert.equal(hit.targetType, "land");
  assert.equal(hit.countryCode, "BB");
  assert.equal(hit.runtimeCountryCode, "AA");
  assert.equal(hit.distancePx, 0);
  assert.equal(createHitResult().hitSource, "none");
});

test("shouldPreferWaterHit keeps macro hover low priority and lake strict hits high priority", () => {
  const landHit = { id: "land", bboxArea: 100 };
  const macroWaterHit = { id: "ocean", feature: { properties: { macro: true } }, bboxArea: 1, strict: true };
  const lakeHit = { id: "lake", feature: { properties: { type: "lake" } }, bboxArea: 90, strict: true };

  assert.equal(
    shouldPreferWaterHit(landHit, macroWaterHit, {
      eventType: "hover",
      isMacroOceanWaterRegion: (feature) => !!feature?.properties?.macro,
    }),
    false,
  );
  assert.equal(
    shouldPreferWaterHit(landHit, lakeHit, {
      eventType: "click",
      getWaterRegionType: (feature) => feature?.properties?.type || "",
    }),
    true,
  );
  lakeHit.feature.properties.type = "reservoir";
  assert.equal(shouldPreferWaterHit(landHit, lakeHit, {
    eventType: "click", getWaterRegionType: (feature) => feature.properties.type,
  }), true);
});

function createRendererHitHarness({ candidatesByKey }) {
  const gridCalls = [];
  const metrics = [];
  const pointer = { px: 5, py: 5, zoomK: 1, lonLat: [0, 0] };
  const state = {
    landData: { features: [] }, spatialItems: [{}], waterSpatialItems: [{}], specialSpatialItems: [{}],
    showWaterRegions: true, showScenarioSpecialRegions: true,
    spatialGridMeta: { cellSize: 100, cols: 1, rows: 1 },
    waterSpatialGridMeta: { cellSize: 100, cols: 1, rows: 1 },
    specialSpatialGridMeta: { cellSize: 100, cols: 1, rows: 1 },
  };
  const projection = Object.assign(() => [0, 0], { invert: () => pointer.lonLat });
  const priorD3 = globalThis.d3;
  const deps = new Proxy({
    getRiverPaintRuntime,
    getMapSvg: () => ({}), getProjection: () => projection,
    readSearchParam: () => "spatial",
    isWaterRegionEnabled: () => true, isSpecialRegionEnabled: () => true,
    canonicalCountryCode: value => value,
    getWaterRegionType: () => "lake",
    nowMs: () => 0,
    incrementPerfCounter: (name, count) => metrics.push(["counter", name, count]),
    recordRenderPerfMetric: (name, _duration, payload) => metrics.push([name, structuredClone(payload)]),
    getSpatialBucketKey: () => "0:0",
  }, { get: (target, name) => target[name] || (() => false) });
  const owner = createHitTestingOwner({ state, deps });
  for (const type of ["land", "water", "special"]) {
    const key = type === "land" ? "spatialGrid" : type + "SpatialGrid";
    state[key] = { get: () => {
      gridCalls.push(type);
      return [0, 5].flatMap(radius => (candidatesByKey[type + ":" + radius] || []).map(c => ({
        ...c.item, minX: 5 + radius, maxX: 5 + radius, minY: 5, maxY: 5, bboxArea: 1,
      })));
    } };
  }
  return { gridCalls, metrics, hit: (options) => {
    globalThis.d3 = { pointer: () => [5, 5], zoomIdentity: { x: 0, y: 0, k: 1 }, geoContains: feature => !!feature.contains };
    try { return owner.getHitFromEvent({}, options); } finally { globalThis.d3 = priorD3; }
  } };
}

function rendererCandidate(id) {
  return { item: { id, feature: { contains: true } }, distanceProj: 0 };
}

for (const [label, options, candidatesByKey, expectedAfter, expectedId] of [
  ["brush strict", { enableSnap: false, snapPx: 0, eventType: "brush" },
    { "land:0": [rendererCandidate("land")] }, 3, "land"],
  ["click water snap", { enableSnap: true, snapPx: 5, eventType: "click" },
    { "water:5": [rendererCandidate("water")] }, 6, "water"],
  ["click special strict", { enableSnap: true, snapPx: 5, eventType: "click" },
    { "special:0": [rendererCandidate("special")] }, 6, "special"],
]) {
  test(`${label} shares exact grid candidates with diagnostics without changing the hit or counts`, () => {
    const after = createRendererHitHarness({ candidatesByKey });
    const currentHit = after.hit(options);
    assert.equal(currentHit.id, expectedId);
    assert.equal(after.gridCalls.length, expectedAfter);
    assert.equal(currentHit.targetType, expectedId);
    assert.equal(currentHit.viaSnap, label === "click water snap");
    const count = key => (candidatesByKey[key] || []).length;
    assert.deepEqual(after.metrics.find(entry => entry[0] === "interactionHitCandidateCount")[1], {
      eventType: options.eventType,
      specialCandidateCount: count("special:0"),
      landStrictCandidateCount: count("land:0"),
      landSnapCandidateCount: 0,
      waterStrictCandidateCount: 0,
      waterSnapCandidateCount: count("water:5"),
      resolvedTargetType: expectedId,
      totalCandidateCount: 1,
    });
  });
}

test("hover avoids event candidate caching and keeps its existing lightweight metric path", () => {
  const h = createRendererHitHarness({ candidatesByKey: {
    "water:0": [rendererCandidate("water")],
  } });
  assert.equal(h.hit({ enableSnap: false, snapPx: 0, eventType: "hover" }).id, "water");
  assert.deepEqual(h.gridCalls, ["special", "land", "water"]);
  assert.equal(h.metrics.filter((entry) => entry[0] === "interactionHitCandidateCount").length, 0);
});

for (const eventType of ['click', 'brush']) {
  test(`${eventType} first containment preserves overlap, hole and malformed-geometry priority`, () => {
    const candidates = [
      makeCandidate('primary', { bboxArea: 1 }),
      makeCandidate('detail-z', { source: 'detail', bboxArea: 30 }),
      makeCandidate('detail-a', { source: 'detail', bboxArea: 30 }),
      makeCandidate('hole', { source: 'detail', bboxArea: 2, contains: false }),
      makeCandidate('broken', { source: 'detail', bboxArea: 1 }),
    ];
    candidates[4].item.feature.properties.broken = true;
    const geoContains = feature => {
      if (feature.properties.broken) throw Error('malformed');
      return feature.properties.contains;
    };
    const oracle = rankCandidates(candidates, [0, 0], { geoContains }).find(c => c.containsGeo);
    let checks = 0;
    const winner = findFirstContainingCandidate(candidates, [0, 0], { eventType,
      geoContains: feature => { checks++; return geoContains(feature); } });
    assert.equal(winner.item.id, 'detail-a');
    assert.deepEqual(winner, oracle);
    assert.equal(checks, 3, 'lower-priority containing geometries are never evaluated');
    candidates.forEach(c => { c.item.feature.properties.contains = false; });
    assert.equal(findFirstContainingCandidate(candidates, [0, 0], { geoContains }), null);
  });
}
