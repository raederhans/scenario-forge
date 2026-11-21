import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { normalizeMapLabel } from "../js/core/state/strategic_overlay_state.js";
import { getMapLabelHierarchy } from "../js/core/renderer/map_label_hierarchy.js";

function createHarness(overrides = {}, context = null, helpers = {}) {
  const state = {
    width: 800, height: 600, showCityPoints: true,
    worldCitiesData: { type: "FeatureCollection", features: [] },
    zoomTransform: { x: 0, y: 0, k: 2 },
    styleConfig: { cityPoints: {}, countryLabels: { enabled: false } },
    ...overrides,
  };
  let exporting = false;
  const renders = [];
  const metrics = [];
  const projection = ([x, y]) => [x, y];
  projection.stream = sink => sink;
  const runtime = createLabelsRuntime({
    runtimeState: state,
    rendererSurfaceHost: {
      getContext: () => context,
      getProjection: () => projection,
      getMapSvg: () => null,
      getPathCanvas: () => null,
    },
    TEXTURE_LABEL_SERIF_STACK: "serif",
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)),
    normalizeLongitude: value => value,
    getDisplayOwnerCode: () => "",
    resolveBorderIdentity: id => state.scenarioBaselineOwnersByFeatureId?.[id],
    getSignedHashUnit: () => 0,
    getLabelPaintBounds: () => null,
    getLabelPaintOverscanPx: () => 0,
    getFeatureCollectionFeatureCount: collection => collection?.features?.length || 0,
    isExportRenderInProgress: () => exporting,
    isPrivateSceneActive: () => true,
    invalidateRenderPasses: () => {},
    requestRendererRender: reason => renders.push(reason),
    nowMs: () => 0,
    collectContextMetric: (name, elapsed, detail) => metrics.push({ name, detail }),
    recordRenderPerfMetric: () => {},
    recordInteractionDurationMetric: () => {},
    drawPendingTransportLabels: () => {},
    drawPhysicalRegionLabels: () => {},
    ...helpers,
  });
  return { runtime, state, renders, metrics, setExporting: value => { exporting = value; } };
}

function replaceGlobal(t, name, value) {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  t.after(() => {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor);
    else delete globalThis[name];
  });
}

test("the automatic name and its inspector status follow edits and viewport placement", async t => {
  const ring = [[10, 10], [10, 70], [160, 70], [160, 10], [10, 10]];
  replaceGlobal(t, "topojson", { merge: () => ({ type: "Polygon", coordinates: [ring] }) });
  const { geoStream } = createRequire(import.meta.url)("../vendor/d3.v7.min.js");
  replaceGlobal(t, "d3", { geoStream });
  const painted = [];
  const ctx = { save() {}, restore() {}, translate() {}, rotate() {}, measureText: () => ({ width: 60 }),
    fillText: glyph => painted.push(glyph), strokeText() {} };
  const { state, runtime } = createHarness({
    activeScenarioId: "history", showCityPoints: false, currentLanguage: "en",
    scenarioBaselineOwnersByFeatureId: { one: "AAA" }, scenarioCountriesByTag: { AAA: { display_name_en: "Old" } },
    scenarioRuntimeTopologyData: { objects: { political: { type: "Polygon", id: "one", arcs: [[0]] } } },
    styleConfig: { countryLabels: { enabled: true } },
  }, ctx, { getAdmin0BackgroundFillColor: () => "#ffffff" });
  await runtime.prepareLabelsPass();
  for (const [overrides, expected] of [[{}, "OLD"], [{ AAA: { en: "New" } }, "NEW"], [{}, "OLD"]]) {
    state.countryNameOverrides = overrides;
    await runtime.prepareLabelsPass();
    painted.length = 0;
    runtime.drawLabelsPassContent(2);
    assert.equal(painted.join(""), expected);
    assert.equal(runtime.getCountryLabelStatus("AAA"), "Displayed");
  }
  state.zoomTransform.x = 900;
  runtime.drawLabelsPassContent(2);
  assert.equal(runtime.getCountryLabelStatus("AAA"), "Does not fit or is obscured in this view");
  state.styleConfig.countryLabels.enabled = false;
  assert.equal(runtime.getCountryLabelStatus("AAA"), "Country names are off");
});

test("only territorial coverage demotes the scenario capital marker and name", async t => {
  const ring = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
  replaceGlobal(t, "topojson", { merge: () => ({ type: "Polygon", coordinates: [ring] }) });
  replaceGlobal(t, "OffscreenCanvas", class {
    constructor(width, height) { this.width = width; this.height = height; }
    getContext() {
      return {
        scale() {}, save() {}, restore() {}, beginPath() {}, closePath() {}, fill() {}, stroke() {},
        moveTo() { }, lineTo: () => { this.shape = "star"; }, arc: () => { this.shape = "circle"; },
      };
    }
  });
  const labels = [], markers = [];
  const ctx = { save() {}, restore() {}, measureText: () => ({ width: 4 }),
    strokeText() {}, fillText(text) { labels.push([text, this.font]); },
    drawImage(canvas) { markers.push(canvas.shape); } };
  let owner = "AAA";
  const { runtime, state } = createHarness({
    activeScenarioId: "history", zoomTransform: { x: 0, y: 0, k: 12 },
    scenarioBaselineOwnersByFeatureId: { one: "AAA" }, sovereigntyByFeatureId: { one: "AAA" },
    scenarioCountriesByTag: { AAA: {} },
    scenarioRuntimeTopologyData: { objects: { political: { type: "Polygon", id: "one", arcs: [[0]] } } },
    worldCitiesData: { type: "FeatureCollection", features: [{ type: "Feature", id: "seat",
      properties: { name: "Seat", __city_country_code: "ZZ", __city_host_feature_id: "one",
        __city_id: "seat", __city_settlement_rank: "large" },
      geometry: { type: "Point", coordinates: [20, 20] } }] },
    styleConfig: { countryLabels: { enabled: true }, cityPoints: { showLabels: true } },
  }, ctx, { resolveBorderIdentity: () => owner, getResolvedFeatureColor: () => "#ffffff" });
  await runtime.prepareLabelsPass();
  state.mapLabels = [normalizeMapLabel({ lon: 0, lat: 0, countryCode: "AAA" }, "manual")];
  state.annotationView = { showMapLabels: false };
  assert.equal(runtime.getCountryLabelSuppressionSignature(), "");
  for (const [identity, shape, weight] of [
    ["AAA", "star", "600"], ["BBB", "circle", "400"], ["AAA", "star", "600"],
  ]) {
    owner = identity;
    runtime.notifyCountryLabelColorsChanged(["one"]);
    assert.equal(runtime.getCountryLabelStatus("AAA"), owner === "BBB"
      ? "Annexed (all regions painted in other countries’ colors)" : "Does not fit or is obscured in this view");
    labels.length = markers.length = 0;
    runtime.drawLabelsPassContent(12);
    assert.deepEqual(markers, [shape]);
    assert.deepEqual(labels.map(([name, font]) => [name, font.split(" ")[0]]), [["Seat", weight]]);
  }
});

test("manual titles bind parent countries, follow visibility, and repaint on font load alone", t => {
  let onFontLoad;
  replaceGlobal(t, "document", { fonts: { addEventListener: (_, callback) => { onFontLoad = callback; } } });
  replaceGlobal(t, "requestAnimationFrame", fn => fn());
  const calls = [];
  const ctx = { save() {}, restore() {}, translate() {}, rotate() {}, measureText: () => ({ width: 20 }),
    globalAlpha: 1, strokeText: text => calls.push(["stroke", text]), fillText: text => calls.push(["fill", text]) };
  const { runtime, state, renders } = createHarness({ showCityPoints: false, mapLabels: [],
    scenarioCountriesByTag: { X: {}, Y: { presentation: "parent_merged", parent_owner_tag: "X", display_name_en: "Child" } } }, ctx);
  runtime.drawLabelsPassContent(2);
  assert.deepEqual(calls, []);
  assert.equal(onFontLoad, undefined);
  const label = normalizeMapLabel({ countryCode: "Y", lon: 0, lat: 0, colorMode: "dark", fallbackName: "Saved" }, "map_label_1");
  state.mapLabels = [label];
  runtime.drawLabelsPassContent(2);
  assert.equal(runtime.getCountryLabelSuppressionSignature(), "X");
  assert.deepEqual(calls, [["stroke", "CHILD"], ["fill", "CHILD"]]);
  state.countryNameOverrides = { Y: { en: "New child" } };
  runtime.drawLabelsPassContent(2);
  assert.equal(calls.at(-1)[1], "NEW CHILD");
  state.countryNameOverrides = {};
  assert.equal(runtime.getPlacedMapLabels()[0].drawn, true);
  onFontLoad({ fontfaces: [{ family: "Map Garamond" }] });
  assert.ok(renders.includes("country-label-fonts"));
  state.scenarioCountriesByTag = {};
  runtime.drawLabelsPassContent(2);
  assert.equal(calls.at(-1)[1], "SAVED");
  assert.equal(runtime.getCountryLabelSuppressionSignature(), "Y");
  state.annotationView = { showMapLabels: false };
  const count = calls.length;
  runtime.drawLabelsPassContent(2);
  assert.equal(calls.length, count);
  assert.equal(runtime.getPlacedMapLabels()[0].drawn, false);
  state.mapLabels = [];
  assert.equal(runtime.getCountryLabelSuppressionSignature(), "");
  assert.deepEqual(runtime.getPlacedMapLabels(), []);
});

test("a bound country or merged child removes the parent from automatic label fitting", async t => {
  const ring = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
  replaceGlobal(t, "topojson", { merge: () => ({ type: "Polygon", coordinates: [ring] }) });
  const { runtime, state } = createHarness({
    activeScenarioId: "history", showCityPoints: false, styleConfig: { countryLabels: { enabled: true } },
    scenarioBaselineOwnersByFeatureId: { one: "AAA" },
    scenarioCountriesByTag: { AAA: {}, BBB: { presentation: "parent_merged", parent_owner_tag: "AAA" } },
    scenarioRuntimeTopologyData: { objects: { political: { type: "Polygon", id: "one", arcs: [[0]] } } },
  }, { save() {}, restore() {} });
  runtime.drawLabelsPassContent(2);
  await runtime.prepareLabelsPass();
  const pending = () => runtime.getCountryLabelReadiness().pendingFits;
  assert.equal(pending(), 1);
  for (const countryCode of ["AAA", "BBB"]) {
    state.mapLabels = [normalizeMapLabel({ lon: 0, lat: 0, countryCode }, "map_label_1")];
    assert.equal(pending(), 0);
    state.mapLabels = [];
    assert.equal(pending(), 1);
  }
});

test("label priority survives zoom oscillation and switches on monotonic boundary crossings", () => {
  const { runtime, state } = createHarness({
    styleConfig: { cityPoints: {}, countryLabels: { enabled: true } },
  });
  for (const [scales, expected] of [
    [[1, 2.85, 2.95, 3.05, 2.95, 3.05, 3.149], true],
    [[3.15, 4, 6, 3.05, 2.95, 3.05, 2.95, 2.851], false],
    [[2.85, 2.5, 1], true],
  ]) {
    for (const k of scales) {
      const hierarchy = runtime.drawLabelsPassContent(k);
      assert.equal(hierarchy.preferCountries, expected);
      assert.deepEqual(hierarchy, { ...getMapLabelHierarchy(k, state), preferCountries: expected });
      if (k < 2.85 || k > 3.15) {
        assert.deepEqual(hierarchy, getMapLabelHierarchy(k, state));
      }
    }
  }
});

test("runtime, scene and anchor cache resets restore direct zoom priority", () => {
  const { runtime, state } = createHarness({
    styleConfig: { cityPoints: {}, countryLabels: { enabled: true } },
  });
  for (const reset of [
    () => runtime.reset(),
    () => { state.activeScenarioId = "replacement"; },
    () => { state.sceneGeneration = 1; },
    () => runtime.resetCityAnchorCache(),
  ]) {
    assert.equal(runtime.drawLabelsPassContent(2).preferCountries, true);
    assert.equal(runtime.drawLabelsPassContent(3.05).preferCountries, true);
    reset();
    assert.equal(runtime.drawLabelsPassContent(3.05).preferCountries, false);
  }
  runtime.drawLabelsPassContent(4);
  assert.equal(runtime.drawLabelsPassContent(2.95).preferCountries, false);
  runtime.reset();
  assert.equal(runtime.drawLabelsPassContent(2.95).preferCountries, true);
});

test("interactive zoom crossings update the priority used by the next settled pass", () => {
  const { runtime } = createHarness({ styleConfig: { countryLabels: { enabled: true } } });
  runtime.drawLabelsPassContent(2);
  runtime.drawLabelsPassContent(4, { interactive: true });
  assert.equal(runtime.drawLabelsPassContent(2.95).preferCountries, false);
  runtime.drawLabelsPassContent(2, { interactive: true });
  assert.equal(runtime.drawLabelsPassContent(3.05).preferCountries, true);
});

test("creation and readiness observation leave owners, DOM and workers uninitialized", (t) => {
  const unexpected = () => assert.fail("initialization touched an external resource");
  replaceGlobal(t, "document", { get fonts() { return unexpected(); }, createElement: unexpected });
  replaceGlobal(t, "Worker", class { constructor() { unexpected(); } });
  const runtime = createLabelsRuntime({
    runtimeState: { styleConfig: { countryLabels: { enabled: true } } },
    rendererSurfaceHost: { getProjection: unexpected, getContext: unexpected },
  });
  assert.deepEqual(runtime.getCountryLabelReadiness(), {
    expected: true, ready: false, sourceStatus: "uninitialized",
  });
  assert.deepEqual(runtime.getVisibleMapLabels(), { cities: [], countries: [], pendingCountryFits: 0 });
  runtime.reset();
  assert.equal(runtime.getCountryLabelReadiness().sourceStatus, "uninitialized");
});

test("first use creates owners once and subsequent use retains them", (t) => {
  const subscriptions = [];
  replaceGlobal(t, "document", { fonts: {
    status: "loaded", addEventListener: (...args) => subscriptions.push(args),
  } });
  const { runtime } = createHarness({ showCityPoints: false,
    styleConfig: { countryLabels: { enabled: true } } });
  assert.equal(subscriptions.length, 0);
  const policy = runtime.getUrbanCityPolicyOwner();
  assert.equal(runtime.getUrbanCityPolicyOwner(), policy);
  runtime.drawLabelsPassContent(2);
  runtime.drawLabelsPassContent(2);
  assert.equal(subscriptions.length, 1);
  assert.equal(subscriptions[0][0], "loadingdone");
});

test("font loading events filter families and merge refreshes within a frame", (t) => {
  const frames = [];
  let loadingdone;
  replaceGlobal(t, "requestAnimationFrame", callback => frames.push(callback));
  replaceGlobal(t, "document", { fonts: {
    status: "loading", ready: Promise.resolve(),
    addEventListener: (name, callback) => { loadingdone = callback; },
  } });
  const { runtime, renders } = createHarness({ showCityPoints: false,
    styleConfig: { countryLabels: { enabled: true } } });
  runtime.drawLabelsPassContent(2);
  const refreshCount = () => renders.filter(reason => reason === "country-label-fonts").length;
  loadingdone({ fontfaces: [{ family: "Interface Sans" }] });
  frames.shift()();
  assert.equal(refreshCount(), 0);
  loadingdone({ fontfaces: [{ family: '"Map Garamond"' }] });
  loadingdone({ fontfaces: [{ family: "Map Noto Serif SC" }] });
  assert.equal(frames.length, 1);
  assert.equal(refreshCount(), 0);
  frames.shift()();
  assert.equal(refreshCount(), 1);
  loadingdone({ fontfaces: [] });
  frames.shift()();
  assert.equal(refreshCount(), 1);
  loadingdone({ fontfaces: [{ family: "Interface Sans" }] });
  loadingdone({});
  loadingdone({ fontfaces: [{ family: "Interface Sans" }] });
  assert.equal(frames.length, 1);
  frames.shift()();
  assert.equal(refreshCount(), 2);
});

test("reset cancels old city preparation after scene and data replacement", async () => {
  const { runtime, state, renders, metrics } = createHarness({
    worldCitiesData: { type: "FeatureCollection", features: [{ type: "Feature", id: "first",
      properties: { name: "First", __city_id: "first" },
      geometry: { type: "Point", coordinates: [100, 100] } }] },
  });
  assert.equal(await runtime.prepareCityPointsPass(), true);
  const published = runtime.getCachedEffectiveCityCollection();
  state.worldCitiesData = { type: "FeatureCollection", features: [] };
  state.activeScenarioId = "replacement";
  state.sceneGeneration = 1;
  const pending = runtime.prepareCityPointsPass();
  assert.ok(pending instanceof Promise);
  runtime.reset();
  assert.equal(await pending, false);
  runtime.drawCityPointsLayer(2);
  assert.equal(metrics.at(-1).detail.reason, "preparing");
  assert.equal(runtime.getCachedEffectiveCityCollection(), published);
  assert.equal(renders.filter(reason => reason === "city-plan-prepared").length, 1);
  assert.equal(await runtime.prepareCityPointsPass(), true);
  assert.notEqual(runtime.getCachedEffectiveCityCollection(), published);
  runtime.drawCityPointsLayer(2);
  assert.equal(metrics.at(-1).detail.reason, "no-data");
});

test("export mode is read at each preparation and during pending work", async () => {
  const { runtime, state, setExporting } = createHarness();
  setExporting(true);
  assert.equal(runtime.prepareLabelsPass(), null);
  assert.equal(runtime.getCachedEffectiveCityCollection(), null);
  setExporting(false);
  assert.equal(await runtime.prepareCityPointsPass(), true);
  state.cityLayerRevision = 1;
  const pending = runtime.prepareCityPointsPass();
  setExporting(true);
  assert.equal(await pending, false);
  assert.equal(runtime.prepareLabelsPass(), null);
  setExporting(false);
  assert.equal(await runtime.prepareCityPointsPass(), true);
});

test("country readiness rejects the old source after topology replacement and reset", async (t) => {
  replaceGlobal(t, "topojson", { merge: () => ({ type: "MultiPolygon", coordinates: [] }) });
  const topology = () => ({ objects: { political: { type: "GeometryCollection", geometries: [] } } });
  const { runtime, state } = createHarness({ showCityPoints: false,
    topology: topology(), styleConfig: { countryLabels: { enabled: true } } }, { save() {}, restore() {} });
  await runtime.prepareLabelsPass();
  runtime.drawLabelsPassContent(2);
  assert.equal(runtime.getCountryLabelReadiness().ready, true);
  state.topology = topology();
  state.sceneGeneration = 1;
  runtime.reset();
  assert.deepEqual(runtime.getCountryLabelReadiness(), {
    expected: true, ready: false, sourceStatus: "pending",
  });
  await runtime.prepareLabelsPass();
  runtime.drawLabelsPassContent(2);
  assert.equal(runtime.getCountryLabelReadiness().ready, true);
});
