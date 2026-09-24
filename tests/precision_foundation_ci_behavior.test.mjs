import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { classifyPerformance } from "../tools/ci/perf_policy.mjs";
import { planPullRequest } from "../tools/ci/pr_plan.mjs";

test("planner and hosted policy agree across all relevance and label combinations", () => {
  for (const file of ["docs/readme.md", "docs/perf/notes.md", "docs/perf/baseline.json", "js/new.js", "js-other/file.js", "package.json", "package-lock.json", "tests/e2e/support/x.js", "data/scenarios/tno_1962/x.json"])
    for (const labels of [[], ["ci:perf-strict"], ["ci:full"], ["ci:perf-expected"], ["ci:full", "ci:perf-expected"]]) {
      const input = { changedFiles: [file], labels };
      assert.equal(planPullRequest(input).perfMode, classifyPerformance(input).perf_mode);
    }
});
test("explicit strict intent survives unrelated paths and expected-change labels", () => {
  const result = classifyPerformance({ changedFiles: ["docs/readme.md"], labels: ["ci:full", "ci:perf-expected"] });
  assert.equal(result.should_run_perf, true);
  assert.equal(result.perf_mode, "strict");
  assert.deepEqual(result.scenario_matrix, ["tno_1962", "hoi4_1939"]);
  assert.equal(classifyPerformance({ force: true }).should_enforce_regressions, true);
});
test("policy retains data diagnostic semantics and fail-safe package classification", () => {
  assert.equal(classifyPerformance({ changedFiles: ["package.json"], packageRequiresPerf: false }).perf_mode, "skip");
  assert.equal(classifyPerformance({ changedFiles: ["package.json"] }).perf_mode, "sample");
  assert.equal(classifyPerformance({ changedFiles: ["data/scenarios/tno_1962/x.json"], labels: ["ci:perf-strict"] }).should_enforce_regressions, false);
  assert.equal(classifyPerformance({ changedFiles: ["js/x.js"], labels: ["ci:perf-strict"] }).should_enforce_regressions, true);
});
test("planner paths respect directory boundaries", () => {
  const plan = planPullRequest({ changedFiles: ["js-other/file.js", "data-other/a.json"] });
  assert.equal(plan.runSmoke, false); assert.equal(plan.runPages, false);
});
test("label-driven workflows load the same policy and subscribe to label changes", () => {
  for (const file of ["pr-verify", "scenario-contract-matrix", "transport-contract-required", "perf-pr-gate"]) {
    const text = fs.readFileSync(`.github/workflows/${file}.yml`, "utf8");
    assert.match(text, /types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
    assert.ok(text.includes("tools/ci/perf_policy.mjs"));
  }
});
test("required aggregator refuses accidentally skipped planned smoke", () => {
  const source = fs.readFileSync(".github/workflows/pr-verify.yml", "utf8").replace(/\r\n/g, "\n");
  const script = source.split("node <<'NODE'\n")[1].split("\n          NODE")[0];
  function run(planned, smoke) {
    const needs = { "pr-plan": { result: "success", outputs: { run_smoke: planned } }, "pr-verify-fast": { result: "success" }, "pr-verify-smoke": { result: smoke } };
    let code = 0;
    vm.runInNewContext(script, { console: { log() {}, error() {} }, process: { env: { REQUIRED_RESULTS: JSON.stringify(needs) }, exit(value) { code = value; } } });
    return code;
  }
  assert.equal(run("true", "skipped"), 1);
  assert.equal(run("true", "success"), 0);
  assert.equal(run("false", "skipped"), 0);
  assert.equal(run(undefined, "skipped"), 1);
  assert.equal(run("false", "failure"), 1);
});
