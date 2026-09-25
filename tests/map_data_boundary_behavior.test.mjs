import test from "node:test";
import assert from "node:assert/strict";
import { createReadonlyReferenceAssignments, getMapDataBoundary } from "../js/core/map_data_boundary.js";
import { applyFeaturePaintState } from "../js/core/state/color_state.js";
import { applyPaletteFeatureColorState } from "../js/core/state/actions/scenario_activation_actions.js";
import { resolveFeatureColor } from "../js/core/color_resolver.js";

function fixture() {
  return {
    activeScenarioId: "test-scene",
    scenarioBaselineOwnersByFeatureId: createReadonlyReferenceAssignments({ a: "2RA", b: "2RA", c: "GB" }),
    sovereigntyByFeatureId: { a: "OTHER", b: "OTHER" },
    landIndex: new Map([["a", { properties: { id: "a", country_code: "GB" } }]]),
    sovereignBaseColors: { "2RA": "#123456", GB: "#123456" },
    countryBaseColors: {}, visualOverrides: {}, featureOverrides: {},
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

test("reference snapshots and results are immutable without freezing caller inputs", () => {
  const input = { a: "2RA" };
  const published = createReadonlyReferenceAssignments(input);
  input.a = "OTHER";
  assert.equal(published.a, "2RA");
  assert.equal(Object.isFrozen(input), false);
  assert.throws(() => { published.a = "OTHER"; }, TypeError);
  const reference = getMapDataBoundary(fixture()).reference;
  assert.throws(() => reference.getScenarioGroupFeatureIds("2RA").push("fake"), TypeError);
  assert.throws(() => { reference.getFeatureOrigin("a").scenarioGroupCode = "OTHER"; }, TypeError);
  assert.throws(() => reference.getGeographicCountryFeatureIds("GB").pop(), TypeError);
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

test("mutable transition snapshots are not cached by object identity", () => {
  const state = fixture();
  state.scenarioBaselineOwnersByFeatureId = { a: "2RA" };
  const { reference } = getMapDataBoundary(state);
  assert.deepEqual(reference.getScenarioFeatureIds(), ["a"]);
  state.scenarioBaselineOwnersByFeatureId.b = "2RA";
  assert.deepEqual(reference.getScenarioFeatureIds(), ["a", "b"]);
});

test("one paint API resolves baseline, edit, palette update, and erase without changing reference", () => {
  const state = fixture();
  const reference = state.scenarioBaselineOwnersByFeatureId;
  const { paint } = getMapDataBoundary(state);
  assert.equal(paint.resolveFeatureColor("a").color, "#123456");
  assert.deepEqual(applyFeaturePaintState(state, [" a ", "b", "a"], "#ABC"), ["a", "b"]);
  assert.equal(paint.resolveFeatureColor("a").color, "#aabbcc");
  assert.deepEqual(state.visualOverrides, state.featureOverrides);
  state.sovereignBaseColors["2RA"] = "#654321";
  assert.equal(paint.resolveFeatureColor("a").color, "#aabbcc");
  applyFeaturePaintState(state, ["a"], null, { remove: true });
  assert.equal(paint.resolveFeatureColor("a").color, "#654321");
  assert.equal(paint.resolveFeatureColor("b").color, "#aabbcc");
  assert.equal(state.scenarioBaselineOwnersByFeatureId, reference);
  assert.deepEqual(state.sovereigntyByFeatureId, { a: "OTHER", b: "OTHER" });
});

test("palette paint delegates to the same operation and does not impose RGB identity or uniqueness", () => {
  const state = fixture();
  applyPaletteFeatureColorState(state, ["a", "c"], "#000000");
  const { reference, paint } = getMapDataBoundary(state);
  assert.equal(paint.resolveFeatureColor("a").color, paint.resolveFeatureColor("c").color);
  assert.notEqual(reference.getScenarioGroupCode("a"), reference.getScenarioGroupCode("c"));
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

test("renderer adapter preserves blank, shell and specialized ocean/Atlantropa rules", () => {
  const state = fixture();
  applyFeaturePaintState(state, ["a"], "#ffffff");
  assert.equal(resolveFeatureColor("a", { state, getOwnerCode: () => "2RA" }).color, "#ffffff");
  const snapshot = structuredClone(state);
  assert.equal(resolveFeatureColor("a", { state, isOceanFeature: () => true, getOceanBaseFillColor: () => "#0000ff" }).color, "#0000ff");
  assert.equal(resolveFeatureColor("a", { state, feature: { properties: { atl_color_rule: "salt_flat" } }, getAtlantropaRuleColor: () => "#445566" }).color, "#445566");
  assert.deepEqual(state, snapshot, "view rules must not bake themselves into paint storage");
  applyFeaturePaintState(state, ["a"], null, { remove: true });
  assert.equal(resolveFeatureColor("a", { state, getOwnerCode: () => "" }).color, null);
  assert.equal(resolveFeatureColor("shell", { state, getOwnerCode: () => "2RA" }).color, "#123456");
});
