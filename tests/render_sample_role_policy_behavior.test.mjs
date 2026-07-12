import assert from "node:assert/strict";
import test from "node:test";

import {
  CANONICAL_RENDER_SAMPLE_ROLE_ID,
  RENDER_SAMPLE_ROLE_POLICY_ID,
  analyzeRenderSampleRole,
  summarizeRenderSampleRoleAnalyses,
} from "../tools/perf/render_sample_role_policy.mjs";

function snapshotFor(scenarioId = "tno_1962") {
  return {
    renderPerfMetrics: {
      scenarioChunkPromotionVisualStage: { recordedAt: 200 },
    },
    renderSamples: {
      count: 2,
      medianMs: 700,
      samples: [
        {
          sequence: 1,
          durationMs: 200,
          recordedAt: 100,
          activeScenarioId: scenarioId,
          phase: "idle",
          politicalBgProgressive: false,
          contextScenarioMs: 0,
        },
        {
          sequence: 2,
          durationMs: 1200,
          recordedAt: 300,
          activeScenarioId: scenarioId,
          phase: "idle",
          politicalBgProgressive: true,
          contextScenarioMs: 600,
        },
      ],
    },
  };
}

for (const scenarioId of ["tno_1962", "hoi4_1939"]) {
  test(`accepts the canonical ${scenarioId} post-promotion sample role`, () => {
    const analysis = analyzeRenderSampleRole({ scenarioId, snapshot: snapshotFor(scenarioId) });
    assert.equal(analysis.policyId, RENDER_SAMPLE_ROLE_POLICY_ID);
    assert.equal(analysis.canonicalRoleId, CANONICAL_RENDER_SAMPLE_ROLE_ID);
    assert.equal(analysis.roleMatched, true);
    assert.equal(analysis.canonicalRenderSampleMs, 1200);
    assert.equal(analysis.legacyRenderSampleMedianMs, 700);
    assert.equal(analysis.preScenarioSampleCount, 1);
    assert.equal(analysis.firstRole.role, "blank");
    assert.equal(analysis.scenarioFirstSample.sequence, 2);
  });
}

const invalidCases = [
  ["wrong declared count", (snapshot) => { snapshot.renderSamples.count = 3; }, "declared-sample-count"],
  ["wrong sample array count", (snapshot) => { snapshot.renderSamples.samples.pop(); }, "sample-array-count"],
  ["wrong sequence", (snapshot) => { snapshot.renderSamples.samples[1].sequence = 3; }, "sample-sequence"],
  ["wrong scenario", (snapshot) => { snapshot.renderSamples.samples[1].activeScenarioId = "hoi4_1939"; }, "last-active-scenario"],
  ["wrong phase", (snapshot) => { snapshot.renderSamples.samples[1].phase = "settling"; }, "last-phase-idle"],
  ["missing progressive role", (snapshot) => { snapshot.renderSamples.samples[1].politicalBgProgressive = false; }, "last-political-bg-progressive"],
  ["missing scenario context", (snapshot) => { snapshot.renderSamples.samples[1].contextScenarioMs = 0; }, "last-context-scenario-positive"],
  ["null canonical duration", (snapshot) => { snapshot.renderSamples.samples[1].durationMs = null; }, "last-duration-positive"],
  ["blank canonical duration", (snapshot) => { snapshot.renderSamples.samples[1].durationMs = ""; }, "last-duration-positive"],
  ["boolean canonical duration", (snapshot) => { snapshot.renderSamples.samples[1].durationMs = true; }, "last-duration-positive"],
  ["array canonical duration", (snapshot) => { snapshot.renderSamples.samples[1].durationMs = [1200]; }, "last-duration-positive"],
  ["pre-promotion sample", (snapshot) => { snapshot.renderSamples.samples[1].recordedAt = 199; }, "last-recorded-after-promotion"],
  ["non-unique canonical role", (snapshot) => {
    Object.assign(snapshot.renderSamples.samples[0], {
      recordedAt: 250,
      politicalBgProgressive: true,
      contextScenarioMs: 5,
    });
  }, "canonical-candidate-unique"],
];

for (const [label, mutate, expectedMismatch] of invalidCases) {
  test(`fails closed for ${label}`, () => {
    const snapshot = snapshotFor();
    mutate(snapshot);
    const analysis = analyzeRenderSampleRole({ scenarioId: "tno_1962", snapshot });
    assert.equal(analysis.roleMatched, false);
    assert.equal(analysis.canonicalRenderSampleMs, null);
    assert.ok(analysis.roleMismatches.includes(expectedMismatch));
  });
}

test("classifies scenario-bearing first samples without changing the canonical last sample", () => {
  const snapshot = snapshotFor();
  snapshot.renderSamples.samples[0].contextScenarioMs = 1.5;
  const analysis = analyzeRenderSampleRole({ scenarioId: "tno_1962", snapshot });
  assert.equal(analysis.firstRole.role, "scenario");
  assert.equal(analysis.scenarioFirstSample.sequence, 1);
  assert.equal(analysis.canonicalRenderSampleMs, 1200);
});

test("keeps non-governed scenarios compatible", () => {
  const analysis = analyzeRenderSampleRole({ scenarioId: "blank_base", snapshot: {} });
  assert.equal(analysis.governed, false);
  assert.equal(analysis.roleMatched, true);
  assert.equal(analysis.status, "compatible-non-governed-scenario");
  assert.equal(analysis.canonicalRenderSampleMs, null);
});

test("summarizes canonical and legacy role evidence independently", () => {
  const blankFirst = analyzeRenderSampleRole({ scenarioId: "tno_1962", snapshot: snapshotFor() });
  const scenarioSnapshot = snapshotFor();
  scenarioSnapshot.renderSamples.samples[0].contextScenarioMs = 1;
  const scenarioFirst = analyzeRenderSampleRole({ scenarioId: "tno_1962", snapshot: scenarioSnapshot });
  const summary = summarizeRenderSampleRoleAnalyses([blankFirst, scenarioFirst]);
  assert.equal(summary.matchedRunCount, 2);
  assert.equal(summary.mismatchCount, 0);
  assert.equal(summary.canonicalRenderSampleMs, 1200);
  assert.deepEqual(summary.firstRoleComposition, { blank: 1, scenario: 1 });
});
