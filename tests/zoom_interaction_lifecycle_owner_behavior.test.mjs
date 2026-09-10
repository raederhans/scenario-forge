import assert from "node:assert/strict";
import test from "node:test";

import { createZoomInteractionLifecycleOwner } from "../js/core/renderer/zoom_interaction_lifecycle_owner.js";

function createTransform(label, { x = 0, y = 0, k = 1 } = {}) {
  return { label, x, y, k };
}

function createFakeD3(calls, handlers) {
  const behavior = {
    filterFn: null,
    scaleExtent(value) {
      calls.scaleExtent.push(value);
      return behavior;
    },
    extent(value) {
      calls.extent.push(value);
      return behavior;
    },
    filter(fn) {
      behavior.filterFn = fn;
      calls.filter.push(fn);
      return behavior;
    },
    on(type, handler) {
      handlers[type] = handler;
      calls.zoomOn.push({ type, handler });
      return behavior;
    },
    transform() {},
    scaleBy() {},
    scaleTo() {},
    translateBy() {},
  };
  return {
    behavior,
    runtime: {
      zoomIdentity: createTransform("identity"),
      zoom() {
        calls.zoom += 1;
        return behavior;
      },
      select(node) {
        calls.select.push(node);
        const target = {
          call(method, ...args) {
            calls.targetCall.push({ method, args });
            return target;
          },
          on(type, value) {
            calls.targetOn.push({ type, value });
            return target;
          },
        };
        return target;
      },
    },
  };
}

function createHarness({
  includeD3 = true,
  includeInteractionRect = true,
  includeUpdateMap = true,
  runtimeOverrides = null,
  state: stateOverrides = {},
  updateMapHook = null,
} = {}) {
  const model = new Map(Object.entries({
    width: 800,
    height: 600,
    zoomTransform: createTransform("current", { x: 3, y: 4, k: 2 }),
    zoomGestureStartTransform: null,
    zoomGestureScaleDelta: 7,
    pendingExactPoliticalFastFrame: true,
    pendingZoomTransform: null,
    zoomRenderScheduled: false,
    zoomGestureEndedAt: 0,
    ...stateOverrides,
  }));
  const readState = (key) => model.get(key);
  const writeState = (key, value) => {
    model.set(key, value);
  };
  const handlers = {};
  const calls = {
    zoom: 0,
    scaleExtent: [],
    extent: [],
    filter: [],
    zoomOn: [],
    select: [],
    targetCall: [],
    targetOn: [],
    setZoomBehavior: [],
    order: [],
    phases: [],
    snapshots: [],
    hover: [],
    updateMap: [],
    chunkRefresh: [],
  };
  const { behavior, runtime } = createFakeD3(calls, handlers);
  const d3Runtime = runtimeOverrides ? { ...runtime, ...runtimeOverrides } : runtime;
  const rafCallbacks = [];
  const interactionNode = { id: "interaction-rect" };
  let exposedZoomBehavior = null;

  const effects = {
    setZoomBehavior: (nextZoomBehavior) => {
      exposedZoomBehavior = nextZoomBehavior;
      calls.setZoomBehavior.push(nextZoomBehavior);
      calls.order.push("setZoomBehavior");
    },
    setZoomGestureStartTransform: (transform) => {
      writeState("zoomGestureStartTransform", transform);
    },
    setZoomGestureScaleDelta: (scaleDelta) => {
      writeState("zoomGestureScaleDelta", scaleDelta);
    },
    setPendingExactPoliticalFastFrame: (pending) => {
      writeState("pendingExactPoliticalFastFrame", pending);
    },
    setPendingZoomTransform: (transform) => {
      writeState("pendingZoomTransform", transform);
    },
    setZoomRenderScheduled: (scheduled) => {
      writeState("zoomRenderScheduled", scheduled);
    },
    setZoomGestureEndedAt: (endedAtMs) => {
      writeState("zoomGestureEndedAt", endedAtMs);
    },
    notifyGestureStarted: () => calls.order.push("notifyGestureStarted"),
    clearRenderPhaseTimer: () => calls.order.push("clearRenderPhaseTimer"),
    cancelExactAfterSettleRefresh: () => calls.order.push("cancelExactAfterSettleRefresh"),
    setRenderPhase: (phase) => {
      calls.phases.push(phase);
      calls.order.push(`setRenderPhase:${phase}`);
    },
    captureInteractionBorderSnapshot: (transform) => {
      calls.snapshots.push(transform);
      calls.order.push("captureInteractionBorderSnapshot");
    },
    renderHoverOverlayIfNeeded: (options) => {
      calls.hover.push(options);
      calls.order.push("renderHoverOverlayIfNeeded");
    },
    dismissOnboardingHint: () => calls.order.push("dismissOnboardingHint"),
    scheduleScenarioChunkRefresh: (options) => {
      calls.chunkRefresh.push(options);
      calls.order.push("scheduleScenarioChunkRefresh");
    },
    scheduleRenderPhaseIdle: () => calls.order.push("scheduleRenderPhaseIdle"),
    updateZoomTranslateExtent: () => calls.order.push("updateZoomTranslateExtent"),
    resetZoomToFit: () => calls.order.push("resetZoomToFit"),
    enforceZoomConstraints: () => calls.order.push("enforceZoomConstraints"),
  };
  if (includeUpdateMap) {
    effects.updateMap = (transform) => {
      writeState("zoomTransform", transform);
      calls.updateMap.push(transform);
      calls.order.push(`updateMap:${transform?.label || ""}`);
      updateMapHook?.({ calls, readState, writeState, transform });
    };
  }

  const owner = createZoomInteractionLifecycleOwner({
    constants: {
      minZoomScale: 0.5,
      maxZoomScale: 25,
      renderPhaseInteracting: "interacting-test",
      renderPhaseSettling: "settling-test",
    },
    getters: {
      getD3: () => (includeD3 ? d3Runtime : null),
      getWidth: () => readState("width"),
      getHeight: () => readState("height"),
      getInteractionRect: () => (includeInteractionRect ? { node: () => interactionNode } : null),
      getZoomBehavior: () => exposedZoomBehavior,
      getZoomIdentity: () => d3Runtime.zoomIdentity,
      getZoomTransform: () => readState("zoomTransform"),
      getPendingZoomTransform: () => readState("pendingZoomTransform"),
      getZoomGestureStartTransform: () => readState("zoomGestureStartTransform"),
      isZoomRenderScheduled: () => readState("zoomRenderScheduled"),
    },
    helpers: {
      cloneZoomTransform: (transform) => ({
        ...transform,
        cloned: true,
      }),
      shouldAllowZoomEvent: (event) => {
        calls.order.push(`filter:${event?.type || ""}`);
        return event?.type !== "blocked";
      },
      nowMs: () => 12345,
      requestAnimationFrame: (callback) => {
        rafCallbacks.push(callback);
        return `raf-${rafCallbacks.length}`;
      },
    },
    effects,
  });

  function flushRaf(index = 0) {
    const callback = rafCallbacks[index];
    assert.ok(callback, "expected a queued animation frame");
    callback();
  }

  return {
    behavior,
    calls,
    handlers,
    interactionNode,
    readState,
    owner,
    rafCallbacks,
    runtime: d3Runtime,
    writeState,
    flushRaf,
  };
}

test("initZoom configures behavior and installs zoom handlers", () => {
  const harness = createHarness();

  const zoomBehavior = harness.owner.initZoom();

  assert.equal(zoomBehavior, harness.behavior);
  assert.equal(harness.calls.zoom, 1);
  assert.deepEqual(harness.calls.scaleExtent, [[0.5, 25]]);
  assert.deepEqual(harness.calls.extent, [[[0, 0], [800, 600]]]);
  assert.deepEqual(harness.calls.zoomOn.map((entry) => entry.type), ["start", "zoom", "end"]);
  assert.equal(harness.behavior.filterFn({ type: "wheel" }), true);
  assert.equal(harness.behavior.filterFn({ type: "blocked" }), false);
  assert.deepEqual(harness.calls.select, [harness.interactionNode]);
  assert.deepEqual(harness.calls.targetCall, [{ method: harness.behavior, args: [] }]);
  assert.deepEqual(harness.calls.targetOn, [{ type: "dblclick.zoom", value: null }]);
  assert.deepEqual(harness.calls.order.slice(0, 5), [
    "setZoomBehavior",
    "updateZoomTranslateExtent",
    "resetZoomToFit",
    "enforceZoomConstraints",
    "filter:wheel",
  ]);
});

test("first changed transform enters interacting phase and captures start state", () => {
  const { calls, handlers, owner, readState } = createHarness();
  owner.initZoom();

  handlers.start();
  assert.deepEqual(calls.order.slice(4), []);
  handlers.zoom({ transform: createTransform("moved", { x: 4, y: 4, k: 2 }) });

  assert.deepEqual(calls.order.slice(4), [
    "clearRenderPhaseTimer",
    "cancelExactAfterSettleRefresh",
    "notifyGestureStarted",
    "setRenderPhase:interacting-test",
    "captureInteractionBorderSnapshot",
    "renderHoverOverlayIfNeeded",
    "dismissOnboardingHint",
  ]);
  assert.deepEqual(readState("zoomGestureStartTransform"), {
    ...readState("zoomTransform"),
    cloned: true,
  });
  assert.equal(readState("zoomGestureScaleDelta"), 0);
  assert.equal(readState("pendingExactPoliticalFastFrame"), false);
  assert.deepEqual(calls.phases, ["interacting-test"]);
  assert.deepEqual(calls.snapshots, [readState("zoomTransform")]);
  assert.deepEqual(calls.hover, [{ force: true, eventType: "zoom-start" }]);
});

test("zoom handler batches pending transforms into one animation frame", () => {
  const { calls, flushRaf, handlers, owner, rafCallbacks, readState } = createHarness();
  owner.initZoom();
  const first = createTransform("first", { k: 2 });
  const latest = createTransform("latest", { k: 3 });

  handlers.zoom({ transform: first });
  handlers.zoom({ transform: latest });

  assert.equal(rafCallbacks.length, 1);
  assert.equal(readState("pendingZoomTransform"), latest);
  assert.equal(readState("zoomRenderScheduled"), true);

  flushRaf();

  assert.deepEqual(calls.updateMap, [latest]);
  assert.equal(readState("pendingZoomTransform"), null);
  assert.equal(readState("zoomRenderScheduled"), false);
});

test("zoom handler schedules another frame when pending transform appears during flush", () => {
  const second = createTransform("second", { k: 4 });
  const harness = createHarness({
    updateMapHook: ({ writeState, transform }) => {
      if (transform?.label === "first") {
        writeState("pendingZoomTransform", second);
      }
    },
  });
  harness.owner.initZoom();
  const first = createTransform("first", { k: 2 });

  harness.handlers.zoom({ transform: first });
  harness.flushRaf();

  assert.equal(harness.rafCallbacks.length, 2);
  assert.equal(harness.readState("zoomRenderScheduled"), true);
  assert.equal(harness.readState("pendingZoomTransform"), second);

  harness.flushRaf(1);

  assert.deepEqual(harness.calls.updateMap, [first, second]);
  assert.equal(harness.readState("pendingZoomTransform"), null);
  assert.equal(harness.readState("zoomRenderScheduled"), false);
});

test("zoom end flushes final transform and schedules settled refresh", () => {
  const { calls, handlers, owner, readState } = createHarness({
    state: {
      zoomTransform: createTransform("start", { k: 1 }),
      pendingZoomTransform: createTransform("pending", { k: 2 }),
    },
  });
  owner.initZoom();
  const endTransform = createTransform("end", { k: 4 });

  handlers.start();
  handlers.zoom({ transform: endTransform });
  handlers.end({ transform: endTransform });

  assert.deepEqual(calls.phases, ["interacting-test", "settling-test"]);
  assert.equal(readState("pendingZoomTransform"), null);
  assert.deepEqual(calls.updateMap, [endTransform]);
  assert.equal(readState("zoomGestureScaleDelta"), 2);
  assert.equal(readState("zoomGestureEndedAt"), 12345);
  assert.equal(readState("pendingExactPoliticalFastFrame"), true);
  assert.deepEqual(calls.chunkRefresh, [{ reason: "zoom-end", delayMs: 0 }]);
  assert.equal(calls.order.at(-1), "scheduleRenderPhaseIdle");
});

test("initZoom reports missing d3 or interaction rect", () => {
  const missingD3 = createHarness({ includeD3: false });
  assert.throws(() => missingD3.owner.initZoom(), /requires d3/);
  assert.equal(missingD3.calls.zoom, 0);
  assert.deepEqual(missingD3.calls.setZoomBehavior, []);

  const missingRect = createHarness({ includeInteractionRect: false });
  assert.throws(() => missingRect.owner.initZoom(), /requires an interaction rect node/);
  assert.equal(missingRect.calls.zoom, 0);
  assert.deepEqual(missingRect.calls.setZoomBehavior, []);

  const missingZoom = createHarness({ runtimeOverrides: { zoom: undefined } });
  assert.throws(() => missingZoom.owner.initZoom(), /requires d3\.zoom/);
  assert.equal(missingZoom.calls.zoom, 0);
  assert.deepEqual(missingZoom.calls.setZoomBehavior, []);

  const missingSelect = createHarness({ runtimeOverrides: { select: undefined } });
  assert.throws(() => missingSelect.owner.initZoom(), /requires d3\.select/);
  assert.equal(missingSelect.calls.zoom, 0);
  assert.deepEqual(missingSelect.calls.setZoomBehavior, []);
});

test("owner reports missing required update map effect", () => {
  assert.throws(
    () => createHarness({ includeUpdateMap: false }),
    /requires effects\.updateMap/,
  );
});

test("factory freezes its exact public API", () => {
  const { owner } = createHarness();

  assert.equal(Object.isFrozen(owner), true);
});

for (const inputType of ["mousedown", "touchstart", "wheel", "programmatic"]) {
  test(`${inputType} with unchanged transform does not prepare or recover a camera gesture`, () => {
    const h = createHarness(); h.owner.initZoom();
    const current = h.readState("zoomTransform");
    h.handlers.start({ sourceEvent: { type: inputType }, transform: current });
    h.handlers.zoom({ sourceEvent: { type: inputType }, transform: { ...current } });
    h.handlers.end({ transform: current });
    assert.deepEqual(h.calls.order.slice(4), []);
    assert.deepEqual(h.calls.updateMap, []);
    assert.deepEqual(h.calls.chunkRefresh, []);
    assert.equal(h.readState("pendingExactPoliticalFastFrame"), true);
    assert.equal(h.readState("zoomGestureEndedAt"), 0);
    assert.equal(h.rafCallbacks.length, 0);
  });
}

test("an already flushed final transform is not drawn twice and its RAF cannot touch the next gesture", () => {
  const h = createHarness(); h.owner.initZoom();
  const first = createTransform("first", { x: 7, k: 2 });
  h.handlers.start(); h.handlers.zoom({ transform: first }); h.flushRaf();
  h.handlers.end({ transform: { ...first } });
  assert.deepEqual(h.calls.updateMap, [first]);
  assert.equal(h.calls.chunkRefresh.length, 1);
  const second = createTransform("second", { x: 8, k: 2 });
  h.handlers.start(); h.handlers.zoom({ transform: second });
  h.flushRaf(0);
  assert.equal(h.readState("pendingZoomTransform"), second);
  assert.equal(h.readState("zoomRenderScheduled"), true);
  h.flushRaf(1);
  assert.deepEqual(h.calls.updateMap, [first, second]);
});

test("moving away and returning to the start still completes recovery without redundant painting", () => {
  const h = createHarness(); h.owner.initZoom();
  const start = h.readState("zoomTransform");
  h.handlers.start(); h.handlers.zoom({ transform: { ...start, x: start.x + 1 } });
  h.handlers.zoom({ transform: { ...start } });
  h.handlers.end({ transform: start }); h.flushRaf();
  assert.deepEqual(h.calls.phases, ["interacting-test", "settling-test"]);
  assert.deepEqual(h.calls.updateMap, []);
  assert.equal(h.calls.chunkRefresh.length, 1);
});

test("dispose invalidates pending frames and stale event handlers", () => {
  const h = createHarness(); h.owner.initZoom();
  const moved = createTransform("moved", { k: 3 });
  h.handlers.start(); h.handlers.zoom({ transform: moved });
  h.owner.dispose(); const order = [...h.calls.order];
  h.flushRaf(); h.handlers.zoom({ transform: moved }); h.handlers.end({ transform: moved });
  assert.deepEqual(h.calls.order, order);
  assert.deepEqual(h.calls.updateMap, []);
  assert.equal(h.readState("zoomRenderScheduled"), false);
});

for (const inputType of ["wheel", "touchmove", null]) {
  test(`real transform changes activate ${inputType || "programmatic"} gestures exactly once`, () => {
    const h = createHarness(); h.owner.initZoom();
    const moved = createTransform("moved", { k: 2.000000001, x: 3, y: 4 });
    h.handlers.start();
    h.handlers.zoom({ sourceEvent: inputType ? { type: inputType } : null, transform: moved });
    h.handlers.zoom({ transform: moved }); h.handlers.end({ transform: moved });
    h.flushRaf();
    assert.deepEqual(h.calls.updateMap, [moved]);
    assert.equal(h.calls.order.filter((name) => name === "notifyGestureStarted").length, 1);
    assert.equal(h.calls.chunkRefresh.length, 1);
  });
}
