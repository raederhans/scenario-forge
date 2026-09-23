import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";

import { planPullRequest, SCENARIO_CONTRACT_IDS } from "../tools/ci/pr_plan.mjs";

test("docs-only changes keep heavyweight PR lanes off", () => {
  const plan = planPullRequest({ changedFiles: ["docs/active/example/plan.md"] });
  assert.equal(plan.runFast, true);
  assert.equal(plan.runSmoke, false);
  assert.equal(plan.runDemo, false);
  assert.equal(plan.runPages, false);
  assert.equal(plan.runTransport, false);
  assert.deepEqual(plan.scenarioIds, []);
  assert.equal(plan.perfMode, "skip");
});

test("runtime changes select smoke, Pages and sampled performance", () => {
  const plan = planPullRequest({ changedFiles: ["js/core/map_renderer.js"] });
  assert.equal(plan.runSmoke, true);
  assert.equal(plan.runPages, true);
  assert.equal(plan.perfMode, "sample");
});

test("PR control-plane changes force browser smoke and Golden Demo", () => {
  const plan = planPullRequest({ changedFiles: [".github/workflows/pr-verify.yml"] });
  assert.equal(plan.runSmoke, true);
  assert.equal(plan.runDemo, true);
  assert.equal(plan.runPages, false);
});

test("one scenario change selects only its strict contract job", () => {
  const plan = planPullRequest({ changedFiles: ["data/scenarios/tno_1962/manifest.json"] });
  assert.deepEqual(plan.scenarioIds, ["tno_1962"]);
  assert.equal(plan.perfMode, "sample");
});

test("shared scenario tooling fans out to all supported scenario contracts", () => {
  const plan = planPullRequest({ changedFiles: ["map_builder/contracts.py"] });
  assert.deepEqual(plan.scenarioIds, [...SCENARIO_CONTRACT_IDS]);
});

test("every registered scenario migration selects its own strict contract", () => {
  const index = JSON.parse(fs.readFileSync(new URL("../data/scenarios/index.json", import.meta.url), "utf8"));
  assert.deepEqual(index.scenarios.map((row) => row.scenario_id).sort(), [...SCENARIO_CONTRACT_IDS]);
  for (const id of SCENARIO_CONTRACT_IDS) {
    const plan = planPullRequest({ changedFiles: [`data/scenarios/${id}/runtime_topology.topo.json`] });
    assert.deepEqual(plan.scenarioIds, [id]);
    assert.equal(plan.runPages, true);
  }
});

test("shared county and chunk builders select all scenario contracts", () => {
  for (const file of ["data/scenarios/index.json", "tools/scenario_chunk_assets.py",
    "tools/regional_scenario_assets.py", "tools/stage_us_county_scenario.py",
    "tools/stage_us_county_adapted_bundle.py"]) {
    assert.deepEqual(planPullRequest({ changedFiles: [file] }).scenarioIds, [...SCENARIO_CONTRACT_IDS]);
  }
});

test("transport changes select transport without forcing browser work", () => {
  const plan = planPullRequest({ changedFiles: ["data/transport_layers/catalog.json"] });
  assert.equal(plan.runTransport, true);
  assert.equal(plan.runSmoke, false);
});

test("CI intent labels override automatic planning without hiding evidence", () => {
  const full = planPullRequest({ changedFiles: ["docs/readme.md"], labels: ["ci:full"] });
  assert.equal(full.runSmoke, true);
  assert.equal(full.runDemo, true);
  assert.equal(full.runPages, true);
  assert.equal(full.perfMode, "strict");

  const expected = planPullRequest({
    changedFiles: ["js/core/map_renderer.js"],
    labels: ["ci:perf-expected"],
  });
  assert.equal(expected.perfMode, "sample");
  assert.equal(expected.expectedPerformanceChange, true);

  const strict = planPullRequest({
    changedFiles: ["js/core/map_renderer.js"],
    labels: ["ci:perf-expected", "ci:perf-strict"],
  });
  assert.equal(strict.perfMode, "strict");
});
