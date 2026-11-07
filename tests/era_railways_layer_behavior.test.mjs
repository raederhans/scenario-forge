import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeScenarioOptionalLayerKey,
  getScenarioOptionalLayerConfig,
  createScenarioOptionalLayerRuntime,
} from "../js/core/scenario/optional_layer_runtime.js";
import { createTransportOverviewRenderOwner } from "../js/core/renderer/transport_overview_render_owner.js";
import { bindRenderBoundary } from "../js/core/render_boundary.js";

const railway = (level) => ({
  type: "Feature", properties: { kind: "railway", ...(level === undefined ? {} : { level }) },
  geometry: { type: "LineString", coordinates: [[0, 0], [1, 1]] },
});
const node = { type: "Feature", properties: { kind: "supply_node" }, geometry: { type: "Point", coordinates: [3, 4] } };
const collection = (features) => ({ type: "FeatureCollection", features });

test("era railways aliases and optional layer contract", () => {
  for (const key of ["era_railways", "era-railways", "erarailways"]) {
    assert.equal(normalizeScenarioOptionalLayerKey(key), "erarailways");
  }
  assert.deepEqual(getScenarioOptionalLayerConfig("erarailways"), {
    bundleField: "eraRailwaysPayload", stateField: "scenarioEraRailwaysData",
    urlField: "era_railways_url", objectName: "", visibilityField: "showEraRailways",
    revisionField: "scenarioEraRailwaysRevision", loadPolicy: "background",
  });
});

function renderHarness(overrides = {}) {
  const strokes = [], squares = [], metrics = [];
  let path = [];
  const context = {
    save() {}, restore() {}, setLineDash() {}, beginPath() { path = []; },
    stroke() { strokes.push({ width: this.lineWidth, color: this.strokeStyle, alpha: this.globalAlpha, features: [...path] }); },
    fillRect(...args) { squares.push({ args, color: this.fillStyle }); },
    strokeRect(...args) { squares.push({ args, color: this.strokeStyle, width: this.lineWidth }); },
  };
  const state = { showTransport: true, showEraRailways: true, showRail: false,
    scenarioEraRailwaysData: collection([railway(3), railway(1), railway(5), railway(), railway(2), railway(4), node]), ...overrides };
  const owner = createTransportOverviewRenderOwner({ state, helpers: {
    getContext: () => context, getPathCanvas: () => (feature) => path.push(feature),
    getProjection: () => (coordinates) => coordinates,
    clamp: (value, min, max) => Math.min(max, Math.max(min, value)), nowMs: () => 0,
    getFeatureCollectionFeatureCount: (data) => data?.features?.length || 0,
    collectContextMetric: (name, duration, details) => metrics.push({ name, ...details }),
  } });
  return { owner, state, strokes, squares, metrics };
}

test("era railways draw level batches with screen widths and halos while modern rail is hidden", () => {
  const { owner, strokes, squares, metrics } = renderHarness();
  owner.drawRailwaysLayer(2);
  assert.equal(strokes.length, 10);
  const scale = Math.sqrt(2) / 1.4;
  [0.7, 1, 1.35, 1.75, 2.2].forEach((width, index) => {
    const [halo, main] = strokes.slice(index * 2, index * 2 + 2);
    assert.equal(main.width, width * scale / 2);
    assert.equal(halo.width, (width * scale + 1.2) / 2);
    assert.equal(main.color, "#3d342c");
    assert.equal(main.alpha, 0.85);
    assert.equal(halo.color, "#ffffff");
    assert.equal(halo.alpha, 0.45);
    assert.equal(main.features.length, index === 0 ? 2 : 1);
    assert.deepEqual(main.features, halo.features);
  });
  assert.equal(squares.length, 0);
  assert.equal(metrics[0].visibleFeatureCount, 6);
});

test("era railways skip hidden, empty and interactive passes", () => {
  for (const overrides of [{ showTransport: false }, { showEraRailways: false },
    { scenarioEraRailwaysData: null }, { scenarioEraRailwaysData: collection([]) }]) {
    const h = renderHarness(overrides);
    h.owner.drawRailwaysLayer(3);
    assert.equal(h.strokes.length, 0);
    assert.equal(h.squares.length, 0);
    assert.equal(h.metrics[0].skipped, true);
  }
  const h = renderHarness();
  h.owner.drawRailwaysLayer(3, { interactive: true });
  assert.equal(h.strokes.length, 0);
  assert.equal(h.squares.length, 0);
  assert.equal(h.metrics[0].reason, "interactive-pass");
});

test("supply nodes begin at scale 2.2 and remain four screen pixels wide", () => {
  for (const k of [2.19, 2.2, 4]) {
    const h = renderHarness({ scenarioEraRailwaysData: collection([node]) });
    h.owner.drawRailwaysLayer(k);
    assert.equal(h.squares.length, k < 2.2 ? 0 : 2);
    if (k >= 2.2) {
      assert.deepEqual(h.squares[0].args, [3 - 2 / k, 4 - 2 / k, 4 / k, 4 / k]);
      assert.equal(h.squares[0].color, "#3d342c");
      assert.equal(h.squares[1].width, 0.8 / k);
    }
  }
});

function loadingHarness(loader) {
  const bundle = { manifest: { era_railways_url: "era.geojson" } };
  const state = { activeScenarioId: "test", scenarioBundleCacheById: { test: bundle },
    showEraRailways: true, showWaterRegions: false, showScenarioSpecialRegions: false,
    showScenarioAtlantropa: false, showSpecialZones: false, showScenarioReliefOverlays: false,
    showCityPoints: false, showStrategicResourceMarkers: false };
  const phases = [];
  const runtime = createScenarioOptionalLayerRuntime(state, {
    getScenarioBundleId: () => "test", scenarioBundleUsesChunkedLayer: () => false,
    scheduleScenarioChunkRefresh() {}, recordOptionalLayerVisibilitySnapshot() {},
    shouldContinueScenarioApplyContext: (context, phase) => { phases.push(phase); return state.activeScenarioId === context.scenarioId; },
    loadScenarioOptionalLayerPayloadById: loader,
  });
  return { state, bundle, runtime, phases };
}

test("background loading resolves before payload and redraws after completion", async (t) => {
  let resolve;
  const pending = new Promise((done) => { resolve = done; });
  const calls = [], renders = [];
  const h = loadingHarness((id, key) => { calls.push([id, key]); return pending; });
  bindRenderBoundary({ flushRender: (event) => renders.push(event.reason) });
  t.after(() => bindRenderBoundary({}));
  assert.deepEqual(await h.runtime.ensureActiveScenarioOptionalLayersForVisibility(), []);
  assert.deepEqual(calls, [["test", "erarailways"]]);
  assert.deepEqual(renders, []);
  resolve(collection([]));
  await pending;
  assert.deepEqual(renders, ["scenario-optional-layer-background:erarailways"]);
  assert.ok(h.phases.includes("optional-layer-background-load"));
});

test("background completion ignores stale scenarios and replaced bundles", async (t) => {
  const renders = [];
  bindRenderBoundary({ flushRender: (event) => renders.push(event.reason) });
  t.after(() => bindRenderBoundary({}));
  for (const change of [(h) => { h.state.activeScenarioId = "other"; },
    (h) => { h.state.scenarioBundleCacheById.test = {}; }]) {
    let resolve;
    const pending = new Promise((done) => { resolve = done; });
    const h = loadingHarness(() => pending);
    await h.runtime.ensureActiveScenarioOptionalLayersForVisibility();
    change(h);
    resolve(null);
    await pending;
  }
  assert.deepEqual(renders, []);
});

test("background failure is handled and missing manifest does not request era data", async (t) => {
  const warn = t.mock.method(console, "warn", () => {});
  const h = loadingHarness(async () => { throw new Error("offline"); });
  assert.deepEqual(await h.runtime.ensureActiveScenarioOptionalLayersForVisibility(), []);
  await Promise.resolve();
  assert.equal(warn.mock.callCount(), 1);
  delete h.bundle.manifest.era_railways_url;
  assert.deepEqual(await h.runtime.ensureActiveScenarioOptionalLayersForVisibility(), []);
  assert.equal(await h.runtime.ensureActiveScenarioOptionalLayerLoaded("erarailways"), null);
  assert.equal(warn.mock.callCount(), 1);
});

test("era railways invalidate transport pass and visible frame signatures", async () => {
  const { createRenderPassSignaturePolicy } = await import("../js/core/renderer/render_pass_signature_policy.js");
  const { createVisibleFrameIdentityPolicy } = await import("../js/core/renderer/visible_frame_identity_policy.js");
  const state = { showTransport: true, showEraRailways: true,
    scenarioEraRailwaysData: collection([]), styleConfig: {} };
  const pass = createRenderPassSignaturePolicy(state, {
    getTransformSignature: () => "transform", shouldEnableContextBaseTransformReuse: () => false,
    stableJson: JSON.stringify,
  });
  const frame = createVisibleFrameIdentityPolicy(state, {});
  const read = () => [pass.getRenderPassSignature("contextMarkers"), frame.getVisibleContextFlagSignature()];
  const initial = read();
  state.showEraRailways = false;
  read().forEach((signature, index) => assert.notEqual(signature, initial[index]));
  state.showEraRailways = true;
  assert.deepEqual(read(), initial);
  state.scenarioEraRailwaysData = collection([]);
  read().forEach((signature, index) => assert.notEqual(signature, initial[index]));
  const loaded = read();
  state.scenarioEraRailwaysData = null;
  read().forEach((signature, index) => assert.notEqual(signature, loaded[index]));
});

test("blocking layers still wait and only their payloads are returned", async () => {
  let resolveBlocking, resolveBackground;
  const blocking = new Promise((resolve) => { resolveBlocking = resolve; });
  const background = new Promise((resolve) => { resolveBackground = resolve; });
  const h = loadingHarness((_id, key) => key === "relief" ? blocking : background);
  h.state.showScenarioReliefOverlays = true;
  let settled = false;
  const result = h.runtime.ensureActiveScenarioOptionalLayersForVisibility({ renderNow: false })
    .then((payloads) => { settled = true; return payloads; });
  await Promise.resolve();
  assert.equal(settled, false);
  const payload = collection([railway(1)]);
  resolveBlocking(payload);
  assert.deepEqual(await result, [payload]);
  resolveBackground(null);
  await background;
});
