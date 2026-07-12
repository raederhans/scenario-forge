import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  WILLIAMS_ADJACENT_PAIRS,
  WILLIAMS_BLOCK_SEQUENCE,
  WILLIAMS_DRIFT_PAIRS,
  WILLIAMS_EXIT_CODES,
  WILLIAMS_SCENARIOS,
  analyzeWilliamsCrossoverEvidence,
  buildWilliamsPreregistration,
} from "../tools/perf/williams_crossover_policy.mjs";
import {
  analyzeWilliamsCrossoverRawRoot,
  buildCurrentHarnessArtifacts,
  buildWilliamsExecutionPlan,
  buildWilliamsRawManifest,
  deriveWilliamsQuietWindow,
  getWilliamsErrorExitCode,
  parseWilliamsArgs,
  requireWilliamsJobRunnerReady,
  resolveServerMetadataProbeTarget,
  runWilliamsCli,
  validateMeasurementSnapshot,
  validateWilliamsOutputPolicy,
  WilliamsInvalidExperimentError,
} from "../tools/perf/run_williams_crossover.mjs";

const CONTROL_HEAD = "a".repeat(40);
const CANDIDATE_HEAD = "b".repeat(40);
const CONTROL_WORKTREE = "C:\\perf\\control";
const CANDIDATE_WORKTREE = "C:\\perf\\candidate";
const JOB_RUNNER_EVIDENCE_PATH = "tooling/windows-job-runner.exe";
const JOB_RUNNER_FIXTURE_BYTES = Buffer.from("MZ-SCENARIO-FORGE-WILLIAMS-JOB-RUNNER-FIXTURE", "utf8");
const HASH = "c".repeat(64);
const URL_QUERY = Object.freeze({
  render_profile: "balanced",
  startup_interaction: "full",
  startup_worker: 1,
  startup_cache: 0,
  perf: 1,
});

function canonicalSnapshot(scenarioId, durationMs) {
  return {
    renderPerfMetrics: {
      scenarioChunkPromotionVisualStage: { recordedAt: 200 },
    },
    renderSamples: {
      count: 2,
      medianMs: durationMs,
      samples: [
        {
          sequence: 1,
          durationMs: Math.max(1, durationMs - 20),
          recordedAt: 100,
          activeScenarioId: "blank_base",
          phase: "idle",
          politicalBgProgressive: false,
          contextScenarioMs: 0,
        },
        {
          sequence: 2,
          durationMs,
          recordedAt: 300,
          activeScenarioId: scenarioId,
          phase: "idle",
          politicalBgProgressive: true,
          contextScenarioMs: 10,
        },
      ],
    },
  };
}

function telemetryWindow(phase, blockOrdinal, cwd, gitHead) {
  const baseMs = Date.UTC(2026, 6, 11, 0, 0, (blockOrdinal - 1) * 20 + (phase === "post" ? 10 : 0));
  return {
    schemaVersion: 1,
    phase,
    capability: { status: "available", missing: [] },
    samples: Array.from({ length: 5 }, (_, index) => ({
      at: new Date(baseMs + index * 1000).toISOString(),
      cpuUtilizationPercent: 10 + index,
      processorPerformancePercent: 100,
      percentOfMaximumFrequency: 95,
      processorFrequencyMHz: 4200,
      performanceAdjustedFrequencyMHz: 4200,
      memoryCommittedPercent: 50,
      memoryAvailableMBytes: 16000,
    })),
    environment: {
      power: {
        activeSchemeGuid: "00000000-0000-0000-0000-000000000000",
        activeSchemeName: "Balanced",
        acLineStatus: 1,
        batteryFlag: 128,
      },
      ports: { "8000": [], "8892": [] },
      processes: [],
      server: [],
      browser: [],
      cwd,
      probe: [
        { url: "http://127.0.0.1:8000/app/", responded: false, ok: false, status: null },
        { url: "http://127.0.0.1:8892/app/", responded: false, ok: false, status: null },
      ],
      gitStatus: "",
      gitHead,
      detached: true,
    },
  };
}

function artifactDescriptor(relativePath = "artifact") {
  return { path: relativePath, gitBlob: "d".repeat(40), lfNormalizedSha256: HASH };
}

function jobRunnerBinaryDescriptor() {
  return {
    path: JOB_RUNNER_EVIDENCE_PATH,
    sha256: crypto.createHash("sha256").update(JOB_RUNNER_FIXTURE_BYTES).digest("hex"),
    bytes: JOB_RUNNER_FIXTURE_BYTES.length,
  };
}

function jobObjectEvidence(rootPid = 4242, {
  command = { bin: process.execPath, args: ["--version"] },
  cwd = "C:\\perf\\runner",
} = {}) {
  return {
    schemaVersion: 1,
    protocolId: "SF_WILLIAMS_JOB_V1",
    provider: "windows-job-object",
    status: "complete",
    rootPid,
    rootExitCode: 0,
    timedOut: false,
    createSuspended: true,
    createNoWindow: true,
    assignedBeforeResume: true,
    rootInJobBeforeResume: true,
    killOnJobClose: true,
    breakawayAllowed: false,
    suspendedRootTerminatedOnAssignFailure: false,
    jobCloseSucceeded: true,
    terminateJobSucceeded: false,
    rootTerminationConfirmed: true,
    jobProcessIdsAtRootExit: [rootPid],
    remainingPids: [],
    unverifiedPids: [],
    cleanupValid: true,
    commandExecutablePath: command.bin,
    commandWorkingDirectory: cwd,
    commandArguments: [...command.args],
    error: null,
  };
}

function jobRunnerPreparation(source = artifactDescriptor("tools/perf/williams_crossover_windows_job_runner.cs")) {
  const capabilityCommand = {
    bin: process.execPath,
    args: ["-e", "process.stdout.write('williams-job-runner-ready')"],
    cwd: "C:\\perf\\runner",
  };
  return {
    schemaVersion: 1,
    status: "available",
    error: null,
    compiledAt: "2026-07-10T23:59:00.000Z",
    capabilityProbedAt: "2026-07-10T23:59:30.000Z",
    source: structuredClone(source),
    binary: jobRunnerBinaryDescriptor(),
    capabilityCommand,
    capabilityEvidence: jobObjectEvidence(3999, {
      command: capabilityCommand,
      cwd: capabilityCommand.cwd,
    }),
  };
}

function workloadIdentity(scenarioId) {
  return {
    scenarioId,
    manifestPath: `data/scenarios/${scenarioId}/manifest.json`,
    manifestSha256: scenarioId === "tno_1962" ? "1".repeat(64) : "2".repeat(64),
    featureCount: scenarioId === "tno_1962" ? 1000 : 2000,
    sampleRole: "gate",
    baseUrl: "http://127.0.0.1:8892",
    runs: 2,
    warmups: 1,
    urlQuery: { ...URL_QUERY },
  };
}

function createEvidence({ startupByBlock = {}, renderByBlock = {} } = {}) {
  const preregistration = buildWilliamsPreregistration({
    controlHead: CONTROL_HEAD,
    candidateHead: CANDIDATE_HEAD,
    controlWorktree: CONTROL_WORKTREE,
    candidateWorktree: CANDIDATE_WORKTREE,
    generatedAt: "2026-07-11T00:00:00.000Z",
    jobRunnerSource: artifactDescriptor("tools/perf/williams_crossover_windows_job_runner.cs"),
    jobRunnerBinary: jobRunnerBinaryDescriptor(),
  });
  const blocks = WILLIAMS_BLOCK_SEQUENCE.map((block) => {
    const expectedHead = block.side === "A" ? CONTROL_HEAD : CANDIDATE_HEAD;
    const cwd = block.side === "A" ? CONTROL_WORKTREE : CANDIDATE_WORKTREE;
    const baselineScenarios = {};
    const rawRuns = {};
    for (const scenarioId of WILLIAMS_SCENARIOS) {
      const startup = startupByBlock[block.ordinal]?.[scenarioId] ?? 3000;
      const render = renderByBlock[block.ordinal]?.[scenarioId] ?? 1000;
      rawRuns[scenarioId] = [0, 1].map((offset) => ({
        activeScenarioId: scenarioId,
        snapshot: canonicalSnapshot(scenarioId, render + offset),
        summary: {
          totalStartupMs: startup + offset,
          canonicalRenderSampleMs: render + offset,
        },
      }));
      baselineScenarios[scenarioId] = {
        sampleRole: "gate",
        featureCount: workloadIdentity(scenarioId).featureCount,
        workloadIdentity: workloadIdentity(scenarioId),
        runs: rawRuns[scenarioId],
        summary: { canonicalRenderSampleMs: render + 0.5 },
        renderSampleRoleSummary: {
          policyId: "render-sample-role-v1",
          canonicalRoleId: "last-post-promotion-idle-scenario-frame-v1",
          governedRunCount: 2,
          matchedRunCount: 2,
          mismatchCount: 0,
          canonicalRenderSampleMs: render + 0.5,
        },
      };
    }
    const command = {
      bin: process.execPath,
      args: ["tools/perf/run_baseline.mjs", "--mode", "baseline", "--scenarios", block.scenarioOrder.join(",")],
    };
    return {
      ordinal: block.ordinal,
      id: block.id,
      side: block.side,
      orderId: block.orderId,
      scenarioOrder: [...block.scenarioOrder],
      identity: {
        side: block.side,
        expectedHead,
        actualHead: expectedHead,
        detached: true,
        gitStatus: "",
        cwd,
        artifacts: {
          packageLock: artifactDescriptor("package-lock.json"),
          runner: artifactDescriptor("tools/perf/run_baseline.mjs"),
          rolePolicy: artifactDescriptor("tools/perf/render_sample_role_policy.mjs"),
          analyzer: artifactDescriptor("tools/perf/run_williams_crossover.mjs"),
          policy: artifactDescriptor("tools/perf/williams_crossover_policy.mjs"),
          windowsRuntime: artifactDescriptor("tools/perf/williams_crossover_windows_runtime.mjs"),
          jobRunnerSource: artifactDescriptor("tools/perf/williams_crossover_windows_job_runner.cs"),
          jobRunnerBinary: jobRunnerBinaryDescriptor(),
        },
      },
      telemetry: {
        pre: telemetryWindow("pre", block.ordinal, cwd, expectedHead),
        post: telemetryWindow("post", block.ordinal, cwd, expectedHead),
      },
      cleanup: {
        valid: true,
        processTreeCaptureStatus: "available",
        terminationSucceeded: true,
        terminationResults: [],
        taskOwnedPidsRemaining: [],
        taskOwnedProcessesRemaining: [],
        newBrowserPids: [],
        portsClear: true,
        serverProbesClear: true,
        gitStatusStable: true,
        gitHeadStable: true,
        detachedStable: true,
        jobObject: jobObjectEvidence(4000 + block.ordinal, { command, cwd }),
      },
      jobObject: jobObjectEvidence(4000 + block.ordinal, { command, cwd }),
      command,
      quietWindow: { status: "valid", valid: true },
      blockResult: { status: "complete", exitCode: 0 },
      baseline: {
        schemaVersion: 2,
        benchmarkMetricsSchemaVersion: "3.3",
        probeSchema: "mc_perf_snapshot",
        mode: "baseline",
        gitHead: expectedHead,
        config: { warmups: 1, runs: 2, scenarios: [...block.scenarioOrder], threshold: 1.15, urlQuery: { ...URL_QUERY } },
        renderSampleRolePolicy: {
          policyId: "render-sample-role-v1",
          canonicalRoleId: "last-post-promotion-idle-scenario-frame-v1",
        },
        workloadIdentity: {
          scenarioIds: [...block.scenarioOrder],
          runs: 2,
          warmups: 1,
          urlQuery: { ...URL_QUERY },
          baseUrl: "http://127.0.0.1:8892",
          scenarios: Object.fromEntries(WILLIAMS_SCENARIOS.map((scenarioId) => [scenarioId, workloadIdentity(scenarioId)])),
        },
        scenarios: baselineScenarios,
      },
      rawRuns,
    };
  });
  return {
    preregistration,
    jobRunnerPreparation: jobRunnerPreparation(preregistration.workloadContract.processContainment.identity.source),
    blocks,
    manifestValidation: { status: "valid", errors: [], measuredRawFileCount: 32 },
  };
}

function setMetricValues(table, ordinals, value) {
  for (const ordinal of ordinals) {
    table[ordinal] = Object.fromEntries(WILLIAMS_SCENARIOS.map((scenarioId) => [scenarioId, value]));
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function materializeEvidenceRoot(evidence) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "williams-crossover-"));
  const currentToolIdentity = await buildCurrentHarnessArtifacts();
  currentToolIdentity.jobRunnerBinary = jobRunnerBinaryDescriptor();
  evidence.preregistration.workloadContract.processContainment.identity = {
    source: currentToolIdentity.jobRunnerSource,
    binary: currentToolIdentity.jobRunnerBinary,
  };
  for (const block of evidence.blocks) {
    block.identity.artifacts.analyzer = currentToolIdentity.analyzer;
    block.identity.artifacts.policy = currentToolIdentity.policy;
    block.identity.artifacts.windowsRuntime = currentToolIdentity.windowsRuntime;
    block.identity.artifacts.jobRunnerSource = currentToolIdentity.jobRunnerSource;
    block.identity.artifacts.jobRunnerBinary = currentToolIdentity.jobRunnerBinary;
  }
  await writeJson(path.join(root, "preregistration.json"), evidence.preregistration);
  const preparation = jobRunnerPreparation(currentToolIdentity.jobRunnerSource);
  preparation.binary = currentToolIdentity.jobRunnerBinary;
  evidence.jobRunnerPreparation = preparation;
  await writeJson(path.join(root, "harness", "job-runner-preparation.json"), preparation);
  await fs.mkdir(path.join(root, "tooling"), { recursive: true });
  await fs.writeFile(path.join(root, JOB_RUNNER_EVIDENCE_PATH), JOB_RUNNER_FIXTURE_BYTES);
  for (const block of evidence.blocks) {
    const directory = path.join(root, "blocks", block.id);
    await writeJson(path.join(directory, "block-metadata.json"), {
      ordinal: block.ordinal,
      id: block.id,
      side: block.side,
      orderId: block.orderId,
      scenarioOrder: block.scenarioOrder,
    });
    await writeJson(path.join(directory, "identity.json"), block.identity);
    await writeJson(path.join(directory, "telemetry-pre.json"), block.telemetry.pre);
    await writeJson(path.join(directory, "telemetry-post.json"), block.telemetry.post);
    await writeJson(path.join(directory, "quiet-window.json"), block.quietWindow);
    await writeJson(path.join(directory, "command.json"), block.command);
    await writeJson(path.join(directory, "baseline.json"), block.baseline);
    await writeJson(path.join(directory, "cleanup.json"), block.cleanup);
    await writeJson(path.join(directory, "block-result.json"), block.blockResult);
    await writeJson(path.join(directory, "job-object.json"), block.jobObject);
    for (const scenarioId of WILLIAMS_SCENARIOS) {
      for (let index = 0; index < block.rawRuns[scenarioId].length; index += 1) {
        await writeJson(
          path.join(directory, "raw", scenarioId, `run-${String(index + 1).padStart(2, "0")}.json`),
          block.rawRuns[scenarioId][index],
        );
      }
    }
  }
  await buildWilliamsRawManifest(root, currentToolIdentity);
  return root;
}

test("Williams sequence, adjacent B-A pairs, and same-side drift pairs are frozen", () => {
  assert.deepEqual(
    WILLIAMS_BLOCK_SEQUENCE.map(({ ordinal, side, orderId, scenarioOrder }) => ({ ordinal, side, orderId, scenarioOrder })),
    [
      { ordinal: 1, side: "A", orderId: "TH", scenarioOrder: ["tno_1962", "hoi4_1939"] },
      { ordinal: 2, side: "B", orderId: "TH", scenarioOrder: ["tno_1962", "hoi4_1939"] },
      { ordinal: 3, side: "B", orderId: "HT", scenarioOrder: ["hoi4_1939", "tno_1962"] },
      { ordinal: 4, side: "A", orderId: "HT", scenarioOrder: ["hoi4_1939", "tno_1962"] },
      { ordinal: 5, side: "B", orderId: "TH", scenarioOrder: ["tno_1962", "hoi4_1939"] },
      { ordinal: 6, side: "A", orderId: "TH", scenarioOrder: ["tno_1962", "hoi4_1939"] },
      { ordinal: 7, side: "A", orderId: "HT", scenarioOrder: ["hoi4_1939", "tno_1962"] },
      { ordinal: 8, side: "B", orderId: "HT", scenarioOrder: ["hoi4_1939", "tno_1962"] },
    ],
  );
  assert.deepEqual(WILLIAMS_ADJACENT_PAIRS, [
    { id: "pair-01-02", controlOrdinal: 1, candidateOrdinal: 2 },
    { id: "pair-03-04", controlOrdinal: 4, candidateOrdinal: 3 },
    { id: "pair-05-06", controlOrdinal: 6, candidateOrdinal: 5 },
    { id: "pair-07-08", controlOrdinal: 7, candidateOrdinal: 8 },
  ]);
  assert.deepEqual(WILLIAMS_DRIFT_PAIRS.map(({ id, firstOrdinal, secondOrdinal }) => ({ id, firstOrdinal, secondOrdinal })), [
    { id: "A-TH-1-6", firstOrdinal: 1, secondOrdinal: 6 },
    { id: "A-HT-4-7", firstOrdinal: 4, secondOrdinal: 7 },
    { id: "B-TH-2-5", firstOrdinal: 2, secondOrdinal: 5 },
    { id: "B-HT-3-8", firstOrdinal: 3, secondOrdinal: 8 },
  ]);
});

test("accepted experiment uses four B-A pair deltas and keeps pooled medians diagnostic", () => {
  const report = analyzeWilliamsCrossoverEvidence(createEvidence());
  assert.equal(report.decision.status, "accepted");
  assert.equal(report.decision.exitCode, WILLIAMS_EXIT_CODES.accepted);
  assert.equal(report.primary.tno_1962.startup.pairCount, 4);
  assert.equal(report.primary.tno_1962.startup.deltaMs, 0);
  assert.equal(report.legacyPooledMedian.tno_1962.startup.admissionRole, "diagnostic-only");
});

test("one practical pair regression is diagnostic when the primary stays green", () => {
  const startupByBlock = {};
  setMetricValues(startupByBlock, [1, 4], 3000);
  setMetricValues(startupByBlock, [2, 5, 6], 3100);
  setMetricValues(startupByBlock, [3, 7, 8], 3000);
  const report = analyzeWilliamsCrossoverEvidence(createEvidence({ startupByBlock }));
  assert.equal(report.primary.tno_1962.startup.practicalRegressionCount, 1);
  assert.equal(report.primary.tno_1962.startup.pairPolicyStatus, "diagnostic-one-of-four");
  assert.equal(report.decision.status, "accepted");
});

test("two practical pair regressions invalidate the experiment", () => {
  const startupByBlock = {};
  setMetricValues(startupByBlock, [1, 4, 6, 7], 3000);
  setMetricValues(startupByBlock, [2, 3, 5, 8], 3100);
  const report = analyzeWilliamsCrossoverEvidence(createEvidence({ startupByBlock }));
  assert.equal(report.primary.hoi4_1939.startup.practicalRegressionCount, 4);
  assert.equal(report.decision.status, "valid-regression");

  setMetricValues(startupByBlock, [3, 4, 7, 8], 3000);
  const twoPairReport = analyzeWilliamsCrossoverEvidence(createEvidence({ startupByBlock }));
  assert.equal(twoPairReport.primary.tno_1962.startup.practicalRegressionCount, 2);
  assert.equal(twoPairReport.decision.status, "invalid-experiment");
  assert.ok(twoPairReport.decision.invalidReasons.includes("primary.tno_1962.startup.two-of-four-regressions"));
});

test("three or four practical pair regressions produce a valid regression exit", () => {
  const renderByBlock = {};
  setMetricValues(renderByBlock, [1, 4, 6, 7], 1000);
  setMetricValues(renderByBlock, [2, 3, 5, 8], 1060);
  const report = analyzeWilliamsCrossoverEvidence(createEvidence({ renderByBlock }));
  assert.equal(report.primary.tno_1962.canonicalRender.practicalRegressionCount, 4);
  assert.equal(report.decision.status, "valid-regression");
  assert.equal(report.decision.exitCode, WILLIAMS_EXIT_CODES.validRegression);
});

test("opposite practical directions trigger the symmetric direction veto", () => {
  const startupByBlock = {};
  setMetricValues(startupByBlock, [1], 3000);
  setMetricValues(startupByBlock, [2, 5, 6], 3100);
  setMetricValues(startupByBlock, [3, 7, 8], 2900);
  setMetricValues(startupByBlock, [4], 3000);
  const report = analyzeWilliamsCrossoverEvidence(createEvidence({ startupByBlock }));
  assert.equal(report.decision.status, "invalid-experiment");
  assert.ok(report.directionVetoes.some((entry) => entry.scenarioId === "tno_1962" && entry.metric === "startup"));
});

test("missing telemetry capability fails closed without converting null to zero", () => {
  const evidence = createEvidence();
  evidence.blocks[0].telemetry.pre.capability = { status: "required-capability-missing", missing: ["Processor Performance"] };
  evidence.blocks[0].telemetry.pre.samples[0].processorPerformancePercent = null;
  const report = analyzeWilliamsCrossoverEvidence(evidence);
  assert.equal(report.decision.status, "invalid-experiment");
  assert.ok(report.decision.invalidReasons.includes("block-01.telemetry.pre.capability.required-capability-missing"));
  assert.ok(report.decision.invalidReasons.includes("block-01.telemetry.pre.samples.0.processorPerformancePercent"));
  assert.equal(report.decision.exitCode, WILLIAMS_EXIT_CODES.invalidExperiment);
});

test("missing telemetry summary returns a typed invalid experiment", () => {
  const evidence = createEvidence();
  evidence.blocks[0].telemetry.post = null;
  let report;
  assert.doesNotThrow(() => {
    report = analyzeWilliamsCrossoverEvidence(evidence);
  });
  assert.equal(report.decision.status, "invalid-experiment");
  assert.equal(report.decision.exitCode, WILLIAMS_EXIT_CODES.invalidExperiment);
  assert.ok(report.decision.invalidReasons.includes("block-01.telemetry.post.missing"));
});

test("telemetry admission enforces phase, ordering, CPU, frequency, memory, and power regimes", () => {
  const cases = [
    {
      reason: "block-01.telemetry.pre.phase",
      mutate: (evidence) => { evidence.blocks[0].telemetry.pre.phase = "post"; },
    },
    {
      reason: "block-01.telemetry.pre.samples.timestamp-order",
      mutate: (evidence) => { evidence.blocks[0].telemetry.pre.samples[1].at = evidence.blocks[0].telemetry.pre.samples[0].at; },
    },
    {
      reason: "block-01.telemetry.pre.samples.interval",
      mutate: (evidence) => {
        const first = Date.parse(evidence.blocks[0].telemetry.pre.samples[0].at);
        evidence.blocks[0].telemetry.pre.samples[1].at = new Date(first + 100).toISOString();
      },
    },
    {
      reason: "block-01.telemetry.pre.samples.0.performanceAdjustedFrequencyMHz.formula",
      mutate: (evidence) => { evidence.blocks[0].telemetry.pre.samples[0].performanceAdjustedFrequencyMHz = 4100; },
    },
    {
      reason: "block-01.telemetry.pre.capability.missing",
      mutate: (evidence) => { evidence.blocks[0].telemetry.pre.capability.missing = ["counter"]; },
    },
    {
      reason: "block-01.telemetry.pre.cpu-average",
      mutate: (evidence) => evidence.blocks[0].telemetry.pre.samples.forEach((sample) => { sample.cpuUtilizationPercent = 30; }),
    },
    {
      reason: "telemetry.pair-01-02.pre-cpu-difference",
      mutate: (evidence) => evidence.blocks[1].telemetry.pre.samples.forEach((sample) => { sample.cpuUtilizationPercent = 24; }),
    },
    {
      reason: "telemetry.pair-01-02.pre-frequency-difference",
      mutate: (evidence) => evidence.blocks[1].telemetry.pre.samples.forEach((sample) => { sample.performanceAdjustedFrequencyMHz = 3900; }),
    },
    {
      reason: "telemetry.global.pre-frequency-drift",
      mutate: (evidence) => evidence.blocks[7].telemetry.pre.samples.forEach((sample) => { sample.performanceAdjustedFrequencyMHz = 3600; }),
    },
    {
      reason: "telemetry.pair-01-02.pre-memory-difference",
      mutate: (evidence) => evidence.blocks[1].telemetry.pre.samples.forEach((sample) => { sample.memoryAvailableMBytes = 14000; }),
    },
    {
      reason: "block-01.telemetry.memory-within-block",
      mutate: (evidence) => evidence.blocks[0].telemetry.post.samples.forEach((sample) => { sample.memoryAvailableMBytes = 14000; }),
    },
    {
      reason: "telemetry.environment.powerSchemeGuid.consistency",
      mutate: (evidence) => { evidence.blocks[2].telemetry.pre.environment.power.activeSchemeGuid = "11111111-1111-1111-1111-111111111111"; },
    },
    {
      reason: "telemetry.environment.acLineStatus.consistency",
      mutate: (evidence) => { evidence.blocks[2].telemetry.pre.environment.power.acLineStatus = 0; },
    },
  ];
  for (const testCase of cases) {
    const evidence = createEvidence();
    testCase.mutate(evidence);
    const report = analyzeWilliamsCrossoverEvidence(evidence);
    assert.equal(report.decision.exitCode, WILLIAMS_EXIT_CODES.invalidExperiment, testCase.reason);
    assert.ok(report.decision.invalidReasons.includes(testCase.reason), testCase.reason);
  }
});

test("dirty or attached measurement worktrees invalidate identity", () => {
  const evidence = createEvidence();
  evidence.blocks[2].identity.detached = false;
  evidence.blocks[2].identity.gitStatus = " M tracked-file";
  const report = analyzeWilliamsCrossoverEvidence(evidence);
  assert.equal(report.decision.status, "invalid-experiment");
  assert.ok(report.decision.invalidReasons.includes("block-03.identity.detached"));
  assert.ok(report.decision.invalidReasons.includes("block-03.identity.gitStatus"));
});

test("missing preregistration remains a typed invalid experiment report", () => {
  const evidence = createEvidence();
  evidence.preregistration = null;
  const report = analyzeWilliamsCrossoverEvidence(evidence);
  assert.equal(report.decision.exitCode, WILLIAMS_EXIT_CODES.invalidExperiment);
  assert.ok(report.decision.invalidReasons.includes("preregistration.policyId"));
  assert.ok(report.decision.invalidReasons.includes("preregistration.control.head"));
});

test("preregistration drift in thresholds or pair topology invalidates the report", () => {
  const evidence = createEvidence();
  evidence.preregistration.thresholds.startup.percent = 4;
  evidence.preregistration.adjacentPairs[1].candidateOrdinal = 4;
  const report = analyzeWilliamsCrossoverEvidence(evidence);
  assert.equal(report.decision.status, "invalid-experiment");
  assert.ok(report.decision.invalidReasons.includes("preregistration.thresholds"));
  assert.ok(report.decision.invalidReasons.includes("preregistration.adjacentPairs"));
});

test("every preregistered admission surface is exact and field drift is invalid", () => {
  const cases = [
    ["generatedAt", (_value, preregistration) => { preregistration.generatedAt = "invalid"; }],
    ["scenarios", (value) => value.reverse()],
    ["primaryEstimator", (_value, preregistration) => { preregistration.primaryEstimator = "mean"; }],
    ["blockEstimator", (_value, preregistration) => { preregistration.blockEstimator = "mean"; }],
    ["pairRegressionPolicy", (value) => { value.oneOfFour = "accepted"; }],
    ["sequence", (value) => { value[0].side = "B"; }],
    ["adjacentPairs", (value) => { value[0].delta = "A-B"; }],
    ["driftPairs", (value) => { value[0].secondOrdinal = 7; }],
    ["thresholds", (value) => { value.telemetry.preBlockAverageCpuPercentMax = 26; }],
    ["telemetry", (value) => { value.preSamplesPerBlock = 4; }],
    ["workloadContract", (value) => { value.bindAcrossSidesAndBlocks = false; }],
    ["rawContract", (value) => { value.manifestEntrySet = "subset"; }],
    ["exitCodes", (value) => { value.invalidExperiment = 1; }],
  ];
  for (const [field, mutate] of cases) {
    const evidence = createEvidence();
    mutate(evidence.preregistration[field], evidence.preregistration);
    const report = analyzeWilliamsCrossoverEvidence(evidence);
    assert.equal(report.decision.exitCode, WILLIAMS_EXIT_CODES.invalidExperiment, field);
    assert.ok(report.decision.invalidReasons.some((reason) => reason.startsWith(`preregistration.${field}`)), field);
  }
});

test("recomputed canonical role is authoritative and raw summary mismatch is invalid", () => {
  const evidence = createEvidence();
  evidence.blocks[0].rawRuns.tno_1962[0].summary.canonicalRenderSampleMs = 1;
  const report = analyzeWilliamsCrossoverEvidence(evidence);
  assert.equal(report.decision.exitCode, WILLIAMS_EXIT_CODES.invalidExperiment);
  assert.ok(report.decision.invalidReasons.includes("block-01.tno_1962.run-1.canonicalRenderSummaryMismatch"));
  assert.equal(report.blocks[0].scenarios.tno_1962.canonicalRender.values[0], 1000);
});

test("workload identity binds manifest, feature count, sample role, runs, warmups, and URL query across blocks", () => {
  const mutations = [
    ["manifestSha256", "3".repeat(64)],
    ["featureCount", 9999],
    ["sampleRole", "observation"],
    ["runs", 3],
    ["warmups", 2],
  ];
  for (const [field, value] of mutations) {
    const evidence = createEvidence();
    evidence.blocks[4].baseline.workloadIdentity.scenarios.tno_1962[field] = value;
    evidence.blocks[4].baseline.scenarios.tno_1962.workloadIdentity[field] = value;
    const report = analyzeWilliamsCrossoverEvidence(evidence);
    assert.equal(report.decision.exitCode, WILLIAMS_EXIT_CODES.invalidExperiment, field);
    assert.ok(report.decision.invalidReasons.some((reason) => reason.includes(`workloadIdentity.tno_1962`)), field);
  }
  const queryEvidence = createEvidence();
  queryEvidence.blocks[4].baseline.workloadIdentity.urlQuery.perf = "0";
  const queryReport = analyzeWilliamsCrossoverEvidence(queryEvidence);
  assert.equal(queryReport.decision.exitCode, WILLIAMS_EXIT_CODES.invalidExperiment);
  assert.ok(queryReport.decision.invalidReasons.includes("block-05.baseline.workloadIdentity.urlQuery"));

  const globalQueryEvidence = createEvidence();
  for (const block of globalQueryEvidence.blocks) {
    block.baseline.config.urlQuery.perf = 0;
    block.baseline.workloadIdentity.urlQuery.perf = 0;
    for (const scenarioId of WILLIAMS_SCENARIOS) {
      block.baseline.workloadIdentity.scenarios[scenarioId].urlQuery.perf = 0;
      block.baseline.scenarios[scenarioId].workloadIdentity.urlQuery.perf = 0;
    }
  }
  const globalQueryReport = analyzeWilliamsCrossoverEvidence(globalQueryEvidence);
  assert.ok(globalQueryReport.decision.invalidReasons.includes("block-01.baseline.config.urlQuery.canonical"));

  const globalManifestEvidence = createEvidence();
  for (const block of globalManifestEvidence.blocks) {
    block.baseline.workloadIdentity.scenarios.tno_1962.manifestPath = "wrong/manifest.json";
    block.baseline.scenarios.tno_1962.workloadIdentity.manifestPath = "wrong/manifest.json";
  }
  const globalManifestReport = analyzeWilliamsCrossoverEvidence(globalManifestEvidence);
  assert.ok(globalManifestReport.decision.invalidReasons.includes("block-01.baseline.workloadIdentity.tno_1962.manifestPath"));

  const nestedMismatchEvidence = createEvidence();
  nestedMismatchEvidence.blocks[0].baseline.scenarios.tno_1962.workloadIdentity.featureCount = 1234;
  const nestedMismatchReport = analyzeWilliamsCrossoverEvidence(nestedMismatchEvidence);
  assert.ok(nestedMismatchReport.decision.invalidReasons.includes("block-01.baseline.workloadIdentity.tno_1962.reportScenarioMismatch"));
});

test("CLI defaults to list and the plan keeps live execution explicit", () => {
  const options = parseWilliamsArgs([]);
  assert.equal(options.mode, "list");
  const plan = buildWilliamsExecutionPlan({
    ...options,
    controlHead: CONTROL_HEAD,
    candidateHead: CANDIDATE_HEAD,
    controlWorktree: CONTROL_WORKTREE,
    candidateWorktree: CANDIDATE_WORKTREE,
  });
  assert.equal(plan.blocks.length, 8);
  assert.deepEqual(plan.blocks[2].command.args.slice(0, 9), [
    "tools/perf/run_baseline.mjs",
    "--mode", "baseline",
    "--scenarios", "hoi4_1939,tno_1962",
    "--runs", "2",
    "--warmups", "1",
  ]);
});

test("raw analyzer rebuilds an accepted report from exactly 32 measured files", async (t) => {
  const root = await materializeEvidenceRoot(createEvidence());
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const report = await analyzeWilliamsCrossoverRawRoot(root);
  assert.equal(report.manifestValidation.status, "valid");
  assert.equal(report.manifestValidation.measuredRawFileCount, 32);
  assert.equal(report.decision.status, "accepted");
});

test("raw analyzer requires the executed Job runner binary and recomputes its descriptor", async (t) => {
  const missingRoot = await materializeEvidenceRoot(createEvidence());
  const tamperedRoot = await materializeEvidenceRoot(createEvidence());
  t.after(() => Promise.all([missingRoot, tamperedRoot].map((root) => fs.rm(root, { recursive: true, force: true }))));

  await fs.rm(path.join(missingRoot, JOB_RUNNER_EVIDENCE_PATH));
  await fs.rm(path.join(missingRoot, "raw-sha256-manifest.json"));
  const missingIdentity = await buildCurrentHarnessArtifacts();
  missingIdentity.jobRunnerBinary = jobRunnerBinaryDescriptor();
  await buildWilliamsRawManifest(missingRoot, missingIdentity);
  const missingReport = await analyzeWilliamsCrossoverRawRoot(missingRoot);
  assert.ok(missingReport.manifestValidation.errors.includes(`manifest.missing-entry:${JOB_RUNNER_EVIDENCE_PATH}`));

  await fs.writeFile(path.join(tamperedRoot, JOB_RUNNER_EVIDENCE_PATH), Buffer.from("MZ-tampered", "utf8"));
  await fs.rm(path.join(tamperedRoot, "raw-sha256-manifest.json"));
  const tamperedIdentity = await buildCurrentHarnessArtifacts();
  tamperedIdentity.jobRunnerBinary = jobRunnerBinaryDescriptor();
  await buildWilliamsRawManifest(tamperedRoot, tamperedIdentity);
  const tamperedReport = await analyzeWilliamsCrossoverRawRoot(tamperedRoot);
  assert.ok(tamperedReport.manifestValidation.errors.includes("manifest.toolIdentity.jobRunnerBinary.evidence.sha256"));
});

test("raw analyzer consumes preparation and canonical per-block Job evidence", async (t) => {
  const preparationRoot = await materializeEvidenceRoot(createEvidence());
  const jobRoot = await materializeEvidenceRoot(createEvidence());
  t.after(() => Promise.all([preparationRoot, jobRoot].map((root) => fs.rm(root, { recursive: true, force: true }))));

  const preparationPath = path.join(preparationRoot, "harness", "job-runner-preparation.json");
  const preparation = JSON.parse(await fs.readFile(preparationPath, "utf8"));
  preparation.status = "capability-error";
  await writeJson(preparationPath, preparation);
  await fs.rm(path.join(preparationRoot, "raw-sha256-manifest.json"));
  const preparationIdentity = await buildCurrentHarnessArtifacts();
  preparationIdentity.jobRunnerBinary = jobRunnerBinaryDescriptor();
  await buildWilliamsRawManifest(preparationRoot, preparationIdentity);
  const preparationReport = await analyzeWilliamsCrossoverRawRoot(preparationRoot);
  assert.ok(preparationReport.decision.invalidReasons.includes("job-runner-preparation.status"));

  const jobPath = path.join(jobRoot, "blocks", "block-01", "job-object.json");
  const jobObject = JSON.parse(await fs.readFile(jobPath, "utf8"));
  jobObject.rootExitCode = 17;
  await writeJson(jobPath, jobObject);
  await fs.rm(path.join(jobRoot, "raw-sha256-manifest.json"));
  const jobIdentity = await buildCurrentHarnessArtifacts();
  jobIdentity.jobRunnerBinary = jobRunnerBinaryDescriptor();
  await buildWilliamsRawManifest(jobRoot, jobIdentity);
  const jobReport = await analyzeWilliamsCrossoverRawRoot(jobRoot);
  assert.ok(jobReport.decision.invalidReasons.includes("block-01.jobObject.cleanup-canonical"));
  assert.ok(jobReport.decision.invalidReasons.includes("block-01.jobObject.rootExitCode"));
});

test("raw analyzer rejects both extra and missing measured files", async (t) => {
  const extraRoot = await materializeEvidenceRoot(createEvidence());
  const missingRoot = await materializeEvidenceRoot(createEvidence());
  t.after(() => Promise.all([
    fs.rm(extraRoot, { recursive: true, force: true }),
    fs.rm(missingRoot, { recursive: true, force: true }),
  ]));
  await writeJson(
    path.join(extraRoot, "blocks", "block-01", "raw", "tno_1962", "run-03.json"),
    { unexpected: true },
  );
  await fs.rm(path.join(missingRoot, "blocks", "block-08", "raw", "hoi4_1939", "run-02.json"));
  const extraReport = await analyzeWilliamsCrossoverRawRoot(extraRoot);
  const missingReport = await analyzeWilliamsCrossoverRawRoot(missingRoot);
  assert.equal(extraReport.decision.status, "invalid-experiment");
  assert.ok(extraReport.manifestValidation.errors.some((error) => error.includes("raw.extra:")));
  assert.equal(missingReport.decision.status, "invalid-experiment");
  assert.ok(missingReport.manifestValidation.errors.some((error) => error.includes("raw.missing:")));
});

test("raw manifest rejects extra metadata, tampering, and current tool identity mismatch", async (t) => {
  const extraRoot = await materializeEvidenceRoot(createEvidence());
  const tamperRoot = await materializeEvidenceRoot(createEvidence());
  const toolRoot = await materializeEvidenceRoot(createEvidence());
  t.after(() => Promise.all([extraRoot, tamperRoot, toolRoot].map((root) => fs.rm(root, { recursive: true, force: true }))));

  const extraManifestPath = path.join(extraRoot, "raw-sha256-manifest.json");
  const extraManifest = JSON.parse(await fs.readFile(extraManifestPath, "utf8"));
  extraManifest.files.push({ path: "blocks/block-01/unregistered.json", bytes: 2, sha256: HASH });
  await writeJson(extraManifestPath, extraManifest);
  const extraReport = await analyzeWilliamsCrossoverRawRoot(extraRoot);
  assert.ok(extraReport.manifestValidation.errors.includes("manifest.extra-entry:blocks/block-01/unregistered.json"));

  await writeJson(path.join(tamperRoot, "blocks", "block-01", "block-metadata.json"), { tampered: true });
  const tamperReport = await analyzeWilliamsCrossoverRawRoot(tamperRoot);
  assert.ok(tamperReport.manifestValidation.errors.includes("manifest.sha256:blocks/block-01/block-metadata.json"));

  const toolManifestPath = path.join(toolRoot, "raw-sha256-manifest.json");
  const toolManifest = JSON.parse(await fs.readFile(toolManifestPath, "utf8"));
  toolManifest.toolIdentity.policy.lfNormalizedSha256 = "f".repeat(64);
  await writeJson(toolManifestPath, toolManifest);
  const toolReport = await analyzeWilliamsCrossoverRawRoot(toolRoot);
  assert.ok(toolReport.manifestValidation.errors.includes("manifest.toolIdentity.policy.current"));
  assert.equal(toolReport.decision.exitCode, WILLIAMS_EXIT_CODES.invalidExperiment);
});

test("Windows Job cleanup evidence fails admission closed for any unverified process", () => {
  const evidence = createEvidence();
  evidence.blocks[0].cleanup.valid = false;
  evidence.blocks[0].cleanup.jobObject.cleanupValid = false;
  evidence.blocks[0].cleanup.jobObject.unverifiedPids = [9999];
  const report = analyzeWilliamsCrossoverEvidence(evidence);
  assert.equal(report.decision.exitCode, WILLIAMS_EXIT_CODES.invalidExperiment);
  assert.ok(report.decision.invalidReasons.includes("block-01.cleanup.jobObject.cleanupValid"));
  assert.ok(report.decision.invalidReasons.includes("block-01.cleanup.jobObject.unverifiedPids"));
});

test("external browser churn is an environment invalidator instead of a task cleanup failure", () => {
  const evidence = createEvidence();
  evidence.blocks[0].cleanup.valid = true;
  evidence.blocks[0].cleanup.environmentStable = false;
  evidence.blocks[0].cleanup.newBrowserPids = [99504, 106292];
  evidence.blocks[0].blockResult.environmentStable = false;
  const report = analyzeWilliamsCrossoverEvidence(evidence);
  assert.equal(report.decision.exitCode, WILLIAMS_EXIT_CODES.invalidExperiment);
  assert.ok(report.decision.invalidReasons.includes("block-01.environment.browserStable"));
  assert.ok(!report.decision.invalidReasons.includes("block-01.cleanup.newBrowserPids"));
  assert.ok(!report.decision.invalidReasons.includes("block-01.cleanup.valid"));
});

test("Job runner preparation fails closed on schema, timestamp, identity, and capability drift", () => {
  const cases = [
    ["job-runner-preparation.schemaVersion", (evidence) => { evidence.jobRunnerPreparation.schemaVersion = 0; }],
    ["job-runner-preparation.compiledAt", (evidence) => { evidence.jobRunnerPreparation.compiledAt = "invalid"; }],
    ["job-runner-preparation.timestamp-order", (evidence) => {
      evidence.jobRunnerPreparation.compiledAt = "2026-07-11T00:00:00.000Z";
      evidence.jobRunnerPreparation.capabilityProbedAt = "2026-07-10T23:59:30.000Z";
    }],
    ["job-runner-preparation.source", (evidence) => {
      evidence.jobRunnerPreparation.source.lfNormalizedSha256 = "f".repeat(64);
    }],
    ["job-runner-preparation.binary", (evidence) => {
      evidence.jobRunnerPreparation.binary.bytes += 1;
    }],
    ["job-runner-preparation.capabilityEvidence.schemaVersion", (evidence) => {
      evidence.jobRunnerPreparation.capabilityEvidence.schemaVersion = 0;
    }],
  ];
  for (const [reason, mutate] of cases) {
    const evidence = createEvidence();
    mutate(evidence);
    const report = analyzeWilliamsCrossoverEvidence(evidence);
    assert.ok(report.decision.invalidReasons.includes(reason), reason);
  }
});

test("canonical block Job evidence validates schema, root exit, and command identity", () => {
  const cases = [
    ["schemaVersion", 0],
    ["rootExitCode", 17],
    ["commandExecutablePath", "C:\\wrong.exe"],
    ["commandWorkingDirectory", "C:\\wrong"],
    ["commandArguments", ["--wrong"]],
  ];
  for (const [field, value] of cases) {
    const evidence = createEvidence();
    evidence.blocks[0].jobObject[field] = value;
    evidence.blocks[0].cleanup.jobObject[field] = structuredClone(value);
    const report = analyzeWilliamsCrossoverEvidence(evidence);
    assert.ok(report.decision.invalidReasons.includes(`block-01.jobObject.${field}`), field);
    assert.ok(report.decision.invalidReasons.includes(`block-01.cleanup.jobObject.${field}`), field);
  }
});

test("Job runner compile, readiness, and capability failures map to typed invalid exit 3", () => {
  const available = Object.freeze({ status: "available" });
  assert.equal(requireWilliamsJobRunnerReady(available), available);
  for (const status of ["compile-error", "ready-error", "capability-error", "required-capability-missing"]) {
    assert.throws(
      () => requireWilliamsJobRunnerReady({ status, error: "unavailable" }),
      (error) => error instanceof WilliamsInvalidExperimentError
        && error.code === `job-runner-${status}`
        && getWilliamsErrorExitCode(error) === WILLIAMS_EXIT_CODES.invalidExperiment,
    );
  }
});

test("canonical server metadata and every HTTP response fail quiet admission closed", () => {
  assert.deepEqual(resolveServerMetadataProbeTarget({ base_url: "http://127.0.0.1:9123" }), {
    status: "valid",
    baseUrl: "http://127.0.0.1:9123",
    probeUrl: "http://127.0.0.1:9123/app/",
  });
  assert.equal(resolveServerMetadataProbeTarget({}).status, "missing");
  assert.equal(resolveServerMetadataProbeTarget({ base_url: "://bad" }).status, "invalid");

  const telemetry = telemetryWindow("pre", 1, CONTROL_WORKTREE, CONTROL_HEAD);
  telemetry.environment.server = [{
    present: true,
    metadataUrlStatus: "valid",
    probe: { responded: true, ok: false, status: 404 },
  }];
  assert.equal(deriveWilliamsQuietWindow(telemetry).valid, false);
  telemetry.environment.server = [{ present: true, metadataUrlStatus: "missing", probe: null }];
  assert.equal(deriveWilliamsQuietWindow(telemetry).valid, false);
});

test("identity failures map to invalid exit 3 while internal failures map to harness fault 1", () => {
  for (const snapshot of [
    { actualHead: CONTROL_HEAD, detached: false, branch: "main", gitStatus: "" },
    { actualHead: CONTROL_HEAD, detached: true, branch: null, gitStatus: " M tracked" },
    { actualHead: CANDIDATE_HEAD, detached: true, branch: null, gitStatus: "" },
  ]) {
    assert.throws(
      () => validateMeasurementSnapshot(snapshot, CONTROL_HEAD),
      (error) => error instanceof WilliamsInvalidExperimentError && getWilliamsErrorExitCode(error) === 3,
    );
  }
  assert.equal(getWilliamsErrorExitCode(new Error("internal")), WILLIAMS_EXIT_CODES.harnessFault);
  assert.deepEqual(WILLIAMS_EXIT_CODES, { accepted: 0, validRegression: 2, invalidExperiment: 3, harnessFault: 1 });
});

test("raw, JSON, and Markdown outputs use no-clobber with explicit analysis overwrite", async (t) => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "williams-output-policy-"));
  t.after(() => fs.rm(tempRoot, { recursive: true, force: true }));
  const options = {
    rawRoot: path.join(tempRoot, "raw"),
    jsonOut: path.join(tempRoot, "report.json"),
    mdOut: path.join(tempRoot, "report.md"),
  };
  await validateWilliamsOutputPolicy(options, { reserveRawRoot: true });
  await assert.rejects(
    validateWilliamsOutputPolicy(options, { reserveRawRoot: true }),
    (error) => error instanceof WilliamsInvalidExperimentError && error.code === "raw-root-exists",
  );
  await writeJson(options.jsonOut, { preserved: true });
  await assert.rejects(
    runWilliamsCli({ ...parseWilliamsArgs(["--analyze"]), ...options }),
    (error) => error instanceof WilliamsInvalidExperimentError && error.code === "report-output-exists",
  );
  assert.deepEqual(JSON.parse(await fs.readFile(options.jsonOut, "utf8")), { preserved: true });
  assert.equal(parseWilliamsArgs(["--analyze", "--overwrite-analysis"]).overwriteAnalysis, true);
});

test("harness source keeps Windows capability tri-state and explicit execute mode", async () => {
  const runnerSource = await fs.readFile(new URL("../tools/perf/run_williams_crossover.mjs", import.meta.url), "utf8");
  const windowsSource = await fs.readFile(new URL("../tools/perf/williams_crossover_windows_runtime.mjs", import.meta.url), "utf8");
  assert.match(windowsSource, /Win32_PerfFormattedData_Counters_ProcessorInformation/);
  assert.match(windowsSource, /Get-NetTCPConnection -State Listen/);
  assert.doesNotMatch(runnerSource, /LISTENING/);
  assert.match(runnerSource, /responded: true/);
  assert.match(windowsSource, /performanceAdjustedFrequencyMHz/);
  assert.doesNotMatch(windowsSource, /effectiveFrequencyMHz/);
  assert.doesNotMatch(windowsSource, /Win32_ProcessStartTrace|Register-CimIndicationEvent|Wait-Event/);
  assert.match(windowsSource, /JOB_RUNNER_PROTOCOL_ID/);
  assert.match(runnerSource, /runWindowsJobCommand/);
  assert.match(windowsSource, /required-capability-missing/);
  assert.match(windowsSource, /collection-error/);
  assert.match(runnerSource, /mode: "list"/);
  assert.match(runnerSource, /options\.mode === "execute"/);
  assert.match(runnerSource, /prepareWindowsJobRunner/);
});
