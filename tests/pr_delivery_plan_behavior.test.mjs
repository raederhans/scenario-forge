import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  buildPrDeliveryPlan, describeCommand, parsePrDeliveryArgs, renderPrDeliveryPlan,
  runPrDeliveryPlanCli, selectRepositoryLocalPlan,
} from "../tools/ci/pr_delivery_plan.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(REPO_ROOT, "tools/ci/pr_delivery_plan.mjs");
const selectEmpty = ({ changedFiles }) => ({
  report: { changedFiles, unmatchedChangedFiles: [] },
  executionPlan: { commandsToRun: [], routeGaps: [] },
});

function fixture(t) {
  const fixtureRoot = path.join(REPO_ROOT, ".runtime", "tmp");
  fs.mkdirSync(fixtureRoot, { recursive: true });
  const cwd = fs.mkdtempSync(path.join(fixtureRoot, "pr-delivery-"));
  t.after(() => {
    assert.equal(path.dirname(cwd), fixtureRoot);
    fs.rmSync(cwd, { recursive: true, force: true });
  });
  const git = (...args) => {
    const result = spawnSync("git", args, { cwd, encoding: "utf8", shell: false });
    assert.equal(result.status, 0, `${args.join(" ")}: ${result.stderr}`);
    return result.stdout.trim();
  };
  const write = (name, content = name) => {
    fs.mkdirSync(path.dirname(path.join(cwd, name)), { recursive: true });
    fs.writeFileSync(path.join(cwd, name), content);
  };
  git("init", "--initial-branch=main");
  git("config", "user.email", "fixture@example.invalid");
  git("config", "user.name", "Delivery fixture");
  write("base.txt");
  write("old name.txt", "same rename content");
  write("delete.txt");
  git("add", ".");
  git("commit", "-m", "base");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  git("checkout", "-b", "feature");
  return { cwd, git, write, plan: (options = {}, dependencies = {}) => buildPrDeliveryPlan(
    { cwd, ...options }, { selectLocal: selectEmpty, ...dependencies },
  ) };
}

function snapshot(root) {
  const result = {};
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const name = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(name);
      else result[path.relative(root, name)] = fs.readFileSync(name);
    }
  };
  visit(root);
  return result;
}

test("committed triple-dot scope, workspace, and CI prediction stay distinct", (t) => {
  const f = fixture(t);
  f.write("committed.txt");
  f.git("add", ".");
  f.git("commit", "-m", "feature change");
  f.write("base.txt", "dirty");
  f.write("untracked space.txt");
  const plan = f.plan();
  assert.equal(plan.git.branch, "feature");
  assert.equal(plan.git.headSha, f.git("rev-parse", "HEAD"));
  assert.equal(plan.git.baseSha, f.git("rev-parse", "origin/main"));
  assert.equal(plan.git.ahead, 1);
  assert.equal(plan.git.behind, 0);
  assert.equal(plan.git.dirty, true);
  assert.deepEqual(plan.scope.committedChangedFiles, ["committed.txt"]);
  assert.deepEqual(plan.scope.workspaceChangedFiles, ["base.txt", "untracked space.txt"]);
  assert.deepEqual(plan.scope.unionChangedFiles, ["base.txt", "committed.txt", "untracked space.txt"]);
  assert.deepEqual(plan.ci.committed.changedFiles, ["committed.txt"]);
  assert.deepEqual(plan.ci.predicted.changedFiles, plan.scope.unionChangedFiles);
  assert.match(renderPrDeliveryPlan(plan), /CI actually sees this scope/);
  assert.match(renderPrDeliveryPlan(plan), /tests have not run/);
});

test("diverged base excludes base-only paths and reports ahead plus behind", (t) => {
  const f = fixture(t);
  f.write("feature.txt");
  f.git("add", "."); f.git("commit", "-m", "feature");
  f.git("checkout", "main");
  f.write("base-only.txt");
  f.git("add", "."); f.git("commit", "-m", "main");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  f.git("checkout", "feature");
  const plan = f.plan();
  assert.equal(plan.git.ahead, 1);
  assert.equal(plan.git.behind, 1);
  assert.deepEqual(plan.scope.committedChangedFiles, ["feature.txt"]);
  assert.notEqual(plan.git.mergeBaseSha, plan.git.baseSha);
});

test("committed rename and deletion retain former paths using no-renames", (t) => {
  const f = fixture(t);
  f.git("mv", "old name.txt", "new name.txt");
  f.git("rm", "delete.txt");
  f.git("commit", "-m", "rename and deletion");
  assert.deepEqual(f.plan().scope.committedChangedFiles, ["delete.txt", "new name.txt", "old name.txt"]);
});

test("workspace staged rename, unstaged deletion, and Unicode untracked names survive porcelain -z", (t) => {
  const f = fixture(t);
  f.git("mv", "old name.txt", "renamed name.txt");
  fs.unlinkSync(path.join(f.cwd, "delete.txt"));
  f.write("中文 spaced.txt");
  assert.deepEqual(f.plan().scope.workspaceChangedFiles,
    ["delete.txt", "old name.txt", "renamed name.txt", "中文 spaced.txt"]);
});

test("empty scope is valid and explicit preview never replaces committed CI scope", (t) => {
  const f = fixture(t);
  const empty = f.plan();
  assert.equal(empty.exitCode, 0);
  assert.deepEqual(empty.scope.predictedChangedFiles, []);
  assert.deepEqual(empty.local.suggestedEntrypoints, []);
  f.write("committed.txt"); f.git("add", "."); f.git("commit", "-m", "feature");
  f.write("workspace.txt");
  const plan = f.plan({ changedFiles: ["docs/explicit.md", "docs/explicit.md"] });
  assert.equal(plan.scope.mode, "explicit-preview");
  assert.deepEqual(plan.scope.predictedChangedFiles, ["docs/explicit.md"]);
  assert.deepEqual(plan.scope.unionChangedFiles, ["committed.txt", "workspace.txt"]);
  assert.deepEqual(plan.ci.committed.changedFiles, ["committed.txt"]);
  assert.deepEqual(plan.ci.predicted.changedFiles, ["docs/explicit.md"]);
  assert.deepEqual(f.plan({ changedFiles: [] }).scope.predictedChangedFiles, []);
});

test("missing base and unrelated history fail clearly before selector", (t) => {
  const f = fixture(t);
  const selectLocal = () => { assert.fail("must not select without base"); };
  assert.throws(() => f.plan({ base: "missing/ref" }, { selectLocal }), { code: "pr-delivery-base-missing" });
  const cli = spawnSync(process.execPath, [CLI, "--json", "--base", "missing/ref"], { cwd: f.cwd, encoding: "utf8" });
  assert.equal(cli.status, 2);
  assert.equal(JSON.parse(cli.stdout).code, "pr-delivery-base-missing");
  f.git("checkout", "--orphan", "unrelated");
  f.git("commit", "-m", "independent history");
  assert.throws(() => f.plan({}, { selectLocal }), { code: "pr-delivery-merge-base-missing" });
});

test("base overrides and detached HEAD bind immutable revisions", (t) => {
  const f = fixture(t);
  f.git("checkout", "--detach", "HEAD");
  const plan = f.plan({ base: "main" });
  assert.equal(plan.git.branch, null);
  assert.equal(plan.git.baseRef, "main");
  assert.equal(plan.git.dirty, false);
});

test("package prediction compares committed base/head separately from workspace and explicit preview", (t) => {
  const f = fixture(t);
  const base = { scripts: { "test:isolated": "node test.mjs" } };
  f.write("package.json", JSON.stringify(base));
  f.git("add", "."); f.git("commit", "-m", "manifest base");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  const isolated = { scripts: { "test:isolated": "node other.mjs" } };
  f.write("package.json", JSON.stringify(isolated));
  f.git("add", "."); f.git("commit", "-m", "isolated script");
  const exempt = f.plan();
  assert.equal(exempt.ci.committed.perfMode, "skip");
  assert.equal(exempt.ci.predicted.perfMode, "skip");
  f.write("package.json", JSON.stringify({ ...isolated, dependencies: { example: "1" } }));
  const dirty = f.plan();
  assert.equal(dirty.ci.committed.perfMode, "skip");
  assert.equal(dirty.ci.predicted.perfRequired, true);
  assert.equal(f.plan({ changedFiles: ["package.json"] }).ci.predicted.perfRequired, true);
  assert.equal(f.plan({ changedFiles: ["docs/preview.md"] }).ci.predicted.perfMode, "skip");
  f.write("package.json", "{invalid");
  assert.equal(f.plan().ci.predicted.perfRequired, true);
  fs.unlinkSync(path.join(f.cwd, "package.json"));
  assert.equal(f.plan().ci.predicted.perfRequired, true);
  const readFailure = f.plan({}, { runner: (bin, args, options) => args[0] === "show"
    ? { status: 1, stdout: "", stderr: "manifest unavailable" } : spawnSync(bin, args, options) });
  assert.equal(readFailure.ci.committed.perfRequired, true);
});

test("package policy uses specified base content rather than the diff merge base", (t) => {
  const f = fixture(t);
  const original = { scripts: { "test:isolated": "node test.mjs" } };
  f.write("package.json", JSON.stringify(original));
  f.git("add", "."); f.git("commit", "-m", "manifest base");
  const manifestBase = f.git("rev-parse", "HEAD");
  f.git("branch", "package-base");
  f.write("package.json", JSON.stringify({ scripts: { "test:isolated": "node changed.mjs" } }));
  f.git("add", "."); f.git("commit", "-m", "isolated script");
  f.git("checkout", "package-base");
  f.write("package.json", JSON.stringify({ ...original, engines: { node: ">=22" } }));
  f.git("add", "."); f.git("commit", "-m", "base engine change");
  f.git("update-ref", "refs/remotes/origin/main", "HEAD");
  f.git("checkout", "feature");
  const plan = f.plan();
  assert.equal(plan.git.mergeBaseSha, manifestBase);
  assert.notEqual(plan.git.baseSha, manifestBase);
  assert.equal(plan.ci.committed.perfRequired, true);
  assert.equal(plan.ci.predicted.perfRequired, true);
  assert.equal(f.plan({ base: manifestBase }).ci.committed.perfMode, "skip");
});

test("arguments parse repeated scope, labels, help and reject malformed flags", () => {
  assert.deepEqual(parsePrDeliveryArgs(["--changed-file", "a b.js", "--changed-file", "c.js", "--labels", " CI:FULL, ,ci:perf-expected,ci:full", "--json"]),
    { base: "origin/main", changedFiles: ["a b.js", "c.js"], labels: ["ci:full", "ci:perf-expected"], json: true, help: false });
  assert.equal(parsePrDeliveryArgs(["--base", "main", "--help"]).help, true);
  for (const argv of [["--base"], ["--changed-file", ""], ["--labels", "--json"], ["--execute"], ["--json-out", "output.json"]]) {
    assert.throws(() => parsePrDeliveryArgs(argv));
  }
  let output = "";
  assert.equal(runPrDeliveryPlanCli(["--help"], { stdout: { write: (value) => { output += value; } }, runner: () => assert.fail("help runs no subprocess") }), 0);
  assert.match(output, /no fetch/);
});

test("labels influence CI plans while future planner fields are preserved in both formats", (t) => {
  const f = fixture(t);
  const plan = f.plan({ labels: [" CI:FULL ", "ci:full", "ci:perf-expected"] }, {
    ciPlanner: ({ changedFiles, labels }) => ({ changedFiles, labels, futureField: { required: true } }),
  });
  assert.deepEqual(plan.labels, ["ci:full", "ci:perf-expected"]);
  assert.deepEqual(plan.ci.committed.futureField, { required: true });
  assert.deepEqual(plan.ci.predicted.futureField, { required: true });
  assert.match(renderPrDeliveryPlan(plan), /futureField/);
  assert.equal(f.plan({ labels: ["ci:full"] }).ci.predicted.runSmoke, true);
});

test("selected commands, deferred main-thread, and route gaps are separate and fail closed", (t) => {
  const f = fixture(t);
  const local = {
    report: { unmatchedChangedFiles: [] },
    executionPlan: {
      commandsToRun: ["test:small"], blockedMainThreadCommands: ["test:browser"], deferredCiOnlyCommands: ["test:ci"], routeGaps: [],
      executionCommands: [{ process: { bin: "node", args: ["--test", "tests/a b.test.mjs"] } }],
    },
  };
  const plan = f.plan({}, { selectLocal: () => local });
  assert.equal(plan.exitCode, 0);
  assert.deepEqual(plan.local.selectedChildSafeCommands, ["test:small"]);
  assert.deepEqual(plan.local.deferredMainThreadCommands, ["test:browser"]);
  assert.deepEqual(plan.local.deferredCiOnlyCommands, ["test:ci"]);
  assert.equal(plan.local.selectedProcesses[0].command.args[1], "tests/a b.test.mjs");
  for (const selection of [
    { ...local, report: { unmatchedChangedFiles: ["unknown.js"] } },
    { ...local, executionPlan: { ...local.executionPlan, routeGaps: [{ code: "coverage-gap" }] } },
  ]) {
    const failed = f.plan({}, { selectLocal: () => selection });
    assert.equal(failed.exitCode, 2);
    assert.equal(failed.status, "blocked");
    assert.deepEqual(failed.local.selectedProcesses, []);
    assert.deepEqual(failed.local.suggestedEntrypoints, []);
  }
});

test("selector exceptions or malformed results cannot silently become docs skip", (t) => {
  const f = fixture(t);
  for (const selectLocal of [() => { throw new Error("catalog mismatch"); }, () => ({})]) {
    const plan = f.plan({}, { selectLocal });
    assert.equal(plan.exitCode, 2);
    assert.equal(plan.local.routeGaps.length, 1);
  }
});

test("PowerShell and POSIX quoting preserve spaces, quotes and command substitutions", () => {
  const args = ["tools/run_commit_verification.mjs", "--changed-file", "docs/a 'quoted' $(secret) `x`.md"];
  const command = describeCommand("node", args);
  assert.deepEqual(command.args, args);
  assert.equal(command.powershell, "& 'node' 'tools/run_commit_verification.mjs' '--changed-file' 'docs/a ''quoted'' $(secret) `x`.md'");
  assert.match(command.posix, /'"'"'/);
});

test("planning leaves every file and Git index unchanged and executes only read-only Git", (t) => {
  const f = fixture(t);
  f.write("dirty '$(text).js");
  const before = snapshot(f.cwd);
  const calls = [];
  f.plan({}, { runner: (bin, args, options) => {
    calls.push([bin, args]);
    assert.equal(bin, "git");
    assert.ok(["rev-parse", "symbolic-ref", "merge-base", "rev-list", "diff", "status"].includes(args[0]));
    assert.equal(options.shell, false);
    assert.equal(options.env.GIT_OPTIONAL_LOCKS, "0");
    return spawnSync(bin, args, options);
  } });
  assert.ok(calls.some(([, args]) => args.includes("--no-renames") && args.includes("-z")));
  let jsonOutput = "";
  assert.equal(runPrDeliveryPlanCli(["--json", "--changed-file", "docs/preview.md"], {
    stdout: { write: (value) => { jsonOutput += value; } },
    selectLocal: selectEmpty,
    runner: (bin, args, options) => spawnSync(bin, args, { ...options, cwd: f.cwd }),
  }), 0);
  assert.deepEqual(JSON.parse(jsonOutput).scope.predictedChangedFiles, ["docs/preview.md"]);
  assert.deepEqual(snapshot(f.cwd), before);
});

test("real repository selector/catalog/execution planner smoke is pure and selects behavior coverage", () => {
  const indexPath = spawnSync("git", ["rev-parse", "--git-path", "index"], { cwd: REPO_ROOT, encoding: "utf8" }).stdout.trim();
  const absoluteIndex = path.resolve(REPO_ROOT, indexPath);
  const indexBefore = fs.readFileSync(absoluteIndex);
  const local = selectRepositoryLocalPlan({ cwd: REPO_ROOT, changedFiles: ["js/core/state/actions/appearance_actions.js"] });
  assert.deepEqual(local.report.unmatchedChangedFiles, []);
  assert.deepEqual(local.executionPlan.routeGaps, []);
  assert.ok(local.executionPlan.commandsToRun.some((command) => command.includes("appearance_actions_behavior")));
  assert.ok(local.executionPlan.selectedLeaves.length > 0);
  assert.ok(local.executionPlan.catalogDigest);
  const docs = selectRepositoryLocalPlan({ cwd: REPO_ROOT, changedFiles: ["docs/delivery-preview.md"] });
  assert.deepEqual(docs.report.unmatchedChangedFiles, []);
  assert.deepEqual(docs.executionPlan.routeGaps, []);
  assert.deepEqual(docs.executionPlan.commandsToRun, []);
  assert.deepEqual(docs.executionPlan.executionCommands, []);
  assert.deepEqual(fs.readFileSync(absoluteIndex), indexBefore);
});
