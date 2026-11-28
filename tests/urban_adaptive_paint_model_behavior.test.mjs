import assert from "node:assert/strict";
import test from "node:test";
import { createUrbanAdaptivePaintModel } from "../js/core/renderer/urban_adaptive_paint_model.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const createModel = (runtimeState = {}, getResolvedFeatureColor = () => "#eeeeee") =>
  createUrbanAdaptivePaintModel(runtimeState, { getResolvedFeatureColor, clamp });

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
});

test("the next draw reflects host recoloring", () => {
  let color = "#101010";
  const state = { landIndex: new Map([["host", {}]]) };
  const model = createModel(state, () => color);
  const resolve = model.createDrawPaintResolver();
  const first = resolve({ properties: { country_owner_id: "host" } });
  color = "#eeeeee";
  assert.notDeepEqual(model.createDrawPaintResolver()({ properties: { country_owner_id: "host" } }), first);
});
