import assert from "node:assert/strict";
import test from "node:test";
import {
  getStrategicBucketInspection, getStrategicValuesColorStops, getStrategicValuesViewModel,
  normalizeStrategicValuesStyle,
} from "../js/core/strategic_values_view_model.js";

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

test("style normalization and shared palettes are bounded", () => {
  assert.deepEqual(normalizeStrategicValuesStyle(), { opacity: 0.75, palette: "auto", resourceFilter: "all" });
  assert.deepEqual(normalizeStrategicValuesStyle({ opacity: 3, palette: "invalid", resourceFilter: "oil" }),
    { opacity: 1, palette: "auto", resourceFilter: "oil" });
  assert.deepEqual(getStrategicValuesColorStops("auto", "resource"), ["#e0f2fe", "#0369a1"]);
  assert.deepEqual(getStrategicValuesColorStops("rose", "population"), ["#f1f5f9", "#be123c"]);
});

test("feedback distinguishes support, loading, invalid identity, errors and zero from missing", () => {
  const empty = state();
  assert.equal(getStrategicValuesViewModel(empty).status, "not-loaded");
  empty.scenarioBundleCacheById.hoi4_1936.optionalLayerPromises = { strategicvalues: Promise.resolve() };
  assert.equal(getStrategicValuesViewModel(empty).status, "loading");
  delete empty.scenarioBundleCacheById.hoi4_1936.optionalLayerPromises;
  empty.scenarioStrategicValuesData = { ...payload(), scenarioId: "hoi4_1939" };
  assert.equal(getStrategicValuesViewModel(empty).status, "not-loaded");
  empty.scenarioStrategicValuesData = payload();
  const view = getStrategicValuesViewModel(empty);
  assert.equal(view.status, "ready");
  assert.deepEqual(view.coverage, { mapped: 2, total: 2, valued: 1 });
  assert.equal(view.allZero, true);
  assert.equal(view.domain.max, 12);
  assert.deepEqual(getStrategicBucketInspection(view, "s1").value, 0);
  assert.equal(getStrategicBucketInspection(view, "s2").hasValue, false);
  empty.scenarioStrategicValuesData.diagnostics.errors.push({ code: "invalid" });
  assert.equal(getStrategicValuesViewModel(empty).status, "failed");
  delete empty.scenarioBundleCacheById.hoi4_1936.manifest.strategic_values_url;
  assert.equal(getStrategicValuesViewModel(empty).status, "unsupported");
});

test("chunk support, settled failure, and empty mappings are explicit", () => {
  const current = state();
  delete current.scenarioBundleCacheById.hoi4_1936.manifest.strategic_values_url;
  current.scenarioBundleCacheById.hoi4_1936.chunkRegistry = { byLayer: { strategicvalues: ["chunk-1"] } };
  assert.equal(getStrategicValuesViewModel(current).status, "not-loaded");
  current.scenarioBundleCacheById.hoi4_1936.optionalLayerSettledByKey = { strategicvalues: true };
  assert.equal(getStrategicValuesViewModel(current).status, "failed");
  delete current.scenarioBundleCacheById.hoi4_1936.optionalLayerSettledByKey;
  current.scenarioStrategicValuesData = { ...payload(), buckets: {}, bucketByFeature: {} };
  const view = getStrategicValuesViewModel(current);
  assert.equal(view.status, "ready");
  assert.deepEqual(view.coverage, { mapped: 0, total: 0, valued: 0 });
  assert.equal(view.allZero, false);
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
