import assert from "node:assert/strict";
import test from "node:test";

import { buildRecommendation } from "../tools/select_verification_targets.mjs";
import { buildRouteIndex } from "../tools/test_route_registry.mjs";
import { VERIFICATION_CATALOG_SOURCE_FILES } from "../tools/verification/catalog/source_files.mjs";
import {
  P4_PHASE_EXPECTED_COMMANDS,
  buildP4StateActionRouteReport,
  defaultP4RouteReportPath,
  isP4OwnedChangedFile,
  parseArgs,
  runP4StateActionRouteCheck,
} from "../tools/check_p4_state_action_routes.mjs";

function createRoute({
  id = "p4:policy",
  commandRef = "verify:p4:state-writer-policy",
  sourceRef = "tools/state_writer_policy.mjs",
  domain = "state-ownership",
} = {}) {
  return {
    id,
    commandRef,
    sourceRef,
    domain,
    ownerHint: "state-ownership",
    layer: "contract",
    cost: "fast",
    resourceLocks: [],
    executionOwner: "child-safe",
    ciProfile: "pr-fast",
  };
}

test("integrated runtime owners receive cumulative P4 admission without losing behavior routes", () => {
  const cases = [
    ["js/core/data_loader.js", "node --test tests/startup_cached_topology_behavior.test.mjs"],
    ["js/core/interaction_funnel.js", "node tools/e2e_layering.mjs run-spec tests/e2e/interaction_funnel_contract.spec.js"],
    ["js/core/legend_manager.js", "node --test tests/legend_color_revision_behavior.test.mjs"],
    ["js/core/project_package_io.js", "test:node:annotation-productization"],
    ["js/core/renderer/city_points_render_owner.js", "test:node:city-points-render-owner"],
    ["js/core/renderer/exact_composite_reuse_owner.js", "node --test tests/exact_composite_reuse_behavior.test.mjs"],
    ["js/core/renderer/legend_control_owner.js", "node --test tests/legend_control_owner_behavior.test.mjs"],
    ["js/core/renderer/river_layer_render_owner.js", "test:node:river-layer-owner"],
    ["js/core/renderer/spatial_index_runtime_owner.js", "node --test tests/spatial_index_runtime_owner_behavior.test.mjs"],
    ["js/core/scenario/bundle_cache.js", "node --test tests/scenario_cache_byte_budget_behavior.test.mjs"],
    ["js/core/scenario/core_value_normalizer.js", "node --test tests/scenario_core_value_normalizer_behavior.test.mjs"],
    ["js/core/scenario/rollback_clone.js", "node --test tests/scenario_cache_efficiency_behavior.test.mjs"],
    ["js/core/scenario/shared.js", "test:node:p4:p4-2a"],
    ["js/core/startup_cache.js", "test:node:p4:p4-1"],
    ["js/core/startup_worker_client.js", "node --test tests/startup_cached_topology_behavior.test.mjs"],
    ["js/workers/startup_boot.worker.js", "node --test tests/startup_cached_topology_behavior.test.mjs"],
  ];
  const changedFiles = cases.map(([file]) => file);
  const routes = buildRouteIndex();
  const recommendation = buildRecommendation(changedFiles, routes);
  const report = buildP4StateActionRouteReport({ phase: "P4.4", changedFiles, recommendation, routes });
  assert.equal(report.verdict, "pass", JSON.stringify(report.routeGaps));
  for (const [file, behaviorCommand] of cases) {
    const entry = recommendation.matchedByFile.find((item) => item.changedFile === file);
    if (behaviorCommand) assert.ok(entry.recommendedCommands.some((item) => item.commandRef === behaviorCommand), file);
  }
});

function createRecommendation({
  changedFile = "tools/state_writer_policy.mjs",
  route = createRoute(),
  unmatchedChangedFiles = [],
  includePerFileRecommendation = true,
} = {}) {
  const recommendedCommands = includePerFileRecommendation
    ? [{
      commandRef: route.commandRef,
      domains: [route.domain],
      ownerHints: [route.ownerHint],
      resourceLocks: [],
      executionOwners: ["child-safe"],
      routeIds: [route.id],
      expandedSpecs: [],
      guidance: {},
    }]
    : [];
  return {
    schemaVersion: 1,
    changedFiles: [changedFile],
    matchedByFile: [{
      changedFile,
      matchedRouteIds: includePerFileRecommendation ? [route.id] : [],
      recommendedCommands,
    }],
    recommendedCommands,
    unmatchedChangedFiles,
  };
}

test("phase command contract covers every exact P4 implementation subphase", () => {
  assert.deepEqual(Object.keys(P4_PHASE_EXPECTED_COMMANDS), [
    "P4.0",
    "P4.1",
    "P4.2a",
    "P4.2b",
    "P4.2c",
    "P4.3",
    "P4.4",
    "P4.5a",
    "P4.5b",
  ]);
  assert.deepEqual(P4_PHASE_EXPECTED_COMMANDS["P4.0"], [
    "verify:p4:state-writer-policy",
  ]);
  assert.deepEqual(P4_PHASE_EXPECTED_COMMANDS["P4.2a"], ["verify:p4:p4-2a"]);
  assert.deepEqual(P4_PHASE_EXPECTED_COMMANDS["P4.2b"], ["verify:p4:p4-2b"]);
  assert.deepEqual(P4_PHASE_EXPECTED_COMMANDS["P4.2c"], ["verify:p4:p4-2c"]);
  assert.deepEqual(P4_PHASE_EXPECTED_COMMANDS["P4.5a"], ["verify:p4:p4-5a"]);
  assert.deepEqual(P4_PHASE_EXPECTED_COMMANDS["P4.5b"], ["verify:p4:p4-5b"]);
});

test("parseArgs accepts adaptive selector changed-file conventions", () => {
  const args = parseArgs([
    "--phase",
    "P4.3",
    "--changed-file",
    "js/core/map_renderer.js",
    "--changed-files",
    "tools/state_writer_policy.mjs, tests/state_writer_policy_behavior.test.mjs",
    "--json-out",
    ".runtime/custom/p4-routes.json",
    "--history-base",
    "P4.2a-checkpoint^",
    "--allow-empty",
  ]);
  assert.equal(args.phase, "P4.3");
  assert.deepEqual(args.changedFiles, [
    "js/core/map_renderer.js",
    "tools/state_writer_policy.mjs",
    "tests/state_writer_policy_behavior.test.mjs",
  ]);
  assert.equal(args.jsonOut, ".runtime/custom/p4-routes.json");
  assert.equal(args.historyBase, "P4.2a-checkpoint^");
  assert.equal(args.allowEmpty, true);
});

test("history discovery can be scoped to one exact phase boundary", () => {
  let discoveryArgs = null;
  const route = createRoute();
  runP4StateActionRouteCheck({
    args: {
      phase: "P4.0",
      changedFiles: [],
      includeBranchHistory: false,
      historyBase: "HEAD^",
      allowEmpty: false,
      jsonOut: ".runtime/report.json",
    },
    changedFileDiscoverer: (args) => {
      discoveryArgs = args;
      return ["tools/state_writer_policy.mjs"];
    },
    routeBuilder: () => [route],
    recommendationBuilder: () => createRecommendation({ route }),
    reportWriter: () => "C:/repo/.runtime/report.json",
  });

  assert.deepEqual(discoveryArgs, {
    includeBranchHistory: false,
    historyBase: "HEAD^",
  });
  assert.throws(
    () => parseArgs([
      "--phase",
      "P4.1",
      "--include-branch-history",
      "--history-base",
      "HEAD^",
    ]),
    /mutually exclusive/,
  );
});

test("default report path is phase scoped", () => {
  assert.equal(
    defaultP4RouteReportPath("P4.4").replaceAll("\\", "/"),
    ".runtime/reports/generated/p4-state-actions/P4.4/adaptive-selection.json",
  );
});

test("P4 ownership includes production JS and explicit P4 policy surfaces", () => {
  assert.equal(isP4OwnedChangedFile("js/core/state/actions/boot_actions.js"), true);
  assert.equal(isP4OwnedChangedFile("tools/check_p4_state_action_routes.mjs"), true);
  assert.equal(isP4OwnedChangedFile("tools/run_p4_phase_verification.mjs"), true);
  assert.equal(
    isP4OwnedChangedFile("tools/verification/verification_catalog_source.mjs"),
    true,
  );
  assert.equal(isP4OwnedChangedFile("tools/state_action_delegation_contract.mjs"), true);
  assert.equal(isP4OwnedChangedFile("tests/p4_state_action_routes_behavior.test.mjs"), true);
  assert.equal(isP4OwnedChangedFile("tests/boot_actions_behavior.test.mjs"), true);
  assert.equal(
    isP4OwnedChangedFile("tests/test_boot_state_actions_boundary_contract.py"),
    true,
  );
  assert.equal(isP4OwnedChangedFile("tests/e2e/test-import-graph.json"), false);
  assert.equal(isP4OwnedChangedFile("tools/check_test_import_graph.mjs"), false);
  assert.equal(isP4OwnedChangedFile("docs/active/state-action-ownership-p4-20260719/plan.md"), true);
  assert.equal(isP4OwnedChangedFile("tools/p4_state_action_phases.mjs"), true);
  assert.equal(isP4OwnedChangedFile("dist/app/js/core/state/actions/boot_actions.js"), false);
  assert.equal(isP4OwnedChangedFile("docs/archive/unrelated.md"), false);
});

test("split catalog modules retain exact P4 ownership and current phase routes", () => {
  const routes = buildRouteIndex();
  const changedFiles = [...VERIFICATION_CATALOG_SOURCE_FILES];
  for (const file of changedFiles) assert.equal(isP4OwnedChangedFile(file), true, file);
  for (const file of [
    "tools/verification/catalog/unregistered.mjs",
    "tools/verification/catalog/source_files.mjs.bak",
    "tools/verification/catalog-other/policies.mjs",
  ]) assert.equal(isP4OwnedChangedFile(file), false, file);
  const report = buildP4StateActionRouteReport({
    phase: "P4.4",
    changedFiles,
    recommendation: buildRecommendation(changedFiles, routes),
    routes,
  });
  assert.equal(report.verdict, "pass");
  assert.deepEqual(report.routeGaps, []);
  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.equal(report.files.length, changedFiles.length);
  for (const file of report.files) {
    assert.deepEqual(file.matchedExpectedPhaseCommands, ["verify:p4:p4-4"]);
    assert.ok(file.directStateOwnershipRecommendations.some(({ commandRef }) => commandRef === "verify:p4:p4-4"));
  }
});

test("direct state-ownership route with the expected phase command passes", () => {
  const route = createRoute();
  const report = buildP4StateActionRouteReport({
    phase: "P4.0",
    changedFiles: ["tools/state_writer_policy.mjs"],
    recommendation: createRecommendation({ route }),
    routes: [route],
  });
  assert.equal(report.verdict, "pass");
  assert.equal(report.summary.routeGapCount, 0);
  assert.equal(report.files[0].directStateOwnershipRecommendations[0].routeId, route.id);
  assert.deepEqual(report.files[0].matchedExpectedPhaseCommands, [
    "verify:p4:state-writer-policy",
  ]);
});

test("historical owner routes stay direct while the selector upgrades execution to the current phase", () => {
  const changedFile = "js/core/state/actions/boot_actions.js";
  const routes = buildRouteIndex();
  const recommendation = buildRecommendation([changedFile], routes);
  const report = buildP4StateActionRouteReport({
    phase: "P4.4",
    changedFiles: [changedFile],
    recommendation,
    routes,
  });

  assert.equal(report.verdict, "pass");
  assert.ok(report.files[0].directStateOwnershipRecommendations.length > 0);
  assert.deepEqual(report.files[0].matchedExpectedPhaseCommands, ["verify:p4:p4-4"]);
  assert.equal(
    report.files[0].directStateOwnershipRecommendations.some((route) => (
      route.commandRef === "verify:p4:p4-4"
    )),
    false,
  );
});

test("P4.4 replay owners expose both leaf contracts and their exact phase route", () => {
  const routes = buildRouteIndex();
  for (const changedFile of [
    "js/core/state/actions/appearance_actions.js",
    "js/core/state/actions/transport_actions.js",
    "js/core/state/actions/strategic_overlay_actions.js",
    "js/core/state/actions/special_zone_actions.js",
  ]) {
    const commandRefs = routes
      .filter(({ sourceRef }) => String(sourceRef).split(",").includes(changedFile))
      .map(({ commandRef }) => commandRef);
    assert.ok(commandRefs.includes("test:node:p4:p4-4"), changedFile);
    assert.ok(commandRefs.includes("test:python:p4:p4-4-boundary"), changedFile);
    assert.ok(commandRefs.includes("verify:p4:p4-4"), changedFile);
  }
});

test("the current selector control plane has zero P4.4 route gaps", () => {
  const changedFiles = [
    "tools/select_verification_targets.mjs",
    "tools/check_p4_state_action_routes.mjs",
    "tools/run_adaptive_tests.mjs",
    "tools/verification/verification_domains.mjs",
    "tests/scenario_transaction_rollback_actions_behavior.test.mjs",
    "tests/verification_metadata_behavior.test.mjs",
    "tests/p4_state_action_routes_behavior.test.mjs",
    "tests/test_e2e_structural_tooling.py",
    "docs/active/state-action-ownership-p4-20260719/context.md",
    "docs/active/state-action-ownership-p4-20260719/task.md",
  ];
  const routes = buildRouteIndex();
  const recommendation = buildRecommendation(changedFiles, routes);
  const report = buildP4StateActionRouteReport({
    phase: "P4.4",
    changedFiles,
    recommendation,
    routes,
  });

  assert.equal(report.verdict, "pass");
  assert.deepEqual(report.routeGaps, []);
  assert.deepEqual(report.unmatchedChangedFiles, []);
});

test("Appearance and Transport milestone coordination stays on the exact P4.4 route", () => {
  const changedFiles = [
    "docs/active/appearance-transport-platformization-milestones-20260812/context.md",
    "docs/active/appearance-transport-platformization-milestones-20260812/plan.md",
    "docs/active/appearance-transport-platformization-milestones-20260812/task.md",
  ];
  const routes = buildRouteIndex();
  const recommendation = buildRecommendation(changedFiles, routes);
  const report = buildP4StateActionRouteReport({
    phase: "P4.4",
    changedFiles,
    recommendation,
    routes,
  });

  assert.equal(report.verdict, "pass");
  assert.deepEqual(report.unmatchedChangedFiles, []);
  for (const matchedFile of recommendation.matchedByFile) {
    assert.ok(matchedFile.matchedRouteIds.includes("p4:p4-4-exact-phase"));
  }
});

test("generic selector-only coverage is rejected for P4-owned files", () => {
  const genericRoute = createRoute({
    id: "infra:verification-selector",
    domain: "test-routing",
  });
  const report = buildP4StateActionRouteReport({
    phase: "P4.0",
    changedFiles: ["tools/state_writer_policy.mjs"],
    recommendation: createRecommendation({ route: genericRoute }),
    routes: [genericRoute],
  });
  assert.equal(report.verdict, "fail");
  assert.deepEqual(
    report.routeGaps.map((gap) => gap.code),
    ["missing-direct-state-ownership-route"],
  );
});

test("a direct route declaration must also be selected for the changed file", () => {
  const route = createRoute();
  const report = buildP4StateActionRouteReport({
    phase: "P4.0",
    changedFiles: ["tools/state_writer_policy.mjs"],
    recommendation: createRecommendation({
      route,
      includePerFileRecommendation: false,
    }),
    routes: [route],
  });
  assert.equal(report.verdict, "fail");
  assert.deepEqual(
    report.routeGaps.map((gap) => gap.code),
    ["direct-route-not-recommended"],
  );
});

test("a direct state-ownership route with only another phase command fails", () => {
  const route = createRoute({
    id: "p4:boot",
    commandRef: "verify:p4:p4-1",
    sourceRef: "js/core/map_renderer.js",
  });
  const report = buildP4StateActionRouteReport({
    phase: "P4.3",
    changedFiles: ["js/core/map_renderer.js"],
    recommendation: createRecommendation({
      changedFile: "js/core/map_renderer.js",
      route,
    }),
    routes: [route],
  });
  assert.equal(report.verdict, "fail");
  assert.deepEqual(
    report.routeGaps.map((gap) => gap.code),
    ["missing-expected-phase-command"],
  );
});

test("the current phase command must remain in the state-ownership domain", () => {
  const changedFile = "js/core/state/actions/boot_actions.js";
  const directRoute = createRoute({
    id: "verify-core:p4:p4-1-boot-actions",
    commandRef: "test:node:p4:p4-1",
    sourceRef: changedFile,
  });
  const currentRoute = createRoute({
    id: "p4:p4-2c-exact-phase",
    commandRef: "verify:p4:p4-2c",
    sourceRef: "docs/active/state-action-ownership-p4-20260719",
  });
  const recommendation = createRecommendation({ changedFile, route: directRoute });
  recommendation.matchedByFile[0].recommendedCommands.push({
    commandRef: currentRoute.commandRef,
    domains: ["test-routing"],
    ownerHints: ["test-infra"],
    resourceLocks: [],
    executionOwners: ["child-safe"],
    routeIds: [currentRoute.id],
    expandedSpecs: [],
    guidance: {},
  });
  const report = buildP4StateActionRouteReport({
    phase: "P4.2c",
    changedFiles: [changedFile],
    recommendation,
    routes: [directRoute, currentRoute],
  });

  assert.equal(report.verdict, "fail");
  assert.deepEqual(report.routeGaps.map((gap) => gap.code), ["missing-expected-phase-command"]);
});

test("selector unmatched files fail even outside the P4-owned path set", () => {
  const changedFile = "docs/archive/unrelated.md";
  const recommendation = createRecommendation({
    changedFile,
    unmatchedChangedFiles: [changedFile],
    includePerFileRecommendation: false,
  });
  const report = buildP4StateActionRouteReport({
    phase: "P4.1",
    changedFiles: [changedFile],
    recommendation,
    routes: [],
  });
  assert.equal(report.verdict, "fail");
  assert.equal(report.summary.unmatchedChangedFileCount, 1);
  assert.deepEqual(report.routeGaps.map((gap) => gap.code), [
    "selector-unmatched-file",
  ]);
});

test("task records and agent config are reported as nonbehavioral, not as executed coverage", () => {
  const changedFiles = [
    "docs/active/editor-kernel-renewal-20260909/plan.md",
    "docs/active/editor-kernel-renewal-20260909/context.md",
    "docs/active/editor-kernel-renewal-20260909/task.md",
    "docs/active/business-efficiency-20260908/editing-analysis.md",
    "docs/active/business-efficiency-20260908/render-reuse-analysis.md",
    ".codex/config.toml",
  ];
  const report = buildP4StateActionRouteReport({
    phase: "P4.4", changedFiles, routes: [],
    recommendation: { unmatchedChangedFiles: changedFiles },
  });
  assert.equal(report.verdict, "pass");
  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.deepEqual(report.selectorUnmatchedChangedFiles, changedFiles);
  assert.equal(report.nonBehavioralChangedFiles.length, changedFiles.length);
  assert.ok(report.nonBehavioralChangedFiles.every((entry) => entry.behaviorTestsRun === false));
  assert.equal(report.nonBehavioralChangedFiles.find((entry) => entry.changedFile === ".codex/config.toml").classification, "agent-tool-config");
  assert.ok(report.files.every((entry) => !entry.selectorMatched));
});

test("nonbehavioral classification never covers adjacent code or unknown documents", () => {
  const changedFiles = [
    "docs/active/editor-kernel-renewal-20260909/task.js",
    "docs/active/editor-kernel-renewal-20260909/unknown.md",
    "docs/archive/task.md",
    "js/core/task.js",
    ".codex/unknown.toml",
  ];
  const report = buildP4StateActionRouteReport({
    phase: "P4.4", changedFiles, routes: [],
    recommendation: { unmatchedChangedFiles: changedFiles },
  });
  assert.equal(report.verdict, "fail");
  assert.deepEqual(report.nonBehavioralChangedFiles, []);
  assert.equal(report.unmatchedChangedFiles.length, changedFiles.length);
  assert.ok(report.routeGaps.some((gap) => gap.changedFile === "js/core/task.js" && gap.code === "missing-direct-state-ownership-route"));
});

test("matched non-P4 support files do not require state-ownership routes", () => {
  const changedFile = "docs/archive/support.md";
  const route = createRoute({
    id: "docs:support",
    commandRef: "verify:docs",
    sourceRef: changedFile,
    domain: "docs",
  });
  const report = buildP4StateActionRouteReport({
    phase: "P4.1",
    changedFiles: [changedFile],
    recommendation: createRecommendation({ changedFile, route }),
    routes: [route],
  });
  assert.equal(report.verdict, "pass");
  assert.equal(report.summary.p4OwnedChangedFileCount, 0);
});

test("empty changed-file sets fail closed unless explicitly allowed", () => {
  const failReport = buildP4StateActionRouteReport({
    phase: "P4.0",
    changedFiles: [],
    recommendation: {
      changedFiles: [],
      matchedByFile: [],
      recommendedCommands: [],
      unmatchedChangedFiles: [],
    },
    routes: [],
  });
  assert.equal(failReport.verdict, "fail");
  assert.deepEqual(failReport.routeGaps.map((gap) => gap.code), [
    "no-changed-files",
  ]);

  const allowedReport = buildP4StateActionRouteReport({
    phase: "P4.0",
    changedFiles: [],
    recommendation: {
      changedFiles: [],
      matchedByFile: [],
      recommendedCommands: [],
      unmatchedChangedFiles: [],
    },
    routes: [],
    allowEmpty: true,
  });
  assert.equal(allowedReport.verdict, "pass");
});

test("runner writes the phase report and returns gate exit status", () => {
  const route = createRoute();
  let written = null;
  const result = runP4StateActionRouteCheck({
    args: {
      phase: "P4.0",
      changedFiles: ["tools/state_writer_policy.mjs"],
      includeBranchHistory: false,
      historyBase: "",
      allowEmpty: false,
      jsonOut: ".runtime/report.json",
    },
    routeBuilder: () => [route],
    recommendationBuilder: () => createRecommendation({ route }),
    reportWriter: (report, outputPath) => {
      written = { report, outputPath };
      return "C:/repo/.runtime/report.json";
    },
  });
  assert.equal(result.exitCode, 0);
  assert.equal(result.report.reportPath, "C:/repo/.runtime/report.json");
  assert.equal(written.outputPath, ".runtime/report.json");
  assert.equal(written.report.verdict, "pass");
});

test("unsupported and missing phases fail closed", () => {
  assert.throws(() => parseArgs(["--changed-file", "package.json"]), /exact phase/);
  assert.throws(() => parseArgs(["--phase", "P4.2"]), /Unsupported P4 phase/);
  assert.throws(() => parseArgs(["--phase", "P4.6"]), /Unsupported P4 phase/);
});
