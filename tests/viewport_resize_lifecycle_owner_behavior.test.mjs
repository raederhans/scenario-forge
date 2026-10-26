import assert from "node:assert/strict";
import test from "node:test";

import { createViewportResizeLifecycleOwner } from "../js/core/renderer/viewport_resize_lifecycle_owner.js";
import { createViewportReadModelOwner } from "../js/core/renderer/viewport_read_model_owner.js";

function createHarness({
  mapContainer = { clientWidth: 800, clientHeight: 600 },
  includeResizeObserver = true,
  canvasSizeResults = [true],
  canvasSizeStateUpdates = [],
  hasLandFeatures = true,
} = {}) {
  const modelState = {
    width: 800,
    height: 600,
    activeScenarioId: "demo-scenario",
  };
  const calls = {
    order: [],
    setCanvasSize: [],
    fitProjection: [],
    resetZoomToFit: [],
    enforceZoomConstraints: 0,
    markAllOverlaysDirty: 0,
    render: 0,
    setRenderPhaseInteracting: 0,
    scheduleRenderPhaseIdle: 0,
    buildSpatialIndex: 0,
    setHitCanvasDirty: 0,
    scheduleHitCanvasBuildIfNeeded: [],
    metrics: [],
    clearedTimers: [],
    canceledDeferred: [],
  };
  const rafCallbacks = [];
  const canceledFrames = [];
  const timers = [];
  const resizeObservers = [];
  const mediaQueries = [];
  const visualViewportListeners = [];
  let nextFrameId = 1;
  let nextTimerId = 1;
  let nextDeferredId = 1;
  let canvasSizeCallIndex = 0;

  const fakeGlobal = {
    devicePixelRatio: 1,
    requestAnimationFrame(callback) {
      const id = `raf-${nextFrameId}`;
      nextFrameId += 1;
      rafCallbacks.push({ id, callback, canceled: false });
      return id;
    },
    cancelAnimationFrame(id) {
      canceledFrames.push(id);
      const entry = rafCallbacks.find((candidate) => candidate.id === id);
      if (entry) entry.canceled = true;
    },
    setTimeout(callback, delay) {
      const id = `timer-${nextTimerId}`;
      nextTimerId += 1;
      timers.push({ id, callback, delay, cleared: false });
      return id;
    },
    clearTimeout(id) {
      calls.clearedTimers.push(id);
      const entry = timers.find((candidate) => candidate.id === id);
      if (entry) entry.cleared = true;
    },
    matchMedia(query) {
      const mediaQuery = {
        query,
        listeners: [],
        removed: [],
        addEventListener(type, handler) {
          this.listeners.push({ type, handler });
        },
        removeEventListener(type, handler) {
          this.removed.push({ type, handler });
          this.listeners = this.listeners.filter((entry) => entry.handler !== handler);
        },
        addListener(handler) {
          this.listeners.push({ type: "legacy", handler });
        },
        removeListener(handler) {
          this.removed.push({ type: "legacy", handler });
          this.listeners = this.listeners.filter((entry) => entry.handler !== handler);
        },
      };
      mediaQueries.push(mediaQuery);
      return mediaQuery;
    },
    visualViewport: {
      addEventListener(type, handler, options) {
        visualViewportListeners.push({ type, handler, options, removed: false });
      },
      removeEventListener(type, handler) {
        const listener = visualViewportListeners.find((entry) => entry.type === type && entry.handler === handler);
        if (listener) listener.removed = true;
      },
    },
  };

  if (includeResizeObserver) {
    fakeGlobal.ResizeObserver = class FakeResizeObserver {
      constructor(callback) {
        this.callback = callback;
        this.observed = [];
        this.disconnected = false;
        resizeObservers.push(this);
      }

      observe(target) {
        this.observed.push(target);
      }

      disconnect() {
        this.disconnected = true;
      }
    };
  }

  const deferredWork = [];
  const owner = createViewportResizeLifecycleOwner({
    state: modelState,
    getters: {
      getMapContainer: () => mapContainer,
      getGlobal: () => fakeGlobal,
      getDevicePixelRatio: () => fakeGlobal.devicePixelRatio,
      hasLandFeatures: () => hasLandFeatures,
    },
    helpers: {
      nowMs: () => 1000,
      scheduleDeferredWork(callback, options) {
        const handle = { id: `deferred-${nextDeferredId}` };
        nextDeferredId += 1;
        deferredWork.push({ handle, callback, options, canceled: false });
        calls.order.push("scheduleDeferredWork");
        return handle;
      },
      cancelDeferredWork(handle) {
        calls.canceledDeferred.push(handle);
        const entry = deferredWork.find((candidate) => candidate.handle === handle);
        if (entry) entry.canceled = true;
      },
      recordRenderPerfMetric(name, durationMs, details) {
        calls.metrics.push({ name, durationMs, details });
        calls.order.push("recordRenderPerfMetric");
      },
    },
    effects: {
      setRenderPhaseInteracting() {
        calls.setRenderPhaseInteracting += 1;
        calls.order.push("setRenderPhaseInteracting");
      },
      scheduleRenderPhaseIdle() {
        calls.scheduleRenderPhaseIdle += 1;
        calls.order.push("scheduleRenderPhaseIdle");
      },
      setCanvasSize(options) {
        calls.setCanvasSize.push(options);
        calls.order.push("setCanvasSize");
        const callIndex = canvasSizeCallIndex;
        const stateUpdate = canvasSizeStateUpdates.length
          ? canvasSizeStateUpdates[Math.min(callIndex, canvasSizeStateUpdates.length - 1)]
          : null;
        if (typeof stateUpdate === "function") {
          Object.assign(modelState, stateUpdate(options, modelState) || {});
        } else if (stateUpdate && typeof stateUpdate === "object") {
          Object.assign(modelState, stateUpdate);
        }
        const result = canvasSizeResults[Math.min(callIndex, canvasSizeResults.length - 1)];
        canvasSizeCallIndex += 1;
        return result;
      },
      fitProjection(options) {
        calls.fitProjection.push(options);
        calls.order.push("fitProjection");
      },
      resetZoomToFit(options) {
        calls.resetZoomToFit.push(options);
        calls.order.push("resetZoomToFit");
      },
      enforceZoomConstraints() {
        calls.enforceZoomConstraints += 1;
        calls.order.push("enforceZoomConstraints");
      },
      markAllOverlaysDirty() {
        calls.markAllOverlaysDirty += 1;
        calls.order.push("markAllOverlaysDirty");
      },
      render() {
        calls.render += 1;
        calls.order.push("render");
      },
      buildSpatialIndex() {
        calls.buildSpatialIndex += 1;
        calls.order.push("buildSpatialIndex");
      },
      setHitCanvasDirty() {
        calls.setHitCanvasDirty += 1;
        calls.order.push("setHitCanvasDirty");
      },
      scheduleHitCanvasBuildIfNeeded(options) {
        calls.scheduleHitCanvasBuildIfNeeded.push(options);
        calls.order.push("scheduleHitCanvasBuildIfNeeded");
      },
    },
  });

  function flushRaf(index = 0) {
    const entry = rafCallbacks.filter((candidate) => !candidate.canceled)[index];
    assert.ok(entry, "expected a queued animation frame");
    entry.canceled = true;
    entry.callback();
  }

  function flushTimer(index = 0) {
    const entry = timers.filter((candidate) => !candidate.cleared)[index];
    assert.ok(entry, "expected a queued timer");
    entry.cleared = true;
    entry.callback();
  }

  function flushDeferred(index = 0) {
    const entry = deferredWork.filter((candidate) => !candidate.canceled)[index];
    assert.ok(entry, "expected a queued deferred callback");
    entry.canceled = true;
    entry.callback();
  }

  function emitResizeObserver(width, height) {
    assert.ok(resizeObservers[0], "expected a resize observer");
    resizeObservers[0].callback([{ contentRect: { width, height } }]);
  }

  return {
    calls,
    canceledFrames,
    deferredWork,
    emitResizeObserver,
    fakeGlobal,
    flushDeferred,
    flushRaf,
    flushTimer,
    mapContainer,
    mediaQueries,
    modelState,
    owner,
    rafCallbacks,
    resizeObservers,
    timers,
    visualViewportListeners,
  };
}

test("normalizes resize reasons and classifies interactive layout resize", () => {
  const { owner } = createHarness();

  assert.equal(owner.getResizeReason(" visual-viewport-resize "), "visual-viewport-resize");
  assert.equal(owner.getResizeReason("", "fallback"), "fallback");
  assert.equal(owner.isInteractiveLayoutResize("map-container-resize"), true);
  assert.equal(owner.isInteractiveLayoutResize("sidebar-layout-refresh"), true);
  assert.equal(owner.isInteractiveLayoutResize("visual-viewport-resize"), false);
  assert.equal(owner.shouldPreferFullResizeReason("browser-dpr-change", "visual-viewport-resize"), true);
});

test("requestMapContainerResizeSync preserves DPR frame timeout and full-resize coalescing behavior", () => {
  const dpr = createHarness();
  dpr.owner.requestMapContainerResizeSync("browser-dpr-change");
  assert.equal(dpr.rafCallbacks.length, 1);
  dpr.flushRaf();
  assert.deepEqual(dpr.calls.setCanvasSize, [{
    reason: "browser-dpr-change",
    forceDprInvalidation: true,
  }]);

  const container = createHarness();
  container.owner.requestMapContainerResizeSync("map-container-resize");
  container.owner.requestMapContainerResizeSync("map-container-resize");
  assert.equal(container.timers.length, 2);
  assert.deepEqual(container.calls.clearedTimers, ["timer-1"]);
  container.flushTimer();
  assert.equal(container.calls.setCanvasSize.at(-1).reason, "map-container-resize");

  const visual = createHarness();
  visual.owner.requestMapContainerResizeSync("visual-viewport-resize");
  assert.equal(visual.rafCallbacks.length, 1);
  visual.flushRaf();
  assert.equal(visual.calls.setCanvasSize.at(-1).reason, "visual-viewport-resize");

  const preferred = createHarness({
    canvasSizeResults: [true, false],
    canvasSizeStateUpdates: [{ width: 900, height: 650, dpr: 0.8 }],
  });
  preferred.owner.requestMapContainerResizeSync("browser-dpr-change");
  preferred.owner.requestMapContainerResizeSync("visual-viewport-resize");
  preferred.flushRaf();
  assert.deepEqual(preferred.calls.setCanvasSize, [{
    reason: "visual-viewport-resize",
    forceDprInvalidation: true,
  }]);
  assert.deepEqual(preferred.calls.fitProjection, [{ skipSpatialIndex: false }]);
  assert.deepEqual(preferred.calls.resetZoomToFit, [{
    centerContent: false,
    centerX: true,
    centerY: false,
  }]);
  assert.equal(preferred.calls.enforceZoomConstraints, 1);

  const dprAfterVisual = createHarness();
  dprAfterVisual.owner.requestMapContainerResizeSync("visual-viewport-resize");
  dprAfterVisual.owner.requestMapContainerResizeSync("browser-dpr-change");
  dprAfterVisual.flushRaf();
  assert.deepEqual(dprAfterVisual.calls.setCanvasSize, [{
    reason: "visual-viewport-resize",
    forceDprInvalidation: true,
  }]);
});

test("bindMapContainerResizeObserver observes changed dimensions and ignores empty or unchanged entries", () => {
  const missingContainer = createHarness({ mapContainer: null });
  missingContainer.owner.bindMapContainerResizeObserver();
  assert.equal(missingContainer.resizeObservers.length, 0);

  const missingObserver = createHarness({ includeResizeObserver: false });
  missingObserver.owner.bindMapContainerResizeObserver();
  assert.equal(missingObserver.resizeObservers.length, 0);

  const harness = createHarness();
  harness.owner.bindMapContainerResizeObserver();
  assert.equal(harness.resizeObservers.length, 1);
  assert.deepEqual(harness.resizeObservers[0].observed, [harness.mapContainer]);

  harness.emitResizeObserver(0, 600);
  harness.emitResizeObserver(800, 600);
  assert.equal(harness.timers.length, 0);

  harness.emitResizeObserver(900, 600);
  assert.equal(harness.timers.length, 1);
  harness.flushTimer();
  assert.equal(harness.calls.setCanvasSize.at(-1).reason, "map-container-resize");
});

test("browser DPR observer attaches rebinding change handler and unbind removes it", () => {
  const harness = createHarness();

  assert.equal(harness.owner.getDevicePixelRatioMediaQuery(), "(resolution: 1dppx)");
  Object.assign(harness.fakeGlobal, { devicePixelRatio: 0.8 });
  assert.equal(harness.owner.getDevicePixelRatioMediaQuery(), "(resolution: 0.8dppx)");
  Object.assign(harness.fakeGlobal, { devicePixelRatio: 1 });
  harness.owner.bindBrowserPixelRatioObserver();
  assert.equal(harness.mediaQueries[0].query, "(resolution: 1dppx)");
  assert.equal(harness.mediaQueries[0].listeners.length, 1);

  Object.assign(harness.fakeGlobal, { devicePixelRatio: 2 });
  harness.mediaQueries[0].listeners[0].handler();
  assert.equal(harness.mediaQueries[0].removed.length, 1);
  assert.equal(harness.mediaQueries[1].query, "(resolution: 2dppx)");
  assert.equal(harness.rafCallbacks.length, 1);
  harness.flushRaf();
  assert.equal(harness.calls.setCanvasSize.at(-1).forceDprInvalidation, true);

  harness.owner.unbindBrowserPixelRatioObserver();
  assert.equal(harness.mediaQueries[1].removed.length, 1);
});

test("visual viewport resize observer attaches passive listener and schedules frame resize", () => {
  const harness = createHarness();

  harness.owner.bindVisualViewportResizeObserver();
  assert.equal(harness.visualViewportListeners.length, 1);
  assert.equal(harness.visualViewportListeners[0].type, "resize");
  assert.deepEqual(harness.visualViewportListeners[0].options, { passive: true });

  harness.visualViewportListeners[0].handler();
  assert.equal(harness.rafCallbacks.length, 1);
  harness.flushRaf();
  assert.equal(harness.calls.setCanvasSize.at(-1).reason, "visual-viewport-resize");
});

test("handleBrowserPixelRatioRefresh renders only after dpr invalidation changes canvas size", () => {
  const unchanged = createHarness({ canvasSizeResults: [false] });
  unchanged.owner.handleBrowserPixelRatioRefresh();
  assert.deepEqual(unchanged.calls.setCanvasSize, [{
    reason: "browser-dpr-change",
    forceDprInvalidation: true,
  }]);
  assert.equal(unchanged.calls.markAllOverlaysDirty, 0);
  assert.equal(unchanged.calls.render, 0);

  const changed = createHarness({ canvasSizeResults: [true] });
  changed.owner.handleBrowserPixelRatioRefresh();
  assert.deepEqual(changed.calls.fitProjection, []);
  assert.equal(changed.calls.markAllOverlaysDirty, 1);
  assert.equal(changed.calls.render, 1);
});

test("interactive layout resize sets phase centers content and defers spatial refresh", () => {
  const harness = createHarness({ canvasSizeResults: [true] });

  harness.owner.handleResize("sidebar-layout-refresh");

  assert.equal(harness.calls.setRenderPhaseInteracting, 1);
  assert.deepEqual(harness.calls.fitProjection, [{ skipSpatialIndex: true }]);
  assert.deepEqual(harness.calls.resetZoomToFit, [{
    centerContent: true,
    centerX: true,
    centerY: false,
  }]);
  assert.equal(harness.calls.enforceZoomConstraints, 0);
  assert.equal(harness.calls.markAllOverlaysDirty, 1);
  assert.equal(harness.calls.render, 1);
  assert.equal(harness.deferredWork.at(-1).options.timeout, 360);
  assert.equal(harness.calls.scheduleRenderPhaseIdle, 1);
  assert.deepEqual(harness.calls.order, [
    "setRenderPhaseInteracting",
    "setCanvasSize",
    "fitProjection",
    "resetZoomToFit",
    "markAllOverlaysDirty",
    "render",
    "scheduleDeferredWork",
    "scheduleRenderPhaseIdle",
  ]);
});

test("phone container resize centers projected content using the new 375px viewport", () => {
  const state = { width: 1440, height: 900 };
  const container = { clientWidth: 375, clientHeight: 716 };
  const fittedBounds = { minX: 16, maxX: 351, minY: 180, maxY: 500 };
  let fittedViewport;
  let transform;
  const readModel = createViewportReadModelOwner({
    getters: { getViewportDimensions: () => state },
    capabilities: {
      getProjectedRenderableContentBoundsSnapshots: () => [fittedBounds],
      createZoomTransform: (value) => value,
    },
  });
  const owner = createViewportResizeLifecycleOwner({
    state,
    getters: { getMapContainer: () => container },
    effects: {
      setCanvasSize() {
        state.width = container.clientWidth;
        state.height = container.clientHeight;
        return true;
      },
      fitProjection() {
        fittedViewport = { width: state.width, height: state.height };
      },
      resetZoomToFit({ centerContent, centerX, centerY }) {
        assert.equal(centerContent, true);
        transform = readModel.getCenteredFitZoomTransform({ centerX, centerY });
      },
      enforceZoomConstraints() {
        assert.fail("container refit must preserve its centered translation");
      },
    },
  });

  owner.handleResize("map-container-resize");

  assert.deepEqual(fittedViewport, { width: 375, height: 716 });
  assert.equal((fittedBounds.minX + fittedBounds.maxX) / 2 + transform.x, 187.5);
  assert.equal(transform.y, 0);
});

test("standard resize enforces zoom constraints after reset", () => {
  const harness = createHarness({ canvasSizeResults: [true] });

  harness.owner.handleResize("resize");

  assert.deepEqual(harness.calls.fitProjection, [{ skipSpatialIndex: false }]);
  assert.deepEqual(harness.calls.resetZoomToFit, [{
    centerContent: false,
    centerX: true,
    centerY: false,
  }]);
  assert.equal(harness.calls.enforceZoomConstraints, 1);
  assert.equal(harness.calls.render, 1);
  assert.equal(harness.calls.scheduleRenderPhaseIdle, 0);
});

test("unchanged interactive layout resize only schedules idle phase", () => {
  const harness = createHarness({ canvasSizeResults: [false] });

  harness.owner.handleResize("map-container-resize");

  assert.equal(harness.calls.setRenderPhaseInteracting, 1);
  assert.equal(harness.calls.scheduleRenderPhaseIdle, 1);
  assert.deepEqual(harness.calls.fitProjection, []);
  assert.equal(harness.calls.render, 0);
  assert.equal(harness.deferredWork.length, 0);
});

test("scheduleResizeSpatialRefresh replaces previous deferred work and rebuilds hit canvas", () => {
  const harness = createHarness();

  const first = harness.owner.scheduleResizeSpatialRefresh("map-container-resize");
  const second = harness.owner.scheduleResizeSpatialRefresh("sidebar-layout-refresh");
  assert.equal(harness.calls.canceledDeferred.at(-1), first);
  assert.notEqual(first, second);

  harness.flushDeferred();
  assert.equal(harness.calls.buildSpatialIndex, 1);
  assert.equal(harness.calls.setHitCanvasDirty, 1);
  assert.deepEqual(harness.calls.scheduleHitCanvasBuildIfNeeded, [{
    reason: "resize-spatial-refresh",
  }]);
  assert.equal(harness.calls.metrics[0].name, "resizeSpatialRefresh");
  assert.equal(harness.calls.metrics[0].details.reason, "sidebar-layout-refresh");
});

test("scheduleResizeSpatialRefresh noops after delay when land features are absent", () => {
  const harness = createHarness({ hasLandFeatures: false });

  harness.owner.scheduleResizeSpatialRefresh("map-container-resize");
  harness.flushDeferred();

  assert.equal(harness.calls.buildSpatialIndex, 0);
  assert.equal(harness.calls.setHitCanvasDirty, 0);
  assert.deepEqual(harness.calls.metrics, []);
});

test("dispose clears resize observers scheduled work and zoom listeners", () => {
  const harness = createHarness();

  harness.owner.bindMapContainerResizeObserver();
  harness.owner.bindBrowserZoomObservers();
  harness.owner.requestMapContainerResizeSync("browser-dpr-change");
  harness.owner.requestMapContainerResizeSync("map-container-resize");
  const deferredHandle = harness.owner.scheduleResizeSpatialRefresh("map-container-resize");

  harness.owner.dispose();

  assert.equal(harness.resizeObservers[0].disconnected, true);
  assert.deepEqual(harness.canceledFrames, ["raf-1"]);
  assert.deepEqual(harness.calls.clearedTimers, ["timer-1"]);
  assert.equal(harness.calls.canceledDeferred.at(-1), deferredHandle);
  assert.equal(harness.mediaQueries[0].removed.length, 1);
  assert.equal(harness.visualViewportListeners[0].removed, true);
  assert.equal(harness.rafCallbacks[0].canceled, true);
  assert.equal(harness.timers[0].cleared, true);
  assert.equal(harness.deferredWork[0].canceled, true);
});

test("factory freezes its exact public API", () => {
  const { owner } = createHarness();

  assert.equal(Object.isFrozen(owner), true);
});
