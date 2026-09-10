import { resolveContourLodRequest } from "../js/core/renderer/physical_contour_lod_policy.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as contentActions from "../js/core/state/content_state.js";
import * as contentLoadActions from "../js/core/state/actions/content_load_actions.js";

// Run the real owner with controlled resource IO; no DOM or network is needed.
const source = readFileSync(new URL("../js/bootstrap/startup_data_pipeline.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?from "[^"]+";\r?\n/gm, "")
  .replace("export function createStartupDataPipelineOwner", "function createStartupDataPipelineOwner");
function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}
function harness(overrides = {}, helperOverrides = {}) {
  const state = { activeScenarioId: "A", currentScenarioApplyRequestId: 1, locales: { ui: {}, geo: {} } };
  const events = [];
  const dependencies = {
    resolveContourLodRequest,
    ...contentActions,
    ...contentLoadActions,
    normalizeRequestedContextLayerNames: (names) => names,
    syncScenarioLocalizationState: () => events.push("sync-localization"),
    emitStateBusEvent: () => events.push("ui-event"),
    STATE_BUS_EVENTS: {},
    buildCityLocalizationPatch: () => ({}),
    console: { info() {}, warn() {} },
    ...overrides,
  };
  const createOwner = new Function(...Object.keys(dependencies), `${source}\nreturn createStartupDataPipelineOwner;`)(...Object.values(dependencies));
  const owner = createOwner({ state, helpers: {
    requestMainRender: () => events.push("render"),
    invalidateContextLayerVisualStateBatch: () => events.push("invalidate"),
    ...helperOverrides,
  } });
  return { owner, state, events };
}

test("resource finalizers cannot clear a replacement request or its status", () => {
  const previous = Promise.resolve();
  const replacement = Promise.resolve();
  const state = {
    baseCityDataPromise: replacement, baseCityDataState: "loading", baseCityDataError: "",
    baseLocalizationDataPromise: replacement, baseLocalizationDataState: "loading", baseLocalizationDataError: "",
    contextLayerLoadPromiseByName: { rivers: replacement },
    contextLayerLoadStateByName: { rivers: "loading" }, contextLayerLoadErrorByName: { rivers: "" },
  };
  const options = { expectedPromise: previous, cancelled: true };
  assert.equal(contentLoadActions.finishBaseCitySupportLoad(state, options), false);
  assert.equal(contentLoadActions.finishFullLocalizationLoad(state, options), false);
  assert.equal(contentLoadActions.finishContextLayerLoad(state, "rivers", options), false);
  assert.equal(state.baseCityDataPromise, replacement);
  assert.equal(state.baseLocalizationDataPromise, replacement);
  assert.equal(state.contextLayerLoadPromiseByName.rivers, replacement);
  assert.equal(state.baseCityDataState, "loading");
  assert.equal(state.baseLocalizationDataState, "loading");
  assert.equal(state.contextLayerLoadStateByName.rivers, "loading");
});

test("scenario load arriving after A to B to A cannot hydrate the newer apply request", async () => {
  const load = deferred();
  const commits = [];
  const { owner, state } = harness({
    loadScenarioBundle: () => load.promise,
    hydrateActiveScenarioBundle: (bundle) => commits.push(bundle),
    enforceScenarioHydrationHealthGate: async () => ({ ok: true }),
  });
  const old = owner.ensureActiveScenarioBundleHydrated();
  state.activeScenarioId = "B";
  state.currentScenarioApplyRequestId = 2;
  state.activeScenarioId = "A";
  state.currentScenarioApplyRequestId = 3;
  load.resolve({ bundleLevel: "full" });
  await assert.rejects(old, { name: "AbortError" });
  assert.deepEqual(commits, []);
  await owner.ensureActiveScenarioBundleHydrated();
  assert.equal(commits.length, 1);
});

test("same-scenario project import epoch invalidates a late hydration without changing request id", async () => {
  const load = deferred();
  const commits = [];
  const { owner, state } = harness({
    loadScenarioBundle: () => load.promise,
    hydrateActiveScenarioBundle: (bundle) => commits.push(bundle),
    enforceScenarioHydrationHealthGate: async () => ({ ok: true }),
  });
  state.renderTransactionDiagnostics = { scenarioApplyEpoch: 10 };
  const old = owner.ensureActiveScenarioBundleHydrated();
  state.renderTransactionDiagnostics.scenarioApplyEpoch = 11;
  load.resolve({ bundleLevel: "full" });
  await assert.rejects(old, { name: "AbortError" });
  assert.deepEqual(commits, []);
});

test("context cancellation blocks the underlying collection commit and allows a later request", async () => {
  const load = deferred();
  const { owner, state, events } = harness({ loadContextLayerPack: () => load.promise });
  const controller = new AbortController();
  const old = owner.ensureContextLayerDataReady(["rivers"], { signal: controller.signal });
  controller.abort();
  load.resolve({ type: "FeatureCollection", features: [{ id: "river" }] });
  await assert.rejects(old, { name: "AbortError" });
  assert.equal(state.contextLayerExternalDataByName?.rivers, undefined);
  assert.equal(state.contextLayerLoadStateByName.rivers, "idle");
  assert.deepEqual(events, []);
  await owner.ensureContextLayerDataReady(["rivers"]);
  assert.equal(state.contextLayerExternalDataByName.rivers.features[0].id, "river");
  assert.deepEqual(events, ["invalidate"]);
});

test("a current context receiver reuses an older fetch without inheriting its cancellation", async () => {
  const load = deferred();
  let loads = 0;
  const { owner, state, events } = harness({ loadContextLayerPack: () => { loads += 1; return load.promise; } });
  let oldCurrent = true;
  const old = owner.ensureContextLayerDataReady(["rivers"], { isCurrent: () => oldCurrent });
  oldCurrent = false;
  const current = owner.ensureContextLayerDataReady(["rivers"], { renderNow: false });
  load.resolve({ features: [{ id: "shared" }] });
  await assert.rejects(old, { name: "AbortError" });
  await current;
  assert.equal(loads, 1);
  assert.equal(state.contextLayerExternalDataByName.rivers.features[0].id, "shared");
  assert.deepEqual(events, ["invalidate"]);
});

for (const resource of ["city", "localization"]) {
  test(`${resource} shared load commits for the current receiver and renders its request`, async () => {
    const load = deferred();
    let loads = 0;
    const loader = () => { loads += 1; return load.promise; };
    const { owner, state, events } = harness({ loadCitySupportData: loader, loadLocalizationData: loader });
    const method = resource === "city" ? "ensureBaseCityDataReady" : "ensureFullLocalizationDataReady";
    const controller = new AbortController();
    const old = owner[method]({ signal: controller.signal, renderNow: false });
    controller.abort();
    const current = owner[method]({ renderNow: true });
    state.activeScenarioId = "B"; // Shared base resources follow the live scenario.
    load.resolve({ worldCities: { features: [] }, locales: { ui: { label: "loaded" }, geo: {} } });
    await Promise.all([old, current]);
    assert.equal(loads, 1);
    assert.equal(resource === "city" ? state.baseCityDataState : state.baseLocalizationDataState, "loaded");
    assert.deepEqual(events, ["sync-localization", "ui-event", "render"]);
  });

  test(`${resource} with no current receiver discards data and releases the pending promise`, async () => {
    const load = deferred();
    const { owner, state, events } = harness({ loadCitySupportData: () => load.promise, loadLocalizationData: () => load.promise });
    const controller = new AbortController();
    const method = resource === "city" ? "ensureBaseCityDataReady" : "ensureFullLocalizationDataReady";
    const pending = owner[method]({ signal: controller.signal });
    controller.abort();
    load.resolve({ worldCities: { features: [] }, locales: { ui: {}, geo: {} } });
    assert.equal(await pending, null);
    assert.equal(resource === "city" ? state.baseCityDataPromise : state.baseLocalizationDataPromise, null);
    assert.notEqual(resource === "city" ? state.baseCityDataState : state.baseLocalizationDataState, "loading");
    assert.deepEqual(events, []);
  });
}

function contourHarness() {
  const loads = new Map();
  const calls = [];
  const result = harness({ loadContextLayerPack: (name) => {
    calls.push(name);
    const load = deferred();
    loads.set(name, load);
    return load.promise;
  } });
  result.state.zoomTransform = { k: 4 };
  result.state.styleConfig = { physical: { contourMinorVisible: false } };
  return { ...result, loads, calls };
}
const pack = (id) => ({ type: "FeatureCollection", features: [{ id }] });

test("contour high-low-high uses independent pack caches and reactivates with revision/invalidation", async () => {
  const { owner, state, loads, calls, events } = contourHarness();
  const high = pack("high"), low = pack("low");
  let pending = owner.ensureContextLayerDataReady("physical-contours-set");
  loads.get("physical_contours_major").resolve(high);
  await pending;
  state.zoomTransform.k = 1;
  pending = owner.ensureContextLayerDataReady("physical-contours-set");
  assert.equal(state.physicalContourMajorData, high, "retain last good data during new LOD fetch");
  loads.get("physical_contours_low_major").resolve(low);
  await pending;
  assert.equal(state.physicalContourMajorData, low);
  assert.equal(state.contextLayerExternalDataByName.physical_contours_major, high);
  const revision = state.contextLayerRevision;
  const invalidations = events.length;
  state.zoomTransform.k = 4;
  await owner.ensureContextLayerDataReady("physical-contours-set", { renderNow: false });
  assert.equal(state.physicalContourMajorData, high);
  assert.equal(state.contextLayerRevision, revision + 1);
  assert.equal(events.length, invalidations + 1);
  assert.equal(calls.length, 2);
});

test("out-of-order explicit detail result caches without replacing current low display", async () => {
  const { owner, state, loads, events } = contourHarness();
  const high = pack("high"), low = pack("low");
  const detailRequest = owner.ensureContextLayerDataReady("physical_contours_major");
  state.zoomTransform.k = 1;
  const lowRequest = owner.ensureContextLayerDataReady("physical-contours-set");
  loads.get("physical_contours_low_major").resolve(low);
  await lowRequest;
  const revision = state.contextLayerRevision, count = events.length;
  loads.get("physical_contours_major").resolve(high);
  const result = await detailRequest;
  assert.equal(result.physical_contours_major, high);
  assert.equal(state.contextLayerExternalDataByName.physical_contours_major, high);
  assert.equal(state.physicalContourMajorData, low);
  assert.equal(state.contextLayerRevision, revision);
  assert.equal(events.length, count);
});

test("unrelated river requests never clear contour aliases, minor gate clears immediately", async () => {
  const { owner, state, loads } = contourHarness();
  const major = pack("old-major"), minor = pack("old-minor");
  state.physicalContourMajorData = major;
  state.physicalContourMinorData = minor;
  const river = owner.ensureContextLayerDataReady("rivers");
  assert.equal(state.physicalContourMajorData, major);
  assert.equal(state.physicalContourMinorData, minor);
  loads.get("rivers").resolve(pack("rivers"));
  await river;
  assert.equal(state.physicalContourMinorData, minor);
  state.zoomTransform.k = 1;
  const contour = owner.ensureContextLayerDataReady("physical-contours-set");
  assert.equal(state.physicalContourMajorData, major);
  assert.equal(state.physicalContourMinorData, null);
  loads.get("physical_contours_low_major").resolve(pack("low"));
  await contour;
});

test("cancelled contour receivers cannot cache or publish a late pack", async () => {
  const { owner, state, loads } = contourHarness();
  let current = true;
  const pending = owner.ensureContextLayerDataReady("physical-contours-set", { isCurrent: () => current });
  current = false;
  loads.get("physical_contours_major").resolve(pack("cancelled"));
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(state.contextLayerExternalDataByName?.physical_contours_major, undefined);
  assert.equal(state.physicalContourMajorData, undefined);
  assert.equal(state.contextLayerLoadStateByName.physical_contours_major, "idle");
});


test("cached contour reactivation forwards renderNow false without scheduling an eager render", async () => {
  const invalidations = [];
  const { owner, state, events } = harness({}, {
    invalidateContextLayerVisualStateBatch: (...args) => invalidations.push(args),
  });
  const detail = pack("detail");
  state.zoomTransform = { k: 4 };
  state.styleConfig = { physical: { contourMinorVisible: false } };
  state.contextLayerExternalDataByName = { physical_contours_major: detail };
  state.physicalContourMajorData = pack("low");
  await owner.ensureContextLayerDataReady("physical-contours-set", { renderNow: false });
  assert.equal(state.physicalContourMajorData, detail);
  assert.equal(state.contextLayerRevision, 1);
  assert.deepEqual(invalidations, [[["physical_contours_major"], "context-layer:manual", { renderNow: false }]]);
  assert.deepEqual(events, []);
  await owner.ensureContextLayerDataReady("physical-contours-set", { renderNow: false });
  assert.equal(invalidations.length, 1, "same alias has no second invalidation");
});
