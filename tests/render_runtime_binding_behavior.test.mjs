import assert from "node:assert/strict";
import test from "node:test";

import {
  createStartupRenderRuntimeBinding,
} from "../js/bootstrap/render_runtime_binding.js";

function createHarness(overrides = {}) {
  const calls = {
    createDispatcher: 0,
    schedule: 0,
    flush: 0,
    render: 0,
    markBoundaryFlushed: 0,
    bindBoundary: [],
    flushBoundary: [],
    registerHook: [],
    initToast: 0,
    setBootPreviewVisible: [],
    initPresetState: 0,
    ensureDetailTopology: [],
  };
  let renderCallback = null;
  const targetState = {};
  const globalScope = {};
  const renderDispatcher = {
    schedule() {
      calls.schedule += 1;
      return "scheduled";
    },
    flush() {
      calls.flush += 1;
      return renderCallback();
    },
  };
  const options = {
    targetState,
    globalScope,
    setBootPreviewVisible(value) {
      calls.setBootPreviewVisible.push(value);
    },
    ensureDetailTopologyReady(options = {}) {
      calls.ensureDetailTopology.push(options);
      return "detail-ready";
    },
    renderFn() {
      calls.render += 1;
      return "rendered";
    },
    createDispatcher(callback) {
      calls.createDispatcher += 1;
      renderCallback = callback;
      return renderDispatcher;
    },
    bindBoundary(boundary) {
      calls.bindBoundary.push(boundary);
    },
    flushBoundary(reason) {
      calls.flushBoundary.push(reason);
      return true;
    },
    markBoundaryFlushed() {
      calls.markBoundaryFlushed += 1;
    },
    registerHook(state, hookName, callback) {
      calls.registerHook.push({ state, hookName, callback });
    },
    initToastFn() {
      calls.initToast += 1;
    },
    showToastFn() {
      return "toast";
    },
    initPresetStateFn() {
      calls.initPresetState += 1;
    },
    flushReason: "ui-shell-render-now",
    ...overrides,
  };

  return {
    calls,
    globalScope,
    options,
    renderDispatcher,
    targetState,
  };
}

test("createStartupRenderRuntimeBinding returns the render runtime handles", () => {
  const harness = createHarness();
  const binding = createStartupRenderRuntimeBinding(harness.options);

  assert.equal(harness.calls.createDispatcher, 1);
  assert.equal(binding.renderDispatcher, harness.renderDispatcher);
  assert.equal(typeof binding.renderApp, "function");
  assert.equal(typeof binding.flushRenderNow, "function");
});

test("render dispatcher flush renders and marks the boundary in finally", () => {
  const harness = createHarness();
  const binding = createStartupRenderRuntimeBinding(harness.options);

  binding.renderDispatcher.flush();

  assert.equal(harness.calls.render, 1);
  assert.equal(harness.calls.markBoundaryFlushed, 1);
});

test("render errors still mark the boundary and propagate", () => {
  const failure = new Error("render failed");
  const harness = createHarness({
    renderFn() {
      harness.calls.render += 1;
      throw failure;
    },
  });
  const binding = createStartupRenderRuntimeBinding(harness.options);

  assert.throws(() => binding.renderDispatcher.flush(), /render failed/);
  assert.equal(harness.calls.render, 1);
  assert.equal(harness.calls.markBoundaryFlushed, 1);
});

test("renderApp is published globally and schedules the dispatcher", () => {
  const harness = createHarness();
  const binding = createStartupRenderRuntimeBinding(harness.options);

  assert.equal(harness.globalScope.renderApp, binding.renderApp);
  binding.renderApp();
  harness.globalScope.renderApp();

  assert.equal(harness.calls.schedule, 2);
});

test("renderNow is published globally and flushes with the configured reason", () => {
  const harness = createHarness({ flushReason: "custom-render-now" });
  const binding = createStartupRenderRuntimeBinding(harness.options);

  assert.equal(harness.globalScope.renderNow, binding.flushRenderNow);
  assert.equal(binding.flushRenderNow(), true);
  assert.equal(harness.globalScope.renderNow(), true);

  assert.deepEqual(harness.calls.flushBoundary, [
    "custom-render-now",
    "custom-render-now",
  ]);
});

test("bindBoundary receives schedule, flush, and detail topology functions", () => {
  const harness = createHarness();
  createStartupRenderRuntimeBinding(harness.options);
  const boundary = harness.calls.bindBoundary[0];

  assert.equal(typeof boundary.scheduleRender, "function");
  assert.equal(typeof boundary.flushRender, "function");
  assert.equal(typeof boundary.ensureDetailTopology, "function");

  boundary.scheduleRender();
  boundary.flushRender();
  const detailResult = boundary.ensureDetailTopology({ reason: "test-detail" });

  assert.equal(detailResult, "detail-ready");
  assert.equal(harness.calls.schedule, 1);
  assert.equal(harness.calls.flush, 1);
  assert.deepEqual(harness.calls.ensureDetailTopology, [
    {
      renderDispatcher: harness.renderDispatcher,
      reason: "test-detail",
    },
  ]);
});

test("runtime hooks register renderNowFn, ensureDetailTopologyFn, showToastFn, and showAppDialogFn", () => {
  const harness = createHarness();
  const binding = createStartupRenderRuntimeBinding(harness.options);

  assert.deepEqual(
    harness.calls.registerHook.map(({ state, hookName, callback }) => ({
      sameState: state === harness.targetState,
      hookName,
      callback,
    })),
    [
      {
        sameState: true,
        hookName: "renderNowFn",
        callback: binding.flushRenderNow,
      },
      {
        sameState: true,
        hookName: "ensureDetailTopologyFn",
        callback: harness.calls.registerHook[1].callback,
      },
      {
        sameState: true,
        hookName: "showToastFn",
        callback: harness.options.showToastFn,
      },
      {
        sameState: true,
        hookName: "showAppDialogFn",
        callback: harness.calls.registerHook[3].callback,
      },
    ],
  );

  assert.equal(
    harness.calls.registerHook[1].callback({ source: "runtime-hook" }),
    "detail-ready",
  );
  assert.deepEqual(harness.calls.ensureDetailTopology, [
    {
      renderDispatcher: harness.renderDispatcher,
      source: "runtime-hook",
    },
  ]);
});

test("toast, boot preview, and preset initialization run once", () => {
  const harness = createHarness();
  createStartupRenderRuntimeBinding(harness.options);

  assert.equal(harness.calls.initToast, 1);
  assert.deepEqual(harness.calls.setBootPreviewVisible, [false]);
  assert.equal(harness.calls.initPresetState, 1);
});

test("empty flushReason falls back to legacy-render-now", () => {
  const harness = createHarness({ flushReason: "   " });
  const binding = createStartupRenderRuntimeBinding(harness.options);

  binding.flushRenderNow();

  assert.deepEqual(harness.calls.flushBoundary, ["legacy-render-now"]);
});

test("required injection points fail fast", () => {
  const harness = createHarness();

  assert.throws(
    () => createStartupRenderRuntimeBinding({
      ...harness.options,
      targetState: null,
    }),
    /targetState/,
  );
  assert.throws(
    () => createStartupRenderRuntimeBinding({
      ...harness.options,
      setBootPreviewVisible: null,
    }),
    /setBootPreviewVisible/,
  );
  assert.throws(
    () => createStartupRenderRuntimeBinding({
      ...harness.options,
      ensureDetailTopologyReady: null,
    }),
    /ensureDetailTopologyReady/,
  );
  assert.throws(
    () => createStartupRenderRuntimeBinding({
      ...harness.options,
      createDispatcher: null,
    }),
    /createDispatcher/,
  );
});
