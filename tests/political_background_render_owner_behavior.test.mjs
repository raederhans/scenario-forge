import assert from "node:assert/strict";
import test from "node:test";

import { createPoliticalBackgroundRenderOwner } from "../js/core/renderer/political_background_render_owner.js";

class FakePath2D {
  constructor() {
    this.paths = [];
  }

  addPath(path) {
    this.paths.push(path);
  }
}

function createFixture({ progressiveLimit = 2400 } = {}) {
  const calls = [];
  const pending = [];
  const cancelled = [];
  const metrics = [];
  let maskResult = null;
  const pathCache = new Map();
  let preparedPathIdentity = null;
  const renderCache = { dirty: {}, reasons: {} };
  const state = {
    activeScenarioId: "scenario-a",
    landData: { features: [] },
    landDataFull: null,
    sovereigntyRevision: 1,
    scenarioShellOverlayRevision: 2,
    colorRevision: 3,
    colors: {},
    zoomTransform: { k: 1, x: 0, y: 0 },
    sceneGeneration: 10,
    scenarioDataGeneration: 20,
    renderPhase: "idle",
    deferExactAfterSettle: false,
    spatialItems: [],
    topology: null,
    topologyPrimary: null,
    oceanData: null,
    oceanMaskMode: "topology_ocean",
    intensityFields: { channels: { oceanDepth: { enabled: false } } },
    dpr: 1,
  };
  const context = {
    canvas: { width: 800, height: 400 },
    beginPath: () => calls.push("beginPath"),
    fill: (path) => calls.push(path ? "fill:path" : "fill"),
    save: () => calls.push("save"),
    restore: () => calls.push("restore"),
    setTransform: () => calls.push("setTransform"),
    drawImage: () => calls.push("drawImage"),
    set fillStyle(value) { calls.push(`fillStyle:${value}`); },
    set globalCompositeOperation(value) { calls.push(`blend:${value}`); },
    set globalAlpha(value) { calls.push(`alpha:${value}`); },
  };
  const surface = {
    getContext: () => context,
    getPathCanvas: () => (feature) => calls.push(`path:${feature?.properties?.id || feature?.type || "feature"}`),
    getProjection: () => (point) => point,
  };
  const helpers = {
    getAtlantropaSeaPoliticalFillColor: () => "#004466",
    getFeatureId: (feature) => String(feature?.properties?.id || ""),
    getSafeCanvasColor: (value, fallback) => value || fallback,
    isAtlantropaSeaFeature: () => false,
    getResolvedFeatureColor: () => "#778899",
    getDisplayOwnerCode: (feature) => feature?.properties?.owner || "AA",
    getFeatureCountryCodeNormalized: (feature) => feature?.properties?.country || "AA",
    isWorldBounds: () => false,
    getPoliticalPathCacheHandle: (transform, { resetIfMismatch }) => {
      calls.push("path:prepare");
      assert.equal(resetIfMismatch, true);
      const identity = `${transform.k}:${transform.x}:${transform.y}:${state.scenarioDataGeneration}`;
      if (preparedPathIdentity !== null && preparedPathIdentity !== identity) {
        pathCache.clear();
        calls.push("path:reset");
      }
      preparedPathIdentity = identity;
      return { valid: true, map: pathCache };
    },
    getPoliticalFeaturePathEntry: (feature, { featureId, allowBuild, countBuild }) => {
      calls.push(`lookup:${featureId}`);
      assert.equal(allowBuild, true);
      assert.equal(countBuild, true);
      if (!pathCache.has(featureId)) {
        pathCache.set(featureId, { path: { featureId } });
        calls.push(`build:${featureId}`);
      }
      return pathCache.get(featureId);
    },
    getTransformSignature: (transform) => `transform:${transform.k}:${transform.x}:${transform.y}`,
    getPoliticalPathCacheSignature: (transform) => `path:${transform.k}:${transform.x}:${transform.y}`,
    getVisibleFrameIdentity: () => ({
      scenarioId: state.activeScenarioId,
      sceneGeneration: state.sceneGeneration,
      scenarioDataGeneration: state.scenarioDataGeneration,
    }),
    nowMs: (() => { let now = 0; return () => ++now; })(),
    getRenderPassCacheState: () => renderCache,
    isInteractionRecoverySettled: () => true,
    isExactAfterSettleControllerActive: () => false,
    cloneZoomTransform: (transform) => ({ ...transform }),
    getLogicalCanvasDimensions: () => [800, 400],
    isAntarcticSectorFeature: () => false,
    isBaseGeographyScenarioFeature: () => false,
    shouldExcludePoliticalVisualFeature: () => false,
    shouldSkipFeature: () => false,
    getProjectedFeatureBounds: () => ({ minX: 0, minY: 0, maxX: 1, maxY: 1 }),
    collectVisibleLandSpatialItems: () => [],
    screenRectToProjectedRect: (rect) => rect,
    collectLandSpatialItemsForProjectedRects: () => ({ items: [], overflow: false }),
    projectedBoundsIntersectScreenRects: () => true,
    getPoliticalRecoveryQuality: () => "progressive",
    hasPendingPoliticalColorEdit: () => false,
    getAdmin0BackgroundFillColor: (code) => `color:${code}`,
    normalizeIntensityFieldsState: (value) => ({ ...value, normalized: true }),
    getRenderPassLayout: () => ({ pixelWidth: 800, pixelHeight: 400, dpr: 1 }),
    getProjectionRenderSignature: () => "projection-a",
    getOceanBaseFillColor: () => "#001122",
  };
  const effects = {
    recordRenderPerfMetric: (name, _duration, detail) => {
      calls.push(`metric:${name}`);
      metrics.push({ name, ...detail });
    },
    cancelDeferredWork: (handle) => { cancelled.push(handle); calls.push("cancel"); },
    scheduleDeferredWork: (callback) => {
      const handle = { callback };
      pending.push(handle);
      calls.push("schedule");
      return handle;
    },
    invalidateRenderPasses: (...args) => calls.push(`invalidate:${args.join(":")}`),
    recordProgressivePoliticalFullCacheReadyDiagnostics: () => calls.push("diagnostics"),
    requestRendererRender: (_reason, options) => {
      calls.push("repaint");
      assert.equal(typeof options.fallback, "function");
      options.fallback();
      return true;
    },
    renderFallback: () => calls.push("fallback"),
    commitIntensityFieldsState: (value) => { state.intensityFields = value; calls.push("commit:intensity"); },
    getIntensityFieldMaskOwner: () => ({ getMaskCanvas: () => maskResult }),
    applyOceanClipMask: () => calls.push("ocean:clip"),
    drawOceanStyle: () => calls.push("ocean:style"),
    warn: (message) => calls.push(`warn:${message}`),
  };
  const owner = createPoliticalBackgroundRenderOwner({
    surface,
    getters: { getRuntimeState: () => state, getDebugMode: () => "PROD" },
    helpers,
    effects,
    platform: {
      d3: {
        zoomIdentity: { k: 1, x: 0, y: 0 },
        geoArea: () => Math.PI * 3,
        geoBounds: () => [[0, 0], [1, 1]],
      },
      topojson: { merge: (_topology, geometries) => ({ type: "MultiPolygon", geometries }) },
      Path2D: FakePath2D,
    },
    constants: {
      landFillColor: "#d8d2c4",
      renderPhaseIdle: "idle",
      politicalRecoveryQualityProgressive: "progressive",
      progressiveBackgroundExactEntryLimit: progressiveLimit,
      oceanMaskModeTopology: "topology_ocean",
      oceanDepthMaskGrayMap: { min: 28, neutral: 128, max: 232 },
    },
  });
  return {
    owner, state, calls, pending, cancelled, pathCache, renderCache, context, metrics,
    setMaskResult: (value) => { maskResult = value; },
  };
}

function feature(id, owner = "AA") {
  return { type: "Feature", properties: { id, owner, country: owner }, geometry: { type: "Polygon" } };
}

test("background pass preserves sphere, ocean data, style, and delegated intensity write order", () => {
  const fixture = createFixture();
  fixture.state.oceanData = feature("ocean");
  fixture.owner.drawBackgroundPass();
  assert.deepEqual(fixture.calls.slice(0, 9), [
    "fillStyle:#001122", "beginPath", "path:Sphere", "fill",
    "fillStyle:#001122", "beginPath", "path:ocean", "fill", "ocean:style",
  ]);
  assert.deepEqual(fixture.calls.slice(9), ["commit:intensity"]);
  assert.equal(fixture.state.intensityFields.normalized, true);
});

test("full-pass cache replays only for current transform and color identity", () => {
  const fixture = createFixture();
  const entries = [{ feature: feature("a"), id: "a" }];
  fixture.state.landData = { features: [entries[0].feature] };
  const first = fixture.owner.drawPoliticalBackgroundFillsForEntries(entries, {
    useFullPassCache: true,
    returnSummary: true,
  });
  const second = fixture.owner.drawPoliticalBackgroundFillsForEntries(entries, {
    useFullPassCache: true,
    returnSummary: true,
  });
  assert.equal(first.cacheHit, false);
  assert.equal(second.cacheHit, true);
  assert.equal(fixture.calls.filter((entry) => entry === "build:a").length, 1);

  fixture.state.colors.a = "#ff0000";
  fixture.state.colorRevision += 1;
  const recolored = fixture.owner.drawPoliticalBackgroundFillsForEntries(entries, {
    useFullPassCache: true,
    returnSummary: true,
  });
  assert.equal(recolored.cacheHit, false);

  fixture.state.zoomTransform = { k: 2, x: 0, y: 0 };
  const transformed = fixture.owner.drawPoliticalBackgroundFillsForEntries(entries, {
    transform: fixture.state.zoomTransform,
    useFullPassCache: true,
    returnSummary: true,
  });
  assert.equal(transformed.cacheHit, false);
});

test("recolor regroups warm paths with one cache preparation and no feature lookup", () => {
  const fixture = createFixture();
  const entries = ["a", "b"].map((id) => ({ feature: feature(id), id }));
  fixture.state.landData = { features: entries.map((entry) => entry.feature) };
  const draw = () => fixture.owner.drawPoliticalBackgroundFillsForEntries(entries, {
    useFullPassCache: true, returnSummary: true,
  });
  assert.equal(draw().builtPathCount, 2);
  fixture.calls.length = 0;
  fixture.state.colors.a = "#ff0000";
  const summary = draw();
  assert.equal(summary.cacheHit, false);
  assert.equal(summary.reusedPathCount, 2);
  assert.equal(summary.builtPathCount, 0);
  assert.equal(summary.pathlessEntryCount, 0);
  assert.equal(summary.groupCount, 2);
  assert.equal(fixture.calls.filter((call) => call === "path:prepare").length, 1);
  assert.equal(fixture.calls.some((call) => /^(lookup|build):/.test(call)), false);
});

test("changed transform or geometry generation still prepares and rebuilds stale paths", () => {
  for (const change of [
    (fixture) => { fixture.state.zoomTransform = { k: 2, x: 0, y: 0 }; },
    (fixture, entries) => {
      entries[0].feature = feature("a");
      fixture.state.landData = { features: [entries[0].feature] };
      fixture.state.scenarioDataGeneration += 1;
    },
  ]) {
    const fixture = createFixture();
    const entries = [{ feature: feature("a"), id: "a" }];
    fixture.state.landData = { features: [entries[0].feature] };
    const draw = () => fixture.owner.drawPoliticalBackgroundFillsForEntries(entries, {
      useFullPassCache: true, returnSummary: true,
    });
    draw();
    const oldPath = fixture.pathCache.get("a").path;
    change(fixture, entries);
    const summary = draw();
    assert.equal(summary.cacheHit, false);
    assert.equal(summary.reusedPathCount, 0);
    assert.equal(summary.builtPathCount, 1);
    assert.equal(fixture.calls.filter((call) => call === "path:reset").length, 1);
    assert.notEqual(fixture.pathCache.get("a").path, oldPath);
  }
});

test("deferred slices prepare once each and reuse warm paths without feature lookup", () => {
  const fixture = createFixture({ progressiveLimit: 1 });
  fixture.state.landData = { features: [feature("a"), feature("b"), feature("c")] };
  for (const item of fixture.state.landData.features) {
    const featureId = item.properties.id;
    fixture.pathCache.set(featureId, { path: { featureId } });
  }
  const visibleItems = fixture.state.landData.features.map((item, drawOrder) => ({
    id: item.properties.id, feature: item, drawOrder, minX: 0, minY: 0, maxX: 1, maxY: 1,
  }));
  fixture.owner.drawPoliticalBackgroundFills({ visibleItems, returnSummary: true });
  fixture.calls.length = 0;
  fixture.pending.shift().callback({ timeRemaining: () => 0 });
  assert.equal(fixture.calls.filter((call) => call === "path:prepare").length, 1);
  assert.equal(fixture.calls.some((call) => /^(lookup|build):/.test(call)), false);
  assert.equal(fixture.pending.length, 1);
  fixture.calls.length = 0;
  fixture.pending.shift().callback();
  // One preparation for the second slice, one for the completed full-pass grouping.
  assert.equal(fixture.calls.filter((call) => call === "path:prepare").length, 2);
  assert.equal(fixture.calls.some((call) => /^(lookup|build):/.test(call)), false);
  const slices = fixture.metrics.filter((metric) => metric.name === "scenarioPoliticalBackgroundDeferredFullCacheSlice");
  assert.deepEqual(slices.map(({ processedCount, reusedPathCount, builtPathCount, pathlessEntryCount }) =>
    [processedCount, reusedPathCount, builtPathCount, pathlessEntryCount]), [[1, 1, 0, 0], [2, 2, 0, 0]]);
  assert.equal(fixture.calls.filter((call) => call === "repaint").length, 1);
});

test("progressive Admin0 underlay schedules one current deferred completion", () => {
  const fixture = createFixture({ progressiveLimit: 1 });
  fixture.state.landData = { features: [feature("a"), feature("b")] };
  fixture.state.topology = {
    objects: { political: { geometries: [{ properties: { cntr_code: "AA" } }] } },
  };
  const visibleItems = fixture.state.landData.features.map((item, drawOrder) => ({
    id: item.properties.id, feature: item, drawOrder, minX: 0, minY: 0, maxX: 1, maxY: 1,
  }));
  const summary = fixture.owner.drawPoliticalBackgroundFills({
    visibleItems,
    returnSummary: true,
  });
  assert.equal(summary.progressive, true);
  assert.equal(summary.coarseUnderlay, "admin0");
  assert.equal(summary.deferredFullCacheScheduled, true);
  assert.equal(fixture.pending.length, 1);

  fixture.pending.shift().callback();
  assert.equal(
    fixture.calls.filter((entry) => entry.startsWith("invalidate:")).length,
    1,
    fixture.calls.join(","),
  );
  assert.equal(fixture.calls.filter((entry) => entry === "diagnostics").length, 1);
  assert.equal(fixture.calls.filter((entry) => entry === "repaint").length, 1);
  assert.equal(fixture.calls.filter((entry) => entry === "fallback").length, 1);
  const slice = fixture.metrics.find((metric) => metric.name === "scenarioPoliticalBackgroundDeferredFullCacheSlice");
  assert.equal(slice.builtPathCount, 2);
  assert.equal(slice.reusedPathCount, 0);
  assert.equal(slice.pathlessEntryCount, 0);
});

test("stale deferred work cancels without invalidation, diagnostics, or repaint", () => {
  const fixture = createFixture({ progressiveLimit: 1 });
  fixture.state.landData = { features: [feature("a"), feature("b")] };
  const visibleItems = fixture.state.landData.features.map((item, drawOrder) => ({
    id: item.properties.id, feature: item, drawOrder, minX: 0, minY: 0, maxX: 1, maxY: 1,
  }));
  fixture.owner.drawPoliticalBackgroundFills({ visibleItems, returnSummary: true });
  const scheduled = fixture.pending.shift();
  fixture.state.sceneGeneration += 1;
  scheduled.callback();
  assert.equal(fixture.cancelled.length, 0);
  assert.equal(fixture.calls.filter((entry) => entry.startsWith("invalidate:")).length, 0);
  assert.equal(fixture.calls.filter((entry) => entry === "diagnostics").length, 0);
  assert.equal(fixture.calls.filter((entry) => entry === "repaint").length, 0);
  assert.equal(fixture.calls.filter((entry) => entry === "metric:scenarioPoliticalBackgroundDeferredFullCacheCancel").length, 1);
});

test("deferred scene, data, scenario, and transform fences suppress completion effects", () => {
  const mutations = [
    (state) => { state.sceneGeneration += 1; },
    (state) => { state.scenarioDataGeneration += 1; },
    (state) => { state.activeScenarioId = "scenario-b"; },
    (state) => { state.zoomTransform = { k: 2, x: 0, y: 0 }; },
  ];
  for (const mutate of mutations) {
    const fixture = createFixture({ progressiveLimit: 1 });
    fixture.state.landData = { features: [feature("a"), feature("b")] };
    const visibleItems = fixture.state.landData.features.map((item, drawOrder) => ({
      id: item.properties.id, feature: item, drawOrder, minX: 0, minY: 0, maxX: 1, maxY: 1,
    }));
    fixture.owner.drawPoliticalBackgroundFills({ visibleItems, returnSummary: true });
    const scheduled = fixture.pending.shift();
    mutate(fixture.state);
    scheduled.callback();
    assert.equal(fixture.calls.some((entry) => entry.startsWith("invalidate:")), false);
    assert.equal(fixture.calls.includes("diagnostics"), false);
    assert.equal(fixture.calls.includes("repaint"), false);
  }
});

test("land source replacement invalidates cached entry identity", () => {
  const fixture = createFixture();
  fixture.state.landData = { features: [feature("source-a")] };
  fixture.owner.drawPoliticalBackgroundFills();
  assert.equal(fixture.calls.includes("path:source-a"), true);
  fixture.state.landData = { features: [feature("source-b")] };
  fixture.owner.drawPoliticalBackgroundFills();
  assert.equal(fixture.calls.includes("path:source-b"), true);
});

test("ocean depth mask restores canvas state when drawing throws", () => {
  const fixture = createFixture();
  fixture.state.intensityFields.channels.oceanDepth.enabled = true;
  fixture.setMaskResult({ canvas: {}, cacheHit: false });
  fixture.context.drawImage = () => {
    fixture.calls.push("drawImage:throw");
    throw new Error("draw failed");
  };
  assert.throws(() => fixture.owner.drawBackgroundPass(), /draw failed/);
  assert.equal(fixture.calls.at(-1), "restore");
});

test("suspicious merge diagnostics use the injected warning port once", () => {
  const fixture = createFixture();
  assert.equal(fixture.owner.shouldFallbackScenarioPoliticalBackgroundMergeShape({}, {
    displayCode: "AA",
    fillColor: "#112233",
    groupSize: 2,
  }), true);
  fixture.owner.shouldFallbackScenarioPoliticalBackgroundMergeShape({}, {
    displayCode: "AA",
    fillColor: "#112233",
    groupSize: 2,
  });
  assert.equal(fixture.calls.filter((entry) => entry.startsWith("warn:")).length, 1);
});
