import test from "node:test";
import assert from "node:assert/strict";
import { resolveFeatureColor } from "../js/core/color_resolver.js";

test("display follows effective owner, preserves ocean and restores painted land", () => {
  const state = { activeScenarioId: "hoi4_1939", politicalDisplayMode: "alliance",
    visualOverrides: { sample: "#123456" }, sovereignBaseColors: { GER: "#abcdef" },
    scenarioBundleCacheById: { hoi4_1939: { countriesPayload: { countries: {
      GER: { ruling_ideology: "fascism", alliance: "axis" }, ENG: { ruling_ideology: "democratic", alliance: "allies" },
    } } } } };
  const original = structuredClone(state);
  const ctx = { state, feature: { id: "sample", properties: {} }, getEffectiveOwnerCode: () => "GER" };
  assert.deepEqual(resolveFeatureColor("sample", ctx), { color: "#2f2f2f", source: "political-display:alliance", featureId: "sample", ownerCode: "GER" });
  assert.equal(resolveFeatureColor("sample", { ...ctx, getEffectiveOwnerCode: () => "ENG" }).color, "#1f4e9c");
  assert.equal(resolveFeatureColor("sample", { ...ctx, isOceanFeature: () => true, getOceanBaseFillColor: () => "#112233" }).color, "#112233");
  assert.deepEqual(state, original);
  state.politicalDisplayMode = "country";
  assert.equal(resolveFeatureColor("sample", ctx).color, "#123456");
});
