import test from "node:test";
import assert from "node:assert/strict";
import { buildStrategicChoroplethColorInput, getStrategicChoroplethMetricDomain, getStrategicChoroplethT } from "../js/core/renderer/strategic_choropleth.js";

test("strategic choropleth resolves feature bucket values and metric domains", () => {
  const payload = {
    metrics: {
      manpower: { kind: "additive", min: 0, max: 1000, p95: 800 },
    },
    bucketByFeature: {
      "feature-a": "s10",
    },
    buckets: {
      s10: { manpower: 400 },
    },
  };

  const input = buildStrategicChoroplethColorInput(payload, { id: "feature-a" }, "manpower");

  assert.equal(input.bucketId, "s10");
  assert.equal(input.value, 400);
  assert.deepEqual(input.domain, {
    metricId: "manpower",
    kind: "additive",
    min: 0,
    max: 800,
    cap: 800,
    absoluteMax: 1000,
  });
  assert.equal(input.t, 0.5);
});

test("strategic choropleth handles empty and out-of-range values", () => {
  const input = buildStrategicChoroplethColorInput(null, "feature-a", "manpower");
  assert.equal(input.t, 0);
  const domain = getStrategicChoroplethMetricDomain(
    { metrics: { steel: { kind: "additive", min: 2, max: 20, p95: 10 } } },
    "steel",
  );

  assert.equal(getStrategicChoroplethT(-5, domain), 0);
  assert.equal(getStrategicChoroplethT(20, domain), 1);
});
