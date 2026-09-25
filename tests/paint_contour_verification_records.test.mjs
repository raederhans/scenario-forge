import test from "node:test";
import assert from "node:assert/strict";
import { createOwnershipRetirementRecords } from "../tools/verification/catalog/records/ownership_retirement.mjs";
import { buildRepositoryRecommendation } from "../tools/select_verification_targets.mjs";
import { buildExecutionPlan } from "../tools/run_adaptive_tests.mjs";

const auditCommand = "node tools/audit_paint_contours.mjs";

test("paint contour audit is executable and never silently treated as documentation", () => {
  const report = buildRepositoryRecommendation(["tools/audit_paint_contours.mjs"]);
  assert.deepEqual(report.unmatchedChangedFiles, []);
  const command = report.recommendedCommands.find(entry => entry.commandRef === auditCommand);
  assert.ok(command, "select the actual real-data audit, not just a substitute unit suite");
  assert.equal(command.executionOwner, "main-thread");
  assert.equal(command.cost, "heavy");
  assert.deepEqual([...command.resourceLocks].sort(), [".runtime-output", "heavy-geo", "scenario-data"]);
  const plan = buildExecutionPlan(report);
  assert.deepEqual(plan.routeGaps, []);
  assert.ok(plan.mainThreadCommands.includes(auditCommand));
  assert.ok(!plan.childSafeCommands.includes(auditCommand));
});

test("contour runtime changes retain fast regressions and the independent geometry audit", () => {
  for (const source of ["js/core/renderer/paint_contour_graph.js", "js/core/renderer/paint_contour_mesh.js", "js/core/paint_contour_source.js"]) {
    const report = buildRepositoryRecommendation([source]);
    assert.deepEqual(report.unmatchedChangedFiles, [], source);
    assert.ok(report.recommendedCommands.some(entry => entry.commandRef === "test:node:ownership-retirement"), source);
    assert.ok(report.recommendedCommands.some(entry => entry.commandRef === auditCommand), source);
    assert.deepEqual(buildExecutionPlan(report).routeGaps, [], source);
  }
});

test("new audit and routing records append without modifying existing product ownership", () => {
  const existing = Object.freeze([Object.freeze({ id: "prior", selectorOrder: 9000 })]);
  const records = createOwnershipRetirementRecords(existing);
  assert.deepEqual(records.slice(0, 2).map(entry => [entry.id, entry.selectorOrder]), [
    ["node:test:node:ownership-retirement", 9001],
    ["e2e:tests/e2e/ownership_retirement.spec.js", 9002],
  ]);
  assert.deepEqual(records[0].executionOwners, ["child-safe"]);
  assert.deepEqual(records[0].resourceLocks, []);
  assert.deepEqual(records[1].executionOwners, ["main-thread"]);
  assert.ok(records[1].resourceLocks.includes("playwright-browser"));
  assert.equal(new Set(records.map(entry => entry.id)).size, records.length);
  assert.deepEqual(records.map(entry => entry.selectorOrder), [9001, 9002, 9003, 9004]);
  const report = buildRepositoryRecommendation(["tests/paint_contour_verification_records.test.mjs"]);
  assert.deepEqual(report.unmatchedChangedFiles, []);
  assert.ok(report.recommendedCommands.some(entry => entry.commandRef === "node --test tests/paint_contour_verification_records.test.mjs"));
  assert.deepEqual(buildExecutionPlan(report).routeGaps, []);
});
