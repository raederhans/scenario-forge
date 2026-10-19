import { resolveContourLodRequest } from "../js/core/renderer/physical_contour_lod_policy.js";
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { prepareScenarioLocalizationState } from "../js/core/scenario_localization_state.js";
import { buildCityLocalizationPatchSteps } from "../js/core/data_loader.js";
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
    prepareScenarioLocalizationState: async (...args) => {
      const candidate = await prepareScenarioLocalizationState(...args);
      if (candidate) events.push("sync-localization");
      return candidate;
    },
    syncCountryUi: () => events.push("country-ui"),
    ensureActiveScenarioOptionalLayersForVisibility: async () => {},
    emitStateBusEvent: () => events.push("ui-event"),
    STATE_BUS_EVENTS: {},
    buildCityLocalizationPatchSteps,
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

for (const { label, startupResult, expectedOverride } of [
  { label: "startup bundle", startupResult: { ok: true, startupBootArtifactsOverride: { topologyPrimary: "bundled" } }, expectedOverride: { topologyPrimary: "bundled" } },
  { label: "no default scenario", startupResult: { ok: true, skipped: true }, expectedOverride: undefined },
  { label: "failed startup bundle", startupResult: { ok: false, error: new Error("bundle failed") }, expectedOverride: null },
]) {
  test(`base resource loading begins before ${label} settles and keeps its fallback selection`, async () => {
    const bundle = deferred();
    const events = [];
    const { owner } = harness({
      SCENARIO_STARTUP_LOCALES_FILENAME: "locales.startup.json",
      SCENARIO_STARTUP_GEO_ALIASES_FILENAME: "geo_aliases.startup.json",
      getStartupScenarioSupportUrl: (scenarioId, filename) => scenarioId ? `${scenarioId}/${filename}` : "",
      loadMapData: async ({ startupBootArtifactsOverride, ...options }) => {
        events.push("independent-resources-started");
        assert.equal(options.includeCityData, false);
        assert.deepEqual(options.includeContextLayers, ["urban", "lakes"]);
        const override = await startupBootArtifactsOverride;
        events.push("bundle-selection-ready");
        return { override };
      },
    });
    const pending = owner.loadStartupBaseData({
      d3Client: { json() {} },
      startupFallbackScenarioId: label === "no default scenario" ? "" : "sample",
      startupBundleResultPromise: bundle.promise,
    });
    assert.deepEqual(events, ["independent-resources-started"]);
    bundle.resolve(startupResult);
    assert.deepEqual(await pending, { override: expectedOverride });
    assert.deepEqual(events, ["independent-resources-started", "bundle-selection-ready"]);
  });
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
    assert.deepEqual(events, resource === "localization"
      ? ["sync-localization", "country-ui", "ui-event", "render"]
      : ["sync-localization", "ui-event", "render"]);
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

test("night-light geometry skips localization; a concurrent labels caller upgrades once using the same cities", async () => {
  const load = deferred();
  const requests = [];
  const cities = { features: [{ properties: { population: 120000 } }] };
  const { owner, state, events } = harness({ loadCitySupportData: (options) => {
    requests.push(options);
    return options.includeLocalization ? Promise.resolve({ worldCities: options.cityCollection, localizationReady: true }) : load.promise;
  } });
  const geo = owner.ensureBaseCityDataReady({ includeLocalization: false, renderNow: false });
  const labels = owner.ensureBaseCityDataReady({ renderNow: false });
  load.resolve({ worldCities: cities, localizationReady: false });
  assert.equal(await geo, cities);
  assert.equal(await labels, cities);
  assert.deepEqual(requests.map((request) => request.includeLocalization), [false, true]);
  assert.equal(requests[1].cityCollection, cities);
  assert.equal(state.cityLayerRevision, 2);
  assert.equal(state.baseCityLocalizationReady, true);
  assert.equal(events.filter((event) => event === "sync-localization").length, 1);
  await owner.ensureBaseCityDataReady({ renderNow: false });
  assert.equal(requests.length, 2);
});

test("post-boot hydration loads visible scenario names before reporting readiness", async () => {
  const calls = [];
  const bundle = { bundleLevel: "full" };
  const { owner, state } = harness({
    loadScenarioBundle: async () => bundle,
    hydrateActiveScenarioBundle: () => calls.push("hydrate"),
    ensureActiveScenarioOptionalLayersForVisibility: async (options) => {
      assert.equal(options.bundle, bundle);
      assert.equal(options.scenarioApplyRequestId, state.currentScenarioApplyRequestId);
      assert.equal(options.isScenarioApplyRequestCurrent(), true);
      calls.push("visible-names");
    },
    enforceScenarioHydrationHealthGate: async () => { calls.push("ready"); return { ok: true }; },
  });
  await owner.ensureActiveScenarioBundleHydrated();
  assert.deepEqual(calls, ["hydrate", "visible-names", "ready"]);
});

test("scenario switch during optional name loading cannot complete the older hydration", async () => {
  const optional = deferred();
  let healthChecks = 0;
  const { owner, state } = harness({
    loadScenarioBundle: async () => ({ bundleLevel: "full" }),
    hydrateActiveScenarioBundle: () => {},
    ensureActiveScenarioOptionalLayersForVisibility: () => optional.promise,
    enforceScenarioHydrationHealthGate: async () => { healthChecks++; return { ok: true }; },
  });
  const pending = owner.ensureActiveScenarioBundleHydrated();
  await Promise.resolve();
  state.activeScenarioId = "B";
  optional.resolve();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(healthChecks, 0);
});

test("geometry load preserves localization objects and a failed label upgrade can retry", async () => {
  let fail = true;
  const cities = { features: [] };
  const { owner, state, events } = harness({ loadCitySupportData: async (options) => {
    if (options.includeLocalization && fail) throw new Error("aliases unavailable");
    return { worldCities: options.cityCollection || cities, localizationReady: options.includeLocalization };
  } });
  const locales = state.locales;
  await owner.ensureBaseCityDataReady({ includeLocalization: false, renderNow: false });
  assert.equal(state.locales, locales);
  assert.equal(state.baseCityLocalizationReady, false);
  assert.ok(!events.includes("sync-localization"));
  await assert.rejects(owner.ensureBaseCityDataReady(), /aliases unavailable/);
  assert.equal(state.worldCitiesData, cities);
  fail = false;
  await owner.ensureBaseCityDataReady({ renderNow: false });
  assert.equal(state.baseCityLocalizationReady, true);
});

test("a cancelled labels receiver cannot trigger an upgrade after a shared geometry fetch", async () => {
  const load = deferred();
  let requests = 0;
  const { owner, state } = harness({ loadCitySupportData: () => { requests += 1; return load.promise; } });
  const geo = owner.ensureBaseCityDataReady({ includeLocalization: false });
  const controller = new AbortController();
  const labels = owner.ensureBaseCityDataReady({ signal: controller.signal });
  controller.abort();
  load.resolve({ worldCities: { features: [] }, localizationReady: false });
  await geo;
  await assert.rejects(labels, { name: "AbortError" });
  assert.equal(requests, 1);
  assert.equal(state.baseCityLocalizationReady, false);
});

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


test("full localization stays private across preparation and publishes base and scenario dictionaries together", async () => {
  const first = deferred();
  const second = deferred();
  let yields = 0;
  const payload = { locales: { ui: { ready: "Ready" }, geo: { BASE: { en: "Base", zh: "基础" } } },
    geoAliases: { alias_to_stable_key: { base: "BASE" } } };
  const { owner, state } = harness({ loadLocalizationData: async () => payload }, {
    yieldToMain: async () => { yields++; await (yields === 1 ? first.promise : second.promise); },
  });
  const oldLocales = state.locales;
  state.locales.geo.OLD = { en: "Startup fallback" };
  state.baseGeoLocales = { OLD: state.locales.geo.OLD };
  const oldBase = state.baseGeoLocales;
  state.scenarioGeoLocalePatchData = { geo: { BASE: { en: "Scenario", zh: "场景" } } };
  const pending = owner.ensureFullLocalizationDataReady({ renderNow: false });
  await new Promise(setImmediate);
  assert.equal(yields, 1);
  assert.equal(state.locales, oldLocales);
  assert.equal(state.baseGeoLocales, oldBase);
  first.resolve();
  await new Promise(setImmediate);
  assert.equal(yields, 2);
  assert.equal(state.locales, oldLocales, "base preparation cannot expose half of the final dictionaries");
  assert.equal(state.baseGeoLocales, oldBase);
  second.resolve();
  await pending;
  assert.deepEqual(state.baseGeoLocales, payload.locales.geo);
  assert.deepEqual(state.locales.geo, { BASE: { en: "Scenario", zh: "场景" } });
  assert.deepEqual(state.geoAliasToStableKey, { base: "BASE" });
  assert.equal(state.baseLocalizationDataState, "loaded");
});

for (const change of ["scenario ABA", "import epoch", "edit revision"]) {
  test(`full localization discards a prepared candidate after ${change} and preserves the current edit`, async () => {
    let yields = 0;
    const { owner, state } = harness({
      loadLocalizationData: async () => ({ locales: { ui: {}, geo: { BASE: { en: "Base" } } } }),
    }, { yieldToMain: async () => {
      if (++yields !== 2) return;
      if (change === "scenario ABA") {
        state.activeScenarioId = "B";
        state.currentScenarioApplyRequestId++;
        state.activeScenarioId = "A";
        state.currentScenarioApplyRequestId++;
      } else if (change === "import epoch") {
        state.renderTransactionDiagnostics = { scenarioApplyEpoch: 1 };
      } else {
        state.cityLayerRevision = 1;
      }
      state.scenarioGeoLocalePatchData.geo.BASE = { en: "Current edit", zh: "当前编辑" };
    } });
    state.scenarioGeoLocalePatchData = { geo: { BASE: { en: "Old scenario" } } };
    await owner.ensureFullLocalizationDataReady({ renderNow: false });
    assert.ok(yields >= 4, "the stale candidate must be rebuilt in new tasks");
    assert.deepEqual(state.locales.geo.BASE, { en: "Current edit", zh: "当前编辑" });
    assert.deepEqual(state.baseGeoLocales.BASE, { en: "Base" });
  });
}

test("cancelling full localization during preparation keeps startup dictionaries and publishes no UI events", async () => {
  const controller = new AbortController();
  const { owner, state, events } = harness({
    loadLocalizationData: async () => ({ locales: { ui: { ready: "New" }, geo: { BASE: { en: "Base" } } } }),
  }, { yieldToMain: async () => { controller.abort(); } });
  const locales = state.locales;
  state.locales.geo.OLD = { zh: "旧字典仍可用" };
  state.baseGeoLocales = { OLD: state.locales.geo.OLD };
  const base = state.baseGeoLocales;
  assert.equal(await owner.ensureFullLocalizationDataReady({ signal: controller.signal }), null);
  assert.equal(state.locales, locales);
  assert.equal(state.baseGeoLocales, base);
  assert.equal(state.locales.geo.OLD.zh, "旧字典仍可用");
  assert.equal(state.baseLocalizationDataPromise, null);
  assert.deepEqual(events, []);
});


test("full localization without a scenario preserves existing UI fallback and independent base dictionaries", async () => {
  const { owner, state } = harness({ loadLocalizationData: async () => ({
    locales: { geo: { BASE: { en: "Base", zh: "基础" } } },
    geoAliases: { alias_to_stable_key: { fallback: "BASE" } },
  }) }, { yieldToMain: async () => {} });
  state.activeScenarioId = "";
  state.locales.ui = { fallback: "Existing UI fallback" };
  state.currentLanguage = "zh";
  await owner.ensureFullLocalizationDataReady({ renderNow: false });
  assert.deepEqual(state.locales.ui, { fallback: "Existing UI fallback" });
  assert.deepEqual(state.locales.geo, state.baseGeoLocales);
  assert.notEqual(state.locales.geo, state.baseGeoLocales);
  assert.deepEqual(state.geoAliasToStableKey, state.baseGeoAliasToStableKey);
  assert.notEqual(state.geoAliasToStableKey, state.baseGeoAliasToStableKey);
  assert.equal(state.currentLanguage, "zh");
  assert.equal(state.cityLayerRevision, undefined);
});

test("city support publishes geometry, base and scenario dictionaries together after private preparation", async () => {
  const held = deferred();
  let yields = 0;
  const cities = { features: [] };
  const { owner, state } = harness({ loadCitySupportData: async (options) => {
    assert.equal(options.deferLocalization, true);
    return { worldCities: cities, cityAliases: { geo: { CITY: { en: "Base city", zh: "基础城市" } },
      alias_to_stable_key: { City: "CITY" } }, localizationReady: true, localizationDeferred: true };
  } }, { yieldToMain: async () => { if (++yields === 1) await held.promise; } });
  state.baseGeoLocales = { OLD: { en: "Old" } };
  state.baseGeoAliasToStableKey = { old: "OLD" };
  state.scenarioGeoLocalePatchData = { geo: { CITY: { en: "Scenario city", zh: "场景城市" } } };
  const original = { locales: state.locales, base: state.baseGeoLocales, aliases: state.baseGeoAliasToStableKey };
  const pending = owner.ensureBaseCityDataReady({ renderNow: false });
  await new Promise(setImmediate);
  assert.equal(state.worldCitiesData, undefined);
  assert.equal(state.locales, original.locales);
  assert.equal(state.baseGeoLocales, original.base);
  assert.equal(state.baseGeoAliasToStableKey, original.aliases);
  assert.equal(state.baseCityLocalizationReady, undefined);
  held.resolve();
  await pending;
  assert.equal(state.worldCitiesData, cities);
  assert.deepEqual(state.baseGeoLocales.CITY, { en: "Base city", zh: "基础城市" });
  assert.deepEqual(state.locales.geo.CITY, { en: "Scenario city", zh: "场景城市" });
  assert.deepEqual(state.geoAliasToStableKey, { old: "OLD", City: "CITY" });
  assert.equal(state.baseCityLocalizationReady, true);
  assert.ok(yields >= 3);
});

for (const change of ["scenario ABA", "import epoch", "city edit", "full localization"]) {
  test(`city preparation rebases after ${change} without losing the current dictionaries`, async () => {
    let yields = 0;
    const { owner, state } = harness({ loadCitySupportData: async () => ({ worldCities: { features: [] },
      cityAliases: { geo: { CITY: { en: "Base city" } } }, localizationReady: true, localizationDeferred: true,
      locales: { geo: { STALE: { en: "Old base captured before IO" } } },
      geoAliases: { alias_to_stable_key: { stale: "STALE" } },
    }) }, {
      yieldToMain: async () => {
        if (++yields !== 2) return;
        if (change === "scenario ABA") {
          state.activeScenarioId = "B"; state.currentScenarioApplyRequestId++;
          state.activeScenarioId = "A"; state.currentScenarioApplyRequestId++;
        } else if (change === "import epoch") state.renderTransactionDiagnostics = { scenarioApplyEpoch: 1 };
        else if (change === "city edit") state.cityLayerRevision = 1;
        else {
          state.baseGeoLocales = { FULL: { en: "Full dictionary" } };
          state.baseGeoAliasToStableKey = { full: "FULL" };
          state.locales = { ui: { full: "UI" }, geo: state.baseGeoLocales };
        }
        state.scenarioGeoLocalePatchData.geo.CITY = { en: "Current scenario edit" };
      },
    });
    state.scenarioGeoLocalePatchData = { geo: { CITY: { en: "Stale scenario" } } };
    await owner.ensureBaseCityDataReady({ renderNow: false });
    assert.ok(yields >= 5, "a changed snapshot must restart private preparation");
    assert.deepEqual(state.locales.geo.CITY, { en: "Current scenario edit" });
    assert.deepEqual(state.baseGeoLocales.CITY, { en: "Base city", zh: "Base city" });
    if (change === "full localization") {
      assert.deepEqual(state.baseGeoLocales.FULL, { en: "Full dictionary" });
      assert.equal(state.geoAliasToStableKey.full, "FULL");
      assert.equal(state.locales.ui.full, "UI");
      assert.equal(state.baseGeoLocales.STALE, undefined);
      assert.equal(state.geoAliasToStableKey.stale, undefined);
    }
  });
}

test("cancelled city dictionary preparation publishes nothing and a later request retries", async () => {
  let loads = 0, clock = 0, yields = 0;
  const controller = new AbortController();
  const aliases = Object.fromEntries(Array.from({ length: 2048 }, (_, index) => [`alias-${index}`, `CITY-${index}`]));
  const { owner, state, events } = harness({
    loadCitySupportData: async () => { loads++; return { worldCities: { features: [] }, cityAliases: { alias_to_stable_key: aliases }, localizationReady: true }; },
    prepareLocalizationCandidate: (iterator, options) => contentActions.prepareLocalizationCandidate(iterator, {
      ...options, nowMs: () => ++clock, sliceBudgetMs: 1,
    }),
  }, { yieldToMain: async () => { if (++yields === 2) controller.abort(); } });
  const originalLocales = state.locales;
  assert.equal(await owner.ensureBaseCityDataReady({ signal: controller.signal }), null);
  assert.equal(state.locales, originalLocales);
  assert.equal(state.worldCitiesData, undefined);
  assert.equal(state.baseGeoLocales, undefined);
  assert.equal(state.baseCityDataPromise, null);
  assert.deepEqual(events, []);
  await owner.ensureBaseCityDataReady({ renderNow: false });
  assert.equal(loads, 2);
  assert.equal(state.geoAliasToStableKey["alias-2047"], "CITY-2047");
  assert.equal(state.baseCityDataState, "loaded");
});

test("failed city patch preparation keeps the previous publication and can retry", async () => {
  let fail = true;
  const aliases = { get broken() { if (fail) throw new Error("city patch invalid"); return "CITY"; } };
  const { owner, state } = harness({ loadCitySupportData: async () => ({ worldCities: { features: [] },
    cityAliases: { alias_to_stable_key: aliases }, localizationReady: true }) }, { yieldToMain: async () => {} });
  const original = state.locales;
  await assert.rejects(owner.ensureBaseCityDataReady(), /city patch invalid/);
  assert.equal(state.worldCitiesData, undefined);
  assert.equal(state.locales, original);
  assert.equal(state.baseCityDataState, "error");
  assert.equal(state.baseCityDataPromise, null);
  fail = false;
  await owner.ensureBaseCityDataReady({ renderNow: false });
  assert.equal(state.geoAliasToStableKey.broken, "CITY");
  assert.equal(state.baseCityDataState, "loaded");
});

test("replacing the city load promise discards its private candidate and preserves the new owner", async () => {
  const replacement = Promise.resolve("replacement");
  const { owner, state, events } = harness({ loadCitySupportData: async () => ({ worldCities: { features: [] }, localizationReady: true }) }, {
    yieldToMain: async () => { state.baseCityDataPromise = replacement; },
  });
  assert.equal(await owner.ensureBaseCityDataReady(), null);
  assert.equal(state.baseCityDataPromise, replacement);
  assert.equal(state.baseCityDataState, "loading");
  assert.equal(state.worldCitiesData, undefined);
  assert.deepEqual(events, []);
});
