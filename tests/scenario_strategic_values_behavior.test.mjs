import test from "node:test";
import assert from "node:assert/strict";
import { isScenarioStrategicValuesUsable, normalizeScenarioStrategicValuesPayload } from "../js/core/scenario/strategic_values.js";

function createValidPayload() {
  return {
    version: 1,
    scenario_id: "hoi4_test",
    baseline_hash: "abc123",
    metrics: {
      manpower: {
        kind: "additive",
        min: 0,
        max: 3000000,
        p95: 3000000,
      },
    },
    buckets: {
      s10: {
        state_id: 10,
        owner_tag: "POL",
        attribution: "vp_anchor",
        manpower: 3000000,
      },
      "pool:GER": {
        owner_tag: "GER",
        attribution: "country_pooled",
        manpower: 500000,
      },
    },
    bucket_by_feature: {
      "GER-A": "pool:GER",
      "POL-A": "s10",
    },
    resource_points: { type: "FeatureCollection", features: [] },
  };
}

function diagnosticCodes(entries) {
  return entries.map((entry) => entry.code);
}

test("normalizes valid strategic values payload into stable runtime indexes", () => {
  const result = normalizeScenarioStrategicValuesPayload(createValidPayload(), {
    expected: {
      scenarioId: "hoi4_test",
      baselineHash: "abc123",
    },
  });

  assert.deepEqual(result.diagnostics.errors, []);
  assert.deepEqual(result.bucketByFeature, {
    "GER-A": "pool:GER",
    "POL-A": "s10",
  });
  assert.equal(isScenarioStrategicValuesUsable(result), true);
});

test("reports unsupported payload version", () => {
  const payload = createValidPayload();
  payload.version = 2;

  const result = normalizeScenarioStrategicValuesPayload(payload);

  assert.deepEqual(diagnosticCodes(result.diagnostics.errors), [
    "unsupported_strategic_values_version",
  ]);
});
