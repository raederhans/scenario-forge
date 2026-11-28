import assert from "node:assert/strict";
import test from "node:test";
import { getStrategicBucketInspection, getStrategicValuesViewModel } from "../js/core/thematic/strategic_values_view_model.js";

function state(payload = null) {
  return {
    activeScenarioId: "hoi4_1936", strategicChoroplethMetric: "steel",
    scenarioBundleCacheById: {
      hoi4_1936: { manifest: { strategic_values_url: "values.json", baseline_hash: "hash", display_name: "HOI4 1936", bookmark_date: "1936.1.1.12" } },
    },
    scenarioStrategicValuesData: payload,
  };
}

function payload() {
  return {
    scenarioId: "hoi4_1936", baselineHash: "hash",
    metrics: { steel: { min: 0, max: 100, p95: 12 } },
    buckets: { s1: { state_id: 1, owner_tag: "FRA", steel: 0 }, s2: { state_id: 2, owner_tag: "ENG" } },
    bucketByFeature: { a: "s1", b: "s1", c: "s2" },
    resourcePoints: { type: "FeatureCollection", features: [] },
    diagnostics: { errors: [], warnings: [] },
  };
}

test("coverage counts distinct strategic buckets", () => {
  const view = getStrategicValuesViewModel(state(payload()));
  assert.deepEqual(view.coverage, { mapped: 2, total: 2, valued: 1 });
  assert.equal(view.allZero, true);
  assert.equal(view.domain.max, 12);
});

test("null and absent bucket values never become zero values", () => {
  const current = state(payload());
  current.scenarioStrategicValuesData.buckets.s1.steel = null;
  let view = getStrategicValuesViewModel(current);
  assert.equal(view.coverage.valued, 0);
  assert.equal(getStrategicBucketInspection(view, "s1").hasValue, false);
  assert.equal(getStrategicBucketInspection(view, "s1").value, null);
  current.scenarioStrategicValuesData.buckets.s1.steel = 0;
  view = getStrategicValuesViewModel(current);
  assert.equal(view.coverage.valued, 1);
  assert.equal(getStrategicBucketInspection(view, "s1").hasValue, true);
});
