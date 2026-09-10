import test from "node:test";
import assert from "node:assert/strict";
import { resolveContourLodRequest } from "../js/core/renderer/physical_contour_lod_policy.js";

const state = (k, patch = {}) => ({ zoomTransform: { k }, styleConfig: { physical: { preset: "balanced", contourMinorVisible: true, ...patch } } });
const legacyContourState = (k, patch = {}) => ({
  zoomTransform: { k },
  styleConfig: { physical: { mode: "atlas_and_contours", ...patch } },
});

test("low LOD requests only major", () => {
  assert.deepEqual(resolveContourLodRequest(state(1.3)), ["physical_contours_low_major"]);
});

test("mid LOD loads minor only after preset zoom gate", () => {
  assert.deepEqual(resolveContourLodRequest(state(2.4)), ["physical_contours_mid_major"]);
  assert.deepEqual(resolveContourLodRequest(state(3, { preset: "political_clean" })), ["physical_contours_mid_major", "physical_contours_mid_minor"]);
  assert.deepEqual(resolveContourLodRequest(state(3, { contourMinorVisible: false })), ["physical_contours_mid_major"]);
});

test("high LOD upgrades to detail and preset controls minor", () => {
  assert.deepEqual(resolveContourLodRequest(state(3.2)), ["physical_contours_mid_major", "physical_contours_mid_minor"]);
  assert.deepEqual(resolveContourLodRequest(state(3.2, { contourMinorIntervalM: 100 })), ["physical_contours_mid_major", "physical_contours_minor"]);
  assert.deepEqual(resolveContourLodRequest(state(3.5, { preset: "terrain_rich" })), ["physical_contours_mid_major"]);
  assert.deepEqual(resolveContourLodRequest(state(4, { preset: "terrain_rich" })), ["physical_contours_major", "physical_contours_minor"]);
});

test("normalizes legacy contour styles with omitted minor fields", () => {
  assert.deepEqual(resolveContourLodRequest(legacyContourState(3.2)), [
    "physical_contours_mid_major",
    "physical_contours_mid_minor",
  ]);
});

test("terrain rich keeps 100m detail behind its high zoom gate", () => {
  assert.deepEqual(resolveContourLodRequest(legacyContourState(3.9, { preset: "terrain_rich" })), [
    "physical_contours_mid_major",
  ]);
  assert.deepEqual(resolveContourLodRequest(legacyContourState(4, {
    preset: "terrain_rich",
    contourMinorIntervalM: 100,
  })), ["physical_contours_major", "physical_contours_minor"]);
});

test("explicitly disabled minor contours remain disabled after normalization", () => {
  assert.deepEqual(resolveContourLodRequest(legacyContourState(6, {
    preset: "terrain_rich",
    contourMinorVisible: false,
  })), ["physical_contours_major"]);
});

// Exercise the actual renderer wiring: cached viewport frames bypass render().
const rendererSource = (await import("node:fs")).readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const { parse } = await import("acorn");
const rendererAst = parse(rendererSource, { ecmaVersion: "latest", sourceType: "module" });
const functionNode = (name) => rendererAst.body.find((node) => node.type === "FunctionDeclaration" && node.id.name === name);
const gateNode = functionNode("ensureContourLodForView");
const gateSource = rendererSource.slice(gateNode.start, gateNode.end);
const flush = () => new Promise((resolve) => setImmediate(resolve));
function gateHarness() {
  const runtime = { ...state(1), showPhysical: true, activeScenarioId: "A", contextLayerExternalDataByName: {}, contextLayerLoadStateByName: {} };
  let calls = 0;
  let renders = 0;
  const major = { features: [] };
  runtime.ensureContextLayerDataFn = async () => { calls += 1; runtime.physicalContourMajorData = major; };
  const ensure = new Function("runtimeState", "resolveContourLodRequest", "requestRendererRender", "console",
    `let lastContourLodRequest = null; ${gateSource}; return ensureContourLodForView;`
  )(runtime, resolveContourLodRequest, () => { renders += 1; }, { warn() {} });
  return { runtime, ensure, major, calls: () => calls, renders: () => renders };
}

test("render LOD gate deduplicates loaded views but republishes after same-scene reset", async () => {
  const h = gateHarness();
  h.ensure(); h.ensure(); await flush();
  assert.equal(h.calls(), 1);
  h.ensure(); await flush(); assert.equal(h.calls(), 1);
  h.runtime.physicalContourMajorData = null;
  h.ensure(); await flush();
  assert.equal(h.calls(), 2);
  assert.equal(h.runtime.physicalContourMajorData, h.major);
  h.runtime.contextLayerExternalDataByName = {};
  h.ensure(); await flush(); assert.equal(h.calls(), 3);
});

test("failed contour pack can retry on a later frame without scheduling a render loop", async () => {
  const h = gateHarness();
  h.runtime.contextLayerLoadStateByName.physical_contours_low_major = "error";
  h.ensure(); await flush(); assert.equal(h.renders(), 0);
  h.runtime.contextLayerLoadStateByName.physical_contours_low_major = "loaded";
  h.ensure(); await flush();
  assert.equal(h.calls(), 2);
  assert.equal(h.renders(), 1);
});

test("cached frame preparation selects LOD during settle while deferring active gestures", () => {
  const factory = functionNode("getDrawCanvasOrchestrationOwner");
  let callback;
  function visit(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "Property" && node.key?.name === "ensureLayerDataFromTopology") callback = node.value;
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(visit);
      else if (value && typeof value === "object") visit(value);
    }
  }
  visit(factory);
  assert.equal(callback?.type, "ArrowFunctionExpression");
  const runtime = { renderPhase: "settling" };
  const events = [];
  const prepare = new Function("runtimeState", "ensureLayerDataFromTopology", "ensureContourLodForView", "RENDER_PHASE_INTERACTING",
    `return (${rendererSource.slice(callback.start, callback.end)});`
  )(runtime, () => events.push("topology"), () => events.push("lod"), "interacting");
  prepare(); assert.deepEqual(events.splice(0), ["topology", "lod"]);
  runtime.renderPhase = "interacting";
  prepare(); assert.deepEqual(events.splice(0), ["topology"]);
  runtime.renderPhase = "idle";
  prepare(); assert.deepEqual(events.splice(0), ["topology", "lod"]);
  runtime.scenarioApplyInFlight = true;
  prepare(); assert.deepEqual(events, ["topology"]);
});
