import { Element } from "./helpers/legend_element.mjs";
import test from "node:test";
import assert from "node:assert/strict";
import { registerRuntimeHook, readRegisteredRuntimeHookSource } from "../js/core/state/index.js";
import { createLegendRuntime } from "../js/core/renderer/legend_runtime.js";

function harness(t) {
  const document = new Element("document");
  let creations = 0;
  document.createElement = (tag) => { creations++; return new Element(tag); };
  const previousDocument = globalThis.document;
  globalThis.document = document;
  t.after(() => { globalThis.document = previousDocument; });
  const state = {
    colors: { A: "#ff0000" }, colorRevision: 0,
    legendLabels: { "#ff0000": "Red" }, currentLanguage: "en",
  };
  const runtimeState = { width: 800, height: 600, currentLanguage: "en" };
  const previousHook = readRegisteredRuntimeHookSource(runtimeState, "updateLegendUI");
  registerRuntimeHook(runtimeState, "updateLegendUI", null);
  t.after(() => registerRuntimeHook(runtimeState, "updateLegendUI", previousHook));
  const h = {
    state, runtimeState, container: null, containerReads: 0,
    creations: () => creations,
    labels: () => h.container.querySelectorAll(".map-legend-label").map(node => node.textContent),
  };
  h.runtime = createLegendRuntime({
    state, runtimeState,
    getMapContainer: () => { h.containerReads++; return h.container; },
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
  });
  return h;
}

function scheduler(t) {
  const frames = [], timers = [];
  const previousFrame = globalThis.requestAnimationFrame;
  globalThis.requestAnimationFrame = callback => frames.push(callback);
  t.mock.method(globalThis, "setTimeout", callback => timers.push(callback));
  t.after(() => { globalThis.requestAnimationFrame = previousFrame; });
  return {
    frames, timers,
    runFrame: () => frames.shift()(),
    runTimer: () => timers.shift()(),
  };
}

test("runtime creates the legend on first use and reuses its owner across entry points", (t) => {
  const h = harness(t);
  assert.equal(h.creations(), 0);
  assert.equal(h.containerReads, 0);
  h.container = new Element();
  const element = h.runtime.ensureLegendControlElement();
  const creations = h.creations();
  assert.ok(creations > 0);
  assert.equal(h.runtime.ensureLegendControlElement(), element);
  assert.equal(h.creations(), creations);
  const { renderLegend } = h.runtime;
  assert.equal(renderLegend(), undefined);
  const row = h.container.querySelector(".map-legend-row");
  renderLegend();
  assert.equal(h.container.children.length, 1);
  assert.equal(h.container.children[0], element);
  assert.equal(h.container.querySelector(".map-legend-row"), row);
  assert.deepEqual(h.labels(), ["Red"]);
});

test("container is read live for creation, replacement, absence and current layout", (t) => {
  const h = harness(t);
  assert.equal(h.runtime.ensureLegendControlElement(), null);
  const oldContainer = h.container = new Element();
  h.runtime.renderLegend();
  const oldElement = oldContainer.children[0];
  h.container = new Element();
  h.runtime.renderLegend();
  assert.equal(oldContainer.children.length, 0);
  assert.notEqual(h.container.children[0], oldElement);
  assert.deepEqual(h.labels(), ["Red"]);
  h.state.legendControl.xRatio = 1;
  h.container.clientWidth = 1000;
  h.runtime.renderLegend();
  assert.equal(h.container.children[0].style.left, "752px");
  h.container = null;
  assert.equal(h.runtime.ensureLegendControlElement(), null);
});

test("detached render callback preserves explicit colors, labels and live state defaults", (t) => {
  const h = harness(t);
  h.container = new Element();
  const { renderLegend } = h.runtime;
  renderLegend(["#00ff00"], { "#00ff00": "Green" });
  assert.deepEqual(h.labels(), ["Green"]);
  renderLegend();
  assert.deepEqual(h.labels(), ["Red"]);
  h.state.colors.A = "#0000ff";
  h.state.colorRevision++;
  h.state.legendLabels = { "#0000ff": "Blue" };
  h.runtimeState.currentLanguage = "zh";
  renderLegend();
  assert.deepEqual(h.labels(), ["Blue"]);
  assert.equal(h.container.querySelector(".map-legend-control-title").textContent, "图例");
});

test("requests coalesce until the post-frame timer and call the current UI callback after rendering", (t) => {
  const h = harness(t);
  const s = scheduler(t);
  const calls = [];
  registerRuntimeHook(h.runtimeState, "updateLegendUI", () => calls.push("old"));
  h.runtime.requestLegendRender();
  h.runtime.requestLegendRender();
  assert.equal(s.frames.length, 1);
  assert.equal(h.containerReads, 0);
  assert.deepEqual(calls, []);
  s.runFrame();
  assert.equal(s.timers.length, 1);
  assert.equal(h.containerReads, 0);
  h.runtime.requestLegendRender();
  assert.equal(s.frames.length, 0);
  assert.equal(s.timers.length, 1);
  h.container = new Element();
  registerRuntimeHook(h.runtimeState, "updateLegendUI", () => {
    calls.push(h.labels());
  });
  s.runTimer();
  assert.deepEqual(calls, [["Red"]]);
  const element = h.container.children[0];
  const row = h.container.querySelector(".map-legend-row");
  h.runtime.requestLegendRender();
  h.runtime.requestLegendRender();
  assert.equal(s.frames.length, 1);
  s.runFrame();
  s.runTimer();
  assert.deepEqual(calls, [["Red"], ["Red"]]);
  assert.equal(h.container.children[0], element);
  assert.equal(h.container.querySelector(".map-legend-row"), row);
});

test("direct rendering leaves a queued refresh pending and requests inside its callback schedule again", (t) => {
  const h = harness(t);
  const s = scheduler(t);
  h.container = new Element();
  let calls = 0;
  registerRuntimeHook(h.runtimeState, "updateLegendUI", () => {
    calls++;
    if (calls === 1) h.runtime.requestLegendRender();
  });
  h.runtime.requestLegendRender();
  h.runtime.renderLegend();
  assert.equal(calls, 0);
  s.runFrame();
  s.runTimer();
  assert.equal(calls, 1);
  assert.equal(s.frames.length, 1);
  s.runFrame();
  s.runTimer();
  assert.equal(calls, 2);
  assert.equal(s.frames.length, 0);
});
