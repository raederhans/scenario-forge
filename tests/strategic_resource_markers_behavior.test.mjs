import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategicResourceMarkerEntries } from "../js/core/renderer/strategic_resource_markers.js";

function resourceFeature(resource, amount, tier, coordinates = [10, 50]) {
  return {
    type: "Feature",
    geometry: { type: "Point", coordinates },
    properties: { resource, amount, tier },
  };
}

test("strategic resource markers return empty entries for empty payloads", () => {
  assert.deepEqual(buildStrategicResourceMarkerEntries(null), []);
  assert.deepEqual(buildStrategicResourceMarkerEntries({ resource_points: { type: "FeatureCollection", features: [] } }), []);
  assert.deepEqual(buildStrategicResourceMarkerEntries({ resourcePoints: { type: "FeatureCollection", features: [] } }), []);
});

test("resource marker entries respect amount and tier filters", () => {
  const lowTier = resourceFeature("steel", 5, 1);
  const highTier = resourceFeature("oil", 20, 3, [11, 51]);
  const collection = { type: "FeatureCollection", features: [lowTier, highTier] };

  assert.deepEqual(buildStrategicResourceMarkerEntries(collection, { zoom: 5, resources: ["steel"], minAmount: 7 }), []);
  assert.deepEqual(
    buildStrategicResourceMarkerEntries(collection, { zoom: 1 }).map((entry) => entry.resource),
    ["oil"],
  );
});
