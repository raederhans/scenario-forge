import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { registerCommandSupersessionContracts } from "./contracts/command_supersession_contracts.mjs";
import {
  buildRouteIndex,
  reconcileVerificationRouteAuthority,
} from "../tools/test_route_registry.mjs";
import {
  buildRecommendation,
  classifyExecutionOwners,
  normalizeChangedFiles,
} from "../tools/select_verification_targets.mjs";
import {
  NIGHTLY_LINUX_CORE_EXCLUDED_COMMAND_REFS,
  buildNightlyScenarioHeavyPlan,
  buildNightlyLinuxCoreShardPlan,
  buildCoreVerificationPlan,
  commandToProcess,
  parseArgs,
  partitionNightlyLinuxCoreCommands,
  runCoreVerification,
  runVerificationPlan,
} from "../tools/run_core_verification.mjs";

import {
  RESUMABLE_VERIFICATION_KIND,
  RESUMABLE_VERIFICATION_SCHEMA_VERSION,
  atomicWriteJsonSync,
  buildCommandStates,
  buildPlanIdentity,
  decideResume,
} from "../tools/verification/resumable_verification.mjs";
import {
  assertAdaptiveExecutionInput,
  assertAdaptiveEntrypointAuthority,
  bindSelectionToPreparedCatalog,
  buildAdaptiveEntrypointRecommendation,
  buildExecutionPlan,
  applyLocalEntrypointExecutionBudget,
  adaptivePlanningExitCode,
  constrainAdaptiveEntrypointSelection,
  discoverChangedFiles,
  executeAdaptivePlan,
  readSelectionArtifact,
  parseArgs as parseAdaptiveArgs,
  writeAdaptiveOutputs,
} from "../tools/run_adaptive_tests.mjs";
import {
  buildCommandSupersessionPlan,
  collapseSupersededCommands,
} from "../tools/verification/command_supersession.mjs";
import {
  assertPrCostObservation,
  buildPrCostObservation,
  buildVerificationProfile,
  prepareVerificationProfilePlan,
  PR_COST_SCHEMA_IDENTITY,
} from "../tools/verification/verification_profile.mjs";
import {
  buildVerificationCatalog,
  buildVerificationSelectionPlan,
  prepareVerificationCatalog,
  prepareRepositoryVerificationCatalogBinding,
  prepareRepositoryVerificationCatalog,
  VERIFICATION_TIER_ENTRYPOINTS,
} from "../tools/verification/script_portfolio.mjs";
import { VERIFICATION_DOMAINS } from "../tools/verification/verification_domains.mjs";
import { VERIFICATION_METADATA_SOURCE_IDENTITY } from "../tools/verification/verification_catalog_projection.mjs";

const M9_LIVE_REPOSITORY_SHADOW_COMMAND = VERIFICATION_DOMAINS.find(
  (record) => record.id === "infra:p4-repository-analysis-bundle-live-shadow",
)?.commandRef;

const PACKAGE_SCRIPTS = {
  "test:node:city-lights-render-owner": "node --test tests/city_lights_render_owner_behavior.test.mjs",
  "test:node:day-night-runtime-owner": "node --test tests/day_night_runtime_owner_behavior.test.mjs",
  "test:python:day-night-runtime-owner-boundary": "npm run python -- -m unittest tests.test_day_night_runtime_owner_boundary_contract -q",
  "test:node:political-background-render-owner": "node --test tests/political_background_render_owner_behavior.test.mjs",
  "test:node:political-partial-repaint-owner": "node --test tests/political_partial_repaint_owner_behavior.test.mjs",
  "test:python:map-renderer-political-background-render-owner-boundary": "npm run python -- -m unittest tests.test_map_renderer_political_background_render_owner_boundary_contract -q",
  "test:python:map-renderer-political-partial-repaint-owner-boundary": "npm run python -- -m unittest tests.test_map_renderer_political_partial_repaint_owner_boundary_contract -q",
  "test:node:city-points-render-owner": "node --test tests/city_points_render_owner_behavior.test.mjs tests/urban_city_policy_strategic_values_behavior.test.mjs",
  "test:python:map-renderer-city-points-boundary": "npm run python -- -m unittest tests.test_map_renderer_urban_city_policy_boundary_contract tests.test_map_renderer_city_label_owner_boundary_contract -q",
  "verify:test:e2e-layers": "node tools/e2e_layering.mjs check",
  "verify:test-import-graph": "node tools/check_test_import_graph.mjs",
  "verify:architecture-boundaries": "node tools/check_architecture_boundaries.mjs",
  "verify:state-write-allowlist": "node tools/check_state_write_allowlist.mjs",
  "verify:p4:state-writer-policy": "npm run test:node:p4:state-writer-policy && node tools/check_state_writer_policy.mjs",
  "test:python:p4:state-write-boundary": "node tools/run_p4_state_write_boundary.mjs",
  "test:node:p4:p4-1": "node --test tests/p4_phase_verification_runner_behavior.test.mjs tests/boot_actions_behavior.test.mjs",
  "test:python:p4:p4-1-boundary": "npm run python -- -m unittest tests.test_boot_state_actions_boundary_contract tests.test_state_split_boundary_contract tests.test_state_write_guardrail_contract -q",
  "verify:p4:p4-1": "node tools/run_p4_phase_verification.mjs --phase P4.1",
  "test:node:p4:p4-2a": "node --test tests/p4_phase_verification_runner_behavior.test.mjs tests/state_action_delegation_edges_behavior.test.mjs tests/state_writer_policy_batch_scan_behavior.test.mjs tests/scenario_state_actions_atomicity_behavior.test.mjs tests/scenario_transaction_rollback_actions_behavior.test.mjs tests/scenario_apply_transaction_ownership.test.mjs tests/scenario_lifecycle_runtime_behavior.test.mjs tests/scenario_runtime_state_behavior.test.mjs",
  "test:python:p4:p4-2a-boundary": "npm run python -- -m unittest tests.test_scenario_state_actions_boundary_contract tests.test_scenario_manager_boundary_contract tests.test_scenario_resources_boundary_contract tests.test_scenario_rollback_boundary_contract tests.test_scenario_lifecycle_runtime_boundary_contract tests.test_state_write_guardrail_contract -q",
  "test:node:p4:p4-2b": "node --test tests/p4_phase_verification_runner_behavior.test.mjs tests/state_action_delegation_edges_behavior.test.mjs tests/state_writer_policy_batch_scan_behavior.test.mjs tests/scenario_chunk_state_actions_behavior.test.mjs tests/scenario_chunk_contracts.test.mjs tests/scenario_chunk_promotion_helpers_behavior.test.mjs tests/scenario_refresh_plans_behavior.test.mjs tests/scenario_runtime_state_behavior.test.mjs tests/scenario_state_actions_atomicity_behavior.test.mjs tests/scenario_transaction_rollback_actions_behavior.test.mjs tests/scenario_lifecycle_runtime_behavior.test.mjs",
  "test:python:p4:p4-2b-boundary": "npm run python -- -m unittest tests.test_scenario_chunk_state_actions_boundary_contract tests.test_scenario_chunk_refresh_contracts tests.test_main_deferred_detail_promotion_boundary_contract tests.test_scenario_manager_boundary_contract tests.test_scenario_rollback_boundary_contract tests.test_state_write_guardrail_contract -q",
  "test:node:p4:p4-2c": "node --test tests/p4_phase_verification_runner_behavior.test.mjs tests/state_action_delegation_edges_behavior.test.mjs tests/state_writer_policy_batch_scan_behavior.test.mjs tests/scenario_health_actions_behavior.test.mjs tests/startup_hydration_behavior.test.mjs tests/scenario_lifecycle_runtime_behavior.test.mjs tests/scenario_runtime_state_behavior.test.mjs tests/scenario_state_actions_atomicity_behavior.test.mjs tests/scenario_transaction_rollback_actions_behavior.test.mjs",
  "test:python:p4:p4-2c-boundary": "npm run python -- -m unittest tests.test_scenario_health_actions_boundary_contract tests.test_startup_hydration_boundary_contract tests.test_scenario_data_health_boundary_contract tests.test_scenario_presentation_runtime_boundary_contract tests.test_scenario_lifecycle_runtime_boundary_contract tests.test_scenario_rollback_boundary_contract tests.test_scenario_runtime_state_boundary_contract tests.test_scenario_state_actions_boundary_contract tests.test_state_write_guardrail_contract -q",
  "test:node:p4:p4-3": "node --test tests/p4_phase_verification_runner_behavior.test.mjs tests/state_action_delegation_edges_behavior.test.mjs tests/state_writer_policy_batch_scan_behavior.test.mjs tests/renderer_phase_actions_behavior.test.mjs tests/renderer_interaction_actions_behavior.test.mjs tests/renderer_exact_refresh_actions_behavior.test.mjs tests/render_pass_cache_state_normalizer_behavior.test.mjs tests/renderer_cache_actions_behavior.test.mjs tests/renderer_diagnostics_actions_behavior.test.mjs tests/render_perf_metrics_runtime_owner_behavior.test.mjs tests/exact_after_settle_scheduler_state_actions_behavior.test.mjs tests/renderer_render_phase_lifecycle_inventory.test.mjs tests/renderer_render_phase_lifecycle_owner_behavior.test.mjs tests/zoom_interaction_lifecycle_owner_behavior.test.mjs tests/renderer_runtime_state_behavior.test.mjs tests/physical_layer_contracts.test.mjs tests/scenario_chunk_contracts.test.mjs",
  "test:python:p4:p4-3-boundary": "npm run python -- -m unittest tests.test_renderer_control_actions_boundary_contract tests.test_renderer_exact_refresh_actions_boundary_contract tests.test_renderer_cache_actions_boundary_contract tests.test_renderer_diagnostics_actions_boundary_contract tests.test_renderer_runtime_state_boundary_contract tests.test_map_renderer_interaction_context_boundary_contract tests.test_scenario_chunk_refresh_contracts tests.test_state_write_guardrail_contract -q",
  "test:node:p4:p4-4": "node --test tests/p4_phase_verification_runner_behavior.test.mjs tests/state_action_delegation_edges_behavior.test.mjs tests/state_writer_policy_batch_scan_behavior.test.mjs tests/appearance_actions_behavior.test.mjs tests/appearance_preset_actions_behavior.test.mjs tests/appearance_preset_history.node.test.mjs tests/appearance_preset_state.node.test.mjs tests/appearance_reference_actions_behavior.test.mjs tests/appearance_selection_actions_behavior.test.mjs tests/appearance_state_action_callers_behavior.test.mjs tests/appearance_visibility_actions_behavior.test.mjs tests/intensity_field_actions_behavior.test.mjs tests/export_workbench_actions_behavior.test.mjs tests/transport_actions_behavior.test.mjs tests/transport_workbench_state_owner_behavior.test.mjs tests/ui_chrome_actions_behavior.test.mjs tests/ui_dirty_actions_behavior.test.mjs tests/ui_visibility_actions_behavior.test.mjs tests/ui_state_action_callers_behavior.test.mjs tests/strategic_overlay_actions_behavior.test.mjs tests/special_zone_actions_behavior.test.mjs tests/special_zones_workbench_controller_behavior.test.mjs tests/strategic_overlay_runtime_owner_behavior.test.mjs",
  "test:python:p4:p4-4-boundary": "npm run python -- -m unittest tests.test_state_write_guardrail_contract -q",
  "verify:test-console-allowlist": "node tools/check_console_allowlist_decay.mjs",
  "verify:test-timeout-guardrails": "node tools/check_test_timeout_guardrails.mjs",
  "verify:script-portfolio": "node tools/verification/script_portfolio.mjs check",
  "verify:supervisor-contracts": "npm run verify:supervisor-schemas && npm run test:node:supervisor-contracts && npm run test:node:supervisor-routing",
  "verify:supervisor-plan": "npm run test:node:supervisor-plan && node tools/ai_test_supervisor/supervise_adaptive_verification.mjs --changed-file tools/ai_test_supervisor/supervise_adaptive_verification.mjs --changed-file tests/supervisor_plan_behavior.test.mjs",
  "test:node:verification-metadata": "node --test tests/verification_metadata_behavior.test.mjs tests/catalog_projection_shadow_behavior.test.mjs",
  "test:node:renderer-pass-family-inventory": "node --test tests/renderer_pass_family_inventory_behavior.test.mjs",
  "test:node:visual-effects-pass-owner": "node --test tests/visual_effects_pass_owner_behavior.test.mjs",
  "test:node:context-pass-orchestrator-owner": "node --test tests/context_pass_orchestrator_owner_behavior.test.mjs",
  "test:node:renderer-political-pass-orchestration-preflight": "node --test tests/renderer_political_pass_orchestration_preflight.test.mjs",
  "test:node:political-pass-orchestrator-owner": "node --test tests/political_pass_orchestrator_owner_behavior.test.mjs",
  "test:python:map-renderer-political-pass-orchestrator-boundary": "npm run python -- -m unittest tests.test_map_renderer_political_pass_orchestrator_boundary_contract -q",
  "test:python:map-renderer-render-pipeline-passes-boundary": "npm run python -- -m unittest tests.test_map_renderer_render_pipeline_passes_boundary_contract -q",
  "test:node:render-sample-role-policy": "node --test tests/render_sample_role_policy_behavior.test.mjs tests/perf_role_governed_report_behavior.test.mjs",
  "test:node:williams-crossover-governance": "node --test tests/williams_crossover_governance_behavior.test.mjs",
  "test:node:williams-crossover-job-runner": "node --test tests/williams_crossover_windows_job_runner_behavior.test.mjs tests/williams_crossover_windows_job_runner_integration.test.mjs",
  "test:node:windows-job-runtime": "node --test tests/windows_job_runner_v2_native_contract.test.mjs tests/windows_job_runtime_behavior.test.mjs",
  "test:node:windows-job-runtime:integration": "node --test tests/windows_job_runtime_integration.test.mjs",
  "test:node:renderer-draw-canvas-orchestration-inventory": "node --test tests/renderer_draw_canvas_orchestration_inventory_boundary.test.mjs",
  "test:node:draw-canvas-orchestration-owner": "node --test tests/draw_canvas_orchestration_owner_behavior.test.mjs",
  "test:node:draw-canvas-orchestration-owner-suite": "npm run test:node:draw-canvas-orchestration-owner && npm run test:node:renderer-draw-canvas-orchestration-inventory && npm run test:python:map-renderer-draw-canvas-orchestration-boundary",
  "test:node:cached-pass-compositor-owner": "node --test tests/cached_pass_compositor_owner_behavior.test.mjs",
  "test:node:cached-pass-compositor-owner-suite": "npm run test:node:cached-pass-compositor-owner && npm run test:node:renderer-draw-canvas-orchestration-inventory && npm run test:python:map-renderer-frame-compositor-boundary",
  "test:node:transformed-frame-compositor-owner": "node --test tests/transformed_frame_compositor_owner_behavior.test.mjs",
  "test:node:transformed-frame-compositor-owner-suite": "npm run test:node:transformed-frame-compositor-owner && npm run test:node:renderer-draw-canvas-orchestration-inventory && npm run test:python:map-renderer-frame-compositor-boundary",
  "test:node:post-ready-scheduler": "node --test tests/post_ready_scheduler_behavior.test.mjs tests/main_post_ready_scheduler_boundary.test.mjs",
  "test:node:main-runtime-diagnostics": "node --test tests/main_runtime_diagnostics_behavior.test.mjs tests/main_runtime_diagnostics_boundary.test.mjs",
  "test:node:render-runtime-binding": "node --test tests/render_runtime_binding_behavior.test.mjs tests/main_render_runtime_binding_boundary.test.mjs",
  "test:node:startup-ready-handoff": "node --test tests/startup_ready_handoff_behavior.test.mjs tests/main_startup_ready_handoff_boundary.test.mjs",
  "test:node:startup-failure-recovery": "node --test tests/startup_failure_recovery_behavior.test.mjs tests/main_startup_failure_recovery_boundary.test.mjs",
  "test:node:deferred-bootstrap": "node --test tests/deferred_vendor_loader_behavior.test.mjs tests/deferred_ui_bootstrap_behavior.test.mjs tests/main_deferred_bootstrap_boundary.test.mjs",
  "test:node:main-bootstrap-wiring": "node --test tests/main_bootstrap_wiring_boundary.test.mjs",
  "test:node:renderer-render-request-boundary": "npm run test:node:renderer-render-request-boundary-owner && npm run test:node:renderer-render-request-boundary-inventory",
  "test:node:renderer-render-phase-lifecycle": "npm run test:node:renderer-render-phase-lifecycle-owner && npm run test:node:renderer-render-phase-lifecycle-inventory",
  "test:node:click-selection-transaction-owner": "node --test tests/click_selection_transaction_owner_behavior.test.mjs",
  "test:node:renderer-click-selection-transaction-inventory": "node --test tests/renderer_click_selection_transaction_inventory_boundary.test.mjs",
  "test:python:map-renderer-render-cache-owner-boundary": "npm run python -- -m unittest tests.test_map_renderer_render_cache_owner_boundary_contract -q",
  "test:python:map-renderer-projection-viewport-context-boundary": "npm run python -- -m unittest tests.test_map_renderer_projection_viewport_context_boundary_contract -q",
  "test:python:map-renderer-viewport-mutation-context-boundary": "npm run python -- -m unittest tests.test_map_renderer_viewport_mutation_context_boundary_contract -q",
  "test:python:map-renderer-interaction-context-boundary": "npm run python -- -m unittest tests.test_map_renderer_interaction_context_boundary_contract -q",
  "test:python:map-renderer-hit-hover-context-boundary": "npm run python -- -m unittest tests.test_map_renderer_hit_hover_context_boundary_contract -q",
  "test:python:map-renderer-draw-canvas-orchestration-boundary": "npm run python -- -m unittest tests.test_map_renderer_draw_canvas_orchestration_owner_boundary_contract -q",
  "test:python:map-renderer-frame-compositor-boundary": "npm run python -- -m unittest tests.test_map_renderer_frame_compositor_owner_boundary_contract -q",
  "test:python:map-renderer-click-selection-transaction-boundary": "npm run python -- -m unittest tests.test_map_renderer_click_selection_transaction_boundary_contract -q",
  "test:node:render-pass-catalog": "node --test tests/render_pass_catalog_behavior.test.mjs",
  "test:node:render-pipeline-catalog": "node --test tests/render_pipeline_catalog_behavior.test.mjs",
  "test:node:render-pass-cache-host-owner-suite": "npm run test:node:render-pass-cache-host-owner && npm run test:node:render-pass-cache-host-owner-inventory && npm run test:node:renderer-render-pass-cache-host-inventory",
  "test:node:render-pass-commit-accounting-owner-suite": "npm run test:node:render-pass-commit-accounting-owner && npm run test:node:render-pass-commit-accounting-inventory",
  "test:node:hit-canvas-scheduling-owner-suite": "npm run test:node:hit-canvas-scheduling-owner && npm run test:node:hit-canvas-scheduling-owner-inventory && node --test tests/renderer_hit_canvas_scheduling_inventory_boundary.test.mjs",
  "test:node:map-interaction-event-binding-owner": "node --test tests/map_interaction_event_binding_owner_behavior.test.mjs",
  "test:node:visible-frame-diagnostics": "npm run test:node:visible-frame-diagnostics-owner && npm run test:node:visible-frame-diagnostics-inventory",
  "test:node:render-cache-owner": "node --test tests/render_cache_owner_invalidation_behavior.test.mjs",
  "test:node:render-transform-reuse-policy-owner": "node --test tests/render_transform_reuse_policy_owner_behavior.test.mjs",
  "test:node:viewport-read-model-owner": "node --test tests/viewport_read_model_owner_behavior.test.mjs",
  "test:node:viewport-command-owner": "node --test tests/viewport_command_owner_behavior.test.mjs",
  "test:node:renderer-viewport-update-owner": "node --test tests/renderer_viewport_update_owner_behavior.test.mjs",
  "test:node:viewport-resize-lifecycle-owner": "node --test tests/viewport_resize_lifecycle_owner_behavior.test.mjs",
  "test:node:zoom-interaction-lifecycle-owner": "node --test tests/zoom_interaction_lifecycle_owner_behavior.test.mjs",
  "verify:scenario-contracts:strict": "npm run python -- tools/check_scenario_contracts.py --strict --scenario-dir data/scenarios/tno_1962 --report-path .runtime/reports/generated/tno_1962.strict_contract_report.json",
  "test:node:scenario-lifecycle-runtime-behavior": "node --test tests/scenario_lifecycle_runtime_behavior.test.mjs",
  "test:node:scenario-runtime-state-behavior": "node --test tests/scenario_runtime_state_behavior.test.mjs",
  "test:node:scenario-apply-transaction-ownership": "node --test tests/scenario_apply_transaction_ownership.test.mjs",
  "test:node:scenario-chunk-contracts": "node --test tests/scenario_chunk_contracts.test.mjs",
  "test:node:annotation-productization": "node --test tests/file_manager_project_roundtrip_behavior.test.mjs tests/export_workbench_state_behavior.test.mjs tests/strategic_overlay_runtime_owner_behavior.test.mjs",
  "test:py:landing-map-asset-contracts": "npm run python -- -m unittest tests.test_landing_map_asset_contracts -q",
  "verify:pages-dist": "npm run python -- tools/build_pages_dist.py && npm run python -- -m unittest tests.test_pages_dist_startup_shell -q && npm run test:py:landing-map-asset-contracts && npm run test:node:landing-showcase-view",
  "verify:pages-dist-and-drift": "npm run python -- tools/build_pages_dist.py && npm run python -- -m unittest tests.test_pages_dist_startup_shell -q && npm run test:py:landing-map-asset-contracts && npm run test:node:landing-showcase-view && git diff --exit-code -- dist/.nojekyll dist/app.js dist/index.html dist/styles.css dist/assets dist/app/index.html dist/app/js dist/app/css dist/app/vendor dist/pages-dist-manifest.json",
  "verify:dist-drift": "npm run python -- tools/build_pages_dist.py && git diff --exit-code -- dist/.nojekyll dist/app.js dist/index.html dist/styles.css dist/assets dist/app/index.html dist/app/js dist/app/css dist/app/vendor dist/pages-dist-manifest.json",
  "test:e2e:smoke": "node tools/e2e_layering.mjs run smoke",
  "test:e2e:scenario-apply-concurrency": "node node_modules/@playwright/test/cli.js test tests/e2e/scenario_apply_concurrency.spec.js --workers=1 --retries=0",
  "test:e2e:project-save-load": "node node_modules/@playwright/test/cli.js test tests/e2e/project_save_load_roundtrip.spec.js --workers=1",
  "test:e2e:interaction-funnel": "node node_modules/@playwright/test/cli.js test tests/e2e/interaction_funnel_contract.spec.js --workers=1 --retries=0",
};

const TEST_MAX_ARGV_BYTES = process.platform === "win32" ? 30_000 : 131_072;

function adaptiveContributor(commandRef, {
  disposition = "child-safe",
  executionOwners = [disposition],
  sourceRefs = [`source:${commandRef}`],
  domains = ["test-routing"],
  ownerHints = ["test-routing"],
  cost = "contract",
  resourceLocks = [],
  tiers = ["contract"],
  ciProfiles = disposition === "child-safe" ? ["pr-fast"] : ["full"],
  routeIds = [`route:${commandRef}`],
  safetyContributorRouteIds = routeIds,
  platforms = [process.platform],
  batchSafe = false,
  isolation = "process",
  maxLeaves = 64,
  maxArgvBytes = TEST_MAX_ARGV_BYTES,
  entrypointPolicy = {
    schemaVersion: 1,
    eligibleEntrypoints: disposition === "child-safe" ? ["edit", "impact", "pr"] : ["nightly"],
    minimumDepth: disposition === "child-safe" ? "local" : "nightly",
    executionTarget: disposition === "child-safe" ? "child-safe" : "main-thread",
    deferredReason: disposition === "child-safe" ? null : "requires-nightly-verification",
    plannerDisposition: "planned",
    blockedReason: null,
    localProjection: null,
  },
} = {}) {
  return {
    commandRef,
    executionOwner: disposition,
    executionOwners,
    sourceRefs,
    domains,
    ownerHints,
    cost,
    platforms,
    resourceLocks,
    tiers,
    ciProfiles,
    routeIds,
    safetyContributorRouteIds,
    entrypointPolicy,
    provenance: {
      routeIds: [...routeIds],
      safetyContributorRouteIds: [...safetyContributorRouteIds],
    },
    disposition,
    batchSafe,
    isolation,
    maxLeaves,
    maxArgvBytes,
  };
}

function adaptiveReport({
  selected = [],
  mainThread = [],
  ciOnly = [],
  blocked = [],
  selectionPlatform = process.platform,
} = {}) {
  return {
    schemaVersion: 1,
    selectionPlatform,
    changedFiles: ["tests/synthetic.test.mjs"],
    recommendedCommands: [...selected, ...mainThread, ...ciOnly, ...blocked].map((entry) => structuredClone(entry)),
    childAgentStaticTasks: selected.map((entry) => structuredClone(entry)),
    mainThreadSerialVerification: mainThread.map((entry) => structuredClone(entry)),
    ciOnlyVerification: ciOnly.map((entry) => structuredClone(entry)),
    blockedVerification: blocked.map((entry) => structuredClone(entry)),
    matchedByFile: [],
    unmatchedChangedFiles: [],
  };
}

function commandRefs(plan) {
  return plan.commandsToRun.map((entry) => entry.commandRef);
}

function assertCommandRefsInclude(plan, expectedCommandRefs) {
  const refs = new Set(commandRefs(plan));
  for (const commandRef of expectedCommandRefs) {
    assert.equal(refs.has(commandRef), true, `${commandRef} should be present in the verify:core plan`);
  }
}

function assertNoRendererRuntimeSelection(report) {
  for (const command of report.recommendedCommands) {
    assert.equal(command.domains.includes("renderer-runtime"), false);
    assert.equal(command.ownerHints.includes("renderer-runtime"), false);
  }
  for (const entry of report.matchedByFile) {
    for (const command of entry.recommendedCommands) {
      assert.equal(command.domains.includes("renderer-runtime"), false);
      assert.equal(command.ownerHints.includes("renderer-runtime"), false);
    }
  }
}

function runAdaptiveLocalCliFixture(t, fixtureName) {
  const fixturePath = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    `adaptive_local_cli_${fixtureName}.json`,
  );
  const fixtureBytes = fs.readFileSync(fixturePath);
  const fixture = JSON.parse(fixtureBytes.toString("utf8"));
  const fixtureDigest = createHash("sha256").update(fixtureBytes).digest("hex");
  const runtimeTmp = path.join(process.cwd(), ".runtime", "tmp");
  fs.mkdirSync(runtimeTmp, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(runtimeTmp, `adaptive-local-cli-${fixtureName}-`));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const changedFileByFixture = {
    source_mismatch: "package.json",
    missing_selector: "tools/run_adaptive_tests.mjs",
    renamed_selector: "tools/select_verification_targets.mjs",
    recursive: "tools/run_adaptive_tests.mjs",
  };
  const changedFile = changedFileByFixture[fixtureName];
  const selectionPath = path.join(tempRoot, "selection.json");
  const selectionMarkdownPath = path.join(tempRoot, "selection.md");
  const selectionProfilePath = path.join(tempRoot, "selection-profile.json");
  const commonArgs = [
    "tools/run_adaptive_tests.mjs",
    "--verification-catalog-fixture",
    fixturePath,
    "--verification-catalog-fixture-sha256",
    fixtureDigest,
    "--entrypoint",
    "impact",
    "--defer-main-thread",
    "--changed-file",
    changedFile,
  ];
  const seedResult = spawnSync(process.execPath, [
    ...commonArgs,
    "--dry-run",
    "--json-out",
    selectionPath,
    "--md-out",
    selectionMarkdownPath,
    "--profile-out",
    selectionProfilePath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(seedResult.status, 2, seedResult.stderr || seedResult.stdout);
  assert.equal(fs.existsSync(selectionPath), true);

  const artifactPath = path.join(tempRoot, "evidence.json");
  const result = spawnSync(process.execPath, [
    ...commonArgs,
    "--execute",
    "--selection-json",
    selectionPath,
    "--json-out",
    artifactPath,
    "--md-out",
    path.join(tempRoot, "evidence.md"),
    "--profile-out",
    path.join(tempRoot, "evidence-profile.json"),
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 2, result.stderr || result.stdout);
  assert.equal(fs.existsSync(artifactPath), true);
  return {
    artifact: JSON.parse(fs.readFileSync(artifactPath, "utf8")),
    commonArgs,
    fixture,
    fixtureDigest,
    fixturePath,
    result,
    seedArtifact: JSON.parse(fs.readFileSync(selectionPath, "utf8")),
    selectionPath,
    seedResult,
    tempRoot,
  };
}

function runAdaptivePositiveCliFixture(t) {
  const fixturePath = path.join(
    process.cwd(),
    "tests",
    "fixtures",
    "adaptive_local_cli_valid.json",
  );
  const fixtureBytes = fs.readFileSync(fixturePath);
  const fixtureDigest = createHash("sha256").update(fixtureBytes).digest("hex");
  const runtimeTmp = path.join(process.cwd(), ".runtime", "tmp");
  fs.mkdirSync(runtimeTmp, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(runtimeTmp, "adaptive-local-cli-valid-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const artifactPath = path.join(tempRoot, "evidence.json");
  const profilePath = path.join(tempRoot, "evidence-profile.json");
  const result = spawnSync(process.execPath, [
    "tools/run_adaptive_tests.mjs",
    "--verification-catalog-fixture",
    fixturePath,
    "--verification-catalog-fixture-sha256",
    fixtureDigest,
    "--entrypoint",
    "impact",
    "--dry-run",
    "--defer-main-thread",
    "--changed-file",
    "tools/verification/verification_profile.mjs",
    "--json-out",
    artifactPath,
    "--md-out",
    path.join(tempRoot, "evidence.md"),
    "--profile-out",
    profilePath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return {
    artifact: JSON.parse(fs.readFileSync(artifactPath, "utf8")),
    fixtureDigest,
    profile: JSON.parse(fs.readFileSync(profilePath, "utf8")),
  };
}

function assertEverySelectorRootHasCanonicalOutcome(artifact) {
  assert.deepEqual(
    artifact.executionPlan.selectorRootOutcomes.map((entry) => entry.commandRef).sort(),
    artifact.rawCanonicalRoots.map((entry) => entry.commandRef).sort(),
  );
  assert.ok(artifact.executionPlan.selectorRootOutcomes.every((entry) => (
    [
      "requested",
      "requested-superseded",
      "deferred-main-thread",
      "deferred-main-thread-superseded",
      "deferred-main-thread-platform",
      "deferred-ci-only",
      "deferred-ci-only-superseded",
      "deferred-ci-only-platform",
      "deferred-by-tier",
      "superseded-by-projection",
      "blocked",
      "gap",
    ].includes(entry.disposition)
  )));
}

function bindSelectorPrCost(report) {
  return {
    ...report,
    prCost: buildPrCostObservation({
      selectorReport: report,
      observationStage: "selector",
    }),
  };
}

test("verify-core runner node route stays in test-routing domain", () => {
  const route = buildRouteIndex().find((candidate) => candidate.id === "node:test:node:verify-core-runner");

  assert.ok(route);
  assert.equal(route.commandRef, "test:node:verify-core-runner");
  assert.equal(route.domain, "test-routing");
});

test("verify-core runner selector coverage stays out of renderer runtime", () => {
  assertNoRendererRuntimeSelection(buildRecommendation(["tools/run_core_verification.mjs"]));
  assertNoRendererRuntimeSelection(buildRecommendation(["tests/verify_core_runner_behavior.test.mjs"]));
});

test("default core only admits child-safe commands without resource locks", () => {
  const plan = buildCoreVerificationPlan({ packageScripts: PACKAGE_SCRIPTS });
  assert.equal(plan.includeMainThread, false);
  assert.equal(plan.requiresDistLaneOwner, false);
  assert.ok(plan.commandsToRun.length > 0);
  for (const entry of plan.commandsToRun) {
    const records = VERIFICATION_DOMAINS.filter((record) => record.commandRef === entry.commandRef);
    assert.ok(records.length > 0, entry.commandRef);
    assert.ok(records.every((record) => record.executionOwner === "child-safe"
      && record.resourceLocks.length === 0 && record.cost !== "heavy"), entry.commandRef);
  }
  for (const commandRef of ["verify:p4:state-writer-policy", "test:python:p4:state-write-boundary",
    "verify:pages-dist-and-drift", "verify:scenario-contracts:strict", "test:e2e:smoke"]) {
    assert.equal(commandRefs(plan).includes(commandRef), false, commandRef);
    assert.ok(plan.skippedMainThreadCommands.some((entry) => entry.commandRef === commandRef), commandRef);
  }
  const explicit = buildCoreVerificationPlan({ packageScripts: PACKAGE_SCRIPTS, includeMainThread: true });
  assertCommandRefsInclude(explicit, ["verify:p4:state-writer-policy", "verify:pages-dist-and-drift",
    "verify:scenario-contracts:strict", "test:e2e:smoke"]);
});

test("default core rejects missing metadata and restrictive duplicate records", () => {
  const groups = [{ id: "fixture", title: "fixture", commands: ["safe", "locked", "unknown", "mixed"] }];
  const packageScripts = Object.fromEntries(groups[0].commands.map((ref) => [ref, "node " + ref + ".mjs"]));
  const record = (commandRef, patch = {}) => ({ commandRef, executionOwner: "child-safe", resourceLocks: [], cost: "contract", ...patch });
  const metadata = [record("safe"), record("locked", { resourceLocks: ["dist"] }),
    record("mixed"), record("mixed", { executionOwner: "main-thread" })];
  const options = { groups, packageScripts, metadata, mainThreadGroup: { id: "main", commands: [] }, optionalMainThreadCommands: [] };
  assert.deepEqual(commandRefs(buildCoreVerificationPlan(options)), ["safe"]);
  assert.deepEqual(commandRefs(buildCoreVerificationPlan({ ...options, includeReserved: true })), groups[0].commands);
});

test("Nightly Linux core sharding balances canonical leaves and excludes platform-owned producers", () => {
  const packageScripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts;
  const basePlan = buildCoreVerificationPlan({ packageScripts, includeReserved: true });
  const plan = buildNightlyLinuxCoreShardPlan({
    basePlan,
    shardIndex: 1,
    shardCount: 3,
  });
  const assignments = plan.nightlyShard.assignments;
  const assignedCommandRefs = assignments.flatMap((entry) => entry.commandRefs);
  const expectedCommandRefs = basePlan.commandsToRun
    .map((entry) => entry.commandRef)
    .filter((commandRef) => !NIGHTLY_LINUX_CORE_EXCLUDED_COMMAND_REFS.includes(commandRef));

  assert.equal(assignments.length, 3);
  assert.deepEqual([...assignedCommandRefs].sort(), [...expectedCommandRefs].sort());
  assert.equal(new Set(assignedCommandRefs).size, assignedCommandRefs.length);
  assert.equal(plan.nightlyShard.totalLeafCount, assignments.reduce(
    (total, entry) => total + entry.leafCount,
    0,
  ));
  assert.ok(Math.max(...assignments.map((entry) => entry.leafCount))
    - Math.min(...assignments.map((entry) => entry.leafCount)) <= 1);
  for (const commandRef of NIGHTLY_LINUX_CORE_EXCLUDED_COMMAND_REFS) {
    assert.equal(assignedCommandRefs.includes(commandRef), false, commandRef);
  }
  assert.equal(
    assignedCommandRefs.some((commandRef) => /^(?:verify|test:node|test:python):p4:/.test(commandRef)),
    false,
  );
  assert.equal(assignedCommandRefs.includes("verify:pages-dist-and-drift"), false);
  assert.equal(plan.requiresDistLaneOwner, false);
  assert.equal(plan.commandsToRun.length, assignments[0].commandRefs.length);
  assert.deepEqual(
    plan.commandsToRun.map((entry) => entry.commandRef),
    assignments[0].commandRefs,
  );
});

test("Nightly Linux core sharding is deterministic and rejects invalid leaf authority", () => {
  const commands = [
    { commandRef: "alpha" },
    { commandRef: "beta" },
    { commandRef: "gamma" },
    { commandRef: "delta" },
  ];
  const leaves = new Map([
    ["alpha", 7],
    ["beta", 5],
    ["gamma", 3],
    ["delta", 1],
  ]);
  const first = partitionNightlyLinuxCoreCommands(commands, {
    shardCount: 2,
    leafCounter: (commandRef) => leaves.get(commandRef),
  });
  const second = partitionNightlyLinuxCoreCommands(commands, {
    shardCount: 2,
    leafCounter: (commandRef) => leaves.get(commandRef),
  });

  assert.deepEqual(first, second);
  assert.deepEqual(first.map((entry) => entry.leafCount), [8, 8]);
  assert.throws(
    () => partitionNightlyLinuxCoreCommands(commands, {
      shardCount: 2,
      leafCounter: () => 0,
    }),
    /invalid leaf count/,
  );
});

test("Nightly scenario heavy plan selects the exact canonical geo stack routes", () => {
  const routes = buildRouteIndex();
  const expected = routes.filter((route) => route.id.startsWith("python-heavy:geo_stack:"));
  const plan = buildNightlyScenarioHeavyPlan({ routes });

  assert.equal(expected.length, 15);
  assert.equal(plan.commandsToRun.length, 15);
  assert.deepEqual(
    plan.commandsToRun.map((entry) => entry.commandRef),
    expected.map((route) => route.commandRef),
  );
  assert.deepEqual(plan.nightlyScenarioHeavy.routeIds, expected.map((route) => route.id));
  assert.equal(new Set(plan.nightlyScenarioHeavy.routeIds).size, 15);
});

test("Nightly scenario heavy plan fails closed on route metadata drift", () => {
  const validRoutes = buildRouteIndex();
  const heavyRoutes = validRoutes.filter((route) => route.id.startsWith("python-heavy:geo_stack:"));
  const replaceRoute = (routeId, patch) => validRoutes.map((route) => (
    route.id === routeId ? { ...route, ...patch } : route
  ));
  const first = heavyRoutes[0];

  assert.throws(
    () => buildNightlyScenarioHeavyPlan({ routes: validRoutes.filter((route) => route.id !== first.id) }),
    /exactly 15/,
  );
  assert.throws(
    () => buildNightlyScenarioHeavyPlan({
      routes: [...validRoutes.filter((route) => route.id !== heavyRoutes[1].id), { ...first }],
    }),
    /unique route id/,
  );
  assert.throws(
    () => buildNightlyScenarioHeavyPlan({ routes: replaceRoute(first.id, { commandRef: heavyRoutes[1].commandRef }) }),
    /unique commandRef/,
  );
  for (const [field, value] of [
    ["cost", "medium"],
    ["executionOwner", "child-safe"],
    ["ciProfile", "pr-fast"],
    ["platforms", ["windows"]],
    ["resourceLocks", ["heavy-geo"]],
  ]) {
    assert.throws(
      () => buildNightlyScenarioHeavyPlan({ routes: replaceRoute(first.id, { [field]: value }) }),
      new RegExp(field === "resourceLocks" ? "required resource locks" : field),
    );
  }
});

test("reserved core plan applies strict command closure without changing test coverage", () => {
  const packageScripts = JSON.parse(
    fs.readFileSync("package.json", "utf8"),
  ).scripts;
  const rawPlan = buildCoreVerificationPlan({
    packageScripts,
    applySupersession: false,
    includeReserved: true,
  });
  const plan = buildCoreVerificationPlan({ packageScripts, includeReserved: true });
  const rawLeaves = rawPlan.commandsToRun.flatMap(({ commandRef }) => (
    resolveCommandLeafProcesses(commandRef, packageScripts)
  ));
  const retainedLeaves = plan.commandsToRun.flatMap(({ commandRef }) => (
    resolveCommandLeafProcesses(commandRef, packageScripts)
  ));
  const nodeFiles = (targetPlan) => [...new Set(
    targetPlan.commandsToRun.flatMap(({ commandRef }) => (
      nodeTestFileClosure(commandRef, packageScripts)
    )),
  )].sort();

  assert.ok(plan.commandsToRun.length < rawPlan.commandsToRun.length);
  assert.ok(retainedLeaves.length < rawLeaves.length);
  assert.deepEqual(nodeFiles(plan), nodeFiles(rawPlan));
  assert.deepEqual(
    plan.supersededCommands.map(({ commandRef }) => commandRef).sort(),
    [
      "test:node:renderer-render-phase-lifecycle",
      "test:node:scenario-apply-transaction-ownership",
      "test:node:scenario-chunk-contracts",
      "test:node:scenario-lifecycle-runtime-behavior",
      "test:node:scenario-runtime-state-behavior",
      "test:node:zoom-interaction-lifecycle-owner",
    ],
  );
});

test("includeMainThread adds explicit E2E group and keeps optional E2E skipped", () => {
  const plan = buildCoreVerificationPlan({ packageScripts: PACKAGE_SCRIPTS, includeMainThread: true });

  assert.equal(plan.startsBrowserDevServerOrPlaywright, true);
  assertCommandRefsInclude(plan, [
    "test:e2e:smoke",
    "test:e2e:scenario-apply-concurrency",
    "test:e2e:project-save-load",
    "test:e2e:interaction-funnel",
  ]);
  assert.deepEqual(
    plan.skippedMainThreadCommands.map((entry) => entry.commandRef),
    [
      "test:node:windows-job-runtime:integration",
      "perf:williams-power-scheme:live-preflight",
      "test:e2e:dev:scenario-chunk-runtime",
      "test:e2e:tno-contracts",
      "test:e2e:water-rendering",
      "test:e2e:city-rendering",
      M9_LIVE_REPOSITORY_SHADOW_COMMAND,
    ],
  );
});

test("plan filters empty commandRef, duplicates, self-recursion, and missing package scripts", () => {
  const plan = buildCoreVerificationPlan({
    includeReserved: true,
    packageScripts: {
      ok: "node ok.mjs",
      duplicate: "node ok.mjs",
      "verify:core": "node tools/run_core_verification.mjs",
    },
    groups: [
      {
        id: "custom",
        title: "Custom",
        commands: ["ok", "", "duplicate", "verify:core", "node tools/run_core_verification.mjs --list", "missing"],
      },
    ],
    mainThreadGroup: { id: "main", title: "Main", commands: [] },
    optionalMainThreadCommands: [],
  });

  assert.deepEqual(commandRefs(plan), ["ok"]);
  assert.deepEqual(
    plan.duplicateCommands.map((entry) => [entry.commandRef, entry.duplicateOf, entry.command]),
    [["duplicate", "ok", "node ok.mjs"]],
  );
  assert.deepEqual(
    plan.omittedCommands.map((entry) => [entry.commandRef, entry.reason]),
    [
      ["", "empty commandRef"],
      ["verify:core", "self recursion"],
      ["node tools/run_core_verification.mjs --list", "self recursion"],
      ["missing", "missing package script"],
    ],
  );
});

test("commandToProcess resolves package scripts, direct node, and direct npm on Windows", () => {
  assert.deepEqual(
    commandToProcess("ok", { packageScripts: { ok: "node ok.mjs" }, platform: "linux" }),
    { bin: "npm", args: ["run", "ok"] },
  );
  assert.deepEqual(
    commandToProcess("node tools/run_core_verification.mjs --list", { packageScripts: {}, platform: "win32" }),
    { bin: "node", args: ["tools/run_core_verification.mjs", "--list"] },
  );
  assert.deepEqual(
    commandToProcess("npm run test:node:verify-core-runner", { packageScripts: {}, platform: "win32" }),
    { bin: "cmd.exe", args: ["/d", "/s", "/c", "npm", "run", "test:node:verify-core-runner"] },
  );
});

test("--list writes reports and does not execute", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-core-"));
  const calls = [];
  const result = runCoreVerification({
    argv: {
      ...parseArgs([
        "--list",
        "--json-out",
        path.join(tempDir, "verify-core.json"),
        "--md-out",
        path.join(tempDir, "verify-core.md"),
      ]),
      profileOut: path.join(tempDir, "verify-core-profile.json"),
    },
    packageScripts: PACKAGE_SCRIPTS,
    runner(bin, args) {
      calls.push([bin, args]);
      return { status: 0 };
    },
    stdio: "pipe",
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 0);
  assert.equal(fs.existsSync(path.join(tempDir, "verify-core.json")), true);
  assert.equal(fs.existsSync(path.join(tempDir, "verify-core.md")), true);
  assert.equal(fs.existsSync(path.join(tempDir, "verify-core-profile.json")), true);
  assert.equal(
    JSON.parse(fs.readFileSync(path.join(tempDir, "verify-core-profile.json"), "utf8")).lifecycle.state,
    "listed",
  );
});

test("--nightly-scenario-heavy wires the canonical plan into checkpointed reporting", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-scenario-heavy-"));
  const result = runCoreVerification({
    argv: parseArgs([
      "--list",
      "--nightly-scenario-heavy",
      "--json-out",
      path.join(tempDir, "scenario-heavy.json"),
      "--md-out",
      path.join(tempDir, "scenario-heavy.md"),
      "--profile-out",
      path.join(tempDir, "scenario-heavy-profile.json"),
    ]),
    packageScripts: PACKAGE_SCRIPTS,
    runner() {
      throw new Error("list mode must not spawn scenario heavy commands");
    },
    stdio: "pipe",
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.report.runnerId, "verify-nightly-scenario-heavy");
  assert.equal(result.report.commands.length, 15);
  assert.equal(result.report.nightlyScenarioHeavy.routeCount, 15);
  assert.equal(result.report.verdict, "listed");
});

test("core observer publication failures preserve command order and original exit", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-core-profile-failure-"));
  const profileParent = path.join(tempDir, "profile-parent");
  fs.writeFileSync(profileParent, "file blocks directory creation", "utf8");
  const calls = [];
  const result = runCoreVerification({
    argv: {
      ...parseArgs([]),
      jsonOut: path.join(tempDir, "verify-core.json"),
      mdOut: path.join(tempDir, "verify-core.md"),
      profileOut: path.join(profileParent, "verify-core-profile.json"),
    },
    packageScripts: PACKAGE_SCRIPTS,
    identityReader: () => cleanIdentity("profile-failure", "profile-failure-tree"),
    stdio: "pipe",
    stateWriterEvidenceEnsurer: ({ producer }) => fakeStateWriterEvidenceResult({
      commandRef: producer.commandRef,
    }),
    runner(bin, args) {
      calls.push([bin, ...args]);
      return { status: calls.length === 2 ? 7 : 0 };
    },
  });

  assert.equal(result.exitCode, 7);
  assert.equal(calls.length, 2);
  assert.equal(result.report.observerDiagnostics.profile.status, "error");
  assert.equal(result.report.observerDiagnostics.profile.lastFailure.phase, "publish");
  const persisted = JSON.parse(fs.readFileSync(path.join(tempDir, "verify-core.json"), "utf8"));
  assert.equal(persisted.observerDiagnostics.profile.failureCount > 0, true);
});

test("core observer builder failures remain diagnostic across successful execution", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-core-profile-builder-"));
  let calls = 0;
  const result = runCoreVerification({
    argv: {
      ...parseArgs([]),
      jsonOut: path.join(tempDir, "verify-core.json"),
      mdOut: path.join(tempDir, "verify-core.md"),
      profileOut: path.join(tempDir, "verify-core-profile.json"),
    },
    packageScripts: PACKAGE_SCRIPTS,
    identityReader: () => cleanIdentity("builder-failure", "builder-failure-tree"),
    stdio: "pipe",
    stateWriterEvidenceEnsurer: ({ producer }) => fakeStateWriterEvidenceResult({
      commandRef: producer.commandRef,
    }),
    profileBuilder() {
      throw Object.assign(new Error("profile builder exploded"), { code: "profile-builder-test" });
    },
    runner() {
      calls += 1;
      return { status: 0 };
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls, result.plan.commandsToRun.length);
  assert.equal(result.report.observerDiagnostics.profile.lastFailure.code, "profile-builder-test");
  assert.equal(fs.existsSync(path.join(tempDir, "verify-core-profile.json")), false);
});

test("core running checkpoints stay pre-spawn until the runner returns", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "verify-core-process-start-"));
  const snapshots = [];
  const result = runCoreVerification({
    argv: {
      ...parseArgs([]),
      jsonOut: path.join(tempDir, "verify-core.json"),
      mdOut: path.join(tempDir, "verify-core.md"),
      profileOut: path.join(tempDir, "verify-core-profile.json"),
    },
    packageScripts: PACKAGE_SCRIPTS,
    identityReader: () => cleanIdentity("process-start", "process-start-tree"),
    stdio: "pipe",
    profileBuilder(input) {
      snapshots.push(input.executionResults.map((entry) => ({
        status: entry.status,
        processStarted: entry.processStarted,
      })));
      return buildVerificationProfile(input);
    },
    runner() {
      return { status: 7 };
    },
  });

  assert.equal(result.exitCode, 7);
  assert.equal(snapshots[0][0].processStarted, false);
  assert.deepEqual(snapshots[1][0], { status: "running", processStarted: false });
  assert.deepEqual(snapshots[2][0], { status: "failed", processStarted: true });
  assert.equal(result.report.commands[0].processStarted, true);
});

test("adaptive observer publication and builder failures stay in primary evidence", () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-profile-failure-"));
  const profileParent = path.join(tempDir, "profile-parent");
  fs.writeFileSync(profileParent, "file blocks directory creation", "utf8");
  const args = {
    jsonOut: path.join(tempDir, "adaptive.json"),
    mdOut: path.join(tempDir, "adaptive.md"),
    profileOut: path.join(profileParent, "adaptive-profile.json"),
  };
  const report = {
    adaptiveMode: "execute",
    discoveryMode: "explicit-input",
    mainThreadDisposition: "deferred",
    changedFiles: [],
    recommendedCommands: [],
    unmatchedChangedFiles: [],
  };
  const executionPlan = {
    commandsToRun: [],
    blockedMainThreadCommands: [],
    supersededCommands: [],
  };
  writeAdaptiveOutputs(report, args, [], executionPlan);
  let persisted = JSON.parse(fs.readFileSync(args.jsonOut, "utf8"));
  assert.equal(persisted.observerDiagnostics.profile.lastFailure.phase, "publish");

  const calls = [];
  const executionCommands = [
    { commandRef: "node first.mjs", process: { bin: "node", args: ["first.mjs"] } },
    { commandRef: "node second.mjs", process: { bin: "node", args: ["second.mjs"] } },
  ];
  const results = executeAdaptivePlan({
    ...executionPlan,
    commandsToRun: ["node first.mjs", "node second.mjs"],
    executionCommands,
  }, {
    runner() {
      calls.push(calls.length + 1);
      return { status: calls.length === 2 ? 7 : 0 };
    },
    onCheckpoint(entries) {
      writeAdaptiveOutputs(report, args, entries, {
        ...executionPlan,
        commandsToRun: ["node first.mjs", "node second.mjs"],
        executionCommands,
      });
    },
  });
  assert.deepEqual(results.map((entry) => entry.exitCode), [0, 7]);
  assert.equal(calls.length, 2);
  persisted = JSON.parse(fs.readFileSync(args.jsonOut, "utf8"));
  assert.equal(persisted.observerDiagnostics.profile.status, "error");

  writeAdaptiveOutputs(report, {
    ...args,
    profileOut: path.join(tempDir, "adaptive-profile.json"),
  }, [], executionPlan, {
    profileBuilder() {
      throw Object.assign(new Error("adaptive builder exploded"), { code: "adaptive-builder-test" });
    },
  });
  persisted = JSON.parse(fs.readFileSync(args.jsonOut, "utf8"));
  assert.equal(persisted.observerDiagnostics.profile.lastFailure.code, "adaptive-builder-test");
  assert.equal(persisted.observerDiagnostics.profile.lastFailure.phase, "build");
});

test("execution records failure and stops on first failing command", () => {
  const plan = buildCoreVerificationPlan({
    includeReserved: true,
    packageScripts: { first: "node first.mjs", second: "node second.mjs", third: "node third.mjs" },
    groups: [{ id: "custom", title: "Custom", commands: ["first", "second", "third"] }],
    mainThreadGroup: { id: "main", title: "Main", commands: [] },
    optionalMainThreadCommands: [],
  });
  const calls = [];
  const results = runVerificationPlan(plan, {
    packageScripts: { first: "node first.mjs", second: "node second.mjs", third: "node third.mjs" },
    platform: "linux",
    stdio: "pipe",
    runner(bin, args) {
      calls.push([bin, args]);
      return { status: calls.length === 2 ? 7 : 0 };
    },
  });

  assert.deepEqual(results.map((entry) => [entry.commandRef, entry.exitCode]), [["first", 0], ["second", 7]]);
  assert.equal(calls.length, 2);
});

test("direct core plan execution injects strict evidence before a Python boundary", () => {
  const commandRef = "test:python:p4:p4-1-boundary";
  const plan = buildCoreVerificationPlan({
    includeReserved: true,
    packageScripts: { [commandRef]: "node fake-python-boundary.mjs" },
    groups: [{ id: "custom", title: "Custom", commands: [commandRef] }],
    mainThreadGroup: { id: "main", title: "Main", commands: [] },
    optionalMainThreadCommands: [],
  });
  const calls = [];
  const results = runVerificationPlan(plan, {
    packageScripts: { [commandRef]: "node fake-python-boundary.mjs" },
    platform: "linux",
    stdio: "pipe",
    baseEnv: {},
    stateWriterEvidenceEnsurer: () => fakeStateWriterEvidenceResult({ commandRef }),
    runner(bin, args, options) {
      calls.push({ bin, args, options });
      return { status: 0 };
    },
  });

  assert.equal(results[0].exitCode, 0);
  assert.equal(results[0].externalEvidence.evidenceId, "a".repeat(64));
  assert.equal(calls[0].options.env.STATE_WRITER_POLICY_EVIDENCE_MODE, "strict");
  assert.equal(calls[0].options.env.STATE_WRITER_POLICY_EVIDENCE_ID, "a".repeat(64));
});

test("each direct-plan invocation owns one fallback session across boundaries", () => {
  const commandRefs = [
    "test:python:p4:p4-1-boundary",
    "test:python:p4:p4-2a-boundary",
  ];
  const packageScripts = Object.fromEntries(
    commandRefs.map((commandRef, index) => [
      commandRef,
      `node fake-boundary-${index}.mjs`,
    ]),
  );
  const plan = buildCoreVerificationPlan({
    includeReserved: true,
    packageScripts,
    groups: [{ id: "custom", title: "Custom", commands: commandRefs }],
    mainThreadGroup: { id: "main", title: "Main", commands: [] },
    optionalMainThreadCommands: [],
  });
  let producerCount = 0;
  const sessions = [];
  const stateWriterEvidenceEnsurer = ({ producer, liveFallbackSession }) => {
    sessions.push(liveFallbackSession);
    if (liveFallbackSession.liveFallbackAttempts === 0) {
      liveFallbackSession.liveFallbackAttempts += 1;
      producerCount += 1;
    }
    return fakeStateWriterEvidenceResult({ commandRef: producer.commandRef });
  };

  for (let invocation = 0; invocation < 2; invocation += 1) {
    const results = runVerificationPlan(plan, {
      packageScripts,
      platform: "linux",
      stdio: "pipe",
      stateWriterEvidenceEnsurer,
      runner: () => ({ status: 0 }),
    });
    assert.deepEqual(results.map(({ exitCode }) => exitCode), [0, 0]);
  }

  assert.equal(producerCount, 2);
  assert.equal(sessions[0], sessions[1]);
  assert.notEqual(sessions[1], sessions[2]);
  assert.equal(sessions[2], sessions[3]);
});

function cleanIdentity(verificationSha, verificationTreeSha) {
  return {
    verificationSha,
    verificationTreeSha,
    workspaceClean: true,
    trackedClean: true,
    includesUntracked: true,
    workspaceStatus: "",
  };
}

function fakeStateWriterEvidenceResult({
  commandRef = "test:python:p4:p4-1-boundary",
  disposition = "reused-exact",
} = {}) {
  return {
    status: disposition === "produced-live" ? "produced-live" : "reusable-exact",
    disposition,
    evidenceId: "a".repeat(64),
    evidencePath: ".runtime/reports/generated/p4-state-actions/P4.4/state-writer-policy-evidence.json",
    sourceVerificationSha: "b".repeat(40),
    sourceVerificationTreeSha: "c".repeat(40),
    producer: {
      entrypoint: "tools/run_core_verification.mjs",
      commandRef,
      planDigest: "d".repeat(64),
      producedAt: "2026-08-13T00:00:00.000Z",
      disposition: "produced-live",
    },
    evidence: { phase: "P4.4" },
  };
}

function checkpointFor(planIdentity, identity, passedIndexes) {
  const commands = buildCommandStates(planIdentity);
  for (const index of passedIndexes) {
    Object.assign(commands[index], {
      status: "passed",
      exitCode: 0,
      startedAt: "2026-08-13T00:00:00.000Z",
      finishedAt: "2026-08-13T00:00:01.000Z",
      durationMs: 1000,
      verificationIdentityAfter: identity,
      evidenceValidatedForIdentity: identity,
    });
  }
  const allPassed = commands.every((entry) => entry.status === "passed");
  return {
    schemaVersion: RESUMABLE_VERIFICATION_SCHEMA_VERSION,
    kind: RESUMABLE_VERIFICATION_KIND,
    runnerId: planIdentity.runnerId,
    planIdentity,
    verificationIdentity: identity,
    finalVerificationIdentity: allPassed ? identity : null,
    verdict: allPassed ? "pass" : "failed",
    commands,
  };
}

test("resume parsing is explicit and does not expose an arbitrary skip flag", () => {
  assert.deepEqual(parseArgs(["--resume-from", "previous.json"]), {
    list: false,
    includeMainThread: false,
    includeReserved: false,
    resume: true,
    resumeFrom: "previous.json",
    nightlyLinuxCore: false,
    nightlyScenarioHeavy: false,
    shardIndex: 1,
    shardCount: 3,
    jsonOut: path.join(process.cwd(), ".runtime", "reports", "generated", "verify-core.json"),
    mdOut: path.join(process.cwd(), ".runtime", "reports", "generated", "verify-core.md"),
    profileOut: path.join(process.cwd(), ".runtime", "reports", "generated", "verify-core-profile.json"),
  });
  assert.deepEqual(
    parseArgs(["--nightly-linux-core", "--shard-index", "2", "--shard-count", "3"]),
    {
      list: false,
      includeMainThread: false,
      includeReserved: false,
      resume: false,
      resumeFrom: null,
      nightlyLinuxCore: true,
      nightlyScenarioHeavy: false,
      shardIndex: 2,
      shardCount: 3,
      jsonOut: path.join(process.cwd(), ".runtime", "reports", "generated", "verify-core.json"),
      mdOut: path.join(process.cwd(), ".runtime", "reports", "generated", "verify-core.md"),
      profileOut: path.join(process.cwd(), ".runtime", "reports", "generated", "verify-core-profile.json"),
    },
  );
  assert.equal(parseArgs(["--nightly-scenario-heavy"]).nightlyScenarioHeavy, true);
  assert.throws(
    () => parseArgs(["--nightly-linux-core", "--nightly-scenario-heavy"]),
    /mutually exclusive/,
  );
  assert.throws(() => parseArgs(["--skip", "verify:p4:state-writer-policy"]), /Unknown verify:core argument/);
  assert.throws(() => parseArgs(["--shard-index", "2"]), /require --nightly-linux-core/);
});

test("verification checkpoints atomically replace complete parseable JSON", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-checkpoint-"));
  const reportPath = path.join(root, "nested", "checkpoint.json");
  atomicWriteJsonSync(reportPath, { generation: 1, commands: [{ status: "running" }] });
  atomicWriteJsonSync(reportPath, { generation: 2, commands: [{ status: "passed" }] });

  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath, "utf8")), {
    generation: 2,
    commands: [{ status: "passed" }],
  });
  assert.deepEqual(
    fs.readdirSync(path.dirname(reportPath)).filter((entry) => entry.endsWith(".tmp")),
    [],
  );
});

test("same-tree resume reuses every command with durable passed evidence", () => {
  const planIdentity = buildPlanIdentity({
    runnerId: "verify-core",
    entries: [
      { group: "one", commandRef: "first", command: "node first.mjs", commandType: "package-script" },
      { group: "one", commandRef: "second", command: "node second.mjs", commandType: "package-script" },
    ],
  });
  const identity = cleanIdentity("sha-one", "tree-one");
  const checkpoint = checkpointFor(planIdentity, identity, [0]);
  const decision = decideResume({
    checkpoint,
    runnerId: "verify-core",
    planIdentity,
    verificationIdentity: identity,
    changedFilesReader: () => {
      throw new Error("exact resume must not inspect a diff");
    },
  });
  assert.equal(decision.mode, "exact");
  assert.deepEqual(decision.reusedIndexes, [0]);
});

test("core runner same-tree resume skips its durable passed prefix", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-core-resume-"));
  const jsonOut = path.join(root, "verify-core.json");
  const mdOut = path.join(root, "verify-core.md");
  const identity = cleanIdentity("sha-one", "tree-one");
  let firstCalls = 0;
  const first = runCoreVerification({
    argv: { list: false, includeMainThread: false, includeReserved: true, resume: false, resumeFrom: null, jsonOut, mdOut },
    packageScripts: PACKAGE_SCRIPTS,
    identityReader: () => identity,
    stdio: "pipe",
    now: (() => {
      let tick = 0;
      return () => new Date(tick++ * 5);
    })(),
    runner() {
      firstCalls += 1;
      return { status: firstCalls === 2 ? 7 : 0 };
    },
  });
  assert.equal(first.exitCode, 7);
  assert.equal(first.report.commands[0].status, "passed");
  assert.equal(first.report.commands[1].status, "failed");

  const resumedCalls = [];
  let resumedProducerCount = 0;
  let resumedFallbackSession = null;
  const resumed = runCoreVerification({
    argv: { list: false, includeMainThread: false, includeReserved: true, resume: true, resumeFrom: jsonOut, jsonOut, mdOut },
    packageScripts: PACKAGE_SCRIPTS,
    identityReader: () => identity,
    stdio: "pipe",
    now: (() => {
      let tick = 1000;
      return () => new Date(tick++ * 5);
    })(),
    stateWriterEvidenceEnsurer: ({ producer, liveFallbackSession }) => {
      if (resumedFallbackSession === null) {
        resumedFallbackSession = liveFallbackSession;
      } else {
        assert.equal(liveFallbackSession, resumedFallbackSession);
      }
      if (liveFallbackSession.liveFallbackAttempts === 0) {
        liveFallbackSession.liveFallbackAttempts += 1;
        resumedProducerCount += 1;
      }
      return fakeStateWriterEvidenceResult({ commandRef: producer.commandRef });
    },
    runner(bin, args) {
      resumedCalls.push([bin, ...args]);
      return { status: 0 };
    },
  });

  assert.equal(resumed.exitCode, 0);
  assert.equal(resumed.report.resumeDecision.mode, "exact");
  assert.equal(resumed.report.summary.reused, 1);
  assert.equal(resumed.report.commands[0].evidenceDisposition, "reused-exact");
  assert.equal(resumedCalls.length, resumed.plan.commandsToRun.length - 1);
  assert.equal(resumedProducerCount, 1);
});

test("core runner injects strict exact-tree evidence and persists its trace", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-core-evidence-"));
  const jsonOut = path.join(root, "verify-core.json");
  const mdOut = path.join(root, "verify-core.md");
  const commandRef = "test:python:p4:p4-1-boundary";
  const identity = cleanIdentity("b".repeat(40), "c".repeat(40));
  const ensured = [];
  const spawns = [];

  const result = runCoreVerification({
    argv: { list: false, includeMainThread: false, includeReserved: true, resume: false, resumeFrom: null, jsonOut, mdOut },
    packageScripts: { [commandRef]: "node fake-python-boundary.mjs" },
    cwd: root,
    platform: "linux",
    stdio: "pipe",
    identityReader: () => identity,
    baseEnv: { FIXTURE_ENV: "kept" },
    stateWriterEvidenceEnsurer(options) {
      ensured.push(options);
      return fakeStateWriterEvidenceResult({ commandRef });
    },
    runner(bin, args, options) {
      spawns.push({ bin, args, options });
      return { status: 0 };
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(ensured.length, 1);
  assert.equal(ensured[0].producer.commandRef, commandRef);
  assert.deepEqual(ensured[0].routeApplicability.unmatchedChangedFiles, []);
  assert.equal(spawns.length, result.plan.commandsToRun.length);
  const boundarySpawn = spawns.find(({ args }) => args.includes(commandRef));
  assert.equal(boundarySpawn.options.env.FIXTURE_ENV, "kept");
  assert.equal(boundarySpawn.options.env.STATE_WRITER_POLICY_EVIDENCE_MODE, "strict");
  assert.equal(
    boundarySpawn.options.env.STATE_WRITER_POLICY_EVIDENCE_ID,
    "a".repeat(64),
  );
  assert.equal(
    boundarySpawn.options.env.STATE_WRITER_POLICY_EVIDENCE_PATH,
    fakeStateWriterEvidenceResult().evidencePath,
  );
  const command = result.report.commands.find(
    (entry) => entry.commandRef === commandRef,
  );
  assert.equal(command.externalEvidence.evidenceId, "a".repeat(64));
  assert.equal(command.externalEvidence.disposition, "reused-exact");
  const durable = JSON.parse(fs.readFileSync(jsonOut, "utf8"));
  assert.equal(
    durable.commands.find((entry) => entry.commandRef === commandRef)
      .externalEvidence.evidenceId,
    "a".repeat(64),
  );
  assert.match(fs.readFileSync(mdOut, "utf8"), /evidence=a{64}/);
});

test("core runner blocks a boundary before spawn when evidence setup is blocked", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "verify-core-evidence-blocked-"));
  const commandRef = "test:python:p4:p4-1-boundary";
  const spawns = [];
  const blockedError = Object.assign(new Error("workspace dirty"), {
    code: "state-writer-evidence-workspace-dirty",
    disposition: "blocked",
  });
  const result = runCoreVerification({
    argv: {
      list: false,
      includeMainThread: false, includeReserved: true,
      resume: false,
      resumeFrom: null,
      jsonOut: path.join(root, "verify-core.json"),
      mdOut: path.join(root, "verify-core.md"),
    },
    packageScripts: { [commandRef]: "node fake-python-boundary.mjs" },
    cwd: root,
    platform: "linux",
    stdio: "pipe",
    identityReader: () => cleanIdentity("b".repeat(40), "c".repeat(40)),
    stateWriterEvidenceEnsurer() {
      throw blockedError;
    },
    runner(bin, args) {
      spawns.push([bin, ...args]);
      return { status: 0 };
    },
  });

  assert.equal(result.exitCode, 2);
  assert.equal(
    spawns.some((spawn) => spawn.includes(commandRef)),
    false,
  );
  assert.equal(result.report.failedCommandRef, commandRef);
  const boundary = result.report.commands.find(
    (entry) => entry.commandRef === commandRef,
  );
  assert.equal(
    boundary.externalEvidence.code,
    "state-writer-evidence-workspace-dirty",
  );
  assert.equal(boundary.processStarted, false);
  assert.match(boundary.error, /disposition=blocked/);
});

test("changed-tree resume reruns the suffix from the earliest routed command", () => {
  const planIdentity = buildPlanIdentity({
    runnerId: "verify-core",
    entries: [
      { group: "one", commandRef: "verify:alpha", command: "node alpha.mjs", commandType: "package-script" },
      { group: "one", commandRef: "verify:beta", command: "node beta.mjs", commandType: "package-script" },
      { group: "one", commandRef: "verify:gamma", command: "node gamma.mjs", commandType: "package-script" },
    ],
  });
  const checkpoint = checkpointFor(planIdentity, cleanIdentity("sha-one", "tree-one"), [0, 1]);
  const decision = decideResume({
    checkpoint,
    runnerId: "verify-core",
    planIdentity,
    verificationIdentity: cleanIdentity("sha-two", "tree-two"),
    changedFilesReader: () => ["js/alpha.js"],
    selector: () => ({
      unmatchedChangedFiles: [],
      matchedByFile: [{
        changedFile: "js/alpha.js",
        recommendedCommands: [{ commandRef: "verify:alpha" }],
      }],
    }),
  });
  assert.equal(decision.mode, "sf-ats");
  assert.equal(decision.resumeIndex, 0);
  assert.deepEqual(decision.reusedIndexes, []);
  assert.deepEqual(decision.invalidatedCommandRefs, ["verify:alpha"]);
});

test("cross-revision reused evidence remains bound across repeated exact resumes", () => {
  const planIdentity = buildPlanIdentity({
    runnerId: "verify-core",
    entries: [
      { group: "one", commandRef: "verify:alpha", command: "node alpha.mjs" },
      { group: "one", commandRef: "verify:beta", command: "node beta.mjs" },
      { group: "one", commandRef: "verify:gamma", command: "node gamma.mjs" },
    ],
  });
  const oldIdentity = cleanIdentity("sha-old", "tree-old");
  const currentIdentity = cleanIdentity("sha-current", "tree-current");
  const oldCheckpoint = checkpointFor(planIdentity, oldIdentity, [0]);
  const crossRevision = decideResume({
    checkpoint: oldCheckpoint,
    runnerId: "verify-core",
    planIdentity,
    verificationIdentity: currentIdentity,
    changedFilesReader: () => ["js/beta.js"],
    selector: () => ({
      unmatchedChangedFiles: [],
      matchedByFile: [{
        changedFile: "js/beta.js",
        recommendedCommands: [{ commandRef: "verify:beta" }],
      }],
    }),
  });
  assert.deepEqual(crossRevision.reusedIndexes, [0]);
  const currentCommands = buildCommandStates(planIdentity, {
    checkpoint: oldCheckpoint,
    resumeDecision: crossRevision,
    verificationIdentity: currentIdentity,
  });
  Object.assign(currentCommands[1], {
    status: "failed",
    exitCode: 7,
    startedAt: "2026-08-13T00:01:00.000Z",
    finishedAt: "2026-08-13T00:01:01.000Z",
    durationMs: 1000,
    verificationIdentityAfter: currentIdentity,
    evidenceValidatedForIdentity: currentIdentity,
  });
  const currentCheckpoint = {
    schemaVersion: RESUMABLE_VERIFICATION_SCHEMA_VERSION,
    kind: RESUMABLE_VERIFICATION_KIND,
    runnerId: planIdentity.runnerId,
    planIdentity,
    verificationIdentity: currentIdentity,
    finalVerificationIdentity: null,
    verdict: "failed",
    commands: currentCommands,
  };
  const secondResume = decideResume({
    checkpoint: currentCheckpoint,
    runnerId: "verify-core",
    planIdentity,
    verificationIdentity: currentIdentity,
    changedFilesReader: () => {
      throw new Error("second exact resume must not inspect a diff");
    },
  });
  assert.equal(secondResume.mode, "exact");
  assert.deepEqual(secondResume.reusedIndexes, [0]);
  assert.equal(secondResume.resumeIndex, 1);
  assert.deepEqual(currentCommands[0].verificationIdentityAfter, oldIdentity);
  assert.deepEqual(currentCommands[0].evidenceValidatedForIdentity, currentIdentity);

  const secondCommands = buildCommandStates(planIdentity, {
    checkpoint: currentCheckpoint,
    resumeDecision: secondResume,
    verificationIdentity: currentIdentity,
  });
  Object.assign(secondCommands[1], {
    status: "failed",
    exitCode: 7,
    startedAt: "2026-08-13T00:02:00.000Z",
    finishedAt: "2026-08-13T00:02:01.000Z",
    durationMs: 1000,
    verificationIdentityAfter: currentIdentity,
    evidenceValidatedForIdentity: currentIdentity,
  });
  const secondCheckpoint = {
    ...currentCheckpoint,
    commands: secondCommands,
  };
  const thirdResume = decideResume({
    checkpoint: secondCheckpoint,
    runnerId: "verify-core",
    planIdentity,
    verificationIdentity: currentIdentity,
    changedFilesReader: () => {
      throw new Error("third exact resume must not inspect a diff");
    },
  });
  assert.deepEqual(thirdResume.reusedIndexes, [0]);
  assert.equal(secondCommands[0].evidenceDisposition, "reused-after-sf-ats");
  assert.equal(secondCommands[0].lastReuseMode, "reused-exact");
  assert.equal(secondCommands[0].sourceVerificationSha, oldIdentity.verificationSha);
});

test("revision drift without path changes and non-contiguous evidence fail closed", () => {
  const planIdentity = buildPlanIdentity({
    runnerId: "verify-core",
    entries: [
      { group: "one", commandRef: "verify:alpha", command: "node alpha.mjs" },
      { group: "one", commandRef: "verify:beta", command: "node beta.mjs" },
    ],
  });
  const checkpoint = checkpointFor(planIdentity, cleanIdentity("sha-one", "tree-one"), [0]);
  const revisionOnly = decideResume({
    checkpoint,
    runnerId: "verify-core",
    planIdentity,
    verificationIdentity: cleanIdentity("sha-two", "tree-one"),
    changedFilesReader: () => [],
  });
  assert.equal(revisionOnly.resumeIndex, 0);
  assert.deepEqual(revisionOnly.reusedIndexes, []);
  assert.deepEqual(revisionOnly.reasonCodes, ["revision-drift-without-path-change"]);

  const invalid = checkpointFor(planIdentity, cleanIdentity("sha-one", "tree-one"), [1]);
  assert.throws(() => decideResume({
    checkpoint: invalid,
    runnerId: "verify-core",
    planIdentity,
    verificationIdentity: cleanIdentity("sha-one", "tree-one"),
    changedFilesReader: () => [],
  }), /non-contiguous passed command/);
});

test("resume rejects passed evidence with command or final identity drift", () => {
  const planIdentity = buildPlanIdentity({
    runnerId: "verify-core",
    entries: [
      { group: "one", commandRef: "verify:alpha", command: "node alpha.mjs" },
      { group: "one", commandRef: "verify:beta", command: "node beta.mjs" },
    ],
  });
  const identity = cleanIdentity("sha-one", "tree-one");
  const commandDrift = checkpointFor(planIdentity, identity, [0]);
  commandDrift.commands[0].verificationIdentityAfter = cleanIdentity("sha-one", "tree-drifted");
  assert.throws(() => decideResume({
    checkpoint: commandDrift,
    runnerId: "verify-core",
    planIdentity,
    verificationIdentity: identity,
    changedFilesReader: () => [],
  }), /drifted execution evidence/);

  const finalDrift = checkpointFor(planIdentity, identity, [0, 1]);
  finalDrift.verdict = "failed";
  finalDrift.finalVerificationIdentity = cleanIdentity("sha-one", "tree-drifted");
  assert.throws(() => decideResume({
    checkpoint: finalDrift,
    runnerId: "verify-core",
    planIdentity,
    verificationIdentity: identity,
    changedFilesReader: () => [],
  }), /no valid final pass identity/);
});

test("dirty and unmatched changed workspaces block resume before execution", () => {
  const planIdentity = buildPlanIdentity({
    runnerId: "verify-core",
    entries: [{ group: "one", commandRef: "verify:alpha", command: "node alpha.mjs" }],
  });
  const checkpoint = checkpointFor(planIdentity, cleanIdentity("sha-one", "tree-one"), [0]);
  const dirty = decideResume({
    checkpoint,
    runnerId: "verify-core",
    planIdentity,
    verificationIdentity: { ...cleanIdentity("sha-two", "tree-two"), workspaceClean: false },
    changedFilesReader: () => [],
  });
  assert.equal(dirty.blockReason, "workspace-dirty");

  const unmatched = decideResume({
    checkpoint,
    runnerId: "verify-core",
    planIdentity,
    verificationIdentity: cleanIdentity("sha-two", "tree-two"),
    changedFilesReader: () => ["unknown.file"],
    selector: () => ({ unmatchedChangedFiles: ["unknown.file"], matchedByFile: [] }),
  });
  assert.equal(unmatched.blockReason, "unmatched-changed-files");
  assert.deepEqual(unmatched.reusedIndexes, []);
});

test("adaptive command supersession removes covered TNO and Pages commands", () => {
  const commands = collapseSupersededCommands([
    "verify:scenario-contracts:strict",
    "verify:tno-coverage-ledger",
    "verify:tno-atlantropa-coverage",
    "verify:tno-polar-coverage",
    "test:node:scenario-chunk-contracts",
    "verify:tno-coverage-chain",
    "verify:dist-drift",
    "verify:pages-dist",
    "verify:pages-dist-and-drift",
    "verify:unrelated",
  ]);
  assert.deepEqual(commands, [
    "verify:tno-coverage-chain",
    "verify:pages-dist-and-drift",
    "verify:unrelated",
  ]);

  const plan = buildExecutionPlan(adaptiveReport({
    selected: [
      adaptiveContributor("verify:tno-coverage-ledger"),
      adaptiveContributor("verify:tno-coverage-chain"),
    ],
  }));
  assert.deepEqual(plan.commandsToRun, ["verify:tno-coverage-chain"]);
  assert.deepEqual(plan.supersededCommands, [{
    commandRef: "verify:tno-coverage-ledger",
    supersededBy: "verify:tno-coverage-chain",
  }]);
});

test("command supersession preserves current policy evidence beside historical exact phases", () => {
  assert.deepEqual(collapseSupersededCommands([
    "verify:p4:p4-2b",
    "verify:p4:state-writer-policy",
    "test:node:p4:state-writer-policy",
    "test:node:p4:state-writer-policy:quick",
  ]), [
    "verify:p4:p4-2b",
    "verify:p4:state-writer-policy",
  ]);
  assert.deepEqual(collapseSupersededCommands([
    "verify:p4:p4-4",
    "verify:p4:state-writer-policy",
    "test:node:p4:state-writer-policy",
  ]), ["verify:p4:p4-4"]);
});

const STRICT_COMMAND_CLOSURE_SUPERSESSION = Object.freeze({
  "verify:supervisor-contracts": Object.freeze([
    "test:node:supervisor-contracts",
    "test:node:supervisor-routing",
  ]),
  "verify:supervisor-plan": Object.freeze([
    "test:node:supervisor-plan",
  ]),
  "test:node:p4:p4-2a": Object.freeze([
    "test:node:scenario-apply-transaction-ownership",
    "test:node:scenario-lifecycle-runtime-behavior",
    "test:node:scenario-runtime-state-behavior",
  ]),
  "test:node:p4:p4-2b": Object.freeze([
    "test:node:scenario-chunk-contracts",
  ]),
  "test:node:p4:p4-3": Object.freeze([
    "test:node:renderer-render-phase-lifecycle",
    "test:node:zoom-interaction-lifecycle-owner",
  ]),
});

function resolveCommandLeafProcesses(commandRef, packageScripts, seen = new Set()) {
  if (seen.has(commandRef)) return [];
  const command = packageScripts[commandRef] || commandRef;
  const nextSeen = new Set(seen).add(commandRef);
  return String(command)
    .split(/\s*&&\s*/)
    .flatMap((part) => {
      const npmRun = part.trim().match(/^npm run(?: -s)? ([A-Za-z0-9:_-]+)(.*)$/);
      return npmRun && packageScripts[npmRun[1]] && !nextSeen.has(npmRun[1])
        ? resolveCommandLeafProcesses(
          `${packageScripts[npmRun[1]]}${npmRun[2]}`,
          packageScripts,
          new Set(nextSeen).add(npmRun[1]),
        )
        : [part.trim()];
    });
}

function nodeTestFileClosure(commandRef, packageScripts) {
  return [...new Set(
    resolveCommandLeafProcesses(commandRef, packageScripts)
      .flatMap((command) => (
        [...command.matchAll(/tests\/[A-Za-z0-9_./-]+\.(?:test\.mjs|node\.test\.mjs)/g)]
          .map((match) => match[0])
      )),
  )].sort();
}

test("strict command supersession declares every approved aggregate mapping", () => {
  for (const [superseder, coveredCommands] of Object.entries(
    STRICT_COMMAND_CLOSURE_SUPERSESSION,
  )) {
    assert.deepEqual(
      collapseSupersededCommands([superseder, ...coveredCommands]),
      [superseder],
      superseder,
    );
    for (const coveredCommand of coveredCommands) {
      assert.deepEqual(
        collapseSupersededCommands([coveredCommand]),
        [coveredCommand],
        `${coveredCommand} remains reachable by itself`,
      );
    }
  }
});

registerCommandSupersessionContracts();

test("strict command supersession preserves the complete Node test-file closure", () => {
  const packageScripts = JSON.parse(
    fs.readFileSync("package.json", "utf8"),
  ).scripts;
  for (const [superseder, coveredCommands] of Object.entries(
    STRICT_COMMAND_CLOSURE_SUPERSESSION,
  )) {
    const supersederFiles = new Set(
      nodeTestFileClosure(superseder, packageScripts),
    );
    for (const coveredCommand of coveredCommands) {
      const coveredFiles = nodeTestFileClosure(coveredCommand, packageScripts);
      assert.ok(coveredFiles.length > 0, coveredCommand);
      assert.deepEqual(
        coveredFiles.filter((testFile) => !supersederFiles.has(testFile)),
        [],
        `${superseder} must cover ${coveredCommand}`,
      );
    }
  }
});

test("Pages checked gate keeps generation compatibility without re-owning sample contracts", () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  const generation = scripts["verify:pages-dist"];
  const checked = scripts["verify:pages-dist-and-drift"];
  assert.equal((generation.match(/tools\/build_pages_dist\.py/g) || []).length, 1);
  assert.equal((checked.match(/tools\/build_pages_dist\.py/g) || []).length, 1);
  for (const contract of [
    "tests.test_pages_dist_startup_shell",
    "test:py:landing-map-asset-contracts",
    "test:node:landing-showcase-view",
  ]) {
    assert.match(generation, new RegExp(contract.replaceAll(":", "\\:")));
    assert.match(checked, new RegExp(contract.replaceAll(":", "\\:")));
  }
  assert.doesNotMatch(generation, /test:node:sample-project-contracts/);
  assert.doesNotMatch(checked, /test:node:sample-project-contracts/);
  assert.match(scripts["test:node:p4:p4-1"], /tests\/sample_project_contracts\.test\.mjs/);
  assert.match(scripts["test:node:sample-project-contracts"], /tests\/sample_project_contracts\.test\.mjs/);
  assert.equal(generation.includes("git diff --exit-code"), false);
  assert.equal(checked.includes("git diff --exit-code"), true);
});

test("adaptive command supersession keeps the exact P4.4 gate as the complete heavy lane", () => {
  const commands = collapseSupersededCommands([
    "test:node:p4:p4-4",
    "test:python:p4:p4-4-boundary",
    "test:node:p4:state-writer-policy:quick",
    "test:node:p4:state-writer-policy",
    "verify:p4:state-writer-policy",
    "verify:p4:p4-4",
  ]);

  assert.deepEqual(commands, ["verify:p4:p4-4"]);
});

test("adaptive child-safe execution substitutes quick coverage for the full P4 policy lane", () => {
  const report = buildRecommendation(["tools/run_p4_state_writer_policy_tests.mjs"]);
  const childSafePlan = buildExecutionPlan(report);
  assert.ok(childSafePlan.commandsToRun.includes("test:node:p4:state-writer-policy:quick"));
  assert.equal(childSafePlan.commandsToRun.includes("test:node:p4:state-writer-policy"), false);
  assert.ok(childSafePlan.mainThreadCommands.includes("test:node:p4:state-writer-policy"));
  assert.ok(childSafePlan.blockedMainThreadCommands.includes("verify:p4:state-writer-policy"));

  const mainThreadPlan = buildExecutionPlan(report, { includeMainThread: true });
  assert.equal(mainThreadPlan.commandsToRun.includes("test:node:p4:state-writer-policy"), false);
  assert.equal(mainThreadPlan.commandsToRun.includes("test:node:p4:state-writer-policy:quick"), false);
  assert.ok(mainThreadPlan.commandsToRun.some((commandRef) => (
    commandRef === "verify:p4:state-writer-policy" || commandRef === "verify:p4:p4-4"
  )));
});

test("verification tiers keep commit selection child-safe and reserve broader gates", () => {
  const scripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  assert.deepEqual(VERIFICATION_TIER_ENTRYPOINTS, [
    {
      tier: 0,
      id: "commit",
      commandRef: "verify:commit",
      executionScope: "child-safe",
      commitProjection: {
        controlPlaneRecordIds: ["infra:local-verification-closure", "local:owner:commit-runner"],
        controlPlaneCommandRefs: [
          "test:node:verification-metadata",
          "test:node:verification-script-portfolio",
          "test:node:verify-core-runner",
        ],
      },
    },
    { tier: 1, id: "impact", commandRef: "verify:impact", executionScope: "child-safe" },
    { tier: 2, id: "pr", commandRef: "verify:pr", executionScope: "pr" },
    { tier: 3, id: "main", commandRef: "verify:core", executionScope: "main" },
    { tier: 4, id: "nightly", commandRef: "verify:nightly", executionScope: "nightly" },
    { tier: 5, id: "release", commandRef: "verify:release", executionScope: "release" },
  ]);
  assert.equal(scripts["verify:commit"], "node tools/run_commit_verification.mjs");
  assert.match(scripts["verify:edit"], /run_adaptive_tests\.mjs --entrypoint edit --execute --defer-main-thread/);
  assert.equal(
    scripts["verify:impact"],
    "node tools/run_adaptive_tests.mjs --entrypoint impact --execute --defer-main-thread",
  );
  assert.match(scripts["verify:pr"], /verify:script-portfolio/);
  assert.match(scripts["verify:pr"], /select_verification_targets\.mjs --check/);
  assert.match(scripts["verify:pr"], /tests\.test_e2e_structural_tooling/);
  assert.match(scripts["verify:pr"], /verify:scenario-contracts:strict/);
  assert.match(scripts["verify:pr"], /run_adaptive_tests\.mjs --execute --defer-main-thread --history-base origin\/main/);
  assert.equal(
    scripts["verify:demo"],
    "node node_modules/@playwright/test/cli.js test tests/e2e/sample_guide_deeplink.spec.js --grep @golden-demo --workers=1 --retries=0",
  );
  assert.match(scripts["verify:nightly"], /^npm run verify:core\b/);
  assert.match(scripts["verify:nightly"], /unittest discover/);
  assert.match(scripts["verify:nightly"], /npm run test:e2e:sample-guide/);
  assert.match(scripts["verify:release"], /^npm run verify:core:main-thread\b/);
  assert.match(scripts["verify:release"], /npm run verify:demo/);
  assert.match(scripts["verify:release"], /npm run test:e2e:pages-public-release-gate/);

  const nightlyPlan = buildCoreVerificationPlan({ packageScripts: scripts, includeReserved: true });
  const releasePlan = buildCoreVerificationPlan({ packageScripts: scripts, includeMainThread: true });
  for (const plan of [nightlyPlan, releasePlan]) {
    assert.ok(plan.commandsToRun.some((entry) => entry.commandRef === "verify:p4:state-writer-policy"));
    assert.ok(plan.commandsToRun.some((entry) => entry.commandRef === "verify:pages-dist-and-drift"));
  }
});

test("adaptive workspace discovery includes all WIP and both rename paths in one Git read", () => {
  const calls = [];
  const files = discoverChangedFiles({
    runner: (bin, args) => {
      calls.push([bin, args]);
      return { status: 0, stdout: [
        " M js/unstaged.js", "M  js/staged.js", "?? tests/new file.test.mjs",
        " D js/deleted.js", "R  js/new-name.js", "js/old-name.js",
        "MM js/staged.js", "",
      ].join("\0") };
    },
  });
  assert.deepEqual(files, [
    "js/deleted.js", "js/new-name.js", "js/old-name.js", "js/staged.js",
    "js/unstaged.js", "tests/new file.test.mjs",
  ]);
  assert.deepEqual(calls, [["git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"]]]);
  assert.throws(() => discoverChangedFiles({ runner: () => ({ status: 1, stdout: " M js/partial.js\0" }) }),
    /adaptive-workspace-discovery-failed/);
  assert.throws(() => discoverChangedFiles({ runner: () => ({ status: 0, stdout: "R  js/new-name.js\0" }) }),
    /porcelain-previous-path-missing/);
});

test("adaptive history discovery requires its exact base and rejects last-commit fallback", () => {
  assert.deepEqual(parseAdaptiveArgs(["--execute", "--history-base", "origin/main"]), {
    changedFiles: [],
    changedFilesProvided: false,
    inputErrors: [],
    dryRun: false,
    includeBranchHistory: true,
    historyBase: "origin/main",
    entrypoint: "",
    includeMainThread: false,
    deferMainThread: false,
    selectionJson: "",
    verificationCatalogFixture: "",
    verificationCatalogFixtureSha256: "",
    jsonOut: path.join(process.cwd(), ".runtime", "reports", "generated", "test-adaptive-selection.json"),
    mdOut: path.join(process.cwd(), ".runtime", "reports", "generated", "test-adaptive-selection.md"),
    profileOut: path.join(process.cwd(), ".runtime", "reports", "generated", "test-adaptive-profile.json"),
  });
  assert.throws(() => parseAdaptiveArgs(["--history-base", ""]), /requires a non-empty Git revision/);

  const calls = [];
  const rejectedBroadHistory = (args) => {
    const joined = args.join(" ");
    calls.push(joined);
    if (joined.includes("origin/main...HEAD")) return { status: 9, stdout: "" };
    if (joined.includes("HEAD^ HEAD")) return { status: 0, stdout: "package.json\0" };
    return { status: 0, stdout: "" };
  };
  assert.throws(
    () => discoverChangedFiles({ runner: (_bin, args) => rejectedBroadHistory(args), includeBranchHistory: true }),
    /adaptive-history-discovery-failed:all-fallbacks/,
  );
  assert.equal(calls.some((entry) => entry.includes("HEAD^ HEAD")), false);
  assert.throws(
    () => discoverChangedFiles({
      runner: (_bin, args) => args.join(" ").includes("origin/main HEAD")
        ? { status: 7, stdout: "" }
        : { status: 0, stdout: "" },
      historyBase: "origin/main",
    }),
    /adaptive-history-discovery-failed:origin\/main/,
  );
  assert.doesNotThrow(() => assertAdaptiveExecutionInput([], { dryRun: true }));
  assert.throws(
    () => assertAdaptiveExecutionInput([], { dryRun: false }),
    /adaptive-execution-empty-changed-files/,
  );
  const ingressRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-changed-file-ingress-"));
  const whitespaceList = path.join(ingressRoot, "whitespace.txt");
  fs.writeFileSync(whitespaceList, "  \r\n\t\r\n", "utf8");
  const ingressArgv = [
    ["--execute"],
    ["--execute", "--changed-file"],
    ["--execute", "--changed-file", ""],
    ["--execute", "--changed-file", "   "],
    ["--execute", "--changed-file", ","],
    ["--execute", "--changed-files", ","],
    ["--execute", "--changed-files-list", whitespaceList],
  ];
  for (const argv of ingressArgv) {
    const parsed = parseAdaptiveArgs(argv);
    const changedFiles = normalizeChangedFiles(parsed.changedFiles);
    assert.throws(
      () => assertAdaptiveExecutionInput(changedFiles, { dryRun: parsed.dryRun }),
      /adaptive-execution-empty-changed-files/,
      JSON.stringify(argv),
    );
  }
  assert.deepEqual(
    normalizeChangedFiles(["tests/a.test.mjs", "./tests/a.test.mjs", " tests/a.test.mjs "]),
    ["tests/a.test.mjs"],
  );
});

test("impact entrypoint binds a clean exact base and rejects ambiguous authority", () => {
  const parsed = parseAdaptiveArgs([
    "--entrypoint", "impact", "--execute", "--defer-main-thread", "--base", "refs/heads/main",
  ]);
  assert.equal(parsed.historyBase, "refs/heads/main");
  assert.equal(parsed.entrypoint, "impact");

  const calls = [];
  const runner = (_bin, args) => {
    calls.push(args);
    const command = args.join(" ");
    if (command.includes("status --porcelain=v1")) return { status: 0, stdout: "" };
    if (command.includes("rev-parse --verify --end-of-options refs/heads/main^{commit}")) {
      return { status: 0, stdout: "1111111111111111111111111111111111111111\n" };
    }
    if (command.includes("rev-parse --verify --end-of-options HEAD^{commit}")) {
      return { status: 0, stdout: "2222222222222222222222222222222222222222\n" };
    }
    if (command.includes("merge-base --is-ancestor")) return { status: 0, stdout: "" };
    return { status: 9, stdout: "" };
  };
  assert.deepEqual(assertAdaptiveEntrypointAuthority(parsed, { runner }), {
    historyBase: "1111111111111111111111111111111111111111",
    head: "2222222222222222222222222222222222222222",
  });
  assert.ok(calls.some((args) => args.includes("--end-of-options")));
  const discoveryCalls = [];
  discoverChangedFiles({
    runner: (_bin, args) => {
      discoveryCalls.push(args);
      return { status: 0, stdout: args.includes("status") ? " M package.json\0" : "package.json\0" };
    },
    historyBase: "1111111111111111111111111111111111111111",
    historyHead: "2222222222222222222222222222222222222222",
  });
  assert.ok(discoveryCalls.some((args) => (
    args.includes("1111111111111111111111111111111111111111")
    && args.includes("2222222222222222222222222222222222222222")
  )));

  const dirtyRunner = (_bin, args) => {
    const command = args.join(" ");
    if (command.includes("refs/heads/main^{commit}")) {
      return { status: 0, stdout: "1111111111111111111111111111111111111111\n" };
    }
    if (command.includes("HEAD^{commit}")) {
      return { status: 0, stdout: "2222222222222222222222222222222222222222\n" };
    }
    if (args.includes("status")) return { status: 0, stdout: "?? local.txt\0" };
    return { status: 0, stdout: "" };
  };
  assert.throws(
    () => assertAdaptiveEntrypointAuthority(parsed, { runner: dirtyRunner }),
    /adaptive-impact-dirty-worktree/,
  );
  assert.throws(
    () => assertAdaptiveEntrypointAuthority(parseAdaptiveArgs([
      "--entrypoint", "impact", "--execute", "--defer-main-thread",
    ]), { runner }),
    /adaptive-impact-base-required/,
  );
  assert.throws(
    () => assertAdaptiveEntrypointAuthority(parseAdaptiveArgs([
      "--entrypoint", "impact", "--execute", "--defer-main-thread", "--base", "missing",
    ]), { runner: () => ({ status: 1, stdout: "" }) }),
    /adaptive-impact-authority-unresolved:missing/,
  );
  assert.throws(
    () => assertAdaptiveEntrypointAuthority(parseAdaptiveArgs([
      "--entrypoint", "impact", "--execute", "--defer-main-thread", "--base", "main", "--changed-file", "package.json",
    ]), { runner }),
    /adaptive-impact-explicit-changed-files-forbidden/,
  );
  assert.throws(
    () => assertAdaptiveEntrypointAuthority(parseAdaptiveArgs([
      "--entrypoint", "impact", "--execute", "--include-main-thread", "--base", "main",
    ]), { runner }),
    /adaptive-impact-main-thread-forbidden/,
  );
});

test("local entrypoints project the canonical selector to child-safe work only", () => {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  const selectorRoutes = buildRouteIndex();
  const binding = prepareRepositoryVerificationCatalogBinding({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const report = buildAdaptiveEntrypointRecommendation(["package.json"], selectorRoutes, {
    entrypoint: "impact",
    routeAuthority: binding.preparedCatalog.authority,
  });
  const projected = constrainAdaptiveEntrypointSelection(report, "impact", {
    preparedCatalog: binding.preparedCatalog,
  });
  assert.ok(projected.recommendedCommands.length > 0);
  assert.ok(projected.recommendedCommands.every((entry) => (
    entry.executionOwners.length === 1 && entry.executionOwners[0] === "child-safe"
  )));
  assert.deepEqual(projected.mainThreadSerialVerification, []);
  assert.deepEqual(projected.ciOnlyVerification, []);
  assert.deepEqual(projected.blockedVerification, []);
  assert.ok(projected.rawCanonicalRoots.length > projected.recommendedCommands.length);
  assert.ok(projected.deferredByTier.length > 0);
  assert.ok(projected.matchedByFile[0].matchedRouteIds.includes("infra:local-verification-closure"));
  assert.deepEqual(projected.recommendedCommands.map((entry) => entry.commandRef), [
    "test:node:scenario-chunk-contracts:quick",
    "verify:local-infra",
  ]);
  assert.equal(projected.localEntrypointPolicy.source, "canonical-verification-catalog");
  assert.equal(projected.localLeafEquivalence.status, "equivalent");
  for (const forbidden of [
    "perf:gate",
    "verify:pages-dist-and-drift",
    "verify:p4:p4-3",
    "test:node:p4:p4-3",
    "test:node:p4:state-writer-policy",
  ]) {
    assert.equal(projected.recommendedCommands.some((entry) => entry.commandRef === forbidden), false);
  }

});

test("local projection preserves the verification profile leaf within the impact budget", () => {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  const selectorRoutes = buildRouteIndex();
  const binding = prepareRepositoryVerificationCatalogBinding({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const report = buildAdaptiveEntrypointRecommendation(
    ["tools/verification/verification_profile.mjs"],
    selectorRoutes,
    { entrypoint: "impact", routeAuthority: binding.preparedCatalog.authority },
  );
  const projected = bindSelectorPrCost(binding.bindSelectionReport(
    constrainAdaptiveEntrypointSelection(report, "impact", {
      preparedCatalog: binding.preparedCatalog,
    }),
  ));
  assert.ok(projected.rawLocalEligibleRoots.some((entry) => (
    entry.commandRef === "test:node:verification-profile"
  )));
  assert.deepEqual(projected.recommendedCommands.map((entry) => entry.commandRef), ["verify:local-infra"]);
  const plan = applyLocalEntrypointExecutionBudget(buildExecutionPlan(projected, {
    packageScripts,
    preparedCatalog: binding.preparedCatalog,
  }), "impact", { preparedCatalog: binding.preparedCatalog });
  assert.ok(plan.selectedLeaves.some((entry) => (
    entry.leafId === "node-test:tests/verification_profile_behavior.test.mjs"
  )));
  assert.ok(plan.selectedLeaves.some((entry) => (
    entry.leafId === "node-test:tests/verification_metadata_behavior.test.mjs"
  )));
  assert.deepEqual(plan.routeGaps, []);
  assert.equal(plan.selectedLeaves.filter((entry) => (
    entry.leafId === "node-test:tests/verify_commit_runner_behavior.test.mjs"
  )).length, 1);
  assert.equal(plan.localEntrypointBudget.actual.estimatedRuntimeSeconds, 70);
  assert.equal(plan.executionCommands.length, 2);
  assert.equal(adaptivePlanningExitCode(projected, plan), 0);
});

test("local infra diffs resolve to one canonical fast closure within expanded Tier 1 budgets", () => {
  const changedFiles = [
    ".github/workflows/nightly-verification.yml",
    ".github/workflows/release-verification.yml",
    "package.json",
    "tests/test_e2e_structural_tooling.py",
    "tests/verification_script_portfolio_behavior.test.mjs",
    "tests/verify_core_runner_behavior.test.mjs",
    "tools/ai_test_supervisor/domain_registry.json",
    "tools/run_adaptive_tests.mjs",
    "tools/select_verification_targets.mjs",
    "tools/verification/script_portfolio.mjs",
    "tools/verification/verification_catalog_source.mjs",
    "tools/verification/verification_domains.mjs",
  ];
  const packageScripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  const selectorRoutes = buildRouteIndex();
  const binding = prepareRepositoryVerificationCatalogBinding({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const recommendation = buildAdaptiveEntrypointRecommendation(changedFiles, selectorRoutes, {
    entrypoint: "impact",
    routeAuthority: binding.preparedCatalog.authority,
  });
  const projected = bindSelectorPrCost(binding.bindSelectionReport(
    constrainAdaptiveEntrypointSelection(recommendation, "impact", {
      preparedCatalog: binding.preparedCatalog,
    }),
  ));
  assert.deepEqual(
    projected.recommendedCommands.map((entry) => entry.commandRef),
    ["test:node:scenario-chunk-contracts:quick", "verify:local-infra"],
  );
  for (const entry of projected.matchedByFile) {
    assert.deepEqual(
      entry.recommendedCommands.map((command) => command.commandRef),
      entry.changedFile === "package.json"
        ? ["test:node:scenario-chunk-contracts:quick", "verify:local-infra"]
        : ["verify:local-infra"],
    );
  }

  const plan = applyLocalEntrypointExecutionBudget(
    buildExecutionPlan(projected, {
      packageScripts,
      preparedCatalog: binding.preparedCatalog,
    }),
    "impact",
    { preparedCatalog: binding.preparedCatalog },
  );
  assert.deepEqual(plan.routeGaps, []);
  assert.equal(projected.deferredByTier.some((entry) => (
    entry.minimumDepth === "local" || entry.reason === "local-route-source-mismatch"
  )), false);
  assert.ok(plan.selectedLeaves.some((entry) => (
    entry.leafId === "node-test:tests/verification_metadata_behavior.test.mjs"
  )));
  assert.ok(plan.selectedLeaves.some((entry) => (
    entry.leafId === "node-test:tests/verification_profile_behavior.test.mjs"
  )));
  assert.ok(plan.selectedLeaves.some((entry) => (
    entry.leafId === "node-test:tests/scenario_chunk_contracts.quick.test.mjs"
  )));
  assert.equal(plan.localEntrypointBudget.entrypoint, "impact");
  assert.deepEqual(plan.localEntrypointBudget.limits, {
    maxCommands: 4,
    maxLeaves: 12,
    maxProcessGroups: 4,
    maxEstimatedRuntimeSeconds: 120,
    maxEstimatedCostUnits: 4,
  });
  assert.deepEqual(plan.localEntrypointBudget.actual, {
    commandCount: 2,
    leafCount: 7,
    processGroupCount: 3,
    estimatedRuntimeSeconds: 95,
    estimatedCostUnits: 3.25,
  });
  assert.equal(plan.selectedLeaves.filter((entry) => (
    entry.leafId === "node-test:tests/verify_commit_runner_behavior.test.mjs"
  )).length, 1);
  assert.ok(plan.localEntrypointBudget.actual.estimatedRuntimeSeconds >= 90);
  assert.ok(plan.localEntrypointBudget.actual.estimatedRuntimeSeconds <= 120);
});

test("renamed heavy commands remain deferred through canonical eligibility", () => {
  const commandRef = "renamed-state-suite";
  const preparedCatalog = prepareVerificationCatalog({
    packageScripts: { [commandRef]: "node --test tests/renamed_state_suite.test.mjs" },
    selectorRoutes: [{
      id: "fixture:renamed-heavy",
      commandRef,
      sourceRef: "tests/renamed_state_suite.test.mjs",
      domain: "state-ownership",
      ownerHint: "state-ownership",
      layer: "heavy",
      cost: "heavy",
      executionOwner: "main-thread",
      resourceLocks: [".runtime-output"],
      ciProfile: "full",
    }],
    selectorCommandRefs: [commandRef],
    platform: process.platform,
    sourceMode: "fixture",
  });
  const renamed = preparedCatalog.authority[0];
  assert.deepEqual(renamed.entrypointPolicy.eligibleEntrypoints, ["nightly"]);
  assert.equal(renamed.entrypointPolicy.minimumDepth, "nightly");
  assert.equal(renamed.entrypointPolicy.eligibleEntrypoints.includes("impact"), false);
  const runnerSource = fs.readFileSync(path.join(process.cwd(), "tools", "run_adaptive_tests.mjs"), "utf8");
  assert.equal(runnerSource.includes("LOCAL_ENTRYPOINT_FORBIDDEN_ROOTS"), false);
  assert.equal(runnerSource.includes("/^verify:p4:/"), false);
});

test("local projection retains metadata inventory and defers the standalone selector", () => {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  const selectorRoutes = buildRouteIndex();
  const binding = prepareRepositoryVerificationCatalogBinding({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const raw = buildAdaptiveEntrypointRecommendation(
    ["tools/run_adaptive_tests.mjs"],
    selectorRoutes,
    { entrypoint: "impact", routeAuthority: binding.preparedCatalog.authority },
  );
  const projected = constrainAdaptiveEntrypointSelection(raw, "impact", {
    preparedCatalog: binding.preparedCatalog,
  });

  const rawSelector = projected.rawCanonicalRoots.find((entry) => (
    entry.commandRef === "node tools/select_verification_targets.mjs --check"
  ));
  assert.equal(rawSelector.canonicalIdentity.commandRef, rawSelector.commandRef);
  assert.equal(rawSelector.canonicalIdentity.catalogIdentity.digest, binding.preparedCatalog.catalogDigest);
  assert.deepEqual(projected.recommendedCommands.map((entry) => entry.commandRef), ["verify:local-infra"]);
  assert.equal(projected.rawLocalEligibleRoots.some((entry) => entry.commandRef === rawSelector.commandRef), false);
  assert.equal(rawSelector.entrypointPolicy.minimumDepth, "pr");
  assert.ok(projected.deferredByTier.some((entry) => entry.commandRef === rawSelector.commandRef));
  assert.equal(projected.localLeafEquivalence.status, "equivalent");
  assert.deepEqual(projected.localLeafEquivalence.missingLeaves, []);
  assert.ok(projected.localLeafEquivalence.projectedLocalLeaves.includes(
    "node-test:tests/verification_metadata_behavior.test.mjs",
  ));
  assert.equal(projected.localLeafEquivalence.projectedLocalLeaves.includes(
    "node-script:tools/select_verification_targets.mjs",
  ), false);
});

for (const includeRenderer of [false, true]) {
test(`local projection preserves exact test routes with renderer scope ${includeRenderer}`, () => {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  const selectorRoutes = buildRouteIndex();
  const binding = prepareRepositoryVerificationCatalogBinding({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const changedFiles = [
    ...(includeRenderer ? ["js/core/map_renderer.js"] : []),
    "js/core/render_change_set.js",
    "js/core/renderer/render_snapshot.js",
    "tests/render_change_set_behavior.test.mjs",
    "tests/render_snapshot_behavior.test.mjs",
    "tests/test_map_renderer_render_snapshot_boundary_contract.py",
  ];
  const raw = buildAdaptiveEntrypointRecommendation(changedFiles, selectorRoutes, {
    entrypoint: "edit",
    routeAuthority: binding.preparedCatalog.authority,
  });
  const projected = bindSelectorPrCost(bindSelectionToPreparedCatalog(constrainAdaptiveEntrypointSelection(raw, "edit", {
    preparedCatalog: binding.preparedCatalog,
  }), binding.preparedCatalog));
  const plan = applyLocalEntrypointExecutionBudget(buildExecutionPlan(projected, {
    packageScripts,
    preparedCatalog: binding.preparedCatalog,
  }), "edit", { preparedCatalog: binding.preparedCatalog });
  const expectedCommands = [
    ...(includeRenderer ? [
      "node --test tests/country_source_border_meshes_behavior.test.mjs",
      "node --test tests/exact_composite_reuse_behavior.test.mjs",
      "node --test tests/history_feature_color_refresh_behavior.test.mjs",
      "node --test tests/legend_color_revision_behavior.test.mjs",
      "node --test tests/physical_contour_visible_set_owner_behavior.test.mjs",
      "node --test tests/render_pass_signature_policy_behavior.test.mjs",
    ] : []),
    "node --test tests/render_snapshot_behavior.test.mjs tests/render_change_set_behavior.test.mjs",
    "python -m unittest tests.test_map_renderer_render_snapshot_boundary_contract -q",
    ...(includeRenderer ? ["test:node:startup-lifecycle"] : []),
  ];

  assert.deepEqual(projected.recommendedCommands.map((entry) => entry.commandRef), expectedCommands);
  assert.deepEqual(projected.localEntrypointRouteGaps, []);
  assert.equal(projected.localLeafEquivalence.status, "equivalent");
  // The broader renderer scope must retain its added obligations and report
  // the edit budget honestly; exact test routing must not drop those leaves.
  assert.deepEqual(plan.routeGaps.map((gap) => gap.code), includeRenderer ? [
    "adaptive-edit-command-budget-exceeded",
    "adaptive-edit-leaf-budget-exceeded",
    "adaptive-edit-process-group-budget-exceeded",
    "adaptive-edit-runtime-budget-exceeded",
    "adaptive-edit-cost-budget-exceeded",
  ] : []);
  assert.deepEqual(plan.selectedLeaves.map((entry) => entry.leafId).sort(), [
    ...(includeRenderer ? ["node-test:tests/country_source_border_meshes_behavior.test.mjs"] : []),
    ...(includeRenderer ? ["node-test:tests/exact_composite_reuse_behavior.test.mjs"] : []),
    ...(includeRenderer ? ["node-test:tests/history_feature_color_refresh_behavior.test.mjs"] : []),
    ...(includeRenderer ? ["node-test:tests/legend_color_revision_behavior.test.mjs"] : []),
    ...(includeRenderer ? ["node-test:tests/physical_contour_visible_set_owner_behavior.test.mjs"] : []),
    "node-test:tests/render_change_set_behavior.test.mjs",
    ...(includeRenderer ? ["node-test:tests/render_pass_signature_policy_behavior.test.mjs"] : []),
    "node-test:tests/render_snapshot_behavior.test.mjs",
    ...(includeRenderer ? [
      "node-test:tests/startup_data_pipeline_lifecycle_behavior.test.mjs",
      "node-test:tests/startup_interaction_lifecycle_behavior.test.mjs",
      "node-test:tests/startup_ready_handoff_behavior.test.mjs",
    ] : []),
    "python-unittest:tests.test_map_renderer_render_snapshot_boundary_contract",
  ]);
  assert.equal(plan.executionCommands.length, includeRenderer ? 0 : 2);
  assert.equal(adaptivePlanningExitCode(projected, plan), includeRenderer ? 2 : 0);
  for (const testFile of changedFiles.filter((file) => file.startsWith("tests/"))) {
    const match = projected.matchedByFile.find((entry) => entry.changedFile === testFile);
    assert.equal(match.matchedRouteIds.includes("infra:verification-selector"), false);
  }
});
}

test("local projection selects the Stage C startup support sentinels without promoting heavy geo", () => {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  const selectorRoutes = buildRouteIndex();
  const binding = prepareRepositoryVerificationCatalogBinding({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const changedFiles = [
    "tests/test_tno_bundle_builder.py",
    "tools/patch_tno_1962_bundle.py",
  ];
  const methods = [
    "tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_build_startup_support_stage_admits_and_records_content_addressed_identity",
    "tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_startup_support_stage_restores_matching_content_addressed_artifact",
    "tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_startup_support_rollback_failure_preserves_backup_and_raises_fatal_error",
  ];
  const expectedCommand = ["python", "-m", "unittest", ...methods, "-q"].join(" ");
  const raw = buildAdaptiveEntrypointRecommendation(changedFiles, selectorRoutes, {
    entrypoint: "edit",
    routeAuthority: binding.preparedCatalog.authority,
  });
  const projected = bindSelectorPrCost(bindSelectionToPreparedCatalog(constrainAdaptiveEntrypointSelection(raw, "edit", {
    preparedCatalog: binding.preparedCatalog,
  }), binding.preparedCatalog));
  const plan = applyLocalEntrypointExecutionBudget(buildExecutionPlan(projected, {
    packageScripts,
    preparedCatalog: binding.preparedCatalog,
  }), "edit", { preparedCatalog: binding.preparedCatalog });

  assert.deepEqual(projected.recommendedCommands.map((entry) => entry.commandRef), [expectedCommand]);
  assert.deepEqual(projected.localEntrypointRouteGaps, []);
  assert.equal(projected.localLeafEquivalence.status, "equivalent");
  assert.ok(projected.deferredByTier.some((entry) => (
    entry.commandRef === "python -m unittest tests.test_tno_bundle_builder -q"
      && entry.minimumDepth === "nightly"
  )));
  for (const entry of projected.matchedByFile) {
    assert.ok(entry.matchedRouteIds.includes("direct:tno-startup-support-output-identity"));
  }
  assert.deepEqual(plan.routeGaps, []);
  assert.deepEqual(
    plan.selectedLeaves.map((entry) => entry.leafId).sort(),
    methods.map((method) => `python-unittest:${process.platform === "win32" ? method.toLowerCase() : method}`).sort(),
  );
  assert.equal(plan.executionCommands.length, 1);
  assert.equal(adaptivePlanningExitCode(projected, plan), 0);
});

test("local projection keeps the combined Stage C change set inside the edit budget", () => {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  const selectorRoutes = buildRouteIndex();
  const binding = prepareRepositoryVerificationCatalogBinding({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const changedFiles = [
    "map_builder/content_addressed_artifact_cache.py",
    "map_builder/scenario_build_session.py",
    "tools/patch_tno_1962_bundle.py",
    "tests/test_content_addressed_artifact_cache.py",
    "tests/test_scenario_build_session.py",
    "tests/test_tno_bundle_builder.py",
    "js/core/transport_capability_registry.js",
    "tests/transport_capability_maturity_projection_behavior.test.mjs",
  ];
  const raw = buildAdaptiveEntrypointRecommendation(changedFiles, selectorRoutes, {
    entrypoint: "edit",
    routeAuthority: binding.preparedCatalog.authority,
  });
  const projected = bindSelectorPrCost(bindSelectionToPreparedCatalog(constrainAdaptiveEntrypointSelection(raw, "edit", {
    preparedCatalog: binding.preparedCatalog,
  }), binding.preparedCatalog));
  const plan = applyLocalEntrypointExecutionBudget(buildExecutionPlan(projected, {
    packageScripts,
    preparedCatalog: binding.preparedCatalog,
  }), "edit", { preparedCatalog: binding.preparedCatalog });

  assert.deepEqual(projected.unmatchedChangedFiles, []);
  assert.deepEqual(projected.localEntrypointRouteGaps, []);
  assert.equal(projected.localLeafEquivalence.status, "equivalent");
  assert.deepEqual(projected.recommendedCommands.map((entry) => entry.commandRef).sort(), [
    "node --test tests/transport_capability_maturity_projection_behavior.test.mjs",
    "python -m unittest tests.test_content_addressed_artifact_cache tests.test_scenario_build_session -q",
    "python -m unittest tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_build_startup_support_stage_admits_and_records_content_addressed_identity tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_startup_support_stage_restores_matching_content_addressed_artifact tests.test_tno_bundle_builder.TnoBundleBuilderTest.test_startup_support_rollback_failure_preserves_backup_and_raises_fatal_error -q",
  ].sort());
  assert.deepEqual(plan.routeGaps, []);
  assert.equal(plan.selectedLeaves.length, 6);
  assert.equal(plan.executionCommands.length, 3);
  assert.equal(adaptivePlanningExitCode(projected, plan), 0);
});

test("local-eligible source mismatch creates a route gap and blocks execution", () => {
  const commandRef = "test:node:verification-profile";
  const contributor = adaptiveContributor(commandRef, {
    sourceRefs: ["tools/verification/verification_profile.mjs"],
    routeIds: ["route:local-source-mismatch"],
    safetyContributorRouteIds: ["route:local-source-mismatch"],
  });
  const report = {
    ...adaptiveReport({ selected: [contributor] }),
    changedFiles: ["package.json"],
    matchedByFile: [{
      changedFile: "package.json",
      matchedRouteIds: ["route:local-source-mismatch"],
      recommendedCommands: [structuredClone(contributor)],
    }],
  };
  const preparedCatalog = prepareVerificationCatalog({
    packageScripts: {
      [commandRef]: "node --test tests/verification_profile_behavior.test.mjs",
    },
    selectorRoutes: [{
      ...contributor,
      id: "route:local-source-mismatch",
      authoritySource: "selector-route",
    }],
    selectorCommandRefs: [commandRef],
    platform: process.platform,
    sourceMode: "fixture",
  });
  const projected = constrainAdaptiveEntrypointSelection(report, "impact", { preparedCatalog });
  assert.ok(projected.localEntrypointRouteGaps.some((gap) => (
    gap.code === "adaptive-impact-local-source-mismatch"
      && gap.commandRef === commandRef
  )));
  assert.equal(projected.deferredByTier.some((entry) => entry.commandRef === commandRef), false);
  const plan = buildExecutionPlan(projected, {
    packageScripts: preparedCatalog.sourceInputs.packageScripts,
    preparedCatalog,
  });
  assert.deepEqual(plan.executionCommands, []);
  assert.equal(adaptivePlanningExitCode(projected, plan), 2);
});

test("production adaptive CLI blocks local source mismatch with catalog-bound evidence", (t) => {
  const { artifact, fixture, fixtureDigest, fixturePath } = runAdaptiveLocalCliFixture(t, "source_mismatch");

  assert.equal(artifact.verificationCatalogFixture.id, fixture.id);
  assert.equal(artifact.verificationCatalogFixture.path, path.resolve(fixturePath).replaceAll("\\", "/"));
  assert.equal(artifact.verificationCatalogFixture.identity.digest, fixtureDigest);
  assert.equal(artifact.catalogDigest, artifact.verificationCatalogFixture.catalogIdentity.digest);
  assert.deepEqual(
    artifact.catalogSourceIdentity,
    artifact.verificationCatalogFixture.catalogIdentity.sourceIdentity,
  );
  assert.equal(artifact.selectionArtifactValidation.status, "validated");
  assert.ok(artifact.rawLocalEligibleRoots.some((entry) => (
    entry.commandRef === "test:node:verification-profile"
  )));
  assert.ok(artifact.executionPlan.routeGaps.some((gap) => (
    gap.code === "adaptive-impact-local-source-mismatch"
      && gap.commandRef === "test:node:verification-profile"
  )));
  assert.deepEqual(artifact.executionPlan.executionCommands, []);
  assert.deepEqual(artifact.executionResults, []);
  assert.equal(artifact.executionStatus, "blocked");
  assertEverySelectorRootHasCanonicalOutcome(artifact);
});

test("local behavior omission and command rename cannot silently satisfy local projection", () => {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  const selectorRoutes = buildRouteIndex();
  const missingBehaviorScripts = {
    ...packageScripts,
    "verify:local-infra": packageScripts["verify:local-infra"].replace(" tests/verify_core_runner_behavior.test.mjs", ""),
  };
  assert.throws(() => prepareRepositoryVerificationCatalogBinding({
    packageScripts: missingBehaviorScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: process.cwd(),
    platform: process.platform,
  }), /verification-catalog-package-shadow-drift/);
  const preparedCatalog = prepareRepositoryVerificationCatalog({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const raw = buildAdaptiveEntrypointRecommendation(
    ["tools/run_adaptive_tests.mjs"],
    selectorRoutes,
    { entrypoint: "impact", routeAuthority: preparedCatalog.authority },
  );
  // Drop the selected closure while retaining per-file requirements. A missing
  // leaf must be rejected against canonical coverage, not a weakened fixture.
  const projected = bindSelectionToPreparedCatalog(constrainAdaptiveEntrypointSelection({
    ...raw, recommendedCommands: [],
  }, "impact", {
    preparedCatalog,
  }), preparedCatalog);
  const plan = buildExecutionPlan(projected, {
    packageScripts,
    preparedCatalog,
  });
  assert.equal(projected.localLeafEquivalence.status, "gap");
  assert.ok(projected.localLeafEquivalence.missingLeaves.includes(
    "node-test:tests/verify_core_runner_behavior.test.mjs",
  ));
  assert.deepEqual(plan.executionCommands, []);
  assert.equal(adaptivePlanningExitCode(projected, plan), 2);

  const renamedCommand = "node tools/select_verification_targets_renamed.mjs --check";
  const renamedCatalog = prepareVerificationCatalog({
    packageScripts: {},
    selectorRoutes: [{
      id: "fixture:renamed-selector",
      commandRef: renamedCommand,
      sourceRef: "tools/select_verification_targets_renamed.mjs",
      domain: "test-routing",
      ownerHint: "test-infra",
      layer: "contract",
      cost: "fast",
      executionOwner: "child-safe",
      resourceLocks: [],
      ciProfile: "pr-fast",
    }],
    selectorCommandRefs: [renamedCommand],
    platform: process.platform,
    sourceMode: "fixture",
  });
  assert.deepEqual(renamedCatalog.authority[0].entrypointPolicy.eligibleEntrypoints, ["pr"]);
  assert.equal(renamedCatalog.authority[0].entrypointPolicy.minimumDepth, "pr");
});

test("production adaptive CLI blocks missing and renamed selector sanity", (t) => {
  const missing = runAdaptiveLocalCliFixture(t, "missing_selector").artifact;
  assert.equal(missing.selectionArtifactValidation.status, "validated");
  assert.equal(missing.localLeafEquivalence.status, "gap");
  assert.ok(missing.localLeafEquivalence.missingLeaves.includes(
    "node-script:tools/select_verification_targets.mjs",
  ));
  assert.ok(missing.executionPlan.routeGaps.some((gap) => (
    gap.code === "adaptive-impact-local-leaf-equivalence-gap"
  )));
  assert.deepEqual(missing.executionPlan.executionCommands, []);
  assert.deepEqual(missing.executionResults, []);
  assert.equal(missing.executionStatus, "blocked");
  assertEverySelectorRootHasCanonicalOutcome(missing);

  const renamed = runAdaptiveLocalCliFixture(t, "renamed_selector").artifact;
  const renamedCommand = "node tools/select_verification_targets.mjs --check-renamed";
  assert.ok(renamed.executionPlan.routeGaps.some((gap) => (
    gap.code === "adaptive-selection-artifact-error"
      && gap.detail.includes(renamedCommand)
      && gap.detail.includes("not a package script or known command")
  )));
  assert.deepEqual(renamed.executionPlan.executionCommands, []);
  assert.deepEqual(renamed.executionResults, []);
  assert.equal(renamed.executionStatus, "blocked");
});

test("production adaptive CLI dry-run reaches a valid local execution boundary", (t) => {
  const { artifact, fixtureDigest, profile } = runAdaptivePositiveCliFixture(t);

  assert.equal(artifact.verificationCatalogFixture.identity.digest, fixtureDigest);
  assert.deepEqual(artifact.unmatchedChangedFiles, []);
  assert.deepEqual(artifact.executionPlan.routeGaps, []);
  assert.ok(artifact.executionPlan.executionCommands.length > 0);
  assert.ok(artifact.executionPlan.executionCommands.every((entry) => entry.cost !== "heavy"));
  assert.equal(artifact.executionResults, null);
  assert.equal(artifact.executionStatus, "planned");
  assert.deepEqual(artifact.executionPlan.gatePolicySignals, artifact.gatePolicySignals);
  assert.equal(artifact.executionPlan.gatePolicySignalsDigest, artifact.gatePolicySignalsDigest);
  assert.equal(profile.gatePolicy.signalsDigest, artifact.gatePolicySignalsDigest);
  assert.deepEqual(profile.gatePolicy.signals, artifact.gatePolicySignals);
  assert.equal(artifact.prCost.schemaVersion, 1);
  assert.deepEqual(artifact.prCost.schemaIdentity, PR_COST_SCHEMA_IDENTITY);
  assert.equal(artifact.prCost.observationStage, "adaptive");
  assert.deepEqual(assertPrCostObservation(artifact.prCost), artifact.prCost);
  assert.equal(artifact.selectorPrCost.observationStage, "selector");
  assert.deepEqual(assertPrCostObservation(artifact.selectorPrCost), artifact.selectorPrCost);
  assert.deepEqual(artifact.executionPlan.selectorPrCost, artifact.selectorPrCost);
  assert.equal(
    artifact.executionPlan.selectorPrCostDigest,
    artifact.selectorPrCost.observationDigest,
  );
  assert.equal(
    artifact.prCost.sourceBinding.selectorObservationDigest,
    artifact.selectorPrCost.observationDigest,
  );
  assert.equal(artifact.prCost.requiredExecutionSetEffect, "unchanged");
  assert.equal(artifact.prCost.selectedCommands, artifact.executionPlan.commandsToRun.length);
  assert.deepEqual(profile.prCost, artifact.prCost);
  assertEverySelectorRootHasCanonicalOutcome(artifact);
});

test("production adaptive CLI plans frozen PR7A changed files against the current catalog with protected shared-leaf authority", {
  skip: process.platform !== "win32",
}, (t) => {
  const runtimeTmp = path.join(process.cwd(), ".runtime", "tmp");
  fs.mkdirSync(runtimeTmp, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(runtimeTmp, "pr7a-adaptive-history-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const jsonPath = path.join(tempRoot, "selection.json");
  const markdownPath = path.join(tempRoot, "selection.md");
  const profilePath = path.join(tempRoot, "profile.json");
  const expectedChangedFiles = [
    "package.json",
    "tests/helpers/scenario_chunk_contract_support.mjs",
    "tests/scenario_chunk_contract_shadow_behavior.test.mjs",
    "tests/scenario_chunk_contracts.heavy.test.mjs",
    "tests/scenario_chunk_contracts.quick.test.mjs",
    "tests/scenario_chunk_contracts.test.mjs",
    "tests/test_e2e_structural_tooling.py",
    "tests/verification_metadata_behavior.test.mjs",
    "tests/verification_script_portfolio_behavior.test.mjs",
    "tests/verify_core_runner_behavior.test.mjs",
    "tools/test_route_registry.mjs",
    "tools/verification/test_shadow_equivalence.mjs",
    "tools/verification/verification_catalog_source.mjs",
    "tools/verification/verification_domains.mjs",
  ];
  const result = spawnSync(process.execPath, [
    "tools/run_adaptive_tests.mjs",
    "--defer-main-thread",
    ...expectedChangedFiles,
    "--json-out", jsonPath,
    "--md-out", markdownPath,
    "--profile-out", profilePath,
  ], { cwd: process.cwd(), encoding: "utf8" });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const artifact = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  assert.deepEqual(artifact.changedFiles, expectedChangedFiles);
  const expected = buildRecommendation(expectedChangedFiles);
  const refs = (commands) => commands.map((entry) => entry.commandRef).sort();
  assert.deepEqual(refs(artifact.recommendedCommands), refs(expected.recommendedCommands));
  assert.deepEqual(refs(artifact.mainThreadSerialVerification), refs(expected.mainThreadSerialVerification));
  assert.deepEqual(artifact.unmatchedChangedFiles, []);
  assert.deepEqual(artifact.executionPlan.routeGaps, []);
  assert.deepEqual([...artifact.executionPlan.blockedMainThreadCommands].sort(), refs(expected.mainThreadSerialVerification));
  assert.equal(artifact.executionStatus, "planned");
  assert.equal(artifact.executionResults, null);
  assert.ok(fs.existsSync(markdownPath));
  assert.ok(fs.existsSync(profilePath));

  const expectedLocks = [".runtime-output", "heavy-geo", "scenario-data"];
  const sharedLeaf = artifact.executionPlan.deferredMainThreadLeaves.find((entry) => (
    entry.leafId === "node-test:tests/scenario_chunk_contracts.test.mjs"
  ));
  assert.ok(sharedLeaf);
  assert.deepEqual(sharedLeaf.resourceLocks, expectedLocks);
  assert.deepEqual(sharedLeaf.sourceRootRefs, [
    "test:node:p4:p4-2b",
    "test:node:p4:p4-3",
    "verify:tno-coverage-chain",
  ]);
  for (const commandRef of [
    "test:node:p4:p4-1",
    "test:node:p4:p4-2a",
    "test:node:p4:p4-2b",
    "test:node:p4:p4-2c",
    "test:node:p4:p4-3",
    "test:node:p4:p4-4",
    "verify:tno-coverage-chain",
  ]) {
    const root = artifact.mainThreadSerialVerification.find((entry) => entry.commandRef === commandRef);
    assert.ok(root, commandRef);
    assert.deepEqual(root.resourceLocks, expectedLocks, commandRef);
  }
});

test("production adaptive CLI rejects fixture and selection identity drift", (t) => {
  const fixtureRun = runAdaptiveLocalCliFixture(t, "source_mismatch");
  const wrongFixtureSha = `${fixtureRun.fixtureDigest.slice(0, -1)}${fixtureRun.fixtureDigest.endsWith("0") ? "1" : "0"}`;
  const wrongShaPath = path.join(fixtureRun.tempRoot, "wrong-sha.json");
  const wrongShaArgs = fixtureRun.commonArgs.map((entry, index, args) => (
    index > 0 && args[index - 1] === "--verification-catalog-fixture-sha256"
      ? wrongFixtureSha
      : entry
  ));
  const wrongShaResult = spawnSync(process.execPath, [
    ...wrongShaArgs,
    "--dry-run",
    "--json-out",
    wrongShaPath,
    "--md-out",
    path.join(fixtureRun.tempRoot, "wrong-sha.md"),
    "--profile-out",
    path.join(fixtureRun.tempRoot, "wrong-sha-profile.json"),
  ], { cwd: process.cwd(), encoding: "utf8" });
  assert.equal(wrongShaResult.status, 2, wrongShaResult.stderr || wrongShaResult.stdout);
  const wrongShaArtifact = JSON.parse(fs.readFileSync(wrongShaPath, "utf8"));
  assert.ok(wrongShaArtifact.executionPlan.routeGaps.some((gap) => (
    gap.code === "adaptive-verification-catalog-fixture-sha256-mismatch"
  )));
  assert.deepEqual(wrongShaArtifact.executionPlan.executionCommands, []);
  assert.deepEqual(wrongShaArtifact.executionResults, []);

  for (const field of ["catalogDigest", "catalogSourceIdentity"]) {
    const forgedSelection = structuredClone(fixtureRun.seedArtifact);
    forgedSelection[field] = field === "catalogDigest"
      ? "forged-catalog-digest"
      : { ...forgedSelection.catalogSourceIdentity, digest: "forged-source-identity" };
    const forgedSelectionPath = path.join(fixtureRun.tempRoot, `forged-${field}.json`);
    fs.writeFileSync(forgedSelectionPath, `${JSON.stringify(forgedSelection, null, 2)}\n`, "utf8");
    const forgedEvidencePath = path.join(fixtureRun.tempRoot, `forged-${field}-evidence.json`);
    const forgedResult = spawnSync(process.execPath, [
      ...fixtureRun.commonArgs,
      "--execute",
      "--selection-json",
      forgedSelectionPath,
      "--json-out",
      forgedEvidencePath,
      "--md-out",
      path.join(fixtureRun.tempRoot, `forged-${field}-evidence.md`),
      "--profile-out",
      path.join(fixtureRun.tempRoot, `forged-${field}-profile.json`),
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(forgedResult.status, 2, forgedResult.stderr || forgedResult.stdout);
    const forgedArtifact = JSON.parse(fs.readFileSync(forgedEvidencePath, "utf8"));
    assert.equal(forgedArtifact.selectionArtifactValidation.status, "rejected");
    assert.ok(forgedArtifact.executionPlan.routeGaps.some((gap) => (
      gap.code === "adaptive-selection-catalog-drift" && gap.detail.includes(field)
    )));
    assert.deepEqual(forgedArtifact.executionPlan.executionCommands, []);
    assert.deepEqual(forgedArtifact.executionResults, []);
  }
});

test("production adaptive CLI blocks the exact canonical recursive root", (t) => {
  const { artifact } = runAdaptiveLocalCliFixture(t, "recursive");
  const recursiveCommand = "node tools/run_adaptive_tests.mjs --entrypoint impact --execute --defer-main-thread";

  assert.equal(artifact.selectionArtifactValidation.status, "validated");
  assert.ok(artifact.executionPlan.routeGaps.some((gap) => (
    gap.code === "adaptive-canonical-command-blocked"
      && gap.commandRef === recursiveCommand
  )));
  assert.ok(artifact.executionPlan.selectorRootOutcomes.some((entry) => (
    entry.commandRef === recursiveCommand
      && entry.disposition === "blocked"
  )));
  assert.deepEqual(artifact.executionPlan.executionCommands, []);
  assert.deepEqual(artifact.executionResults, []);
  assert.equal(artifact.executionStatus, "blocked");
  assertEverySelectorRootHasCanonicalOutcome(artifact);
});

test("catalog-bound local estimates scale monotonically with canonical leaves", () => {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  const preparedCatalog = prepareRepositoryVerificationCatalog({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes: buildRouteIndex(),
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const estimateFor = (leafCount) => applyLocalEntrypointExecutionBudget({
    catalogDigest: preparedCatalog.catalogDigest,
    commandsToRun: ["fixture-root"],
    selectedLeaves: Array.from({ length: leafCount }, (_, index) => ({ leafId: `leaf:${index}` })),
    executionGroups: [{
      groupId: "fixture-group",
      cost: "fast",
      leafIds: Array.from({ length: leafCount }, (_, index) => `leaf:${index}`),
    }],
    routeGaps: [],
    executionCommands: [{ commandRef: "fixture-command" }],
  }, "impact", { preparedCatalog }).localEntrypointBudget;
  const one = estimateFor(1);
  const four = estimateFor(4);
  const twelve = estimateFor(12);
  assert.deepEqual(
    [one.actual.estimatedRuntimeSeconds, four.actual.estimatedRuntimeSeconds, twelve.actual.estimatedRuntimeSeconds],
    [25, 40, 80],
  );
  assert.deepEqual(
    [one.actual.estimatedCostUnits, four.actual.estimatedCostUnits, twelve.actual.estimatedCostUnits],
    [0.75, 1.5, 3.5],
  );
  assert.ok(one.groupEstimates[0].estimateAuthority.startsWith("catalog:"));
});

test("measured local runtime estimates preserve mixed-group monotonicity and platform fallback", () => {
  for (const platform of ["win32", "linux"]) {
    const preparedCatalog = prepareRepositoryVerificationCatalog({ platform });
    const measured = "node-test:tests/border_mesh_owner_behavior.test.mjs";
    const estimate = (leafIds) => applyLocalEntrypointExecutionBudget({
      catalogDigest: preparedCatalog.catalogDigest,
      commandsToRun: ["fixture-root"], selectedLeaves: leafIds.map((leafId) => ({ leafId })),
      executionGroups: [{ groupId: "fixture-group", cost: "fast", leafIds }],
      routeGaps: [], executionCommands: [{ commandRef: "fixture-command" }],
    }, "edit", { preparedCatalog }).localEntrypointBudget.actual;
    assert.equal(estimate([measured]).estimatedRuntimeSeconds, platform === "win32" ? 2 : 25);
    assert.equal(estimate([measured, "unmeasured"]).estimatedRuntimeSeconds, platform === "win32" ? 26 : 30);
    assert.equal(estimate(["unmeasured"]).estimatedRuntimeSeconds, 25);
    assert.equal(estimate([measured]).estimatedCostUnits, 0.75);
    assert.equal(estimate([measured, "unmeasured"]).estimatedCostUnits, 1);
  }
});

test("local estimates fail closed on missing policy authority, policy drift, and unknown cost", () => {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  const preparedCatalog = prepareRepositoryVerificationCatalog({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes: buildRouteIndex(),
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const basePlan = {
    catalogDigest: preparedCatalog.catalogDigest,
    commandsToRun: ["fixture-root"],
    selectedLeaves: [{ leafId: "leaf:1" }],
    executionGroups: [{ groupId: "fixture-group", cost: "fast", leafIds: ["leaf:1"] }],
    routeGaps: [],
    executionCommands: [{ commandRef: "fixture-command" }],
  };
  const missingAuthority = applyLocalEntrypointExecutionBudget(basePlan, "impact");
  assert.ok(missingAuthority.routeGaps.some((gap) => (
    gap.code === "adaptive-impact-estimate-policy-authority-missing"
  )));
  assert.deepEqual(missingAuthority.executionCommands, []);

  const missingPolicyCatalog = structuredClone(preparedCatalog);
  delete missingPolicyCatalog.catalog.estimatePolicy;
  const missingPolicy = applyLocalEntrypointExecutionBudget(basePlan, "impact", {
    preparedCatalog: missingPolicyCatalog,
  });
  assert.ok(missingPolicy.routeGaps.some((gap) => (
    gap.code === "adaptive-impact-estimate-policy-authority-missing"
  )));

  const driftedCatalog = structuredClone(preparedCatalog);
  driftedCatalog.catalog.estimatePolicy.costClasses.fast.perLeafRuntimeSeconds += 1;
  const drifted = applyLocalEntrypointExecutionBudget(basePlan, "impact", {
    preparedCatalog: driftedCatalog,
  });
  assert.ok(drifted.routeGaps.some((gap) => (
    gap.code === "adaptive-impact-estimate-policy-integrity-mismatch"
  )));
  assert.deepEqual(drifted.executionCommands, []);

  const unknownCost = applyLocalEntrypointExecutionBudget({
    ...basePlan,
    executionGroups: [{ groupId: "fixture-group", cost: "unsealed", leafIds: ["leaf:1"] }],
  }, "impact", { preparedCatalog });
  assert.ok(unknownCost.routeGaps.some((gap) => (
    gap.code === "adaptive-impact-estimate-policy-unknown-cost"
  )));
  assert.deepEqual(unknownCost.executionCommands, []);
});

test("local entrypoints fail closed when any matched file loses child-safe closure", () => {
  const fast = adaptiveContributor("test:node:verification-profile", {
    sourceRefs: ["tests/fast.test.mjs"],
    routeIds: ["route:fast"],
    safetyContributorRouteIds: ["route:fast"],
  });
  const heavy = adaptiveContributor("node --test tests/heavy.test.mjs", {
    sourceRefs: ["tests/heavy.test.mjs"],
    disposition: "main-thread",
    executionOwners: ["main-thread"],
    cost: "heavy",
    resourceLocks: [".runtime-output"],
    routeIds: ["route:heavy"],
    safetyContributorRouteIds: ["route:heavy"],
  });
  const report = {
    ...adaptiveReport({ selected: [fast], mainThread: [heavy] }),
    changedFiles: ["tests/fast.test.mjs", "tests/heavy.test.mjs"],
    matchedByFile: [
      {
        changedFile: "tests/fast.test.mjs",
        matchedRouteIds: ["route:fast"],
        recommendedCommands: [structuredClone(fast)],
      },
      {
        changedFile: "tests/heavy.test.mjs",
        matchedRouteIds: ["route:heavy"],
        recommendedCommands: [structuredClone(heavy)],
      },
    ],
  };
  const preparedCatalog = prepareVerificationCatalog({
    packageScripts: {
      [fast.commandRef]: "node --test tests/fast.test.mjs",
      [heavy.commandRef]: "node --test tests/heavy.test.mjs",
    },
    selectorRoutes: [fast, heavy].map((entry) => ({
      ...entry,
      id: entry.routeIds[0],
      authoritySource: "selector-route",
    })),
    selectorCommandRefs: [fast.commandRef, heavy.commandRef],
    platform: process.platform,
    sourceMode: "fixture",
  });
  for (const entrypoint of ["edit", "impact"]) {
    const projected = constrainAdaptiveEntrypointSelection(report, entrypoint, { preparedCatalog });
    assert.deepEqual(projected.matchedByFile[1].recommendedCommands, []);
    assert.deepEqual(projected.localEntrypointRouteGaps, [{
      code: `adaptive-${entrypoint}-local-entrypoint-no-eligible-coverage`,
      commandRef: "tests/heavy.test.mjs",
      detail: "matched-routes=route:heavy;required-depth=nightly",
    }]);
    const plan = buildExecutionPlan(projected, {
      packageScripts: preparedCatalog.sourceInputs.packageScripts,
      preparedCatalog,
    });
    assert.ok(plan.routeGaps.some((gap) => gap.code === `adaptive-${entrypoint}-local-entrypoint-no-eligible-coverage`));
    assert.deepEqual(plan.executionCommands, []);
    assert.equal(adaptivePlanningExitCode(projected, plan), 2);
  }
});

test("local entrypoint budgets fail closed on expanded roots leaves process groups runtime and cost", () => {
  const packageScripts = JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf8")).scripts;
  const preparedCatalog = prepareRepositoryVerificationCatalog({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes: buildRouteIndex(),
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const plan = applyLocalEntrypointExecutionBudget({
    catalogDigest: preparedCatalog.catalogDigest,
    commandsToRun: ["a", "b"],
    selectedLeaves: Array.from({ length: 5 }, (_, index) => ({ leafId: `leaf:${index}` })),
    executionGroups: [
      { groupId: "g1", cost: "heavy", leafIds: ["leaf:0"] },
      { groupId: "g2", cost: "heavy", leafIds: ["leaf:1"] },
      { groupId: "g3", cost: "heavy", leafIds: ["leaf:2", "leaf:3", "leaf:4"] },
    ],
    routeGaps: [],
    executionCommands: [{ commandRef: "would-run" }],
  }, "impact", {
    preparedCatalog,
    limits: {
      maxCommands: 1,
      maxLeaves: 4,
      maxProcessGroups: 2,
      maxEstimatedRuntimeSeconds: 100,
      maxEstimatedCostUnits: 5,
    },
  });
  assert.deepEqual(
    plan.routeGaps.map((gap) => gap.code).sort(),
    [
      "adaptive-impact-command-budget-exceeded",
      "adaptive-impact-cost-budget-exceeded",
      "adaptive-impact-leaf-budget-exceeded",
      "adaptive-impact-process-group-budget-exceeded",
      "adaptive-impact-runtime-budget-exceeded",
    ],
  );
  assert.deepEqual(plan.executionCommands, []);
});

test("adaptive execution reconciles duplicate route safety metadata before PR execution", () => {
  const report = buildRecommendation(
    ["tools/verification/verification_domains.mjs"],
    buildRouteIndex(),
    { platform: "win32" },
  );
  const telemetryCommand = "test:node:williams-crossover-telemetry-live";
  const telemetryEntry = report.recommendedCommands.find((entry) => entry.commandRef === telemetryCommand);
  assert.ok(telemetryEntry);
  assert.deepEqual(telemetryEntry.executionOwners, ["child-safe", "main-thread"]);
  assert.deepEqual(telemetryEntry.ciProfiles, ["perf-pr-gate", "pr-fast"]);
  assert.deepEqual(telemetryEntry.resourceLocks, ["perf-dev-server"]);
  assert.ok(telemetryEntry.safetyContributorRouteIds.length > telemetryEntry.routeIds.length);
  assert.ok(telemetryEntry.safetyContributorRouteIds.includes("node:test:node:williams-crossover-telemetry-live"));
  assert.ok(telemetryEntry.safetyContributorRouteIds.includes("perf:williams-crossover-telemetry-live"));

  const executionPlan = buildExecutionPlan(report, { platform: "win32" });
  assert.equal(executionPlan.commandsToRun.includes(telemetryCommand), false);
  assert.ok(executionPlan.blockedMainThreadCommands.includes(telemetryCommand));
});

test("adaptive execution treats complete selection contributors as the only safety authority", () => {
  const selected = adaptiveContributor("node --test tests/authority.test.mjs");
  const cases = [];

  const missingPlatform = adaptiveReport({ selected: [selected] });
  delete missingPlatform.recommendedCommands[0].platforms;
  cases.push([missingPlatform, "adaptive-selection-authority-field"]);

  const conflictingLock = adaptiveReport({ selected: [selected] });
  conflictingLock.childAgentStaticTasks[0].resourceLocks = ["forged-lock"];
  cases.push([conflictingLock, "adaptive-selection-authority-conflict"]);

  const crossDisposition = adaptiveReport({ selected: [selected] });
  crossDisposition.mainThreadSerialVerification.push(structuredClone(selected));
  cases.push([crossDisposition, "adaptive-selection-cross-disposition"]);

  const forgedFullP4 = adaptiveContributor("verify:p4:state-writer-policy", {
    disposition: "child-safe",
    executionOwners: ["main-thread"],
    resourceLocks: [],
    ciProfiles: ["full"],
  });
  cases.push([
    adaptiveReport({ selected: [forgedFullP4] }),
    "adaptive-selection-disposition-owner-mismatch",
  ]);

  for (const [report, expectedGap] of cases) {
    const plan = buildExecutionPlan(report, { packageScripts: {} });
    assert.ok(plan.routeGaps.some((gap) => gap.code === expectedGap), JSON.stringify(plan.routeGaps));
    assert.deepEqual(plan.executionCommands, []);
    let spawnCount = 0;
    assert.deepEqual(executeAdaptivePlan(plan, {
      runner() {
        spawnCount += 1;
        return { status: 0 };
      },
    }), []);
    assert.equal(spawnCount, 0);
  }
});

test("adaptive execution invokes one whole-lane planner per disposition and propagates cross-root facts", () => {
  const selected = [
    adaptiveContributor("catalog:one"),
    adaptiveContributor("catalog:two"),
  ];
  const mainThread = [adaptiveContributor("catalog:main", {
    disposition: "main-thread",
    executionOwners: ["main-thread"],
    resourceLocks: ["browser-dev-server"],
    ciProfiles: ["full"],
  })];
  const ciOnly = [adaptiveContributor("catalog:ci", {
    disposition: "ci-only",
    executionOwners: ["ci-only"],
    resourceLocks: ["perf-dev-server"],
    ciProfiles: ["perf-pr-gate"],
  })];
  const calls = [];
  const executionPlanner = (catalog, rootContributors, options) => {
    calls.push({
      disposition: options.disposition,
      rootCommandRefs: rootContributors.map((entry) => entry.commandRef),
    });
    return buildVerificationSelectionPlan(catalog, rootContributors, options);
  };
  const plannerScripts = {
    "catalog:one": "node --test tests/shared_catalog.test.mjs",
    "catalog:two": "node --test tests/shared_catalog.test.mjs",
    "catalog:main": "node --test tests/main_catalog.test.mjs",
    "catalog:ci": "node --test tests/ci_catalog.test.mjs",
  };
  const selectorReport = adaptiveReport({ selected, mainThread, ciOnly });
  let catalogBuilds = 0;
  let authorityReconciliations = 0;
  const preparedCatalog = prepareVerificationCatalog({
    packageScripts: plannerScripts,
    selectorRoutes: selectorReport.recommendedCommands.map((entry) => ({
      ...entry,
      id: entry.routeIds[0],
    })),
    selectorCommandRefs: selectorReport.recommendedCommands.map((entry) => entry.commandRef),
    catalogBuilder(input) {
      catalogBuilds += 1;
      return buildVerificationCatalog(input);
    },
    authorityReconciler(inputs) {
      authorityReconciliations += 1;
      return reconcileVerificationRouteAuthority(inputs);
    },
  });
  const boundReport = bindSelectorPrCost(bindSelectionToPreparedCatalog(selectorReport, preparedCatalog));
  const plan = buildExecutionPlan(boundReport, {
    packageScripts: plannerScripts,
    preparedCatalog,
    executionPlanner,
  });
  assert.deepEqual(calls, [
    { disposition: "selected", rootCommandRefs: ["catalog:one", "catalog:two"] },
    { disposition: "deferred-main-thread", rootCommandRefs: ["catalog:main"] },
    { disposition: "deferred-ci-only", rootCommandRefs: ["catalog:ci"] },
  ]);
  assert.deepEqual(plan.routeGaps, []);
  assert.equal(catalogBuilds, 1);
  assert.equal(authorityReconciliations, 1);
  assert.equal(plan.selectedLeaves.length, 1);
  assert.deepEqual(plan.selectedLeaves[0].sourceCommandRefs, ["catalog:one", "catalog:two"]);
  assert.equal(plan.closure.plannerInvocationCount, 3);
  let legacyAnalyzerCalls = 0;
  const preparedProfile = prepareVerificationProfilePlan({
    executionPlan: plan,
    commandAnalyzer() {
      legacyAnalyzerCalls += 1;
      throw new Error("canonical adaptive path must not invoke the legacy analyzer");
    },
  });
  const canonicalProfile = buildVerificationProfile({
    runnerId: "adaptive-canonical-final-plan",
    executionPlan: plan,
    preparedPlan: preparedProfile,
    executionResults: plan.executionGroups.map((group) => ({
      commandRef: group.commandRef,
      groupId: group.groupId,
      status: "passed",
      exitCode: 0,
      processStarted: true,
      interrupted: false,
      actualFiles: [...group.files, ...group.modules, ...group.specs],
    })),
    terminalState: "passed",
  });
  assert.equal(legacyAnalyzerCalls, 0);
  assert.deepEqual(
    canonicalProfile.selection.accountedCanonicalLeaves,
    canonicalProfile.selection.plannedCanonicalLeaves,
  );
  assert.equal(canonicalProfile.selection.executionSetComparison.status, "complete");
  assert.equal(canonicalProfile.selection.executionProjection[0].groupId, plan.executionGroups[0].groupId);

  const conflictingSelected = [
    adaptiveContributor("catalog:one"),
    adaptiveContributor("catalog:two", { ciProfiles: ["full"] }),
  ];
  const conflictPlan = buildExecutionPlan(adaptiveReport({ selected: conflictingSelected }), {
    packageScripts: plannerScripts,
    executionPlanner,
  });
  assert.ok(conflictPlan.routeGaps.some((gap) => gap.code === "verification-plan-leaf-conflict"));
  assert.deepEqual(conflictPlan.executionCommands, []);
});

test("adaptive execution keeps canonical overlap unique within mutually exclusive dispositions", () => {
  const selected = [adaptiveContributor("catalog:child")];
  const mainThread = [adaptiveContributor("catalog:main", {
    disposition: "main-thread",
    executionOwners: ["main-thread"],
    resourceLocks: ["dist", ".runtime-output"],
    ciProfiles: ["deploy-minimal"],
  })];
  const scripts = {
    "catalog:child": "node --test tests/shared_disposition.test.mjs",
    "catalog:main": "node --test tests/shared_disposition.test.mjs",
  };
  const plan = buildExecutionPlan(adaptiveReport({ selected, mainThread }), {
    packageScripts: scripts,
  });

  assert.deepEqual(plan.routeGaps, []);
  assert.deepEqual(plan.selectedLeaves.map((leaf) => leaf.leafId), [
    "node-test:tests/shared_disposition.test.mjs",
  ]);
  assert.deepEqual(plan.deferredMainThreadLeaves.map((leaf) => leaf.leafId), [
    "node-test:tests/shared_disposition.test.mjs",
  ]);
  assert.equal(plan.executionCommands.length, 1);
  assert.equal(plan.executionCommands[0].leafIds.length, 1);
  assert.equal(plan.deferredMainThreadGroups.length, 1);
  assert.equal(plan.deferredMainThreadGroups[0].leafIds.length, 1);
});

test("adaptive execution defers platform-incompatible main-thread roots without opening Linux PR gaps", () => {
  const otherPlatform = process.platform === "win32" ? "linux" : "win32";
  const commandRef = "catalog:platform-owned-main";
  const leafCommandRef = "catalog:platform-owned-leaf";
  const mainThread = [adaptiveContributor(commandRef, {
    disposition: "main-thread",
    executionOwners: ["main-thread"],
    platforms: ["all"],
    resourceLocks: [".runtime-output"],
    ciProfiles: ["full"],
  })];
  const platformLeaf = adaptiveContributor(leafCommandRef, {
    disposition: "main-thread",
    executionOwners: ["main-thread"],
    platforms: [otherPlatform],
    resourceLocks: [".runtime-output"],
    ciProfiles: ["full"],
  });
  const report = adaptiveReport({ mainThread });
  const packageScripts = {
    [commandRef]: `npm run ${leafCommandRef}`,
    [leafCommandRef]: "node --test tests/platform_owned_main.test.mjs",
  };
  const preparedCatalog = prepareVerificationCatalog({
    packageScripts,
    selectorRoutes: [mainThread[0], platformLeaf].map((entry) => ({
      ...entry,
      id: entry.routeIds[0],
    })),
    selectorCommandRefs: [commandRef, leafCommandRef],
  });

  const deferredPlan = buildExecutionPlan(report, { packageScripts, preparedCatalog });
  assert.deepEqual(deferredPlan.routeGaps, []);
  assert.deepEqual(deferredPlan.executionCommands, []);
  assert.deepEqual(deferredPlan.platformDeferredMainThreadCommands, [commandRef]);
  assert.deepEqual(deferredPlan.deferredMainThreadLeaves, []);
  assert.equal(deferredPlan.closure.deferredMainThreadRootCount, 1);
  assert.deepEqual(deferredPlan.selectorRootOutcomes, [{
    commandRef,
    disposition: "deferred-main-thread-platform",
    currentPlatform: process.platform,
    requiredPlatforms: [otherPlatform],
  }]);

  const includedPlan = buildExecutionPlan(report, {
    includeMainThread: true,
    packageScripts,
    preparedCatalog,
  });
  assert.ok(includedPlan.routeGaps.some((gap) => (
    gap.code === "verification-plan-platform-mismatch"
  )));
  assert.deepEqual(includedPlan.executionCommands, []);
});

test("adaptive execution fails closed before commands on cyclic or unresolved aliases", () => {
  const cycleRoot = adaptiveContributor("test:cycle:a");
  const cyclePlan = buildExecutionPlan(adaptiveReport({ selected: [cycleRoot] }), {
    packageScripts: {
      "test:cycle:a": "npm run test:cycle:b",
      "test:cycle:b": "npm run test:cycle:a",
    },
  });
  assert.ok(cyclePlan.routeGaps.some((gap) => gap.code === "verification-plan-cycle"));
  assert.deepEqual(cyclePlan.executionCommands, []);

  const unresolvedRoot = adaptiveContributor("test:missing");
  const unresolvedPlan = buildExecutionPlan(adaptiveReport({ selected: [unresolvedRoot] }), {
    packageScripts: {},
  });
  assert.ok(unresolvedPlan.routeGaps.some((gap) => gap.code === "verification-plan-unresolved-ref"));
  let calls = 0;
  assert.deepEqual(executeAdaptivePlan(unresolvedPlan, {
    runner() {
      calls += 1;
      return { status: 0 };
    },
  }), []);
  assert.equal(calls, 0);
});

test("adaptive execution keeps Windows Job, browser, Pages, and perf leaves in locked groups", () => {
  const windowsJobPlan = buildExecutionPlan(buildRecommendation([
    "tests/windows_job_runtime_integration.test.mjs",
  ]));
  const browserPlan = buildExecutionPlan(buildRecommendation([
    "tests/e2e/dev/scenario_chunk_exact_after_settle_regression.dev.spec.js",
  ]));
  const perfPlan = buildExecutionPlan(buildRecommendation([
    "tools/perf/run_williams_crossover.mjs",
  ]));
  const workflowPlan = buildExecutionPlan(buildRecommendation([".github/workflows/verify-shared.yml"]));
  const cases = [
    ...(process.platform === "win32" ? [{
      plan: windowsJobPlan,
      commandRef: "test:node:windows-job-runtime:integration",
      lock: ".runtime-output",
      kind: "node-test",
    }] : []),
    {
      plan: browserPlan,
      commandRef: "test:e2e:dev:scenario-chunk-runtime",
      lock: "browser-dev-server",
      kind: "playwright",
    },
    {
      plan: workflowPlan,
      commandRef: "verify:pages-dist-and-drift",
      lock: "dist",
    },
    ...(process.platform === "win32" ? [{
      plan: perfPlan,
      commandRef: "perf:williams-crossover:run",
      lock: "perf-dev-server",
    }] : []),
  ];
  for (const testCase of cases) {
    const groups = testCase.plan.deferredMainThreadGroups.filter((group) => (
      group.sourceCommandRefs.includes(testCase.commandRef)
    ));
    assert.ok(groups.length > 0, `missing deferred groups for ${testCase.commandRef}`);
    assert.ok(groups.every((group) => group.resourceLocks.includes(testCase.lock)));
    assert.ok(groups.every((group) => group.sourceCommandRefs.includes(testCase.commandRef)));
    if (testCase.kind) assert.ok(groups.every((group) => group.kind === testCase.kind));
  }
});

test("adaptive execution preserves one-file Node check semantics", () => {
  const checks = adaptiveContributor("verify:checks", { isolation: "leaf" });
  const plan = buildExecutionPlan(adaptiveReport({ selected: [checks] }), {
    packageScripts: {
      "verify:checks": "node --check tools/one.mjs tools/two.mjs",
    },
  });
  assert.deepEqual(
    plan.executionGroups.map((group) => group.process.args),
    [["--check", "tools/one.mjs"], ["--check", "tools/two.mjs"]],
  );
});

test("adaptive execution enforces Node batch budgets and Python process isolation", () => {
  const nodeTargets = Array.from({ length: 211 }, (_, index) => `tests/budget_${index}.test.mjs`);
  const nodeRoot = adaptiveContributor("test:node:211", {
    batchSafe: true,
    isolation: "batch",
    maxLeaves: 64,
  });
  const nodePlan = buildExecutionPlan(adaptiveReport({ selected: [nodeRoot] }), {
    packageScripts: { "test:node:211": `node --test ${nodeTargets.join(" ")}` },
  });
  assert.deepEqual(nodePlan.routeGaps, []);
  assert.equal(nodePlan.selectedLeaves.length, 211);
  assert.equal(nodePlan.executionGroups.length, 4);
  assert.ok(nodePlan.executionGroups.every((group) => group.leafCount <= 64));
  assert.ok(nodePlan.executionGroups.every((group) => group.argvBytes <= group.maxArgvBytes));

  const pythonRoots = Array.from({ length: 15 }, (_, index) => adaptiveContributor(
    `python -m unittest tests.test_history_${index} -q`,
    { isolation: "process" },
  ));
  const pythonPlan = buildExecutionPlan(adaptiveReport({ selected: pythonRoots }), { packageScripts: {} });
  assert.deepEqual(pythonPlan.routeGaps, []);
  assert.equal(pythonPlan.selectedLeaves.length, 15);
  assert.equal(pythonPlan.executionGroups.length, 15);
  assert.ok(pythonPlan.executionGroups.every((group) => group.kind === "python-unittest"));

  const windowsRoot = adaptiveContributor("test:node:windows-budget", {
    platforms: ["win32"],
    batchSafe: true,
    isolation: "batch",
    maxLeaves: 64,
    maxArgvBytes: 600,
  });
  const windowsReport = adaptiveReport({ selected: [windowsRoot], selectionPlatform: "win32" });
  const windowsPlan = buildExecutionPlan(windowsReport, {
    platform: "win32",
    packageScripts: {
      "test:node:windows-budget": `node --test ${Array.from({ length: 30 }, (_, index) => `tests/windows_argv_${index}.test.mjs`).join(" ")}`,
    },
  });
  assert.deepEqual(windowsPlan.routeGaps, []);
  assert.ok(windowsPlan.executionGroups.length > 1);
  assert.ok(windowsPlan.executionGroups.every((group) => group.argvBytes <= 600));

  const oversizedRoot = adaptiveContributor("node --test tests/a_very_long_single_leaf_name.test.mjs", {
    batchSafe: true,
    isolation: "batch",
    maxArgvBytes: 20,
  });
  const oversizedPlan = buildExecutionPlan(adaptiveReport({ selected: [oversizedRoot] }), { packageScripts: {} });
  assert.ok(oversizedPlan.routeGaps.some((gap) => gap.code === "verification-plan-argv-budget-exceeded"));
  assert.deepEqual(oversizedPlan.executionCommands, []);
});

test("adaptive execution consumes only an exact and complete changed-file selection artifact", () => {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "adaptive-selection-artifact-"));
  const artifactPath = path.join(tempRoot, "selector.json");
  const contributor = adaptiveContributor("node --test tests/artifact.test.mjs");
  const artifact = adaptiveReport({ selected: [contributor] });
  artifact.changedFiles = ["tools/run_adaptive_tests.mjs"];
  artifact.matchedByFile = [{
    changedFile: "tools/run_adaptive_tests.mjs",
    matchedRouteIds: [...contributor.routeIds],
    recommendedCommands: [structuredClone(contributor)],
  }];
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), "utf8");
  assert.deepEqual(
    readSelectionArtifact(artifactPath, ["./tools/run_adaptive_tests.mjs"]).changedFiles,
    ["tools/run_adaptive_tests.mjs"],
  );
  assert.throws(
    () => readSelectionArtifact(artifactPath, ["package.json"]),
    /adaptive-selection-artifact-changed-files-mismatch/,
  );
  const incompleteArtifactPath = path.join(tempRoot, "selector-incomplete.json");
  const incompleteArtifact = structuredClone(artifact);
  delete incompleteArtifact.childAgentStaticTasks[0].resourceLocks;
  fs.writeFileSync(incompleteArtifactPath, JSON.stringify(incompleteArtifact), "utf8");
  assert.throws(
    () => readSelectionArtifact(incompleteArtifactPath, ["tools/run_adaptive_tests.mjs"]),
    /adaptive-selection-authority-field/,
  );
});

test("adaptive selection roundtrips prose-only changes without trusting forged classifications", (t) => {
  const runtimeTmp = path.join(process.cwd(), ".runtime", "tmp");
  fs.mkdirSync(runtimeTmp, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(runtimeTmp, "selector-prose-artifact-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const artifactPath = path.join(tempRoot, "selector.json");
  const changedFiles = [".codex/config.toml", "docs/active/editor-kernel-renewal-20260909/task.md"];
  const report = buildRecommendation(changedFiles);
  fs.writeFileSync(artifactPath, JSON.stringify(report));
  assert.deepEqual(readSelectionArtifact(artifactPath, changedFiles).recommendedCommands, []);

  const forged = structuredClone(report);
  forged.changedFiles.push("js/unregistered_runtime.js");
  forged.matchedByFile.push({
    changedFile: "js/unregistered_runtime.js", matchedRouteIds: [], recommendedCommands: [],
  });
  forged.nonBehavioralChangedFiles.push({
    changedFile: "js/unregistered_runtime.js", classification: "task-documentation",
    disposition: "no-app-behavior-validation", behaviorTestsRun: false,
  });
  fs.writeFileSync(artifactPath, JSON.stringify(forged));
  assert.throws(() => readSelectionArtifact(artifactPath, forged.changedFiles),
    /adaptive-selection-artifact-empty-closure/);
});

test("real selector CLI artifact binds to the repository catalog and drives structured execution", (t) => {
  const runtimeTmp = path.join(process.cwd(), ".runtime", "tmp");
  fs.mkdirSync(runtimeTmp, { recursive: true });
  const tempRoot = fs.mkdtempSync(path.join(runtimeTmp, "selector-adaptive-seam-"));
  t.after(() => fs.rmSync(tempRoot, { recursive: true, force: true }));
  const changedFiles = [
    ".codex/config.toml", ".github/workflows/verify-shared.yml",
    "docs/active/editor-kernel-renewal-20260909/task.md",
  ];
  const changedFilesPath = path.join(tempRoot, "changed-files.txt");
  const artifactPath = path.join(tempRoot, "selector.json");
  const markdownPath = path.join(tempRoot, "selector.md");
  fs.writeFileSync(changedFilesPath, `${changedFiles.join("\n")}\n`, "utf8");

  const selectorResult = spawnSync(process.execPath, [
    "tools/select_verification_targets.mjs",
    "--changed-files-list",
    changedFilesPath,
    "--json-out",
    artifactPath,
    "--md-out",
    markdownPath,
  ], {
    cwd: process.cwd(),
    encoding: "utf8",
  });
  assert.equal(selectorResult.status, 0, selectorResult.stderr || selectorResult.stdout);

  const artifact = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
  const packageScripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts;
  const selectorRoutes = buildRouteIndex();
  const binding = prepareRepositoryVerificationCatalogBinding({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const currentSelection = binding.bindSelectionReport(buildRecommendation(changedFiles, selectorRoutes, {
    routeAuthority: binding.preparedCatalog.authority,
  }));
  assert.equal(artifact.routeAuthority.length, binding.preparedCatalog.authority.length);
  assert.deepEqual(artifact.routeAuthority, binding.preparedCatalog.authority);
  assert.equal(artifact.catalogDigest, binding.preparedCatalog.catalogDigest);
  assert.deepEqual(artifact.catalogSourceIdentity, binding.preparedCatalog.sourceIdentity);
  assert.deepEqual(
    artifact.catalogSourceIdentity.metadataSourceIdentity,
    VERIFICATION_METADATA_SOURCE_IDENTITY,
  );
  assert.deepEqual(artifact.selectorRootSet, currentSelection.selectorRootSet);
  assert.deepEqual(artifact.gatePolicySignals, currentSelection.gatePolicySignals);
  assert.equal(artifact.gatePolicySignalsDigest, currentSelection.gatePolicySignalsDigest);
  assert.deepEqual(artifact.prCost.schemaIdentity, PR_COST_SCHEMA_IDENTITY);
  assert.equal(artifact.prCost.observationStage, "selector");
  assert.deepEqual(assertPrCostObservation(artifact.prCost), artifact.prCost);
  assert.equal(artifact.prCost.requiredExecutionSetEffect, "unchanged");

  const loaded = readSelectionArtifact(artifactPath, changedFiles, {
    preparedCatalog: binding.preparedCatalog,
    expectedSelectorRootSet: currentSelection.selectorRootSet,
  });
  const plan = buildExecutionPlan(loaded, {
    packageScripts,
    preparedCatalog: binding.preparedCatalog,
  });
  assert.deepEqual(plan.routeGaps, []);
  assert.deepEqual(plan.gatePolicySignals, artifact.gatePolicySignals);
  assert.equal(plan.gatePolicySignalsDigest, artifact.gatePolicySignalsDigest);
  assert.deepEqual(plan.selectorPrCost, artifact.prCost);
  assert.equal(plan.selectorPrCostDigest, artifact.prCost.observationDigest);
  assert.ok(plan.executionGroups.length > 0);
  const runnerCalls = [];
  const results = executeAdaptivePlan(plan, {
    runner(bin, args) {
      runnerCalls.push([bin, ...args]);
      return { status: 0 };
    },
  });
  assert.ok(runnerCalls.length > 0);
  assert.equal(results.length, plan.executionGroups.length);
  assert.ok(results.every((entry) => entry.status === "passed"));

  const assertDriftZeroSpawn = (label, mutate, expectedField = label) => {
    const forgedPath = path.join(tempRoot, `selector-forged-${label}.json`);
    const forged = structuredClone(artifact);
    mutate(forged);
    fs.writeFileSync(forgedPath, JSON.stringify(forged), "utf8");
    let forgedRunnerCalls = 0;
    assert.throws(() => {
      const forgedSelection = readSelectionArtifact(forgedPath, changedFiles, {
        preparedCatalog: binding.preparedCatalog,
        expectedSelectorRootSet: currentSelection.selectorRootSet,
      });
      const forgedPlan = buildExecutionPlan(forgedSelection, {
        packageScripts,
        preparedCatalog: binding.preparedCatalog,
      });
      executeAdaptivePlan(forgedPlan, {
        runner() {
          forgedRunnerCalls += 1;
          return { status: 0 };
        },
      });
    }, new RegExp(`adaptive-selection-catalog-drift:${expectedField}`));
    assert.equal(forgedRunnerCalls, 0);
  };

  assertDriftZeroSpawn("routeAuthority", (forged) => {
    forged.routeAuthority[0].resourceLocks = ["browser-dev-server"];
  });
  assertDriftZeroSpawn("catalogDigest", (forged) => {
    forged.catalogDigest = `${forged.catalogDigest}-forged`;
  });
  assertDriftZeroSpawn("catalogSourceIdentity", (forged) => {
    forged.catalogSourceIdentity.digest = `${forged.catalogSourceIdentity.digest}-forged`;
  });
  assertDriftZeroSpawn("selectorRootSet", (forged) => {
    forged.selectorRootSet = [...forged.selectorRootSet, "forged:root"];
  });
  assertDriftZeroSpawn("gatePolicySignals", (forged) => {
    delete forged.gatePolicySignals;
  });
  assertDriftZeroSpawn("gatePolicySignalsDigest", (forged) => {
    forged.gatePolicySignalsDigest = `${forged.gatePolicySignalsDigest}-forged`;
  });
  assertDriftZeroSpawn("prCost-missing", (forged) => {
    delete forged.prCost;
  }, "prCost.missing");
  assertDriftZeroSpawn("prCost-numeric", (forged) => {
    forged.prCost.selectorMs += 1;
  }, "prCost.observationDigest");
  assertDriftZeroSpawn("prCost-identity", (forged) => {
    forged.prCost.schemaIdentity.digest = "0".repeat(64);
  }, "prCost.schemaIdentity");
  assertDriftZeroSpawn("prCost-digest", (forged) => {
    forged.prCost.observationDigest = "0".repeat(64);
  }, "prCost.observationDigest");
  assertDriftZeroSpawn("prCost-source", (forged) => {
    forged.prCost.sourceBinding.gatePolicySignalsDigest = "forged";
  }, "prCost.sourceBinding");
});

test("adaptive execution owner precedence classifies every mixed owner set", () => {
  assert.equal(classifyExecutionOwners(["child-safe"]), "child-safe");
  assert.equal(classifyExecutionOwners(["child-safe", "main-thread"]), "main-thread");
  assert.equal(classifyExecutionOwners(["child-safe", "ci-only"]), "ci-only");
  assert.equal(classifyExecutionOwners(["main-thread", "ci-only"]), "ci-only");
  assert.equal(classifyExecutionOwners(["child-safe", "main-thread", "ci-only"]), "ci-only");
  assert.equal(classifyExecutionOwners([]), "blocked");
});

test("adaptive execution checkpoints running and terminal results with timings", () => {
  const checkpoints = [];
  const calls = [];
  const results = executeAdaptivePlan({
    routeGaps: [],
    executionCommands: [
      { commandRef: "node first.mjs", process: { bin: "node", args: ["first.mjs"] } },
      { commandRef: "node second.mjs", process: { bin: "node", args: ["second.mjs"] } },
    ],
  }, {
    cwd: process.cwd(),
    now: (() => {
      let tick = 0;
      return () => new Date(tick++ * 25);
    })(),
    runner(bin, args) {
      calls.push([bin, ...args]);
      return { status: calls.length === 1 ? 0 : 7 };
    },
    onCheckpoint(entries) {
      checkpoints.push(structuredClone(entries));
    },
  });
  assert.equal(checkpoints.length, 4);
  assert.equal(checkpoints[0][0].status, "running");
  assert.equal(checkpoints[0][0].processStarted, false);
  assert.equal(checkpoints[1][0].status, "passed");
  assert.equal(checkpoints[1][0].processStarted, true);
  assert.equal(checkpoints[3][1].status, "failed");
  assert.equal(checkpoints[3][1].processStarted, true);
  assert.deepEqual(results.map((entry) => entry.durationMs), [25, 25]);
  assert.deepEqual(results.map((entry) => entry.exitCode), [0, 7]);
});

test("adaptive execution records an interrupted terminal result and stops", () => {
  const checkpoints = [];
  const results = executeAdaptivePlan({
    routeGaps: [],
    executionCommands: [
      { commandRef: "node first.mjs", process: { bin: "node", args: ["first.mjs"] } },
      { commandRef: "node second.mjs", process: { bin: "node", args: ["second.mjs"] } },
    ],
  }, {
    runner() {
      return { status: null, signal: "SIGINT" };
    },
    onCheckpoint(entries) {
      checkpoints.push(structuredClone(entries));
    },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].status, "interrupted");
  assert.equal(results[0].signal, "SIGINT");
  assert.equal(results[0].interrupted, true);
  assert.equal(results[0].exitCode, 1);
  assert.equal(results[0].processStarted, true);
  assert.equal(checkpoints.at(-1)[0].status, "interrupted");
});

test("adaptive pre-spawn ENOENT and interrupted evidence keep processStarted false", () => {
  const missing = Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" });
  const checkpoints = [];
  const results = executeAdaptivePlan({
    routeGaps: [],
    executionCommands: [
      { commandRef: "node missing.mjs", process: { bin: "node", args: ["missing.mjs"] } },
      { commandRef: "node later.mjs", process: { bin: "node", args: ["later.mjs"] } },
    ],
  }, {
    runner() {
      return { status: null, signal: "SIGINT", error: missing };
    },
    onCheckpoint(entries) {
      checkpoints.push(structuredClone(entries));
    },
  });

  assert.equal(results.length, 1);
  assert.equal(results[0].status, "interrupted");
  assert.equal(results[0].processStarted, false);
  assert.equal(checkpoints[0][0].processStarted, false);
  assert.equal(checkpoints.at(-1)[0].processStarted, false);

  const unresolved = executeAdaptivePlan({
    routeGaps: [],
    executionCommands: [{ commandRef: "" }],
  }, {
    runner() {
      throw new Error("unresolved commands must stop before runner invocation");
    },
  });
  assert.equal(unresolved[0].status, "failed");
  assert.equal(unresolved[0].processStarted, false);
});

test("forged complete Pages authority artifact blocks planning and spawning", () => {
  const packageScripts = JSON.parse(fs.readFileSync("package.json", "utf8")).scripts;
  const selectorRoutes = buildRouteIndex();
  const preparedCatalog = prepareRepositoryVerificationCatalog({
    packageScripts,
    verificationRecords: VERIFICATION_DOMAINS,
    selectorRoutes,
    repoRoot: process.cwd(),
    platform: process.platform,
  });
  const current = bindSelectionToPreparedCatalog(
    buildRecommendation([".github/workflows/verify-shared.yml"], selectorRoutes, {
      routeAuthority: preparedCatalog.authority,
    }),
    preparedCatalog,
  );
  const forged = structuredClone(current);
  const commandRef = "verify:pages-dist-and-drift";
  for (const entry of forged.routeAuthority) {
    if (entry.commandRef === commandRef) entry.resourceLocks = [];
  }
  for (const entries of [
    forged.recommendedCommands,
    forged.childAgentStaticTasks,
    forged.mainThreadSerialVerification,
    forged.ciOnlyVerification,
    ...forged.matchedByFile.map((entry) => entry.recommendedCommands),
  ]) {
    for (const entry of entries) {
      if (entry.commandRef === commandRef) entry.resourceLocks = [];
    }
  }
  const plan = buildExecutionPlan(forged, { packageScripts, preparedCatalog });
  assert.ok(plan.routeGaps.some((gap) => gap.code === "adaptive-selection-catalog-drift"));
  assert.deepEqual(plan.executionCommands, []);
  let runnerCount = 0;
  assert.deepEqual(executeAdaptivePlan(plan, {
    runner() {
      runnerCount += 1;
      return { status: 0 };
    },
  }), []);
  assert.equal(runnerCount, 0);
});

test("adaptive execution rejects legacy unstructured commands", () => {
  let spawnCount = 0;
  const legacyResults = executeAdaptivePlan({
    routeGaps: [],
    commandsToRun: ["node legacy.mjs"],
  }, {
    runner() {
      spawnCount += 1;
      return { status: 0 };
    },
  });
  assert.deepEqual(legacyResults, []);
  assert.equal(spawnCount, 0);
});

test("local action and border feedback uses existing behavior leaves without phase evidence", () => {
  const routes = buildRouteIndex();
  for (const file of ["js/core/state/actions/appearance_actions.js", "js/core/state/actions/special_zone_actions.js",
    "js/core/renderer/border_mesh_owner.js", "js/core/renderer/border_draw_owner.js"]) {
    const recommendation = buildAdaptiveEntrypointRecommendation([file], routes, { entrypoint: "edit" });
    const preparedCatalog = prepareRepositoryVerificationCatalog();
    const local = constrainAdaptiveEntrypointSelection(recommendation, "edit", { preparedCatalog });
    assert.deepEqual(local.localEntrypointRouteGaps, [], file);
    const hasBorrowedStorageRoute = file === "js/core/renderer/border_mesh_owner.js";
    assert.equal(local.recommendedCommands.length, hasBorrowedStorageRoute ? 2 : 1, file);
    assert.equal(local.recommendedCommands.some((command) => command.commandRef ===
      "node --test tests/state_owner_borrowed_storage_behavior.test.mjs"), hasBorrowedStorageRoute, file);
    for (const command of local.recommendedCommands) {
      assert.match(command.commandRef, /^node --test tests\/.*_behavior.test.mjs$/);
      assert.equal(command.executionOwner, "child-safe");
      assert.deepEqual(command.resourceLocks, []);
    }
  }
  assert.doesNotThrow(() => assertAdaptiveEntrypointAuthority(parseAdaptiveArgs([
    "--entrypoint", "edit", "--defer-main-thread", "--changed-file", "js/core/state/actions/appearance_actions.js",
  ])));
});
