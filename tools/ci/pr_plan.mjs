import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const normalize = (value) => String(value || "").replaceAll("\\", "/").trim();
export const SCENARIO_CONTRACT_IDS = Object.freeze([
  "blank_base", "hgo_1936", "hoi4_1936", "hoi4_1939", "modern_world", "tno_1962",
]);

export function planPullRequest({ changedFiles = [], labels = [] } = {}) {
  const files = [...new Set(changedFiles.map(normalize).filter(Boolean))].sort();
  const labelSet = new Set(labels.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  const full = labelSet.has("ci:full");

  const matches = (patterns) => files.some((file) => patterns.some((pattern) => (
    pattern.endsWith("/**") ? file.startsWith(pattern.slice(0, -3)) :
    pattern.endsWith("*") ? file.startsWith(pattern.slice(0, -1)) :
    pattern.endsWith("/") ? file.startsWith(pattern) :
    pattern.startsWith("*.") ? file.endsWith(pattern.slice(1)) :
    file === pattern
  )));

  const runtimeRelevant = matches(["js/**", "css/**", "index.html", "vendor/**", "landing/**"]);
  const browserRelevant = runtimeRelevant || matches(["tests/e2e/**", "playwright.config.cjs", "tools/e2e_layering.mjs", ".github/workflows/pr-verify.yml", ".github/workflows/verify-shared.yml"]);
  const pagesRelevant = runtimeRelevant || matches(["data/**", "tools/build_pages_dist.py", "tools/pages_*", ".github/workflows/verify-shared.yml"]);
  const publicSampleRelevant = matches([
    "js/bootstrap/startup_sample_project_deeplink.js",
    "js/core/sample_project_import_workflow.js",
    "js/core/sample_project_registry.js",
    "landing/**",
    "tests/e2e/sample_guide_deeplink.spec.js",
    ".github/workflows/pr-verify.yml",
    ".github/workflows/verify-shared.yml",
  ]);

  const scenarioIds = new Set();
  for (const id of SCENARIO_CONTRACT_IDS) {
    if (files.some((file) => file.startsWith(`data/scenarios/${id}/`))) scenarioIds.add(id);
  }
  const sharedScenarioRelevant = matches([
    "data/CATALOG.json", "data/manifest.json", "data/source_ledger.json", "data/scenarios/index.json",
    "map_builder/**", "tools/check_scenario_contracts.py", "requirements-dev.lock.txt",
    "tools/scenario_chunk_assets.py", "tools/regional_scenario_assets.py",
    "tools/stage_us_county_scenario.py", "tools/stage_us_county_adapted_bundle.py",
    ".github/workflows/scenario-contract-matrix.yml",
  ]);
  if (sharedScenarioRelevant || full) {
    for (const id of SCENARIO_CONTRACT_IDS) scenarioIds.add(id);
  }

  const transportRelevant = matches([
    "data/transport_layers/**", "tools/check_transport_workbench_manifests.py",
    "tools/build_transport_workbench_*", "tools/build_global_transport_*",
    "tests/test_transport_*", "tests/test_global_transport_builder_contracts.py",
    ".github/workflows/transport-contract-required.yml",
  ]);

  const perfRelevant = runtimeRelevant || matches([
    "data/scenarios/tno_1962/**", "data/scenarios/hoi4_1939/**",
    "data/scenarios/index.json", "tools/perf/**", "tools/dev_server.py",
    "requirements-perf.lock.txt", "playwright.config.cjs",
  ]);
  let perfMode = perfRelevant ? "sample" : "skip";
  if (labelSet.has("ci:perf-strict") || full) perfMode = "strict";
  if (labelSet.has("ci:perf-expected") && perfMode === "strict" && !labelSet.has("ci:perf-strict")) perfMode = "sample";

  return {
    schemaVersion: 1,
    changedFiles: files,
    labels: [...labelSet].sort(),
    runFast: true,
    runSmoke: full || browserRelevant,
    runDemo: full || publicSampleRelevant,
    runPages: full || pagesRelevant,
    scenarioIds: [...scenarioIds].sort(),
    runTransport: full || transportRelevant,
    perfMode,
    expectedPerformanceChange: labelSet.has("ci:perf-expected"),
  };
}

function parseArgs(argv) {
  const args = { changedFiles: null, labels: "", jsonOut: null, githubOutput: null };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--changed-files") args.changedFiles = argv[++i];
    else if (value === "--labels") args.labels = argv[++i] || "";
    else if (value === "--json-out") args.jsonOut = argv[++i];
    else if (value === "--github-output") args.githubOutput = argv[++i];
    else throw new Error(`unknown argument: ${value}`);
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = args.changedFiles
    ? fs.readFileSync(args.changedFiles, "utf8").split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : [];
  const labels = String(args.labels || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  const plan = planPullRequest({ changedFiles, labels });
  const json = `${JSON.stringify(plan, null, 2)}\n`;
  if (args.jsonOut) {
    fs.mkdirSync(path.dirname(args.jsonOut), { recursive: true });
    fs.writeFileSync(args.jsonOut, json, "utf8");
  } else {
    process.stdout.write(json);
  }
  if (args.githubOutput) {
    const lines = [
      `run_fast=${plan.runFast}`,
      `run_smoke=${plan.runSmoke}`,
      `run_demo=${plan.runDemo}`,
      `run_pages=${plan.runPages}`,
      `scenario_ids=${JSON.stringify(plan.scenarioIds)}`,
      `run_transport=${plan.runTransport}`,
      `perf_mode=${plan.perfMode}`,
      `expected_performance_change=${plan.expectedPerformanceChange}`,
    ];
    fs.appendFileSync(args.githubOutput, `${lines.join("\n")}\n`, "utf8");
  }
}

const runningAsCli = process.argv[1]
  && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (runningAsCli) main();
