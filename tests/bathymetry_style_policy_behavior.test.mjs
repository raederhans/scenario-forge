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

test("bathymetry bands retain useful opacity after legacy zoom fade thresholds", () => {
  const { state, policy } = createHarness();
  for (const [depth, start, end] of [[150, 2, 2.8], [300, 2.6, 3.4], [3000, 3.2, 4.2]]) {
    assert.equal(policy.getBathymetryBandVisibilityConfig(feature(depth), start).alpha, 1);
    assert.equal(policy.getBathymetryBandVisibilityConfig(feature(depth), end).alpha, 0.72);
    assert.equal(policy.getBathymetryBandVisibilityConfig(feature(depth), 10).alpha, 0.72);
  }
  state.styleConfig.ocean = { shallowBandFadeEndZoom: 4 };
  assert.equal(policy.getBathymetryBandVisibilityConfig(feature(150), 2.5).alpha, 0.75);
  assert.equal(createHarness().policy.getBathymetryBandVisibilityConfig(feature(150), 3).alpha, 0.72);
});

test("scenario contours remain restrained and visible at zoom for synthetic and observed geometry", () => {
  const { policy } = createHarness();
  for (const [properties, depth, expected] of [
    [{ _bathymetrySource: "global" }, 100, 1],
    [{ _bathymetrySource: "scenario", bathymetry_mode: "synthetic" }, 1000, 0.45],
    [{ _bathymetrySource: "scenario", bathymetry_mode: "observed" }, 100, 0.45],
    [{ _bathymetrySource: "scenario", bathymetry_mode: "observed" }, 1000, 0.45],
  ]) assert.equal(policy.getBathymetryContourVisibilityConfig(feature(depth, properties), 5).alpha, expected);
});

test("band and contour colors react to live ocean fill and attenuate scenario geometry", () => {
  const { live, policy } = createHarness();
  const style = { opacity: 1, scale: 1, contourStrength: 0.5 };
  for (const method of ["getBathymetryBandFillStyle", "getBathymetryContourStrokeStyle"]) {
    const plain = policy[method](feature(100), style);
    const syntheticFeature = feature(100, { _bathymetrySource: "scenario", region_group: "atlantropa_med", bathymetry_mode: "synthetic" });
    const synthetic = policy[method](syntheticFeature, style);
    assert.ok(synthetic.alpha < plain.alpha, method);
    const observed = policy[method](feature(100, { _bathymetrySource: "scenario", bathymetry_mode: "observed" }), style);
    assert.equal(observed.alpha, synthetic.alpha, method);
    live.fill = "#112233";
    assert.notDeepEqual(policy[method](syntheticFeature, style), synthetic);
    live.fill = "#aadaff";
  }
});

test("soft and discrete palettes separate shelf, slope and deep water on light and dark bases", () => {
  const { live, policy } = createHarness();
  for (const fill of ["#aadaff", "#112233"]) {
    live.fill = fill;
    for (const preset of ["bathymetry_soft", "bathymetry_contours"]) {
      const style = { preset, opacity: 1, scale: 1.2, contourStrength: 0.7, bathymetryProfile: { bandAlphaBase: 0.7 } };
      const colors = [50, 100, 200, 1000, 4000, 6000].map(depth => policy.getBathymetryBandFillStyle(feature(depth), style));
      const brightness = colors.map(color => color.r + color.g + color.b);
      assert.ok(brightness.every((value, index) => index === 0 || value < brightness[index - 1]), `${fill} ${preset}: ${brightness}`);
      assert.ok(brightness[0] - brightness[2] >= 20, `${fill} ${preset}: shelf colors must separate`);
      assert.ok(brightness[2] - brightness[5] >= 40, `${fill} ${preset}: slope and deep colors must separate`);
      if (preset === "bathymetry_contours") {
        assert.deepEqual(policy.getBathymetryBandFillStyle(feature(110), style), policy.getBathymetryBandFillStyle(feature(180), style));
        assert.notDeepEqual(policy.getBathymetryBandFillStyle(feature(200), style), policy.getBathymetryBandFillStyle(feature(201), style));
      }
    }
  }
});

test("opacity and contour strength are independent of band colors and opacity", () => {
  const { policy } = createHarness();
  const baseline = { preset: "bathymetry_soft", opacity: 0.8, scale: 1, contourStrength: 0.2 };
  const weak = policy.getBathymetryBandFillStyle(feature(200), baseline);
  const strong = policy.getBathymetryBandFillStyle(feature(200), { ...baseline, contourStrength: 1 });
  assert.deepEqual(weak, strong);
  assert.ok(policy.getBathymetryContourStrokeStyle(feature(200), { ...baseline, contourStrength: 1 }).alpha > policy.getBathymetryContourStrokeStyle(feature(200), baseline).alpha);
  assert.equal(policy.getBathymetryContourStrokeStyle(feature(200), { ...baseline, contourStrength: 0 }).alpha, 0);
  for (const method of ["getBathymetryBandFillStyle", "getBathymetryContourStrokeStyle"]) {
    assert.equal(policy[method](feature(200), { ...baseline, opacity: 0 }).alpha, 0);
  }
  const moreContrast = policy.getBathymetryBandFillStyle(feature(200), { ...baseline, scale: 2 });
  assert.notDeepEqual(weak, moreContrast);
  assert.equal(weak.alpha, moreContrast.alpha);
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

test("source grouping and depth order reuse immutable collection identities", () => {
  const { policy } = createHarness();
  const shallow = feature(100, { _bathymetrySource: "global" });
  const deep = feature(3000, { _bathymetrySource: "global" });
  const scenario = feature(200, { _bathymetrySource: "scenario" });
  const collection = { features: [shallow, scenario, deep] };
  const global = policy.getBathymetryCollectionBySource(collection, "global");
  const scenarioOnly = policy.getBathymetryCollectionBySource(collection, "scenario");
  assert.equal(policy.getBathymetryCollectionBySource(collection, "global"), global);
  assert.equal(policy.getBathymetryCollectionBySource(collection, "scenario"), scenarioOnly);
  assert.deepEqual(global.features, [shallow, deep]);
  assert.deepEqual(scenarioOnly.features, [scenario]);
  const sorted = policy.sortBathymetryFeaturesForFill(global);
  assert.equal(policy.sortBathymetryFeaturesForFill(global), sorted);
  assert.deepEqual(sorted, [deep, shallow]);
  assert.deepEqual(collection.features, [shallow, scenario, deep]);

  collection.features = [scenario, feature(5000, { _bathymetrySource: "global" })];
  const replacement = policy.getBathymetryCollectionBySource(collection, "global");
  assert.notEqual(replacement, global);
  assert.deepEqual(policy.sortBathymetryFeaturesForFill(replacement).map(item => item.properties.depth_max_m), [5000]);
  const replacementWrapper = { features: collection.features };
  assert.notEqual(policy.getBathymetryCollectionBySource(replacementWrapper, "global"), replacement);
  replacement.features = [shallow];
  assert.deepEqual(policy.sortBathymetryFeaturesForFill(replacement), [shallow]);
});

test("collection caches leave live style and ocean fill reads intact", () => {
  const { live, policy } = createHarness();
  const collection = { features: [feature(200, { _bathymetrySource: "global" })] };
  const selected = policy.getBathymetryCollectionBySource(collection, "global");
  const sorted = policy.sortBathymetryFeaturesForFill(selected);
  const style = { preset: "bathymetry_soft", opacity: 0.8, scale: 1, contourStrength: 0.3 };
  const before = policy.getBathymetryBandFillStyle(sorted[0], style);
  live.fill = "#112233";
  assert.notDeepEqual(policy.getBathymetryBandFillStyle(sorted[0], style), before);
  assert.notDeepEqual(policy.getBathymetryBandFillStyle(sorted[0], { ...style, scale: 2 }), before);
  assert.equal(policy.getBathymetryCollectionBySource(collection, "global"), selected);
  assert.equal(policy.sortBathymetryFeaturesForFill(selected), sorted);
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
