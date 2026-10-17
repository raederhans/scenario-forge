import fs from "node:fs";
import path from "node:path";
import { spawnSync, execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { buildRouteIndex } from "../test_route_registry.mjs";
import { prepareRepositoryVerificationCatalog, buildVerificationSelectionPlan } from "../verification/script_portfolio.mjs";
import { discoverWorkspaceChangedFiles } from "../verification/workspace_changes.mjs";

// A small invariant core supplements, rather than replaces, the authored routes.
export const CORE_TESTS = [
  "startup_failure_recovery_behavior", "startup_ready_handoff_behavior",
  "file_manager_project_roundtrip_behavior", "project_package_stream_import_behavior",
  "scenario_import_trust_projection_behavior", "quick_fill_history", "backend_client_behavior",
  "political_id_raster_assets_behavior", "geometry_cache_budget_behavior",
].map(name => `tests/${name}.test.mjs`);

// Exact maintenance entrypoints only. Product/action/geometry suites, including
// tests with 'boundary', 'inventory' or 'retirement' in their names, remain routed.
export const MANUAL_COMMANDS = new Set([
  "verify:pages-dist-and-drift",
  "test:node:williams-crossover-governance", "test:node:williams-crossover-job-runner",
  "perf:williams-crossover:run", "perf:williams-power-scheme:live-preflight",
  "test:node:williams-crossover-telemetry-live",
  "verify:local-infra", "verify:script-portfolio", "verify:supervisor-contracts",
  "node tools/select_verification_targets.mjs --check",
  "test:node:verification-profile", "test:node:verification-metadata",
  "test:node:verify-core-runner", "test:node:catalog-projection-history",
  "test:node:supervisor-contracts", "test:node:supervisor-routing", "test:node:supervisor-plan",
  "verify:p4:state-writer-policy", "test:node:p4:state-writer-policy",
  "test:node:p4:state-writer-policy:quick", "test:node:p4:phase-verification-runner",
  ...["1", "2a", "2b", "2c", "3", "4"].map(phase => `verify:p4:p4-${phase}`),
  "node --test tests/state_target_private_cache_contract_behavior.test.mjs",
  "node --test tests/state_borrowed_effect_contract_behavior.test.mjs",
  "node --test tests/verify_commit_runner_behavior.test.mjs",
]);
const MANUAL_FILES = new Set([
  "tests/verify_core_runner_behavior.test.mjs", "tests/verify_commit_runner_behavior.test.mjs",
  "tests/verification_metadata_behavior.test.mjs", "tests/verification_profile_behavior.test.mjs",
  "tests/verification_script_portfolio_behavior.test.mjs", "tests/catalog_projection_shadow_behavior.test.mjs",
  "tests/p4_phase_verification_runner_behavior.test.mjs", "tests/p4_nightly_parallel_authorities_behavior.test.mjs",
  "tests/p4_nightly_exact_repair_behavior.test.mjs", "tests/state_target_private_cache_contract_behavior.test.mjs",
  "tests/state_borrowed_effect_contract_behavior.test.mjs",
]);
const routes = buildRouteIndex();
const refs = route => route.sourceRef.split(",").map(value => value.trim());
const matches = (file, source) => file === source || (!/\.[^/]+$/.test(source) && file.startsWith(`${source.replace(/\/$/, "")}/`));
const ordinary = file => file.endsWith(".md") || file.startsWith("dist/");
const unique = values => [...new Set(values)].sort();
const sampleGuide = "tests/e2e/sample_guide_deeplink.spec.js";

function changedScripts(cwd, base) {
  try {
    const before = JSON.parse(execFileSync("git", ["show", `${base}:package.json`], { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    const after = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8"));
    const { scripts: a = {}, ...restA } = before, { scripts: b = {}, ...restB } = after;
    if (JSON.stringify(restA) !== JSON.stringify(restB)) return null;
    const affected = new Set(unique([...Object.keys(a), ...Object.keys(b)]).filter(key => a[key] !== b[key]));
    // A changed npm alias also affects callers retained in the authored routes.
    for (let grew = true; grew;) {
      grew = false;
      for (const [name, command] of Object.entries(b)) {
        if (!affected.has(name) && [...String(command).matchAll(/npm run ([\w:.-]+)/g)].some(match => affected.has(match[1]))) {
          affected.add(name); grew = true;
        }
      }
    }
    return affected;
  } catch { return null; }
}

export function selectPrChecks(changedFiles, { cwd = process.cwd(), base = "origin/main", ci = Boolean(process.env.CI) } = {}) {
  const files = unique(changedFiles.map(file => String(file).replaceAll("\\", "/").replace(/^\.\//, "")));
  if (files.some(file => !file || path.isAbsolute(file) || file.split("/").includes(".."))) throw new Error("Changed files must be repository-relative paths");
  const scripts = files.includes("package.json") ? changedScripts(cwd, base) : null;
  const selected = new Set(), deferred = new Set(), unmatchedChangedFiles = [];
  const directNode = new Set(), directPython = new Set(), directBrowser = new Set();
  const related = (route, file) => refs(route).some(source => {
    if (file === "package.json" && scripts !== null) return scripts.has(route.commandRef);
    if (matches(file, source)) return true;
    // Assets in a scenario share its manifest contract even when only a payload changes.
    const scenario = /^data\/scenarios\/([^/]+)\//.exec(file);
    return scenario && source.startsWith(`data/scenarios/${scenario[1]}/`);
  });
  for (const file of files) {
    if (ordinary(file)) continue;
    const found = routes.filter(route => related(route, file));
    for (const route of found) (MANUAL_COMMANDS.has(route.commandRef) ? deferred : selected).add(route.commandRef);
    let direct = false;
    if (/^tests\/.*\.test\.mjs$/.test(file)) { directNode.add(file); direct = true; }
    if (/^tests\/.*test_[^/]+\.py$/.test(file)) { directPython.add(file); direct = true; }
    if (/^tests\/e2e\/.*\.spec\.js$/.test(file)) { directBrowser.add(file); direct = true; }
    const ci = file.startsWith("tools/ci/") || file.startsWith(".github/workflows/") || file === "package.json";
    if (ci) { directNode.add("tests/pr_ci_plan_behavior.test.mjs"); directNode.add("tests/pr_delivery_lanes_behavior.test.mjs"); directNode.add("tests/pr_check_selection_behavior.test.mjs"); }
    if (!found.length && !direct && file !== "package.json" && file !== "tools/ci/run_pr_checks.mjs") unmatchedChangedFiles.push(file);
  }
  if (files.some(file => /^(?:js\/ui\/|css\/|js\/core\/export|js\/core\/state\/actions\/export|js\/bootstrap\/startup_sample|js\/core\/sample_project|landing\/|index\.html$)/.test(file))) directBrowser.add(sampleGuide);
  if (files.some(file => /^(?:tools\/(?:build_pages_dist|pages_|runtime_json_packing)|tests\/test_pages|\.github\/workflows\/(?:deploy|verify-shared)\.yml)/.test(file))) {
    directPython.add("tests/test_pages_dist_startup_shell.py");
    directPython.add("tests/test_pages_artifact_admission.py");
  }
  const expanded = { executions: [] };
  // Expand each authored command using the existing parser and runner metadata.
  // Commands sharing a test may carry different ownership labels; serial execution
  // respects all reservations without turning that bookkeeping into a plan failure.
  if (selected.size) {
    const preparedCatalog = prepareRepositoryVerificationCatalog({ repoRoot: cwd });
    for (const root of selected) expanded.executions.push(...buildVerificationSelectionPlan(
      preparedCatalog.catalog, [root], { preparedCatalog, platform: process.platform },
    ).executions);
  }
  const commands = [], nodeTests = new Set(), pythonTests = new Set(), browserTests = new Set();
  // Use the existing expansion and safety metadata. Preserve runner options,
  // sequencing and reserved-resource isolation; only identical commands dedupe.
  const seenNode = new Set(), seenPython = new Set();
  for (const execution of expanded.executions) {
    // The existing Playwright config intentionally excludes dev probes on CI.
    // Report them as local-only instead of launching a misleading zero-test run.
    if (ci && execution.runner === "playwright" && execution.specs.every(file => file.startsWith("tests/e2e/dev/"))) {
      execution.specs.forEach(file => deferred.add(`local-only browser: ${file}`)); continue;
    }
    let bin = execution.executable, args = execution.effectiveArgv;
    if (["python-unittest", "python-pytest", "python-script"].includes(execution.runner)) {
      bin = "python";
      const logical = execution.logicalArgv;
      args = execution.logicalExecutable === "npm" ? logical.slice(logical.indexOf("--") + 1)
        : execution.logicalExecutable === "node" ? logical.slice(1) : logical;
    }
    if (["python-unittest", "python-pytest"].includes(execution.runner)) {
      const targets = new Set([...execution.files, ...execution.modules]);
      const flags = args.filter(arg => !targets.has(arg));
      const fresh = new Set([...targets].filter(target => {
        const key = JSON.stringify([execution.runner, target, flags]);
        if (seenPython.has(key)) return false;
        seenPython.add(key); return true;
      }));
      if (!fresh.size) continue;
      args = args.filter(arg => !targets.has(arg) || fresh.has(arg));
    }
    if (execution.runner === "node-test") {
      const fresh = execution.files.filter(file => {
        if (MANUAL_FILES.has(file)) { deferred.add(file); return false; }
        const key = JSON.stringify([file, execution.runnerArgs, execution.forwardedArgs]);
        if (seenNode.has(key)) return false;
        seenNode.add(key); nodeTests.add(file); return true;
      });
      if (!fresh.length) continue;
      args = ["--test", ...execution.runnerArgs, ...fresh, ...execution.forwardedArgs];
      bin = process.execPath;
    }
    if (execution.runner.startsWith("python")) [...execution.files, ...execution.modules].forEach(file => pythonTests.add(file));
    if (execution.runner === "playwright") execution.specs.forEach(file => browserTests.add(file));
    commands.push({ bin, args, lane: execution.runner === "playwright" ? "browser" : "unit", runner: execution.runner, resourceLocks: execution.resourceLocks });
  }
  if (files.some(file => !ordinary(file))) CORE_TESTS.forEach(file => directNode.add(file));
  for (const file of directNode) if (MANUAL_FILES.has(file)) deferred.add(file); else if (!nodeTests.has(file)) { nodeTests.add(file); commands.push({ bin: process.execPath, args: ["--test", file], lane: "unit", runner: "node-test", resourceLocks: [] }); }
  // pytest also collects unittest.TestCase; direct edits must never run zero
  // function-style tests merely because the caller guessed the wrong framework.
  for (const file of directPython) if (!pythonTests.has(file) && !pythonTests.has(file.slice(0, -3).replaceAll("/", "."))) {
    pythonTests.add(file); commands.push({ bin: "python", args: ["-m", "pytest", file, "-q"], lane: "unit", runner: "python-pytest", resourceLocks: [] });
  }
  for (const file of directBrowser) if (ci && file.startsWith("tests/e2e/dev/")) deferred.add(`local-only browser: ${file}`); else if (!browserTests.has(file)) { browserTests.add(file); commands.push({ bin: process.execPath, args: ["node_modules/@playwright/test/cli.js", "test", file, "--workers=1", "--retries=0"], lane: "browser", runner: "playwright", resourceLocks: ["browser-dev-server"] }); }
  const distinct = [...new Map(commands.map(command => [JSON.stringify([command.bin, command.args]), command])).values()];
  return { changedFiles: files, nodeTests: unique(nodeTests), pythonTests: unique(pythonTests), browserTests: unique(browserTests), deferred: [...deferred].sort(), unmatchedChangedFiles, commands: distinct };
}

export function discoverPrChanges({ cwd = process.cwd(), base = "origin/main" } = {}) {
  const committed = execFileSync("git", ["diff", "--name-only", "--no-renames", "-z", `${base}...HEAD`, "--"], { cwd, encoding: "utf8" }).split("\0").filter(Boolean);
  return unique([...committed, ...discoverWorkspaceChangedFiles({ cwd })]);
}

export function runPrChecks(argv = process.argv.slice(2), { cwd = process.cwd(), runner = spawnSync } = {}) {
  let files = [], explicit = false, list = false, base = "origin/main", lane = "all";
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list") list = true;
    else if (["--changed-file", "--changed-files-list", "--base", "--lane"].includes(arg)) {
      const value = argv[++i];
      if (!value || value.startsWith("--")) throw new Error(`Missing value for ${arg}`);
      if (arg === "--base") base = value;
      else if (arg === "--lane") lane = value;
      else { explicit = true; files.push(...(arg === "--changed-file" ? [value] : fs.readFileSync(path.resolve(cwd, value), "utf8").replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean))); }
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!["unit", "browser", "all"].includes(lane)) throw new Error(`Unknown lane: ${lane}`);
  if (explicit && !files.length) throw new Error("Changed-file input is empty");
  if (!explicit) files = discoverPrChanges({ cwd, base });
  const selection = selectPrChecks(files, { cwd, base });
  console.log(JSON.stringify(selection, null, 2));
  if (selection.unmatchedChangedFiles.length) throw new Error(`Unmapped changed files: ${selection.unmatchedChangedFiles.join(", ")}`);
  if (list) return 0;
  const tmp = path.join(cwd, ".runtime", "tmp");
  fs.mkdirSync(tmp, { recursive: true });
  // A preceding smoke command used the base port. dev_server intentionally does
  // not reuse sockets, so use a separate port for each sequential browser run.
  let nextBrowserPort = Number(process.env.PLAYWRIGHT_TEST_SERVER_PORT || process.env.MAPCREATOR_DEV_PORT || 8810) + 1;
  for (const command of selection.commands.filter(command => lane === "all" || command.lane === lane)) {
    const browserEnv = command.lane === "browser"
      ? { MAPCREATOR_DEV_PORT: String(nextBrowserPort), PLAYWRIGHT_TEST_SERVER_PORT: String(nextBrowserPort++) } : {};
    const result = runner(command.bin, command.args, { cwd, stdio: "inherit", shell: false,
      env: { ...process.env, ...browserEnv, TMPDIR: tmp, TEMP: tmp, TMP: tmp, PYTHONDONTWRITEBYTECODE: "1" } });
    if (result.error || result.status !== 0) return result.status || 1;
  }
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { process.exitCode = runPrChecks(); }
  catch (error) { console.error(error.message); process.exitCode = 2; }
}
