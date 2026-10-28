import test from "node:test";
import assert from "node:assert/strict";

import { buildWaterSpatialItems, iterateWaterSpatialItems } from "../js/core/renderer/spatial_index_runtime_builders.js";

function bounds(seed) {
  return {
    minX: seed,
    minY: seed + 1,
    maxX: seed + 2,
    maxY: seed + 3,
    area: seed + 4,
  };
}

test("water iterator yields between every bounds calculation including feature fallback", () => {
  const feature = { id: "water" };
  const parts = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const calls = [];
  const iterator = iterateWaterSpatialItems({
    features: [feature],
    getFeatureId: (candidate) => candidate.id,
    collectFeatureHitGeometries: () => parts,
    computeProjectedGeoBounds(candidate) {
      calls.push(candidate);
      return candidate === parts[0] ? null : bounds(10);
    },
  });
  let step;
  do {
    const before = calls.length;
    step = iterator.next();
    assert.ok(calls.length - before <= 1);
    if (calls.length > before) assert.equal(step.done, false);
  } while (!step.done);
  assert.deepEqual(calls, [parts[0], feature, parts[1], parts[2]]);
  assert.deepEqual(step.value.map(({ id, drawOrder }) => ({ id, drawOrder })), [
    { id: "water::part:0", drawOrder: 0 },
    { id: "water::part:1", drawOrder: 1 },
    { id: "water::part:2", drawOrder: 2 },
  ]);
});

test("water builder lazily computes one feature fallback while preserving part priority and order", () => {
  const feature = { id: "water-a", properties: { __source: "scenario" } };
  const firstPart = { id: "first-part" };
  const secondPart = { id: "second-part" };
  const boundedPart = { id: "bounded-part" };
  const partBounds = bounds(10);
  const fallbackBounds = bounds(20);
  const calls = [];

  const items = buildWaterSpatialItems({
    features: [feature],
    getFeatureId: (candidate) => candidate.id,
    collectFeatureHitGeometries: () => [firstPart, secondPart, boundedPart],
    computeProjectedGeoBounds(candidate) {
      calls.push(candidate);
      if (candidate === boundedPart) return partBounds;
      if (candidate === feature) return fallbackBounds;
      return null;
    },
  });

  assert.deepEqual(calls, [firstPart, feature, secondPart, boundedPart]);
  assert.deepEqual(items.map((item) => item.id), [
    "water-a::part:0",
    "water-a::part:1",
    "water-a::part:2",
  ]);
  assert.deepEqual(items.map((item) => item.minX), [20, 20, 10]);
  assert.ok(items.every((item) => item.source === "scenario"));
});

test("water builder memoizes a null feature fallback within one feature", () => {
  const feature = { id: "water-null" };
  const parts = [{ id: "part-a" }, { id: "part-b" }, { id: "part-c" }];
  let featureFallbackCalls = 0;

  const items = buildWaterSpatialItems({
    features: [feature],
    getFeatureId: (candidate) => candidate.id,
    collectFeatureHitGeometries: () => parts,
    computeProjectedGeoBounds(candidate) {
      if (candidate === feature) featureFallbackCalls += 1;
      return null;
    },
  });

  assert.deepEqual(items, []);
  assert.equal(featureFallbackCalls, 1);
});

test("water builder skips unsafe parts and isolates fallback caches by feature and invocation", () => {
  const featureA = { id: "water-a" };
  const featureB = { id: "water-b" };
  const unsafeA = { id: "unsafe-a" };
  const partA = { id: "part-a" };
  const partB1 = { id: "part-b-1" };
  const partB2 = { id: "part-b-2" };
  const fallbackCalls = new Map();
  const unsafeBoundsCalls = [];

  const build = () => buildWaterSpatialItems({
    features: [featureA, featureB],
    getFeatureId: (candidate) => candidate.id,
    collectFeatureHitGeometries: (feature) => (
      feature === featureA ? [unsafeA, partA] : [partB1, partB2]
    ),
    shouldExcludeWaterHitGeometry: (part) => part === unsafeA,
    computeProjectedGeoBounds(candidate) {
      if (candidate === unsafeA) unsafeBoundsCalls.push(candidate);
      if (candidate === featureA || candidate === featureB) {
        fallbackCalls.set(candidate.id, (fallbackCalls.get(candidate.id) || 0) + 1);
        return candidate === featureA ? bounds(10) : bounds(20);
      }
      return null;
    },
  });

  const first = build();
  const second = build();

  assert.deepEqual(first.map((item) => item.id), [
    "water-a::part:1",
    "water-b::part:0",
    "water-b::part:1",
  ]);
  assert.deepEqual(second.map((item) => item.id), first.map((item) => item.id));
  assert.deepEqual(unsafeBoundsCalls, []);
  assert.deepEqual(Object.fromEntries(fallbackCalls), {
    "water-a": 2,
    "water-b": 2,
  });
});
