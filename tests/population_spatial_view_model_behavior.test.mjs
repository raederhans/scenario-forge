import test from "node:test";
import assert from "node:assert/strict";
import { normalizePopulationStyle, sumPopulationFeatures, getPopulationCountrySummary } from "../js/core/thematic/population_spatial_view_model.js";
import { POPULATION_LAYER_ID, POPULATION_DATA_VERSION } from "../js/core/thematic/population_spatial_data.js";
function fixture() {
  const geometry = "a".repeat(64);
  const row = (population, area, status = "ok", coverage = 1) => Object.freeze({ population, land_area_km2: area,
    density: status === "ok" ? population / area : null, status, coverage_fraction: coverage });
  return { activeScenarioId: "tno_1962", currentLanguage: "zh", activeScenarioManifest: { source: { runtime_topology_sha256: geometry } },
    styleConfig: { population: normalizePopulationStyle({ enabled: true }) },
    scenarioBaselineOwnersByFeatureId: Object.freeze({ A: "AA", B: "AA", C: "BB", D: "CC", E: "DD" }),
    sovereignBaseColors: { AA: "#ffffff" }, visualOverrides: { A: "#000000" },
    landData: { features: [{ id: "A" }] },
    populationRuntime: { status: "ready", revision: 1, data: { layerId: POPULATION_LAYER_ID, dataVersion: POPULATION_DATA_VERSION,
      year: 2020, geometryVersion: geometry, scenarioId: "tno_1962",
      byFeatureId: Object.freeze({ A: row(0, 1), B: row(90, 3), C: row(20, 10, "partial_coverage", 0.5),
        D: row(null, 2, "unestimated_scenario_land", 0), E: row(null, 0, "water_not_applicable", null) }), counts: { features: 5 } } } };
}

test("country and selection sums use complete baseline membership, deduplicate and area-weight density", () => {
  const state = fixture();
  const selected = sumPopulationFeatures(state, ["A", "B", "B"]);
  assert.equal(selected.population, 90); assert.equal(selected.landAreaKm2, 4);
  assert.equal(selected.density, 22.5); assert.equal(selected.complete, true);
  const country = getPopulationCountrySummary(state, "AA");
  assert.equal(country.population, 90); assert.equal(country.counts.features, 2);
  state.visualOverrides.A = "#ff0000"; state.sovereignBaseColors.AA = "#000000";
  assert.deepEqual(getPopulationCountrySummary(state, "AA"), country);
  assert.ok(Object.isFrozen(selected.counts));
});

test("partial, unestimated and unmatched summaries retain known totals and never claim complete", () => {
  const state = fixture();
  const summary = sumPopulationFeatures(state, ["A", "B", "C", "D", "unknown"]);
  assert.equal(summary.status, "partial"); assert.equal(summary.complete, false);
  assert.equal(summary.knownPopulation, 110); assert.equal(summary.coverageFraction, 9 / 16);
  assert.equal(summary.density, null, "incomplete count divided by full area must not masquerade as a complete density");
  assert.equal(summary.counts.partial, 1); assert.equal(summary.counts.unestimated, 1); assert.equal(summary.counts.missing, 1);
  assert.equal(sumPopulationFeatures(state, ["D"]).population, null);
  assert.equal(sumPopulationFeatures(state, ["unknown"]).population, null);
});
