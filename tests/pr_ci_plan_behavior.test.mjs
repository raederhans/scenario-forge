import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

import { planPullRequest, SCENARIO_CONTRACT_IDS } from "../tools/ci/pr_plan.mjs";
import { packageChangeRequiresPerformance } from "../tools/ci/perf_policy.mjs";

test("shared package policy exempts only isolated test and verification scripts", () => {
  const base = { name: "fixture", scripts: { "test:isolated": "node test.mjs", "perf:gate": "node tools/perf/run.mjs" } };
  const requiresPerf = (head, previous = base) => packageChangeRequiresPerformance({
    basePackageText: typeof previous === "string" ? previous : JSON.stringify(previous),
    headPackageText: typeof head === "string" ? head : JSON.stringify(head),
  });
  const cases = [
    [{ ...base, scripts: { ...base.scripts, "test:isolated": "node other.mjs" } }, false],
    [{ ...base, scripts: { ...base.scripts, "verify:new": "node checker.mjs" } }, false],
    [{ ...base, scripts: { "perf:gate": base.scripts["perf:gate"] } }, false],
    [{ ...base, scripts: { ...base.scripts, "test:isolated": "node BENCHMARK.mjs" } }, true],
    [{ ...base, scripts: { ...base.scripts, "perf:gate": "node changed.mjs" } }, true],
    [{ ...base, scripts: { ...base.scripts, preinstall: "node setup.mjs" } }, true],
    [{ ...base, scripts: { ...base.scripts, "pretest:isolated": "node setup.mjs" } }, true],
    [{ ...base, dependencies: { example: "1" } }, true],
    [{ ...base, engines: { node: ">=22" } }, true],
    [{ ...base, unknown: true }, true],
    [{ ...base, scripts: [] }, true],
    [{ ...base, scripts: { "test:isolated": null } }, true],
    ["{invalid", true], ["null", true], [{ name: "missing scripts" }, true],
  ];
  for (const [head, expected] of cases) assert.equal(requiresPerf(head), expected, JSON.stringify(head));
  for (const command of ["npm run test:isolated", "npm run TEST:ISOLATED"]) {
    const referenced = { ...base, scripts: { ...base.scripts, "perf:gate": command } };
    assert.equal(requiresPerf({ ...referenced, scripts: { ...referenced.scripts, "test:isolated": "node changed.mjs" } }, referenced), true);
  }
  assert.equal(packageChangeRequiresPerformance({}), true);
  assert.equal(requiresPerf(base, "{invalid"), true);
});

test("PR planner accepts shared package exemption but defaults conservatively", () => {
  assert.equal(planPullRequest({ changedFiles: ["package.json"] }).perfRequired, true);
  const exempt = planPullRequest({ changedFiles: ["package.json"], packageRequiresPerf: false });
  assert.equal(exempt.perfMode, "skip");
  assert.equal(exempt.perfRequired, false);
  assert.equal(planPullRequest({ changedFiles: ["package.json"], packageRequiresPerf: false, labels: ["ci:perf-strict"] }).perfMode, "strict");
  assert.equal(planPullRequest({ changedFiles: ["package.json", "package-lock.json"], packageRequiresPerf: false }).perfRequired, true);
});

test("planner CLI shares manifest exemption and missing or invalid files stay conservative", (t) => {
  const repoRoot = fileURLToPath(new URL("../", import.meta.url));
  const runtime = path.join(repoRoot, ".runtime", "tmp");
  fs.mkdirSync(runtime, { recursive: true });
  const cwd = fs.mkdtempSync(path.join(runtime, "pr-plan-cli-"));
  t.after(() => {
    assert.equal(path.dirname(cwd), runtime);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(cwd, "changes.txt"), "package.json\n");
  fs.writeFileSync(path.join(cwd, "base.json"), JSON.stringify({ scripts: { "test:isolated": "node old.mjs" } }));
  fs.writeFileSync(path.join(cwd, "head.json"), JSON.stringify({ scripts: { "test:isolated": "node changed.mjs" } }));
  const invoke = (extraArgs = []) => {
    const result = spawnSync(process.execPath, [path.join(repoRoot, "tools/ci/pr_plan.mjs"),
      "--changed-files", "changes.txt", ...extraArgs], { cwd, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout);
  };
  const manifestArgs = ["--base-package-file", "base.json", "--head-package-file", "head.json"];
  assert.equal(invoke(manifestArgs).perfMode, "skip");
  assert.equal(invoke().perfRequired, true);
  assert.equal(invoke(["--base-package-file", "missing.json", "--head-package-file", "head.json"]).perfRequired, true);
  assert.equal(invoke(["--base-package-file", "base.json"]).perfRequired, true);
  fs.writeFileSync(path.join(cwd, "head.json"), "");
  assert.equal(invoke(manifestArgs).perfRequired, true);
  fs.writeFileSync(path.join(cwd, "head.json"), "{invalid");
  assert.equal(invoke(manifestArgs).perfRequired, true);
  fs.writeFileSync(path.join(cwd, "head.json"), JSON.stringify({ scripts: { "test:isolated": "node changed.mjs" }, dependencies: { example: "1" } }));
  assert.equal(invoke(manifestArgs).perfRequired, true);
});

test("docs-only changes keep heavyweight PR lanes off", () => {
  const plan = planPullRequest({ changedFiles: ["docs/active/example/plan.md"] });
  assert.equal(plan.runFast, false);
  assert.equal(plan.runSmoke, false);
  assert.equal(plan.runDemo, false);
  assert.equal(plan.runPages, false);
  assert.equal(plan.runTransport, false);
  assert.deepEqual(plan.scenarioIds, []);
  assert.equal(plan.perfMode, "skip");
});

test("runtime changes select smoke, source references and required sampled performance", () => {
  const plan = planPullRequest({ changedFiles: ["js/core/map_renderer.js"] });
  assert.equal(plan.runSmoke, true);
  assert.equal(plan.runPages, false);
  assert.equal(plan.pagesMode, "source");
  assert.equal(plan.perfRequired, true);
  assert.equal(plan.perfMode, "sample");
});

test("PR control-plane changes force browser smoke and Golden Demo", () => {
  const plan = planPullRequest({ changedFiles: [".github/workflows/pr-verify.yml"] });
  assert.equal(plan.runSmoke, true);
  assert.equal(plan.runDemo, true);
  assert.equal(plan.runPages, true);
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
