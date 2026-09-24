import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// One decision policy for PR planning and the hosted performance classifier.
// Data-only comparisons stay diagnostic; explicit/full/nightly measurements
// never become lighter merely because the expected-change label is present.
export const PERF_RULES = Object.freeze([
  ["perf-workflow", "diagnostic", [".github/workflows/perf-pr-gate.yml", "tools/ci/perf_policy.mjs"]],
  ["perf-baseline-docs", "diagnostic", ["docs/perf/**"]],
  ["runtime-js", "enforce", ["js/**"]],
  ["app-shell", "enforce", ["index.html", "css/**", "vendor/**"]],
  ["scenario-registry", "diagnostic", ["data/scenarios/index.json"]],
  ["perf-scenario-data", "diagnostic", ["data/scenarios/tno_1962/**", "data/scenarios/hoi4_1939/**"]],
  ["playwright-app-support", "diagnostic", ["tests/e2e/support/**", "playwright.config.cjs"]],
  ["perf-tools", "diagnostic", ["tools/perf/**"]],
  ["dev-server", "diagnostic", ["tools/dev_server.py"]],
  ["node-manifests", "diagnostic", ["package.json", "package-lock.json", "requirements-perf.lock.txt"]],
]);

export function classifyPerformance({ changedFiles = [], labels = [], force = false, packageRequiresPerf = true } = {}) {
  if (!Array.isArray(changedFiles) || !Array.isArray(labels)) throw new TypeError("files and labels must be arrays");
  const files = [...new Set(changedFiles.map(String))].sort();
  const labelSet = new Set(labels.map(value => String(value).trim().toLowerCase()));
  const matches = (file, pattern) => pattern.endsWith("/**")
    ? file.startsWith(pattern.slice(0, -2)) : file === pattern;
  const rules = PERF_RULES.map(([name, regression_policy, patterns]) => ({
    name, regression_policy, patterns,
    reason: name,
    files: files.filter(file => patterns.some(pattern => matches(file, pattern))
      && !(name === "perf-baseline-docs" && file.endsWith(".md"))
      && !(file === "package.json" && !packageRequiresPerf)),
  })).filter(rule => rule.files.length);
  const explicitStrict = labelSet.has("ci:perf-strict") || labelSet.has("ci:full");
  const perfMode = force || explicitStrict ? "strict" : rules.length ? "sample" : "skip";
  const enforced = rules.filter(rule => rule.regression_policy === "enforce").map(rule => rule.name);
  return {
    matched_rules: rules,
    should_run_perf: perfMode !== "skip",
    perf_mode: perfMode,
    scenario_matrix: perfMode === "strict" ? ["tno_1962", "hoi4_1939"] : perfMode === "sample" ? ["hoi4_1939"] : [],
    labels: [...labelSet].sort(),
    expected_performance_change: labelSet.has("ci:perf-expected"),
    forced_measurement: !!force,
    should_enforce_regressions: perfMode === "strict" && (!!force || enforced.length > 0),
    regression_enforcement_rules: enforced,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 3) throw new Error("usage: node tools/ci/perf_policy.mjs INPUT.json");
  process.stdout.write(JSON.stringify(classifyPerformance(JSON.parse(fs.readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, "")))));
}
