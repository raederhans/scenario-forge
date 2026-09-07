import assert from "node:assert/strict";
import test from "node:test";
import { createCityPaintStyleModel } from "../js/core/renderer/city_paint_style_model.js";
import { createUrbanAdaptivePaintModel } from "../js/core/renderer/urban_adaptive_paint_model.js";

function createModel(runtimeState = {}, getResolvedFeatureColor = () => "#ffffff") {
  const urban = createUrbanAdaptivePaintModel({
    runtimeState, getResolvedFeatureColor,
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  });
  return createCityPaintStyleModel({
    runtimeState, getResolvedFeatureColor,
    computeUrbanAdaptivePaintFromHostColor: urban.computeUrbanAdaptivePaintFromHostColor,
  });
}

test("city label and marker contrast follow replaced host maps and explicit colors", () => {
  const firstHost = {};
  const secondHost = {};
  const runtimeState = { landIndex: new Map([["host", firstHost]]), colors: { host: "#101010" } };
  const calls = [];
  const model = createModel(runtimeState, (host, id) => { calls.push([host, id]); return "#ffffff"; });
  const entry = { feature: { properties: { __city_host_feature_id: "host" } } };
  assert.equal(model.getCityLabelRenderStyle(entry).usesLightLabel, true);
  assert.equal(model.getCityMarkerRenderStyle(entry).adapted, true);
  assert.equal(calls.length, 0);

  runtimeState.landIndex = new Map([["host", secondHost]]);
  runtimeState.colors = { host: "invalid-color" };
  assert.equal(model.getCityLabelRenderStyle(entry).usesLightLabel, false);
  assert.equal(model.getCityMarkerRenderStyle(entry).adapted, false);
  assert.deepEqual(calls, [[secondHost, "host"], [secondHost, "host"]]);
});

test("city country palette precedence remains live when no host exists", () => {
  const runtimeState = {
    sovereignBaseColors: { AA: "#111111" }, countryBaseColors: { AA: "#eeeeee" },
  };
  const model = createModel(runtimeState);
  const entry = { properties: { __city_scenario_tag: " aa ", country_code: "BB" } };
  assert.equal(model.getCityLabelRenderStyle(entry).backgroundColor, "#111111");
  runtimeState.sovereignBaseColors = {};
  assert.equal(model.getCityMarkerRenderStyle(entry).backgroundColor, "#eeeeee");
  runtimeState.countryBaseColors = {};
  assert.equal(model.getCityLabelRenderStyle(entry).backgroundColor, "");
  assert.equal(model.getCityMarkerRenderStyle(entry).adapted, false);
});

test("city themes preserve capital distinction and do not retain per-call colors", () => {
  const model = createModel();
  const plain = model.getCityMarkerRenderStyle({});
  assert.deepEqual(model.getCityMarkerRenderStyle({}, { theme: "unknown" }), plain);
  for (const theme of ["classic_graphite", "atlas_ink", "parchment_sepia", "slate_blue", "ivory_outline"]) {
    const base = model.getCityMarkerRenderStyle({}, { theme });
    const custom = model.getCityMarkerRenderStyle({}, { theme, color: "#ff0000", capitalColor: "#00ff00" });
    assert.notEqual(custom.tokens.fillMid, base.tokens.fillMid);
    assert.notEqual(custom.tokens.capitalAccent, base.tokens.capitalAccent);
    assert.deepEqual(model.getCityMarkerRenderStyle({}, { theme }), base);
    assert.notEqual(model.getCityLabelRenderStyle({ isCapital: true }, { theme }).fillStyle,
      model.getCityLabelRenderStyle({}, { theme }).fillStyle);
  }
});

test("dark host adaptation shares contrast but retains marker fill and capital colors", () => {
  const runtimeState = { countryBaseColors: { AA: "#101010" } };
  const model = createModel(runtimeState);
  const entry = { isCapital: true, feature: { properties: { country_code: "AA" } } };
  const dark = model.getCityMarkerRenderStyle(entry);
  assert.equal(model.getCityLabelRenderStyle(entry).fillStyle, "rgba(248, 245, 238, 0.98)");
  runtimeState.countryBaseColors.AA = "#ffffff";
  const light = model.getCityMarkerRenderStyle(entry);
  assert.equal(dark.tokens.fillMid, light.tokens.fillMid);
  assert.equal(dark.tokens.capitalAccent, light.tokens.capitalAccent);
  assert.notEqual(dark.tokens.stroke, light.tokens.stroke);
  assert.equal(dark.adapted, true);
  assert.equal(light.adapted, false);
});
