import test from "node:test";
import assert from "node:assert/strict";
import { buildWaterSpatialItems } from "../js/core/renderer/spatial_index_runtime_builders.js";

function bounds(seed) {
  return {
    minX: seed,
    minY: seed + 1,
    maxX: seed + 2,
    maxY: seed + 3,
    area: seed + 4,
  };
}

test("water parts retain their IDs and resolved bounds", () => {
  const feature = { id: "water-a", properties: { __source: "scenario" } };
  const firstPart = { id: "first-part" };
  const secondPart = { id: "second-part" };
  const boundedPart = { id: "bounded-part" };
  const partBounds = bounds(10);
  const fallbackBounds = bounds(20);

  const items = buildWaterSpatialItems({
    features: [feature],
    getFeatureId: (candidate) => candidate.id,
    collectFeatureHitGeometries: () => [firstPart, secondPart, boundedPart],
    computeProjectedGeoBounds(candidate) {
      if (candidate === boundedPart) return partBounds;
      if (candidate === feature) return fallbackBounds;
      return null;
    },
  });

  assert.deepEqual(items.map((item) => item.id), [
    "water-a::part:0",
    "water-a::part:1",
    "water-a::part:2",
  ]);
  assert.deepEqual(items.map((item) => item.minX), [20, 20, 10]);
  assert.ok(items.every((item) => item.source === "scenario"));
});

test("water builder skips unsafe parts", () => {
  const featureA = { id: "water-a" };
  const featureB = { id: "water-b" };
  const unsafeA = { id: "unsafe-a" };
  const partA = { id: "part-a" };
  const partB1 = { id: "part-b-1" };
  const partB2 = { id: "part-b-2" };
  const first = buildWaterSpatialItems({
    features: [featureA, featureB],
    getFeatureId: (candidate) => candidate.id,
    collectFeatureHitGeometries: (feature) => (
      feature === featureA ? [unsafeA, partA] : [partB1, partB2]
    ),
    shouldExcludeWaterHitGeometry: (part) => part === unsafeA,
    computeProjectedGeoBounds(candidate) {
      if (candidate === featureA || candidate === featureB) {
        return candidate === featureA ? bounds(10) : bounds(20);
      }
      return null;
    },
  });

  assert.deepEqual(first.map((item) => item.id), [
    "water-a::part:1",
    "water-b::part:0",
    "water-b::part:1",
  ]);
});
