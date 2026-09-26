import test from "node:test";
import assert from "node:assert/strict";

import { createRiverLayerRenderOwner, getRiverZoomBucket } from "../js/core/renderer/river_layer_render_owner.js";

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
    beginPath() {
      calls.push({ type: "beginPath" });
    },
    restore() {
      calls.push({ type: "restore" });
    },
    save() {
      calls.push({ type: "save" });
    },
    setLineDash(pattern) {
      calls.push({ type: "setLineDash", pattern: [...pattern] });
    },
    stroke(path) {
      calls.push({
        type: "stroke",
        path,
        alpha: this.globalAlpha,
        lineWidth: this.lineWidth,
        strokeStyle: this.strokeStyle,
      });
    },
  };
}

function createOwner({
  context = createCanvasContext(),
  features = [],
  hgoVectorScene = false,
  pathBoundsInScreen = () => true,
  showRivers = true,
  pathCanvas = null,
} = {}) {
  const metrics = [];
  const pathCalls = [];
  const state = {
    activeScenarioId: hgoVectorScene ? "hgo_1936" : "",
    activeScenarioManifest: hgoVectorScene
      ? {
        scenario_contract_profile: "hgo_vector",
        performance_hints: {
          hgo_vector_scene_default: true,
        },
      }
      : null,
    riversData: { type: "FeatureCollection", features },
    showRivers,
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
      collectContextMetric: (name, durationMs, details) => metrics.push({ name, durationMs, details }),
      getContext: () => context,
      getContextBaseZoomBucketId: (k) => (k < 1.4 ? "low" : k < 2.5 ? "mid" : "high"),
      getDashPattern: () => [4, 2],
      getFeatureCollectionFeatureCount: (collection) => collection?.features?.length || 0,
      getPathCanvas: () => pathCanvas || ((feature) => pathCalls.push(feature)),
      getSafeCanvasColor: (color, fallback) => color || fallback,
      nowMs: () => 10,
      pathBoundsInScreen,
    },
  });
  return { context, metrics, owner, pathCalls, state };
}

test("river layer owner records skip metrics with explicit reasons", () => {
  const hidden = createOwner({ features: [createFeature("River", 1)], showRivers: false });
  hidden.owner.drawRiversLayer(1);
  assert.equal(hidden.metrics.at(-1).details.skipped, true);
  assert.equal(hidden.metrics.at(-1).details.reason, "hidden");

  const empty = createOwner({ features: [] });
  empty.owner.drawRiversLayer(1);
  assert.equal(empty.metrics.at(-1).details.skipped, true);
  assert.equal(empty.metrics.at(-1).details.reason, "no-data");

  const noContext = createOwner({ context: null, features: [createFeature("River", 1)] });
  noContext.owner.drawRiversLayer(1);
  assert.equal(noContext.metrics.at(-1).details.skipped, true);
  assert.equal(noContext.metrics.at(-1).details.reason, "no-context");
});

test("river layer owner adds a small near-zoom tier without drawing lake centerlines", () => {
  const features = [
    createFeature("River", 4),
    createFeature("River", 7),
    createFeature("River (Intermittent)", 8),
    createFeature("Lake Centerline", 8),
    createFeature("Canal", 8),
  ];
  const harness = createOwner({ features });

  harness.owner.drawRiversLayer(1);
  assert.equal(harness.metrics.at(-1).details.zoomBucket, "low");
  assert.equal(harness.metrics.at(-1).details.visibleFeatureCount, 1);

  harness.owner.drawRiversLayer(1.5);
  assert.equal(harness.metrics.at(-1).details.zoomBucket, "mid");
  assert.equal(harness.metrics.at(-1).details.visibleFeatureCount, 2);

  harness.owner.drawRiversLayer(2.6);
  assert.equal(harness.metrics.at(-1).details.zoomBucket, "high");
  assert.equal(harness.metrics.at(-1).details.visibleFeatureCount, 2);

  harness.owner.drawRiversLayer(5);
  assert.equal(harness.metrics.at(-1).details.zoomBucket, "detail");
  assert.equal(harness.metrics.at(-1).details.visibleFeatureCount, 4);
  assert.equal(getRiverZoomBucket(4.99), "high");
  assert.equal(getRiverZoomBucket(5), "detail");
});

test("river layer owner keeps min zoom bridge for rank eight rivers at mid zoom", () => {
  const features = [
    createFeature("River", 8, 4),
    createFeature("River", 8, 6),
  ];
  const harness = createOwner({ features });

  harness.owner.drawRiversLayer(1.5);

  assert.equal(harness.metrics.at(-1).details.zoomBucket, "mid");
  assert.equal(harness.metrics.at(-1).details.visibleFeatureCount, 1);
});

test("river draw preserves zero ranks and finite rank defaults across zoom buckets", () => {
  const cases = [
    { properties: { scalerank: 0 }, visible: [true, true, true] },
    { properties: { scalerank: "0" }, visible: [true, true, true] },
    { properties: { SCALERANK: 0 }, visible: [true, true, true] },
    { properties: { scalerank: 0, SCALERANK: 9 }, visible: [true, true, true] },
    { properties: { scalerank: 4 }, visible: [true, true, true] },
    { properties: { scalerank: 7 }, visible: [false, true, true] },
    { properties: {}, visible: [false, false, true] },
    { properties: { scalerank: "invalid" }, visible: [false, false, true] },
    { properties: { scalerank: Number.NaN }, visible: [false, false, true] },
    { properties: { scalerank: Infinity, min_zoom: 4 }, visible: [false, true, true] },
    { properties: { scalerank: -Infinity, min_zoom: 4 }, visible: [false, true, true] },
  ];
  for (const [index, sample] of cases.entries()) {
    for (const [zoomIndex, scale] of [1, 2, 3].entries()) {
      const feature = { properties: { featurecla: "River", ...sample.properties } };
      const harness = createOwner({ features: [feature] });
      harness.owner.drawRiversLayer(scale);
      const visible = sample.visible[zoomIndex];
      const message = `case ${index}, zoom ${scale}`;
      assert.equal(harness.metrics.at(-1).details.visibleFeatureCount, Number(visible), message);
      assert.deepEqual(harness.pathCalls, visible ? [feature, feature] : [], message);
      const strokes = harness.context.calls.filter((call) => call.type === "stroke");
      assert.equal(strokes.length, visible ? 2 : 0, message);
      if (visible) {
        const widthFactor = [0.95, 1.05, 1.2][zoomIndex];
        const rank = Number.isFinite(Number(sample.properties.scalerank ?? sample.properties.SCALERANK))
          ? Number(sample.properties.scalerank ?? sample.properties.SCALERANK)
          : 8;
        const rankWidthFactor = rank <= 5 ? 1.15 : rank <= 7 ? 1 : rank === 8 ? 0.85 : 0.75;
        assert.equal(strokes[1].lineWidth, 1.2 * widthFactor * rankWidthFactor / scale, message);
      }
    }
  }
});

test("river layer owner culls offscreen features before drawing", () => {
  const visibleFeature = createFeature("River", 4);
  const hiddenFeature = createFeature("River", 4);
  const harness = createOwner({
    features: [visibleFeature, hiddenFeature],
    pathBoundsInScreen: (feature) => feature === visibleFeature,
  });

  harness.owner.drawRiversLayer(1);

  assert.equal(harness.metrics.at(-1).details.visibleFeatureCount, 1);
  assert.ok(harness.pathCalls.every((feature) => feature === visibleFeature));
});

test("river candidates are classified once per data object and screened by tier before viewport checks", () => {
  const major = createFeature("River", 4);
  const tributary = createFeature("River", 9);
  const centerline = createFeature("Lake Centerline", 4);
  const checked = [];
  const harness = createOwner({
    features: [major, tributary, centerline],
    pathBoundsInScreen: (feature) => { checked.push(feature); return true; },
  });
  harness.owner.drawRiversLayer(1);
  assert.deepEqual(checked, [major]);
  harness.owner.drawRiversLayer(5);
  assert.deepEqual(checked.slice(1), [major, tributary]);
  harness.state.riversData = { type: "FeatureCollection", features: [tributary] };
  harness.owner.drawRiversLayer(1);
  assert.equal(harness.metrics.at(-1).details.visibleFeatureCount, 0);
  assert.equal(checked.length, 3);
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

test("river layer owner scales dash and line widths by zoom", () => {
  const harness = createOwner({ features: [createFeature("River", 4)] });

  harness.owner.drawRiversLayer(2);

  const dashCalls = harness.context.calls.filter((call) => call.type === "setLineDash");
  const strokeCalls = harness.context.calls.filter((call) => call.type === "stroke");
  assert.deepEqual(dashCalls[0].pattern, [2, 1]);
  assert.deepEqual(dashCalls[1].pattern, [2, 1]);
  assert.deepEqual(dashCalls.at(-1).pattern, []);
  assert.equal(strokeCalls.length, 2);
  assert.ok(strokeCalls[0].lineWidth > strokeCalls[1].lineWidth);
  assert.equal(harness.metrics.at(-1).details.dashStyle, "dashed");
});

test("river core alpha increases from low and mid zoom while retaining configured opacity", () => {
  const alphaAtZoom = (zoom) => {
    const harness = createOwner({ features: [createFeature("River", 4)] });
    harness.owner.drawRiversLayer(zoom);
    return harness.context.calls.find((call) => call.type === "stroke" && call.strokeStyle === "#336699").alpha;
  };

  const low = alphaAtZoom(1);
  const mid = alphaAtZoom(1.5);
  const detail = alphaAtZoom(5);

  assert.ok(low < mid);
  assert.ok(mid < detail);
  assert.equal(low, 0.8 * 0.78);
  assert.equal(mid, 0.8 * 0.9);
  assert.equal(detail, 0.8 * 1);
});

test("river layer owner records deferred metrics without drawing", () => {
  const harness = createOwner({ features: [createFeature("River", 4)] });

  harness.owner.recordDeferredRiversLayerMetric({ interactive: true, reason: "staged-apply" });

  assert.equal(harness.context.calls.length, 0);
  assert.equal(harness.metrics.at(-1).name, "drawRiversLayer");
  assert.equal(harness.metrics.at(-1).durationMs, 0);
  assert.deepEqual(harness.metrics.at(-1).details, {
    featureCount: 1,
    interactive: true,
    reason: "staged-apply",
    skipped: true,
  });
});

test("river layer owner suppresses base rivers for HGO vector scenes", () => {
  const harness = createOwner({
    features: [createFeature("River", 1)],
    hgoVectorScene: true,
  });

  harness.owner.drawRiversLayer(1);

  assert.equal(harness.context.calls.length, 0);
  assert.equal(harness.pathCalls.length, 0);
  assert.equal(harness.metrics.at(-1).name, "drawRiversLayer");
  assert.deepEqual(harness.metrics.at(-1).details, {
    featureCount: 1,
    interactive: false,
    reason: "hgo-vector-scene",
    skipped: true,
  });
});

test("river layer owner applies interactive alpha caps", () => {
  const normal = createOwner({ features: [createFeature("River", 4)] });
  const interactive = createOwner({ features: [createFeature("River", 4)] });

  normal.owner.drawRiversLayer(1, { interactive: false });
  interactive.owner.drawRiversLayer(1, { interactive: true });

  const normalStrokes = normal.context.calls.filter((call) => call.type === "stroke");
  const interactiveStrokes = interactive.context.calls.filter((call) => call.type === "stroke");
  assert.equal(normalStrokes.length, 2);
  assert.equal(interactiveStrokes.length, 2);
  assert.ok(interactiveStrokes[0].alpha < normalStrokes[0].alpha);
  assert.ok(interactiveStrokes[1].alpha < normalStrokes[1].alpha);
});

function installPath2D(t) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "Path2D");
  class TestPath2D { features = []; }
  Object.defineProperty(globalThis, "Path2D", { configurable: true, value: TestPath2D });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, "Path2D", previous);
    else delete globalThis.Path2D;
  });
}

function createSwitchablePath(context, { throws = false, ignoresSetter = false } = {}) {
  let target = context;
  const calls = [];
  const path = (feature) => {
    calls.push({ feature, target });
    if (throws) throw new Error("projection failed");
    target.features?.push(feature);
  };
  path.context = function(next) {
    if (!arguments.length) return target;
    if (!ignoresSetter) target = next;
    return path;
  };
  return { path, calls };
}

test("river geometry is projected once per outlined feature with outline-before-core order", (t) => {
  installPath2D(t);
  const context = createCanvasContext();
  const a = createFeature("River", 2);
  const b = createFeature("River", 3);
  const canal = createFeature("Canal", 3);
  const projection = createSwitchablePath(context);
  const harness = createOwner({ context, features: [a, b, canal], pathCanvas: projection.path });
  harness.owner.drawRiversLayer(5);
  const strokes = context.calls.filter((call) => call.type === "stroke");
  assert.deepEqual(projection.calls.map((call) => call.feature), [a, b, canal]);
  assert.deepEqual(strokes.map((call) => call.strokeStyle), ["#ddeeff", "#ddeeff", "#336699", "#336699", "#336699"]);
  assert.equal(strokes[0].path, strokes[2].path);
  assert.equal(strokes[1].path, strokes[3].path);
  assert.deepEqual(strokes[0].path.features, [a]);
  assert.deepEqual(strokes[1].path.features, [b]);
  assert.equal(strokes[4].path, undefined);
  assert.equal(projection.path.context(), context);
  harness.owner.drawRiversLayer(5);
  const laterStrokes = context.calls.filter((call) => call.type === "stroke").slice(5);
  assert.notEqual(laterStrokes[0].path, strokes[0].path);
  assert.equal(projection.calls.length, 6);
});

test("river geometry restores shared d3 and canvas contexts after projection failure", (t) => {
  installPath2D(t);
  const context = createCanvasContext();
  const projection = createSwitchablePath(context, { throws: true });
  const harness = createOwner({ context, features: [createFeature("River", 2)], pathCanvas: projection.path });
  assert.throws(() => harness.owner.drawRiversLayer(1), /projection failed/);
  assert.equal(projection.path.context(), context);
  assert.equal(context.calls.at(-1).type, "restore");
  assert.equal(harness.metrics.length, 0);
});

test("river geometry keeps legacy drawing when d3 context cannot be switched", (t) => {
  installPath2D(t);
  const context = createCanvasContext();
  const projection = createSwitchablePath(context, { ignoresSetter: true });
  const harness = createOwner({ context, features: [createFeature("River", 2)], pathCanvas: projection.path });
  harness.owner.drawRiversLayer(1);
  assert.equal(projection.calls.length, 2);
  assert.ok(projection.calls.every((call) => call.target === context));
  assert.ok(context.calls.filter((call) => call.type === "stroke").every((call) => !call.path));
});

test("river geometry fallback without context API preserves widths alpha and dash", (t) => {
  installPath2D(t);
  const fallback = createOwner({ features: [createFeature("River", 2)] });
  const context = createCanvasContext();
  const projection = createSwitchablePath(context);
  const reused = createOwner({ context, features: [createFeature("River", 2)], pathCanvas: projection.path });
  fallback.owner.drawRiversLayer(1.5, { interactive: true });
  reused.owner.drawRiversLayer(1.5, { interactive: true });
  const styles = (harness) => harness.context.calls.filter((call) => call.type === "stroke").map(({ path, ...style }) => style);
  assert.deepEqual(styles(reused), styles(fallback));
  assert.equal(fallback.pathCalls.length, 2);
  assert.equal(projection.calls.length, 1);
  assert.deepEqual(reused.metrics, fallback.metrics);
});
