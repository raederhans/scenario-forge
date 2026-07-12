import {
  CANONICAL_RENDER_SAMPLE_ROLE_ID,
  RENDER_SAMPLE_ROLE_POLICY_ID,
  analyzeRenderSampleRole,
  median,
} from "./render_sample_role_policy.mjs";

export const WILLIAMS_CROSSOVER_POLICY_ID = "p2-williams-crossover-v1";
export const WILLIAMS_CROSSOVER_SCHEMA_VERSION = 1;
export const WILLIAMS_SCENARIOS = Object.freeze(["tno_1962", "hoi4_1939"]);
export const WILLIAMS_JOB_RUNNER_PROTOCOL_ID = "SF_WILLIAMS_JOB_V1";
export const WILLIAMS_JOB_RUNNER_SOURCE_PATH = "tools/perf/williams_crossover_windows_job_runner.cs";
export const WILLIAMS_JOB_RUNNER_EVIDENCE_PATH = "tooling/windows-job-runner.exe";

function freezeBlock(block) {
  return Object.freeze({
    ...block,
    scenarioOrder: Object.freeze([...block.scenarioOrder]),
  });
}

export const WILLIAMS_BLOCK_SEQUENCE = Object.freeze([
  freezeBlock({ ordinal: 1, id: "block-01", side: "A", orderId: "TH", scenarioOrder: ["tno_1962", "hoi4_1939"] }),
  freezeBlock({ ordinal: 2, id: "block-02", side: "B", orderId: "TH", scenarioOrder: ["tno_1962", "hoi4_1939"] }),
  freezeBlock({ ordinal: 3, id: "block-03", side: "B", orderId: "HT", scenarioOrder: ["hoi4_1939", "tno_1962"] }),
  freezeBlock({ ordinal: 4, id: "block-04", side: "A", orderId: "HT", scenarioOrder: ["hoi4_1939", "tno_1962"] }),
  freezeBlock({ ordinal: 5, id: "block-05", side: "B", orderId: "TH", scenarioOrder: ["tno_1962", "hoi4_1939"] }),
  freezeBlock({ ordinal: 6, id: "block-06", side: "A", orderId: "TH", scenarioOrder: ["tno_1962", "hoi4_1939"] }),
  freezeBlock({ ordinal: 7, id: "block-07", side: "A", orderId: "HT", scenarioOrder: ["hoi4_1939", "tno_1962"] }),
  freezeBlock({ ordinal: 8, id: "block-08", side: "B", orderId: "HT", scenarioOrder: ["hoi4_1939", "tno_1962"] }),
]);

export const WILLIAMS_ADJACENT_PAIRS = Object.freeze([
  Object.freeze({ id: "pair-01-02", controlOrdinal: 1, candidateOrdinal: 2 }),
  Object.freeze({ id: "pair-03-04", controlOrdinal: 4, candidateOrdinal: 3 }),
  Object.freeze({ id: "pair-05-06", controlOrdinal: 6, candidateOrdinal: 5 }),
  Object.freeze({ id: "pair-07-08", controlOrdinal: 7, candidateOrdinal: 8 }),
]);

export const WILLIAMS_DRIFT_PAIRS = Object.freeze([
  Object.freeze({ id: "A-TH-1-6", side: "A", orderId: "TH", firstOrdinal: 1, secondOrdinal: 6 }),
  Object.freeze({ id: "A-HT-4-7", side: "A", orderId: "HT", firstOrdinal: 4, secondOrdinal: 7 }),
  Object.freeze({ id: "B-TH-2-5", side: "B", orderId: "TH", firstOrdinal: 2, secondOrdinal: 5 }),
  Object.freeze({ id: "B-HT-3-8", side: "B", orderId: "HT", firstOrdinal: 3, secondOrdinal: 8 }),
]);

export const WILLIAMS_THRESHOLDS = Object.freeze({
  startup: Object.freeze({ percent: 3, milliseconds: 75 }),
  canonicalRender: Object.freeze({ percent: 5, milliseconds: 35 }),
  sameSideDrift: Object.freeze({ startupPercent: 5, canonicalRenderPercent: 10 }),
  internalOutlier: Object.freeze({
    ratio: 1.25,
    startupSpreadMs: 250,
    canonicalRenderSpreadMs: 100,
  }),
  telemetry: Object.freeze({
    preBlockAverageCpuPercentMax: 25,
    adjacentPairPreCpuDifferencePercentagePointsMax: 10,
    adjacentPairMedianPerformanceAdjustedFrequencyPercentMax: 5,
    globalPerformanceAdjustedFrequencyDriftPercentMax: 10,
    adjacentPairAvailableMemoryPercentMax: 5,
    withinBlockAvailableMemoryPercentMax: 5,
  }),
});

export const WILLIAMS_EXIT_CODES = Object.freeze({
  accepted: 0,
  validRegression: 2,
  invalidExperiment: 3,
  harnessFault: 1,
});

export const REQUIRED_TELEMETRY_SAMPLE_FIELDS = Object.freeze([
  "cpuUtilizationPercent",
  "processorPerformancePercent",
  "percentOfMaximumFrequency",
  "processorFrequencyMHz",
  "performanceAdjustedFrequencyMHz",
  "memoryCommittedPercent",
  "memoryAvailableMBytes",
]);

const WORKLOAD_IDENTITY_FIELDS = Object.freeze([
  "manifestPath",
  "manifestSha256",
  "featureCount",
  "sampleRole",
  "runs",
  "warmups",
  "urlQuery",
]);

const METRICS = Object.freeze([
  Object.freeze({ id: "startup", threshold: WILLIAMS_THRESHOLDS.startup }),
  Object.freeze({ id: "canonicalRender", threshold: WILLIAMS_THRESHOLDS.canonicalRender }),
]);

function finite(value) {
  if (value === null || value === undefined || value === "") {
    return null;
  }
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function arraysEqual(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function artifactDescriptorsEqual(left, right) {
  return left?.path === right?.path
    && left?.gitBlob === right?.gitBlob
    && left?.lfNormalizedSha256 === right?.lfNormalizedSha256;
}

function binaryDescriptorsEqual(left, right) {
  return left?.path === right?.path
    && left?.sha256 === right?.sha256
    && left?.bytes === right?.bytes;
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function validateJobObjectEvidence(jobObject, prefix, { command = null, cwd = null, exitCode = null } = {}) {
  if (!jobObject || typeof jobObject !== "object") return [`${prefix}.missing`];
  const errors = [];
  if (jobObject.schemaVersion !== 1) errors.push(`${prefix}.schemaVersion`);
  if (jobObject.protocolId !== WILLIAMS_JOB_RUNNER_PROTOCOL_ID) errors.push(`${prefix}.protocolId`);
  if (jobObject.provider !== "windows-job-object") errors.push(`${prefix}.provider`);
  if (jobObject.status !== "complete") errors.push(`${prefix}.status`);
  if (!Number.isInteger(jobObject.rootPid) || jobObject.rootPid <= 0) errors.push(`${prefix}.rootPid`);
  if (!Number.isInteger(jobObject.rootExitCode) || (exitCode !== null && jobObject.rootExitCode !== exitCode)) {
    errors.push(`${prefix}.rootExitCode`);
  }
  if (jobObject.createSuspended !== true) errors.push(`${prefix}.createSuspended`);
  if (jobObject.createNoWindow !== true) errors.push(`${prefix}.createNoWindow`);
  if (jobObject.assignedBeforeResume !== true) errors.push(`${prefix}.assignedBeforeResume`);
  if (jobObject.rootInJobBeforeResume !== true) errors.push(`${prefix}.rootInJobBeforeResume`);
  if (jobObject.killOnJobClose !== true) errors.push(`${prefix}.killOnJobClose`);
  if (jobObject.breakawayAllowed !== false) errors.push(`${prefix}.breakawayAllowed`);
  if (jobObject.jobCloseSucceeded !== true) errors.push(`${prefix}.jobCloseSucceeded`);
  if (jobObject.rootTerminationConfirmed !== true) errors.push(`${prefix}.rootTerminationConfirmed`);
  if (jobObject.cleanupValid !== true) errors.push(`${prefix}.cleanupValid`);
  if (!Array.isArray(jobObject.remainingPids) || jobObject.remainingPids.length !== 0) errors.push(`${prefix}.remainingPids`);
  if (!Array.isArray(jobObject.unverifiedPids) || jobObject.unverifiedPids.length !== 0) errors.push(`${prefix}.unverifiedPids`);
  if (jobObject.timedOut === true && jobObject.terminateJobSucceeded !== true) {
    errors.push(`${prefix}.terminateJobSucceeded`);
  }
  if (command) {
    if (jobObject.commandExecutablePath !== command.bin) errors.push(`${prefix}.commandExecutablePath`);
    if (jobObject.commandWorkingDirectory !== cwd) errors.push(`${prefix}.commandWorkingDirectory`);
    if (!arraysEqual(jobObject.commandArguments, command.args || [])) errors.push(`${prefix}.commandArguments`);
  }
  return errors;
}

function validateWilliamsJobRunnerPreparation(preparation, preregistration) {
  if (!preparation || typeof preparation !== "object") return ["job-runner-preparation.missing"];
  const errors = [];
  const containmentIdentity = preregistration?.workloadContract?.processContainment?.identity || {};
  if (preparation.schemaVersion !== 1) errors.push("job-runner-preparation.schemaVersion");
  if (preparation.status !== "available") errors.push("job-runner-preparation.status");
  if (preparation.error !== null) errors.push("job-runner-preparation.error");
  const compiledAt = Date.parse(String(preparation.compiledAt || ""));
  const capabilityProbedAt = Date.parse(String(preparation.capabilityProbedAt || ""));
  const preregisteredAt = Date.parse(String(preregistration?.generatedAt || ""));
  if (!Number.isFinite(compiledAt)) errors.push("job-runner-preparation.compiledAt");
  if (!Number.isFinite(capabilityProbedAt)) errors.push("job-runner-preparation.capabilityProbedAt");
  if (Number.isFinite(compiledAt) && Number.isFinite(capabilityProbedAt) && compiledAt > capabilityProbedAt) {
    errors.push("job-runner-preparation.timestamp-order");
  }
  if (Number.isFinite(capabilityProbedAt) && Number.isFinite(preregisteredAt) && capabilityProbedAt > preregisteredAt) {
    errors.push("job-runner-preparation.preregistration-order");
  }
  if (!artifactDescriptorsEqual(preparation.source, containmentIdentity.source)) {
    errors.push("job-runner-preparation.source");
  }
  if (!binaryDescriptorsEqual(preparation.binary, containmentIdentity.binary)) {
    errors.push("job-runner-preparation.binary");
  }
  if (preparation.binary?.path !== WILLIAMS_JOB_RUNNER_EVIDENCE_PATH) {
    errors.push("job-runner-preparation.binary.path");
  }
  const capabilityCommand = preparation.capabilityCommand;
  if (!String(capabilityCommand?.bin || "").trim()) errors.push("job-runner-preparation.capabilityCommand.bin");
  if (!Array.isArray(capabilityCommand?.args)) errors.push("job-runner-preparation.capabilityCommand.args");
  if (!String(capabilityCommand?.cwd || "").trim()) errors.push("job-runner-preparation.capabilityCommand.cwd");
  errors.push(...validateJobObjectEvidence(
    preparation.capabilityEvidence,
    "job-runner-preparation.capabilityEvidence",
    { command: capabilityCommand, cwd: capabilityCommand?.cwd, exitCode: 0 },
  ));
  return errors;
}

function percentDelta(current, baseline) {
  const currentValue = finite(current);
  const baselineValue = finite(baseline);
  if (currentValue === null || baselineValue === null || baselineValue === 0) {
    return null;
  }
  return ((currentValue - baselineValue) / baselineValue) * 100;
}

function absolutePercentDelta(current, baseline) {
  const delta = percentDelta(current, baseline);
  return delta === null ? null : Math.abs(delta);
}

function classifyPracticalDelta(deltaMs, deltaPercent, threshold) {
  const ms = finite(deltaMs);
  const percent = finite(deltaPercent);
  if (ms === null || percent === null) {
    return "invalid";
  }
  if (ms > threshold.milliseconds && percent > threshold.percent) {
    return "regression";
  }
  if (ms < -threshold.milliseconds && percent < -threshold.percent) {
    return "improvement";
  }
  return "deadband";
}

function buildMetricSummary(values) {
  const normalized = values.map(finite).filter((value) => value !== null);
  return {
    count: normalized.length,
    values: normalized,
    median: normalized.length ? median(normalized) : null,
    min: normalized.length ? Math.min(...normalized) : null,
    max: normalized.length ? Math.max(...normalized) : null,
  };
}

function normalizePreregistration(preregistration = {}) {
  preregistration = preregistration && typeof preregistration === "object" ? preregistration : {};
  return {
    policyId: String(preregistration.policyId || ""),
    schemaVersion: finite(preregistration.schemaVersion),
    generatedAt: preregistration.generatedAt ?? null,
    renderSampleRolePolicyId: String(preregistration.renderSampleRolePolicyId || ""),
    canonicalRenderSampleRoleId: String(preregistration.canonicalRenderSampleRoleId || ""),
    control: preregistration.control || {},
    candidate: preregistration.candidate || {},
    warmupsPerScenario: finite(preregistration.warmupsPerScenario),
    measuredRunsPerScenario: finite(preregistration.measuredRunsPerScenario),
    measuredRawFileCount: finite(preregistration.measuredRawFileCount),
    scenarios: Array.isArray(preregistration.scenarios) ? preregistration.scenarios : [],
    sequence: Array.isArray(preregistration.sequence) ? preregistration.sequence : [],
    adjacentPairs: Array.isArray(preregistration.adjacentPairs) ? preregistration.adjacentPairs : [],
    driftPairs: Array.isArray(preregistration.driftPairs) ? preregistration.driftPairs : [],
    thresholds: preregistration.thresholds || {},
    primaryEstimator: String(preregistration.primaryEstimator || ""),
    blockEstimator: String(preregistration.blockEstimator || ""),
    pairRegressionPolicy: preregistration.pairRegressionPolicy || {},
    telemetry: preregistration.telemetry || {},
    workloadContract: preregistration.workloadContract || {},
    rawContract: preregistration.rawContract || {},
    exitCodes: preregistration.exitCodes || {},
  };
}

export function buildWilliamsPreregistration({
  controlHead = "",
  candidateHead = "",
  controlWorktree = "",
  candidateWorktree = "",
  generatedAt = null,
  jobRunnerSource = null,
  jobRunnerBinary = null,
} = {}) {
  return {
    schemaVersion: WILLIAMS_CROSSOVER_SCHEMA_VERSION,
    policyId: WILLIAMS_CROSSOVER_POLICY_ID,
    generatedAt,
    control: { side: "A", head: String(controlHead), worktree: String(controlWorktree) },
    candidate: { side: "B", head: String(candidateHead), worktree: String(candidateWorktree) },
    renderSampleRolePolicyId: RENDER_SAMPLE_ROLE_POLICY_ID,
    canonicalRenderSampleRoleId: CANONICAL_RENDER_SAMPLE_ROLE_ID,
    scenarios: [...WILLIAMS_SCENARIOS],
    warmupsPerScenario: 1,
    measuredRunsPerScenario: 2,
    measuredRawFileCount: 32,
    sequence: WILLIAMS_BLOCK_SEQUENCE.map((block) => ({
      ordinal: block.ordinal,
      id: block.id,
      side: block.side,
      orderId: block.orderId,
      scenarioOrder: [...block.scenarioOrder],
    })),
    adjacentPairs: WILLIAMS_ADJACENT_PAIRS.map((pair) => ({ ...pair, delta: "B-A" })),
    driftPairs: WILLIAMS_DRIFT_PAIRS.map((pair) => ({ ...pair })),
    thresholds: JSON.parse(JSON.stringify(WILLIAMS_THRESHOLDS)),
    primaryEstimator: "median-of-four-adjacent-pair-deltas",
    blockEstimator: "median-of-two-measured-runs",
    pairRegressionPolicy: {
      oneOfFour: "diagnostic",
      twoOfFour: "invalid-experiment",
      threeOrFourOfFour: "valid-regression",
    },
    telemetry: {
      platform: "win32",
      windowsCounterCapability: "required",
      preSamplesPerBlock: 5,
      postSamplesPerBlock: 5,
      sampleIntervalMs: 1000,
      sampleIntervalToleranceMs: 250,
      phases: ["pre", "post"],
      timestampOrder: "strictly-increasing-with-pre-before-post",
      performanceAdjustedFrequencyDefinition: "processorFrequencyMHz*processorPerformancePercent/100",
      performanceAdjustedFrequencyToleranceMHz: 0.5,
      requiredSampleFields: [...REQUIRED_TELEMETRY_SAMPLE_FIELDS],
      requiredEnvironmentFields: [
        "power",
        "ports",
        "processes",
        "server",
        "browser",
        "cwd",
        "probe",
        "gitStatus",
      ],
      admissionThresholds: JSON.parse(JSON.stringify(WILLIAMS_THRESHOLDS.telemetry)),
    },
    workloadContract: {
      report: {
        mode: "baseline",
        schemaVersion: 2,
        benchmarkMetricsSchemaVersion: "3.3",
        probeSchema: "mc_perf_snapshot",
        threshold: 1.15,
        urlQuery: {
          render_profile: "balanced",
          startup_interaction: "full",
          startup_worker: 1,
          startup_cache: 0,
          perf: 1,
        },
      },
      scenarioManifestPaths: {
        tno_1962: "data/scenarios/tno_1962/manifest.json",
        hoi4_1939: "data/scenarios/hoi4_1939/manifest.json",
      },
      requiredScenarioFields: [...WORKLOAD_IDENTITY_FIELDS],
      bindAcrossSidesAndBlocks: true,
      governedScenarioSampleRole: "gate",
      baseUrlAdmissionRole: "excluded-dynamic-runtime-value",
      processContainment: {
        provider: "windows-job-object",
        protocolId: WILLIAMS_JOB_RUNNER_PROTOCOL_ID,
        sourcePath: WILLIAMS_JOB_RUNNER_SOURCE_PATH,
        compileTiming: "once-before-any-pre-telemetry",
        creationFlags: ["CREATE_SUSPENDED", "CREATE_NO_WINDOW"],
        assignBeforeResume: true,
        jobLimit: "JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE",
        breakawayAllowed: false,
        measurementProcessObservation: "none",
        identity: {
          source: jobRunnerSource,
          binary: jobRunnerBinary,
        },
      },
    },
    rawContract: {
      exactMeasuredRawFiles: 32,
      extraMeasuredRawFiles: "invalid",
      missingMeasuredRawFiles: "invalid",
      manifestRequired: true,
      manifestEntrySet: "exact-required-evidence-paths",
      manifestSchemaVersion: 1,
      manifestPolicyId: WILLIAMS_CROSSOVER_POLICY_ID,
      toolIdentityMustMatchCurrentAnalyzer: true,
      reportMustRebuildFromRaw: true,
    },
    exitCodes: { ...WILLIAMS_EXIT_CODES },
  };
}

export function validateWilliamsPreregistration(preregistration) {
  const normalized = normalizePreregistration(preregistration);
  const containmentIdentity = normalized.workloadContract?.processContainment?.identity || {};
  const expected = buildWilliamsPreregistration({
    jobRunnerSource: containmentIdentity.source || null,
    jobRunnerBinary: containmentIdentity.binary || null,
  });
  const errors = [];
  if (normalized.policyId !== expected.policyId) errors.push("preregistration.policyId");
  if (normalized.schemaVersion !== expected.schemaVersion) errors.push("preregistration.schemaVersion");
  if (!Number.isFinite(Date.parse(String(normalized.generatedAt || "")))) errors.push("preregistration.generatedAt");
  if (normalized.renderSampleRolePolicyId !== expected.renderSampleRolePolicyId) errors.push("preregistration.renderSampleRolePolicyId");
  if (normalized.canonicalRenderSampleRoleId !== expected.canonicalRenderSampleRoleId) errors.push("preregistration.canonicalRenderSampleRoleId");
  if (normalized.control.side !== "A") errors.push("preregistration.control.side");
  if (!/^[a-f0-9]{40}$/i.test(String(normalized.control.head || ""))) errors.push("preregistration.control.head");
  if (!String(normalized.control.worktree || "").trim()) errors.push("preregistration.control.worktree");
  if (normalized.candidate.side !== "B") errors.push("preregistration.candidate.side");
  if (!/^[a-f0-9]{40}$/i.test(String(normalized.candidate.head || ""))) errors.push("preregistration.candidate.head");
  if (!String(normalized.candidate.worktree || "").trim()) errors.push("preregistration.candidate.worktree");
  if (normalized.control.head === normalized.candidate.head) errors.push("preregistration.heads.distinct");
  if (String(normalized.control.worktree || "").toLowerCase() === String(normalized.candidate.worktree || "").toLowerCase()) {
    errors.push("preregistration.worktrees.distinct");
  }
  if (normalized.warmupsPerScenario !== 1) errors.push("preregistration.warmupsPerScenario");
  if (normalized.measuredRunsPerScenario !== 2) errors.push("preregistration.measuredRunsPerScenario");
  if (normalized.measuredRawFileCount !== 32) errors.push("preregistration.measuredRawFileCount");
  if (!arraysEqual(normalized.scenarios, expected.scenarios)) errors.push("preregistration.scenarios");
  if (normalized.sequence.length !== WILLIAMS_BLOCK_SEQUENCE.length) {
    errors.push("preregistration.sequence.length");
  } else {
    WILLIAMS_BLOCK_SEQUENCE.forEach((expectedBlock, index) => {
      const actual = normalized.sequence[index] || {};
      if (
        actual.ordinal !== expectedBlock.ordinal
        || actual.id !== expectedBlock.id
        || actual.side !== expectedBlock.side
        || actual.orderId !== expectedBlock.orderId
        || !arraysEqual(actual.scenarioOrder, expectedBlock.scenarioOrder)
      ) {
        errors.push(`preregistration.sequence.${index}`);
      }
    });
  }
  const expectedPairs = expected.adjacentPairs;
  if (JSON.stringify(normalized.adjacentPairs) !== JSON.stringify(expectedPairs)) {
    errors.push("preregistration.adjacentPairs");
  }
  if (JSON.stringify(normalized.driftPairs) !== JSON.stringify(expected.driftPairs)) {
    errors.push("preregistration.driftPairs");
  }
  if (JSON.stringify(normalized.thresholds) !== JSON.stringify(expected.thresholds)) {
    errors.push("preregistration.thresholds");
  }
  if (normalized.primaryEstimator !== expected.primaryEstimator) errors.push("preregistration.primaryEstimator");
  if (normalized.blockEstimator !== expected.blockEstimator) errors.push("preregistration.blockEstimator");
  if (JSON.stringify(normalized.pairRegressionPolicy) !== JSON.stringify(expected.pairRegressionPolicy)) {
    errors.push("preregistration.pairRegressionPolicy");
  }
  if (JSON.stringify(normalized.telemetry) !== JSON.stringify(expected.telemetry)) {
    errors.push("preregistration.telemetry");
  }
  if (JSON.stringify(normalized.workloadContract) !== JSON.stringify(expected.workloadContract)) {
    errors.push("preregistration.workloadContract");
  }
  const sourceIdentity = containmentIdentity.source;
  if (String(sourceIdentity?.path || "") !== WILLIAMS_JOB_RUNNER_SOURCE_PATH) {
    errors.push("preregistration.workloadContract.processContainment.identity.source.path");
  }
  if (!/^[a-f0-9]{40}$/i.test(String(sourceIdentity?.gitBlob || ""))) {
    errors.push("preregistration.workloadContract.processContainment.identity.source.gitBlob");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(sourceIdentity?.lfNormalizedSha256 || ""))) {
    errors.push("preregistration.workloadContract.processContainment.identity.source.lfNormalizedSha256");
  }
  const binaryIdentity = containmentIdentity.binary;
  if (binaryIdentity?.path !== WILLIAMS_JOB_RUNNER_EVIDENCE_PATH) {
    errors.push("preregistration.workloadContract.processContainment.identity.binary.path");
  }
  if (!/^[a-f0-9]{64}$/i.test(String(binaryIdentity?.sha256 || ""))) {
    errors.push("preregistration.workloadContract.processContainment.identity.binary.sha256");
  }
  if (!Number.isInteger(binaryIdentity?.bytes) || binaryIdentity.bytes <= 0) {
    errors.push("preregistration.workloadContract.processContainment.identity.binary.bytes");
  }
  if (JSON.stringify(normalized.rawContract) !== JSON.stringify(expected.rawContract)) {
    errors.push("preregistration.rawContract");
  }
  if (JSON.stringify(normalized.exitCodes) !== JSON.stringify(expected.exitCodes)) {
    errors.push("preregistration.exitCodes");
  }
  return errors;
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function telemetrySampleValues(window, field) {
  return (Array.isArray(window?.samples) ? window.samples : [])
    .map((sample) => finite(sample?.[field]))
    .filter((value) => value !== null);
}

function validateTelemetryWindow(window, label, expectedPhase) {
  const errors = [];
  if (!window || typeof window !== "object") {
    return { errors: [`${label}.missing`], summary: null };
  }
  if (finite(window.schemaVersion) !== 1) errors.push(`${label}.schemaVersion`);
  if (String(window.phase || "") !== expectedPhase) errors.push(`${label}.phase`);
  const capabilityStatus = String(window.capability?.status || "missing");
  if (capabilityStatus !== "available") {
    errors.push(`${label}.capability.${capabilityStatus}`);
  }
  if (!Array.isArray(window.capability?.missing) || window.capability.missing.length !== 0) {
    errors.push(`${label}.capability.missing`);
  }
  const samples = Array.isArray(window.samples) ? window.samples : [];
  if (samples.length !== 5) {
    errors.push(`${label}.samples.expected-5-actual-${samples.length}`);
  }
  const sampleTimes = [];
  samples.forEach((sample, sampleIndex) => {
    const parsedAt = Date.parse(String(sample?.at || ""));
    if (!Number.isFinite(parsedAt)) errors.push(`${label}.samples.${sampleIndex}.at`);
    else sampleTimes.push(parsedAt);
    for (const field of REQUIRED_TELEMETRY_SAMPLE_FIELDS) {
      if (finite(sample?.[field]) === null) {
        errors.push(`${label}.samples.${sampleIndex}.${field}`);
      }
    }
  });
  for (let index = 1; index < sampleTimes.length; index += 1) {
    if (!(sampleTimes[index] > sampleTimes[index - 1])) errors.push(`${label}.samples.timestamp-order`);
    const spacingMs = sampleTimes[index] - sampleTimes[index - 1];
    if (Math.abs(spacingMs - 1000) > 250) errors.push(`${label}.samples.interval`);
  }
  samples.forEach((sample, sampleIndex) => {
    const processorFrequency = finite(sample?.processorFrequencyMHz);
    const processorPerformance = finite(sample?.processorPerformancePercent);
    const adjustedFrequency = finite(sample?.performanceAdjustedFrequencyMHz);
    const expectedAdjustedFrequency = processorFrequency === null || processorPerformance === null
      ? null
      : (processorFrequency * processorPerformance) / 100;
    if (
      adjustedFrequency === null
      || expectedAdjustedFrequency === null
      || Math.abs(adjustedFrequency - expectedAdjustedFrequency) > 0.5
    ) errors.push(`${label}.samples.${sampleIndex}.performanceAdjustedFrequencyMHz.formula`);
  });
  const power = window.environment?.power || {};
  if (!String(power.activeSchemeGuid || "").trim()) errors.push(`${label}.environment.power.activeSchemeGuid`);
  if (!String(power.activeSchemeName || "").trim()) errors.push(`${label}.environment.power.activeSchemeName`);
  if (finite(power.acLineStatus) === null) errors.push(`${label}.environment.power.acLineStatus`);
  if (finite(power.batteryFlag) === null) errors.push(`${label}.environment.power.batteryFlag`);
  for (const field of ["ports", "processes", "server", "browser", "cwd", "probe", "gitStatus"]) {
    if (window.environment?.[field] === undefined || window.environment?.[field] === null) {
      errors.push(`${label}.environment.${field}`);
    }
  }
  const cpuValues = telemetrySampleValues(window, "cpuUtilizationPercent");
  const frequencyValues = telemetrySampleValues(window, "performanceAdjustedFrequencyMHz");
  const memoryValues = telemetrySampleValues(window, "memoryAvailableMBytes");
  return {
    errors,
    summary: {
      phase: expectedPhase,
      firstAtMs: sampleTimes.length === samples.length ? sampleTimes[0] : null,
      lastAtMs: sampleTimes.length === samples.length ? sampleTimes.at(-1) : null,
      averageCpuUtilizationPercent: cpuValues.length === 5 ? average(cpuValues) : null,
      medianPerformanceAdjustedFrequencyMHz: frequencyValues.length === 5 ? median(frequencyValues) : null,
      medianAvailableMemoryMBytes: memoryValues.length === 5 ? median(memoryValues) : null,
      powerSchemeGuid: String(power.activeSchemeGuid || "").toLowerCase(),
      acLineStatus: finite(power.acLineStatus),
    },
  };
}

function environmentHasActiveTaskSurface(environment) {
  const occupiedPort = Object.values(environment?.ports || {}).some((entries) => Array.isArray(entries) && entries.length > 0);
  const directProbeResponse = (environment?.probe || []).some((entry) => entry?.ok === true || finite(entry?.status) !== null);
  const metadataProbeResponse = (environment?.server || []).some((entry) => (
    entry?.present === true
    && (entry?.metadataUrlStatus !== "valid" || entry?.probe?.ok === true || finite(entry?.probe?.status) !== null)
  ));
  return occupiedPort || directProbeResponse || metadataProbeResponse;
}

function validateTelemetryEnvironment(window, label, expectedBlock, preregistration) {
  const errors = [];
  const environment = window?.environment || {};
  const side = expectedBlock.side === "A" ? preregistration?.control : preregistration?.candidate;
  if (String(environment.cwd || "") !== String(side?.worktree || "")) errors.push(`${label}.environment.cwd.identity`);
  if (String(environment.gitHead || "") !== String(side?.head || "")) errors.push(`${label}.environment.gitHead`);
  if (environment.detached !== true) errors.push(`${label}.environment.detached`);
  if (String(environment.gitStatus || "") !== "") errors.push(`${label}.environment.gitStatus.clean`);
  if (environmentHasActiveTaskSurface(environment)) errors.push(`${label}.environment.task-surface-active`);
  return errors;
}

function buildTelemetryAdmission(blocks, preregistration) {
  const errors = [];
  const blockSummaries = new Map();
  const powerSchemes = new Set();
  const acSources = new Set();
  let previousPostAtMs = null;

  const blocksByOrdinal = new Map(blocks.map((block) => [finite(block?.ordinal), block]));
  for (const expectedBlock of WILLIAMS_BLOCK_SEQUENCE) {
    const block = blocksByOrdinal.get(expectedBlock.ordinal);
    if (!block) continue;
    const pre = validateTelemetryWindow(block.telemetry?.pre, `${expectedBlock.id}.telemetry.pre`, "pre");
    const post = validateTelemetryWindow(block.telemetry?.post, `${expectedBlock.id}.telemetry.post`, "post");
    errors.push(...pre.errors, ...post.errors);
    errors.push(
      ...validateTelemetryEnvironment(block.telemetry?.pre, `${expectedBlock.id}.telemetry.pre`, expectedBlock, preregistration),
      ...validateTelemetryEnvironment(block.telemetry?.post, `${expectedBlock.id}.telemetry.post`, expectedBlock, preregistration),
    );
    const preFirstAtMs = pre.summary?.firstAtMs ?? null;
    const preLastAtMs = pre.summary?.lastAtMs ?? null;
    const postFirstAtMs = post.summary?.firstAtMs ?? null;
    const postLastAtMs = post.summary?.lastAtMs ?? null;
    if (preLastAtMs !== null && postFirstAtMs !== null && !(postFirstAtMs > preLastAtMs)) {
      errors.push(`${expectedBlock.id}.telemetry.pre-post-order`);
    }
    if (previousPostAtMs !== null && preFirstAtMs !== null && !(preFirstAtMs > previousPostAtMs)) {
      errors.push(`${expectedBlock.id}.telemetry.block-order`);
    }
    if (postLastAtMs !== null) previousPostAtMs = postLastAtMs;

    for (const summary of [pre.summary, post.summary]) {
      if (summary?.powerSchemeGuid) powerSchemes.add(summary.powerSchemeGuid);
      if (summary?.acLineStatus !== null && summary?.acLineStatus !== undefined) acSources.add(summary.acLineStatus);
    }

    const preCpu = pre.summary?.averageCpuUtilizationPercent;
    if (preCpu === null || preCpu === undefined || preCpu > WILLIAMS_THRESHOLDS.telemetry.preBlockAverageCpuPercentMax) {
      errors.push(`${expectedBlock.id}.telemetry.pre.cpu-average`);
    }
    const preMemory = pre.summary?.medianAvailableMemoryMBytes;
    const postMemory = post.summary?.medianAvailableMemoryMBytes;
    const withinBlockMemoryDeltaPercent = absolutePercentDelta(postMemory, preMemory);
    if (
      withinBlockMemoryDeltaPercent === null
      || withinBlockMemoryDeltaPercent > WILLIAMS_THRESHOLDS.telemetry.withinBlockAvailableMemoryPercentMax
    ) {
      errors.push(`${expectedBlock.id}.telemetry.memory-within-block`);
    }
    blockSummaries.set(expectedBlock.ordinal, {
      blockId: expectedBlock.id,
      pre: pre.summary,
      post: post.summary,
      withinBlockMemoryDeltaPercent,
    });
  }

  if (powerSchemes.size !== 1) errors.push("telemetry.environment.powerSchemeGuid.consistency");
  if (acSources.size !== 1) errors.push("telemetry.environment.acLineStatus.consistency");

  const adjacentPairChecks = [];
  for (const pair of WILLIAMS_ADJACENT_PAIRS) {
    const control = blockSummaries.get(pair.controlOrdinal)?.pre;
    const candidate = blockSummaries.get(pair.candidateOrdinal)?.pre;
    const cpuDifferencePercentagePoints = control && candidate
      ? Math.abs(candidate.averageCpuUtilizationPercent - control.averageCpuUtilizationPercent)
      : null;
    const frequencyDifferencePercent = absolutePercentDelta(
      candidate?.medianPerformanceAdjustedFrequencyMHz,
      control?.medianPerformanceAdjustedFrequencyMHz,
    );
    const memoryDifferencePercent = absolutePercentDelta(
      candidate?.medianAvailableMemoryMBytes,
      control?.medianAvailableMemoryMBytes,
    );
    const check = {
      pairId: pair.id,
      cpuDifferencePercentagePoints,
      frequencyDifferencePercent,
      memoryDifferencePercent,
    };
    adjacentPairChecks.push(check);
    if (
      cpuDifferencePercentagePoints === null
      || cpuDifferencePercentagePoints > WILLIAMS_THRESHOLDS.telemetry.adjacentPairPreCpuDifferencePercentagePointsMax
    ) errors.push(`telemetry.${pair.id}.pre-cpu-difference`);
    if (
      frequencyDifferencePercent === null
      || frequencyDifferencePercent > WILLIAMS_THRESHOLDS.telemetry.adjacentPairMedianPerformanceAdjustedFrequencyPercentMax
    ) errors.push(`telemetry.${pair.id}.pre-frequency-difference`);
    if (
      memoryDifferencePercent === null
      || memoryDifferencePercent > WILLIAMS_THRESHOLDS.telemetry.adjacentPairAvailableMemoryPercentMax
    ) errors.push(`telemetry.${pair.id}.pre-memory-difference`);
  }

  const frequencyMedians = [...blockSummaries.values()]
    .map((summary) => finite(summary.pre?.medianPerformanceAdjustedFrequencyMHz))
    .filter((value) => value !== null);
  const globalFrequencyDriftPercent = frequencyMedians.length === WILLIAMS_BLOCK_SEQUENCE.length
    ? absolutePercentDelta(Math.max(...frequencyMedians), Math.min(...frequencyMedians))
    : null;
  if (
    globalFrequencyDriftPercent === null
    || globalFrequencyDriftPercent > WILLIAMS_THRESHOLDS.telemetry.globalPerformanceAdjustedFrequencyDriftPercentMax
  ) errors.push("telemetry.global.pre-frequency-drift");

  return {
    errors,
    summary: {
      status: errors.length ? "invalid" : "valid",
      thresholds: WILLIAMS_THRESHOLDS.telemetry,
      powerSchemeGuids: [...powerSchemes],
      acLineStatuses: [...acSources],
      globalFrequencyDriftPercent,
      adjacentPairChecks,
      blocks: [...blockSummaries.values()],
    },
  };
}

function validateIdentity(identity, block, preregistration) {
  const errors = [];
  const expectedSide = block.side;
  const registration = preregistration && typeof preregistration === "object" ? preregistration : {};
  const sideRegistration = expectedSide === "A" ? registration.control : registration.candidate;
  if (String(identity?.side || "") !== expectedSide) errors.push(`${block.id}.identity.side`);
  if (String(identity?.expectedHead || "") !== String(sideRegistration?.head || "")) errors.push(`${block.id}.identity.expectedHead`);
  if (String(identity?.actualHead || "") !== String(sideRegistration?.head || "")) errors.push(`${block.id}.identity.actualHead`);
  if (identity?.detached !== true) errors.push(`${block.id}.identity.detached`);
  if (String(identity?.gitStatus || "") !== "") errors.push(`${block.id}.identity.gitStatus`);
  if (String(identity?.cwd || "") !== String(sideRegistration?.worktree || "")) errors.push(`${block.id}.identity.cwd`);
  for (const field of ["packageLock", "runner", "rolePolicy", "analyzer", "policy", "windowsRuntime", "jobRunnerSource"]) {
    const descriptor = identity?.artifacts?.[field];
    if (!String(descriptor?.gitBlob || "").trim()) errors.push(`${block.id}.identity.artifacts.${field}.gitBlob`);
    if (!/^[a-f0-9]{64}$/i.test(String(descriptor?.lfNormalizedSha256 || ""))) {
      errors.push(`${block.id}.identity.artifacts.${field}.lfNormalizedSha256`);
    }
  }
  const jobRunnerBinary = identity?.artifacts?.jobRunnerBinary;
  if (!String(jobRunnerBinary?.path || "").trim()) errors.push(`${block.id}.identity.artifacts.jobRunnerBinary.path`);
  if (!/^[a-f0-9]{64}$/i.test(String(jobRunnerBinary?.sha256 || ""))) {
    errors.push(`${block.id}.identity.artifacts.jobRunnerBinary.sha256`);
  }
  if (!Number.isInteger(jobRunnerBinary?.bytes) || jobRunnerBinary.bytes <= 0) {
    errors.push(`${block.id}.identity.artifacts.jobRunnerBinary.bytes`);
  }
  const containmentIdentity = registration.workloadContract?.processContainment?.identity || {};
  const registeredSource = containmentIdentity.source;
  const actualSource = identity?.artifacts?.jobRunnerSource;
  if (
    actualSource?.path !== registeredSource?.path
    || actualSource?.gitBlob !== registeredSource?.gitBlob
    || actualSource?.lfNormalizedSha256 !== registeredSource?.lfNormalizedSha256
  ) {
    errors.push(`${block.id}.identity.artifacts.jobRunnerSource.preregistration`);
  }
  const registeredBinary = containmentIdentity.binary;
  if (
    jobRunnerBinary?.path !== registeredBinary?.path
    || jobRunnerBinary?.sha256 !== registeredBinary?.sha256
    || jobRunnerBinary?.bytes !== registeredBinary?.bytes
  ) {
    errors.push(`${block.id}.identity.artifacts.jobRunnerBinary.preregistration`);
  }
  return errors;
}

function validateCleanup(cleanup, block, evidence) {
  const errors = [];
  if (!cleanup || typeof cleanup !== "object") return [`${block.id}.cleanup.missing`];
  if (cleanup.valid !== true) errors.push(`${block.id}.cleanup.valid`);
  if (cleanup.processTreeCaptureStatus !== "available") errors.push(`${block.id}.cleanup.processTreeCaptureStatus`);
  if (cleanup.terminationSucceeded !== true) errors.push(`${block.id}.cleanup.terminationSucceeded`);
  if ((cleanup.taskOwnedPidsRemaining || []).length !== 0) errors.push(`${block.id}.cleanup.taskOwnedPidsRemaining`);
  if ((cleanup.taskOwnedProcessesRemaining || []).length !== 0) errors.push(`${block.id}.cleanup.taskOwnedProcessesRemaining`);
  if (cleanup.portsClear !== true) errors.push(`${block.id}.cleanup.portsClear`);
  if (cleanup.serverProbesClear !== true) errors.push(`${block.id}.cleanup.serverProbesClear`);
  if (cleanup.gitStatusStable !== true) errors.push(`${block.id}.cleanup.gitStatusStable`);
  if (cleanup.gitHeadStable !== true) errors.push(`${block.id}.cleanup.gitHeadStable`);
  if (cleanup.detachedStable !== true) errors.push(`${block.id}.cleanup.detachedStable`);
  const jobObject = cleanup.jobObject;
  errors.push(...validateJobObjectEvidence(jobObject, `${block.id}.cleanup.jobObject`, {
    command: evidence?.command,
    cwd: evidence?.identity?.cwd,
    exitCode: evidence?.blockResult?.exitCode,
  }));
  errors.push(...validateJobObjectEvidence(evidence?.jobObject, `${block.id}.jobObject`, {
    command: evidence?.command,
    cwd: evidence?.identity?.cwd,
    exitCode: evidence?.blockResult?.exitCode,
  }));
  if (canonicalJson(evidence?.jobObject) !== canonicalJson(jobObject)) {
    errors.push(`${block.id}.jobObject.cleanup-canonical`);
  }
  return errors;
}

function validatePostBlockEnvironment(cleanup, block) {
  if (!cleanup || typeof cleanup !== "object") return [`${block.id}.environment.missing`];
  const browserPids = Array.isArray(cleanup.newBrowserPids) ? cleanup.newBrowserPids : [];
  const browserStable = cleanup.environmentStable === undefined
    ? browserPids.length === 0
    : cleanup.environmentStable === true && browserPids.length === 0;
  return browserStable ? [] : [`${block.id}.environment.browserStable`];
}

function validateBlockResult(blockResult, block) {
  const errors = [];
  if (!blockResult || typeof blockResult !== "object") return [`${block.id}.blockResult.missing`];
  if (finite(blockResult.exitCode) !== 0) errors.push(`${block.id}.blockResult.exitCode`);
  if (blockResult.status !== "complete") errors.push(`${block.id}.blockResult.status`);
  return errors;
}

function validateQuietWindow(quietWindow, block) {
  if (!quietWindow || typeof quietWindow !== "object") return [`${block.id}.quietWindow.missing`];
  return quietWindow.status === "valid" && quietWindow.valid === true
    ? []
    : [`${block.id}.quietWindow.invalid`];
}

function validateBaselineIdentity(baseline, block, preregistration) {
  const errors = [];
  const registration = preregistration && typeof preregistration === "object" ? preregistration : {};
  const expectedHead = block.side === "A" ? registration.control?.head : registration.candidate?.head;
  if (String(baseline?.gitHead || "") !== String(expectedHead || "")) errors.push(`${block.id}.baseline.gitHead`);
  if (finite(baseline?.schemaVersion) !== 2) errors.push(`${block.id}.baseline.schemaVersion`);
  if (finite(baseline?.config?.warmups) !== 1) errors.push(`${block.id}.baseline.config.warmups`);
  if (finite(baseline?.config?.runs) !== 2) errors.push(`${block.id}.baseline.config.runs`);
  if (!arraysEqual(baseline?.config?.scenarios, block.scenarioOrder)) errors.push(`${block.id}.baseline.config.scenarios`);
  if (baseline?.renderSampleRolePolicy?.policyId !== RENDER_SAMPLE_ROLE_POLICY_ID) {
    errors.push(`${block.id}.baseline.renderSampleRolePolicy.policyId`);
  }
  if (baseline?.renderSampleRolePolicy?.canonicalRoleId !== CANONICAL_RENDER_SAMPLE_ROLE_ID) {
    errors.push(`${block.id}.baseline.renderSampleRolePolicy.canonicalRoleId`);
  }
  return errors;
}

function workloadIdentityForScenario(baseline, scenarioId) {
  return baseline?.workloadIdentity?.scenarios?.[scenarioId]
    || baseline?.scenarios?.[scenarioId]?.workloadIdentity
    || null;
}

function projectWorkloadIdentity(identity) {
  if (!identity || typeof identity !== "object") return null;
  return Object.fromEntries(WORKLOAD_IDENTITY_FIELDS.map((field) => [field, identity[field]]));
}

function validateBlockWorkloadIdentity(baseline, block) {
  const errors = [];
  const reportIdentity = baseline?.workloadIdentity || {};
  const contract = buildWilliamsPreregistration().workloadContract;
  if (baseline?.mode !== contract.report.mode) errors.push(`${block.id}.baseline.mode`);
  if (finite(baseline?.schemaVersion) !== contract.report.schemaVersion) errors.push(`${block.id}.baseline.schemaVersion.workload`);
  if (String(baseline?.benchmarkMetricsSchemaVersion || "") !== contract.report.benchmarkMetricsSchemaVersion) {
    errors.push(`${block.id}.baseline.benchmarkMetricsSchemaVersion`);
  }
  if (String(baseline?.probeSchema || "") !== contract.report.probeSchema) errors.push(`${block.id}.baseline.probeSchema`);
  if (finite(baseline?.config?.threshold) !== contract.report.threshold) errors.push(`${block.id}.baseline.config.threshold`);
  if (JSON.stringify(baseline?.config?.urlQuery || null) !== JSON.stringify(contract.report.urlQuery)) {
    errors.push(`${block.id}.baseline.config.urlQuery.canonical`);
  }
  if (!arraysEqual(reportIdentity.scenarioIds, block.scenarioOrder)) errors.push(`${block.id}.baseline.workloadIdentity.scenarioIds`);
  if (finite(reportIdentity.runs) !== 2) errors.push(`${block.id}.baseline.workloadIdentity.runs`);
  if (finite(reportIdentity.warmups) !== 1) errors.push(`${block.id}.baseline.workloadIdentity.warmups`);
  if (JSON.stringify(reportIdentity.urlQuery || null) !== JSON.stringify(baseline?.config?.urlQuery || null)) {
    errors.push(`${block.id}.baseline.workloadIdentity.urlQuery`);
  }
  if (JSON.stringify(reportIdentity.urlQuery || null) !== JSON.stringify(contract.report.urlQuery)) {
    errors.push(`${block.id}.baseline.workloadIdentity.urlQuery.canonical`);
  }
  for (const scenarioId of WILLIAMS_SCENARIOS) {
    const reportScenarioIdentity = reportIdentity.scenarios?.[scenarioId] || null;
    const scenarioIdentity = baseline?.scenarios?.[scenarioId]?.workloadIdentity || null;
    const identity = reportScenarioIdentity || scenarioIdentity;
    if (!identity) {
      errors.push(`${block.id}.baseline.workloadIdentity.${scenarioId}.missing`);
      continue;
    }
    if (String(identity.scenarioId || "") !== scenarioId) errors.push(`${block.id}.baseline.workloadIdentity.${scenarioId}.scenarioId`);
    if (String(identity.manifestPath || "") !== contract.scenarioManifestPaths[scenarioId]) {
      errors.push(`${block.id}.baseline.workloadIdentity.${scenarioId}.manifestPath`);
    }
    if (!/^[a-f0-9]{64}$/i.test(String(identity.manifestSha256 || ""))) {
      errors.push(`${block.id}.baseline.workloadIdentity.${scenarioId}.manifestSha256`);
    }
    if (finite(identity.featureCount) === null) errors.push(`${block.id}.baseline.workloadIdentity.${scenarioId}.featureCount`);
    if (String(identity.sampleRole || "") !== "gate") {
      errors.push(`${block.id}.baseline.workloadIdentity.${scenarioId}.sampleRole`);
    }
    if (finite(identity.runs) !== 2) errors.push(`${block.id}.baseline.workloadIdentity.${scenarioId}.runs`);
    if (finite(identity.warmups) !== 1) errors.push(`${block.id}.baseline.workloadIdentity.${scenarioId}.warmups`);
    if (JSON.stringify(identity.urlQuery || null) !== JSON.stringify(reportIdentity.urlQuery || null)) {
      errors.push(`${block.id}.baseline.workloadIdentity.${scenarioId}.urlQuery`);
    }
    if (JSON.stringify(identity.urlQuery || null) !== JSON.stringify(contract.report.urlQuery)) {
      errors.push(`${block.id}.baseline.workloadIdentity.${scenarioId}.urlQuery.canonical`);
    }
    if (JSON.stringify(projectWorkloadIdentity(reportScenarioIdentity)) !== JSON.stringify(projectWorkloadIdentity(scenarioIdentity))) {
      errors.push(`${block.id}.baseline.workloadIdentity.${scenarioId}.reportScenarioMismatch`);
    }
    if (String(baseline?.scenarios?.[scenarioId]?.sampleRole || "") !== String(identity.sampleRole || "")) {
      errors.push(`${block.id}.baseline.scenarios.${scenarioId}.sampleRole`);
    }
    if (finite(baseline?.scenarios?.[scenarioId]?.featureCount) !== finite(identity.featureCount)) {
      errors.push(`${block.id}.baseline.scenarios.${scenarioId}.featureCount`);
    }
  }
  return errors;
}

function validateCrossBlockWorkloadIdentity(blocks) {
  const errors = [];
  const reference = blocks.find((block) => block?.baseline)?.baseline;
  for (const scenarioId of WILLIAMS_SCENARIOS) {
    const expected = projectWorkloadIdentity(workloadIdentityForScenario(reference, scenarioId));
    for (const block of blocks) {
      const actual = projectWorkloadIdentity(workloadIdentityForScenario(block?.baseline, scenarioId));
      if (JSON.stringify(actual) !== JSON.stringify(expected)) {
        errors.push(`${block?.id || "unknown-block"}.baseline.workloadIdentity.${scenarioId}.crossBlock`);
      }
    }
  }
  return errors;
}

function normalizeRun(run, scenarioId, block, runIndex) {
  const errors = [];
  const role = analyzeRenderSampleRole({ scenarioId, snapshot: run?.snapshot || {} });
  if (String(run?.activeScenarioId || "") !== scenarioId) {
    errors.push(`${block.id}.${scenarioId}.run-${runIndex + 1}.activeScenarioId`);
  }
  if (role.policyId !== RENDER_SAMPLE_ROLE_POLICY_ID) {
    errors.push(`${block.id}.${scenarioId}.run-${runIndex + 1}.rolePolicy`);
  }
  if (role.canonicalRoleId !== CANONICAL_RENDER_SAMPLE_ROLE_ID || role.roleMatched !== true) {
    errors.push(`${block.id}.${scenarioId}.run-${runIndex + 1}.canonicalRole`);
  }
  const startup = finite(run?.summary?.totalStartupMs);
  const canonicalRender = finite(role.canonicalRenderSampleMs);
  const summaryCanonicalRender = finite(run?.summary?.canonicalRenderSampleMs);
  if (startup === null || startup <= 0) errors.push(`${block.id}.${scenarioId}.run-${runIndex + 1}.startup`);
  if (canonicalRender === null || canonicalRender <= 0) errors.push(`${block.id}.${scenarioId}.run-${runIndex + 1}.canonicalRender`);
  if (summaryCanonicalRender === null || summaryCanonicalRender !== canonicalRender) {
    errors.push(`${block.id}.${scenarioId}.run-${runIndex + 1}.canonicalRenderSummaryMismatch`);
  }
  if (run?.renderSampleRole) {
    const declaredRole = run.renderSampleRole;
    if (
      declaredRole.policyId !== role.policyId
      || declaredRole.canonicalRoleId !== role.canonicalRoleId
      || declaredRole.roleMatched !== role.roleMatched
      || finite(declaredRole.canonicalRenderSampleMs) !== canonicalRender
    ) errors.push(`${block.id}.${scenarioId}.run-${runIndex + 1}.renderSampleRoleMismatch`);
  }
  return { startup, canonicalRender, role, errors };
}

function buildInternalOutlier(block, scenarioId, metricId, values) {
  const summary = buildMetricSummary(values);
  const spread = summary.count === 2 ? summary.max - summary.min : null;
  const ratio = summary.count === 2 && summary.min > 0 ? summary.max / summary.min : null;
  const spreadThreshold = metricId === "startup"
    ? WILLIAMS_THRESHOLDS.internalOutlier.startupSpreadMs
    : WILLIAMS_THRESHOLDS.internalOutlier.canonicalRenderSpreadMs;
  const failed = ratio !== null
    && spread !== null
    && ratio > WILLIAMS_THRESHOLDS.internalOutlier.ratio
    && spread > spreadThreshold;
  return {
    blockId: block.id,
    scenarioId,
    metric: metricId,
    values: summary.values,
    ratio,
    spreadMs: spread,
    thresholds: { ratio: WILLIAMS_THRESHOLDS.internalOutlier.ratio, spreadMs: spreadThreshold },
    status: failed ? "fail" : "pass",
  };
}

function buildPairs(blockValues) {
  const pairs = [];
  for (const pair of WILLIAMS_ADJACENT_PAIRS) {
    const control = blockValues.get(pair.controlOrdinal);
    const candidate = blockValues.get(pair.candidateOrdinal);
    for (const scenarioId of WILLIAMS_SCENARIOS) {
      for (const metric of METRICS) {
        const controlValue = finite(control?.scenarios?.[scenarioId]?.[metric.id]?.median);
        const candidateValue = finite(candidate?.scenarios?.[scenarioId]?.[metric.id]?.median);
        const deltaMs = controlValue === null || candidateValue === null ? null : candidateValue - controlValue;
        const deltaPercent = percentDelta(candidateValue, controlValue);
        pairs.push({
          pairId: pair.id,
          controlOrdinal: pair.controlOrdinal,
          candidateOrdinal: pair.candidateOrdinal,
          scenarioId,
          metric: metric.id,
          controlValue,
          candidateValue,
          deltaMs,
          deltaPercent,
          direction: classifyPracticalDelta(deltaMs, deltaPercent, metric.threshold),
        });
      }
    }
  }
  return pairs;
}

function buildPrimaryComparisons(pairs) {
  const result = {};
  for (const scenarioId of WILLIAMS_SCENARIOS) {
    result[scenarioId] = {};
    for (const metric of METRICS) {
      const selected = pairs.filter((pair) => pair.scenarioId === scenarioId && pair.metric === metric.id);
      const deltaMsValues = selected.map((pair) => pair.deltaMs).filter((value) => value !== null);
      const deltaPercentValues = selected.map((pair) => pair.deltaPercent).filter((value) => value !== null);
      const practicalRegressionCount = selected.filter((pair) => pair.direction === "regression").length;
      const practicalImprovementCount = selected.filter((pair) => pair.direction === "improvement").length;
      const primaryDeltaMs = deltaMsValues.length === 4 ? median(deltaMsValues) : null;
      const primaryDeltaPercent = deltaPercentValues.length === 4 ? median(deltaPercentValues) : null;
      result[scenarioId][metric.id] = {
        pairCount: selected.length,
        pairIds: selected.map((pair) => pair.pairId),
        pairDeltaMs: deltaMsValues,
        pairDeltaPercent: deltaPercentValues,
        deltaMs: primaryDeltaMs,
        deltaPercent: primaryDeltaPercent,
        direction: classifyPracticalDelta(primaryDeltaMs, primaryDeltaPercent, metric.threshold),
        practicalRegressionCount,
        practicalImprovementCount,
        pairPolicyStatus: practicalRegressionCount >= 3
          ? "valid-regression"
          : practicalRegressionCount === 2
            ? "invalid-two-of-four"
            : practicalRegressionCount === 1
              ? "diagnostic-one-of-four"
              : "clean",
        threshold: metric.threshold,
      };
    }
  }
  return result;
}

function buildDriftChecks(blockValues) {
  const checks = [];
  for (const pair of WILLIAMS_DRIFT_PAIRS) {
    const first = blockValues.get(pair.firstOrdinal);
    const second = blockValues.get(pair.secondOrdinal);
    for (const scenarioId of WILLIAMS_SCENARIOS) {
      for (const metric of METRICS) {
        const firstValue = finite(first?.scenarios?.[scenarioId]?.[metric.id]?.median);
        const secondValue = finite(second?.scenarios?.[scenarioId]?.[metric.id]?.median);
        const driftPercent = absolutePercentDelta(secondValue, firstValue);
        const thresholdPercent = metric.id === "startup"
          ? WILLIAMS_THRESHOLDS.sameSideDrift.startupPercent
          : WILLIAMS_THRESHOLDS.sameSideDrift.canonicalRenderPercent;
        checks.push({
          id: pair.id,
          side: pair.side,
          orderId: pair.orderId,
          scenarioId,
          metric: metric.id,
          firstOrdinal: pair.firstOrdinal,
          secondOrdinal: pair.secondOrdinal,
          firstValue,
          secondValue,
          driftPercent,
          thresholdPercent,
          status: driftPercent !== null && driftPercent <= thresholdPercent ? "pass" : "fail",
        });
      }
    }
  }
  return checks;
}

function buildDirectionVetoes(pairs) {
  const vetoes = [];
  for (const scenarioId of WILLIAMS_SCENARIOS) {
    for (const metric of METRICS) {
      const selected = pairs.filter((pair) => pair.scenarioId === scenarioId && pair.metric === metric.id);
      const regressions = selected.filter((pair) => pair.direction === "regression");
      const improvements = selected.filter((pair) => pair.direction === "improvement");
      if (regressions.length && improvements.length) {
        vetoes.push({
          scenarioId,
          metric: metric.id,
          regressionPairs: regressions.map((pair) => pair.pairId),
          improvementPairs: improvements.map((pair) => pair.pairId),
          status: "fail",
        });
      }
    }
  }
  return vetoes;
}

function buildLegacyPooledDiagnostic(blocks) {
  const diagnostic = {};
  for (const scenarioId of WILLIAMS_SCENARIOS) {
    diagnostic[scenarioId] = {};
    for (const metric of METRICS) {
      const sideValues = { A: [], B: [] };
      for (const block of blocks) {
        const values = block?.scenarios?.[scenarioId]?.[metric.id]?.values || [];
        sideValues[block.side]?.push(...values);
      }
      const control = buildMetricSummary(sideValues.A);
      const candidate = buildMetricSummary(sideValues.B);
      diagnostic[scenarioId][metric.id] = {
        control,
        candidate,
        deltaMs: control.median === null || candidate.median === null ? null : candidate.median - control.median,
        deltaPercent: percentDelta(candidate.median, control.median),
        admissionRole: "diagnostic-only",
      };
    }
  }
  return diagnostic;
}

function validateCrossBlockIdentity(blocks) {
  const errors = [];
  const first = blocks[0]?.identity?.artifacts || {};
  for (const block of blocks.slice(1)) {
    for (const field of ["packageLock", "runner", "rolePolicy", "analyzer", "policy", "windowsRuntime", "jobRunnerSource"]) {
      const actual = block.identity?.artifacts?.[field];
      const expected = first[field];
      if (
        actual?.path !== expected?.path
        || actual?.gitBlob !== expected?.gitBlob
        || actual?.lfNormalizedSha256 !== expected?.lfNormalizedSha256
      ) {
        errors.push(`${block.id}.identity.crossBlock.${field}`);
      }
    }
    const actualBinary = block.identity?.artifacts?.jobRunnerBinary;
    const expectedBinary = first.jobRunnerBinary;
    if (
      actualBinary?.path !== expectedBinary?.path
      || actualBinary?.sha256 !== expectedBinary?.sha256
      || actualBinary?.bytes !== expectedBinary?.bytes
    ) {
      errors.push(`${block.id}.identity.crossBlock.jobRunnerBinary`);
    }
  }
  return errors;
}

export function analyzeWilliamsCrossoverEvidence({
  preregistration,
  jobRunnerPreparation,
  blocks = [],
  manifestValidation = { status: "missing", errors: ["manifest.missing"] },
} = {}) {
  const invalidReasons = [
    ...validateWilliamsPreregistration(preregistration),
    ...validateWilliamsJobRunnerPreparation(jobRunnerPreparation, preregistration),
    ...(manifestValidation?.status === "valid" ? [] : (manifestValidation?.errors || ["manifest.invalid"])),
  ];
  const blockValues = new Map();
  const internalOutliers = [];
  const normalizedBlocks = [];
  const blocksByOrdinal = new Map(blocks.map((block) => [finite(block?.ordinal), block]));
  const telemetryAdmission = buildTelemetryAdmission(blocks, preregistration);
  invalidReasons.push(...telemetryAdmission.errors);

  for (const expectedBlock of WILLIAMS_BLOCK_SEQUENCE) {
    const evidence = blocksByOrdinal.get(expectedBlock.ordinal);
    if (!evidence) {
      invalidReasons.push(`${expectedBlock.id}.missing`);
      continue;
    }
    if (
      evidence.id !== expectedBlock.id
      || evidence.side !== expectedBlock.side
      || evidence.orderId !== expectedBlock.orderId
      || !arraysEqual(evidence.scenarioOrder, expectedBlock.scenarioOrder)
    ) {
      invalidReasons.push(`${expectedBlock.id}.metadata`);
    }
    invalidReasons.push(...validateIdentity(evidence.identity, expectedBlock, preregistration));
    invalidReasons.push(...validateCleanup(evidence.cleanup, expectedBlock, evidence));
    invalidReasons.push(...validatePostBlockEnvironment(evidence.cleanup, expectedBlock));
    invalidReasons.push(...validateBlockResult(evidence.blockResult, expectedBlock));
    invalidReasons.push(...validateQuietWindow(evidence.quietWindow, expectedBlock));
    invalidReasons.push(...validateBaselineIdentity(evidence.baseline, expectedBlock, preregistration));
    invalidReasons.push(...validateBlockWorkloadIdentity(evidence.baseline, expectedBlock));

    const scenarios = {};
    for (const scenarioId of WILLIAMS_SCENARIOS) {
      const rawRuns = Array.isArray(evidence.rawRuns?.[scenarioId]) ? evidence.rawRuns[scenarioId] : [];
      if (rawRuns.length !== 2) {
        invalidReasons.push(`${expectedBlock.id}.${scenarioId}.rawRunCount.expected-2-actual-${rawRuns.length}`);
      }
      const normalizedRuns = rawRuns.map((run, runIndex) => normalizeRun(run, scenarioId, expectedBlock, runIndex));
      normalizedRuns.forEach((run) => invalidReasons.push(...run.errors));
      const declaredRoleSummary = evidence.baseline?.scenarios?.[scenarioId]?.renderSampleRoleSummary || {};
      if (declaredRoleSummary.policyId !== RENDER_SAMPLE_ROLE_POLICY_ID) {
        invalidReasons.push(`${expectedBlock.id}.${scenarioId}.baselineRoleSummary.policyId`);
      }
      if (declaredRoleSummary.canonicalRoleId !== CANONICAL_RENDER_SAMPLE_ROLE_ID) {
        invalidReasons.push(`${expectedBlock.id}.${scenarioId}.baselineRoleSummary.canonicalRoleId`);
      }
      if (finite(declaredRoleSummary.governedRunCount) !== 2) invalidReasons.push(`${expectedBlock.id}.${scenarioId}.baselineRoleSummary.governedRunCount`);
      if (finite(declaredRoleSummary.matchedRunCount) !== 2) invalidReasons.push(`${expectedBlock.id}.${scenarioId}.baselineRoleSummary.matchedRunCount`);
      if (finite(declaredRoleSummary.mismatchCount) !== 0) invalidReasons.push(`${expectedBlock.id}.${scenarioId}.baselineRoleSummary.mismatchCount`);
      scenarios[scenarioId] = {};
      for (const metric of METRICS) {
        const metricValues = normalizedRuns.map((run) => run[metric.id]);
        const summary = buildMetricSummary(metricValues);
        scenarios[scenarioId][metric.id] = summary;
        if (
          metric.id === "canonicalRender"
          && finite(evidence.baseline?.scenarios?.[scenarioId]?.summary?.canonicalRenderSampleMs) !== summary.median
        ) invalidReasons.push(`${expectedBlock.id}.${scenarioId}.baselineCanonicalRenderSummaryMismatch`);
        if (
          metric.id === "canonicalRender"
          && finite(evidence.baseline?.scenarios?.[scenarioId]?.renderSampleRoleSummary?.canonicalRenderSampleMs) !== summary.median
        ) invalidReasons.push(`${expectedBlock.id}.${scenarioId}.baselineRoleCanonicalRenderSummaryMismatch`);
        const outlier = buildInternalOutlier(expectedBlock, scenarioId, metric.id, metricValues);
        internalOutliers.push(outlier);
      }
    }
    const normalized = {
      ordinal: expectedBlock.ordinal,
      id: expectedBlock.id,
      side: expectedBlock.side,
      orderId: expectedBlock.orderId,
      scenarioOrder: [...expectedBlock.scenarioOrder],
      identity: evidence.identity,
      scenarios,
    };
    normalizedBlocks.push(normalized);
    blockValues.set(expectedBlock.ordinal, normalized);
  }

  invalidReasons.push(...validateCrossBlockIdentity(blocks));
  invalidReasons.push(...validateCrossBlockWorkloadIdentity(blocks));
  const failedInternalOutliers = internalOutliers.filter((check) => check.status === "fail");
  failedInternalOutliers.forEach((check) => invalidReasons.push(`outlier.${check.blockId}.${check.scenarioId}.${check.metric}`));
  const pairs = buildPairs(blockValues);
  const primary = buildPrimaryComparisons(pairs);
  const driftChecks = buildDriftChecks(blockValues);
  driftChecks.filter((check) => check.status === "fail").forEach((check) => {
    invalidReasons.push(`drift.${check.id}.${check.scenarioId}.${check.metric}`);
  });
  const directionVetoes = buildDirectionVetoes(pairs);
  directionVetoes.forEach((check) => invalidReasons.push(`direction.${check.scenarioId}.${check.metric}`));

  const validRegressionMetrics = [];
  for (const scenarioId of WILLIAMS_SCENARIOS) {
    for (const metric of METRICS) {
      const comparison = primary[scenarioId]?.[metric.id];
      if (!comparison || comparison.pairCount !== 4 || comparison.deltaMs === null || comparison.deltaPercent === null) {
        invalidReasons.push(`primary.${scenarioId}.${metric.id}.missing`);
        continue;
      }
      if (comparison.practicalRegressionCount === 2) {
        invalidReasons.push(`primary.${scenarioId}.${metric.id}.two-of-four-regressions`);
      } else if (comparison.practicalRegressionCount >= 3) {
        validRegressionMetrics.push({ scenarioId, metric: metric.id, ...comparison });
      } else if (comparison.direction === "regression") {
        invalidReasons.push(`primary.${scenarioId}.${metric.id}.inconsistent-primary-regression`);
      }
    }
  }

  const dedupedInvalidReasons = [...new Set(invalidReasons)];
  const decision = dedupedInvalidReasons.length
    ? {
      status: "invalid-experiment",
      admitted: false,
      exitCode: WILLIAMS_EXIT_CODES.invalidExperiment,
      invalidReasons: dedupedInvalidReasons,
      regressions: validRegressionMetrics,
    }
    : validRegressionMetrics.length
      ? {
        status: "valid-regression",
        admitted: false,
        exitCode: WILLIAMS_EXIT_CODES.validRegression,
        invalidReasons: [],
        regressions: validRegressionMetrics,
      }
      : {
        status: "accepted",
        admitted: true,
        exitCode: WILLIAMS_EXIT_CODES.accepted,
        invalidReasons: [],
        regressions: [],
      };

  return {
    schemaVersion: WILLIAMS_CROSSOVER_SCHEMA_VERSION,
    policyId: WILLIAMS_CROSSOVER_POLICY_ID,
    renderSampleRole: {
      policyId: RENDER_SAMPLE_ROLE_POLICY_ID,
      canonicalRoleId: CANONICAL_RENDER_SAMPLE_ROLE_ID,
    },
    preregistration,
    manifestValidation,
    blocks: normalizedBlocks,
    pairs,
    primary,
    sameSideSameOrderDrift: driftChecks,
    internalOutliers,
    telemetryAdmission: telemetryAdmission.summary,
    directionVetoes,
    legacyPooledMedian: buildLegacyPooledDiagnostic(normalizedBlocks),
    decision,
  };
}
