import assert from "node:assert/strict";
import test from "node:test";
import { buildExecutionPlan } from "../tools/run_adaptive_tests.mjs";
import { buildRecommendation } from "../tools/select_verification_targets.mjs";
import { buildRouteIndex } from "../tools/test_route_registry.mjs";

const SF_ATS_CHANGED_FILES = [
  "AGENTS.md",
  "docs/testing/sf-ats-overview.md",
  "tools/ai_test_supervisor/domain_registry.json",
  "tools/ai_test_supervisor/check_supervisor_schemas.mjs",
  "tests/supervisor_domain_registry_behavior.test.mjs",
  "tests/supervisor_schema_contracts.test.mjs",
];

const PR_103_TNO_WATER_CHANGED_FILES = [
  "data/scenarios/tno_1962/audit.json",
  "data/scenarios/tno_1962/build_snapshot.json",
  "data/scenarios/tno_1962/chunks/water.coarse.r0c0.json",
  "data/scenarios/tno_1962/chunks/water.detail.r0c0.json",
  "data/scenarios/tno_1962/chunks/water.detail.r0c1.json",
  "data/scenarios/tno_1962/chunks/water.detail.r0c2.json",
  "data/scenarios/tno_1962/chunks/water.detail.r0c3.json",
  "data/scenarios/tno_1962/chunks/water.detail.r1c0.json",
  "data/scenarios/tno_1962/chunks/water.detail.r1c1.json",
  "data/scenarios/tno_1962/chunks/water.detail.r1c2.json",
  "data/scenarios/tno_1962/chunks/water.detail.r1c3.json",
  "data/scenarios/tno_1962/derived/atlantropa_donor_ledger.json",
  "data/scenarios/tno_1962/detail_chunks.manifest.json",
  "data/scenarios/tno_1962/manifest.json",
  "data/scenarios/tno_1962/runtime_meta.json",
  "data/scenarios/tno_1962/runtime_topology.topo.json",
  "data/scenarios/tno_1962/startup.bundle.en.json",
  "data/scenarios/tno_1962/startup.bundle.en.json.gz",
  "data/scenarios/tno_1962/startup.bundle.zh.json",
  "data/scenarios/tno_1962/startup.bundle.zh.json.gz",
  "data/scenarios/tno_1962/water_regions.geojson",
  "tests/supervisor_adaptive_route_behavior.test.mjs",
  "tests/test_tno_bundle_builder.py",
  "tests/test_tno_water_geometries.py",
  "tools/patch_tno_1962_bundle.py",
  "tools/verification/verification_catalog_source.mjs",
];

function recommendationFor(changedFiles) {
  return buildRecommendation(Array.isArray(changedFiles) ? changedFiles : [changedFiles]);
}

function commandRefs(report) {
  return report.recommendedCommands.map((command) => command.commandRef);
}

function routeForCommand(report, commandRef) {
  return report.recommendedCommands.find((command) => command.commandRef === commandRef);
}

test("SF-ATS contract files recommend the supervisor contract gate", () => {
  for (const changedFile of SF_ATS_CHANGED_FILES) {
    const report = recommendationFor(changedFile);

    assert.deepEqual(report.unmatchedChangedFiles, [], `${changedFile} must be matched by the adaptive selector.`);
    assert.ok(
      commandRefs(report).includes("verify:supervisor-contracts"),
      `${changedFile} must recommend verify:supervisor-contracts.`,
    );
  }
});

test("supervisor node tests classify as test-routing/test-infra", () => {
  const report = recommendationFor("tests/supervisor_domain_registry_behavior.test.mjs");
  const supervisorRoute = routeForCommand(report, "verify:supervisor-contracts");
  const supervisorNodeRoute = routeForCommand(report, "test:node:supervisor-contracts");

  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.ok(supervisorRoute, "supervisor test changes must recommend verify:supervisor-contracts.");
  assert.ok(supervisorNodeRoute, "supervisor test changes must recommend the direct supervisor node contract test.");
  assert.deepEqual(supervisorRoute.domains, ["test-routing"]);
  assert.deepEqual(supervisorRoute.ownerHints, ["test-infra"]);
  assert.deepEqual(supervisorNodeRoute.domains, ["test-routing"]);
  assert.deepEqual(supervisorNodeRoute.ownerHints, ["test-infra"]);
  assert.ok(!supervisorNodeRoute.domains.includes("renderer-runtime"));
});

test("explicit SF-ATS route coverage leaves no unmatched files", () => {
  const report = recommendationFor(SF_ATS_CHANGED_FILES);

  assert.deepEqual(report.unmatchedChangedFiles, []);
  for (const changedFile of SF_ATS_CHANGED_FILES) {
    const entry = report.matchedByFile.find((match) => match.changedFile === changedFile);
    assert.ok(entry, `${changedFile} must be present in matchedByFile.`);
    assert.ok(entry.matchedRouteIds.length > 0, `${changedFile} must have at least one matched route.`);
  }
});

test("Appearance Transport change-set modules and focused tests share the child-safe Node route", () => {
  const changedFiles = [
    "js/core/appearance_transport_change_set.js",
    "js/core/appearance_transport_change_set_contract.js",
    "js/core/appearance_transport_operation.js",
    "tests/appearance_transport_change_set_contract_behavior.test.mjs",
    "tests/appearance_transport_operation_behavior.test.mjs",
    "tests/helpers/appearance_transport_change_set_fixtures.mjs",
  ];
  const report = recommendationFor(changedFiles);
  const route = routeForCommand(report, "test:node:appearance-transport-change-set");
  const routeMetadata = buildRouteIndex().find(
    (entry) => entry.commandRef === "test:node:appearance-transport-change-set",
  );

  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.ok(route);
  assert.deepEqual(route.domains, ["transport-workbench"]);
  assert.deepEqual(route.ownerHints, ["transport-workbench"]);
  assert.ok(routeMetadata);
  const directSourceRefs = new Set(routeMetadata.sourceRef.split(","));
  for (const sourceRef of [
    "js/core/appearance_transport_change_set.js",
    "js/core/appearance_transport_change_set_contract.js",
    "js/core/appearance_transport_operation.js",
  ]) {
    assert.ok(directSourceRefs.has(sourceRef), `${sourceRef} must be a direct route sourceRef.`);
  }
  for (const changedFile of changedFiles) {
    assert.ok(
      report.matchedByFile.some((entry) => entry.changedFile === changedFile),
      `${changedFile} must be matched by the adaptive selector.`,
    );
  }
});

test("primary polar water outputs stay on the heavy spherical safety route", () => {
  const changedFiles = [
    "data/europe_topology.json",
    "data/water_regions.geojson",
  ];
  const report = recommendationFor(changedFiles);
  const route = routeForCommand(
    report,
    "python -m pytest tests/test_polar_water_spherical_safety.py -q",
  );

  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.ok(route);
  assert.deepEqual(route.domains, ["geo-contract", "tno-water"]);
  assert.deepEqual(route.ownerHints, ["polar-water-spherical-safety", "tno-water"]);
  assert.deepEqual(route.executionOwners, ["main-thread"]);
  assert.deepEqual(route.resourceLocks, [".runtime-output", "heavy-geo"]);
});

test("TNO bundle patch tool routes to builder, water, and coverage contracts", () => {
  const report = recommendationFor("tools/patch_tno_1962_bundle.py");
  const commands = commandRefs(report);

  assert.deepEqual(report.unmatchedChangedFiles, []);
  for (const commandRef of [
    "python -m unittest tests.test_tno_bundle_builder -q",
    "python -m pytest tests/test_tno_water_geometries.py -q",
    "verify:tno-coverage-chain",
  ]) {
    assert.ok(commands.includes(commandRef), `${commandRef} must cover the TNO bundle patch tool.`);
  }
  assert.ok(!commands.includes("python tools/build_hoi4_scenario.py"));
});

test("PR 103 TNO water change-set has a conflict-free deferred execution plan", () => {
  const report = recommendationFor(PR_103_TNO_WATER_CHANGED_FILES);
  const plan = buildExecutionPlan(report);

  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.deepEqual(plan.routeGaps, []);
  assert.ok(plan.deferredMainThreadSupersededCommands.some((entry) => (
    entry.commandRef === "node tools/e2e_layering.mjs run-spec tests/e2e/tno_named_water_rendering.spec.js"
      && entry.supersededBy === "test:e2e:water-rendering"
  )));
});

test("SF-ATS docs route stays scoped to registry and work package docs", () => {
  const registryReport = recommendationFor("docs/active/_worktree_registry.md");
  const unrelatedActiveDocReport = recommendationFor("docs/active/unrelated-task/context.md");
  const unrelatedTestingDocReport = recommendationFor("docs/testing/unrelated.md");

  assert.deepEqual(registryReport.unmatchedChangedFiles, []);
  assert.ok(commandRefs(registryReport).includes("verify:supervisor-contracts"));
  assert.deepEqual(unrelatedActiveDocReport.recommendedCommands, []);
  assert.deepEqual(unrelatedActiveDocReport.unmatchedChangedFiles, []);
  assert.deepEqual(unrelatedActiveDocReport.unroutedChangedFiles, ["docs/active/unrelated-task/context.md"]);
  assert.equal(unrelatedActiveDocReport.nonBehavioralChangedFiles[0].classification, "task-documentation");
  assert.deepEqual(unrelatedTestingDocReport.recommendedCommands, []);
  assert.deepEqual(unrelatedTestingDocReport.unmatchedChangedFiles, ["docs/testing/unrelated.md"]);
});
