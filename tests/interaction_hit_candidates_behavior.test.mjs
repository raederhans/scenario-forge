import test from "node:test";
import assert from "node:assert/strict";
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
