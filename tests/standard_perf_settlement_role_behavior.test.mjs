import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { observeStandardPerfPage, readStandardPerfObservation } from "../tools/perf/run_baseline.mjs";
import {
  analyzeRenderSampleRole, summarizeRenderSampleRoleAnalyses,
  SETTLED_STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID as profile,
  WILLIAMS_CROSSOVER_RENDER_SAMPLE_RUN_PROFILE_ID as historicalProfile,
} from "../tools/perf/render_sample_role_policy.mjs";
import { summarizeSnapshot, buildRenderSampleRolePolicyIdentity, collectGovernedRenderSampleRoleMismatches, collectBaselineContractMismatches, inspectStandardPerfSettlement, waitForStandardPerfSettlement, compareAgainstBaseline, resolvePerfGateMetrics } from "../tools/perf/run_baseline.mjs";

const scenarioId = "tno_1962";
test("page probe reuses only module imports while observing fresh live state and complete snapshots", async (t) => {
  let imports = 0;
  let snapshots = 0;
  const state = { activeScenarioId: scenarioId, bootPhase: "loading" };
  let queued = true;
  const loadModule = async (href) => {
    imports++;
    if (href.endsWith("/state.js")) return { state };
    if (href.endsWith("/render_boundary.js")) return { getRenderBoundaryDebugState: () => ({ queued }) };
    return { getRendererAsyncWorkStatus: () => ({ pending: queued }) };
  };
  const context = vm.createContext({ URL, loadModule,
    __mapcreator__: { snapshot: () => ({ loadStatus: { providers: { main_runtime: { chunkRuntime: { queued } } } } }) },
    __mc_perf__: { snapshot: () => ({ sequence: ++snapshots, fullPayload: { queued, bootPhase: state.bootPhase } }) },
  });
  const observe = vm.runInContext(`(${observeStandardPerfPage.toString()})`, context);
  const page = { evaluate: (callback, url) => {
    assert.equal(callback, observeStandardPerfPage);
    return observe(url, loadModule);
  } };
  for (let index = 0; index < 18; index++) {
    queued = index === 0;
    state.bootPhase = queued ? "loading" : "ready";
    const observed = await readStandardPerfObservation(page, "http://localhost/index.html");
    assert.equal(observed.status.bootPhase, state.bootPhase);
    assert.equal(observed.status.renderBoundary.queued, queued);
    assert.equal(observed.status.asyncWork.pending, queued);
    assert.equal(observed.snapshot.fullPayload.queued, queued);
    assert.equal(observed.snapshot.sequence, index + 1);
  }
  assert.equal(imports, 3);
  assert.equal(snapshots, 18);
  const cachedImports = imports;
  for (let index = 0; index < 18; index++) {
    vm.runInContext('delete globalThis[Symbol.for("mapcreator.standard-perf-observation-modules")]', context);
    await readStandardPerfObservation(page, "http://localhost/index.html");
  }
  assert.equal(imports - cachedImports, 54, "uncached module resolution performs three loads per observation");
  assert.equal(snapshots, 36, "both variants collect every complete snapshot");
  t.diagnostic("18-observation deterministic overhead comparison: imports 54 -> 3; evaluations and full live snapshots remain 18. No wall-clock speedup is claimed.");
  const importsBeforeIsolation = imports;
  await readStandardPerfObservation(page, "http://localhost/other/index.html");
  assert.equal(imports, importsBeforeIsolation + 3, "another module root must reload dependencies");
  const nextPage = vm.runInNewContext(`(${observeStandardPerfPage.toString()})`, { URL });
  await nextPage("http://localhost/index.html", loadModule);
  assert.equal(imports, importsBeforeIsolation + 6, "a new document realm must not inherit cached modules");
});

function fixture() {
  const snapshot = {
    renderPerfMetrics: { scenarioChunkPromotionVisualStage: { recordedAt: 100, activeScenarioId: scenarioId, reason: "startup-initial-visual", sequence: 5 } },
    renderSamples: { count: 3, medianMs: 30, samples: [
      { sequence: 1, recordedAt: 200, durationMs: 1000, activeScenarioId: scenarioId, phase: "idle", politicalBgProgressive: true, contextScenarioMs: 100 },
      { sequence: 2, recordedAt: 220, durationMs: 20, activeScenarioId: scenarioId, phase: "idle", politicalBgProgressive: false, contextScenarioMs: 0 },
      { sequence: 3, recordedAt: 260, durationMs: 30, activeScenarioId: scenarioId, phase: "idle", politicalBgProgressive: false, contextScenarioMs: 0 },
    ] },
    standardPerfSettlement: { complete: true, activeScenarioId: scenarioId, observedAt: 1200, sampleCount: 3, lastSampleSequence: 3,
      status: readyStatus(), capabilityMode: "renderer-async-status" },
  };
  bindInitialEvidence(snapshot);
  bindQuietEvidence(snapshot);
  return snapshot;
}
function bindQuietEvidence(snapshot) {
  const completion = snapshot.standardPerfSettlement;
  completion.quiescenceStartedAt = completion.observedAt - 850;
  completion.quiescenceDurationMs = 850;
  completion.quiescenceObservations = Array.from({ length: 18 }, (_, index) => ({
    observedAt: completion.quiescenceStartedAt + index * 50,
    sampleCount: snapshot.renderSamples.count,
    lastSampleSequence: snapshot.renderSamples.samples.at(-1).sequence,
    promotion: structuredClone(snapshot.renderPerfMetrics.scenarioChunkPromotionVisualStage),
    status: structuredClone(completion.status),
  }));
}
function bindInitialEvidence(snapshot) {
  const completion = snapshot.standardPerfSettlement;
  completion.initialPromotion = structuredClone(snapshot.renderPerfMetrics.scenarioChunkPromotionVisualStage);
  const index = snapshot.renderSamples.samples.findIndex((sample) => sample.politicalBgProgressive && sample.contextScenarioMs > 0);
  completion.initialFrameSequence = snapshot.renderSamples.samples[index]?.sequence;
  completion.initialSamplePrefix = structuredClone(snapshot.renderSamples.samples.slice(0, index + 1));
  completion.promotionObservations = [{ observedAt: 150, metric: structuredClone(completion.initialPromotion) }];
}
const analyze = (snapshot) => analyzeRenderSampleRole({ scenarioId, snapshot, runProfileId: profile });

test("settled standard profile charges the unique full frame and every subsequent idle submission", () => {
  const snapshot = fixture();
  const original = structuredClone(snapshot);
  const result = analyze(snapshot);
  assert.equal(result.roleMatched, true);
  assert.equal(result.preScenarioSampleCount, 0);
  assert.equal(result.canonicalSample.sequence, 1);
  assert.equal(result.canonicalCandidateRenderMs, 1000);
  assert.equal(result.subsequentRenderCpuMs, 50);
  assert.equal(result.subsequentRenderCount, 2);
  assert.equal(result.canonicalRenderSampleMs, 1050);
  assert.equal(result.lastRenderCompletedAt, 260);
  assert.equal(result.settlementObservedAt, 1200);
  assert.deepEqual(snapshot, original);
  assert.equal(summarizeSnapshot(snapshot, scenarioId, profile).canonicalRenderSampleMs, 1050);
  const summary = summarizeRenderSampleRoleAnalyses([result], profile);
  assert.equal(summary.canonicalRenderSampleMs, 1050);
  assert.equal(summary.subsequentRenderCpuMs, 50);
});

test("settled standard permits a real single complete frame and retains prior startup samples", () => {
  const snapshot = fixture();
  snapshot.renderSamples.samples = snapshot.renderSamples.samples.slice(0, 1);
  snapshot.renderSamples.count = 1;
  Object.assign(snapshot.standardPerfSettlement, { sampleCount: 1, lastSampleSequence: 1 });
  assert.equal(analyze(snapshot).canonicalRenderSampleMs, 1000);
  snapshot.renderSamples.samples.unshift({ ...snapshot.renderSamples.samples[0], recordedAt: 50, politicalBgProgressive: false, contextScenarioMs: 0, activeScenarioId: "" });
  snapshot.renderSamples.samples.forEach((sample, index) => { sample.sequence = index + 1; });
  snapshot.renderSamples.count = 2;
  Object.assign(snapshot.standardPerfSettlement, { sampleCount: 2, lastSampleSequence: 2 });
  bindInitialEvidence(snapshot);
  assert.equal(analyze(snapshot).preScenarioSampleCount, 1);
  assert.equal(analyze(snapshot).canonicalRenderSampleMs, 1000);
});

for (const [name, mutate] of [
  ["missing completion", (s) => { delete s.standardPerfSettlement; }],
  ["incomplete work", (s) => { s.standardPerfSettlement.complete = false; }],
  ["stale sample count", (s) => { s.standardPerfSettlement.sampleCount = 2; }],
  ["early completion", (s) => { s.standardPerfSettlement.observedAt = 210; }],
  ["wrong scenario tail", (s) => { s.renderSamples.samples[2].activeScenarioId = "hoi4_1939"; }],
  ["interaction tail", (s) => { s.renderSamples.samples[2].phase = "interacting"; }],
  ["ambiguous initial sequence", (s) => { s.renderSamples.samples[2].sequence = 1; }],
  ["replaced initial anchor", (s) => { s.standardPerfSettlement.initialFrameSequence = 3; }],
  ["mutated initial prefix", (s) => { s.renderSamples.samples[0].durationMs = 1; }],
  ["missing candidate", (s) => { s.renderSamples.samples[0].politicalBgProgressive = false; }],
  ["invalid tail duration", (s) => { s.renderSamples.samples[2].durationMs = null; }],
  ["reordered timestamps", (s) => { s.renderSamples.samples[2].recordedAt = 210; }],
]) test(`settled standard fails closed on ${name}`, () => {
  const snapshot = fixture(); mutate(snapshot);
  const result = analyze(snapshot);
  assert.equal(result.roleMatched, false);
  assert.equal(result.canonicalRenderSampleMs, null);
  assert.equal(summarizeSnapshot(snapshot, scenarioId, profile).canonicalRenderSampleMs, null);
  assert.equal(summarizeRenderSampleRoleAnalyses([result], profile).canonicalRenderSampleMs, null);
});

test("historical and Williams roles retain their original last-frame contract", () => {
  const snapshot = fixture();
  for (const runProfileId of [undefined, historicalProfile]) {
    const result = analyzeRenderSampleRole({ scenarioId, snapshot, runProfileId });
    assert.equal(result.policyId, "render-sample-role-v2");
    assert.equal(result.roleMatched, false);
    assert.ok(result.roleMismatches.includes("canonical-candidate-is-last"));
  }
  assert.equal(buildRenderSampleRolePolicyIdentity(profile).policyId, "render-sample-role-v3");
  assert.equal(buildRenderSampleRolePolicyIdentity(historicalProfile).policyId, "render-sample-role-v2");
});

test("later promotion and repeated full frames remain billed behind the frozen initial anchor", async () => {
  const first = fixture();
  delete first.standardPerfSettlement;
  const final = structuredClone(first);
  final.renderPerfMetrics.scenarioChunkPromotionVisualStage = { recordedAt: 215, activeScenarioId: scenarioId, reason: "scenario-hydrate-atlantropa", sequence: 15 };
  Object.assign(final.renderSamples.samples[2], { politicalBgProgressive: true, contextScenarioMs: 5 });
  let reads = 0;
  let time = 0;
  const result = await waitForStandardPerfSettlement(async () => {
    reads += 1;
    return { snapshot: reads === 1 ? first : final,
      status: { ...readyStatus(), bootPhase: reads === 1 ? "loading" : "ready" }, observedAt: 300 + time };
  }, scenarioId, { now: () => time, pause: async (ms) => { time += ms; } });
  assert.equal(result.standardPerfSettlement.promotionObservations.length, 2);
  assert.equal(analyze(result).roleMatched, true);
  assert.equal(analyze(result).canonicalRenderSampleMs, 1050);
  assert.equal(analyze(result).canonicalSample.sequence, 1);
  assert.equal(analyze(result).promotionRecordedAt, 100);
  assert.equal(result.renderPerfMetrics.scenarioChunkPromotionVisualStage.recordedAt, 215);
  const missed = await waitForStandardPerfSettlement(async () => ({ snapshot: final, status: readyStatus(), observedAt: 300 + time }), scenarioId,
    { now: () => time, pause: async (ms) => { time += ms; } });
  assert.equal(analyze(missed).roleMatched, false);
  assert.ok(analyze(missed).roleMismatches.includes("initial-promotion-bound"));
});

test("standard report recomputes all five charged samples and rejects cheap-frame substitution or profile mixing", () => {
  const workload = { runs: 5, renderSampleRunProfileId: profile };
  const runs = Array.from({ length: 5 }, () => {
    const snapshot = fixture();
    return { snapshot, summary: summarizeSnapshot(snapshot, scenarioId, profile), renderSampleRole: analyze(snapshot) };
  });
  const report = {
    schemaVersion: 3, config: { runs: 5 },
    renderSampleRolePolicy: buildRenderSampleRolePolicyIdentity(profile),
    workloadIdentity: { ...workload, scenarios: { [scenarioId]: workload } },
    scenarios: { [scenarioId]: {
      workloadIdentity: workload, runs,
      summary: { canonicalRenderSampleMs: 1050 },
      renderSampleRoleSummary: summarizeRenderSampleRoleAnalyses(runs.map((run) => run.renderSampleRole), profile),
    } },
  };
  assert.deepEqual(collectGovernedRenderSampleRoleMismatches(report, [scenarioId], profile), []);
  const substituted = structuredClone(report);
  substituted.scenarios[scenarioId].summary.canonicalRenderSampleMs = 30;
  assert.ok(collectGovernedRenderSampleRoleMismatches(substituted, [scenarioId], profile).some((message) => message.includes("does not match raw run evidence")));
  const truncated = structuredClone(report);
  truncated.scenarios[scenarioId].runs[0].snapshot.renderSamples.samples.pop();
  assert.ok(collectGovernedRenderSampleRoleMismatches(truncated, [scenarioId], profile).some((message) => message.includes("canonicalRole=")));
  const pending = structuredClone(report);
  pending.scenarios[scenarioId].runs[0].snapshot.standardPerfSettlement.status.asyncWork.geometryPendingCount = 1;
  assert.ok(collectGovernedRenderSampleRoleMismatches(pending, [scenarioId], profile).some((message) => message.includes("settlement=async-renderer")));
  for (const mutate of [
    (settlement) => { settlement.quiescenceDurationMs = 849; },
    (settlement) => { settlement.quiescenceObservations[5].status.hitCanvasBuildScheduled = true; },
    (settlement) => { settlement.quiescenceObservations[5].sampleCount = 2; },
    (settlement) => { settlement.quiescenceObservations[5].promotion.sequence = 999; },
    (settlement) => { settlement.quiescenceObservations = []; },
  ]) {
    const changed = structuredClone(report);
    mutate(changed.scenarios[scenarioId].runs[0].snapshot.standardPerfSettlement);
    assert.ok(collectGovernedRenderSampleRoleMismatches(changed, [scenarioId], profile).some((message) => message.includes("settlement quiescence")));
  }
  assert.ok(collectGovernedRenderSampleRoleMismatches(report, [scenarioId]).some((message) => message.includes("policyId expected=")));
  const old = structuredClone(report);
  old.renderSampleRolePolicy = buildRenderSampleRolePolicyIdentity();
  assert.ok(collectBaselineContractMismatches(report, old).some((message) => message.includes("same measurement contract")));
});

function readyStatus() {
  return {
    activeScenarioId: scenarioId, bootPhase: "ready", renderPhase: "idle", interactionInfrastructureReady: true,
    chunkRuntime: { inFlightByChunkId: {} },
    postReadyScheduler: { pendingTaskKeys: [], waitingTaskKeys: [], activeTaskKey: "" },
    renderBoundary: { requestPending: false, pendingReasons: [] },
    asyncWork: { supported: true, geometryPendingCount: 0, borderScheduled: false, exactPending: false },
    capabilityMode: "renderer-async-status",
  };
}

test("settlement reads live queues including legacy render boundary, required hydration, infrastructure and workers", () => {
  const ready = readyStatus();
  assert.equal(inspectStandardPerfSettlement(ready, scenarioId).complete, true);
  for (const mutate of [
    (s) => { s.chunkRuntime.pendingInfraPromotion = true; },
    (s) => { s.chunkRuntime.inFlightByChunkId = { water: {} }; },
    (s) => { s.postReadyScheduler.pendingTaskKeys.push("post-ready-full-interaction-infra"); },
    (s) => { s.postReadyScheduler.waitingTaskKeys.push("post-ready-scenario-hydration"); },
    (s) => { s.interactionInfrastructureBuildInFlight = true; },
    (s) => { s.hitCanvasBuildScheduled = true; },
    (s) => { s.renderBoundary.requestPending = true; },
    (s) => { s.asyncWork.geometryPendingCount = 1; },
    (s) => { s.asyncWork.borderScheduled = true; },
    (s) => { s.asyncWork.exactPending = true; },
    (s) => { delete s.asyncWork; },
  ]) {
    const status = structuredClone(ready); mutate(status);
    assert.equal(inspectStandardPerfSettlement(status, scenarioId).complete, false);
  }
  const legacy = readyStatus();
  legacy.asyncWork = { supported: false };
  legacy.capabilityMode = "legacy-renderer-without-async-status";
  assert.equal(inspectStandardPerfSettlement(legacy, scenarioId).complete, true);
  legacy.renderBoundary.pendingReasons.push("startup-render");
  assert.equal(inspectStandardPerfSettlement(legacy, scenarioId).complete, false);
});

test("observer waits for real completion and stamps the final atomic snapshot without discarding trailing frames", async () => {
  let time = 0;
  let reads = 0;
  const snapshot = fixture();
  delete snapshot.standardPerfSettlement;
  const result = await waitForStandardPerfSettlement(async () => {
    reads += 1;
    const status = readyStatus();
    status.asyncWork.geometryPendingCount = reads === 1 ? 1 : 0;
    return { status, snapshot, observedAt: 300 + time };
  }, scenarioId, { now: () => time, pause: async (ms) => { time += ms; }, timeoutMs: 1500 });
  assert.equal(reads, 19);
  assert.equal(result.standardPerfSettlement.quiescenceStartedAt, 350);
  assert.equal(result.standardPerfSettlement.quiescenceDurationMs, 850);
  assert.equal(result.standardPerfSettlement.sampleCount, 3);
  assert.equal(analyze(result).canonicalRenderSampleMs, 1050);
  assert.equal(snapshot.standardPerfSettlement, undefined);
  await assert.rejects(waitForStandardPerfSettlement(async () => ({ status: { ...readyStatus(), hitCanvasBuildScheduled: true }, snapshot }), scenarioId,
    { now: () => time, pause: async (ms) => { time += ms; }, timeoutMs: 100 }), /settlement did not complete/);
});

test("v2 gate compares all charged render CPU at the unchanged render threshold", () => {
  assert.equal(resolvePerfGateMetrics(profile).find((metric) => metric.key === "canonicalRenderSampleMs").threshold, 1.25);
  const report = (cpu, startup) => ({ workloadIdentity: { renderSampleRunProfileId: profile }, scenarios: {
    [scenarioId]: { summary: { canonicalRenderSampleMs: cpu, renderSampleMedianMs: 1, totalStartupMs: startup } },
  } });
  const failures = compareAgainstBaseline(report(1260, 116), report(1000, 100), 1.15);
  assert.deepEqual(failures.map((failure) => [failure.metricKey, failure.allowedRatio]), [["totalStartupMs", 1.15], ["canonicalRenderSampleMs", 1.25]]);
});

test("completed full infrastructure proves stale false readiness only while all live queues remain empty", () => {
  const stale = { ...readyStatus(), interactionInfrastructureReady: false };
  assert.equal(inspectStandardPerfSettlement(stale, scenarioId).complete, false);
  stale.postReadyScheduler.taskOutcomes = { "post-ready-full-interaction-infra": { status: "failed" } };
  assert.equal(inspectStandardPerfSettlement(stale, scenarioId).complete, false);
  stale.postReadyScheduler.taskOutcomes["post-ready-full-interaction-infra"].status = "completed";
  assert.equal(inspectStandardPerfSettlement(stale, scenarioId).complete, true);
  assert.equal(stale.interactionInfrastructureReady, false);
  for (const mutate of [
    (s) => { s.interactionInfrastructureBuildInFlight = true; },
    (s) => { s.hitCanvasBuildScheduled = true; },
    (s) => { s.chunkRuntime.pendingPromotion = true; },
    (s) => { s.renderBoundary.requestPending = true; },
    (s) => { s.asyncWork.geometryPendingCount = 1; },
    (s) => { s.postReadyScheduler.pendingTaskKeys = ["post-ready-full-interaction-infra"]; },
  ]) {
    const busy = structuredClone(stale); mutate(busy);
    assert.equal(inspectStandardPerfSettlement(busy, scenarioId).complete, false);
  }
});

test("850ms quiescence restarts on a late frame, promotion and new pending work without losing CPU evidence", async () => {
  let time = 0;
  const snapshot = fixture();
  delete snapshot.standardPerfSettlement;
  const result = await waitForStandardPerfSettlement(async () => {
    const status = readyStatus();
    status.interactionInfrastructureReady = false;
    status.postReadyScheduler.taskOutcomes = { "post-ready-full-interaction-infra": { status: "completed" } };
    if (time === 400) {
      snapshot.renderSamples.samples.push({ ...snapshot.renderSamples.samples.at(-1), sequence: 4, recordedAt: 700, durationMs: 40 });
      snapshot.renderSamples.count = 4;
    }
    if (time === 450) {
      snapshot.renderPerfMetrics.scenarioChunkPromotionVisualStage = { recordedAt: 750, activeScenarioId: scenarioId, reason: "scenario-hydrate-atlantropa", sequence: 6 };
    }
    status.asyncWork.geometryPendingCount = time === 600 ? 1 : 0;
    return { status, snapshot: structuredClone(snapshot), observedAt: 300 + time };
  }, scenarioId, { now: () => time, pause: async (ms) => { time += ms; }, timeoutMs: 2000 });
  assert.equal(time, 1500);
  assert.equal(result.standardPerfSettlement.quiescenceStartedAt, 950);
  assert.equal(result.standardPerfSettlement.quiescenceDurationMs, 850);
  assert.equal(result.standardPerfSettlement.status.interactionInfrastructureReady, false);
  assert.equal(result.standardPerfSettlement.promotionObservations.length, 2);
  assert.equal(result.renderSamples.count, 4);
  assert.equal(analyze(result).canonicalRenderSampleMs, 1090);
});
