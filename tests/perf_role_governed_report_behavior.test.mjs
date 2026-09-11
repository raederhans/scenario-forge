import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  buildGovernedCompanionReport,
  buildRawHashManifestSha256,
  buildMarkdown,
  buildRawPerformanceMetricIntegrity,
  evaluateGovernedDecision,
} from "../tools/perf/analyze_render_sample_roles.mjs";
import {
  annotatePerfErrorWithDiagnostics,
  collectBaselineContractMismatches,
  collectGovernedRenderSampleRoleMismatches,
  getBaselineArtifactDate,
  isTransientPerfNetworkFailure,
  normalizePerfRegressionMode,
  parseArgs,
  readJsonAndSha256Strict,
  runStandardPerfAdmission,
  runStandardPerfGenerationFence,
  runWithTransientPerfNetworkRetry,
  resolveMeasuredRepoRoot,
  sha256CanonicalTextFile,
  shouldBlockOnPerfRegressions,
  summarizeSnapshot,
  validateGateBaselineReport,
  validateGateBaselinePreflight,
  validateBaselineOutputSelection,
  validateGateCurrentReport,
  validateGateScenarioSelection,
  validateRenderSampleRunProfileSelection,
} from "../tools/perf/run_baseline.mjs";
import {
  STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID,
  WILLIAMS_CROSSOVER_RENDER_SAMPLE_RUN_PROFILE_ID,
  summarizeRenderSampleRoleAnalyses,
} from "../tools/perf/render_sample_role_policy.mjs";
import { buildWilliamsExecutionPlan } from "../tools/perf/run_williams_crossover.mjs";
import {
  PerfEnvironmentAdmissionError,
  PerfGenerationFenceError,
  STANDARD_PERF_ADMISSION_EXIT_CODES,
  STANDARD_PERF_ADMISSION_POLICY,
  classifyPerfDirtyPaths,
  collectStandardPerfAdmissionEvidence,
  evaluateStandardPerfAdmission,
  evaluateStandardPerfGenerationFence,
  parseGitPorcelainZ,
  summarizePerfAdmissionCpu,
  validateStandardPerfAdmissionDecision,
} from "../tools/perf/standard_perf_admission.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FIXTURE_GIT_HEAD = "f".repeat(40);
const BLOCK_SEQUENCE = Object.freeze(["A1", "B1", "B2", "A2"]);
const SCENARIOS = Object.freeze(["tno_1962", "hoi4_1939"]);
const CANONICAL_RENDER_MS = Object.freeze({
  tno_1962: Object.freeze({ A: 1197.9000000059605, B: 1195.3499999940395 }),
  hoi4_1939: Object.freeze({ A: 694.5500000119209, B: 694.8000000119209 }),
});
const CANONICAL_RENDER_OFFSETS = Object.freeze([-4, -3, -2, -1, 0, 0, 1, 2, 3, 4]);

function sha256(bytes) {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

function sha256JsonArtifact(payload) {
  return sha256(Buffer.from(`${JSON.stringify(payload, null, 2)}\n`, "utf8"));
}

function bindReportRawEvidenceHashes(report) {
  const root = report.rawEvidence.root;
  report.rawEvidence.environmentAdmission = {
    rawPath: `${root}/perf-admission.json`,
    rawSha256: sha256JsonArtifact(report.environmentAdmission),
  };
  report.rawEvidence.generationFence = {
    rawPath: `${root}/perf-generation-fence.json`,
    rawSha256: sha256JsonArtifact(report.generationFence),
  };
  let measuredRunCount = 0;
  for (const [scenarioId, scenario] of Object.entries(report.scenarios || {})) {
    for (const [runIndex, run] of (scenario.runs || []).entries()) {
      const rawPayload = structuredClone(run);
      delete rawPayload.rawPath;
      delete rawPayload.rawSha256;
      run.rawPath = `${root}/${scenarioId}/run-${String(runIndex + 1).padStart(2, "0")}.json`;
      run.rawSha256 = sha256JsonArtifact(rawPayload);
      measuredRunCount += 1;
    }
  }
  report.rawEvidence.measuredRunCount = measuredRunCount;
  return report;
}

function toRepoPath(filePath) {
  return path.relative(REPO_ROOT, filePath).replaceAll("\\", "/");
}

function buildExpectedRawManifestSha256(rawFiles) {
  const rows = rawFiles
    .map((entry) => `${entry.path}\0${entry.sha256}\n`)
    .sort();
  return sha256(Buffer.from(rows.join(""), "utf8"));
}

async function writeJson(filePath, payload) {
  const bytes = Buffer.from(JSON.stringify(payload), "utf8");
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, bytes);
  return sha256(bytes);
}

function buildSourceReport() {
  const controlCommit = "a".repeat(40);
  const candidateCommit = "b".repeat(40);
  const blocks = Object.fromEntries(BLOCK_SEQUENCE.map((block) => {
    const side = block.startsWith("A") ? "A" : "B";
    const expectedHead = side === "A" ? controlCommit : candidateCommit;
    return [block, {
      block,
      side,
      valid: true,
      exitCode: 0,
      reasons: [],
      quietAttempts: [{ pass: true }],
      listenersAfter: { port8000: [], port8892: [] },
      taskOwnedChromiumAfter: [],
      runnerSha256: "c".repeat(64),
      packageLockSha256: "d".repeat(64),
      urlQuery: { perf: "1" },
      workloadIdentity: { scenarios: SCENARIOS },
      environment: { platform: "test-fixture" },
      headMatches: true,
      head: expectedHead,
      expectedHead,
    }];
  }));
  return {
    generatedAt: "2026-07-11T00:00:00.000Z",
    experiment: { controlCommit, candidateCommit },
    blocks,
    decision: { status: "failed/blocked", admitted: false },
    promotionClassification: { materialGap: false },
    pooledRegressions: [],
  };
}

function makeStandardPerfAdmissionEvidence(overrides = {}) {
  return {
    schemaVersion: 1,
    platform: "win32",
    cpuSamples: [8, 10, 12, 9, 11, 10, 13],
    topProcesses: [
      { pid: 100, name: "background.exe", singleCorePercent: 4 },
    ],
    memoryAvailableMiB: 32_768,
    power: {
      status: "available",
      activeSchemeGuid: "381b4222-f694-41f0-9685-ff5bb260df2e",
      activeSchemeName: "Balanced",
      acLineStatus: 1,
    },
    git: {
      status: "available",
      head: FIXTURE_GIT_HEAD,
      entries: [],
    },
    degradedCapabilities: [],
    ...overrides,
  };
}

function makeAdmittedEnvironmentAdmission() {
  return {
    schemaVersion: 1,
    policyId: STANDARD_PERF_ADMISSION_POLICY.policyId,
    status: "admitted",
    exitCode: STANDARD_PERF_ADMISSION_EXIT_CODES.accepted,
    failures: [],
    thresholds: { ...STANDARD_PERF_ADMISSION_POLICY },
    cpu: {
      valid: true,
      sampleCount: STANDARD_PERF_ADMISSION_POLICY.sampleCount,
      samples: [8, 10, 12, 9, 11, 10, 13],
      averagePercent: 10.4,
      peakPercent: 13,
    },
    topProcesses: [
      { pid: 100, name: "background.exe", singleCorePercent: 4 },
    ],
    platform: "win32",
    memoryAvailableMiB: 32_768,
    degradedCapabilities: [],
    git: {
      status: "available",
      head: FIXTURE_GIT_HEAD,
      runtimePaths: [],
      harnessPaths: [],
      allowedPaths: [],
      invalidPaths: [],
    },
    power: {
      status: "available",
      activeSchemeGuid: "381b4222-f694-41f0-9685-ff5bb260df2e",
      acLineStatus: 1,
    },
  };
}

function makeStableGenerationFence({
  baselineOracleBeforeSha256 = null,
  baselineOracleAfterSha256 = null,
} = {}) {
  return {
    schemaVersion: 1,
    policyId: "standard-perf-generation-fence-v1",
    status: "stable",
    exitCode: STANDARD_PERF_ADMISSION_EXIT_CODES.accepted,
    failures: [],
    git: {
      status: "available",
      head: FIXTURE_GIT_HEAD,
      runtimePaths: [],
      harnessPaths: [],
      allowedPaths: [],
      invalidPaths: [],
    },
    power: {
      status: "available",
      activeSchemeGuid: "381b4222-f694-41f0-9685-ff5bb260df2e",
      acLineStatus: 1,
    },
    baselineOracle: {
      beforeSha256: baselineOracleBeforeSha256,
      afterSha256: baselineOracleAfterSha256,
    },
  };
}

test("standard perf admission accepts a clean quiet AC-powered window", () => {
  const decision = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence());

  assert.equal(decision.policyId, "standard-perf-admission-v1");
  assert.equal(decision.status, "admitted");
  assert.equal(decision.exitCode, STANDARD_PERF_ADMISSION_EXIT_CODES.accepted);
  assert.deepEqual(decision.failures, []);
  assert.equal(decision.cpu.averagePercent, 10.4);
  assert.equal(decision.cpu.peakPercent, 13);
  assert.equal(Object.isFrozen(decision), true);
  assert.doesNotThrow(() => JSON.stringify(decision));
});

test("standard perf admission rejects invalid and overloaded CPU evidence with stable reasons", () => {
  const overloaded = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence({
    cpuSamples: [10, 15, 18, 22, 28, 40, 45],
    topProcesses: [{ pid: 200, name: "busy.exe", singleCorePercent: 125 }],
  }));

  assert.equal(overloaded.status, "rejected");
  assert.equal(overloaded.exitCode, STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected);
  assert.deepEqual(overloaded.failures.map((entry) => entry.code), [
    "cpu-average-high",
    "cpu-peak-high",
    "top-process-high",
  ]);

  const invalid = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence({
    cpuSamples: [10, Number.NaN],
  }));
  assert.deepEqual(invalid.failures.map((entry) => entry.code), ["cpu-samples-invalid"]);

  const coerced = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence({
    cpuSamples: [8, 10, 12, 9, 11, 10, "13"],
    topProcesses: [{ pid: 200, name: "busy.exe", singleCorePercent: "125" }],
    memoryAvailableMiB: "32768",
  }));
  assert.deepEqual(coerced.failures.map((entry) => entry.code), [
    "cpu-samples-invalid",
    "top-process-evidence-invalid",
    "memory-available-invalid",
  ]);
});

test("standard perf admission rejects unavailable Windows power evidence and known battery use", () => {
  const degraded = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence({
    power: { status: "collection-error", activeSchemeGuid: "", activeSchemeName: "", acLineStatus: 255 },
    degradedCapabilities: ["windows-power"],
  }));
  assert.equal(degraded.status, "rejected");
  assert.deepEqual(degraded.failures.map((entry) => entry.code), ["windows-power-evidence-unavailable"]);
  assert.deepEqual(degraded.degradedCapabilities, ["windows-power"]);

  const onBattery = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence({
    power: {
      status: "available",
      activeSchemeGuid: "381b4222-f694-41f0-9685-ff5bb260df2e",
      activeSchemeName: "Balanced",
      acLineStatus: 0,
    },
    memoryAvailableMiB: 1024,
  }));
  assert.deepEqual(onBattery.failures.map((entry) => entry.code), [
    "memory-available-low",
    "ac-power-required",
  ]);

  const malformed = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence({
    power: { status: "available", activeSchemeGuid: "", activeSchemeName: "", acLineStatus: 255 },
  }));
  assert.deepEqual(malformed.failures.map((entry) => entry.code), [
    "power-scheme-invalid",
    "ac-power-evidence-invalid",
  ]);
});

test("standard perf admission rejects unavailable Windows process evidence", () => {
  const decision = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence({
    topProcesses: [],
    degradedCapabilities: ["windows-processes"],
  }));

  assert.deepEqual(decision.failures.map((entry) => entry.code), [
    "windows-process-evidence-unavailable",
  ]);
  assert.equal(decision.exitCode, STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected);
});

test("standard perf dirty parser classifies runtime and harness paths without blocking evidence-only files", () => {
  const entries = parseGitPorcelainZ(
    " M js/core/map_renderer.js\0?? docs/perf/note.md\0R  JS/core/new.js\0js/core/old.js\0?? tests/e2e/support/local-helper.js\0?? dist/app.js\0",
    { platform: "win32" },
  );
  const classified = classifyPerfDirtyPaths(entries, { platform: "win32" });

  assert.deepEqual(classified.runtimePaths, [
    "JS/core/new.js",
    "js/core/map_renderer.js",
    "js/core/old.js",
  ]);
  assert.deepEqual(classified.harnessPaths, ["tests/e2e/support/local-helper.js"]);
  assert.deepEqual(classified.allowedPaths, ["dist/app.js", "docs/perf/note.md"]);
  assert.deepEqual(classified.invalidPaths, []);
});

test("standard perf dirty parser rejects truncated pairs and repository-escape paths", () => {
  const truncated = classifyPerfDirtyPaths(
    parseGitPorcelainZ("R  docs/new.md\0", { platform: "win32" }),
    { platform: "win32" },
  );
  assert.deepEqual(truncated.invalidPaths, ["docs/new.md"]);

  const entries = parseGitPorcelainZ(
    "?? ../escape.js\0?? C:outside.txt\0?? /absolute.txt\0",
    { platform: "win32" },
  );
  const classified = classifyPerfDirtyPaths(entries, { platform: "win32" });

  assert.deepEqual(classified.allowedPaths, []);
  assert.deepEqual(classified.invalidPaths, [
    "../escape.js",
    "/absolute.txt",
    "C:outside.txt",
  ]);
});

test("standard perf dirty parser preserves both copy endpoints", () => {
  const entries = parseGitPorcelainZ(
    "C  docs/copied.md\0tools/perf/source.mjs\0",
    { platform: "win32" },
  );
  const classified = classifyPerfDirtyPaths(entries, { platform: "win32" });

  assert.deepEqual(classified.harnessPaths, ["tools/perf/source.mjs"]);
  assert.deepEqual(classified.allowedPaths, ["docs/copied.md"]);
  assert.deepEqual(classified.invalidPaths, []);
});

test("standard perf dirty parser treats the checked-in baseline oracle as measurement harness", () => {
  const entries = parseGitPorcelainZ(
    " M docs/perf/baseline_2026-07-30.json\0?? docs/perf/note.md\0",
    { platform: "win32" },
  );
  const classified = classifyPerfDirtyPaths(entries, { platform: "win32" });

  assert.deepEqual(classified.harnessPaths, ["docs/perf/baseline_2026-07-30.json"]);
  assert.deepEqual(classified.allowedPaths, ["docs/perf/note.md"]);
});

test("standard perf admission rejects dirty measured sources and exposes typed exit three", () => {
  const entries = parseGitPorcelainZ("M  package.json\0?? tests/ordinary.test.mjs\0", { platform: "win32" });
  const decision = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence({
    git: { status: "available", head: FIXTURE_GIT_HEAD, entries },
  }));

  assert.deepEqual(decision.failures.map((entry) => entry.code), ["dirty-measurement-harness"]);
  const error = new PerfEnvironmentAdmissionError(decision);
  assert.equal(error.exitCode, STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected);
  assert.match(error.message, /environment admission rejected/i);
});

test("standard perf admission preserves exact policy threshold edges", () => {
  const samples = [10, 15, 15, 20, 20, 25, 35];
  const summary = summarizePerfAdmissionCpu(samples);
  assert.equal(summary.peakPercent, 35);
  assert.equal(summary.averagePercent, 20);
  assert.equal(summary.sampleCount, STANDARD_PERF_ADMISSION_POLICY.sampleCount);
  assert.equal(summary.valid, true);

  const decision = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence({
    cpuSamples: samples,
    topProcesses: [{ pid: 100, name: "boundary.exe", singleCorePercent: 25 }],
    memoryAvailableMiB: 4096,
  }));
  assert.equal(decision.status, "admitted");
});

test("standard perf admission remains valid after JSON evidence roundtrip", () => {
  const decision = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence({
    cpuSamples: [19.36, 20.06, 11.06, 10.26, 12.76, 12.86, 8.96],
  }));
  const persistedDecision = JSON.parse(JSON.stringify(decision));

  assert.equal(decision.status, "admitted");
  assert.equal(validateStandardPerfAdmissionDecision(persistedDecision, {
    expectedPlatform: "win32",
    expectedGitHead: FIXTURE_GIT_HEAD,
  }).valid, true);
});

test("standard perf admission writes its artifact before returning or rejecting", async (t) => {
  const tempRoot = path.join(REPO_ROOT, ".runtime", "tmp");
  await fs.mkdir(tempRoot, { recursive: true });
  const admittedDir = await fs.mkdtemp(path.join(tempRoot, "perf-admission-admitted-"));
  const rejectedDir = await fs.mkdtemp(path.join(tempRoot, "perf-admission-rejected-"));
  t.after(async () => {
    await fs.rm(admittedDir, { recursive: true, force: true });
    await fs.rm(rejectedDir, { recursive: true, force: true });
  });

  const admitted = await runStandardPerfAdmission(
    { rawDir: admittedDir },
    { collectEvidence: async () => makeStandardPerfAdmissionEvidence() },
  );
  assert.deepEqual(
    JSON.parse(await fs.readFile(path.join(admittedDir, "perf-admission.json"), "utf8")),
    admitted,
  );

  await assert.rejects(
    runStandardPerfAdmission(
      { rawDir: rejectedDir },
      { collectEvidence: async () => makeStandardPerfAdmissionEvidence({ cpuSamples: [50, 50, 50, 50, 50, 50, 50] }) },
    ),
    (error) => error instanceof PerfEnvironmentAdmissionError
      && error.exitCode === STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected,
  );
  const rejected = JSON.parse(await fs.readFile(path.join(rejectedDir, "perf-admission.json"), "utf8"));
  assert.equal(rejected.status, "rejected");
  assert.equal(rejected.exitCode, STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected);
});

test("standard perf admission collector converts command failures into structured evidence", async () => {
  let cpuTick = 0;
  const fakeOs = {
    cpus() {
      cpuTick += 1;
      return [{ times: { idle: cpuTick * 90, user: cpuTick * 10, nice: 0, sys: 0, irq: 0 } }];
    },
    freemem() {
      return 16 * 1024 ** 3;
    },
  };
  const evidence = await collectStandardPerfAdmissionEvidence({
    cwd: REPO_ROOT,
    platform: "win32",
    osModule: fakeOs,
    spawnSyncFn(command) {
      if (command === "git") throw new Error("git unavailable");
      return { status: 1, stdout: "", stderr: "fixture unavailable", error: null };
    },
    sleep: async () => {},
    policy: { ...STANDARD_PERF_ADMISSION_POLICY, sampleCount: 1, sampleIntervalMs: 0 },
  });

  assert.deepEqual(evidence.degradedCapabilities, ["windows-power", "windows-processes"]);
  assert.equal(evidence.git.status, "collection-error");
  const decision = evaluateStandardPerfAdmission(evidence, {
    ...STANDARD_PERF_ADMISSION_POLICY,
    sampleCount: 1,
    sampleIntervalMs: 0,
  });
  assert.deepEqual(decision.failures.map((entry) => entry.code), [
    "windows-process-evidence-unavailable",
    "windows-power-evidence-unavailable",
    "git-status-unavailable",
  ]);
  assert.equal(decision.exitCode, STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected);
});

test("standard perf admission collector rejects a high-CPU process that starts inside the sample window", async () => {
  let cpuTick = 0;
  let processSnapshotIndex = 0;
  let nowMs = 10_000;
  const fakeOs = {
    cpus() {
      cpuTick += 1;
      return [{ times: { idle: cpuTick * 90, user: cpuTick * 10, nice: 0, sys: 0, irq: 0 } }];
    },
    freemem() {
      return 16 * 1024 ** 3;
    },
  };
  const evidence = await collectStandardPerfAdmissionEvidence({
    cwd: REPO_ROOT,
    platform: "win32",
    osModule: fakeOs,
    sleep: async () => {},
    now: () => nowMs,
    collectProcessSnapshot: () => {
      processSnapshotIndex += 1;
      if (processSnapshotIndex === 1) return [{ Id: 10, ProcessName: "base", CPU: 1 }];
      nowMs += 1_000;
      return [
        { Id: 10, ProcessName: "base", CPU: 1 },
        { Id: 20, ProcessName: "new-busy", CPU: 0.3 },
      ];
    },
    collectStabilityEvidence: () => ({
      platform: "win32",
      power: {
        status: "available",
        activeSchemeGuid: "381b4222-f694-41f0-9685-ff5bb260df2e",
        activeSchemeName: "Balanced",
        acLineStatus: 1,
      },
      git: { status: "available", head: FIXTURE_GIT_HEAD, entries: [] },
      degradedCapabilities: [],
    }),
    policy: { ...STANDARD_PERF_ADMISSION_POLICY, sampleCount: 1, sampleIntervalMs: 0 },
  });

  assert.deepEqual(evidence.topProcesses, [
    { pid: 20, name: "new-busy", singleCorePercent: 30 },
  ]);
  const decision = evaluateStandardPerfAdmission(evidence, {
    ...STANDARD_PERF_ADMISSION_POLICY,
    sampleCount: 1,
    sampleIntervalMs: 0,
  });
  assert.deepEqual(decision.failures.map((entry) => entry.code), ["top-process-high"]);
});

test("standard perf admission collector rejects empty Windows process snapshots", async () => {
  let cpuTick = 0;
  const evidence = await collectStandardPerfAdmissionEvidence({
    cwd: REPO_ROOT,
    platform: "win32",
    osModule: {
      cpus() {
        cpuTick += 1;
        return [{ times: { idle: cpuTick * 90, user: cpuTick * 10, nice: 0, sys: 0, irq: 0 } }];
      },
      freemem() {
        return 16 * 1024 ** 3;
      },
    },
    sleep: async () => {},
    collectProcessSnapshot: () => [],
    collectStabilityEvidence: () => ({
      platform: "win32",
      power: {
        status: "available",
        activeSchemeGuid: "381b4222-f694-41f0-9685-ff5bb260df2e",
        activeSchemeName: "Balanced",
        acLineStatus: 1,
      },
      git: { status: "available", head: FIXTURE_GIT_HEAD, entries: [] },
      degradedCapabilities: [],
    }),
    policy: { ...STANDARD_PERF_ADMISSION_POLICY, sampleCount: 1, sampleIntervalMs: 0 },
  });

  assert.deepEqual(evidence.degradedCapabilities, ["windows-processes"]);
  assert.deepEqual(
    evaluateStandardPerfAdmission(evidence, {
      ...STANDARD_PERF_ADMISSION_POLICY,
      sampleCount: 1,
      sampleIntervalMs: 0,
    }).failures.map((entry) => entry.code),
    ["windows-process-evidence-unavailable"],
  );
});

test("standard perf generation fence binds head clean sources power and baseline oracle", () => {
  const admission = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence());
  const stableEvidence = {
    platform: "win32",
    collectedAt: "2026-07-31T00:00:00.000Z",
    git: { status: "available", head: FIXTURE_GIT_HEAD, entries: [] },
    power: {
      status: "available",
      activeSchemeGuid: "381b4222-f694-41f0-9685-ff5bb260df2e",
      acLineStatus: 1,
    },
    degradedCapabilities: [],
  };
  const oracleSha = "a".repeat(64);
  const stable = evaluateStandardPerfGenerationFence(admission, stableEvidence, {
    baselineOracleBeforeSha256: oracleSha,
    baselineOracleAfterSha256: oracleSha,
  });
  assert.equal(stable.status, "stable");
  assert.deepEqual(stable.failures, []);

  const rejected = evaluateStandardPerfGenerationFence(admission, {
    ...stableEvidence,
    git: {
      status: "available",
      head: "e".repeat(40),
      entries: parseGitPorcelainZ(" M js/main.js\0", { platform: "win32" }),
    },
    power: {
      status: "available",
      activeSchemeGuid: "a1841308-3541-4fab-bc81-f71556f20b4a",
      acLineStatus: 1,
    },
  }, {
    baselineOracleBeforeSha256: oracleSha,
    baselineOracleAfterSha256: "b".repeat(64),
  });
  assert.deepEqual(rejected.failures.map((entry) => entry.code), [
    "git-head-changed",
    "dirty-runtime-source",
    "power-scheme-changed",
    "baseline-oracle-changed",
  ]);
  assert.equal(rejected.exitCode, STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected);
});

test("standard perf generation fence writes its artifact before rejecting", async (t) => {
  const tempRoot = path.join(REPO_ROOT, ".runtime", "tmp");
  await fs.mkdir(tempRoot, { recursive: true });
  const rawDir = await fs.mkdtemp(path.join(tempRoot, "perf-generation-fence-"));
  t.after(async () => {
    await fs.rm(rawDir, { recursive: true, force: true });
  });
  const admission = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence());

  await assert.rejects(
    runStandardPerfGenerationFence(
      { mode: "gate", rawDir, baselineJson: "fixture.json" },
      admission,
      {
        baselineOracleBeforeSha256: "a".repeat(64),
        collectStabilityEvidence: async () => ({
          platform: "win32",
          git: { status: "available", head: "e".repeat(40), entries: [] },
          power: admission.power,
          degradedCapabilities: [],
        }),
        readBaselineOracleSha256: async () => "a".repeat(64),
      },
    ),
    (error) => error instanceof PerfGenerationFenceError
      && error.exitCode === STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected,
  );
  const rejected = JSON.parse(await fs.readFile(path.join(rawDir, "perf-generation-fence.json"), "utf8"));
  assert.equal(rejected.status, "rejected");
  assert.deepEqual(rejected.failures.map((entry) => entry.code), ["git-head-changed"]);
});

test("standard perf generation fence writes a rejection artifact when the gate oracle becomes unreadable", async (t) => {
  const tempRoot = path.join(REPO_ROOT, ".runtime", "tmp");
  await fs.mkdir(tempRoot, { recursive: true });
  const rawDir = await fs.mkdtemp(path.join(tempRoot, "perf-generation-fence-oracle-read-"));
  t.after(async () => {
    await fs.rm(rawDir, { recursive: true, force: true });
  });
  const admission = evaluateStandardPerfAdmission(makeStandardPerfAdmissionEvidence());

  await assert.rejects(
    runStandardPerfGenerationFence(
      { mode: "gate", rawDir, baselineJson: "fixture.json" },
      admission,
      {
        baselineOracleBeforeSha256: "a".repeat(64),
        collectStabilityEvidence: async () => ({
          platform: "win32",
          git: { status: "available", head: FIXTURE_GIT_HEAD, entries: [] },
          power: admission.power,
          degradedCapabilities: [],
        }),
        readBaselineOracleSha256: async () => {
          const error = new Error("oracle locked");
          error.code = "EBUSY";
          throw error;
        },
      },
    ),
    (error) => error instanceof PerfGenerationFenceError
      && error.exitCode === STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected,
  );
  const rejected = JSON.parse(await fs.readFile(path.join(rawDir, "perf-generation-fence.json"), "utf8"));
  assert.equal(rejected.status, "rejected");
  assert.deepEqual(rejected.failures.map((entry) => entry.code), ["baseline-oracle-changed"]);
  assert.equal(rejected.baselineOracle.afterSha256, null);
});

test("standard perf admission oracle validator recomputes raw evidence", () => {
  const admitted = makeAdmittedEnvironmentAdmission();
  assert.equal(validateStandardPerfAdmissionDecision(admitted, {
    expectedPlatform: "win32",
    expectedGitHead: FIXTURE_GIT_HEAD,
  }).valid, true);

  const forgedCpu = structuredClone(admitted);
  forgedCpu.cpu.samples = Array(7).fill(100);
  assert.deepEqual(
    validateStandardPerfAdmissionDecision(forgedCpu, { expectedPlatform: "win32", expectedGitHead: FIXTURE_GIT_HEAD }).reasons,
    ["cpu-evidence-invalid"],
  );

  const forgedProcess = structuredClone(admitted);
  forgedProcess.topProcesses[0].singleCorePercent = 999;
  assert.deepEqual(
    validateStandardPerfAdmissionDecision(forgedProcess, { expectedPlatform: "win32", expectedGitHead: FIXTURE_GIT_HEAD }).reasons,
    ["top-process-evidence-invalid"],
  );

  const forgedMemory = structuredClone(admitted);
  forgedMemory.memoryAvailableMiB = 1;
  assert.deepEqual(
    validateStandardPerfAdmissionDecision(forgedMemory, { expectedPlatform: "win32", expectedGitHead: FIXTURE_GIT_HEAD }).reasons,
    ["memory-evidence-invalid"],
  );

  const forgedPlatform = structuredClone(admitted);
  forgedPlatform.platform = "linux";
  assert.deepEqual(
    validateStandardPerfAdmissionDecision(forgedPlatform, { expectedPlatform: "win32", expectedGitHead: FIXTURE_GIT_HEAD }).reasons,
    ["platform-evidence-invalid"],
  );
});

test("gate baseline JSON and oracle hash come from one byte read", async () => {
  const originalBytes = Buffer.from('{"schemaVersion":3,"marker":"original"}\n', "utf8");
  const replacementBytes = Buffer.from('{"schemaVersion":3,"marker":"replacement"}\n', "utf8");
  let readCount = 0;
  const result = await readJsonAndSha256Strict("fixture.json", "baseline report", {
    readFile: async () => {
      readCount += 1;
      return readCount === 1 ? originalBytes : replacementBytes;
    },
  });

  assert.equal(readCount, 1);
  assert.equal(result.payload.marker, "original");
  assert.equal(result.sha256, crypto.createHash("sha256").update(originalBytes).digest("hex"));
});

test("package-lock identity is stable across LF and CRLF checkouts", async () => {
  const lfText = '{"lockfileVersion":3}\n';
  const crlfText = lfText.replaceAll("\n", "\r\n");
  const expected = crypto.createHash("sha256").update(lfText, "utf8").digest("hex");

  assert.equal(
    await sha256CanonicalTextFile("package-lock.json", { readFile: async () => lfText }),
    expected,
  );
  assert.equal(
    await sha256CanonicalTextFile("package-lock.json", { readFile: async () => crlfText }),
    expected,
  );
});

function buildRawRun({ scenarioId, side, sideScenarioIndex, firstSampleHasScenario }) {
  const canonicalRenderSampleMs = CANONICAL_RENDER_MS[scenarioId][side]
    + CANONICAL_RENDER_OFFSETS[sideScenarioIndex];
  const firstRenderSampleMs = canonicalRenderSampleMs / 2;
  return {
    summary: {
      totalStartupMs: scenarioId === "tno_1962" ? 1000 : 800,
      renderSampleMedianMs: (firstRenderSampleMs + canonicalRenderSampleMs) / 2,
      scenarioChunkPromotionVisualStageMs: 100,
    },
    snapshot: {
      renderPerfMetrics: {
        scenarioChunkPromotionVisualStage: { recordedAt: 200 },
      },
      renderSamples: {
        count: 2,
        medianMs: (firstRenderSampleMs + canonicalRenderSampleMs) / 2,
        samples: [
          {
            sequence: 1,
            durationMs: firstRenderSampleMs,
            recordedAt: 100,
            activeScenarioId: scenarioId,
            phase: "idle",
            politicalBgProgressive: false,
            contextScenarioMs: firstSampleHasScenario ? 10 : 0,
          },
          {
            sequence: 2,
            durationMs: canonicalRenderSampleMs,
            recordedAt: 300,
            activeScenarioId: scenarioId,
            phase: "idle",
            politicalBgProgressive: true,
            contextScenarioMs: 600,
          },
        ],
      },
    },
  };
}

async function materializeGovernedFixture(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "render-role-governed-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const sourceReportPath = path.join(root, "source-report.json");
  const experimentRoot = path.join(root, "experiment");
  const expectedSourceSha256 = await writeJson(sourceReportPath, buildSourceReport());
  const rawFiles = [];
  const sideScenarioIndexes = { A: { tno_1962: 0, hoi4_1939: 0 }, B: { tno_1962: 0, hoi4_1939: 0 } };

  for (const block of BLOCK_SEQUENCE) {
    const side = block.startsWith("A") ? "A" : "B";
    for (const scenarioId of SCENARIOS) {
      for (let runNumber = 1; runNumber <= 5; runNumber += 1) {
        const sideScenarioIndex = sideScenarioIndexes[side][scenarioId];
        sideScenarioIndexes[side][scenarioId] += 1;
        const scenarioFirstSampleCount = scenarioId === "tno_1962" ? (side === "A" ? 4 : 7) : 5;
        const filePath = path.join(
          experimentRoot,
          side,
          block,
          "raw",
          scenarioId,
          `run-${String(runNumber).padStart(2, "0")}.json`
        );
        const rawSha256 = await writeJson(filePath, buildRawRun({
          scenarioId,
          side,
          sideScenarioIndex,
          firstSampleHasScenario: sideScenarioIndex < scenarioFirstSampleCount,
        }));
        rawFiles.push({ path: toRepoPath(filePath), sha256: rawSha256 });
      }
    }
  }

  return {
    sourceReportPath,
    experimentRoot,
    expectedSourceSha256,
    expectedRawManifestSha256: buildExpectedRawManifestSha256(rawFiles),
  };
}

test("governed companion reproduces canonical role medians from a hermetic synthetic 40-run fixture", async (t) => {
  const fixture = await materializeGovernedFixture(t);
  const report = await buildGovernedCompanionReport(fixture);
  assert.equal(report.reportId, "p2-1-performance-ab-governed-v2-20260711");
  assert.equal(report.policy.policyId, "render-sample-role-v2");
  assert.ok(report.policy.predicates.includes("sample sequences are contiguous from 1 through N"));
  assert.ok(report.policy.predicates.includes("every sample before the canonical candidate is recorded before chunk promotion"));
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

test("raw hash manifest binds path and content hashes as one trusted identity", () => {
  const files = [
    { path: ".runtime/output/a.json", sha256: "a".repeat(64) },
    { path: ".runtime/output/b.json", sha256: "b".repeat(64) },
  ];
  const expected = buildRawHashManifestSha256(files);
  assert.equal(buildRawHashManifestSha256([...files].reverse()), expected);
  assert.notEqual(buildRawHashManifestSha256([
    files[0],
    { ...files[1], sha256: "c".repeat(64) },
  ]), expected);
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

test("baseline admission rejects coerced gate metrics before comparison", () => {
  const validSummary = {
    totalStartupMs: 100,
    scenarioAppliedMs: 100,
    applyScenarioBundleMs: 100,
    refreshScenarioApplyMs: 100,
    renderSampleMedianMs: 100,
  };
  for (const invalidValue of [true, [100], "100"]) {
    const report = {
      schemaVersion: 3,
      benchmarkMetricsSchemaVersion: "3.3",
      probeSchema: "mc_perf_snapshot",
      environmentAdmission: makeAdmittedEnvironmentAdmission(),
      generationFence: makeStableGenerationFence(),
      rawEvidence: {
        schemaVersion: 1,
        policyId: "standard-perf-raw-window-v1",
        mode: "baseline",
        windowId: `baseline-${FIXTURE_GIT_HEAD}-invalid-metric-fixture`,
        root: ".runtime/output/perf/invalid-metric-fixture/baseline",
        environmentAdmission: {
          rawPath: ".runtime/output/perf/invalid-metric-fixture/baseline/perf-admission.json",
          rawSha256: "d".repeat(64),
        },
        generationFence: {
          rawPath: ".runtime/output/perf/invalid-metric-fixture/baseline/perf-generation-fence.json",
          rawSha256: "e".repeat(64),
        },
        measuredRunCount: 0,
      },
      gitHead: FIXTURE_GIT_HEAD,
      mode: "baseline",
      environment: { platform: "win32" },
      config: { scenarios: ["tno_1962"] },
      scenarios: { tno_1962: { summary: { ...validSummary, totalStartupMs: invalidValue } } },
    };
    bindReportRawEvidenceHashes(report);
    assert.throws(() => validateGateBaselineReport(report, ["tno_1962"], "fixture.json"), /invalid gate metrics/);
    const currentReport = structuredClone(report);
    currentReport.mode = "gate";
    currentReport.rawEvidence.mode = "gate";
    currentReport.rawEvidence.windowId = `gate-${FIXTURE_GIT_HEAD}-invalid-metric-fixture`;
    currentReport.rawEvidence.root = ".runtime/output/perf/invalid-metric-fixture/gate";
    currentReport.generationFence = makeStableGenerationFence({
      baselineOracleBeforeSha256: "a".repeat(64),
      baselineOracleAfterSha256: "a".repeat(64),
    });
    bindReportRawEvidenceHashes(currentReport);
    assert.throws(() => validateGateCurrentReport(currentReport, ["tno_1962"], "fixture"), /invalid gate metrics/);
  }
});

test("baseline admission rejects predecessor schemas and requires the current schema-3 oracle", () => {
  const validSummary = {
    totalStartupMs: 100,
    scenarioAppliedMs: 100,
    applyScenarioBundleMs: 100,
    refreshScenarioApplyMs: 100,
    renderSampleMedianMs: 100,
  };
  for (const schemaVersion of [1, 2]) {
    const legacyReport = {
      schemaVersion,
      benchmarkMetricsSchemaVersion: "3.3",
      probeSchema: "mc_perf_snapshot",
      scenarios: { tno_1962: { summary: validSummary } },
    };
    assert.throws(
      () => validateGateBaselineReport(legacyReport, ["tno_1962"], `schema-${schemaVersion}.json`),
      /schema mismatch/,
    );
  }
});

test("baseline preflight rejects static mismatches without candidate measurements", async () => {
  const baselineJson = path.join(REPO_ROOT, "docs", "perf", "baseline_2026-07-30.json");
  const baseline = JSON.parse(await fs.readFile(baselineJson, "utf8"));
  const options = { ...baseline.config, baselineJson, scenarioShard: null,
    renderSampleRunProfileId: baseline.renderSampleRolePolicy.runProfile.id };
  assert.doesNotThrow(() => validateGateBaselinePreflight(baseline, options));
  for (const [key, value] of [["runs", 6], ["warmups", 4], ["urlQuery", { perf: 1, extra: 1 }]]) {
    assert.throws(() => validateGateBaselinePreflight(baseline, { ...options, [key]: value }), new RegExp(`${key} mismatch`));
  }
  const wrongScope = structuredClone(baseline);
  wrongScope.scope = "scenario-shard";
  wrongScope.scenarioShard = "tno_1962";
  assert.throws(() => validateGateBaselinePreflight(wrongScope, options), /scope mismatch/);
  assert.throws(() => validateGateBaselinePreflight(baseline, { ...options, scenarios: ["tno_1962"], scenarioShard: "tno_1962" }), /scenario sequence mismatch/);
  const shard = structuredClone(baseline);
  shard.scope = "scenario-shard";
  shard.scenarioShard = "tno_1962";
  shard.config.scenarios = ["tno_1962"];
  shard.workloadIdentity.scenarioIds = ["tno_1962"];
  delete shard.scenarios.hoi4_1939;
  delete shard.workloadIdentity.scenarios.hoi4_1939;
  bindReportRawEvidenceHashes(shard);
  const shardOptions = { ...options, scenarioShard: "tno_1962", scenarios: ["tno_1962"] };
  assert.doesNotThrow(() => validateGateBaselinePreflight(shard, shardOptions));
  shard.workloadIdentity.scenarioIds.push("hoi4_1939");
  assert.throws(() => validateGateBaselinePreflight(shard, shardOptions), /scenario shard workload/);
  const missingRaw = structuredClone(baseline);
  delete missingRaw.scenarios.tno_1962.runs[0].snapshot;
  assert.throws(() => validateGateBaselinePreflight(missingRaw, options), /SHA256 does not match embedded evidence/);
  const wrongPolicy = structuredClone(baseline);
  wrongPolicy.renderSampleRolePolicy.extraProtocol = "drift";
  assert.throws(() => validateGateBaselinePreflight(wrongPolicy, options), /role policy mismatch/);
});

test("performance dependency lock changes invalidate clean measurement admission", () => {
  const classified = classifyPerfDirtyPaths(parseGitPorcelainZ(" M requirements-perf.lock.txt\0"));
  assert.deepEqual(classified.harnessPaths, ["requirements-perf.lock.txt"]);
  assert.deepEqual(classified.allowedPaths, []);
});

test("baseline admission requires the exact gate scenario sequence", () => {
  const report = makeSchema3IdentityReport();
  report.config.scenarios = ["blank_base", "tno_1962", "hoi4_1939"];

  assert.throws(
    () => validateGateBaselineReport(report, ["tno_1962", "hoi4_1939"], "fixture.json"),
    /scenario sequence mismatch/,
  );
});

test("baseline admission binds five raw runs to canonical render-role evidence", async () => {
  const baselinePath = path.join(REPO_ROOT, "docs", "perf", "baseline_2026-07-30.json");
  const canonical = JSON.parse(await fs.readFile(baselinePath, "utf8"));
  assert.doesNotThrow(() => validateGateBaselineReport(canonical, SCENARIOS, baselinePath));

  const missingRawEvidence = structuredClone(canonical);
  delete missingRawEvidence.rawEvidence;
  assert.throws(
    () => validateGateBaselineReport(missingRawEvidence, SCENARIOS, baselinePath),
    /rawEvidence must bind mode=baseline under standard-perf-raw-window-v1/,
  );

  const missingRuns = structuredClone(canonical);
  delete missingRuns.scenarios.tno_1962.runs;
  assert.throws(
    () => validateGateBaselineReport(missingRuns, SCENARIOS, baselinePath),
    /rawEvidence\.measuredRunCount expected=5 actual=10/,
  );

  const shortRuns = structuredClone(canonical);
  shortRuns.scenarios.tno_1962.runs.pop();
  assert.throws(
    () => validateGateBaselineReport(shortRuns, SCENARIOS, baselinePath),
    /rawEvidence\.measuredRunCount expected=9 actual=10/,
  );

  const configuredRunDrift = structuredClone(canonical);
  configuredRunDrift.config.runs = 6;
  assert.throws(
    () => validateGateBaselineReport(configuredRunDrift, SCENARIOS, baselinePath),
    /config\.runs expected=5 actual=6/,
  );

  const storedRoleDrift = structuredClone(canonical);
  storedRoleDrift.scenarios.tno_1962.runs[0].renderSampleRole.roleMatched = false;
  bindReportRawEvidenceHashes(storedRoleDrift);
  assert.throws(
    () => validateGateBaselineReport(storedRoleDrift, SCENARIOS, baselinePath),
    /run-1\.renderSampleRole does not match raw snapshot evidence/,
  );

  const aggregateDrift = structuredClone(canonical);
  aggregateDrift.scenarios.hoi4_1939.renderSampleRoleSummary.matchedRunCount = 4;
  assert.throws(
    () => validateGateBaselineReport(aggregateDrift, SCENARIOS, baselinePath),
    /hoi4_1939\.renderSampleRoleSummary does not match raw run evidence/,
  );

  const gateSummaryDrift = structuredClone(canonical);
  gateSummaryDrift.scenarios.hoi4_1939.summary.canonicalRenderSampleMs += 1;
  assert.throws(
    () => validateGateBaselineReport(gateSummaryDrift, SCENARIOS, baselinePath),
    /hoi4_1939\.summary\.canonicalRenderSampleMs does not match raw run evidence/,
  );

  const duplicateCandidate = structuredClone(canonical);
  const renderSamples = duplicateCandidate.scenarios.tno_1962.runs[0].snapshot.renderSamples;
  renderSamples.samples.push({ ...renderSamples.samples.at(-1), sequence: renderSamples.samples.length + 1 });
  renderSamples.count = renderSamples.samples.length;
  bindReportRawEvidenceHashes(duplicateCandidate);
  assert.throws(
    () => validateGateBaselineReport(duplicateCandidate, SCENARIOS, baselinePath),
    /canonicalRole=canonical-candidate-unique/,
  );

  const forgedAdmissionSha = structuredClone(canonical);
  forgedAdmissionSha.rawEvidence.environmentAdmission.rawSha256 = "0".repeat(64);
  assert.throws(
    () => validateGateBaselineReport(forgedAdmissionSha, SCENARIOS, baselinePath),
    /environmentAdmission SHA256 does not match embedded evidence/,
  );

  const forgedFenceSha = structuredClone(canonical);
  forgedFenceSha.rawEvidence.generationFence.rawSha256 = "0".repeat(64);
  assert.throws(
    () => validateGateBaselineReport(forgedFenceSha, SCENARIOS, baselinePath),
    /generationFence SHA256 does not match embedded evidence/,
  );

  const forgedRunSha = structuredClone(canonical);
  forgedRunSha.scenarios.tno_1962.runs[0].rawSha256 = "0".repeat(64);
  assert.throws(
    () => validateGateBaselineReport(forgedRunSha, SCENARIOS, baselinePath),
    /tno_1962\.run-1 SHA256 does not match embedded evidence/,
  );

  const driftedRunPath = structuredClone(canonical);
  driftedRunPath.scenarios.tno_1962.runs[0].rawPath = `${canonical.rawEvidence.root}/hoi4_1939/run-01.json`;
  assert.throws(
    () => validateGateBaselineReport(driftedRunPath, SCENARIOS, baselinePath),
    /tno_1962\.run-1 must bind exact rawPath/,
  );
});

function bindRenderSampleRunProfile(report, profileId, measuredRunsPerScenario, reportSchemaVersion) {
  report.schemaVersion = reportSchemaVersion;
  report.renderSampleRolePolicy.runProfile = {
    id: profileId,
    measuredRunsPerScenario,
    reportSchemaVersion,
  };
  report.workloadIdentity.renderSampleRunProfileId = profileId;
  for (const scenarioId of SCENARIOS) {
    report.workloadIdentity.scenarios[scenarioId].renderSampleRunProfileId = profileId;
    report.scenarios[scenarioId].workloadIdentity.renderSampleRunProfileId = profileId;
  }
  return report;
}

function buildWilliamsTwoRunRoleReport(canonical) {
  const report = structuredClone(canonical);
  report.config.runs = 2;
  report.workloadIdentity.runs = 2;
  for (const scenarioId of SCENARIOS) {
    const scenario = report.scenarios[scenarioId];
    scenario.runs = scenario.runs.slice(0, 2);
    scenario.workloadIdentity.runs = 2;
    report.workloadIdentity.scenarios[scenarioId].runs = 2;
    const roleSummary = summarizeRenderSampleRoleAnalyses(
      scenario.runs.map((run) => run.renderSampleRole),
    );
    scenario.renderSampleRoleSummary = structuredClone(roleSummary);
    scenario.summary.canonicalRenderSampleMs = roleSummary.canonicalRenderSampleMs;
  }
  return bindRenderSampleRunProfile(
    report,
    WILLIAMS_CROSSOVER_RENDER_SAMPLE_RUN_PROFILE_ID,
    2,
    2,
  );
}

test("explicit render-sample run profiles preserve Williams two-run and standard five-run contracts", async () => {
  assert.doesNotThrow(() => validateRenderSampleRunProfileSelection({
    mode: "baseline",
    runs: 2,
    renderSampleRunProfileId: WILLIAMS_CROSSOVER_RENDER_SAMPLE_RUN_PROFILE_ID,
  }));
  assert.throws(
    () => validateRenderSampleRunProfileSelection({ mode: "baseline", runs: 2 }),
    /expected=5 actual=2/,
  );
  assert.doesNotThrow(() => validateRenderSampleRunProfileSelection({ mode: "baseline", runs: 5 }));
  assert.throws(
    () => validateRenderSampleRunProfileSelection({
      mode: "gate",
      runs: 2,
      renderSampleRunProfileId: WILLIAMS_CROSSOVER_RENDER_SAMPLE_RUN_PROFILE_ID,
    }),
    /mode expected=baseline actual=gate/,
  );

  const baselinePath = path.join(REPO_ROOT, "docs", "perf", "baseline_2026-07-30.json");
  const canonical = JSON.parse(await fs.readFile(baselinePath, "utf8"));
  const williamsReport = buildWilliamsTwoRunRoleReport(canonical);
  assert.deepEqual(
    collectGovernedRenderSampleRoleMismatches(
      williamsReport,
      SCENARIOS,
      WILLIAMS_CROSSOVER_RENDER_SAMPLE_RUN_PROFILE_ID,
    ),
    [],
  );

  const defaultTwoRun = structuredClone(williamsReport);
  defaultTwoRun.renderSampleRolePolicy.runProfile.id = STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID;
  defaultTwoRun.workloadIdentity.renderSampleRunProfileId = STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID;
  for (const scenarioId of SCENARIOS) {
    defaultTwoRun.workloadIdentity.scenarios[scenarioId].renderSampleRunProfileId = STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID;
    defaultTwoRun.scenarios[scenarioId].workloadIdentity.renderSampleRunProfileId = STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID;
  }
  assert.match(
    collectGovernedRenderSampleRoleMismatches(
      defaultTwoRun,
      SCENARIOS,
      STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID,
    ).join("\n"),
    /config\.runs expected=5 actual=2/,
  );
});

test("Williams run profile is caller-owned, symmetric, and report identity drift fails closed", async () => {
  const root = path.join(REPO_ROOT, ".runtime", "tmp", "williams-profile-plan-fixture");
  const controlWorktree = path.join(root, "control");
  const candidateWorktree = path.join(root, "candidate");
  const sharedRunner = path.join(candidateWorktree, "tools", "perf", "run_baseline.mjs");
  const plan = buildWilliamsExecutionPlan({
    rawRoot: root,
    controlHead: "a".repeat(40),
    candidateHead: "b".repeat(40),
    controlWorktree,
    candidateWorktree,
  });
  for (const block of plan.blocks) {
    assert.equal(block.command.args[0], sharedRunner, `${block.id} must use the shared candidate harness runner`);
    const measuredRootFlagIndex = block.command.args.indexOf("--measured-repo-root");
    assert.ok(measuredRootFlagIndex > 0, `${block.id} must declare the measured repo root`);
    assert.equal(block.command.args[measuredRootFlagIndex + 1], block.cwd);
    const profileFlagIndex = block.command.args.indexOf("--render-sample-run-profile");
    assert.ok(profileFlagIndex > 0, `${block.id} must declare the run profile`);
    assert.equal(
      block.command.args[profileFlagIndex + 1],
      WILLIAMS_CROSSOVER_RENDER_SAMPLE_RUN_PROFILE_ID,
    );
  }
  for (const side of ["A", "B"]) {
    assert.deepEqual(
      new Set(plan.blocks.filter((block) => block.side === side).map((block) => {
        const profileFlagIndex = block.command.args.indexOf("--render-sample-run-profile");
        return block.command.args[profileFlagIndex + 1];
      })),
      new Set([WILLIAMS_CROSSOVER_RENDER_SAMPLE_RUN_PROFILE_ID]),
    );
  }

  const baselinePath = path.join(REPO_ROOT, "docs", "perf", "baseline_2026-07-30.json");
  const canonical = JSON.parse(await fs.readFile(baselinePath, "utf8"));
  const williamsReport = buildWilliamsTwoRunRoleReport(canonical);
  const cases = [
    ["missing policy profile", (report) => { delete report.renderSampleRolePolicy.runProfile; }, /renderSampleRolePolicy\.runProfile\.id/],
    ["policy id", (report) => { report.renderSampleRolePolicy.runProfile.id = "unknown-profile"; }, /renderSampleRolePolicy\.runProfile\.id/],
    ["policy run count", (report) => { report.renderSampleRolePolicy.runProfile.measuredRunsPerScenario = 5; }, /renderSampleRolePolicy\.runProfile\.measuredRunsPerScenario/],
    ["policy report schema", (report) => { report.renderSampleRolePolicy.runProfile.reportSchemaVersion = 3; }, /renderSampleRolePolicy\.runProfile\.reportSchemaVersion/],
    ["report schema", (report) => { report.schemaVersion = 3; }, /schemaVersion expected=2 actual=3/],
    ["report identity", (report) => { report.workloadIdentity.renderSampleRunProfileId = STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID; }, /workloadIdentity\.renderSampleRunProfileId/],
    ["scenario identity", (report) => { report.scenarios.tno_1962.workloadIdentity.renderSampleRunProfileId = STANDARD_PERF_RENDER_SAMPLE_RUN_PROFILE_ID; }, /tno_1962\.workloadIdentity\.renderSampleRunProfileId/],
  ];
  for (const [label, mutate, expected] of cases) {
    const drifted = structuredClone(williamsReport);
    mutate(drifted);
    assert.match(
      collectGovernedRenderSampleRoleMismatches(
        drifted,
        SCENARIOS,
        WILLIAMS_CROSSOVER_RENDER_SAMPLE_RUN_PROFILE_ID,
      ).join("\n"),
      expected,
      label,
    );
  }
});

test("measured repo root is explicit for a shared harness and defaults to the harness checkout", () => {
  const harnessRoot = path.join(REPO_ROOT, ".runtime", "tmp", "perf-harness-root");
  const measuredRoot = path.join(REPO_ROOT, ".runtime", "tmp", "perf-measured-root");
  assert.equal(resolveMeasuredRepoRoot([], harnessRoot), path.resolve(harnessRoot));
  assert.equal(
    resolveMeasuredRepoRoot(["--measured-repo-root", measuredRoot], harnessRoot),
    path.resolve(measuredRoot),
  );
  assert.throws(
    () => resolveMeasuredRepoRoot(["--measured-repo-root"], harnessRoot),
    /requires an explicit path/,
  );
  assert.throws(
    () => resolveMeasuredRepoRoot([
      "--measured-repo-root", measuredRoot,
      "--measured-repo-root", harnessRoot,
    ], harnessRoot),
    /may only be declared once/,
  );
});

test("gate scenario selection fails before measurement unless the canonical set is exact", () => {
  assert.doesNotThrow(() => validateGateScenarioSelection(["tno_1962", "hoi4_1939"]));
  for (const scenarios of [
    ["tno_1962"],
    ["hoi4_1939", "tno_1962"],
    ["tno_1962", "tno_1962"],
    ["blank_base", "tno_1962", "hoi4_1939"],
  ]) {
    assert.throws(
      () => validateGateScenarioSelection(scenarios),
      /Gate scenarios must exactly match/,
    );
  }
});

test("browser diagnostics remain visible in both error message and logged stack", () => {
  const error = new Error("bootstrap failed");
  annotatePerfErrorWithDiagnostics(
    error,
    ".runtime/tests/playwright/perf-baseline/tno_1962-warmup-01.json",
  );

  assert.match(error.message, /Browser diagnostics: \.runtime\/tests\/playwright\/perf-baseline/);
  assert.match(error.stack, /Browser diagnostics: \.runtime\/tests\/playwright\/perf-baseline/);
});

test("regression policy blocks runtime regressions and keeps tooling-only deltas diagnostic", () => {
  const failures = [{ scenarioId: "tno_1962", metricKey: "refreshScenarioApplyMs" }];

  assert.equal(normalizePerfRegressionMode(undefined), "enforce");
  assert.equal(normalizePerfRegressionMode("enforce"), "enforce");
  assert.equal(normalizePerfRegressionMode("diagnostic"), "diagnostic");
  assert.equal(shouldBlockOnPerfRegressions("enforce", failures), true);
  assert.equal(shouldBlockOnPerfRegressions("diagnostic", failures), false);
  assert.equal(shouldBlockOnPerfRegressions("enforce", []), false);
  assert.throws(() => shouldBlockOnPerfRegressions("enforce", null), /failures must be an array/);
  assert.throws(() => normalizePerfRegressionMode("ignore"), /regression mode/);
});

// 这组用例共同锁住 allowlist 与重试上限，防止把产品启动错误误归为 runner 网络抖动。
test("explicit Chromium network-change failures get one isolated retry", async () => {
  const attempts = [];
  const result = await runWithTransientPerfNetworkRetry(async () => {
    attempts.push(attempts.length + 1);
    if (attempts.length === 1) {
      throw new Error("script request failed: net::ERR_NETWORK_CHANGED");
    }
    return "recovered";
  });

  assert.equal(result, "recovered");
  assert.deepEqual(attempts, [1, 2]);
  assert.equal(isTransientPerfNetworkFailure(new Error("net::ERR_CONNECTION_RESET")), true);
  assert.equal(isTransientPerfNetworkFailure(new Error("net::ERR_CONNECTION_FAILED")), true);
  assert.equal(isTransientPerfNetworkFailure(new Error("scenario activation mismatch")), false);
});

test("network retry stays bounded and ordinary boot failures remain fail-closed", async () => {
  let networkAttempts = 0;
  await assert.rejects(
    runWithTransientPerfNetworkRetry(async () => {
      networkAttempts += 1;
      throw new Error("net::ERR_NETWORK_CHANGED");
    }),
    /ERR_NETWORK_CHANGED/,
  );
  assert.equal(networkAttempts, 2);

  let ordinaryAttempts = 0;
  await assert.rejects(
    runWithTransientPerfNetworkRetry(async () => {
      ordinaryAttempts += 1;
      throw new Error("scenario activation mismatch");
    }),
    /scenario activation mismatch/,
  );
  assert.equal(ordinaryAttempts, 1);
});

function makeSchema3IdentityReport(mode = "baseline") {
  const rawRoot = `.runtime/output/perf/baseline_2026-07-30/${mode}`;
  const oracleSha256 = mode === "gate" ? "a".repeat(64) : null;
  const report = {
    schemaVersion: 3,
    benchmarkMetricsSchemaVersion: "3.3",
    probeSchema: "mc_perf_snapshot",
    environmentAdmission: makeAdmittedEnvironmentAdmission(),
    generationFence: makeStableGenerationFence({
      baselineOracleBeforeSha256: oracleSha256,
      baselineOracleAfterSha256: oracleSha256,
    }),
    rawEvidence: {
      schemaVersion: 1,
      policyId: "standard-perf-raw-window-v1",
      mode,
      windowId: `${mode}-${FIXTURE_GIT_HEAD}-fixture`,
      root: rawRoot,
      environmentAdmission: {
        rawPath: `${rawRoot}/perf-admission.json`,
        rawSha256: "d".repeat(64),
      },
      generationFence: {
        rawPath: `${rawRoot}/perf-generation-fence.json`,
        rawSha256: "e".repeat(64),
      },
      measuredRunCount: 0,
    },
    gitHead: FIXTURE_GIT_HEAD,
    mode,
    environment: {
      os: "win32 10.0.26200",
      platform: "win32",
      release: "10.0.26200",
      arch: "x64",
      cpuModel: "Fixture CPU",
      cpuCount: 24,
      memoryGiB: 64,
      runnerIdentity: {
        provider: "local",
        environment: "local",
        os: "win32",
        arch: "x64",
        imageOs: "win32",
        imageVersion: "10.0.26200",
      },
      node: "v22.23.0",
      nodeMajor: 22,
      browser: "chromium-headless",
      browserVersion: "145.0.7632.6",
      packageLockSha256: "a".repeat(64),
    },
    config: {
      scenarios: ["tno_1962", "hoi4_1939"],
      runs: 5,
      warmups: 3,
      urlQuery: { perf: 1 },
    },
    workloadIdentity: {
      scenarios: {
        tno_1962: {
          manifestSha256: "b".repeat(64),
          featureCount: 12865,
        },
        hoi4_1939: {
          manifestSha256: "c".repeat(64),
          featureCount: 12602,
        },
      },
    },
  };
  report.scenarios = Object.fromEntries(
    Object.entries(report.workloadIdentity.scenarios).map(([scenarioId, workloadIdentity]) => [
      scenarioId,
      { workloadIdentity: structuredClone(workloadIdentity), runs: [] },
    ]),
  );
  return bindReportRawEvidenceHashes(report);
}

test("schema-3 generation fence binds oracle hashes to report mode", () => {
  const gateWithEmptyOracle = makeSchema3IdentityReport();
  gateWithEmptyOracle.mode = "gate";
  assert.throws(
    () => validateGateBaselineReport(gateWithEmptyOracle, [], "gate fixture"),
    /generationFence/,
  );

  const baselineWithGateOracle = makeSchema3IdentityReport();
  baselineWithGateOracle.generationFence = makeStableGenerationFence({
    baselineOracleBeforeSha256: "a".repeat(64),
    baselineOracleAfterSha256: "a".repeat(64),
  });
  assert.throws(
    () => validateGateBaselineReport(baselineWithGateOracle, [], "baseline fixture"),
    /generationFence/,
  );
});

test("baseline identity comparison rejects each schema-3 workload drift independently", () => {
  const cases = [
    ["browserVersion", (report) => { report.environment.browserVersion = "146.0.0.0"; }, /browser version mismatch/],
    ["packageLockSha256", (report) => { report.environment.packageLockSha256 = "c".repeat(64); }, /package lock mismatch/],
    ["runs", (report) => { report.config.runs = 4; }, /runs mismatch/],
    ["manifestSha256", (report) => {
      report.workloadIdentity.scenarios.tno_1962.manifestSha256 = "d".repeat(64);
      report.scenarios.tno_1962.workloadIdentity.manifestSha256 = "d".repeat(64);
    }, /manifestSha256 mismatch/],
    ["featureCount", (report) => {
      report.workloadIdentity.scenarios.tno_1962.featureCount = 12866;
      report.scenarios.tno_1962.workloadIdentity.featureCount = 12866;
    }, /featureCount mismatch/],
  ];

  for (const [label, mutate, expected] of cases) {
    const baseline = makeSchema3IdentityReport();
    const current = makeSchema3IdentityReport("gate");
    mutate(current);
    const mismatches = collectBaselineContractMismatches(current, baseline);
    assert.equal(mismatches.length, 1, `${label} should produce one focused mismatch`);
    assert.match(mismatches[0], expected);
  }
});

test("baseline identity comparison requires distinct hash-bound baseline and gate raw windows", () => {
  const baseline = makeSchema3IdentityReport();
  const current = makeSchema3IdentityReport("gate");

  assert.deepEqual(collectBaselineContractMismatches(current, baseline), []);
  current.rawEvidence.root = baseline.rawEvidence.root;
  current.rawEvidence.environmentAdmission.rawPath = baseline.rawEvidence.environmentAdmission.rawPath;
  current.rawEvidence.generationFence.rawPath = baseline.rawEvidence.generationFence.rawPath;
  assert.ok(
    collectBaselineContractMismatches(current, baseline)
      .some((entry) => /raw evidence window collision/.test(entry)),
  );
});

test("baseline and current validators pin their report roles", () => {
  assert.throws(
    () => validateGateBaselineReport(makeSchema3IdentityReport("gate"), [], "gate fixture"),
    /baseline\.mode expected="baseline" actual="gate"/,
  );
  assert.throws(
    () => validateGateCurrentReport(makeSchema3IdentityReport("baseline"), [], "baseline fixture"),
    /current\.mode expected="gate" actual="baseline"/,
  );
});

test("baseline identity comparison binds scenario workload identities to report identities", () => {
  const baseline = makeSchema3IdentityReport();
  const current = makeSchema3IdentityReport("gate");
  current.scenarios.tno_1962.workloadIdentity.manifestSha256 = "f".repeat(64);

  assert.deepEqual(
    collectBaselineContractMismatches(current, baseline),
    ["tno_1962.current scenario workload identity does not match report workload identity"],
  );
});

test("baseline identity comparison exposes paired report and scenario identity drift", () => {
  const baseline = makeSchema3IdentityReport();
  const current = makeSchema3IdentityReport("gate");
  current.workloadIdentity.scenarios.tno_1962.baseUrl = "http://127.0.0.1:8892";
  current.scenarios.tno_1962.workloadIdentity.manifestSha256 = "f".repeat(64);

  const mismatches = collectBaselineContractMismatches(current, baseline);
  assert.ok(mismatches.some((entry) => /tno_1962\.report workload identity mismatch/.test(entry)));
  assert.ok(mismatches.some((entry) => /tno_1962\.current scenario workload identity does not match report workload identity/.test(entry)));
});

test("baseline identity comparison requires the exact canonical scenario sequence", () => {
  const baseline = makeSchema3IdentityReport();
  const current = makeSchema3IdentityReport("gate");
  const hoi4Identity = {
    manifestSha256: "d".repeat(64),
    featureCount: 12602,
  };
  baseline.config.scenarios = ["blank_base", "tno_1962", "hoi4_1939"];
  current.config.scenarios = ["tno_1962", "hoi4_1939"];
  baseline.workloadIdentity.scenarios.blank_base = {
    manifestSha256: "c".repeat(64),
    featureCount: 11294,
  };
  baseline.workloadIdentity.scenarios.hoi4_1939 = { ...hoi4Identity };
  current.workloadIdentity.scenarios.hoi4_1939 = { ...hoi4Identity };
  baseline.scenarios.hoi4_1939.workloadIdentity = { ...hoi4Identity };
  current.scenarios.hoi4_1939.workloadIdentity = { ...hoi4Identity };

  assert.match(collectBaselineContractMismatches(current, baseline)[0], /scenarios mismatch/);

  baseline.config.scenarios = ["tno_1962", "hoi4_1939"];
  delete baseline.workloadIdentity.scenarios.blank_base;
  assert.deepEqual(collectBaselineContractMismatches(current, baseline), []);

  baseline.config.scenarios = ["blank_base", "tno_1962"];
  assert.deepEqual(
    collectBaselineContractMismatches(current, baseline),
    ['scenarios mismatch: baseline=["blank_base","tno_1962"] current=["tno_1962","hoi4_1939"]'],
  );

  baseline.config.scenarios = ["tno_1962", "hoi4_1939"];
  current.config.scenarios = ["hoi4_1939", "tno_1962"];
  assert.match(collectBaselineContractMismatches(current, baseline)[0], /scenarios mismatch/);

  current.config.scenarios = ["tno_1962", "tno_1962"];
  assert.match(collectBaselineContractMismatches(current, baseline)[0], /scenarios mismatch/);

  current.config.scenarios = ["tno_1962", "hoi4_1939"];
  baseline.config.scenarios = ["tno_1962", "tno_1962", "hoi4_1939"];
  assert.match(collectBaselineContractMismatches(current, baseline)[0], /scenarios mismatch/);
});

test("baseline identity comparison requires admitted windows on the same Windows power scheme", () => {
  const baseline = makeSchema3IdentityReport();
  const current = makeSchema3IdentityReport("gate");
  const currentPowerSchemeGuid = "a1841308-3541-4fab-bc81-f71556f20b4a";
  current.environmentAdmission.power.activeSchemeGuid = currentPowerSchemeGuid;
  current.generationFence.power.activeSchemeGuid = currentPowerSchemeGuid;
  bindReportRawEvidenceHashes(current);

  assert.match(collectBaselineContractMismatches(current, baseline)[0], /power scheme mismatch/);

  delete baseline.environmentAdmission;
  assert.ok(
    collectBaselineContractMismatches(current, baseline)
      .some((entry) => /baseline\.environmentAdmission must be admitted/.test(entry)),
  );
});

test("baseline identity comparison rejects degraded Windows power evidence", () => {
  const baseline = makeSchema3IdentityReport();
  const current = makeSchema3IdentityReport("gate");
  current.environmentAdmission.power = {
    status: "collection-error",
    activeSchemeGuid: "",
    acLineStatus: 255,
  };

  assert.ok(
    collectBaselineContractMismatches(current, baseline)
      .some((entry) => /current\.environmentAdmission must be admitted/.test(entry)),
  );

  baseline.environmentAdmission.power = {
    status: "collection-error",
    activeSchemeGuid: "",
    acLineStatus: 255,
  };
  assert.ok(
    collectBaselineContractMismatches(current, baseline)
      .some((entry) => /environmentAdmission must be admitted/.test(entry)),
  );
});

test("baseline identity comparison rejects forged admitted environment evidence", () => {
  const baseline = makeSchema3IdentityReport();
  const current = makeSchema3IdentityReport("gate");
  current.environmentAdmission.exitCode = STANDARD_PERF_ADMISSION_EXIT_CODES.admissionRejected;
  current.environmentAdmission.failures = [{ code: "cpu-average-high", detail: "fixture" }];

  assert.ok(
    collectBaselineContractMismatches(current, baseline)
      .some((entry) => /current\.environmentAdmission must be admitted/.test(entry)),
  );

  const thresholdDrift = makeSchema3IdentityReport("gate");
  thresholdDrift.environmentAdmission.thresholds.cpuAverageMaxPercent += 1;
  assert.ok(
    collectBaselineContractMismatches(thresholdDrift, baseline)
      .some((entry) => /current\.environmentAdmission must be admitted/.test(entry)),
  );

  const admissionHeadDrift = makeSchema3IdentityReport("gate");
  admissionHeadDrift.environmentAdmission.git.head = "a".repeat(40);
  assert.ok(
    collectBaselineContractMismatches(admissionHeadDrift, baseline)
      .some((entry) => /current\.environmentAdmission must be admitted/.test(entry)),
  );

  const fencePowerDrift = makeSchema3IdentityReport();
  fencePowerDrift.generationFence.power.activeSchemeGuid = "a1841308-3541-4fab-bc81-f71556f20b4a";
  assert.ok(
    collectBaselineContractMismatches(fencePowerDrift, baseline)
      .some((entry) => /current\.generationFence must be stable/.test(entry)),
  );
});

test("custom baseline scenarios cannot overwrite canonical output paths", () => {
  const canonicalOptions = {
    mode: "baseline",
    scenarios: ["tno_1962", "hoi4_1939"],
    baselineJson: path.join(REPO_ROOT, "docs", "perf", "baseline_2026-07-30.json"),
    baselineMd: path.join(REPO_ROOT, "docs", "perf", "baseline_2026-07-30.md"),
    rawDir: path.join(REPO_ROOT, ".runtime", "output", "perf", "baseline_2026-07-30", "baseline"),
    writeMarkdown: true,
  };
  assert.doesNotThrow(() => validateBaselineOutputSelection(canonicalOptions));
  assert.throws(
    () => validateBaselineOutputSelection({ ...canonicalOptions, scenarios: ["blank_base"] }),
    /custom scenarios require custom output paths/,
  );
  assert.doesNotThrow(() => validateBaselineOutputSelection({
    ...canonicalOptions,
    scenarios: ["blank_base"],
    baselineJson: path.join(REPO_ROOT, ".runtime", "output", "perf", "blank.json"),
    baselineMd: path.join(REPO_ROOT, ".runtime", "output", "perf", "blank.md"),
    rawDir: path.join(REPO_ROOT, ".runtime", "output", "perf", "blank"),
  }));

  const customOptions = {
    ...canonicalOptions,
    scenarios: ["blank_base"],
    baselineJson: path.join(REPO_ROOT, ".runtime", "output", "perf", "blank.json"),
    baselineMd: path.join(REPO_ROOT, ".runtime", "output", "perf", "blank.md"),
    rawDir: path.join(REPO_ROOT, ".runtime", "output", "perf", "blank"),
  };
  for (const [field, canonicalPath] of [
    ["baselineJson", canonicalOptions.baselineJson],
    ["baselineMd", canonicalOptions.baselineMd],
    ["rawDir", canonicalOptions.rawDir],
  ]) {
    const caseVariantOptions = {
      ...customOptions,
      [field]: canonicalPath.toUpperCase(),
    };
    if (process.platform === "win32") {
      assert.throws(
        () => validateBaselineOutputSelection(caseVariantOptions),
        /custom scenarios require custom output paths/,
        `${field} must use Windows case-insensitive canonical path comparison`,
      );
    } else {
      assert.doesNotThrow(() => validateBaselineOutputSelection(caseVariantOptions));
    }
  }
});

test("baseline artifact date follows the selected oracle filename", () => {
  assert.equal(
    getBaselineArtifactDate(path.join(REPO_ROOT, "docs", "perf", "baseline_2026-07-30.json")),
    "2026-07-30",
  );
  assert.equal(getBaselineArtifactDate(path.join(REPO_ROOT, "custom.json")), "2026-07-30");
});

test("scenario shards require explicit matching selection and isolated output paths", () => {
  for (const scenarioShard of SCENARIOS) {
    const options = parseArgs([
      "--mode", "gate", "--scenario-shard", scenarioShard, "--scenarios", scenarioShard,
      "--baseline-json", `.runtime/tmp/${scenarioShard}/baseline.json`,
      "--raw-dir", `.runtime/tmp/${scenarioShard}/gate`, "--write-markdown", "false",
    ]);
    assert.equal(options.scenarioShard, scenarioShard);
    assert.doesNotThrow(() => validateGateScenarioSelection(options.scenarios, options));
    assert.doesNotThrow(() => validateBaselineOutputSelection(options));
    assert.throws(() => validateGateScenarioSelection(options.scenarios), /must exactly match/);
    assert.throws(() => validateGateScenarioSelection(SCENARIOS, options), /must exactly match/);
    assert.throws(() => validateGateScenarioSelection([scenarioShard, scenarioShard], options), /must exactly match/);
    assert.throws(() => validateGateScenarioSelection([SCENARIOS.find((id) => id !== scenarioShard)], options), /must exactly match/);
    for (const mode of ["baseline", "gate"]) {
      const defaults = parseArgs(["--mode", mode]);
      for (const field of ["baselineJson", "rawDir"]) {
        assert.throws(() => validateBaselineOutputSelection({ ...options, mode, [field]: defaults[field] }), /scenario shards require custom output paths/);
      }
      assert.throws(() => validateBaselineOutputSelection({ ...options, mode, rawDir: parseArgs(["--mode", mode === "gate" ? "baseline" : "gate"]).rawDir }), /scenario shards require custom output paths/);
    }
    assert.throws(() => validateBaselineOutputSelection({ ...options, mode: "baseline", writeMarkdown: true }), /scenario shards require custom output paths/);
  }
  assert.throws(() => parseArgs(["--scenario-shard"]), /requires a scenario ID/);
  assert.throws(() => validateGateScenarioSelection(["blank_base"], { scenarioShard: "blank_base" }), /Unsupported scenario shard/);
  const missingSelection = parseArgs(["--scenario-shard", "tno_1962"]);
  assert.throws(() => validateGateScenarioSelection(missingSelection.scenarios, missingSelection), /must exactly match/);
});

test("shard report comparisons require explicit matching scope and preserve identity checks", () => {
  const makeShard = (mode, scenarioShard) => {
    const report = makeSchema3IdentityReport(mode);
    report.scope = "scenario-shard";
    report.scenarioShard = scenarioShard;
    report.config.scenarios = [scenarioShard];
    report.workloadIdentity.scenarioIds = [scenarioShard];
    report.workloadIdentity.scenarios = { [scenarioShard]: report.workloadIdentity.scenarios[scenarioShard] };
    report.scenarios = { [scenarioShard]: report.scenarios[scenarioShard] };
    return bindReportRawEvidenceHashes(report);
  };
  for (const scenarioShard of SCENARIOS) {
    const options = { scenarioShard };
    const baseline = makeShard("baseline", scenarioShard);
    const current = makeShard("gate", scenarioShard);
    assert.deepEqual(collectBaselineContractMismatches(current, baseline, options), []);
    assert.ok(collectBaselineContractMismatches(current, baseline).some((message) => /scope mismatch/.test(message)));
    for (const mutate of [
      (report) => { delete report.scope; },
      (report) => { delete report.scenarioShard; },
      (report) => { report.scenarioShard = SCENARIOS.find((id) => id !== scenarioShard); },
      (report) => { report.config.scenarios = [...SCENARIOS]; },
      (report) => { report.scenarios.extra = { runs: [] }; },
      (report) => { report.workloadIdentity.scenarioIds = [...SCENARIOS]; },
      (report) => { report.environment.runnerIdentity.imageVersion = "other-runner"; },
      (report) => { report.config.runs = 4; },
      (report) => { report.config.warmups = 2; },
      (report) => { report.rawEvidence.generationFence.rawSha256 = "0".repeat(64); },
    ]) {
      for (const target of ["baseline", "current"]) {
        const changedBaseline = structuredClone(baseline);
        const changedCurrent = structuredClone(current);
        mutate(target === "baseline" ? changedBaseline : changedCurrent);
        assert.ok(collectBaselineContractMismatches(changedCurrent, changedBaseline, options).length > 0);
      }
    }
    assert.ok(collectBaselineContractMismatches(makeSchema3IdentityReport("gate"), makeSchema3IdentityReport("baseline"), options).length > 0);
    assert.ok(collectBaselineContractMismatches(current, baseline, { scenarioShard: "blank_base" }).length > 0);
  }
});

test("baseline identity comparison rejects an incomplete canonical gate scenario set", () => {
  const baseline = makeSchema3IdentityReport();
  const current = makeSchema3IdentityReport("gate");
  baseline.config.scenarios = ["blank_base", "tno_1962", "hoi4_1939"];
  current.config.scenarios = ["tno_1962"];

  assert.match(
    collectBaselineContractMismatches(current, baseline)[0],
    /scenarios mismatch/,
  );
});

test("baseline identity comparison reports invalid scenario collection types without throwing", () => {
  const baseline = makeSchema3IdentityReport();
  const current = makeSchema3IdentityReport("gate");
  current.config.scenarios = { tno_1962: true, hoi4_1939: true };

  const mismatches = collectBaselineContractMismatches(current, baseline);
  assert.equal(mismatches.length, 1);
  assert.match(mismatches[0], /scenarios mismatch/);
});

const missingSchema3IdentityCases = [
  ["platform", (report) => { delete report.environment.platform; }, /os platform mismatch/],
  ["release", (report) => { delete report.environment.release; }, /os release mismatch/],
  ["arch", (report) => { delete report.environment.arch; }, /architecture mismatch/],
  ["cpuModel", (report) => { delete report.environment.cpuModel; }, /CPU model mismatch/],
  ["cpuCount", (report) => { delete report.environment.cpuCount; }, /CPU count mismatch/],
  ["memoryGiB", (report) => { delete report.environment.memoryGiB; }, /memory class mismatch/],
  ["runnerIdentity", (report) => { delete report.environment.runnerIdentity; }, /runner identity mismatch/],
  ["nodeMajor", (report) => { delete report.environment.nodeMajor; }, /node major mismatch/],
  ["browser", (report) => { delete report.environment.browser; }, /browser mismatch/],
  ["browserVersion", (report) => { delete report.environment.browserVersion; }, /browser version mismatch/],
  ["packageLockSha256", (report) => { delete report.environment.packageLockSha256; }, /package lock mismatch/],
  ["runs", (report) => { delete report.config.runs; }, /runs mismatch/],
  ["warmups", (report) => { delete report.config.warmups; }, /warmups mismatch/],
  ["scenarios", (report) => { delete report.config.scenarios; }, /scenarios mismatch/],
  ["urlQuery", (report) => { delete report.config.urlQuery; }, /urlQuery mismatch/],
];

test("baseline identity comparison rejects missing schema-3 workload fields", () => {
  const cases = missingSchema3IdentityCases;

  for (const [label, mutate, expected] of cases) {
    const baseline = makeSchema3IdentityReport();
    const current = makeSchema3IdentityReport("gate");
    mutate(baseline);
    const mismatches = collectBaselineContractMismatches(current, baseline);
    assert.equal(mismatches.length, 1, `${label} should produce one focused mismatch`);
    assert.match(mismatches[0], expected);
  }
});

test("baseline identity comparison rejects current-side and bilateral schema-3 identity gaps", () => {
  for (const [label, mutate, expected] of missingSchema3IdentityCases) {
    const baseline = makeSchema3IdentityReport();
    const current = makeSchema3IdentityReport("gate");
    mutate(current);
    let mismatches = collectBaselineContractMismatches(current, baseline);
    assert.equal(mismatches.length, 1, `${label} current-side gap should produce one focused mismatch`);
    assert.match(mismatches[0], expected);

    mutate(baseline);
    mismatches = collectBaselineContractMismatches(current, baseline);
    assert.equal(mismatches.length, 1, `${label} bilateral gap should still produce one focused mismatch`);
    assert.match(mismatches[0], expected);
  }
});

test("baseline identity comparison rejects malformed exact platform and node identities", () => {
  const cases = [
    ["platform suffix", (report) => { report.environment.platform = "win32 extra"; }, /os platform mismatch/],
    ["fractional nodeMajor", (report) => { report.environment.nodeMajor = 22.9; }, /node major mismatch/],
    ["string nodeMajor", (report) => { report.environment.nodeMajor = "22junk"; }, /node major mismatch/],
  ];

  for (const [label, mutate, expected] of cases) {
    let baseline = makeSchema3IdentityReport();
    let current = makeSchema3IdentityReport("gate");
    mutate(baseline);
    let mismatches = collectBaselineContractMismatches(current, baseline);
    assert.equal(mismatches.length, 1, `${label} baseline-side drift should produce one focused mismatch`);
    assert.match(mismatches[0], expected);

    baseline = makeSchema3IdentityReport();
    current = makeSchema3IdentityReport("gate");
    mutate(current);
    mismatches = collectBaselineContractMismatches(current, baseline);
    assert.equal(mismatches.length, 1, `${label} current-side drift should produce one focused mismatch`);
    assert.match(mismatches[0], expected);

    mutate(baseline);
    mismatches = collectBaselineContractMismatches(current, baseline);
    assert.equal(mismatches.length, 1, `${label} bilateral drift should still produce one focused mismatch`);
    assert.match(mismatches[0], expected);
  }
});

test("baseline identity comparison rejects machine and runner drift", () => {
  const cases = [
    ["release", (report) => { report.environment.release = "10.0.99999"; }, /os release mismatch/],
    ["arch", (report) => { report.environment.arch = "arm64"; }, /architecture mismatch/],
    ["cpuModel", (report) => { report.environment.cpuModel = "Different CPU"; }, /CPU model mismatch/],
    ["cpuCount", (report) => { report.environment.cpuCount += 1; }, /CPU count mismatch/],
    ["memoryGiB", (report) => { report.environment.memoryGiB += 8; }, /memory class mismatch/],
    ["runnerIdentity", (report) => { report.environment.runnerIdentity.imageVersion = "different"; }, /runner identity mismatch/],
  ];

  for (const [label, mutate, expected] of cases) {
    const baseline = makeSchema3IdentityReport();
    const current = makeSchema3IdentityReport("gate");
    mutate(current);
    const mismatches = collectBaselineContractMismatches(current, baseline);
    assert.equal(mismatches.length, 1, `${label} should produce one focused mismatch`);
    assert.match(mismatches[0], expected);
  }
});

test("baseline identity comparison rejects missing scenario workload identity on either side", () => {
  const cases = [
    ["manifestSha256", (report) => { delete report.workloadIdentity.scenarios.tno_1962.manifestSha256; }, /manifestSha256 mismatch/],
    ["featureCount", (report) => { delete report.workloadIdentity.scenarios.tno_1962.featureCount; }, /featureCount mismatch/],
  ];

  for (const [label, mutate, expected] of cases) {
    let baseline = makeSchema3IdentityReport();
    let current = makeSchema3IdentityReport("gate");
    mutate(baseline);
    let mismatches = collectBaselineContractMismatches(current, baseline);
    assert.ok(mismatches.some((entry) => expected.test(entry)), `${label} baseline-side gap should expose the primary mismatch`);
    assert.ok(
      mismatches.some((entry) => /baseline scenario workload identity does not match report workload identity/.test(entry)),
      `${label} baseline-side gap should expose internal identity drift`,
    );

    baseline = makeSchema3IdentityReport();
    current = makeSchema3IdentityReport("gate");
    mutate(current);
    mismatches = collectBaselineContractMismatches(current, baseline);
    assert.ok(mismatches.some((entry) => expected.test(entry)), `${label} current-side gap should expose the primary mismatch`);
    assert.ok(
      mismatches.some((entry) => /current scenario workload identity does not match report workload identity/.test(entry)),
      `${label} current-side gap should expose internal identity drift`,
    );

    mutate(baseline);
    mismatches = collectBaselineContractMismatches(current, baseline);
    assert.ok(
      mismatches.some((entry) => expected.test(entry)),
      `${label} bilateral gap should retain the primary workload mismatch`,
    );
    assert.ok(
      mismatches.some((entry) => /scenario workload identity does not match report workload identity/.test(entry)),
      `${label} bilateral gap should expose duplicated identity drift`,
    );
  }
});

test("snapshot summarization keeps non-number measurements out of gate summaries", () => {
  const summary = summarizeSnapshot({
    bootMetrics: { total: { durationMs: true } },
    renderPerfMetrics: { scenarioApplyMapRefresh: { durationMs: [100] } },
    renderSamples: { count: 2, medianMs: "100", samples: [] },
  }, "tno_1962");
  assert.equal(summary.totalStartupMs, 0);
  assert.equal(summary.refreshScenarioApplyMs, 0);
  assert.equal(summary.renderSampleMedianMs, 0);
});

test("companion report fails closed when the injected source report identity changes", async (t) => {
  const fixture = await materializeGovernedFixture(t);
  const report = await buildGovernedCompanionReport({
    ...fixture,
    expectedSourceSha256: "0".repeat(64),
  });
  assert.equal(report.decision.status, "blocked-rerun-required");
  assert.equal(report.decision.admitted, false);
  assert.ok(report.decision.failedChecks.includes("source_report_sha"));
});
