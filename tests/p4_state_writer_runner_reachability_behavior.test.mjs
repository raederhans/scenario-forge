import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  assertP4StateWriterPolicyManifestRunMode,
  buildP4StateWriterPolicyChildEnv,
  P4_STATE_WRITER_POLICY_WINDOWS_JOB_TIMEOUT_MS,
  P4_STATE_WRITER_POLICY_TEST_FILES,
  P4_STATE_WRITER_POLICY_QUICK_TEST_FILES,
  P4_STATE_WRITER_POLICY_RUN_MODE_ENV,
  resolveP4StateWriterPolicyRun,
  resolveP4StateWriterPolicyTestFiles,
  spawnP4StateWriterPolicyTestProcess,
} from "../tools/run_p4_state_writer_policy_tests.mjs";
import { buildP4PhaseVerificationPlan } from "../tools/run_p4_phase_verification.mjs";
import { buildNodeRoutes } from "../tools/test_route_registry.mjs";

const EXPECTED_DEFAULT_SUITES = Object.freeze([
  "tests/day_night_runtime_owner_behavior.test.mjs",
  "tests/political_background_render_owner_behavior.test.mjs",
  "tests/state_action_delegation_edges_behavior.test.mjs",
  "tests/state_borrowed_effect_contract_behavior.test.mjs",
  "tests/state_owner_borrowed_storage_behavior.test.mjs",
  "tests/state_writer_policy_behavior.test.mjs",
  "tests/state_writer_policy_batch_scan_behavior.test.mjs",
  "tests/state_writer_policy_soundness_behavior.test.mjs",
  "tests/state_writer_scanner_soundness_behavior.test.mjs",
  "tests/state_writer_policy_manifest_behavior.test.mjs",
  "tests/state_writer_policy_evidence_behavior.test.mjs",
  "tests/p4_state_action_routes_behavior.test.mjs",
  "tests/p4_state_writer_runner_reachability_behavior.test.mjs",
  "tests/p4_state_writer_streaming_runner_behavior.test.mjs",
]);

test("named P4 policy gate delegates to the complete runner default suite", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

  assert.equal(
    packageJson.scripts["test:node:p4:state-writer-policy"],
    "node tools/run_p4_state_writer_policy_tests.mjs",
  );
  assert.deepEqual(
    P4_STATE_WRITER_POLICY_TEST_FILES,
    EXPECTED_DEFAULT_SUITES,
  );
  assert.deepEqual(
    resolveP4StateWriterPolicyTestFiles([]),
    EXPECTED_DEFAULT_SUITES,
  );
  assert.equal(
    P4_STATE_WRITER_POLICY_WINDOWS_JOB_TIMEOUT_MS,
    45 * 60 * 1000,
  );
});

test("explicit focused runner requests remain isolated from the default suite", () => {
  assert.deepEqual(
    resolveP4StateWriterPolicyTestFiles([
      "tests/state_writer_policy_behavior.test.mjs",
    ]),
    ["tests/state_writer_policy_behavior.test.mjs"],
  );
});

test("official policy runner binds a private run mode into child environments", () => {
  const parentEnv = {
    FIXTURE_PARENT: "preserved",
    [P4_STATE_WRITER_POLICY_RUN_MODE_ENV]: "inherited-stale-mode",
  };
  for (const mode of ["full", "focused", "quick"]) {
    const childEnv = buildP4StateWriterPolicyChildEnv(mode, parentEnv);
    assert.equal(childEnv.FIXTURE_PARENT, "preserved");
    assert.equal(childEnv[P4_STATE_WRITER_POLICY_RUN_MODE_ENV], mode);
  }
  assert.equal(
    parentEnv[P4_STATE_WRITER_POLICY_RUN_MODE_ENV],
    "inherited-stale-mode",
  );
  assert.throws(
    () => buildP4StateWriterPolicyChildEnv("unknown", parentEnv),
    (error) => (
      error?.code === "p4-state-writer-policy-run-mode-invalid"
      && error?.mode === "unknown"
    ),
  );

  let invocation = null;
  const result = spawnP4StateWriterPolicyTestProcess(
    ["tests/state_writer_policy_behavior.test.mjs"],
    {
      mode: "focused",
      parentEnv: parentEnv,
      runner(command, args, options) {
        invocation = { command, args, options };
        return { status: 0, stdout: "", stderr: "" };
      },
    },
  );
  assert.equal(result.status, 0);
  assert.equal(invocation.command, process.execPath);
  assert.deepEqual(invocation.args, [
    "--test",
    "tests/state_writer_policy_behavior.test.mjs",
  ]);
  assert.equal(
    invocation.options.env[P4_STATE_WRITER_POLICY_RUN_MODE_ENV],
    "focused",
  );
});

test("manifest guard admits official full and focused modes only", () => {
  for (const mode of ["full", "focused"]) {
    assert.equal(
      assertP4StateWriterPolicyManifestRunMode({
        env: { [P4_STATE_WRITER_POLICY_RUN_MODE_ENV]: mode },
      }),
      mode,
    );
  }
  for (const mode of [undefined, "", "quick", "unknown"]) {
    assert.throws(
      () => assertP4StateWriterPolicyManifestRunMode({
        env: mode === undefined
          ? {}
          : { [P4_STATE_WRITER_POLICY_RUN_MODE_ENV]: mode },
      }),
      (error) => (
        error?.code === "p4-state-writer-policy-manifest-run-mode-required"
        && error?.mode === String(mode || "")
        && error.message.includes(
          "npm run test:node:p4:state-writer-policy --",
        )
      ),
      String(mode),
    );
  }

  const manifestSource = fs.readFileSync(
    "tests/state_writer_policy_manifest_behavior.test.mjs",
    "utf8",
  );
  const guardIndex = manifestSource.indexOf(
    "assertP4StateWriterPolicyManifestRunMode();",
  );
  const repositoryWorkIndex = manifestSource.indexOf(
    "const SHARED_REPOSITORY_SCAN_CACHE",
  );
  assert.ok(guardIndex >= 0, "manifest must invoke the official runner guard");
  assert.ok(
    repositoryWorkIndex >= 0,
    "manifest must retain an identifiable repository-scale setup boundary",
  );
  assert.ok(
    guardIndex < repositoryWorkIndex,
    "manifest guard must run before repository-scale setup",
  );
});

test("quick policy runner keeps fast suites and writes an isolated TAP report", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const request = resolveP4StateWriterPolicyRun(["--quick"]);

  assert.equal(
    packageJson.scripts["test:node:p4:state-writer-policy:quick"],
    "node tools/run_p4_state_writer_policy_tests.mjs --quick",
  );
  assert.deepEqual(request.testArguments, P4_STATE_WRITER_POLICY_QUICK_TEST_FILES);
  assert.equal(request.mode, "quick");
  assert.equal(
    request.testArguments.includes("tests/state_writer_policy_manifest_behavior.test.mjs"),
    false,
  );
  assert.equal(
    request.testArguments.includes("tests/state_writer_policy_evidence_behavior.test.mjs"),
    true,
  );
  assert.match(request.reportPath, /state-writer-policy-tests\.quick\.tap$/);
  assert.throws(
    () => resolveP4StateWriterPolicyRun(["--quick", "tests/state_writer_policy_behavior.test.mjs"]),
    /cannot be combined/,
  );

  const focused = resolveP4StateWriterPolicyRun([
    "--test-name-pattern=explicit repository scan cache",
    "tests/state_writer_policy_manifest_behavior.test.mjs",
  ]);
  assert.equal(focused.mode, "focused");
  assert.match(focused.reportPath, /state-writer-policy-tests\.focused\.tap$/);

  const full = resolveP4StateWriterPolicyRun([]);
  assert.equal(full.mode, "full");
  assert.equal(
    full.testArguments.includes(
      "tests/state_writer_policy_manifest_behavior.test.mjs",
    ),
    true,
  );
});

test("exact P4.2a Node gate reaches the batch scanner regression suite", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const exactPhaseCommand = packageJson.scripts["test:node:p4:p4-2a"];

  assert.ok(
    exactPhaseCommand
      .split(/\s+/)
      .includes("tests/state_writer_policy_batch_scan_behavior.test.mjs"),
    exactPhaseCommand,
  );
});

test("exact P4.2b gates reach chunk action and boundary regressions", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const nodeCommand = packageJson.scripts["test:node:p4:p4-2b"];
  const pythonCommand = packageJson.scripts["test:python:p4:p4-2b-boundary"];

  assert.ok(nodeCommand.split(/\s+/).includes("tests/scenario_chunk_state_actions_behavior.test.mjs"));
  assert.ok(!nodeCommand.includes("--test-force-exit"), nodeCommand);
  assert.match(pythonCommand, /tests\.test_scenario_chunk_state_actions_boundary_contract/);
  assert.ok(
    buildP4PhaseVerificationPlan({ phase: "P4.2b" }).commands.includes(
      "npm run test:node:p4:state-writer-policy",
    ),
  );
});

test("exact P4.2c gates reach Scenario health action and boundary regressions", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const nodeCommand = packageJson.scripts["test:node:p4:p4-2c"];
  const pythonCommand = packageJson.scripts["test:python:p4:p4-2c-boundary"];

  assert.ok(nodeCommand.split(/\s+/).includes("tests/scenario_health_actions_behavior.test.mjs"));
  assert.ok(nodeCommand.split(/\s+/).includes("tests/startup_hydration_behavior.test.mjs"));
  assert.ok(!nodeCommand.includes("--test-force-exit"), nodeCommand);
  assert.match(pythonCommand, /tests\.test_scenario_health_actions_boundary_contract/);
  assert.ok(
    buildP4PhaseVerificationPlan({ phase: "P4.2c" }).commands.includes(
      "npm run test:node:p4:state-writer-policy",
    ),
  );
});

test("exact P4.3 gates reach renderer state action and boundary regressions", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const nodeCommand = packageJson.scripts["test:node:p4:p4-3"];
  const pythonCommand = packageJson.scripts["test:python:p4:p4-3-boundary"];

  for (const testFile of [
    "tests/renderer_phase_actions_behavior.test.mjs",
    "tests/renderer_interaction_actions_behavior.test.mjs",
    "tests/renderer_exact_refresh_actions_behavior.test.mjs",
    "tests/renderer_cache_actions_behavior.test.mjs",
    "tests/renderer_diagnostics_actions_behavior.test.mjs",
    "tests/render_perf_metrics_runtime_owner_behavior.test.mjs",
    "tests/exact_after_settle_scheduler_state_actions_behavior.test.mjs",
  ]) {
    assert.ok(nodeCommand.split(/\s+/).includes(testFile), testFile);
  }
  assert.ok(!nodeCommand.includes("--test-force-exit"), nodeCommand);
  assert.match(pythonCommand, /tests\.test_renderer_control_actions_boundary_contract/);
  assert.match(pythonCommand, /tests\.test_renderer_exact_refresh_actions_boundary_contract/);
  assert.match(pythonCommand, /tests\.test_renderer_cache_actions_boundary_contract/);
  assert.match(pythonCommand, /tests\.test_renderer_diagnostics_actions_boundary_contract/);
  assert.ok(
    buildP4PhaseVerificationPlan({ phase: "P4.3" }).commands.includes(
      "npm run test:node:p4:state-writer-policy",
    ),
  );
});

test("exact P4.4 gates reach every replay lane and the strict checker producer", () => {
  const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
  const nodeCommand = packageJson.scripts["test:node:p4:p4-4"];
  const pythonCommand = packageJson.scripts["test:python:p4:p4-4-boundary"];

  for (const testFile of [
    "tests/appearance_actions_behavior.test.mjs",
    "tests/appearance_preset_actions_behavior.test.mjs",
    "tests/appearance_reference_actions_behavior.test.mjs",
    "tests/appearance_visibility_actions_behavior.test.mjs",
    "tests/export_workbench_actions_behavior.test.mjs",
    "tests/intensity_field_actions_behavior.test.mjs",
    "tests/transport_actions_behavior.test.mjs",
    "tests/transport_workbench_state_owner_behavior.test.mjs",
    "tests/ui_chrome_actions_behavior.test.mjs",
    "tests/ui_dirty_actions_behavior.test.mjs",
    "tests/ui_visibility_actions_behavior.test.mjs",
    "tests/strategic_overlay_actions_behavior.test.mjs",
    "tests/special_zone_actions_behavior.test.mjs",
    "tests/special_zones_workbench_controller_behavior.test.mjs",
  ]) {
    assert.ok(nodeCommand.split(/\s+/).includes(testFile), testFile);
  }
  assert.match(pythonCommand, /tests\.test_state_write_guardrail_contract/);
  assert.deepEqual(
    buildP4PhaseVerificationPlan({ phase: "P4.4" }).commands,
    [
      "npm run test:node:p4:p4-4",
      "node tools/verification/state_writer_policy_evidence.mjs produce --phase P4.4",
      "npm run test:python:p4:p4-4-boundary",
      "npm run test:node:p4:state-writer-policy",
      "node tools/check_p4_state_action_routes.mjs --phase P4.4 --history-base HEAD^",
    ],
  );
});

test("node route discovery keeps wrapper-based named gates reachable", () => {
  const route = buildNodeRoutes().find(
    ({ commandRef }) => commandRef === "test:node:p4:state-writer-policy",
  );

  assert.ok(route);
  assert.equal(route.domain, "state-ownership");
  assert.ok(
    route.sourceRef
      .split(",")
      .includes("tools/run_p4_state_writer_policy_tests.mjs"),
    route.sourceRef,
  );
});
