import test from "node:test";
import assert from "node:assert/strict";
import { createPopulationSpatialOwner } from "../js/ui/toolbar/population_spatial_owner.js";

import { ensurePopulationData, ensurePopulationHeatmapData } from "../js/core/thematic/population_spatial_runtime.js";
import { normalizePopulationStyle } from "../js/core/thematic/population_spatial_view_model.js";
import { POPULATION_MISSING_COLOR } from "../js/core/thematic/population_spatial_view_model.js";
import { resolveFeatureColor } from "../js/core/color_resolver.js";
import { POPULATION_LAYER_ID, POPULATION_DATA_VERSION } from "../js/core/thematic/population_spatial_data.js";

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
function harness() {
  const nodes = Object.fromEntries(["togglePopulation", "populationMode", "populationOpacity", "populationOpacityValue",
    "populationStatus", "populationRetry", "populationReferenceNote", "populationLegend", "populationSummaryScope",
    "populationSummary", "populationSummarizeSelection", "populationExportStats", "populationSourceNote"].map((id) => [id, new Element()]));
  const state = { activeScenarioId: "tno_1962", currentLanguage: "en", styleConfig: {
    population: normalizePopulationStyle({ enabled: true }), thematic: { enabled: true } },
    activeScenarioManifest: { source: { runtime_topology_sha256: geometry } },
    scenarioBaselineOwnersByFeatureId: Object.freeze({ A: "AA", B: "AA", C: "BB", D: "CC" }),
    strategicChoroplethMetric: "steel", sovereignBaseColors: { AA: "#ffffff" }, visualOverrides: { A: "#000000" },
    devSelectionOrder: ["A", "B", "B"] };
  const owner = createPopulationSpatialOwner({ runtimeState: state,
    documentRef: { getElementById: (id) => nodes[id] || null, createElement: () => new Element() },
    t: (key) => key, markDirty: () => {}, refreshColorState: () => {}, showLegend: () => {},
    ensureData: (target, options) => ensurePopulationData(target, { ...options, loadData: async ({ scenarioId }) => {
      return payload(scenarioId);
    } }) });
  return { state, nodes, owner };
}

test("population opacity uses a common neutral base and heatmap no-data cannot expose a country's density-like color", async () => {
  const h = harness(); h.owner.render(); await flush();
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
