import assert from "node:assert/strict";
import test from "node:test";
import { createUrbanLayerRenderOwner } from "../js/core/renderer/urban_layer_render_owner.js";
import { createUrbanAdaptivePaintModel } from "../js/core/renderer/urban_adaptive_paint_model.js";
import { markProjectionGeometryChanged } from "../js/core/renderer/projection_geometry_identity.js";
import { normalizeUrbanStyleConfig } from "../js/core/state_defaults.js";

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const feature = () => ({
  properties: { country_owner_id: "host" },
  geometry: { type: "Polygon", coordinates: [[[0, 0], [2, 0], [1, 1], [0, 0]]] },
});

function harness({ style = {}, features = [feature()], Path = class {} } = {}) {
  const calls = [];
  const metrics = [];
  const stack = [];
  const context = {
    lineJoin: "miter", lineCap: "butt", globalAlpha: 1, lineWidth: 2,
    globalCompositeOperation: "source-over", dash: [3, 2],
    save() { stack.push({ ...this }); },
    restore() { Object.assign(this, stack.pop()); },
    setLineDash(dash) { this.dash = dash; },
    beginPath() { calls.push({ type: "begin" }); },
    fill(path) { calls.push({ type: "fill", path, alpha: this.globalAlpha, color: this.fillStyle, blend: this.globalCompositeOperation }); },
    stroke(path) { calls.push({ type: "stroke", path, alpha: this.globalAlpha, width: this.lineWidth, join: this.lineJoin, dash: this.dash }); },
  };
  let target = context;
  const builds = [];
  const pathCanvas = (f) => { builds.push(f); if (live.throwPath) throw new Error("projection failure"); };
  pathCanvas.context = (...args) => { if (!args.length) return target; target = args[0]; return pathCanvas; };
  const state = {
    showUrban: true, urbanData: { features }, contextLayerRevision: 1,
    urbanLayerCapability: { adaptiveAvailable: true },
    styleConfig: { urban: { mode: "adaptive", ...style } },
    landIndex: new Map([["host", {}]]), colors: { host: "#101010" },
  };
  const live = { projection: {}, glow: 1, throwPath: false };
  const paint = createUrbanAdaptivePaintModel(state, { clamp, getResolvedFeatureColor: () => "#eeeeee" });
  const owner = createUrbanLayerRenderOwner({ state, helpers: {
    clamp, getContext: () => context, getPathCanvas: () => pathCanvas,
    getProjection: () => live.projection, getPath2D: () => Path,
    createDrawPaintResolver: paint.createDrawPaintResolver,
    getEffectiveUrbanMode: paint.getEffectiveUrbanMode,
    getSafeBlendMode: (v, fallback) => v || fallback,
    getSafeCanvasColor: (v, fallback) => v || fallback,
    getUrbanGlowFeatureMultiplier: () => live.glow,
    getUrbanLayerCapability: () => state.urbanLayerCapability,
    normalizeUrbanStyleConfig, nowMs: () => 0,
    estimateProjectedAreaPx: (f) => f.small ? 0 : 100,
    pathBoundsInScreen: (f) => !f.offscreen,
    collectContextMetric: (name, duration, details) => metrics.push(details),
  } });
  return { owner, state, context, calls, builds, live, metrics, pathCanvas };
}

test("urban outlines stay subpixel with round joins at every supported zoom, including maximum zoom", () => {
  const h = harness();
  for (const k of [1, 2, 3, 5, 10, 20, 50]) {
    h.owner.drawUrbanLayer(k);
    const stroke = h.calls.at(-1);
    assert.equal(stroke.type, "stroke");
    assert.ok(stroke.width * k >= 0.6 && stroke.width * k <= 0.9, `screen width at ${k}x`);
    assert.equal(stroke.join, "round");
    assert.deepEqual(stroke.dash, []);
  }
  assert.equal(h.context.lineJoin, "miter");
  assert.deepEqual(h.context.dash, [3, 2]);
  assert.equal(h.builds.length, 1, "zoom alone does not reproject the geometry");
});

test("near adaptive paint gently fades fill and outline while manual styling remains literal", () => {
  const h = harness();
  h.owner.drawUrbanLayer(1);
  const farFill = h.calls[0].alpha;
  const farStroke = h.calls[1].alpha;
  h.owner.drawUrbanLayer(20);
  assert.ok(h.calls[2].alpha < farFill && h.calls[2].alpha >= farFill * 0.8);
  assert.ok(h.calls[3].alpha < farStroke * 0.5);
  const manual = harness({ style: { mode: "manual", color: "#334455", fillOpacity: 0.7, blendMode: "multiply" } });
  manual.owner.drawUrbanLayer(50);
  assert.equal(manual.calls.length, 1);
  assert.equal(manual.calls[0].alpha, 0.7);
  assert.equal(manual.calls[0].color, "#334455");
  assert.equal(manual.calls[0].blend, "multiply");
});

test("cached paths survive paint edits but follow data replacement, context revision and projection mutation", () => {
  const h = harness();
  h.owner.drawUrbanLayer(4);
  const firstPath = h.calls[0].path;
  const firstColor = h.calls[0].color;
  h.state.colors.host = "#eeeeee";
  h.owner.drawUrbanLayer(4);
  assert.equal(h.calls[2].path, firstPath);
  assert.notEqual(h.calls[2].color, firstColor);
  assert.equal(h.metrics.at(-1).pathCacheHitCount, 1);
  const invalidate = [
    () => { h.state.urbanData = { features: [feature()] }; },
    () => { h.state.contextLayerRevision++; },
    () => { markProjectionGeometryChanged(h.live.projection); },
    () => { h.live.projection = {}; },
    () => { h.state.urbanData.features[0].geometry = feature().geometry; },
  ];
  for (const change of invalidate) {
    const previousPath = h.calls.at(-1).path;
    change();
    h.owner.drawUrbanLayer(4);
    assert.notEqual(h.calls.at(-1).path, previousPath);
    assert.equal(h.metrics.at(-1).pathBuildCount, 1);
  }
});

test("zero alpha, hidden, tiny and offscreen urban polygons avoid path construction and drawing", () => {
  for (const style of [{ fillOpacity: 0, strokeOpacity: 0 }, { mode: "manual", fillOpacity: 0 }]) {
    const h = harness({ style });
    h.owner.drawUrbanLayer(20);
    assert.equal(h.builds.length, 0);
    assert.equal(h.calls.length, 0);
  }
  const h = harness({ features: [{ ...feature(), small: true }, { ...feature(), offscreen: true }] });
  h.owner.drawUrbanLayer(20);
  assert.equal(h.builds.length, 0);
  h.state.showUrban = false;
  h.owner.drawUrbanLayer(20);
  assert.equal(h.metrics.at(-1).reason, "hidden");
  const noGlow = harness();
  noGlow.live.glow = 0;
  noGlow.owner.drawUrbanLayer(20);
  assert.equal(noGlow.builds.length, 0);
});

test("disabled outlines omit stroke calls and glow still modulates interactive alpha", () => {
  const h = harness({ style: { strokeOpacity: 0 } });
  h.live.glow = 0.5;
  h.owner.drawUrbanLayer(1, { interactive: true });
  assert.deepEqual(h.calls.map((call) => call.type), ["fill"]);
  assert.equal(h.calls[0].alpha, 0.075);
});

test("path projection failure restores both shared d3 context and canvas state", () => {
  const h = harness();
  h.live.throwPath = true;
  assert.throws(() => h.owner.drawUrbanLayer(10), /projection failure/);
  assert.equal(h.pathCanvas.context(), h.context);
  assert.equal(h.context.lineJoin, "miter");
  h.live.throwPath = false;
  h.owner.drawUrbanLayer(10);
  assert.equal(h.metrics.at(-1).pathBuildCount, 1);
});

test("the existing immediate path fallback renders when Path2D is unavailable", () => {
  const h = harness({ Path: null });
  h.owner.drawUrbanLayer(10);
  assert.deepEqual(h.calls.map((call) => call.type), ["begin", "fill", "stroke"]);
  assert.equal(h.builds.length, 1);
});
