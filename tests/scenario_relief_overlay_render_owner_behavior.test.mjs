import test from "node:test";
import assert from "node:assert/strict";

import { createScenarioReliefOverlayRenderOwner } from "../js/core/renderer/scenario_relief_overlay_render_owner.js";

function createCanvasContext() {
  const calls = [];
  return {
    calls,
    fillStyle: "",
    globalAlpha: 1,
    lineCap: "",
    lineJoin: "",
    lineWidth: 1,
    strokeStyle: "",
    beginPath() {
      calls.push({ type: "beginPath" });
    },
    clip(path) {
      calls.push({ type: "clip", ...(path ? { path } : {}) });
    },
    fill(path) {
      calls.push({ type: "fill", alpha: this.globalAlpha, fillStyle: this.fillStyle, ...(path ? { path } : {}) });
    },
    lineTo(x, y) {
      calls.push({ type: "lineTo", x, y });
    },
    moveTo(x, y) {
      calls.push({ type: "moveTo", x, y });
    },
    restore() {
      calls.push({ type: "restore" });
    },
    save() {
      calls.push({ type: "save" });
    },
    setLineDash(value) {
      calls.push({ type: "setLineDash", value });
    },
    stroke(path) {
      calls.push({
        type: "stroke",
        alpha: this.globalAlpha,
        lineWidth: this.lineWidth,
        strokeStyle: this.strokeStyle,
        ...(path ? { path } : {}),
      });
    },
  };
}

function createFeature(id, overlayKind, geometryType = "Polygon") {
  return {
    id,
    geometry: {
      type: geometryType,
    },
    properties: {
      id,
      overlay_kind: overlayKind,
    },
  };
}

function createOwner({
  context = createCanvasContext(),
  features = [],
  renderPhase = "idle",
  showScenarioReliefOverlays = true,
  coastalAccentEnabled = false,
  getProjectedGeographicPath,
} = {}) {
  const metrics = [];
  const pathCalls = [];
  const state = {
    renderPhase,
    showScenarioReliefOverlays,
  };
  const owner = createScenarioReliefOverlayRenderOwner({
    state,
    constants: {
      RENDER_PHASE_INTERACTING: "interacting",
      RENDER_PHASE_SETTLING: "settling",
    },
    getters: {
      getContext: () => context,
      getPathCanvas: () => (feature) => pathCalls.push(feature.id),
      getProjectedGeographicPath,
    },
    helpers: {
      collectContextMetric: (name, durationMs, details) => metrics.push({ name, durationMs, details }),
      getEffectiveScenarioReliefOverlayFeatures: () => features,
      getPathBounds: () => ({ minX: 0, minY: 0, maxX: 20, maxY: 12 }),
      getReliefOverlayKind: (feature) => feature?.properties?.overlay_kind || "",
      getScenarioReliefVisualRevisionToken: () => "relief:1",
      isAtlantropaReliefOverlayFeature: (feature) => String(feature?.id || "").startsWith("atlantropa_"),
      isReliefOverlayEnabled: () => true,
      isScenarioCoastalAccentEnabled: () => coastalAccentEnabled,
      nowMs: () => 10,
      pathBoundsInScreen: () => true,
    },
  });
  return { context, metrics, owner, pathCalls, state };
}

test("scenario relief owner records disabled skip metrics", () => {
  const harness = createOwner({
    features: [createFeature("salt-a", "salt_flat_texture")],
    showScenarioReliefOverlays: false,
  });

  const renderedCount = harness.owner.drawScenarioReliefOverlaysLayer(2);

  assert.equal(renderedCount, 0);
  assert.equal(harness.metrics.at(-1).name, "contextScenarioLayerRelief");
  assert.equal(harness.metrics.at(-1).details.reason, "disabled");
  assert.equal(harness.metrics.at(-1).details.signature, "relief:1");
  assert.equal(harness.context.calls.length, 0);
});

test("scenario relief owner draws salt texture fill and line pattern", () => {
  const harness = createOwner({
    features: [createFeature("salt-a", "salt_flat_texture")],
  });

  const renderedCount = harness.owner.drawScenarioReliefOverlaysLayer(2, { cacheMode: "redraw" });

  assert.equal(renderedCount, 1);
  assert.deepEqual(harness.pathCalls, ["salt-a", "salt-a"]);
  assert.ok(harness.context.calls.some((call) => call.type === "fill"));
  assert.ok(harness.context.calls.filter((call) => call.type === "stroke").length > 1);
  assert.equal(harness.metrics.at(-1).details.cacheMode, "redraw");
  assert.equal(harness.metrics.at(-1).details.renderedCount, 1);
});

test("scenario relief owner lets coastal accent own shoreline overlays", () => {
  const shoreline = createFeature("shore-a", "new_shoreline", "LineString");
  const dam = createFeature("dam-a", "dam_approach", "LineString");
  const harness = createOwner({
    coastalAccentEnabled: true,
    features: [shoreline, dam],
  });

  const renderedCount = harness.owner.drawScenarioReliefOverlaysLayer(3);

  assert.equal(renderedCount, 1);
  assert.deepEqual(harness.pathCalls, ["dam-a"]);
  assert.ok(harness.context.calls.some((call) => call.type === "setLineDash"));
});

test("scenario relief owner skips interacting and settling phases", () => {
  const harness = createOwner({
    features: [createFeature("salt-a", "salt_flat_texture")],
    renderPhase: "interacting",
  });

  const renderedCount = harness.owner.drawScenarioReliefOverlaysLayer(2);

  assert.equal(renderedCount, 0);
  assert.equal(harness.metrics.at(-1).details.reason, "interacting");
  assert.equal(harness.context.calls.length, 0);
});

for (const [id, kind, geometryType, filled] of [
  ["salt-a", "salt_flat_texture", "Polygon", true],
  ["atlantropa_salt", "salt_flat_texture", "MultiPolygon", true],
  ["swamp-a", "swamp_margin", "MultiPolygon", true],
  ["shore-a", "new_shoreline", "LineString", false],
  ["dam-a", "dam_approach", "LineString", false],
]) {
  test(`scenario relief reuses one projected path for ${id} without changing styles or pattern order`, () => {
    const feature = createFeature(id, kind, geometryType);
    const path = { feature: id };
    const requested = [];
    const cached = createOwner({ features: [feature], getProjectedGeographicPath: (value) => {
      requested.push(value);
      return path;
    } });
    const native = createOwner({ features: [feature] });
    assert.equal(cached.owner.drawScenarioReliefOverlaysLayer(2), 1);
    assert.equal(native.owner.drawScenarioReliefOverlaysLayer(2), 1);
    assert.deepEqual(requested, [feature]);
    assert.deepEqual(cached.pathCalls, []);
    assert.deepEqual(native.pathCalls, filled ? [id, id] : [id]);
    const pathOperations = cached.context.calls.filter((call) => call.path);
    assert.deepEqual(pathOperations.map(({ type }) => type), filled ? ["fill", "clip", "stroke"] : ["stroke"]);
    assert.ok(pathOperations.every((call) => call.path === path));
    assert.deepEqual(cached.context.calls.map(({ path: _path, ...call }) => call), native.context.calls);
    assert.deepEqual(cached.metrics, native.metrics);
  });
}

test("scenario relief uses its native path when the projected path getter has no result", () => {
  const feature = createFeature("salt-a", "salt_flat_texture");
  const native = createOwner({ features: [feature] });
  let requests = 0;
  const missing = createOwner({ features: [feature], getProjectedGeographicPath: () => { requests++; return null; } });
  native.owner.drawScenarioReliefOverlaysLayer(2);
  missing.owner.drawScenarioReliefOverlaysLayer(2);
  assert.equal(requests, 1);
  assert.deepEqual(missing.pathCalls, native.pathCalls);
  assert.deepEqual(missing.context.calls, native.context.calls);
});
