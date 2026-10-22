import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// One decision policy for PR planning and the hosted performance classifier.
// Data-only comparisons stay diagnostic; explicit/full/nightly measurements
// never become lighter merely because the expected-change label is present.
export const PERF_RULES = Object.freeze([
  ["perf-workflow", "diagnostic", [".github/workflows/perf-pr-gate.yml", ".github/workflows/perf-measure.yml", "tools/ci/perf_policy.mjs"]],
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

export const BOUNDED_UI_FILES = Object.freeze([
  "css/editor-workspace.css",
  "css/editor-tool-guidance.css",
  "js/ui/styled_selects.js",
  "js/ui/toolbar/tool_guidance.js",
]);
const boundedUiTests = new Set([
  "tests/styled_selects_behavior.test.mjs",
  "tests/e2e/editor_detail_polish.spec.js",
  "tests/e2e/main_shell_i18n.spec.js",
]);
const boundedUiRuntime = new Set(BOUNDED_UI_FILES);

export function isOrdinaryDocumentation(file) {
  if (typeof file !== "string" || !file.endsWith(".md") || file.split("/").some(part => part === "." || part === "..") || file.includes("\\")) return false;
  return /^README[^/]*\.md$/.test(file)
    || (/^docs\/(?:[^/]+\/)*[^/]+\.md$/.test(file) && !file.startsWith("docs/testing/"));
}

export function isBoundedUiChange(files) {
  if (!Array.isArray(files)) throw new TypeError("files must be an array");
  return files.some(file => boundedUiRuntime.has(file))
    && files.every(file => boundedUiRuntime.has(file) || boundedUiTests.has(file) || isOrdinaryDocumentation(file));
}

// Compare the specified base commit (not the merge base) with the event head or
// workspace manifest. Hosted classification and local previews use this same base.
// Only isolated test:/verify: script edits are exempt; uncertain inputs measure.
export function packageChangeRequiresPerformance({ basePackageText, headPackageText } = {}) {
  try {
    const base = JSON.parse(basePackageText);
    const head = JSON.parse(headPackageText);
    const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    if (!isObject(base) || !isObject(head) || !isObject(base.scripts) || !isObject(head.scripts)) return true;
    const { scripts: baseScripts, ...baseManifest } = base;
    const { scripts: headScripts, ...headManifest } = head;
    if (JSON.stringify(baseManifest) !== JSON.stringify(headManifest)) return true;
    const commands = [...Object.values(baseScripts), ...Object.values(headScripts)];
    if (commands.some((command) => typeof command !== "string")) return true;
    for (const name of new Set([...Object.keys(baseScripts), ...Object.keys(headScripts)])) {
      if (baseScripts[name] === headScripts[name]) continue;
      if (!/^(test:|verify:)/iu.test(name)
        || /perf|benchmark/iu.test(`${name} ${baseScripts[name] || ""} ${headScripts[name] || ""}`)
        || commands.some((command) => command.toLowerCase().includes(name.toLowerCase()))) return true;
    }
    return false;
  } catch {
    return true;
  }
}

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
  const shouldRunPerf = perfMode !== "skip";
  const requiredForMerge = shouldRunPerf && (perfMode === "strict" || !isBoundedUiChange(files));
  const enforced = rules.filter(rule => rule.regression_policy === "enforce").map(rule => rule.name);
  return {
    matched_rules: rules,
    should_run_perf: shouldRunPerf,
    required_for_merge: requiredForMerge,
    diagnostic_only: shouldRunPerf && !requiredForMerge,
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
  const input = JSON.parse(fs.readFileSync(process.argv[2], "utf8").replace(/^\uFEFF/, ""));
  if (Object.hasOwn(input, "basePackageText") || Object.hasOwn(input, "headPackageText")) {
    input.packageRequiresPerf = packageChangeRequiresPerformance(input);
  }
  process.stdout.write(JSON.stringify(classifyPerformance(input)));
}
