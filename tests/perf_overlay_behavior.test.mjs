import test from "node:test";
import assert from "node:assert/strict";
import { createPerfOverlay } from "../js/core/renderer/perf_overlay.js";

function createContainer(t) {
  const previousDocument = globalThis.document;
  t.after(() => { globalThis.document = previousDocument; });
  globalThis.document = {
    createElement: (tagName) => ({
      tagName,
      style: {},
      textContent: "",
      remove() { this.parent.children.splice(this.parent.children.indexOf(this), 1); },
    }),
  };
  return {
    children: [],
    contains(element) { return this.children.includes(element); },
    appendChild(element) { this.children.push(element); element.parent = this; },
  };
}

function snapshot(totalMs = 12.5) {
  return Object.freeze({
    cache: Object.freeze({
      perfOverlayEnabled: true,
      lastFrame: { phase: "idle", totalMs, timings: { labels: 3 } },
      lastAction: "zoom",
      lastActionDurationMs: 7,
      reasons: { labels: "projection" },
      dirty: { labels: true },
      counters: { frames: 2, contextScenarioReuseCount: 1 },
    }),
    sidebarPerf: { counters: { rowRefreshes: 4 } },
    passNames: ["labels"],
    renderPerf: { setMapData: { durationMs: 20 }, contextBreakdown: { land: { durationMs: 2, callCount: 3 } } },
    scenarioPerf: { loadScenarioBundle: { durationMs: 5 } },
    contextScenarioReasonSnapshot: { displayReason: "reused", cacheReason: "stable", perfReason: "stable" },
    coverageDebug: { totalCountries: 10 },
    renderPhase: "drawing",
    transformSignature: "camera-a",
  });
}

test("performance overlay displays metric snapshots and updates the same element", (t) => {
  const container = createContainer(t);
  const overlay = createPerfOverlay();
  overlay.updatePerfOverlay(container, snapshot());
  const element = container.children[0];
  assert.equal(element.tagName, "pre");
  assert.equal(element.id, "perf-overlay");
  assert.equal(element.style.pointerEvents, "none");
  for (const text of ["phase=idle total=12.5ms", "transform=camera-a", "labels=3.0ms",
    "land=2.0ms#3", "setMapData=20.0ms", "scenarioLoad=5.0ms", "invalidations labels:projection*",
    "coverage countries=10", "sidebar list=0 rows=4", "reason=reused cacheReason=stable perfReason=stable"]) {
    assert.ok(element.textContent.includes(text), text);
  }
  overlay.updatePerfOverlay(container, snapshot(24));
  assert.deepEqual(container.children, [element]);
  assert.ok(element.textContent.includes("total=24.0ms"));
  assert.ok(!element.textContent.includes("total=12.5ms"));
});

test("disabling the performance overlay removes it and reenabling recreates it", (t) => {
  const container = createContainer(t);
  const overlay = createPerfOverlay();
  overlay.updatePerfOverlay(container, snapshot());
  const element = container.children[0];
  overlay.updatePerfOverlay(container, { cache: { perfOverlayEnabled: false } });
  assert.equal(container.children.length, 0);
  overlay.updatePerfOverlay(container, snapshot());
  assert.equal(container.children.length, 1);
  assert.notEqual(container.children[0], element);
});

test("performance overlay waits for a container and replaces a detached element", (t) => {
  const container = createContainer(t);
  const overlay = createPerfOverlay();
  overlay.updatePerfOverlay(null, snapshot());
  assert.equal(container.children.length, 0);
  overlay.updatePerfOverlay(container, snapshot());
  const element = container.children[0];
  element.remove();
  overlay.updatePerfOverlay(container, snapshot());
  assert.equal(container.children.length, 1);
  assert.notEqual(container.children[0], element);
});
