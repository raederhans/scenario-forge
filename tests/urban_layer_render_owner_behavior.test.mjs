import assert from "node:assert/strict";
import test from "node:test";
import { createUrbanLayerRenderOwner } from "../js/core/renderer/urban_layer_render_owner.js";
import { createUrbanAdaptivePaintModel } from "../js/core/renderer/urban_adaptive_paint_model.js";
import { normalizeUrbanStyleConfig } from "../js/core/state_defaults.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const feature = () => ({
  properties: { country_owner_id: "host" },
  geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [1, 1], [0, 0]]] },
});

function harness() {
  const calls = [];
  const context = {
    lineJoin: "miter", lineCap: "butt", globalAlpha: 1, lineWidth: 2,
    globalCompositeOperation: "source-over", dash: [3, 2],
    save() {}, restore() {}, setLineDash() {}, beginPath() {}, fill() {},
    stroke() { calls.push({ width: this.lineWidth }); },
  };
  let target = context;
  const pathCanvas = () => {};
  pathCanvas.context = (...args) => { if (!args.length) return target; target = args[0]; return pathCanvas; };
  const state = {
    showUrban: true, urbanData: { features: [feature()] },
    urbanLayerCapability: { adaptiveAvailable: true },
    styleConfig: { urban: { mode: "adaptive" } },
    landIndex: new Map([["host", {}]]), colors: { host: "#101010" },
  };
  const projection = {};
  const paint = createUrbanAdaptivePaintModel(state, { clamp, getResolvedFeatureColor: () => "#eeeeee" });
  const owner = createUrbanLayerRenderOwner({ state, helpers: {
    clamp, getContext: () => context, getPathCanvas: () => pathCanvas,
    getProjection: () => projection, getPath2D: () => null,
    createDrawPaintResolver: paint.createDrawPaintResolver,
    getEffectiveUrbanMode: paint.getEffectiveUrbanMode,
    getSafeBlendMode: (v, fallback) => v || fallback,
    getSafeCanvasColor: (v, fallback) => v || fallback,
    getUrbanGlowFeatureMultiplier: () => 1,
    getUrbanLayerCapability: () => state.urbanLayerCapability,
    normalizeUrbanStyleConfig, nowMs: () => 0,
    estimateProjectedAreaPx: () => 100, pathBoundsInScreen: () => true,
    collectContextMetric() {},
  } });
  return { owner, calls };
}

test("urban outline width stays subpixel across zoom levels", () => {
  const h = harness();
  for (const k of [1, 2, 3, 5, 10, 20, 50]) {
    h.owner.drawUrbanLayer(k);
    const stroke = h.calls.at(-1);
    assert.ok(stroke.width * k >= 0.6 && stroke.width * k <= 0.9, `screen width at ${k}x`);
  }
});
