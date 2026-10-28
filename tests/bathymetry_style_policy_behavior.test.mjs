import assert from "node:assert/strict";
import test from "node:test";
import { createBathymetryStylePolicy } from "../js/core/renderer/bathymetry_style_policy.js";

const feature = (depth, properties = {}) => ({ properties: { depth_max_m: depth, ...properties } });
function createHarness() {
  const live = { density: 0 };
  const policy = createBathymetryStylePolicy({}, {
    getFeatureProjectedDensity: () => live.density,
    getReliefOverlayKind: f => f.properties?.kind,
  });
  return { live, policy };
}

test("coastal accents retain screen-space widths, density and interaction attenuation", () => {
  const { live, policy } = createHarness();
  const shore = feature(0, { kind: "new_shoreline", parent_id: "atlantropa_med" });
  assert.equal(policy.getScenarioCoastalAccentOverlayVisualConfig(shore, 1).alpha, 0.42);
  live.density = 1;
  assert.equal(policy.getScenarioCoastalAccentOverlayVisualConfig(shore, 1).alpha, 0.42 * 0.78);
  assert.equal(policy.getScenarioCoastalAccentOverlayVisualConfig(shore, 1, { interactive: true }).alpha, 0.3 * 0.78);
  assert.equal(policy.getScenarioCoastalAccentOverlayVisualConfig(shore, 10).lineWidth, 1.22 / 10);
  for (const k of [1, 4, 8]) {
    for (const interactive of [false, true]) {
      assert.equal(policy.getScenarioCoastalAccentLineWidth(k, { interactive }) * k, interactive ? 1.05 : 1.28);
      assert.equal(policy.getScenarioCoastalAccentLineWidth(k, { interactive, overlay: true }) * k, 1.22);
    }
  }
});
