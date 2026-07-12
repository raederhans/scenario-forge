import assert from "node:assert/strict";
import test from "node:test";

import {
  buildGovernedCompanionReport,
  buildMarkdown,
  buildRawPerformanceMetricIntegrity,
  evaluateGovernedDecision,
} from "../tools/perf/analyze_render_sample_roles.mjs";

test("governed companion reproduces the canonical role medians from frozen raw evidence", async () => {
  const report = await buildGovernedCompanionReport();
  assert.equal(report.evidence.rawFileCount, 40);
  assert.equal(report.evidence.roleMatches, 40);
  assert.deepEqual(report.evidence.roleMismatches, []);
  assert.equal(report.canonicalMetric.comparisons.tno_1962.a.median, 1197.9000000059605);
  assert.equal(report.canonicalMetric.comparisons.tno_1962.b.median, 1195.3499999940395);
  assert.equal(report.canonicalMetric.comparisons.hoi4_1939.a.median, 694.5500000119209);
  assert.equal(report.canonicalMetric.comparisons.hoi4_1939.b.median, 694.8000000119209);
  assert.deepEqual(report.legacyMetric.tnoFirstRoleComposition, {
    A: { blank: 6, scenario: 4 },
    B: { blank: 3, scenario: 7 },
  });
  assert.equal(report.hoi4PromotionGap.status, "not-applicable/pass");
  assert.equal(report.sourceReport.legacyDecision.status, "failed/blocked");
  assert.equal(report.decision.status, "accepted-with-governed-reanalysis");
  assert.equal(report.decision.admitted, true);
});

test("governed decision fails closed when any identity or role check fails", () => {
  const decision = evaluateGovernedDecision([
    { id: "identity", status: "pass" },
    { id: "render_sample_roles", status: "fail" },
  ]);
  assert.equal(decision.status, "blocked-rerun-required");
  assert.equal(decision.admitted, false);
  assert.deepEqual(decision.failedChecks, ["render_sample_roles"]);
});

test("raw metric integrity fails closed for missing or non-positive values", () => {
  const records = [
    { block: "A1", scenarioId: "tno_1962", runNumber: 1, totalStartupMs: 100, canonicalRenderSampleMs: 20 },
    { block: "A1", scenarioId: "hoi4_1939", runNumber: 1, totalStartupMs: null, canonicalRenderSampleMs: 30 },
    { block: "B1", scenarioId: "tno_1962", runNumber: 1, totalStartupMs: 200, canonicalRenderSampleMs: 0 },
  ];
  const integrity = buildRawPerformanceMetricIntegrity(records);
  assert.equal(integrity.pass, false);
  assert.deepEqual(integrity.invalidRecords.map((entry) => entry.metric), [
    "totalStartupMs",
    "canonicalRenderSampleMs",
  ]);
});

test("blocked reports render missing comparison metrics without crashing", () => {
  const comparison = {
    a: { median: null },
    b: { median: 12 },
    deltaMs: null,
    deltaPercent: null,
    status: "blocked-rerun-required",
  };
  const markdown = buildMarkdown({
    decision: { status: "blocked-rerun-required", admitted: false },
    policy: { policyId: "policy", canonicalRoleId: "role" },
    sourceReport: { sha256: "0".repeat(64), legacyDecision: { status: "failed/blocked" } },
    evidence: { rawFileCount: 40, roleMatches: 39, roleMismatches: [{}] },
    canonicalMetric: { comparisons: { tno_1962: comparison, hoi4_1939: comparison } },
    legacyMetric: { tnoFirstRoleComposition: { A: { blank: 1, scenario: 0 }, B: { blank: 1, scenario: 0 } } },
    checks: [{ id: "raw_performance_metrics_complete", status: "fail" }],
  });
  assert.match(markdown, /A=missing ms/);
  assert.match(markdown, /delta=missing ms \(missing%\)/);
});

test("companion report fails closed when the frozen source report identity changes", async () => {
  const report = await buildGovernedCompanionReport({ expectedSourceSha256: "0".repeat(64) });
  assert.equal(report.decision.status, "blocked-rerun-required");
  assert.equal(report.decision.admitted, false);
  assert.ok(report.decision.failedChecks.includes("source_report_sha"));
});
