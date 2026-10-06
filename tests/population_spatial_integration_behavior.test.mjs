import test from "node:test";
import assert from "node:assert/strict";
import { createPopulationSpatialOwner, buildPopulationStatsCsv } from "../js/ui/toolbar/population_spatial_owner.js";
import { getPopulationTooltipLines } from "../js/core/population_spatial_presentation.js";
import { drawPopulationExportLegend } from "../js/core/renderer/population_export_legend.js";
import { ensurePopulationData, ensurePopulationHeatmapData } from "../js/core/population_spatial_runtime.js";
import { normalizePopulationStyle } from "../js/core/population_spatial_view_model.js";
import { POPULATION_MISSING_COLOR } from "../js/core/population_spatial_view_model.js";
import { resolveFeatureColor } from "../js/core/color_resolver.js";
import { POPULATION_LAYER_ID, POPULATION_DATA_VERSION } from "../js/core/population_spatial_data.js";

const geometry = "a".repeat(64);
class Element {
  constructor() { this.value = ""; this.checked = false; this.disabled = false; this.hidden = false;
    this.dataset = {}; this.style = {}; this.textContent = ""; this.children = []; this.listeners = new Map(); }
  addEventListener(type, listener) { this.listeners.set(type, listener); }
  dispatch(type) { this.listeners.get(type)?.({ target: this }); }
  appendChild(child) { this.children.push(child); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this[name] = value; }
}
function payload(scenarioId) {
  const row = (population, area, status = "ok", coverage = 1) => Object.freeze({
    population, land_area_km2: area, density: status === "ok" ? population / area : null,
    coverage_fraction: coverage, status, source_epoch: 2020,
  });
  const rows = { A: row(0, 1), B: row(60, 3), C: row(null, 2, "no_data", 0),
    D: row(null, 1, "unestimated_scenario_land", 0) };
  return Object.freeze({ layerId: POPULATION_LAYER_ID, dataVersion: POPULATION_DATA_VERSION,
    scenarioId, geometryVersion: geometry, year: 2020, source: { resolution_m: 1000 },
    counts: { features: 4, observed: 2, missing: 1, partial: 0, unestimated: 1, water: 0 },
    byFeatureId: Object.freeze(Object.fromEntries(Object.entries(rows).map(([id, row]) => [id, Object.freeze({ ...row, feature_id: id })]))) });
}
const flush = () => new Promise((resolve) => setImmediate(resolve));
function harness({ fail = false, enabled = false } = {}) {
  const nodes = Object.fromEntries(["togglePopulation", "populationMode", "populationOpacity", "populationOpacityValue",
    "populationStatus", "populationRetry", "populationReferenceNote", "populationLegend", "populationSummaryScope",
    "populationSummary", "populationSummarizeSelection", "populationExportStats", "populationSourceNote"].map((id) => [id, new Element()]));
  const state = { activeScenarioId: "tno_1962", currentLanguage: "en", styleConfig: {
    population: normalizePopulationStyle({ enabled }), thematic: { enabled: true } },
    activeScenarioManifest: { source: { runtime_topology_sha256: geometry } },
    scenarioBaselineOwnersByFeatureId: Object.freeze({ A: "AA", B: "AA", C: "BB", D: "CC" }),
    strategicChoroplethMetric: "steel", sovereignBaseColors: { AA: "#ffffff" }, visualOverrides: { A: "#000000" },
    devSelectionOrder: ["A", "B", "B"], persistViewSettingsFn: () => { persists += 1; } };
  let persists = 0, calls = 0, failing = fail;
  const dirty = [], downloads = [];
  const owner = createPopulationSpatialOwner({ runtimeState: state,
    documentRef: { getElementById: (id) => nodes[id] || null, createElement: () => new Element() },
    t: (key) => key, markDirty: (reason) => dirty.push(reason), refreshColorState: () => {}, showLegend: () => {},
    ensureData: (target, options) => ensurePopulationData(target, { ...options, loadData: async ({ scenarioId }) => {
      calls += 1; if (failing) throw new Error("network unavailable"); return payload(scenarioId);
    } }), downloadCsv: (contents, name) => downloads.push({ contents, name }) });
  return { state, nodes, owner, dirty, downloads, calls: () => calls, persists: () => persists, recover: () => { failing = false; } };
}

test("population UI toggles through owners, keeps base paint and changes mode/opacity without reloading statistics", async () => {
  const h = harness(); const paint = h.state.visualOverrides;
  h.owner.render(); assert.equal(h.nodes.populationStatus.textContent, "Population layer is off.");
  h.nodes.togglePopulation.checked = true; h.nodes.togglePopulation.dispatch("change");
  assert.equal(h.state.styleConfig.thematic.enabled, false); assert.equal(h.state.strategicChoroplethMetric, "");
  assert.equal(h.nodes.populationStatus.textContent, "Loading population data…");
  await flush(); assert.equal(h.state.populationRuntime.status, "ready");
  const data = h.state.populationRuntime.data;
  await ensurePopulationHeatmapData(h.state, { loadTiles: async () => ({ overview: {}, detail: [] }) });
  h.nodes.populationMode.value = "heatmap"; h.nodes.populationMode.dispatch("change");
  h.nodes.populationOpacity.value = "35"; h.nodes.populationOpacity.dispatch("input");
  await flush(); assert.equal(h.calls(), 1); assert.equal(h.state.populationRuntime.data, data);
  assert.equal(h.state.styleConfig.population.opacity, 0.35); assert.equal(h.persists(), 3);
  assert.equal(h.state.visualOverrides, paint); assert.deepEqual(paint, { A: "#000000" });
  assert.equal(h.dirty.length, 3);
});

test("UI failure is explicit and retries only after the user selects retry", async () => {
  const h = harness({ enabled: true, fail: true }); h.owner.render(); await flush();
  assert.equal(h.state.populationRuntime.status, "failed"); assert.equal(h.nodes.populationRetry.hidden, false);
  assert.match(h.nodes.populationStatus.title, /network unavailable/);
  h.owner.render(); await flush(); assert.equal(h.calls(), 1);
  h.recover(); h.nodes.populationRetry.dispatch("click"); await flush();
  assert.equal(h.calls(), 2); assert.equal(h.state.populationRuntime.status, "ready");
  assert.equal(h.nodes.populationRetry.hidden, true);
});

test("enabling a saved unavailable population version selects the pinned source before loading", async () => {
  const h = harness(); h.state.styleConfig.population.dataVersion = "future-spatial-release";
  h.owner.render(); assert.equal(h.calls(), 0);
  h.nodes.togglePopulation.checked = true; h.nodes.togglePopulation.dispatch("change"); await flush();
  assert.equal(h.state.styleConfig.population.dataVersion, POPULATION_DATA_VERSION);
  assert.equal(h.state.populationRuntime.status, "ready"); assert.equal(h.calls(), 1);
});

test("CSV keeps zero, null, epoch, geometry and immutable baseline groups; selection summary deduplicates", async () => {
  const h = harness({ enabled: true }); h.owner.render(); await flush();
  h.nodes.populationSummarizeSelection.dispatch("click");
  assert.match(h.nodes.populationSummary.textContent, /Estimated population: 60/);
  assert.match(h.nodes.populationSummary.textContent, /Mapped parcels: 2\/2/);
  const csv = buildPopulationStatsCsv(h.state);
  assert.match(csv, /"A","AA","0","1","0","1","","ok","2020","1000"/);
  assert.match(csv, /"C","BB","","2","","0","","no_data","2020","1000"/);
  assert.ok(csv.includes(geometry)); assert.ok(csv.includes(POPULATION_DATA_VERSION));
  h.nodes.populationExportStats.dispatch("click");
  assert.equal(h.downloads[0].contents, csv); assert.equal(h.downloads[0].name, "population-2020-tno_1962.csv");
});

test("historical tooltips identify the 2020 estimate and unknown land never gets a zero population", async () => {
  const h = harness({ enabled: true }); h.owner.render(); await flush();
  const known = getPopulationTooltipLines(h.state, { id: "A" }).join("\n");
  assert.match(known, /Population · 2020: 0/); assert.match(known, /not a scenario-year population estimate/);
  const unknown = getPopulationTooltipLines(h.state, { id: "C" }).join("\n");
  assert.match(unknown, /Population · 2020: —/); assert.match(unknown, /Population data unavailable/);
  const unestimated = getPopulationTooltipLines(h.state, { id: "D" }).join("\n");
  assert.match(unestimated, /population unestimated/); assert.doesNotMatch(unestimated, /Population · 2020: 0/);
  h.state.populationRuntime.status = "loading";
  assert.deepEqual(getPopulationTooltipLines(h.state, { id: "A" }), []);
});

test("PNG population legend draws source epoch and historical warning only when ready", async () => {
  const h = harness({ enabled: true }); h.owner.render(); await flush();
  const texts = [];
  const canvas = { width: 1200, height: 700, getContext: () => ({ save() {}, restore() {}, setTransform() {}, fillRect() {},
    strokeRect() {}, fillText: (text) => texts.push(text) }) };
  assert.equal(drawPopulationExportLegend(canvas, h.state), true);
  assert.ok(texts.includes("Population density · 2020")); assert.ok(texts.includes("Not a scenario-year estimate"));
  assert.ok(texts.includes("Epoch 2020 · CC BY 4.0")); assert.ok(texts.some((text) => text.includes("R2023A")));
  h.state.styleConfig.population.mode = "heatmap"; texts.length = 0;
  assert.equal(drawPopulationExportLegend(canvas, h.state), true);
  assert.ok(texts.some((text) => /valid.*raster.*area/i.test(text)), "heatmap caption uses valid source pixel area");
  h.state.populationRuntime.status = "failed"; texts.length = 0;
  assert.equal(drawPopulationExportLegend(canvas, h.state), false); assert.equal(texts.length, 0);
});

test("population opacity uses a common neutral base and heatmap no-data cannot expose a country's density-like color", async () => {
  const h = harness({ enabled: true }); h.owner.render(); await flush();
  const original = h.state.populationRuntime.data;
  h.state.populationRuntime.data = { ...original, byFeatureId: Object.freeze({ ...original.byFeatureId,
    A: Object.freeze({ ...original.byFeatureId.A, population: 20, density: 20 }),
  }) };
  h.state.visualOverrides = { A: "#123456", B: "#c0ffee", C: "#bd0026" };
  h.state.scenarioBaselineOwnersByFeatureId = Object.freeze({ A: "AA", B: "BB", C: "CC", D: "DD" });
  h.state.sovereignBaseColors = { AA: "#ff0000", BB: "#0000ff", CC: "#bd0026" };
  h.state.styleConfig.population.opacity = 0.5;
  const color = (id) => resolveFeatureColor(id, { state: h.state, feature: { id } }).color;
  assert.equal(color("A"), color("B"), "equal density retains equal displayed color across different palette and edit colors");
  await ensurePopulationHeatmapData(h.state, { loadTiles: async () => ({ overview: {}, detail: [] }) });
  h.nodes.populationMode.value = "heatmap"; h.nodes.populationMode.dispatch("change");
  assert.equal(color("C"), POPULATION_MISSING_COLOR, "transparent raster no-data leaves a neutral parcel");
  h.nodes.togglePopulation.checked = false; h.nodes.togglePopulation.dispatch("change");
  assert.equal(color("A"), "#123456"); assert.equal(color("B"), "#c0ffee"); assert.equal(color("C"), "#bd0026");
});
