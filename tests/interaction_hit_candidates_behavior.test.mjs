import test from "node:test";
import assert from "node:assert/strict";
import { collectSpatialGridCandidates, findFirstContainingCandidate, rankCandidates, shouldPreferWaterHit } from "../js/core/map_renderer/interaction_hit_candidates.js";

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

test("strict lake hits take priority over land", () => {
  const landHit = { id: "land", bboxArea: 100 };
  const lakeHit = { id: "lake", feature: { properties: { type: "lake" } }, bboxArea: 90, strict: true };

  assert.equal(
    shouldPreferWaterHit(landHit, lakeHit, {
      eventType: "click",
      getWaterRegionType: (feature) => feature?.properties?.type || "",
    }),
    true,
  );
});

test("click containment preserves overlap, hole and malformed-geometry priority", () => {
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
  const winner = findFirstContainingCandidate(candidates, [0, 0], { eventType: "click", geoContains });
  assert.equal(winner.item.id, 'detail-a');
  assert.deepEqual(winner, oracle);
  candidates.forEach(c => { c.item.feature.properties.contains = false; });
  assert.equal(findFirstContainingCandidate(candidates, [0, 0], { geoContains }), null);
});
