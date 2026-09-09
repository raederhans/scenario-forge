import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createPoliticalPartialRepaintOwner } from "../js/core/renderer/political_partial_repaint_owner.js";
import { isPoliticalFeaturePathEntryCurrent } from "../js/core/renderer/political_path_cache_owner.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function createHarness(overrides = {}) {
  const events = [];
  const transform = { x: 0, y: 0, k: 1 };
  const feature = { id: "land-1", geometry: { type: "Polygon", coordinates: [] } };
  const cache = {
    partialPoliticalDirtyIds: new Set(["land-1"]),
    canvases: {},
    signatures: { political: "static" },
    dirty: { political: true },
    reasons: { political: "refresh-colors" },
  };
  let activeContext = null;
  const context = {
    canvas: { width: 100, height: 100 },
    save: () => events.push("context:save"),
    restore: () => events.push("context:restore"),
    setTransform: (...args) => events.push(["setTransform", ...args]),
    beginPath: () => events.push("beginPath"),
    rect: (...args) => events.push(["rect", ...args]),
    clip: () => events.push("clip"),
    clearRect: (...args) => events.push(["clearRect", ...args]),
    translate: (...args) => events.push(["translate", ...args]),
    scale: (...args) => events.push(["scale", ...args]),
    fill: (value) => events.push(["fill", value]),
    stroke: (value) => events.push(["stroke", value]),
    drawImage: (...args) => events.push(["drawImage", ...args]),
  };
  activeContext = context;
  cache.canvases.political = { width: 100, height: 100, getContext: () => context };
  const state = {
    width: 100,
    height: 100,
    dpr: 1,
    renderPhase: "idle",
    deferExactAfterSettle: false,
    activeScenarioId: "scenario-a",
    colors: { "land-1": "#123456" },
    landData: { features: [feature] },
    landIndex: new Map([["land-1", feature]]),
    runtimeChunkLoadState: { selectionVersion: 9 },
  };
  const workerMetrics = {
    enabled: true,
    bitmapEnabled: true,
    protocolVersion: 4,
    acceptedCount: 1,
  };
  const path = { kind: "path" };
  const helpers = {
    nowMs: (() => { let value = 10; return () => value++; })(),
    getFeatureId: (candidate) => candidate?.id || "",
    isAtlantropaSeaFeature: () => false,
    getAtlantropaSeaPoliticalFillColor: () => "#001122",
    getAtlantropaSeaPoliticalStrokeColor: () => "#112233",
    getSafeCanvasColor: (value, fallback) => value || fallback,
    getResolvedFeatureColor: () => "#654321",
    hashToColor: () => "#abcdef",
    buildWorkerPixelRingsForGeometry: () => [[[1, 2], [3, 4], [1, 2]]],
    orderPoliticalShellUnderlayFirst: (items) => [...items],
    shouldExcludePoliticalVisualFeature: () => false,
    shouldSkipFeature: () => false,
    pathBoundsInScreen: () => true,
    getPoliticalFeaturePathEntry: (candidate) => ({ path, geometryRef: candidate.geometry }),
    isPoliticalFeaturePathEntryCurrent,
    rectsIntersect: (a, b) => !(a.maxX < b.minX || a.maxY < b.minY || a.minX > b.maxX || a.minY > b.maxY),
    screenRectToProjectedRect: (rect) => ({ ...rect }),
    collectLandSpatialItemsForProjectedRects: () => ({
      overflow: false,
      items: [{ id: "land-1", feature, drawOrder: 0 }],
    }),
    getFeatureScreenBounds: () => ({ minX: 5, minY: 5, maxX: 15, maxY: 15, x: 5, y: 5, width: 10, height: 10 }),
    getRenderPassLayout: () => ({ pixelWidth: 100, pixelHeight: 100, paddedWidth: 100, paddedHeight: 100, offsetX: 0, offsetY: 0 }),
    getPassReferenceTransform: () => transform,
    areZoomTransformsEquivalent: (left, right) => left === right,
    hasPassFullReferenceTransform: () => true,
    getPassFullReferenceTransform: () => transform,
    getPoliticalPassFineBaselineMismatch: () => "",
    getCachedPoliticalPassStaticSignature: () => "static",
    getPoliticalPathCacheHandle: () => ({ valid: true, map: new Map([["land-1", { path, geometryRef: feature.geometry }]]) }),
    getVisibleFrameIdentity: () => ({
      sceneGeneration: 2,
      scenarioDataGeneration: 3,
      scenarioId: "scenario-a",
      selectionVersion: 9,
      topologyRevision: 4,
      colorRevision: 5,
      transformBucket: "bucket-a",
      dpr: 1,
    }),
    createPoliticalRasterWorkerIdentity: (value) => ({ protocolVersion: 4, ...value }),
    getLogicalCanvasDimensions: () => [100, 80],
    getRenderPassSignature: () => "pass-signature",
    getPoliticalPassViewportOverscanPx: () => 12,
    collectVisibleLandSpatialItemsWithStats: () => ({ items: [{ id: "land-1", feature, drawOrder: 0 }], stats: { candidateCount: 1 } }),
    cloneZoomTransform: (value) => ({ ...value }),
    getTransformBucketSignature: () => "bucket-a",
    getIslandNeighborGraph: () => null,
    ensurePoliticalRasterWorkerMetrics: () => workerMetrics,
    ...overrides.helpers,
  };
  const effects = {
    incrementPerfCounter: (...args) => events.push(["counter", ...args]),
    recordRenderPerfMetric: (...args) => events.push(["metric", ...args]),
    drawPoliticalBackgroundFillsForEntries: (entries) => {
      events.push(["background", entries.map((entry) => entry.id)]);
      return 1;
    },
    withRenderTarget: (target, callback) => {
      const previous = activeContext;
      activeContext = target;
      try { return callback(); } finally { activeContext = previous; }
    },
    clearPendingPoliticalColorEdit: (payload) => events.push(["clear-pending", payload]),
    setPassReferenceTransform: (...args) => events.push(["set-reference", ...args]),
    recordPassTiming: (...args) => events.push(["timing", ...args]),
    commitPoliticalPassDiagnostics: (payload) => events.push(["diagnostics", payload]),
    requestPoliticalRasterWorkerPass: (payload) => events.push(["request-worker", payload]),
    onAcceptedBitmapResult: () => events.push("accepted-bitmap-effect"),
    ...overrides.effects,
  };
  const owner = createPoliticalPartialRepaintOwner({
    surface: {
      getContext: () => activeContext,
      getProjection: () => (point) => point,
      getPathCanvas: () => Object.assign(() => events.push("path"), { bounds: () => [[0, 0], [1, 1]] }),
    },
    getters: {
      getRuntimeState: () => state,
      getDebugMode: () => overrides.debugMode || "PROD",
      getDefaultTransform: () => transform,
      getRenderPassCacheState: () => cache,
    },
    helpers,
    effects,
    constants: {
      renderPhaseIdle: "idle",
      landFillColor: "#d8d1bd",
      partialFeatureThreshold: 48,
      partialCandidateThreshold: 160,
      partialViewportCoverageMax: 0.18,
      partialSyncBuildCandidateMax: 96,
      partialSyncBuildMissMax: 96,
      partialPaddingPx: 4,
    },
  });
  return { owner, state, cache, context, events, feature, transform, path, workerMetrics };
}

test("fine loop validates once per draw and rejects same-ID different geometry without cache writes", () => {
  const cachedPath = { cached: true };
  const pathMap = new Map();
  let valid = true;
  const transforms = [];
  const h = createHarness({ helpers: {
    getPoliticalPathCacheHandle: (transform, options) => {
      transforms.push(transform);
      assert.equal(options.resetIfMismatch, false);
      return { valid, map: pathMap };
    },
    getPoliticalFeaturePathEntry: () => { throw new Error("unexpected per-feature validation"); },
  } });
  pathMap.set("land-1", { path: cachedPath, geometryRef: h.feature.geometry });
  const identity = { transform: h.transform, canvasWidth: 100, canvasHeight: 100 };
  const viewport = { visibleItems: Array.from({ length: 100 }, (_, drawOrder) => ({ feature: h.feature, drawOrder })) };
  assert.equal(h.owner.drawPoliticalFineFeatureLoop({ k: 1, identity, viewport }).renderedCount, 100);
  assert.equal(transforms.length, 1);
  assert.equal(h.events.filter(event => Array.isArray(event) && event[0] === "fill" && event[1] === cachedPath).length, 100);
  const originalGeometry = h.feature.geometry;
  h.feature.geometry = { type: "Polygon", coordinates: [] };
  h.events.length = 0;
  const nextTransform = { x: 10, y: 0, k: 2 };
  h.owner.drawPoliticalFineFeatureLoop({ k: 2, identity: { ...identity, transform: nextTransform }, viewport });
  assert.equal(transforms.length, 2);
  assert.equal(transforms[1], nextTransform);
  assert.equal(h.events.filter(event => event === "path").length, 100);
  assert.equal(h.events.filter(event => Array.isArray(event) && event[0] === "fill" && event[1] === undefined).length, 100);
  assert.equal(h.events.filter(event => Array.isArray(event) && event[0] === "stroke" && event[1] === undefined).length, 100);
  assert.equal(pathMap.size, 1);
  assert.equal(pathMap.get("land-1").path, cachedPath);
  h.state.landData.features = [{ ...h.feature, geometry: originalGeometry }];
  h.events.length = 0;
  h.owner.drawPoliticalFineFeatureLoop({ k: 1, identity, viewport: { visibleItems: null } });
  assert.equal(transforms.length, 3);
  assert.ok(h.events.some(event => Array.isArray(event) && event[0] === "fill" && event[1] === cachedPath));
});

test("unavailable cache uses direct canvas fill and stroke", () => {
  const h = createHarness({ helpers: {
    getPoliticalPathCacheHandle: () => ({ valid: false, map: new Map() }),
  } });
  h.owner.drawPoliticalFineFeatureLoop({
    k: 1,
    identity: { transform: h.transform, canvasWidth: 100, canvasHeight: 100 },
    viewport: { visibleItems: [{ feature: h.feature, drawOrder: 0 }] },
  });
  assert.equal(h.events.filter(event => event === "path").length, 1);
  assert.ok(h.events.some(event => Array.isArray(event) && event[0] === "fill" && event[1] === undefined));
  assert.ok(h.events.some(event => Array.isArray(event) && event[0] === "stroke" && event[1] === undefined));
});

test("factory validates ports and freezes the exact owner API", () => {
  assert.throws(() => createPoliticalPartialRepaintOwner(), /surface must expose/);
  const { owner } = createHarness();
  assert.equal(Object.isFrozen(owner), true);
  assert.deepEqual(Object.keys(owner), [
    "buildPoliticalRasterWorkerPacket",
    "drawPoliticalFeature",
    "drawPoliticalFineFeatureLoop",
    "drawPoliticalWorkerBitmapResult",
    "publishPoliticalPassDiagnostics",
    "recordPoliticalRasterWorkerSnapshot",
    "requestPoliticalPassWorker",
    "resolvePoliticalPassIdentity",
    "resolvePoliticalPassViewport",
    "tryPartialPoliticalPassRepaint",
  ]);
});

test("identity, viewport, and packet preserve the complete worker envelope and opaque visible items", () => {
  const { owner, feature } = createHarness();
  const identity = owner.resolvePoliticalPassIdentity(2);
  assert.deepEqual(identity.workerIdentity, {
    protocolVersion: 4,
    sceneGeneration: 2,
    scenarioDataGeneration: 3,
    scenarioId: "scenario-a",
    selectionVersion: 9,
    topologyRevision: 4,
    colorRevision: 5,
    transformBucket: "bucket-a",
    dpr: 1,
    viewport: { x: 0, y: 0, width: 100, height: 80, left: 0, top: 0, right: 100, bottom: 80 },
    passSignature: "pass-signature",
  });
  const viewport = owner.resolvePoliticalPassViewport(identity);
  assert.equal(viewport.visibleItems[0].feature, feature);
  const packetState = owner.buildPoliticalRasterWorkerPacket({
    visibleItems: viewport.visibleItems,
    transform: identity.transform,
    canvasWidth: identity.canvasWidth,
    canvasHeight: identity.canvasHeight,
  });
  assert.equal(packetState.reason, "ok");
  assert.deepEqual(packetState.packet.entries.map(({ id, fillColor, strokeColor, strokeWidthPx }) => (
    { id, fillColor, strokeColor, strokeWidthPx }
  )), [{ id: "land-1", fillColor: "#123456", strokeColor: "#123456", strokeWidthPx: 0.75 }]);
  assert.deepEqual(packetState.packet.entries[0].rings, [[[1, 2], [3, 4], [1, 2]]]);
});

test("worker request preserves packet metadata and delegates accepted bitmap scheduling to the root effect", () => {
  let request = null;
  const { owner, events } = createHarness({
    effects: { requestPoliticalRasterWorkerPass: (payload) => { request = payload; } },
  });
  const identity = owner.resolvePoliticalPassIdentity(2);
  const packetState = { packet: { canvasPxWidth: 100, canvasPxHeight: 80, entries: [{ id: "land-1" }] }, packetBuildMs: 7, reason: "ok" };
  owner.requestPoliticalPassWorker({ identity, packetState });
  assert.equal(request.identity, identity.workerIdentity);
  assert.equal(request.rasterPacket, packetState.packet);
  assert.deepEqual(request.renderHint, {
    pass: "political",
    surface: "main",
    canvasPxWidth: 100,
    canvasPxHeight: 80,
    packetFeatureCount: 1,
    packetReason: "ok",
  });
  assert.deepEqual(events, []);
  request.onAcceptedBitmapResult({ reason: "bitmap" });
  assert.deepEqual(events, ["accepted-bitmap-effect"]);
});

test("bitmap commit requires a bitmap, draws once, clears pending, and closes ownership", () => {
  const { owner, events } = createHarness();
  assert.equal(owner.drawPoliticalWorkerBitmapResult({ reason: "metadata-only" }, {}), false);
  const bitmap = { close: () => events.push("bitmap:close") };
  assert.equal(owner.drawPoliticalWorkerBitmapResult({
    bitmap,
    renderedFeatureCount: 1,
    packetFeatureCount: 1,
    canvasPxWidth: 100,
    canvasPxHeight: 80,
  }, { scenarioId: "scenario-a" }), true);
  assert.equal(events.filter((entry) => Array.isArray(entry) && entry[0] === "drawImage").length, 1);
  assert.equal(events.filter((entry) => Array.isArray(entry) && entry[0] === "clear-pending").length, 1);
  assert.equal(events.at(-1), "bitmap:close");
});

test("partial fallback preserves dirty state and pending effects", () => {
  const { owner, cache, events, transform } = createHarness();
  cache.reasons.political = "viewport-change";
  assert.equal(owner.tryPartialPoliticalPassRepaint(transform, "next", {}), false);
  assert.equal(cache.dirty.political, true);
  assert.deepEqual([...cache.partialPoliticalDirtyIds], ["land-1"]);
  assert.equal(events.some((entry) => Array.isArray(entry) && entry[0] === "clear-pending"), false);
  const metric = events.find((entry) => Array.isArray(entry) && entry[0] === "metric" && entry[1] === "politicalPartialRepaint");
  assert.equal(metric[3].fallbackReason, "non-color-invalidation");
});

test("partial success redraws background before fine feature and commits cache once", () => {
  const { owner, cache, events, transform } = createHarness();
  assert.equal(owner.tryPartialPoliticalPassRepaint(transform, "next", {}), true);
  assert.equal(cache.signatures.political, "next");
  assert.equal(cache.dirty.political, false);
  assert.equal(cache.partialPoliticalDirtyIds.size, 0);
  assert.equal(cache.reasons.political, "partial-repaint");
  const backgroundIndex = events.findIndex((entry) => Array.isArray(entry) && entry[0] === "background");
  const fillIndex = events.findIndex((entry) => Array.isArray(entry) && entry[0] === "fill");
  const clearIndex = events.findIndex((entry) => Array.isArray(entry) && entry[0] === "clear-pending");
  assert.ok(backgroundIndex >= 0 && backgroundIndex < fillIndex && fillIndex < clearIndex);
  assert.equal(events.filter((entry) => Array.isArray(entry) && entry[0] === "set-reference").length, 1);
});

test("partial background and fine draw exceptions restore canvas and preserve fallback state", async (t) => {
  const cases = [
    {
      name: "background",
      create: () => createHarness({
        effects: {
          drawPoliticalBackgroundFillsForEntries: () => { throw new Error("background-failed"); },
        },
      }),
    },
    {
      name: "fine draw",
      create: () => {
        const harness = createHarness();
        harness.context.fill = () => { throw new Error("fine-draw-failed"); };
        return harness;
      },
    },
  ];
  for (const fixture of cases) {
    await t.test(fixture.name, () => {
      const { owner, cache, events, transform } = fixture.create();
      assert.equal(owner.tryPartialPoliticalPassRepaint(transform, "next", {}), false);
      assert.equal(events.filter((entry) => entry === "context:save").length, 1);
      assert.equal(events.filter((entry) => entry === "context:restore").length, 1);
      assert.equal(cache.signatures.political, "static");
      assert.equal(cache.dirty.political, true);
      assert.deepEqual([...cache.partialPoliticalDirtyIds], ["land-1"]);
      assert.equal(cache.reasons.political, "refresh-colors");
      assert.equal(events.some((entry) => Array.isArray(entry) && entry[0] === "clear-pending"), false);
      assert.equal(events.some((entry) => Array.isArray(entry) && entry[0] === "set-reference"), false);
      assert.equal(events.some((entry) => Array.isArray(entry) && entry[0] === "timing"), false);
      assert.equal(events.some((entry) => Array.isArray(entry)
        && entry[0] === "counter" && entry[1] === "politicalPartialRepaints"), false);
      const successMetrics = events.filter((entry) => Array.isArray(entry)
        && entry[0] === "metric" && entry[1] === "politicalPartialRepaint" && entry[3]?.applied === true);
      assert.equal(successMetrics.length, 0);
      const fallbackMetric = events.find((entry) => Array.isArray(entry)
        && entry[0] === "metric" && entry[1] === "politicalPartialRepaint" && entry[3]?.applied === false);
      assert.equal(fallbackMetric?.[3]?.fallbackReason, "partial-repaint-exception");
    });
  }
});

test("partial commit effect exceptions propagate after the recoverable fallback boundary", async (t) => {
  const cases = [
    ["clear pending", "clearPendingPoliticalColorEdit"],
    ["set reference", "setPassReferenceTransform"],
  ];
  for (const [name, effectName] of cases) {
    await t.test(name, () => {
      const commitError = new Error(`${name}-failed`);
      const harness = createHarness({
        effects: {
          [effectName]: () => { throw commitError; },
        },
      });
      assert.throws(
        () => harness.owner.tryPartialPoliticalPassRepaint(harness.transform, "next", {}),
        commitError,
      );
      const fallbackMetrics = harness.events.filter((entry) => Array.isArray(entry)
        && entry[0] === "metric" && entry[1] === "politicalPartialRepaint" && entry[3]?.applied === false);
      assert.equal(fallbackMetrics.length, 0);
    });
  }
});

test("partial noop commit effect exceptions propagate without fallback metrics", () => {
  const commitError = new Error("noop-set-reference-failed");
  const harness = createHarness({
    helpers: { shouldExcludePoliticalVisualFeature: () => true },
    effects: { setPassReferenceTransform: () => { throw commitError; } },
  });
  assert.throws(
    () => harness.owner.tryPartialPoliticalPassRepaint(harness.transform, "next", {}),
    commitError,
  );
  const fallbackMetrics = harness.events.filter((entry) => Array.isArray(entry)
    && entry[0] === "metric" && entry[1] === "politicalPartialRepaint" && entry[3]?.applied === false);
  assert.equal(fallbackMetrics.length, 0);
});

test("request and draw exceptions propagate through the owner boundary", () => {
  const requestError = new Error("request-failed");
  const requestHarness = createHarness({ effects: { requestPoliticalRasterWorkerPass: () => { throw requestError; } } });
  assert.throws(() => requestHarness.owner.requestPoliticalPassWorker({
    identity: requestHarness.owner.resolvePoliticalPassIdentity(1),
    packetState: { packet: null, packetBuildMs: 0, reason: "empty-packet" },
  }), requestError);

  const drawError = new Error("draw-failed");
  const drawHarness = createHarness();
  drawHarness.context.drawImage = () => { throw drawError; };
  assert.throws(() => drawHarness.owner.drawPoliticalWorkerBitmapResult({ bitmap: {} }, {}), drawError);
});

test("owner remains import-free and avoids DOM, globals, and worker singleton state", () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, "js/core/renderer/political_partial_repaint_owner.js"), "utf8");
  assert.doesNotMatch(source, /^import\s/m);
  for (const token of ["document.", "window.", "globalThis", "new Worker", "setTimeout(", "politicalRasterWorkerClient"]){
    assert.equal(source.includes(token), false, token);
  }
});
