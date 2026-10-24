import assert from "node:assert/strict";
import test from "node:test";
import { createDeferredPanelRender } from "../js/core/deferred_panel_render.js";

function harness() {
  const frames = [], timers = [], log = [];
  let observer = null;
  class FakeObserver {
    constructor(callback) { this.callback = callback; observer = this; }
    observe(element) { this.element = element; }
    disconnect() { this.disconnected = true; }
  }
  const panel = createDeferredPanelRender({
    render: () => log.push("render"),
    element: { id: "paletteLibraryList" },
    requestFrame: (callback) => frames.push(callback),
    setTimer: (callback) => timers.push(callback),
    ObserverClass: FakeObserver,
  });
  return {
    panel, log,
    runFrames() { for (const callback of frames.splice(0)) { log.push("frame"); callback(); } },
    runTimers() { for (const callback of timers.splice(0)) callback(); },
    setVisible(visible) { observer.callback([{ isIntersecting: visible }]); },
    observer: () => observer,
  };
}

test("a visible panel rebuilds after the input frame, not inside it", () => {
  const h = harness();
  h.panel.request();
  assert.deepEqual(h.log, [], "nothing runs synchronously in the input handler");
  h.runFrames();
  assert.deepEqual(h.log, ["frame"], "the frame callback only queues the rebuild");
  h.runTimers();
  assert.deepEqual(h.log, ["frame", "render"], "the rebuild runs in a task after the frame");
});

test("repeated requests before the rebuild coalesce into one render", () => {
  const h = harness();
  h.panel.request();
  h.panel.request();
  h.runFrames();
  h.panel.request();
  h.runTimers();
  h.runFrames();
  h.runTimers();
  assert.equal(h.log.filter((entry) => entry === "render").length, 1);
});

test("a hidden panel stays stale and rebuilds once when it becomes visible", () => {
  const h = harness();
  h.setVisible(false);
  h.panel.request();
  h.panel.request();
  h.runFrames();
  h.runTimers();
  assert.deepEqual(h.log, [], "hidden panels are not rebuilt");
  h.setVisible(true);
  h.runFrames();
  h.runTimers();
  assert.deepEqual(h.log, ["frame", "render"]);
  h.setVisible(false);
  h.setVisible(true);
  h.runFrames();
  h.runTimers();
  assert.equal(h.log.filter((entry) => entry === "render").length, 1, "an up-to-date panel is not rebuilt again");
});

test("a panel hidden after the request was queued skips the rebuild until shown", () => {
  const h = harness();
  h.panel.request();
  h.runFrames();
  h.setVisible(false);
  h.runTimers();
  assert.deepEqual(h.log, ["frame"]);
  h.setVisible(true);
  h.runFrames();
  h.runTimers();
  assert.deepEqual(h.log, ["frame", "frame", "render"]);
});

test("a direct rebuild while stale cancels the queued and on-show rebuilds", () => {
  const h = harness();
  h.panel.request();
  h.panel.markFresh();
  h.runFrames();
  h.runTimers();
  assert.equal(h.log.includes("render"), false, "the queued rebuild is skipped");
  h.setVisible(false);
  h.panel.request();
  h.panel.markFresh();
  h.setVisible(true);
  h.runFrames();
  h.runTimers();
  assert.equal(h.log.includes("render"), false, "showing an up-to-date panel does not rebuild it");
});

test("without frame or timer APIs the rebuild runs synchronously", () => {
  const log = [];
  const panel = createDeferredPanelRender({ render: () => log.push("render"), requestFrame: null, setTimer: null, ObserverClass: null });
  panel.request();
  assert.deepEqual(log, ["render"]);
});

test("dispose disconnects the visibility observer and drops pending work", () => {
  const h = harness();
  h.panel.request();
  h.panel.dispose();
  h.runFrames();
  h.runTimers();
  assert.equal(h.observer().disconnected, true);
  assert.equal(h.log.includes("render"), false);
});
