import assert from "node:assert/strict";
import test from "node:test";
import { createBathymetryStylePolicy } from "../js/core/renderer/bathymetry_style_policy.js";
import { parseCanvasColorChannels } from "../js/core/renderer/canvas_color_helpers.js";

const feature = (depth, properties = {}) => ({ properties: { depth_max_m: depth, ...properties } });
function createHarness() {
  const state = { styleConfig: { ocean: {} } };
  const live = { fill: "#aadaff", density: 0 };
  const policy = createBathymetryStylePolicy(state, {
    clamp: (v, min, max) => Math.min(max, Math.max(min, v)),
    getOceanBaseFillColor: () => live.fill,
    getBathymetryPresetProfile: () => ({}),
    getFeatureProjectedDensity: () => live.density,
    getReliefOverlayKind: f => f.properties?.kind,
    parseCanvasColorChannels,
    toRgbaString: (rgb, alpha) => ({ ...rgb, alpha }),
    buildBathymetryFeatureCollection: features => ({ type: "FeatureCollection", features }),
  });
  return { state, live, policy };
}

test("bathymetry fade bands honor their depth class and current tuning", () => {
  const { state, policy } = createHarness();
  for (const [depth, start, end] of [[150, 2, 2.8], [300, 2.6, 3.4], [3000, 3.2, 4.2]]) {
    assert.equal(policy.getBathymetryBandVisibilityConfig(feature(depth), start).alpha, 1);
    assert.equal(policy.getBathymetryBandVisibilityConfig(feature(depth), end).alpha, 0);
  }
  state.styleConfig.ocean = { shallowBandFadeEndZoom: 4 };
  assert.equal(policy.getBathymetryBandVisibilityConfig(feature(150), 3).alpha, 0.5);
  assert.equal(createHarness().policy.getBathymetryBandVisibilityConfig(feature(150), 3).alpha, 0);
});

test("scenario synthetic contours fade independently from global and deep contours", () => {
  const { policy } = createHarness();
  for (const [properties, depth, expected] of [
    [{ _bathymetrySource: "global" }, 100, 1],
    [{ _bathymetrySource: "scenario", bathymetry_mode: "synthetic" }, 1000, 0],
    [{ _bathymetrySource: "scenario" }, 100, 0],
    [{ _bathymetrySource: "scenario" }, 1000, 1],
  ]) assert.equal(policy.getBathymetryContourVisibilityConfig(feature(depth, properties), 5).alpha, expected);
});

test("band and contour colors react to live ocean fill and attenuate synthetic Atlantropa", () => {
  const { live, policy } = createHarness();
  const style = { opacity: 1, scale: 1, contourStrength: 0.5 };
  for (const method of ["getBathymetryBandFillStyle", "getBathymetryContourStrokeStyle"]) {
    const plain = policy[method](feature(100), style);
    const syntheticFeature = feature(100, { _bathymetrySource: "scenario", region_group: "atlantropa_med", bathymetry_mode: "synthetic" });
    const synthetic = policy[method](syntheticFeature, style);
    assert.ok(synthetic.alpha < plain.alpha, method);
    live.fill = "#112233";
    assert.notDeepEqual(policy[method](syntheticFeature, style), synthetic);
    live.fill = "#aadaff";
  }
});

test("depth normalization, sorting and source filtering preserve input objects", () => {
  const { policy } = createHarness();
  for (const [value, expected] of [[-200, 200], [NaN, 0], [Infinity, 0], ["150", 150]]) {
    assert.equal(policy.getBathymetryFeatureDepthMax(feature(value)), expected);
  }
  const shallow = feature(100, { _bathymetrySource: "scenario" });
  const deep = feature(3000, { _bathymetrySource: "global" });
  const collection = { features: [shallow, deep] };
  assert.deepEqual(policy.sortBathymetryFeaturesForFill(collection), [deep, shallow]);
  assert.deepEqual(collection.features, [shallow, deep]);
  assert.equal(policy.getBathymetryCollectionBySource(collection, "scenario").features[0], shallow);
  assert.equal(Object.isFrozen(policy), true);
});

test("coastal accents retain zoom width floors, density and interaction attenuation", () => {
  const { live, policy } = createHarness();
  const shore = feature(0, { kind: "new_shoreline", parent_id: "atlantropa_med" });
  assert.equal(policy.getScenarioCoastalAccentOverlayVisualConfig(shore, 1).alpha, 0.42);
  live.density = 1;
  assert.equal(policy.getScenarioCoastalAccentOverlayVisualConfig(shore, 1).alpha, 0.42 * 0.78);
  assert.equal(policy.getScenarioCoastalAccentOverlayVisualConfig(shore, 1, { interactive: true }).alpha, 0.3 * 0.78);
  assert.equal(policy.getScenarioCoastalAccentOverlayVisualConfig(shore, 10).lineWidth, 0.95);
});
