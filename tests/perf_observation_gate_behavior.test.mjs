import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { BOUNDED_UI_FILES, classifyPerformance, isBoundedUiChange, isOrdinaryDocumentation } from "../tools/ci/perf_policy.mjs";

const workflow = fs.readFileSync(new URL("../.github/workflows/perf-pr-gate.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const measure = fs.readFileSync(new URL("../.github/workflows/perf-measure.yml", import.meta.url), "utf8").replace(/\r\n/g, "\n");
const script = workflow.split("node <<'NODE'\n")[1].split("\n          NODE")[0];
const policyOutputs = policy => Object.fromEntries(Object.entries(policy).map(([key, value]) =>
  [key, typeof value === "boolean" ? String(value) : Array.isArray(value) ? JSON.stringify(value) : value]));
const runGate = results => {
  let code = 0;
  vm.runInNewContext(script, {
    console: { log() {}, error() {} },
    process: { env: { PERF_SCENARIO_RESULTS: JSON.stringify(results) }, exit(value) { code = value; } },
  });
  return code;
};
const gateResults = (policy, result) => ({
  classify: { result: "success", outputs: policyOutputs(policy) },
  "perf-scenarios": { result },
});

test("ordinary docs are limited to README markdown and docs outside testing", () => {
  for (const file of ["README.md", "README.zh-CN.md", "README-extra.md", "docs/guide.md", "docs/ui/guide.md", "docs/perf/notes.md"])
    assert.equal(isOrdinaryDocumentation(file), true, file);
  for (const file of ["AGENTS.md", "tools/guide.md", "docs/testing/guide.md", "docs/testing/nested/guide.md", "docs/../tools/guide.md", "docs/x.json", "docs\\guide.md", "some/README.md", "README.md\n", "docs/guide.md\n"])
    assert.equal(isOrdinaryDocumentation(file), false, file);
});

test("bounded UI observation requires runtime and permits only known companions", () => {
  const companions = ["README.md", "docs/ui/guide.md", "tests/styled_selects_behavior.test.mjs", "tests/e2e/editor_detail_polish.spec.js", "tests/e2e/main_shell_i18n.spec.js"];
  assert.equal(isBoundedUiChange(companions), false);
  assert.equal(isBoundedUiChange([]), false);
  for (const file of BOUNDED_UI_FILES) {
    assert.equal(isBoundedUiChange([file, ...companions]), true, file);
    const policy = classifyPerformance({ changedFiles: [file, ...companions] });
    assert.equal(policy.perf_mode, "sample");
    assert.equal(policy.should_run_perf, true);
    assert.equal(policy.required_for_merge, false);
    assert.equal(policy.diagnostic_only, true);
    assert.equal(policy.should_enforce_regressions, false);
    for (const extra of ["js/core/map_renderer.js", "js/ui/unknown.js", "data/scenarios/tno_1962/x.json", "data/unknown.json", "tools/test.mjs", "AGENTS.md", "docs/testing/guide.md", "tests/unknown.test.mjs"]) {
      const mixed = classifyPerformance({ changedFiles: [file, ...companions, extra] });
      assert.equal(isBoundedUiChange([file, extra]), false, extra);
      assert.equal(mixed.required_for_merge, true, extra);
      assert.equal(mixed.diagnostic_only, false, extra);
    }
  }
});

test("strict intent and force always require measurement and retain enforcement semantics", () => {
  for (const labels of [["ci:perf-strict"], ["ci:full"], ["ci:full", "ci:perf-expected"]]) {
    const policy = classifyPerformance({ changedFiles: BOUNDED_UI_FILES, labels });
    assert.equal(policy.perf_mode, "strict");
    assert.equal(policy.required_for_merge, true);
    assert.equal(policy.diagnostic_only, false);
    assert.equal(policy.should_enforce_regressions, true);
    assert.deepEqual(policy.scenario_matrix, ["tno_1962", "hoi4_1939"]);
  }
  assert.equal(classifyPerformance({ force: true }).required_for_merge, true);
  const data = classifyPerformance({ changedFiles: ["data/scenarios/tno_1962/x.json"], labels: ["ci:perf-strict"] });
  assert.equal(data.required_for_merge, true);
  assert.equal(data.should_enforce_regressions, false);
});

test("required check waits only for classification and required reusable measurement", () => {
  const gate = workflow.slice(workflow.indexOf("  perf-gate:\n"));
  assert.match(gate, /needs: \[classify, perf-scenarios\]/);
  assert.doesNotMatch(gate, /perf-observation/);
  const required = workflow.slice(workflow.indexOf("  perf-scenarios:\n"), workflow.indexOf("  perf-observation:\n"));
  const observation = workflow.slice(workflow.indexOf("  perf-observation:\n"), workflow.indexOf("  perf-gate:\n"));
  for (const caller of [required, observation]) assert.match(caller, /uses: \.\/\.github\/workflows\/perf-measure.yml/);
  assert.match(required, /if: needs.classify.outputs.required_for_merge == 'true'/);
  assert.match(observation, /if: needs.classify.outputs.diagnostic_only == 'true'/);
  assert.match(required, /measurement_lane: perf-required-scenario/);
  assert.match(observation, /measurement_lane: perf-observation-scenario/);
  assert.doesNotMatch(workflow + measure, /continue-on-error/);
  assert.doesNotMatch(workflow, /npm ci|--runs 5/);
  assert.match(measure, /name: \$\{\{ inputs.measurement_lane \}\} \(\$\{\{ matrix.scenario \}\}\)/);
  assert.match(measure, /--runs 5 --warmups 3/);
});

test("aggregator accepts only the exact required outcome for a valid policy", () => {
  const policies = [
    classifyPerformance({ changedFiles: ["README.md"] }),
    classifyPerformance({ changedFiles: BOUNDED_UI_FILES }),
    classifyPerformance({ changedFiles: ["js/core/map_renderer.js"] }),
    classifyPerformance({ changedFiles: BOUNDED_UI_FILES, labels: ["ci:perf-strict"] }),
    classifyPerformance({ changedFiles: ["data/scenarios/tno_1962/x.json"], labels: ["ci:perf-strict"] }),
  ];
  for (const policy of policies) {
    for (const state of ["success", "skipped", "failure", "cancelled", "unknown", undefined]) {
      const results = gateResults(policy, state);
      assert.equal(runGate(results), state === (policy.required_for_merge ? "success" : "skipped") ? 0 : 1);
    }
    for (const state of ["failure", "cancelled", "skipped", "unknown", undefined]) {
      const results = gateResults(policy, policy.required_for_merge ? "success" : "skipped");
      results.classify.result = state;
      assert.equal(runGate(results), 1);
    }
    for (const field of ["should_run_perf", "required_for_merge", "diagnostic_only", "perf_mode", "scenario_matrix", "should_enforce_regressions"]) {
      for (const value of [undefined, "", "unknown"]) {
        const results = gateResults(policy, policy.required_for_merge ? "success" : "skipped");
        results.classify.outputs[field] = value;
        assert.equal(runGate(results), 1, `${policy.perf_mode}: invalid ${field}`);
      }
    }
  }
  assert.equal(runGate({}), 1);
  assert.equal(runGate({ classify: { result: "success" } }), 1);
});

test("aggregator rejects contradictory classification even when measurement succeeds", () => {
  const policy = classifyPerformance({ changedFiles: BOUNDED_UI_FILES });
  for (const patch of [
    { required_for_merge: "false", diagnostic_only: "false" },
    { required_for_merge: "true", diagnostic_only: "true" },
    { should_run_perf: "false" },
    { should_enforce_regressions: "true" },
    { scenario_matrix: "[]" },
    { scenario_matrix: '["hoi4_1939","tno_1962"]' },
    { scenario_matrix: '{"scenario":"hoi4_1939"}' },
    { scenario_matrix: "[invalid" },
    { perf_mode: "strict" },
  ]) {
    for (const state of ["success", "skipped"]) {
      const results = gateResults(policy, state);
      Object.assign(results.classify.outputs, patch);
      assert.equal(runGate(results), 1, JSON.stringify(patch));
    }
  }
  const strict = gateResults(classifyPerformance({ force: true }), "skipped");
  Object.assign(strict.classify.outputs, { required_for_merge: "false", diagnostic_only: "true" });
  assert.equal(runGate(strict), 1);
});
