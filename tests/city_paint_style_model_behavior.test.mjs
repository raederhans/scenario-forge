import assert from "node:assert/strict";
import test from "node:test";
import { createCityPaintStyleModel } from "../js/core/renderer/city_paint_style_model.js";
import { createUrbanAdaptivePaintModel } from "../js/core/renderer/urban_adaptive_paint_model.js";

function createModel(runtimeState = {}, getResolvedFeatureColor = () => "#ffffff") {
  const urban = createUrbanAdaptivePaintModel(runtimeState, {
    getResolvedFeatureColor,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  });
  return createCityPaintStyleModel(runtimeState, {
    getResolvedFeatureColor,
    computeUrbanAdaptivePaintFromHostColor: urban.computeUrbanAdaptivePaintFromHostColor,
  });
}

test("city label and marker contrast follow replaced host maps and explicit colors", () => {
  const firstHost = {};
  const secondHost = {};
  const runtimeState = { landIndex: new Map([["host", firstHost]]), colors: { host: "#101010" } };
  const model = createModel(runtimeState);
  const entry = { feature: { properties: { __city_host_feature_id: "host" } } };
  assert.equal(model.getCityLabelRenderStyle(entry).usesLightLabel, true);
  assert.equal(model.getCityMarkerRenderStyle(entry).adapted, true);

  runtimeState.landIndex = new Map([["host", secondHost]]);
  runtimeState.colors = { host: "invalid-color" };
  assert.equal(model.getCityLabelRenderStyle(entry).usesLightLabel, false);
  assert.equal(model.getCityMarkerRenderStyle(entry).adapted, false);
});

test("explicit marker colors override theme colors", () => {
  const model = createModel();
  const theme = "classic_graphite";
  const base = model.getCityMarkerRenderStyle({}, { theme });
  const custom = model.getCityMarkerRenderStyle({}, { theme, color: "#ff0000", capitalColor: "#00ff00" });
  assert.notEqual(custom.tokens.fillMid, base.tokens.fillMid);
  assert.notEqual(custom.tokens.capitalAccent, base.tokens.capitalAccent);
});
