import test from "node:test";
import assert from "node:assert/strict";
import { readPoliticalRenderPolicy, getPoliticalIdRasterEligibility } from "../js/core/renderer/political_id_raster_trial.js";

const policyStore = (values) => ({ getItem: (key) => values[key] ?? null });
const read = (scenarioId, search = "", values = {}) => readPoliticalRenderPolicy({ scenarioId, search, storage: policyStore(values) });
const eligibility = (scenarioId) => getPoliticalIdRasterEligibility({
  requested: true, exporting: false, debugMode: "PROD", firstVisible: true, riverPartitions: 0, scenarioId,
});

test("TNO and HOI4 scenarios default to the resident GPU raster", () => {
  for (const scenarioId of ["tno_1962", "hoi4_1936", "hoi4_1939"]) {
    const policy = read(scenarioId);
    assert.equal(policy.mode, "auto", scenarioId);
    assert.equal(policy.effectiveMode, "raster", scenarioId);
    assert.equal(policy.requested, true, scenarioId);
    assert.equal(policy.persistent, true, scenarioId);
    assert.notEqual(eligibility(scenarioId), "unsupported-scenario", scenarioId);
  }
});

test("other scenarios keep the vector path by default", () => {
  for (const scenarioId of ["", "modern_world", "blank_base", "unknown_scenario"]) {
    const policy = read(scenarioId);
    assert.equal(policy.effectiveMode, "vector", scenarioId);
    assert.equal(policy.requested, false, scenarioId);
    assert.equal(eligibility(scenarioId), "unsupported-scenario", scenarioId);
  }
});

test("a vector choice in the URL or saved preference still turns the raster off", () => {
  for (const scenarioId of ["hoi4_1936", "hoi4_1939", "tno_1962"]) {
    assert.equal(read(scenarioId, "?political_render_mode=vector").requested, false, scenarioId);
    assert.equal(read(scenarioId, "", { "scenario-forge-political-render-mode": "vector" }).requested, false, scenarioId);
  }
  assert.equal(read("hoi4_1939", "?political_render_mode=auto").effectiveMode, "raster");
});
