import test from "node:test";
import assert from "node:assert/strict";
import { createPoliticalFeaturePolicy } from "../js/core/renderer/political_feature_policy.js";

const feature = (id, properties = {}) => ({ properties: { id, ...properties } });

function fixture() {
  const h = { state: {}, pending: false, cache: { pendingPoliticalColorEditIds: new Set() } };
  h.policy = createPoliticalFeaturePolicy(h.state, {
    getFeatureId: (value) => value?.properties?.id || value?.id,
    getFeatureCountryCodeNormalized: (value) => value?.properties?.country || "",
    getSafeCanvasColor: (value, fallback) => /^#[0-9a-f]{6}$/i.test(value || "") ? value : fallback,
    hasPendingPoliticalColorEdit: () => h.pending,
    getRenderPassCacheState: () => h.cache,
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

test("shell identification preserves explicit, Arctic, and legacy name forms and live blank mode", () => {
  const { policy, state } = fixture();
  const shells = [
    feature("detail", { scenario_helper_kind: " Shell_Fallback " }),
    feature(" ru_arctic_fb_1 "),
    feature("legacy", { name: "North Shell Fallback" }),
  ];
  for (const shell of shells) {
    assert.equal(policy.isScenarioShellFeature(shell), true);
    assert.equal(policy.shouldExcludePoliticalVisualFeature(shell), false);
    assert.equal(policy.shouldExcludePoliticalInteractionFeature(shell), true);
    assert.equal(policy.shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(shell), false);
    shell.properties.render_as_base_geography = false;
    assert.equal(policy.shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(shell), true);
  }
  state.mapSemanticMode = " BLANK ";
  assert.equal(policy.shouldExcludeRuntimeOnlyShellFallbackPoliticalFeature(shells[0]), false);
  assert.equal(policy.isScenarioShellFeature(null), false);
});

test("paint order is stable and sees replaced override maps and pending cache on every call", () => {
  const h = fixture();
  const detailA = feature("detail-a"), detailB = feature("detail-b");
  const shell = feature("RU_ARCTIC_FB_1", { render_as_base_geography: false });
  const primary = { id: "primary", feature: feature("primary", { __source: " Primary " }) };
  const entries = [detailA, primary, detailB, shell];
  assert.deepEqual(h.policy.orderPoliticalShellUnderlayFirst(entries), [primary, shell, detailA, detailB]);
  h.state.visualOverrides = { primary: "invalid" };
  h.state.featureOverrides = { primary: "#112233" };
  assert.equal(h.policy.hasVisiblePoliticalForegroundColorOverride(entries), true);
  assert.deepEqual(h.policy.orderPoliticalShellUnderlayFirst(entries), [shell, detailA, detailB, primary]);
  h.state.featureOverrides = {};
  h.pending = true;
  h.cache = { pendingPoliticalColorEditIds: new Set(["RU_ARCTIC_FB_1", "detail-a"]) };
  assert.deepEqual(h.policy.orderPoliticalShellUnderlayFirst(entries), [primary, detailB, detailA, shell]);
  assert.equal(h.policy.hasVisiblePoliticalForegroundColorOverride(entries), false);
  h.pending = false;
  assert.deepEqual(h.policy.orderPoliticalShellUnderlayFirst(entries), [primary, shell, detailA, detailB]);
  assert.deepEqual(entries, [detailA, primary, detailB, shell]);
  assert.equal(h.policy.hasVisiblePoliticalForegroundColorOverride(null), false);
});

test("visual and interaction eligibility retain Antarctic, base geography, and helper distinctions", () => {
  const { policy } = fixture();
  const cases = [
    [null, false, false],
    [feature("ordinary"), true, true],
    [feature("locked", { interactive: false }), true, false],
    [feature("base", { render_as_base_geography: true }), false, false],
    [feature("AQ_1", { detail_tier: " ANTARCTIC_SECTOR " }), false, false],
    [feature("sector", { country: "AQ", detail_tier: "antarctic_sector" }), false, false],
    [feature("AQ_2"), true, true],
    [feature("ATLSHL_1"), false, false],
    [feature("ATLWLD_1"), false, false],
    [feature("ATLSEA_FILL_1"), false, false],
    [feature("seal", { atl_geometry_role: " Shore_Seal " }), false, false],
    [feature("sea", { atl_geometry_role: "sea_completion" }), false, false],
    [feature("donor", { atl_geometry_role: "donor_sea" }), false, false],
    [feature("gap", { atl_join_mode: " Gap_Fill " }), false, false],
    [feature("weld", { atl_join_mode: "boolean_weld" }), true, false],
    [feature("ATLISL_1", { atl_geometry_role: "donor_island", atl_join_mode: "boolean_weld" }), true, true],
  ];
  for (const [value, visual, interactive] of cases) {
    assert.equal(!policy.shouldExcludePoliticalVisualFeature(value), visual, JSON.stringify(value));
    assert.equal(policy.isPoliticalInteractionRenderableFeature(value), interactive, JSON.stringify(value));
    assert.equal(policy.shouldExcludePoliticalInteractionFeature(value), !interactive);
  }
});

test("field-driven Atlantropa rules observe visibility changes and require explicit interactivity", () => {
  const { policy, state } = fixture();
  const value = feature("ATLSHL_1", { atl_render_layer: "land", atl_geometry_role: "shore_seal" });
  assert.equal(policy.shouldExcludePoliticalVisualFeature(value), false);
  assert.equal(policy.isPoliticalInteractionRenderableFeature(value), false);
  value.properties.atl_interactive = true;
  assert.equal(policy.isPoliticalInteractionRenderableFeature(value), true);
  state.showScenarioAtlantropa = false;
  assert.equal(policy.shouldExcludePoliticalVisualFeature(value), true);
  assert.equal(policy.isPoliticalInteractionRenderableFeature(value), false);
  state.showScenarioAtlantropa = true;
  assert.equal(policy.isPoliticalInteractionRenderableFeature(value), true);
});
