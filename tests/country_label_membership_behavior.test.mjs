import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { createLabelsRuntime } from "../js/core/map_renderer/labels_runtime.js";
import { createCountryLabelSourceOwner } from "../js/core/renderer/country_label_source.js";
import { createCountryLabelRenderOwner } from "../js/core/renderer/country_label_render_owner.js";
import { fitCountryLabel } from "../js/core/renderer/country_label_layout.js";
import { createPaintContourAssembly } from "../js/core/renderer/paint_contour_assembly.js";

const require = createRequire(import.meta.url);
const topojson = require("../vendor/topojson-client.min.js");
const { geoArea, geoContains, geoStream } = require("../vendor/d3.v7.min.js");
const eastPoint = [50, 25];

function fixture(t, options = {}, overrides = {}) {
  const ids = ["west", "east", "bay", "island"];
  const owners = { west: "AAA", east: "AAA", bay: "BBB", island: "CCC" };
  const topology = { type: "Topology", objects: { political: { type: "GeometryCollection",
    geometries: ids.map((id, i) => ({ id, type: "Polygon", arcs: [[i]], properties: { cntr_code: owners[id] } })) } },
    arcs: ids.map((_, i) => {
      const x = 5 + i * 35;
      return [[x, 10], [x, 45], [x + 30, 45], [x + 30, 10], [x, 10]];
    }) };
  const state = { activeScenarioId: "history", scenarioBaselineOwnersByFeatureId: owners,
    scenarioCountriesByTag: { AAA: {}, BBB: {}, CCC: {} }, visualOverrides: {}, colorRevision: 0,
    sovereignBaseColors: { AAA: "#110000", BBB: "#220000", CCC: "#330000" },
    scenarioRuntimeTopologyData: topology, topologyPrimary: topology, ...overrides };
  const { resolveBorderIdentity } = createPaintContourAssembly({ runtimeState: state,
    canonicalCountryCode: code => code, getDisplayOwnerCode: (_, id) => owners[id] });
  const { getCountryName } = createLabelsRuntime({ runtimeState: state, rendererSurfaceHost: {} });
  const source = createCountryLabelSourceOwner({ state, topojson, geoArea, geoContains, resolveBorderIdentity,
    getCountryName, yieldTask: () => Promise.resolve(), ...options });
  t.after(() => source.dispose());
  const eastLabels = () => source.peekSource().countries.filter(record => geoContains(record.geometry, eastPoint))
    .map(record => record.countryCode);
  return { state, source, eastLabels, resolveBorderIdentity };
}

test("repainting moves the parcel between label geometries and only refits the affected countries", async t => {
  const metrics = [];
  const { state, source, eastLabels } = fixture(t, {
    recordRenderPerfMetric: (name, elapsed, detail) => metrics.push({ name, elapsed, detail }),
  });
  const fits = [];
  const projection = { stream: sink => sink };
  const renderer = createCountryLabelRenderOwner({ state, getters: { getCountryLabelSource: source.getSource,
    getProjection: () => projection, getProjectionIdentity: () => 1, getViewportSize: () => ({ width: 300, height: 150 }),
    getContext: () => ({ save() {}, restore() {}, translate() {}, rotate() {}, strokeText() {}, fillText() {},
      measureText: () => ({ width: 30 }) }) },
    helpers: { geoStream, fitCountryLabel: (candidates, options) => {
      fits.push(options.glyphs.map(glyph => glyph.text).join(""));
      return fitCountryLabel(candidates, options);
    } } });
  await source.prepare();
  assert.deepEqual(eastLabels(), ["AAA"]);
  const island = source.getSource().countries.find(r => r.countryCode === "CCC");
  renderer.drawCountryLabels(1);
  assert.deepEqual(fits.sort(), ["AAA", "BBB", "CCC"]);
  fits.length = 0;
  state.visualOverrides = { east: state.sovereignBaseColors.BBB };
  await source.prepare();
  assert.deepEqual(eastLabels(), ["BBB"]);
  assert.equal(source.getSource().countries.find(r => r.countryCode === "CCC"), island);
  renderer.drawCountryLabels(1);
  assert.deepEqual(fits.sort(), ["AAA", "BBB"]);
  assert.deepEqual(metrics.find(m => m.name === "countryLabelMembershipBuild").detail,
    { changedCountryCount: 2, memberCount: 3 });
  assert.ok(metrics.some(m => m.name === "countryLabelMembershipScan" && m.elapsed >= 0));
});

test("an unregistered color stays inside its old label until the project country is registered", async t => {
  const { state, source, eastLabels } = fixture(t);
  await source.prepare();
  const before = source.getSource();
  const beforeRegistry = state.scenarioCountriesByTag;
  state.visualOverrides = { east: "#e31ac4" };
  await source.prepare();
  assert.equal(source.getSource().countries, before.countries);
  state.scenarioCountriesByTag = { ...state.scenarioCountriesByTag,
    NEW: { project_country: true, feature_count: 0, display_name_en: "New country", display_name_zh: "New country" } };
  state.sovereignBaseColors = { ...state.sovereignBaseColors, NEW: "#e31ac4" };
  state.colorRevision++;
  await source.prepare();
  assert.deepEqual(eastLabels(), ["NEW"]);
  assert.equal(source.getSource().countries.find(r => r.countryCode === "NEW").name, "New country");
  state.scenarioCountriesByTag = beforeRegistry;
  await source.prepare();
  assert.deepEqual(eastLabels(), ["AAA"]);
  assert.ok(!source.getSource().countries.some(r => r.countryCode === "NEW"));
});

test("a subject's territory and land painted in its color both use the parent label", async t => {
  const { source, state, eastLabels } = fixture(t);
  state.scenarioCountriesByTag.SUB = { presentation: "parent_merged", parent_owner_tag: "BBB" };
  state.sovereignBaseColors.SUB = state.sovereignBaseColors.BBB;
  state.scenarioBaselineOwnersByFeatureId.bay = "SUB";
  state.visualOverrides = { bay: state.sovereignBaseColors.SUB };
  await source.prepare();
  const before = source.getSource();
  assert.deepEqual(before.countries.map(r => r.countryCode), ["AAA", "BBB", "CCC"]);
  state.sovereignBaseColors = { ...state.sovereignBaseColors, SUB: "#220001" };
  state.visualOverrides = { east: "#220001", bay: "#220001" };
  await source.prepare();
  assert.deepEqual(eastLabels(), ["BBB"]);
  assert.ok(!source.getSource().countries.some(r => r.countryCode === "SUB"));
});

test("base geography ignores registered colors", async t => {
  const { source, eastLabels } = fixture(t, {}, { activeScenarioId: "", visualOverrides: { east: "#220000" } });
  await source.prepare();
  assert.deepEqual(eastLabels(), ["AAA"]);
});

test("the first scenario build includes saved paint and restores an annexed country on undo", async t => {
  const { state, source, eastLabels } = fixture(t, { isMembershipEditSettled: () => false },
    { visualOverrides: { west: "#220000", east: "#220000" } });
  await source.prepare();
  assert.deepEqual(source.getSource().countries.map(r => r.countryCode), ["BBB", "CCC"]);
  assert.deepEqual(eastLabels(), ["BBB"]);
  state.visualOverrides = {};
  await source.prepare();
  assert.deepEqual(eastLabels(), ["AAA"]);
});

function clock() {
  let now = 0, timer;
  return {
    nowMs: () => now,
    setTimeout(fn, delay) { assert.ok(!timer); return timer = { at: now + delay, fn }; },
    clearTimeout(id) { assert.equal(id, timer); timer = null; },
    tick(until) {
      while (timer && timer.at <= until) {
        const { at, fn } = timer;
        now = at; timer = null; fn();
      }
      now = until;
    },
  };
}

for (const force of [false, true]) {
  test(force ? "continuous editing forces a build at two seconds" : "a quiet edit publishes without another frame", async t => {
    const scheduler = clock();
    let settled = false, changes = 0;
    const { source, state, eastLabels } = fixture(t, { nowMs: scheduler.nowMs, membershipScheduler: scheduler,
      isMembershipEditSettled: () => settled, onChange: () => changes++ });
    await source.prepare();
    const revision = source.getSource().revision;
    state.visualOverrides = { east: "#220000" };
    await source.prepare();
    assert.equal(source.getSource().membershipPending, false);
    scheduler.tick(force ? 1900 : 200);
    state.visualOverrides = { east: "#330000" };
    await source.prepare();
    settled = !force;
    const due = force ? 2000 : 450;
    scheduler.tick(due - 1);
    assert.equal(source.peekSource().revision, revision);
    assert.equal(source.peekSource().membershipPending, false);
    scheduler.tick(due);
    assert.equal(source.peekSource().membershipPending, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(eastLabels(), ["CCC"]);
    assert.equal(source.peekSource().revision, revision + 1);
    assert.equal(source.peekSource().membershipPending, false);
    assert.ok(changes > 1);
    state.visualOverrides = {};
    await source.prepare();
    source.dispose();
    const atDisposal = changes;
    scheduler.tick(due + 2000);
    assert.equal(changes, atDisposal);
  });
}

test("undo during the quiet period leaves the published source ready", async t => {
  const scheduler = clock();
  const { source, state } = fixture(t, { nowMs: scheduler.nowMs, membershipScheduler: scheduler,
    isMembershipEditSettled: () => true });
  await source.prepare();
  const before = source.getSource();
  state.visualOverrides = { east: "#220000" };
  await source.prepare();
  state.visualOverrides = {};
  await source.prepare();
  scheduler.tick(2000);
  assert.deepEqual(source.getSource(), before);
});

test("successive edits finish the running build before starting the latest snapshot", async t => {
  let hold = false;
  const waiting = [], publications = [];
  const { state, source, eastLabels } = fixture(t, {
    yieldTask: () => hold ? new Promise(resolve => waiting.push(resolve)) : Promise.resolve(),
    onChange: () => publications.push(eastLabels()),
  });
  await source.prepare();
  hold = true;
  state.visualOverrides = { east: "#220000" };
  const building = source.prepare();
  for (const color of ["#110000", "#330000"]) {
    state.visualOverrides.east = color;
    state.colorRevision++;
    assert.equal(source.getSource().membershipPending, true);
  }
  assert.equal(waiting.length, 1);
  hold = false; waiting[0]();
  await building;
  assert.deepEqual(publications, [["AAA"], ["BBB"], ["CCC"]]);
  assert.equal(source.getSource().membershipPending, false);
});

test("renderer readiness waits for a running membership build after the quiet period", async t => {
  const { state, resolveBorderIdentity } = fixture(t);
  state.mapLabels = Object.keys(state.scenarioCountriesByTag).map(countryCode => ({ countryCode }));
  const saved = globalThis.topojson;
  globalThis.topojson = topojson;
  t.after(() => { if (saved === undefined) delete globalThis.topojson; else globalThis.topojson = saved; });
  let now = 0, settled = false, onPublication;
  const runtime = createLabelsRuntime({ runtimeState: state, resolveBorderIdentity, nowMs: () => now,
    isMembershipEditSettled: () => settled, isExportRenderInProgress: () => false, isPrivateSceneActive: () => true,
    rendererSurfaceHost: { getContext: () => null, getProjection: () => null },
    invalidateRenderPasses() {}, requestRendererRender: () => onPublication?.() });
  await runtime.prepareLabelsPass();
  await runtime.prepareLabelsPass();
  assert.equal(runtime.getCountryLabelReadiness().ready, true);
  state.visualOverrides = { east: "#220000" };
  await runtime.prepareLabelsPass();
  assert.equal(runtime.getCountryLabelReadiness().ready, true);
  const published = new Promise(resolve => { onPublication = resolve; });
  now = 250; settled = true;
  assert.equal(runtime.getCountryLabelReadiness().ready, false);
  runtime.prepareLabelsPass();
  assert.equal(runtime.getCountryLabelReadiness().ready, false);
  await published;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(runtime.getCountryLabelReadiness().ready, true);
});

test("a failed incremental build keeps the published labels and retries only a changed assignment", async t => {
  let fail = false, attempts = 0;
  const { state, source, eastLabels } = fixture(t, { topojson: { merge(...args) {
    attempts++;
    if (fail) throw new Error("membership merge failed");
    return topojson.merge(...args);
  } } });
  await source.prepare();
  const before = source.getSource();
  fail = true;
  state.visualOverrides = { east: "#220000" };
  await source.prepare();
  const failed = source.getSource();
  assert.equal(failed.status, "ready");
  assert.equal(failed.countries, before.countries);
  assert.equal(failed.revision, before.revision);
  assert.equal(failed.membershipError, "membership merge failed");
  assert.ok(Number.isInteger(failed.failedAssignmentRevision));
  assert.equal(failed.membershipPending, false);
  const afterFailure = attempts;
  state.visualOverrides = { ...state.visualOverrides, missing: "#220000" };
  state.colorRevision++;
  await source.prepare();
  assert.equal(attempts, afterFailure);
  fail = false;
  state.visualOverrides = { east: "#330000" };
  await source.prepare();
  assert.deepEqual(eastLabels(), ["CCC"]);
  assert.equal(source.getSource().membershipError, "");
});
