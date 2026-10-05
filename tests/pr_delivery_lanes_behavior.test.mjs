import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import test from "node:test";
import { planPullRequest } from "../tools/ci/pr_plan.mjs";

test("known UI scope gets focused browser coverage, source checks and diagnostic sampling", () => {
  for (const path of ["css/editor-workspace.css", "css/editor-tool-guidance.css", "js/ui/styled_selects.js", "js/ui/toolbar/tool_guidance.js"]) {
    const plan = planPullRequest({ changedFiles: [path, "docs/active/example/task.md"] });
    assert.equal(plan.riskTier, "ui", path);
    assert.equal(plan.runFast, true);
    assert.equal(plan.smokeMode, "ui");
    assert.equal(plan.pagesMode, "source");
    assert.equal(plan.runPages, false);
    assert.equal(plan.perfRequired, false);
    assert.equal(plan.perfDiagnostic, true);
    assert.match(plan.reasons.performance, /diagnostic/);
  }
});

test("mixed changes and full intent cannot inherit a UI exemption", () => {
  for (const file of ["js/core/map_renderer.js", "js/core/state/index.js", "js/ui/unregistered.js", "data/CATALOG.json", "package-lock.json", "unknown-input.bin"]) {
    const plan = planPullRequest({ changedFiles: ["css/editor-workspace.css", file] });
    assert.equal(plan.smokeMode, "full", file);
    assert.equal(plan.perfRequired, true, file);
    assert.equal(plan.perfDiagnostic, false, file);
  }
  const full = planPullRequest({ changedFiles: ["css/editor-workspace.css"], labels: ["ci:full"] });
  assert.equal(full.smokeMode, "full");
  assert.equal(full.pagesMode, "full");
  assert.equal(full.perfRequired, true);
  assert.equal(full.perfMode, "strict");
});

test("delivery inputs, dependencies and policy keep full artifact validation", () => {
  for (const file of ["index.html", "landing/app.js", "vendor/d3.min.js", "data/manifest.json", "dist/index.html", "package.json", "package-lock.json", "requirements-dev.lock.txt", "tools/build_pages_dist.py", "tools/check_pages_source_graph.py", "tools/pages_artifact_admission.py", "tools/ci/pr_plan.mjs", ".github/workflows/verify-shared.yml"]) {
    const plan = planPullRequest({ changedFiles: [file] });
    assert.equal(plan.pagesMode, "full", file);
    assert.equal(plan.runPages, true, file);
    assert.equal(plan.runPagesSource, false, file);
  }
  assert.equal(planPullRequest({ changedFiles: ["js/new_runtime.js"] }).pagesMode, "source");
});

test("empty, unknown, executable and control-plane scopes are never docs-only skips", () => {
  for (const changedFiles of [[], ["unknown.txt"], ["docs/testing/verify-core.md"], ["docs/new.mjs"], ["README.mjs"], ["AGENTS.md"]]) {
    assert.equal(planPullRequest({ changedFiles }).runFast, true, JSON.stringify(changedFiles));
  }
  const docs = planPullRequest({ changedFiles: ["README.md", "README.zh-CN.md", "docs/active/example/context.md"] });
  assert.equal(docs.runFast, false);
  assert.equal(docs.smokeMode, "none");
  assert.equal(docs.pagesMode, "none");
});

function runRequiredGate(overrides = {}) {
  const source = fs.readFileSync(new URL("../.github/workflows/pr-verify.yml", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const script = source.split("node <<'NODE'\n")[1].split("\n          NODE")[0];
  const needs = {
    "pr-plan": { result: "success", outputs: { run_fast: "true", run_smoke: "true" } },
    "pr-verify-fast": { result: "success" }, "pr-verify-smoke": { result: "success" },
    ...overrides,
  };
  let code = 0;
  vm.runInNewContext(script, { console: { log() {}, error() {} }, process: {
    env: { REQUIRED_RESULTS: JSON.stringify(needs) }, exit(value) { code = value; },
  } });
  return code;
}

test("required gate accepts explicit docs exemption but rejects missing or failed planned jobs", () => {
  assert.equal(runRequiredGate(), 0);
  assert.equal(runRequiredGate({
    "pr-plan": { result: "success", outputs: { run_fast: "false", run_smoke: "false" } },
    "pr-verify-fast": { result: "skipped" }, "pr-verify-smoke": { result: "skipped" },
  }), 0);
  for (const result of ["skipped", "failure", "cancelled", undefined]) {
    assert.equal(runRequiredGate({ "pr-verify-fast": { result } }), 1, result);
    assert.equal(runRequiredGate({ "pr-verify-smoke": { result } }), 1, result);
  }
  for (const outputs of [{}, { run_fast: "false" }, { run_fast: "true", run_smoke: "invalid" }]) {
    assert.equal(runRequiredGate({ "pr-plan": { result: "success", outputs } }), 1);
  }
  assert.equal(runRequiredGate({ "pr-plan": { result: "failure", outputs: { run_fast: "false", run_smoke: "false" } } }), 1);
});

test("hosted workflows consume the planned lanes and keep release artifact checks", () => {
  const pr = fs.readFileSync(new URL("../.github/workflows/pr-verify.yml", import.meta.url), "utf8");
  const shared = fs.readFileSync(new URL("../.github/workflows/verify-shared.yml", import.meta.url), "utf8");
  assert.match(pr, /if: needs\.pr-plan\.outputs\.run_fast == 'true'/);
  assert.match(pr, /smoke-mode: \$\{\{ needs\.pr-plan\.outputs\.smoke_mode \}\}/);
  assert.match(pr, /run-pages-source-check: \$\{\{ needs\.pr-plan\.outputs\.pages_mode == 'source' \}\}/);
  assert.match(shared, /python tools\/check_pages_source_graph\.py/);
  assert.match(shared, /tests\/e2e\/main_shell_i18n\.spec\.js tests\/e2e\/editor_detail_polish\.spec\.js --workers=1 --retries=0/);
  assert.match(shared, /inputs\.profile == 'deploy-minimal' && inputs\.pages-artifact-only/);
  assert.match(shared, /python tools\/build_pages_dist\.py --output-root .runtime\/pages-release\/dist/);
  assert.match(shared, /npm run test:e2e:pages-public-release-gate/);
});

test("scenario and transport contracts keep required PR coverage without post-merge full reruns", () => {
  for (const [file, job] of [
    ["scenario-contract-matrix.yml", "strict-scenario-contract-review"],
    ["transport-contract-required.yml", "transport-contract-required"],
  ]) {
    const source = fs.readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), "utf8").replaceAll("\r\n", "\n");
    const triggers = source.split("\non:\n")[1].split("\npermissions:")[0];
    assert.match(triggers, /^  workflow_dispatch:/m);
    assert.match(triggers, /^  pull_request:/m);
    assert.match(triggers, /types: \[opened, synchronize, reopened, labeled, unlabeled\]/);
    assert.doesNotMatch(triggers, /^  push:/m);
    assert.ok(source.includes(`\n  ${job}:`));
    assert.match(source, /github\.event_name == 'pull_request'/);
    assert.match(source, /if \[ "\$GITHUB_EVENT_NAME" != "pull_request" \]/);
  }
});
