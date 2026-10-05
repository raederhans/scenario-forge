import fs from "node:fs";
import { classifyPerformance, isBoundedUiChange, isOrdinaryDocumentation, packageChangeRequiresPerformance } from "./perf_policy.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const normalize = (value) => String(value || "").replaceAll("\\", "/").trim();
export const SCENARIO_CONTRACT_IDS = Object.freeze([
  "blank_base", "hgo_1936", "hoi4_1936", "hoi4_1939", "modern_world", "tno_1962",
]);

export function planPullRequest({ changedFiles = [], labels = [], packageRequiresPerf = true } = {}) {
  const files = [...new Set(changedFiles.map(normalize).filter(Boolean))].sort();
  const labelSet = new Set(labels.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
  const full = labelSet.has("ci:full");
  const docsOnly = files.length > 0 && files.every(isOrdinaryDocumentation);
  const boundedUi = isBoundedUiChange(files);

  const matches = (patterns) => files.some((file) => patterns.some((pattern) => (
    pattern.endsWith("/**") ? file.startsWith(pattern.slice(0, -2)) :
    pattern.endsWith("*") ? file.startsWith(pattern.slice(0, -1)) :
    pattern.endsWith("/") ? file.startsWith(pattern) :
    pattern.startsWith("*.") ? file.endsWith(pattern.slice(1)) :
    file === pattern
  )));

  const runtimeRelevant = matches(["js/**", "css/**", "index.html", "vendor/**", "landing/**"]);
  const controlPlane = matches(["tools/ci/**", ".github/workflows/pr-verify.yml", ".github/workflows/verify-shared.yml"]);
  const dependencyChange = matches(["package.json", "package-lock.json"])
    || files.some((file) => /^requirements[^/]*\.txt$/u.test(file));
  const browserRelevant = runtimeRelevant || controlPlane || dependencyChange
    || matches(["tests/e2e/**", "playwright.config.cjs", "tools/e2e_layering.mjs"]);
  // Source-only changes validate their live reference graph. Changes to packaging,
  // public assets or dependencies still exercise the complete built artifact.
  // These renderer contracts compare built mirrors byte-for-byte. Supply a fresh
  // artifact before selecting them instead of comparing against historical dist.
  const rendererMirrorRelevant = matches([
    "js/core/map_renderer.js",
    "js/core/map_renderer/draw_canvas_orchestration_owner.js",
    "js/core/map_renderer/transformed_frame_compositor_owner.js",
    "js/core/renderer/cached_pass_compositor_owner.js",
    "tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs",
  ]);
  const pagesFull = full || controlPlane || dependencyChange || rendererMirrorRelevant || matches([
    "data/**", "dist/**", "vendor/**", "landing/**", "index.html", "app.js", "styles.css",
    "tools/build_pages_dist.py", "tools/pages_*", "tools/app_entry_resolver.py",
    "tools/check_pages_source_graph.py", "tools/build_landing_*", "tools/runtime_json_packing.py",
    "tests/test_pages*", "tests/test_landing*",
  ]);
  const pagesMode = pagesFull ? "full" : runtimeRelevant ? "source" : "none";
  const smokeMode = full || browserRelevant ? (!full && boundedUi ? "ui" : "full") : "none";
  const publicSampleRelevant = matches([
    "js/bootstrap/startup_sample_project_deeplink.js",
    "js/core/sample_project_import_workflow.js",
    "js/core/sample_project_registry.js",
    "landing/**",
    "tests/e2e/sample_guide_deeplink.spec.js",
    "tools/ci/**", ".github/workflows/pr-verify.yml",
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

  const performance = classifyPerformance({ changedFiles: files, labels: [...labelSet], packageRequiresPerf });

  return {
    schemaVersion: 2,
    changedFiles: files,
    labels: [...labelSet].sort(),
    riskTier: full || controlPlane || dependencyChange ? "integration" : docsOnly ? "docs" : boundedUi ? "ui" : "affected",
    runFast: full || !docsOnly,
    runSmoke: smokeMode !== "none",
    smokeMode,
    runDemo: full || publicSampleRelevant,
    runPages: pagesMode === "full",
    pagesMode,
    runPagesSource: pagesMode === "source",
    scenarioIds: [...scenarioIds].sort(),
    runTransport: full || transportRelevant,
    perfMode: performance.perf_mode,
    perfRequired: performance.required_for_merge,
    perfDiagnostic: performance.diagnostic_only,
    expectedPerformanceChange: labelSet.has("ci:perf-expected"),
    reasons: {
      fast: docsOnly && !full ? "Ordinary documentation only; no test environment is needed." : "Run affected contracts and reject unresolved verification coverage.",
      smoke: smokeMode === "ui" ? "All behavioral changes belong to the bounded UI scope; run focused shell and editor checks."
        : smokeMode === "full" ? "Runtime, browser support, dependencies or CI policy require the shared smoke suite." : "No browser behavior selected.",
      pages: pagesMode === "full" ? "Delivery inputs, assets, dependencies or CI policy require a full Pages artifact."
        : pagesMode === "source" ? "Validate the current source reference graph without rebuilding unchanged data." : "No Pages inputs selected.",
      performance: performance.diagnostic_only ? "Bounded UI change: candidate sampling is diagnostic and does not delay the merge gate."
        : performance.required_for_merge ? "Performance measurement must complete before the required gate succeeds." : "No performance measurement selected.",
    },
  };
}

function parseArgs(argv) {
  const args = { changedFiles: null, labels: "", jsonOut: null, githubOutput: null, basePackageFile: null, headPackageFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--changed-files") args.changedFiles = argv[++i];
    else if (value === "--labels") args.labels = argv[++i] || "";
    else if (value === "--json-out") args.jsonOut = argv[++i];
    else if (value === "--github-output") args.githubOutput = argv[++i];
    else if (value === "--base-package-file") args.basePackageFile = argv[++i];
    else if (value === "--head-package-file") args.headPackageFile = argv[++i];
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
  let packageRequiresPerf = true;
  if (changedFiles.some((file) => normalize(file) === "package.json")) {
    try {
      packageRequiresPerf = packageChangeRequiresPerformance({
        basePackageText: fs.readFileSync(args.basePackageFile, "utf8"),
        headPackageText: fs.readFileSync(args.headPackageFile, "utf8"),
      });
    } catch { /* Missing/unreadable manifests keep the conservative default. */ }
  }
  const plan = planPullRequest({ changedFiles, labels, packageRequiresPerf });
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
      `smoke_mode=${plan.smokeMode}`,
      `run_demo=${plan.runDemo}`,
      `run_pages=${plan.runPages}`,
      `pages_mode=${plan.pagesMode}`,
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
