import test from "node:test";
import assert from "node:assert/strict";
import { createRiverLayerRenderOwner } from "../js/core/renderer/river_layer_render_owner.js";

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function createFeature(featurecla, scalerank = 8, minZoom = undefined) {
  return {
    properties: {
      featurecla,
      scalerank,
      min_zoom: minZoom,
    },
  };
}

function createCanvasContext() {
  const calls = [];
  return {
    calls,
    globalAlpha: 1,
    lineWidth: 1,
    strokeStyle: "",
    lineCap: "",
    lineJoin: "",
    beginPath() {}, restore() {}, save() {}, setLineDash() {},
    stroke() {
      calls.push({
        type: "stroke",
        alpha: this.globalAlpha,
        lineWidth: this.lineWidth,
        strokeStyle: this.strokeStyle,
      });
    },
  };
}

function createOwner({ features }) {
  const context = createCanvasContext();

  const state = {
    activeScenarioId: "",
    activeScenarioManifest: null,
    riversData: { type: "FeatureCollection", features },
    showRivers: true,
    styleConfig: {
      rivers: {
        color: "#336699",
        dashStyle: "dashed",
        opacity: 0.8,
        outlineColor: "#ddeeff",
        outlineWidth: 0.4,
        width: 1.2,
      },
    },
  };
  const owner = createRiverLayerRenderOwner({
    state,
    helpers: {
      clamp,
      collectContextMetric() {},

      getContext: () => context,
      getContextBaseZoomBucketId: (k) => (k < 1.4 ? "low" : k < 2.5 ? "mid" : "high"),
      getDashPattern: () => [4, 2],
      getFeatureCollectionFeatureCount: (collection) => collection?.features?.length || 0,
      getPathCanvas: () => () => {},
      getSafeCanvasColor: (color, fallback) => color || fallback,
      nowMs: () => 10,
      pathBoundsInScreen: () => true,
    },
  });
  return { context, owner };
}

test("river rank determines visibility across zoom buckets", () => {
  const cases = [
    { properties: { scalerank: 4 }, visible: [true, true, true] },
    { properties: { scalerank: 7 }, visible: [false, true, true] },
  ];
  for (const [index, sample] of cases.entries()) {
    for (const [zoomIndex, scale] of [1, 2, 3].entries()) {
      const feature = { properties: { featurecla: "River", ...sample.properties } };
      const harness = createOwner({ features: [feature] });
      harness.owner.drawRiversLayer(scale);
      const visible = sample.visible[zoomIndex];
      const message = `case ${index}, zoom ${scale}`;

      const strokes = harness.context.calls.filter((call) => call.type === "stroke");
      assert.equal(strokes.length, visible ? 2 : 0, message);
    }
  }
});

test("river rank changes visual weight while close zoom retains visible core width", () => {
  const major = createFeature("River", 3);
  const tributary = createFeature("River", 9);
  const harness = createOwner({ features: [major, tributary] });
  harness.owner.drawRiversLayer(5);
  const strokes = harness.context.calls.filter((call) => call.type === "stroke");
  const core = strokes.filter((call) => call.strokeStyle === "#336699");
  const outlines = strokes.filter((call) => call.strokeStyle === "#ddeeff");
  assert.ok(core[0].lineWidth > core[1].lineWidth);
  assert.ok(core[0].lineWidth * 5 > 1.2 * 0.75);
  assert.ok(outlines[0].alpha > outlines[1].alpha);
});
