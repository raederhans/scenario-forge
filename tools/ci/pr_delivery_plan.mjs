import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { planPullRequest } from "./pr_plan.mjs";
import { packageChangeRequiresPerformance } from "./perf_policy.mjs";
import { discoverWorkspaceChangedFiles } from "../verification/workspace_changes.mjs";
import { prepareRepositoryVerificationCatalogBinding } from "../verification/script_portfolio.mjs";
import { buildPrCostObservation } from "../verification/verification_profile.mjs";
import { buildRecommendation } from "../select_verification_targets.mjs";
import { buildRouteIndex } from "../test_route_registry.mjs";
import { buildExecutionPlan } from "../run_adaptive_tests.mjs";

const sortedUnique = (values) => [...new Set(values)].sort();
const errorWithCode = (code, detail) => Object.assign(new Error(`${code}: ${detail}`), { code });

export function parsePrDeliveryArgs(argv = []) {
  const args = { base: "origin/main", changedFiles: null, labels: [], json: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") args.json = true;
    else if (arg === "--help" || arg === "-h") args.help = true;
    else if (["--base", "--changed-file", "--labels"].includes(arg)) {
      const value = argv[++index];
      if (value === undefined || value.startsWith("--") || !value.trim()) {
        throw errorWithCode("pr-delivery-option-value-missing", arg);
      }
      if (arg === "--base") args.base = value;
      else if (arg === "--labels") args.labels.push(...value.split(",").map((label) => label.trim()).filter(Boolean));
      else (args.changedFiles ||= []).push(value);
    } else throw errorWithCode("pr-delivery-unknown-argument", arg);
  }
  args.labels = sortedUnique(args.labels.map((label) => label.toLowerCase()));
  return args;
}

// Keep argv authoritative. Rendered commands are for copying into the named shell.
export function describeCommand(bin, args) {
  const tokens = [bin, ...args];
  return {
    bin, args,
    powershell: `& ${tokens.map((token) => `'${String(token).replaceAll("'", "''")}'`).join(" ")}`,
    posix: tokens.map((token) => `'${String(token).replaceAll("'", "'\"'\"'")}'`).join(" "),
  };
}

export function selectRepositoryLocalPlan({ changedFiles, cwd = process.cwd() }) {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(cwd, "package.json"), "utf8")).scripts || {};
  const routes = buildRouteIndex();
  const binding = prepareRepositoryVerificationCatalogBinding({ packageScripts, selectorRoutes: routes, repoRoot: cwd });
  const selectorStartedAt = performance.now();
  const boundSelection = binding.bindSelectionReport(buildRecommendation(changedFiles, routes, {
    routeAuthority: binding.preparedCatalog.authority,
  }));
  const report = {
    ...boundSelection,
    prCost: buildPrCostObservation({
      selectorReport: boundSelection,
      observationStage: "selector",
      timingInputs: { selectorMs: { value: performance.now() - selectorStartedAt, source: "local-monotonic-clock" } },
    }),
    adaptiveMode: "dry-run",
    mainThreadDisposition: "deferred",
  };
  const executionPlan = buildExecutionPlan(report, {
    packageScripts, preparedCatalog: binding.preparedCatalog, includeMainThread: false,
  });
  return { report, executionPlan };
}

export function buildPrDeliveryPlan({
  cwd = process.cwd(), base = "origin/main", changedFiles = null, labels = [],
} = {}, {
  runner = spawnSync, selectLocal = selectRepositoryLocalPlan, ciPlanner = planPullRequest,
} = {}) {
  const git = (args, code, allowDetached = false) => {
    const result = runner("git", args, { cwd, encoding: "utf8", shell: false, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" } });
    if (allowDetached && result.status === 1) return null;
    if (result.error || result.status !== 0) {
      throw errorWithCode(code, String(result.error?.message || result.stderr || args.join(" ")).trim());
    }
    return result.stdout;
  };
  const repoRoot = git(["rev-parse", "--show-toplevel"], "pr-delivery-repository-missing").trim();
  const headSha = git(["rev-parse", "--verify", "HEAD^{commit}"], "pr-delivery-head-missing").trim();
  const baseSha = git(["rev-parse", "--verify", "--end-of-options", `${base}^{commit}`], "pr-delivery-base-missing").trim();
  const branch = git(["symbolic-ref", "--quiet", "--short", "HEAD"], "pr-delivery-branch-failed", true)?.trim() || null;
  const mergeBaseSha = git(["merge-base", baseSha, headSha], "pr-delivery-merge-base-missing").trim();
  const [behind, ahead] = git(["rev-list", "--left-right", "--count", `${baseSha}...${headSha}`], "pr-delivery-divergence-failed")
    .trim().split(/\s+/u).map(Number);
  const committedChangedFiles = sortedUnique(git([
    "diff", "--name-only", "--no-renames", "-z", `${baseSha}...${headSha}`, "--",
  ], "pr-delivery-committed-diff-failed").split("\0").filter(Boolean));
  const workspaceChangedFiles = discoverWorkspaceChangedFiles({
    cwd: repoRoot,
    runner: (bin, args, options) => runner(bin, args, {
      ...options, env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
    }),
    failureCode: "pr-delivery-workspace-discovery-failed",
  });
  const unionChangedFiles = sortedUnique([...committedChangedFiles, ...workspaceChangedFiles]);
  const predictedChangedFiles = changedFiles === null ? unionChangedFiles
    : sortedUnique(changedFiles.map((file) => String(file).replaceAll("\\", "/").replace(/^\.\//u, "")).filter(Boolean));
  const normalizedLabels = sortedUnique(labels.map((label) => String(label).trim().toLowerCase()).filter(Boolean));
  // Match the hosted classifier's specified base SHA, not mergeBaseSha. The
  // preview compares that base with the workspace, including uncommitted edits.
  const readManifest = (revision) => git(["show", `${revision}:package.json`], "pr-delivery-package-read-failed");
  let basePackageText;
  if (committedChangedFiles.includes("package.json") || predictedChangedFiles.includes("package.json")) {
    try { basePackageText = readManifest(baseSha); } catch { /* Missing content requires measurement. */ }
  }
  const packageRequiresPerf = (files, readHead) => {
    if (!files.includes("package.json")) return true;
    try { return packageChangeRequiresPerformance({ basePackageText, headPackageText: readHead() }); }
    catch { return true; }
  };
  const committedPackageRequiresPerf = packageRequiresPerf(committedChangedFiles, () => readManifest(headSha));
  const predictedPackageRequiresPerf = packageRequiresPerf(predictedChangedFiles,
    () => fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  let selection;
  try {
    selection = selectLocal({ changedFiles: predictedChangedFiles, cwd: repoRoot });
    if (!selection?.report || !selection?.executionPlan
      || !Array.isArray(selection.report.unmatchedChangedFiles) || !Array.isArray(selection.executionPlan.routeGaps)) {
      throw errorWithCode("pr-delivery-selector-result-invalid", "expected report and executionPlan");
    }
  } catch (error) {
    selection = {
      report: { unmatchedChangedFiles: [] },
      executionPlan: { routeGaps: [{ code: error.code || "pr-delivery-selector-failed", detail: error.message }] },
    };
  }
  const { report, executionPlan } = selection;
  const blocked = report.unmatchedChangedFiles.length > 0 || executionPlan.routeGaps.length > 0;
  const commands = (groups) => (groups || []).map((group) => ({
    ...group, ...(group.process ? { command: describeCommand(group.process.bin, group.process.args) } : {}),
  }));
  return {
    schemaVersion: 1,
    kind: "pr-delivery-plan",
    readOnly: true,
    status: blocked ? "blocked" : "planned",
    exitCode: blocked ? 2 : 0,
    evidence: "Plan only; no tests executed or passed. CI sees committed diff only, not workspace or explicit preview files.",
    git: { repoRoot, branch, headSha, baseRef: base, baseSha, mergeBaseSha, ahead, behind, dirty: workspaceChangedFiles.length > 0 },
    scope: {
      mode: changedFiles === null ? "committed-plus-workspace" : "explicit-preview",
      committedChangedFiles, workspaceChangedFiles, unionChangedFiles, predictedChangedFiles,
    },
    labels: normalizedLabels,
    ci: {
      committed: ciPlanner({ changedFiles: committedChangedFiles, labels: normalizedLabels, packageRequiresPerf: committedPackageRequiresPerf }),
      predicted: ciPlanner({ changedFiles: predictedChangedFiles, labels: normalizedLabels, packageRequiresPerf: predictedPackageRequiresPerf }),
    },
    local: {
      selectedChildSafeCommands: executionPlan.commandsToRun || [],
      deferredMainThreadCommands: executionPlan.blockedMainThreadCommands || [],
      deferredCiOnlyCommands: executionPlan.deferredCiOnlyCommands || [],
      selectedProcesses: blocked ? [] : commands(executionPlan.executionCommands),
      deferredMainThreadProcesses: commands(executionPlan.deferredMainThreadGroups),
      unmatchedChangedFiles: report.unmatchedChangedFiles,
      routeGaps: executionPlan.routeGaps,
      nonBehavioralChangedFiles: report.nonBehavioralChangedFiles || [],
      diagnosticNextSteps: report.diagnosticNextSteps || [],
      suggestedEntrypoints: blocked ? [] : commands(executionPlan.executionCommands)
        .map((group) => group.command).filter(Boolean),
      executionPlan,
    },
  };
}

export function renderPrDeliveryPlan(plan) {
  const files = (title, values) => [title, ...(values.length ? values.map((value) => `  ${JSON.stringify(value)}`) : ["  (none)"])];
  const ciSummary = (ciPlan) => Object.entries(ciPlan)
    .filter(([key]) => !["changedFiles", "labels", "schemaVersion"].includes(key))
    .map(([key, value]) => `  ${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
  const git = plan.git;
  return [
    `PR delivery: ${plan.status} (planning only; tests have not run)`,
    `Branch: ${git.branch || "(detached HEAD)"}  HEAD: ${git.headSha}`,
    `Base: ${git.baseRef} (${git.baseSha})  Merge base: ${git.mergeBaseSha}`,
    `Ahead: ${git.ahead}  Behind: ${git.behind}  Dirty: ${git.dirty}`,
    `Labels: ${plan.labels.join(", ") || "(none)"}`,
    ...files("Committed diff (CI actually sees this scope):", plan.scope.committedChangedFiles),
    ...files("Workspace changes (not yet in CI):", plan.scope.workspaceChangedFiles),
    `Committed + workspace union: ${plan.scope.unionChangedFiles.length} path(s)`,
    ...(plan.scope.mode === "explicit-preview"
      ? files("Explicit prediction scope (preview only):", plan.scope.predictedChangedFiles)
      : [`Prediction scope: committed + workspace union (${plan.scope.predictedChangedFiles.length} path(s))`]),
    "CI committed plan:", ...ciSummary(plan.ci.committed),
    "CI predicted plan (preview only):", ...ciSummary(plan.ci.predicted),
    ...files("Selected child-safe commands:", plan.local.selectedChildSafeCommands),
    ...files("Deferred main-thread commands (not passed):", plan.local.deferredMainThreadCommands),
    ...files("Deferred CI-only commands (not passed):", plan.local.deferredCiOnlyCommands),
    ...files("Unmatched changed files:", plan.local.unmatchedChangedFiles),
    ...files("Route gaps:", plan.local.routeGaps.map((gap) => JSON.stringify(gap))),
    "Selected local processes (run separately):",
    ...(plan.local.suggestedEntrypoints.length
      ? plan.local.suggestedEntrypoints.map((command) => `  ${process.platform === "win32" ? command.powershell : command.posix}`)
      : ["  (none; no selected behavior checks or blocked plan)"]),
    plan.evidence,
  ].join("\n") + "\n";
}

const HELP = `Usage: node tools/ci/pr_delivery_plan.mjs [--json] [--base <ref>]
       [--changed-file <path> ...] [--labels <comma-separated labels>] [--help]
Read-only: no fetch, files written, tests executed, or push.
Default: origin/main...HEAD committed diff plus workspace changes for prediction.
--changed-file replaces the prediction scope only; committed CI scope is still shown.
Missing base/HEAD/merge base and selector/route gaps fail closed. Plan is not pass evidence.
`;

export function runPrDeliveryPlanCli(argv = process.argv.slice(2), {
  stdout = process.stdout, stderr = process.stderr, ...dependencies
} = {}) {
  try {
    const args = parsePrDeliveryArgs(argv);
    if (args.help) { stdout.write(HELP); return 0; }
    const plan = buildPrDeliveryPlan(args, dependencies);
    stdout.write(args.json ? `${JSON.stringify(plan, null, 2)}\n` : renderPrDeliveryPlan(plan));
    return plan.exitCode;
  } catch (error) {
    if (argv.includes("--json")) stdout.write(`${JSON.stringify({ status: "error", exitCode: 2, code: error.code || "pr-delivery-failed", message: error.message })}\n`);
    else stderr.write(`${error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = runPrDeliveryPlanCli();
}
