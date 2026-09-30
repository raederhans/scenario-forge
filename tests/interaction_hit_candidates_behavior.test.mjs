import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";
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

const rendererSource = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const hitFunctionNames = new Set([
  "createInteractionHitCandidateCollector", "collectInteractionHitMetricDetails", "recordInteractionHitMetrics",
  "getLandHitFromPointer", "getWaterHitFromPointer", "getSpecialHitFromPointer", "getHitFromEvent",
]);
const hitFunctionSources = parse(rendererSource, { ecmaVersion: "latest", sourceType: "module" }).body
  .filter((node) => node.type === "FunctionDeclaration" && hitFunctionNames.has(node.id.name))
  .map((node) => rendererSource.slice(node.start, node.end));
assert.equal(hitFunctionSources.length, hitFunctionNames.size);

function createRendererHitHarness({ cacheEnabled, candidatesByKey }) {
  const gridCalls = [];
  const metrics = [];
  const pointer = { px: 5, py: 5, zoomK: 1, lonLat: [0, 0] };
  const collect = (type, _px, _py, radius) => {
    gridCalls.push(`${type}:${radius}`);
    return candidatesByKey[`${type}:${radius}`] || [];
  };
  const scope = vm.createContext({
    getRiverPaintRuntime,
    runtimeState: {
      landData: { features: [] }, spatialItems: [{}], waterSpatialItems: [{}], specialSpatialItems: [{}],
      showWaterRegions: true, showScenarioSpecialRegions: true,
    },
    HIT_SNAP_RADIUS_PX: 5,
    getPointerProjectionPosition: () => pointer,
    collectSpecialGridCandidates: (...args) => collect("special", ...args),
    collectGridCandidates: (...args) => collect("land", ...args),
    collectWaterGridCandidates: (...args) => collect("water", ...args),
    resolveHitMode: () => "spatial",
    rankCandidates: (candidates) => candidates.map((candidate) => ({ ...candidate, containsGeo: !!candidate.item.feature.contains })),
    findFirstContainingCandidate: (candidates) => candidates.find((candidate) => candidate.item.feature.contains) || null,
    toHitResult: (candidate, options) => ({
      id: candidate.item.id, targetType: options.targetType, feature: candidate.item.feature,
      hitSource: "spatial", strict: options.strict, viaSnap: options.viaSnap,
    }),
    createHitResult,
    shouldPreferWaterHit: (_land, water) => !!water?.id,
    isScenarioWaterRegion: () => false,
    isMacroOceanWaterRegion: () => false,
    shouldSuppressOpenOceanHit: () => false,
    isOpenOceanOverlayActive: () => false,
    isLakeInteractionEnabled: () => false,
    incrementPerfCounter: (name, count) => metrics.push(["counter", name, count]),
    recordRenderPerfMetric: (name, _duration, payload) => metrics.push([name, structuredClone(payload)]),
  });
  const code = hitFunctionSources.map((source) => cacheEnabled ? source : source.replace(
    'const candidateCollector = eventType === "hover" ? null : createInteractionHitCandidateCollector(pointer);',
    "const candidateCollector = null;",
  )).join("\n");
  vm.runInContext(code, scope);
  return {
    gridCalls,
    metrics,
    hit: (options) => scope.getHitFromEvent({}, options),
  };
}

function rendererCandidate(id) {
  return { item: { id, feature: { contains: true } }, distanceProj: 0 };
}

for (const [label, options, candidatesByKey, expectedBefore, expectedAfter, expectedId] of [
  ["brush strict", { enableSnap: false, snapPx: 0, eventType: "brush" },
    { "land:0": [rendererCandidate("land")] }, 6, 3, "land"],
  ["click water snap", { enableSnap: true, snapPx: 5, eventType: "click" },
    { "water:5": [rendererCandidate("water")] }, 12, 6, "water"],
  ["click special strict", { enableSnap: true, snapPx: 5, eventType: "click" },
    { "special:0": [rendererCandidate("special")] }, 7, 6, "special"],
]) {
  test(`${label} shares exact grid candidates with diagnostics without changing the hit or counts`, () => {
    const before = createRendererHitHarness({ cacheEnabled: false, candidatesByKey });
    const after = createRendererHitHarness({ cacheEnabled: true, candidatesByKey });
    const priorHit = before.hit(options);
    const currentHit = after.hit(options);
    assert.deepEqual(currentHit, priorHit);
    assert.equal(currentHit.id, expectedId);
    assert.deepEqual(after.metrics, before.metrics);
    assert.equal(before.gridCalls.length, expectedBefore);
    assert.equal(after.gridCalls.length, expectedAfter);
  });
}

test("hover avoids event candidate caching and keeps its existing lightweight metric path", () => {
  const h = createRendererHitHarness({ cacheEnabled: true, candidatesByKey: {
    "water:0": [rendererCandidate("water")],
  } });
  assert.equal(h.hit({ enableSnap: false, snapPx: 0, eventType: "hover" }).id, "water");
  assert.deepEqual(h.gridCalls, ["special:0", "land:0", "water:0"]);
  assert.equal(h.metrics.filter((entry) => entry[0] === "interactionHitCandidateCount").length, 0);
});
