import assert from "node:assert/strict";
import test from "node:test";
import {
  createUrbanAdaptivePaintModel,
  getUrbanFeatureOwnerId,
} from "../js/core/renderer/urban_adaptive_paint_model.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const createModel = (runtimeState = {}, getResolvedFeatureColor = () => "#eeeeee") =>
  createUrbanAdaptivePaintModel({ runtimeState, getResolvedFeatureColor, clamp });

test("urban paint preserves dark, middle and light host colors with channel-specific tint", () => {
  const model = createModel();
  const config = { adaptiveStrength: 0.8, toneBias: 0.1 };
  const cases = [
    ["#101010", ["#aba89f", "#d3cec6"], ["#b58a6f", "#d1b09b"]],
    ["#a0a0a0", ["#d1cdc5", "#ebe4dc"], ["#d0a48a", "#e4c1ac"]],
    ["#bdbdbd", ["#686b6f", "#3d4144"], ["#865f4e", "#5c4235"]],
    ["#eeeeee", ["#838589", "#525659"], ["#997260", "#6c5246"]],
  ];
  for (const [background, plain, tinted] of cases) {
    const paint = (colors) => ({ fillColor: colors[0], strokeColor: colors[1] });
    assert.deepEqual(model.computeUrbanAdaptivePaintFromHostColor(background, config), paint(plain));
    assert.deepEqual(model.computeUrbanAdaptivePaintFromHostColor(background, {
      ...config, adaptiveTintEnabled: true, adaptiveTintColor: "#cc4400", adaptiveTintStrength: 0.3,
    }), paint(tinted));
  }
  assert.equal(model.computeUrbanAdaptivePaintFromHostColor(null), null);
  assert.equal(model.computeUrbanAdaptivePaintFromHostColor("invalid-color"), null);
});

test("urban host resolution follows replacement state maps and resolver without caching colors", () => {
  const feature = { properties: { country_owner_id: " host " } };
  const firstHost = {};
  const secondHost = {};
  const runtimeState = { landIndex: new Map([["host", firstHost]]), colors: { host: "#101010" } };
  const calls = [];
  const model = createModel(runtimeState, (host, id) => { calls.push([host, id]); return "#eeeeee"; });
  assert.equal(getUrbanFeatureOwnerId(feature), "host");
  assert.equal(getUrbanFeatureOwnerId({ properties: { countryOwnerId: " legacy " } }), "legacy");
  assert.deepEqual(model.getUrbanAdaptivePaint(feature), model.computeUrbanAdaptivePaintFromHostColor("#101010"));
  assert.equal(calls.length, 0);
  runtimeState.colors = { host: "invalid-color" };
  runtimeState.landIndex = new Map([["host", secondHost]]);
  assert.deepEqual(model.getUrbanAdaptivePaint(feature), model.computeUrbanAdaptivePaintFromHostColor("#eeeeee"));
  assert.deepEqual(calls, [[secondHost, "host"]]);
  runtimeState.landIndex = new Map();
  assert.equal(model.getUrbanAdaptivePaint(feature), null);
  assert.equal(model.getUrbanAdaptivePaint({}), null);
});

test("urban adaptive capability defaults remain live and explicit capability overrides state", () => {
  const runtimeState = { urbanLayerCapability: { adaptiveAvailable: false } };
  const model = createModel(runtimeState);
  assert.equal(model.getEffectiveUrbanMode({ mode: "adaptive" }), "manual");
  runtimeState.urbanLayerCapability = { adaptiveAvailable: true };
  assert.equal(model.getEffectiveUrbanMode({ mode: "adaptive" }), "adaptive");
  assert.equal(model.getEffectiveUrbanMode({ mode: "adaptive" }, null), "manual");
  assert.equal(model.getEffectiveUrbanMode({ mode: "manual" }), "manual");
});
