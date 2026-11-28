import test from "node:test";
import assert from "node:assert/strict";
import { createReadonlyReferenceAssignments } from "../js/core/map_data_boundary.js";
import { createFillTargetPolicy } from "../js/core/renderer/fill_target_policy.js";
import { createColorResolutionStrategyOwner } from "../js/core/renderer/color_resolution_strategy.js";

function fixture() {
  const feature = id => ({ type: "Feature", properties: { id, country_code: "GB", admin1_group: "north" } });
  const state = {
    activeScenarioId: "test_scene", mapSemanticMode: "political",
    scenarioBaselineOwnersByFeatureId: createReadonlyReferenceAssignments({ a: "2RA", b: "2RA", c: "GB", unloaded: "GB" }),
    countryToFeatureIds: new Map([["GB", ["a", "b", "c"]]]),
    landIndex: new Map(["a", "b", "c"].map(id => [id, feature(id)])),
    sovereignBaseColors: { "2RA": "#111111", GB: "#222222" },
    visualOverrides: {},
    currentTool: "fill", interactionGranularity: "country", batchFillScope: "country",
  };
  const helpers = {
    getFeatureCountryCodeNormalized: f => f?.properties?.country_code || "",
    getFeatureInteractionCountryCodeNormalized: () => "WRONG",
    shouldExcludePoliticalInteractionFeature: () => false,
    isSovereigntyModeActive: () => false,
  };
  return { state, fill: createFillTargetPolicy(state, helpers) };
}

test("country fill selects parcels belonging to the baseline owner", () => {
  const { state, fill } = fixture();
  assert.deepEqual(fill.resolveInteractionTargetIds(state.landIndex.get("a"), "a"), ["a", "b"]);
});

test("land color follows the baseline owner", () => {
  const { state } = fixture();
  const owner = createColorResolutionStrategyOwner({ state, helpers: {
    canonicalCountryCode: value => String(value || "").trim().toUpperCase(),
    getFeatureCountryCodeNormalized: feature => feature?.properties?.country_code || "",
    getFeatureId: feature => feature?.properties?.id || "",
    getSafeCanvasColor: (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || "") ? value.toLowerCase() : fallback,
    normalizeMapSemanticMode: value => value,
    isAntarcticSectorFeature: feature => feature?.properties?.detail_tier === "antarctic_sector",
    isAtlantropaSeaFeature: () => false,
    isScenarioShellFeature: (_, id) => id.includes("_FB_"),
  } });
  assert.equal(owner.getResolvedFeatureColor(state.landIndex.get("a"), "a"), "#111111");
});
