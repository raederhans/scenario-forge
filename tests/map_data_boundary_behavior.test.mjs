import test from "node:test";
import assert from "node:assert/strict";
import { createReadonlyReferenceAssignments, getMapDataBoundary } from "../js/core/map_data_boundary.js";
import { applyFeaturePaintState } from "../js/core/state/color_state.js";

function fixture() {
  return {
    activeScenarioId: "test-scene",
    scenarioBaselineOwnersByFeatureId: createReadonlyReferenceAssignments({ a: "2RA", b: "2RA", c: "GB" }),
    sovereigntyByFeatureId: { a: "OTHER", b: "OTHER" },
    landIndex: new Map([["a", { properties: { id: "a", country_code: "GB" } }]]),
    sovereignBaseColors: { "2RA": "#123456", GB: "#123456" },
    visualOverrides: {},
    countryToFeatureIds: new Map([["GB", ["a", "b"]]]),
  };
}

test("reference origin and complete membership ignore paint, editable owners, and unloaded geometry", () => {
  const state = fixture();
  const boundary = getMapDataBoundary(state);
  assert.equal(getMapDataBoundary(state), boundary);
  assert.deepEqual(boundary.reference.getFeatureOrigin("a"), {
    featureId: "a", geographicCountryCode: "GB", scenarioId: "test-scene", scenarioGroupCode: "2RA",
  });
  assert.deepEqual(boundary.reference.getScenarioFeatureIds(), ["a", "b", "c"]);
  assert.deepEqual(boundary.reference.getScenarioGroupFeatureIds("2ra"), ["a", "b"]);
  assert.equal(boundary.reference.getScenarioGroupCode("b"), "2RA");
  applyFeaturePaintState(state, ["a"], "#000000");
  assert.equal(boundary.reference.getScenarioGroupCode("a"), "2RA");
  assert.deepEqual(boundary.reference.getScenarioGroupFeatureIds("2RA"), ["a", "b"]);
});

test("existing boundary follows scenario switch, rollback replacement, and clear without stale caches", () => {
  const state = fixture();
  const { reference } = getMapDataBoundary(state);
  const original = state.scenarioBaselineOwnersByFeatureId;
  const originalMembers = reference.getScenarioGroupFeatureIds("2RA");
  state.activeScenarioId = "scene-two";
  state.scenarioBaselineOwnersByFeatureId = createReadonlyReferenceAssignments({ z: "GB" });
  assert.deepEqual(reference.getScenarioFeatureIds(), ["z"]);
  assert.deepEqual(reference.getScenarioGroupFeatureIds("2RA"), []);
  state.activeScenarioId = "test-scene";
  state.scenarioBaselineOwnersByFeatureId = original;
  assert.equal(reference.getScenarioGroupFeatureIds("2RA"), originalMembers);
  state.activeScenarioId = "";
  assert.deepEqual(reference.getScenarioFeatureIds(), []);
  assert.equal(reference.getScenarioGroupCode("a"), "");
});

test("invalid paint batches fail before mutating any storage or metadata", () => {
  const state = fixture();
  const snapshot = structuredClone(state);
  for (const [ids, color] of [[["a"], "invalid"], [["a", "__proto__"], "#123456"], ["a", "#123456"]]) {
    assert.throws(() => applyFeaturePaintState(state, ids, color), TypeError);
    assert.deepEqual(state, snapshot);
  }
  assert.deepEqual(applyFeaturePaintState(state, [], "invalid"), []);
});
