import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { createPrecisionScalingRecords } from "../tools/verification/catalog/records/precision_scaling.mjs";
import { buildExecutionPlan } from "../tools/run_adaptive_tests.mjs";
import { buildRepositoryRecommendation } from "../tools/select_verification_targets.mjs";
import { reconcileVerificationRouteAuthority } from "../tools/test_route_registry.mjs";

test("precision routes append unique executable targets without modifying existing records", () => {
  const existing = Object.freeze([Object.freeze({ id: "old", selectorOrder: 2000 })]);
  const routes = createPrecisionScalingRecords(existing);
  assert.equal(routes.length, 35);
  assert.equal(routes[6].id, "local:precision-scaling:native-browser", "existing selector order is unchanged");
  assert.equal(new Set(routes.map((r) => r.id)).size, routes.length);
  for (const [i, record] of routes.entries()) {
    assert.equal(record.selectorOrder, 2001 + i);
    assert.ok(record.commandRef.length > 0);
    for (const source of record.sourceRefs) assert.ok(fs.existsSync(source), source);
  }
  for (const browser of [routes[6], routes[10], routes[28], routes[34]]) {
  assert.deepEqual(browser.executionOwners, ["main-thread"]);
  assert.ok(browser.resourceLocks.includes("playwright-browser"));
  assert.deepEqual(browser.profiles, ["full"]);
  }
  assert.ok(routes.filter((r) => !r.id.endsWith(":native-browser")).every((r) => r.resourceLocks.length === 0));
});

test("the public authority includes new records after all existing local records", () => {
  const source = fs.readFileSync(new URL("../tools/verification/verification_catalog_source.mjs", import.meta.url), "utf8");
  const closure = fs.readFileSync(new URL("../tools/verification/catalog/source_files.mjs", import.meta.url), "utf8");
  assert.ok(closure.includes("tools/verification/catalog/records/precision_scaling.mjs"));
  assert.match(source, /const existingRecords = \[\.\.\.baseRecords, \.\.\.createLocalFeedbackRecords\(baseRecords\)\]/);
  assert.match(source, /records: \[\.\.\.existingRecords, \.\.\.createPrecisionScalingRecords\(existingRecords\)\]/);
});


test("precision expansion tools route to executable source-specific regressions", () => {
  const routes = createPrecisionScalingRecords([]);
  for (const [source, testFile] of [
    ["tools/adapt_us_county_scenarios.py", "tests/test_us_county_adaptation.py"],
    ["tools/prepare_us_county_adaptation_sidecars.py", "tests/test_us_county_adaptation_sidecars.py"],
    ["tools/stage_us_county_adapted_bundle.py", "tests/test_us_county_adapted_bundle.py"],
    ["tools/scenario_topology_decode.py", "tests/test_scenario_topology_decode.py"],
    ["js/core/project_feature_migration.js", "tests/project_feature_migration_behavior.test.mjs"],
    ["js/core/scenario_hierarchy.js", "tests/scenario_hierarchy_behavior.test.mjs"],
  ]) {
    const route = routes.find((record) => record.sourceRefs.includes(source));
    assert.ok(route?.commandRef.includes(testFile)
      || route?.commandRef.includes(testFile.replace("/", ".").replace(/\.py$/, "")), source);
    assert.deepEqual(route.executionOwners, ["child-safe"]);
    assert.deepEqual(route.profiles, ["pr-fast"]);
  }
});

test("US county lineage metadata selects the scenario migration regression without a route gap", () => {
  const report = buildRepositoryRecommendation(["tools/us_county_legacy_lineage.json"]);
  const plan = buildExecutionPlan(report);

  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.deepEqual(plan.routeGaps, []);
  assert.ok(report.recommendedCommands.some((entry) =>
    entry.commandRef === "python -m unittest tests.test_us_county_scenario -q"));
});

test("precision additions preserve repository-wide command ownership and resource policy", () => {
  assert.doesNotThrow(() => reconcileVerificationRouteAuthority());
});

test("artifact tests append without replacing the existing foundation build command", () => {
  const routes = createPrecisionScalingRecords([]);
  assert.equal(routes.find((record) => record.id === "local:precision-foundation:build").commandRef,
    "python -m unittest tests.test_precision_foundation_build -q");
  assert.equal(routes[32].id, "local:precision-artifact:partition-rehearsal");
  for (const source of ["tools/pages_artifact_partition.py", "tools/pages_artifact_rehearsal.py", "tests/test_pages_artifact_partition.py"]) {
    const report = buildRepositoryRecommendation([source]);
    assert.deepEqual(report.unmatchedChangedFiles, []);
    assert.deepEqual(buildExecutionPlan(report).routeGaps, []);
    assert.ok(report.recommendedCommands.some((entry) => entry.commandRef === "python -m unittest tests.test_pages_artifact_partition -q"));
  }
});
test("LOD graph coverage preserves the original discovered command", () => {
  const routes = createPrecisionScalingRecords([]);
  assert.ok(routes.some(r => r.commandRef === "python -m unittest tests.test_political_display_lods -q"));
  assert.ok(routes.some(r => r.commandRef === "python -m unittest tests.test_precision_build_graph -q"));
});
test("resource accounting has its own executable route and retains the original scheduler command", () => {
  const routes = createPrecisionScalingRecords([]);
  assert.equal(routes[0].commandRef, "node --test tests/precision_scaling_scheduler_behavior.test.mjs");
  assert.equal(routes[31].id, "local:precision-resources:accounting");
  for (const source of ["js/core/runtime_resource_budget.js", "js/core/geometry_raster_worker_client.js", "tests/worker_resource_accounting_behavior.test.mjs"]) {
    const report = buildRepositoryRecommendation([source]);
    assert.deepEqual(report.unmatchedChangedFiles, []);
    assert.deepEqual(buildExecutionPlan(report).routeGaps, []);
    assert.ok(report.recommendedCommands.some((entry) => entry.commandRef === routes[31].commandRef));
  }
});

test("transport lifetime tests and the real-data browser probe have separate execution owners", () => {
  const routes = createPrecisionScalingRecords([]);
  assert.equal(routes[33].id, "local:precision-transport:lifetime");
  assert.equal(routes[34].id, "local:precision-transport:native-browser");
  for (const source of ["js/ui/transport_workbench_line_runtime_shared.js", "js/core/data_service.js", "tests/transport_lifetime_behavior.test.mjs"]) {
    const report = buildRepositoryRecommendation([source]);
    assert.deepEqual(report.unmatchedChangedFiles, []);
    assert.deepEqual(buildExecutionPlan(report).routeGaps, []);
    assert.ok(report.recommendedCommands.some((entry) => entry.commandRef === routes[33].commandRef));
  }
  const probe = buildRepositoryRecommendation(["tools/probe_transport_lifetime.mjs"]);
  assert.deepEqual(probe.unmatchedChangedFiles, []);
  assert.deepEqual(buildExecutionPlan(probe).routeGaps, []);
  assert.ok(probe.recommendedCommands.some((entry) => entry.commandRef === routes[34].commandRef));
  assert.deepEqual(routes[34].executionOwners, ["main-thread"]);
  assert.deepEqual(routes[34].resourceLocks, ["browser-dev-server", "playwright-browser", ".runtime-output"]);
});
