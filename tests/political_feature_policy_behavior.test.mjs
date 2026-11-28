import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalFeaturePolicy } from "../js/core/renderer/political_feature_policy.js";

const feature = (id, properties = {}) => ({ properties: { id, ...properties } });

function fixture() {
  const h = {
    state: { activeScenarioId: "scenario-a", colorRevision: 1 },
  };
  h.policy = createPoliticalFeaturePolicy(h.state, {
    getFeatureId: (value) => value?.properties?.id || value?.id,
    getFeatureCountryCodeNormalized: (value) => value?.properties?.country || "",
    isAtlantropaFieldDrivenFeature: (value) => !!value?.properties?.atl_render_layer,
    isScenarioAtlantropaVisible: () => h.state.showScenarioAtlantropa !== false,
    isBaseGeographyScenarioFeature: (value) => value?.properties?.render_as_base_geography === true,
    isInteractiveAtlantropaBooleanWeldIslandFeature: (value, id) =>
      String(value?.properties?.id ?? id ?? "").startsWith("ATLISL_")
      && h.policy.getAtlantropaGeometryRole(value) === "donor_island"
      && h.policy.getAtlantropaJoinMode(value) === "boolean_weld",
  });
  return h;
}

test("shell parcels are excluded from painting and selection", () => {
  const { policy } = fixture();
  const shell = feature("ATLSHL_1");
  assert.equal(!policy.shouldExcludePoliticalVisualFeature(shell), false);
  assert.equal(policy.isPoliticalInteractionRenderableFeature(shell), false);
});

test("field-driven Atlantropa parcels require explicit interactivity", () => {
  const { policy } = fixture();
  const value = feature("ATLSHL_1", { atl_render_layer: "land", atl_geometry_role: "shore_seal" });
  assert.equal(policy.shouldExcludePoliticalVisualFeature(value), false);
  assert.equal(policy.isPoliticalInteractionRenderableFeature(value), false);
  value.properties.atl_interactive = true;
  assert.equal(policy.isPoliticalInteractionRenderableFeature(value), true);
});

test("ownerless blank maps can render and edit Antarctic sectors while scenario policy remains intact", () => {
  const { policy, state } = fixture();
  const sector = feature("AQ_AAT_WEST", { detail_tier: "antarctic_sector", __source: "primary" });
  assert.equal(policy.shouldExcludePoliticalVisualFeature(sector), true);
  state.mapSemanticMode = "blank";
  assert.equal(policy.isAntarcticSectorFeature(sector), true);
  assert.equal(policy.shouldExcludePoliticalVisualFeature(sector), false);
  assert.equal(policy.isPoliticalInteractionRenderableFeature(sector), true);
  sector.properties.interactive = false;
  assert.equal(policy.isPoliticalInteractionRenderableFeature(sector), false);
  state.mapSemanticMode = "scenario";
  assert.equal(policy.shouldExcludePoliticalVisualFeature(sector), true);
});
