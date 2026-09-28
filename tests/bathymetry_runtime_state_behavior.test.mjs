import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { parse } from "acorn";

const source = readFileSync(new URL("../js/core/map_renderer.js", import.meta.url), "utf8");
const names = ["disableActiveBathymetryState", "cloneBathymetryFeatureWithSource", "buildBathymetryFeatureCollection",
  "mergeBathymetryFeatureCollections", "syncActiveBathymetryState", "publishBathymetryDiagnostic", "publishBathymetryLoadStatus", "getCachedBathymetryEntry", "getBathymetryFeatureCollections"];
const functions = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
  .filter(node => node.type === "FunctionDeclaration" && names.includes(node.id.name));

function harness() {
  const state = { renderPerfMetrics: {}, globalBathymetryTopologyUrl: "global", globalBathymetryBandsData: { features: [{ properties: { depth_max_m: -200 } }] } };
  const cache = new Map();
  const failures = new Map();
  const tasks = [];
  const calls = [];
  const context = vm.createContext({ runtimeState: state, stableJson: JSON.stringify,
    bathymetryTopologyCacheByUrl: cache, bathymetryLoadFailureByUrl: failures,
    bathymetryOverviewByEntry: new WeakMap(),
    getScenarioBathymetryTopologyUrl: () => state.activeScenarioId ? "scenario" : "",
    getDesiredBathymetryTopologyUrl: () => "global",
    recordRenderPerfMetric: (name, duration, summary) => { state.renderPerfMetrics[name] = summary; },
    queueMicrotask: fn => tasks.push(fn), callRuntimeHook: (_state, hook) => calls.push(hook),
  });
  vm.runInContext("let activeBathymetryInputs=null; let bathymetryUiRefreshPending=false;\n"
    + functions.map(node => source.slice(node.start, node.end)).join("\n"), context);
  return { state, context, cache, failures, tasks, calls };
}

test("bathymetry retains feature identity across redraw and refreshes when sources change", () => {
  const { state, context } = harness();
  context.syncActiveBathymetryState();
  const first = state.activeBathymetryBandsData;
  context.syncActiveBathymetryState();
  assert.equal(state.activeBathymetryBandsData, first);
  assert.equal(first.features[0].properties._bathymetrySource, "global");
  context.disableActiveBathymetryState();
  assert.equal(state.activeBathymetryBandsData, null);
  context.syncActiveBathymetryState();
  assert.equal(state.activeBathymetryBandsData.features.length, 1);
  state.activeScenarioId = "tno";
  state.scenarioBathymetryTopologyUrl = "scenario";
  state.scenarioBathymetryBandsData = { features: [{ properties: { depth_max_m: -50 } }] };
  context.syncActiveBathymetryState();
  assert.equal(state.activeBathymetrySource, "merged");
  assert.equal(state.activeBathymetryBandsData.features.length, 2);
  state.activeScenarioId = "";
  context.syncActiveBathymetryState();
  assert.equal(state.activeBathymetrySource, "global");
  assert.equal(state.activeBathymetryBandsData.features.length, 1);
});

test("load completion and failure refresh toolbar once with accurate source status", () => {
  const h = harness();
  h.context.publishBathymetryLoadStatus();
  assert.equal(h.state.renderPerfMetrics.bathymetryLoad.status, "loading");
  h.failures.set("global", 1);
  h.context.publishBathymetryLoadStatus();
  assert.equal(h.state.renderPerfMetrics.bathymetryLoad.status, "error");
  h.cache.set("global", {});
  h.context.publishBathymetryLoadStatus();
  assert.equal(h.state.renderPerfMetrics.bathymetryLoad.status, "ready");
  h.state.activeScenarioId = "tno";
  h.failures.set("scenario", 1);
  h.context.publishBathymetryLoadStatus();
  assert.equal(h.state.renderPerfMetrics.bathymetryLoad.status, "partial");
  assert.deepEqual(Array.from(h.state.renderPerfMetrics.bathymetryLoad.failedSources), ["scenario"]);
  assert.equal(h.tasks.length, 1);
  h.tasks.shift()();
  assert.deepEqual(h.calls, ["updateToolbarInputsFn"]);
  h.context.publishBathymetryLoadStatus();
  assert.equal(h.tasks.length, 0);
});

test("overview preserves cached geometry identity and drops stale source selections", () => {
  const { state, context, cache } = harness();
  const entry = { bandsOverview: { features: [{ properties: { depth_max_m: -200 }, geometry: { type: "Polygon" } }] } };
  cache.set("global", entry);
  const first = context.getBathymetryFeatureCollections().globalOverviewBands;
  assert.equal(first.features[0].properties._bathymetrySource, "global");
  assert.equal(first.features[0].geometry, entry.bandsOverview.features[0].geometry);
  assert.equal(context.getBathymetryFeatureCollections().globalOverviewBands, first);
  state.globalBathymetryTopologyUrl = "stale";
  assert.equal(context.getBathymetryFeatureCollections().globalOverviewBands, null);
  state.globalBathymetryTopologyUrl = "global";
  cache.set("global", { bandsOverview: { features: [{ properties: { depth_max_m: -400 } }] } });
  assert.notEqual(context.getBathymetryFeatureCollections().globalOverviewBands, first);
});

function loadHarness({ workerLoad, fallbackEntry = {} } = {}) {
  let desiredUrl = "global";
  const cache = new Map();
  const applied = [], invalidated = [], metrics = [];
  let fetches = 0;
  const context = vm.createContext({
    bathymetryWorkerClient: { load: workerLoad },
    bathymetryTopologyCacheByUrl: cache, bathymetryLoadFailureByUrl: new Map(),
    getRendererAssetUrlPolicyOwner: () => ({ isDesiredBathymetryUrl: (_slot, url) => url === desiredUrl }),
    getDesiredBathymetryTopologyUrl: () => desiredUrl,
    setBathymetryStateSlot: (...args) => applied.push(args),
    syncActiveBathymetryState() {}, publishBathymetryLoadStatus() {},
    rendererSurfaceHost: { getContext: () => ({}) }, render() {},
    invalidateOceanVisualState: reason => invalidated.push(reason),
    nowMs: () => 0, recordRenderPerfMetric: (name, _ms, detail) => metrics.push({ name, ...detail }),
    fetch: async () => { fetches += 1; return { ok: true, json: async () => ({}) }; },
    normalizeBathymetryTopologyEntry: () => fallbackEntry,
  });
  const declarations = parse(source, { ecmaVersion: "latest", sourceType: "module" }).body
    .filter(node => node.type === "FunctionDeclaration" && ["loadBathymetryTopology", "applyResolvedBathymetryEntry"].includes(node.id.name));
  vm.runInContext(declarations.map(node => source.slice(node.start, node.end)).join("\n"), context);
  return { context, cache, applied, invalidated, metrics, fetches: () => fetches,
    setDesiredUrl: value => { desiredUrl = value; } };
}

test("late worker completion caches data without replacing a changed scenario or repainting it", async () => {
  let resolve;
  const h = loadHarness({ workerLoad: () => new Promise(done => { resolve = done; }) });
  const pending = h.context.loadBathymetryTopology("global");
  h.setDesiredUrl("replacement");
  const entry = { bands: { features: [] }, timings: { normalizationDetailMs: 12 } };
  resolve(entry);
  assert.equal(await pending, entry);
  assert.equal(h.cache.get("global"), entry);
  assert.equal(h.applied.length, 0);
  assert.equal(h.invalidated.length, 0);
  assert.equal(h.fetches(), 0);
});

test("unsupported worker falls back once, while asset errors never trigger a second fetch", async () => {
  const entry = { bands: { features: [] }, timings: {} };
  const h = loadHarness({ workerLoad: async () => null, fallbackEntry: entry });
  assert.equal(await h.context.loadBathymetryTopology("global"), entry);
  assert.equal(h.fetches(), 1);
  assert.equal(h.applied.length, 1);
  assert.equal(h.metrics.find(metric => metric.name === "bathymetryDecode").execution, "main");
  const failed = loadHarness({ workerLoad: async () => { throw Error("HTTP 404"); } });
  await assert.rejects(failed.context.loadBathymetryTopology("global"), /HTTP 404/);
  assert.equal(failed.fetches(), 0);
  assert.equal(failed.applied.length, 0);
});
